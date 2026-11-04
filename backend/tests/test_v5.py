import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from test_api import app, sample_pdf
from test_v4 import layout_pdf
from app.database import SessionLocal
from app.models import Translation


class ContextAndFormulaTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        uploaded = self.client.post("/api/papers", files={"file": ("sample.pdf", sample_pdf(), "application/pdf")})
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        self.base = f"/api/papers/{uploaded.json()['id']}"

    def tearDown(self):
        self.client.delete(self.base)

    def test_selected_quote_persists_in_followup_and_history(self):
        paragraph = next(p for p in self.client.get(self.base + "/paragraphs").json() if "latent dynamics" in p["text"])
        reference = {"paragraphId": paragraph["id"], "sourceLanguage": "en",
                     "selectedText": "latent dynamics model", "rects": [[0.1, 0.1, 0.3, 0.2]]}
        prompts = []

        async def answer(prompt, json_mode=False):
            prompts.append(prompt)
            return json.dumps({"answer": f"论文使用紧凑表示预测未来状态。 [{self.base.split('/')[-1]}:p2]",
                               "evidence": [{"paragraphId": paragraph["id"],
                                             "quote": "latent dynamics model predicts future states"}]})

        with patch("app.main.generate", answer):
            first = self.client.post(self.base + "/ask", json={"question": "这里的 latent dynamics 是什么？",
                "paragraphId": paragraph["id"], "reference": reference})
            second = self.client.post(self.base + "/ask", json={"question": "它预测什么？",
                "paragraphId": paragraph["id"], "reference": reference})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(first.json()["reference"]["alignment"], "exact")
        self.assertNotIn(":p2]", first.json()["answer"])
        self.assertEqual(first.json()["reference"]["selectedText"], reference["selectedText"])
        self.assertIn("这里的 latent dynamics 是什么？", prompts[1])
        records = self.client.get(self.base + "/history").json()
        self.assertEqual(len(records), 2)
        self.assertTrue(all(item["reference"]["paragraphId"] == paragraph["id"] for item in records))

    def test_unmatched_selection_does_not_claim_exact_alignment(self):
        paragraph = self.client.get(self.base + "/paragraphs").json()[0]

        async def answer(prompt, json_mode=False):
            return json.dumps({"answer": "无法核对该选区。", "evidence": []})

        with patch("app.main.generate", answer):
            result = self.client.post(self.base + "/ask", json={"question": "这是什么？",
                "reference": {"paragraphId": paragraph["id"], "sourceLanguage": "en",
                              "selectedText": "text absent from paper", "rects": [[0.1, 0.1, 0.2, 0.2]]}})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["reference"]["alignment"], "paragraph")
        self.assertEqual(result.json()["reference"]["rects"], [])

    def test_chinese_selection_keeps_original_english_context(self):
        paragraph = next(p for p in self.client.get(self.base + "/paragraphs").json() if "latent dynamics" in p["text"])
        with SessionLocal() as session:
            session.add(Translation(paragraph_id=paragraph["id"], text="潜在动力学模型从紧凑表示预测未来状态。"))
            session.commit()
        prompts = []

        async def answer(prompt, json_mode=False):
            prompts.append(prompt)
            return json.dumps({"answer": "这里讨论潜在动力学。", "evidence": []})

        with patch("app.main.generate", answer):
            result = self.client.post(self.base + "/ask", json={"question": "这里预测什么？",
                "reference": {"paragraphId": paragraph["id"], "sourceLanguage": "zh",
                              "selectedText": "潜在动力学模型", "rects": []}})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIn("潜在动力学模型", prompts[0])
        self.assertIn("A latent dynamics model", prompts[0])
        self.assertEqual(result.json()["reference"]["alignment"], "paragraph")

    def test_page_only_selection_uses_honest_fallback(self):
        async def answer(prompt, json_mode=False):
            return json.dumps({"answer": "无法确认精确段落。", "evidence": []})

        with patch("app.main.generate", answer):
            result = self.client.post(self.base + "/ask", json={"question": "选中的文字是什么意思？",
                "reference": {"page": 1, "sourceLanguage": "en", "selectedText": "unmapped text"}})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["reference"]["page"], 1)
        self.assertEqual(result.json()["reference"]["alignment"], "page")


class FormulaCacheTests(unittest.TestCase):
    def test_brief_cache_and_deep_history(self):
        client = TestClient(app)
        uploaded = client.post("/api/papers", files={"file": ("formula.pdf", layout_pdf(), "application/pdf")})
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        base = f"/api/papers/{uploaded.json()['id']}"
        try:
            element = next(item for item in client.get(base + "/elements").json() if item["kind"] == "equation")
            calls = []

            async def explain(prompt, json_mode=False, image=None):
                calls.append(prompt)
                self.assertTrue(image.startswith(b"\x89PNG"))
                return "公式图像需要核对原 PDF。"

            endpoint = base + f"/elements/{element['id']}/explain"
            with patch("app.main.generate", explain):
                first = client.post(endpoint + "?mode=brief")
                cached = client.post(endpoint + "?mode=brief")
                deep = client.post(endpoint + "?mode=deep")
            self.assertEqual(first.status_code, 200, first.text)
            self.assertFalse(first.json()["cached"])
            self.assertTrue(cached.json()["cached"])
            self.assertEqual(deep.status_code, 200, deep.text)
            self.assertEqual(len(calls), 2)
            self.assertIn("AI 辅助推导", calls[1])
            self.assertEqual(len(client.get(base + "/history").json()), 1)
        finally:
            client.delete(base)

    def test_formula_followup_sends_original_image_and_anchor(self):
        client = TestClient(app)
        uploaded = client.post("/api/papers", files={"file": ("formula.pdf", layout_pdf(), "application/pdf")})
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        base = f"/api/papers/{uploaded.json()['id']}"
        try:
            element = next(item for item in client.get(base + "/elements").json() if item["kind"] == "equation")

            async def answer(prompt, json_mode=False, image=None):
                self.assertIn(element["id"], prompt)
                self.assertTrue(image.startswith(b"\x89PNG"))
                return json.dumps({"answer": "图中各项相加。", "evidence": []})

            with patch("app.main.generate", answer):
                response = client.post(base + "/ask", json={"question": "公式中的第三项是什么？",
                    "reference": {"elementId": element["id"], "page": 1,
                                  "sourceLanguage": "en", "selectedText": ""}})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["reference"]["elementId"], element["id"])
            self.assertEqual(client.get(base + "/history").json()[0]["reference"]["elementId"], element["id"])
        finally:
            client.delete(base)
