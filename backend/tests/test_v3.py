import json
import unittest
from unittest.mock import patch

import pymupdf
from fastapi.testclient import TestClient

from test_api import app, sample_pdf


class V3ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.pdf_bytes = sample_pdf()
        response = self.client.post("/api/papers", files={"file": ("v3.pdf", self.pdf_bytes, "application/pdf")})
        self.assertEqual(response.status_code, 201, response.text)
        self.paper_id = response.json()["id"]
        self.base = f"/api/papers/{self.paper_id}"
        self.paragraph = next(p for p in self.client.get(self.base + "/paragraphs").json()
                              if "latent dynamics" in p["text"])

    def tearDown(self):
        self.client.delete(self.base)

    def quiz_payload(self):
        return json.dumps([{
            "kind": "multiple_choice", "prompt": "What predicts future states?",
            "options": ["A standard CNN", "A latent dynamics model", "A price model", "Nothing"],
            "correct_option_text": "A latent dynamics model", "reference_answer": "A latent dynamics model",
            "why_correct": "The paper explicitly names a latent dynamics model.",
            "why_others": {"A": "CNN is not named here.", "C": "Prices are not discussed.", "D": "The model predicts states."},
            "evidence_paragraph_id": self.paragraph["id"], "evidence_quote": "latent dynamics model predicts future states",
        }])

    def test_quiz_wrong_and_correct_option_ids_are_deterministic(self):
        async def generated(prompt, json_mode=False):
            return self.quiz_payload()
        with patch("app.main.generate", generated):
            response = self.client.post(self.base + "/quiz/generate")
        self.assertEqual(response.status_code, 200, response.text)
        question = response.json()[0]
        self.assertEqual(question["status"], "ready")
        self.assertEqual(self.client.post(self.base + f"/quiz/{question['id']}/answer", json={"answer": "A"}).status_code, 400)
        wrong = self.client.post(self.base + f"/quiz/{question['id']}/answer", json={"answer": question["options"][0]["id"]})
        self.assertEqual(wrong.json()["score"], 0)
        self.assertEqual(wrong.json()["evaluation"]["correctAnswer"], "A latent dynamics model")
        self.assertEqual(wrong.json()["evaluation"]["evidence"][0]["paragraphId"], self.paragraph["id"])
        correct = self.client.post(self.base + f"/quiz/{question['id']}/answer", json={"answer": question["options"][1]["id"]})
        self.assertEqual(correct.json()["score"], 1)
        self.assertEqual(correct.json()["evaluation"]["status"], "correct")
        saved = self.client.get(self.base + "/quiz").json()[0]
        self.assertTrue(saved["attempt"]["verified"])

    def test_ambiguous_quiz_generation_rejected(self):
        invalid = json.loads(self.quiz_payload())
        invalid[0]["correct_option_text"] = "Not an option"
        async def generated(prompt, json_mode=False):
            return json.dumps(invalid)
        with patch("app.main.generate", generated):
            response = self.client.post(self.base + "/quiz/generate")
        self.assertEqual(response.status_code, 502)

    def test_same_filename_different_pdf_keeps_both_files(self):
        document = pymupdf.open()
        document.new_page().insert_text((72, 100), "A different research paper", fontsize=14)
        different = document.tobytes()
        document.close()
        response = self.client.post("/api/papers", files={"file": ("v3.pdf", different, "application/pdf")})
        self.assertEqual(response.status_code, 201, response.text)
        second_id = response.json()["id"]
        try:
            self.assertNotEqual(second_id, self.paper_id)
            self.assertEqual(self.client.get(f"/api/papers/{second_id}/file").content, different)
            self.assertEqual(self.client.get(self.base + "/file").content, self.pdf_bytes)
        finally:
            self.client.delete(f"/api/papers/{second_id}")

    def test_note_exact_anchor_survives_reload_and_edit(self):
        payload = {"paragraphId": self.paragraph["id"], "page": 1,
                   "selectedText": "latent dynamics", "textAnchor": "latent dynamics",
                   "rects": [[.15, .2, .35, .23]], "content": "My note"}
        created = self.client.post(self.base + "/notes", json=payload)
        self.assertEqual(created.status_code, 201, created.text)
        saved = self.client.get(self.base + "/notes").json()[0]
        self.assertEqual(saved["rects"], payload["rects"])
        self.assertEqual(saved["textAnchor"], "latent dynamics")
        self.client.put(self.base + "/notes/" + saved["id"], json={**payload, "content": "Revised"})
        reloaded = self.client.get(self.base + "/notes").json()[0]
        self.assertEqual(reloaded["content"], "Revised")
        self.assertEqual(reloaded["rects"], payload["rects"])

    def test_grounded_answer_rejects_fake_quote_and_keeps_dialogue(self):
        prompts = []
        async def generated(prompt, json_mode=False):
            prompts.append(prompt)
            return json.dumps({"answer": "The model predicts future states.",
                               "evidence": [{"paragraphId": self.paragraph["id"], "quote": "invented experimental number"}]})
        with patch("app.main.generate", generated):
            self.client.post(self.base + "/ask", json={"question": "What does it predict?", "paragraphId": self.paragraph["id"]})
            second = self.client.post(self.base + "/ask", json={"question": "How does this work?", "paragraphId": self.paragraph["id"]})
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(second.json()["evidence"], [])
        self.assertIn("未提供可核对的原文引文", second.json()["answer"])
        self.assertIn("What does it predict?", prompts[1])

    def test_summary_check_polish_accept_keeps_original(self):
        original = "This paper studies latent dynamics. It predicts future states."
        saved = self.client.put(self.base + "/summary", json={"content": original})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(self.client.get(self.base + "/summary").json()["content"], original)
        async def generated(prompt, json_mode=False):
            if "核对用户" in prompt:
                return json.dumps({"overall": "基本准确", "correct": ["描述了预测任务"], "corrections": [],
                                   "missing": ["实验细节"], "questions": ["如何评估？"],
                                   "evidence": [{"paragraphId": self.paragraph["id"], "quote": "predicts future states"}]})
            return json.dumps({"suggested": "This paper studies latent dynamics and predicts future states.",
                               "notes": "仅改善表达。"})
        with patch("app.main.generate", generated):
            checked = self.client.post(self.base + "/summary/check")
            polished = self.client.post(self.base + "/summary/polish")
        self.assertEqual(checked.status_code, 200, checked.text)
        self.assertEqual(checked.json()["result"]["evidence"][0]["paragraphId"], self.paragraph["id"])
        self.assertEqual(polished.status_code, 200, polished.text)
        self.assertEqual(self.client.get(self.base + "/summary").json()["content"], original)
        accepted = self.client.post(self.base + "/summary/polish/" + polished.json()["id"] + "/accept")
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertNotEqual(accepted.json()["content"], original)
        self.assertEqual(self.client.get(self.base + "/summary").json()["reviews"][0]["originalContent"], original)
