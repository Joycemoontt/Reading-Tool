import unittest
from unittest.mock import patch

import pymupdf
from fastapi.testclient import TestClient
from test_api import app
from app.database import SessionLocal
from app.models import Paragraph, Translation


def layout_pdf():
    document = pymupdf.open()
    page = document.new_page(width=612, height=792)
    for x, y, text in [
        (58, 82, "Left opening explains the method."),
        (58, 132, "Left continuation finishes the argument."),
        (317, 82, "Right opening describes results."),
        (317, 132, "Right continuation gives context."),
        (58, 245, "L = Lcamera + Ldepth + lambda Ltrack."),
    ]:
        page.insert_text((x, y), text, fontsize=11)
    data = document.tobytes()
    document.close()
    return data


class LayoutAndEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        result = self.client.post("/api/papers", files={"file": ("layout.pdf", layout_pdf(), "application/pdf")})
        self.assertEqual(result.status_code, 201, result.text)
        self.paper_id = result.json()["id"]
        self.base = f"/api/papers/{self.paper_id}"

    def tearDown(self):
        self.client.delete(self.base)

    def test_column_order_reparse_keeps_translation_and_note_ids(self):
        paragraphs = self.client.get(self.base + "/paragraphs").json()
        prose = [p for p in paragraphs if p["text"].startswith(("Left", "Right"))]
        self.assertEqual([p["text"].split()[0] for p in prose],
                         ["Left", "Left", "Right", "Right"])
        self.assertEqual([p["columnIndex"] for p in prose], [0, 0, 1, 1])
        anchor = paragraphs[0]
        note = self.client.post(self.base + "/notes", json={"paragraphId": anchor["id"], "page": 1,
            "selectedText": "Left opening", "content": "Important"})
        self.assertEqual(note.status_code, 201)
        with SessionLocal() as session:
            session.add(Translation(paragraph_id=anchor["id"], text="左栏开头"))
            session.get(Paragraph, anchor["id"]).order = 99
            session.commit()
        result = self.client.post(self.base + "/reparse")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["paragraphs"], len(paragraphs))
        refreshed = self.client.get(self.base + "/paragraphs").json()
        self.assertEqual(refreshed[0]["id"], anchor["id"])
        self.assertEqual(refreshed[0]["translation"], "左栏开头")
        self.assertEqual(self.client.get(self.base + "/notes").json()[0]["paragraphId"], anchor["id"])
        integrity = self.client.get(self.base + "/translation-integrity").json()
        self.assertEqual(integrity["translatedCount"], 1)
        self.assertEqual(len(integrity["missingParagraphIds"]), len(paragraphs) - 1)

    def test_equation_explanation_uses_pdf_image_and_saves_history(self):
        elements = self.client.get(self.base + "/elements").json()
        equation = next(item for item in elements if item["kind"] == "equation")
        image = self.client.get(self.base + f"/elements/{equation['id']}/image")
        self.assertEqual(image.status_code, 200)
        self.assertTrue(image.content.startswith(b"\x89PNG"))

        async def fake_generate(prompt, json_mode=False, image=None):
            self.assertIn("第 1 页", prompt)
            self.assertTrue(image.startswith(b"\x89PNG"))
            return "公式用途与变量需核对原图。"

        with patch("app.main.generate", fake_generate):
            result = self.client.post(self.base + f"/elements/{equation['id']}/explain")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIn("需核对", result.json()["answer"])
        self.assertTrue(any(item["page"] == 1 and "解释公式" in item["question"]
                            for item in self.client.get(self.base + "/history").json()))
