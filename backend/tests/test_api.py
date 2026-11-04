import io
import os
import tempfile
import unittest
from unittest.mock import patch

import pymupdf
from fastapi.testclient import TestClient

_data = tempfile.TemporaryDirectory()
os.environ["PAPERMIND_DATA_DIR"] = _data.name

from app.main import app  # noqa: E402


def sample_pdf():
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "World Models for Research", fontsize=18)
    page.insert_text((72, 120), "Abstract", fontsize=14)
    page.insert_text((72, 150), "A latent dynamics model predicts future states from compact representations.", fontsize=11)
    page.insert_text((72, 180), "The experiment compares predictions with observed data.", fontsize=11)
    result = doc.tobytes()
    doc.close()
    return result


class PaperMindApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        result = self.client.post("/api/papers", files={"file": ("world-models.pdf", sample_pdf(), "application/pdf")})
        self.assertEqual(result.status_code, 201, result.text)
        self.paper = result.json()
        self.base = f"/api/papers/{self.paper['id']}"

    def tearDown(self):
        self.client.delete(self.base)

    def test_pdf_upload_parse_file_and_progress(self):
        paragraphs = self.client.get(self.base + "/paragraphs").json()
        self.assertGreaterEqual(len(paragraphs), 2)
        self.assertIn("latent dynamics", " ".join(p["text"] for p in paragraphs))
        self.assertEqual(self.client.get(self.base + "/file").content[:4], b"%PDF")
        response = self.client.put(self.base + "/progress", json={"page": 1, "mode": "paragraph"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get(self.base).json()["mode"], "paragraph")

    def test_translation_annotation_note_and_audio_position_persist(self):
        paragraphs = self.client.get(self.base + "/paragraphs").json()
        with patch("app.main.translate_batch", translated):
            response = self.client.post(self.base + "/translate")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["translated"], len(paragraphs))
        self.assertTrue(all(p["translation"] for p in self.client.get(self.base + "/paragraphs").json()))
        para = paragraphs[0]
        payload = {"paragraphId": para["id"], "page": para["page"], "text": "World Models", "color": "green", "kind": "underline"}
        annotation = self.client.post(self.base + "/annotations", json=payload)
        self.assertEqual(annotation.status_code, 201)
        self.assertEqual(len(self.client.get(self.base + "/annotations").json()), 1)
        annotation_id = annotation.json()["id"]
        self.assertEqual(self.client.put(self.base + f"/annotations/{annotation_id}", json={"color": "pink"}).json()["color"], "pink")
        self.assertEqual(self.client.post(self.base + "/notes", json={"paragraphId": para["id"], "page": 1, "selectedText": "World Models", "content": "Important"}).status_code, 201)
        self.assertEqual(self.client.get(self.base + "/notes").json()[0]["content"], "Important")
        position = {"paragraphId": para["id"], "sectionId": para["sectionId"], "charIndex": 10, "language": "en", "speed": 1.25}
        self.assertEqual(self.client.put(self.base + "/audio-progress", json=position).status_code, 200)
        saved = self.client.get(self.base + "/audio-progress").json()
        self.assertEqual(saved["paragraphId"], para["id"])
        self.assertEqual(saved["charIndex"], 10)

    def test_voice_question_uses_paper_context_and_saves_history(self):
        para = next(p for p in self.client.get(self.base + "/paragraphs").json() if "latent dynamics" in p["text"])
        captured = []
        async def fake_generate(prompt):
            captured.append(prompt)
            return "Latent dynamics predicts transitions in a compact space."
        with patch("app.main.generate", fake_generate):
            response = self.client.post(self.base + "/ask", json={"question": "latent dynamics 是什么？", "paragraphId": para["id"], "inputMode": "voice"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("latent dynamics", captured[0])
        record = self.client.get(self.base + "/history").json()[0]
        self.assertEqual(record["inputMode"], "voice")
        self.assertEqual(record["paragraphId"], para["id"])
        self.assertEqual(record["question"], "latent dynamics 是什么？")

    def test_rejects_non_pdf_and_wrong_paper_position(self):
        response = self.client.post("/api/papers", files={"file": ("bad.pdf", b"not-pdf", "application/pdf")})
        self.assertEqual(response.status_code, 400)
        response = self.client.put(self.base + "/audio-progress", json={"paragraphId": "wrong", "sectionId": "x", "charIndex": 0, "language": "en", "speed": 1})
        self.assertEqual(response.status_code, 400)

    def test_vocabulary_review_persists(self):
        para = next(p for p in self.client.get(self.base + "/paragraphs").json() if "latent dynamics" in p["text"])
        async def fake_generate(prompt, json_mode=False):
            return '{"meaning":"潜在动力学","context":"在隐空间中预测状态变化"}'
        with patch("app.main.generate", fake_generate):
            created = self.client.post(self.base + "/vocabulary", json={"word": "dynamics", "paragraphId": para["id"], "page": 1, "sourceSentence": para["text"]})
        self.assertEqual(created.status_code, 201, created.text)
        item_id = created.json()["id"]
        self.assertEqual(self.client.post(self.base + f"/vocabulary/{item_id}/review", json={"rating": "good"}).status_code, 200)
        self.assertEqual(self.client.get(self.base + "/vocabulary").json()[0]["reviewStatus"], "good")


async def translated(items):
    return {item["id"]: "中文翻译：" + item["text"] for item in items}


if __name__ == "__main__":
    unittest.main()
