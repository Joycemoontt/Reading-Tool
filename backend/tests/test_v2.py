import os
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from test_api import app, sample_pdf
from app.database import migrate_existing_database
from app.parser import clean_lines, reading_order


class V2ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        response = self.client.post("/api/papers", files={"file": ("v2.pdf", sample_pdf(), "application/pdf")})
        self.assertEqual(response.status_code, 201, response.text)
        self.paper = response.json()
        self.base = "/api/papers/" + self.paper["id"]

    def tearDown(self):
        self.client.delete(self.base)

    def test_folders_move_upload_and_safe_delete(self):
        created = self.client.post("/api/folders", json={"name": "World Models"})
        self.assertEqual(created.status_code, 201, created.text)
        folder = created.json()
        renamed = self.client.put("/api/folders/" + folder["id"], json={"name": "Spatial AI"})
        self.assertEqual(renamed.json()["name"], "Spatial AI")
        moved = self.client.put(self.base + "/folder", json={"folderId": folder["id"]})
        self.assertEqual(moved.json()["folderId"], folder["id"])
        another = self.client.post("/api/papers?folder_id=" + folder["id"],
            files={"file": ("second.pdf", sample_pdf(), "application/pdf")})
        self.assertEqual(another.status_code, 201, another.text)
        self.assertEqual(another.json()["folderId"], folder["id"])
        self.assertEqual(self.client.delete("/api/folders/" + folder["id"]).status_code, 204)
        self.assertIsNone(self.client.get(self.base).json()["folderId"])
        self.assertIsNone(self.client.get("/api/papers/" + another.json()["id"]).json()["folderId"])
        self.client.delete("/api/papers/" + another.json()["id"])

    def test_phrase_dedup_and_annotation_rectangles_persist(self):
        paragraph = self.client.get(self.base + "/paragraphs").json()[0]
        async def fake_generate(prompt, json_mode=False):
            return '{"meaning":"运动恢复结构","context":"论文中的三维重建术语"}'
        payload = {"word": "structure from motion", "page": 1,
                   "paragraphId": paragraph["id"], "sourceSentence": paragraph["text"]}
        with patch("app.main.generate", fake_generate):
            first = self.client.post(self.base + "/vocabulary", json=payload)
            second = self.client.post(self.base + "/vocabulary", json={**payload, "word": "Structure   From Motion"})
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(len(self.client.get(self.base + "/vocabulary").json()), 1)
        annotation = self.client.post(self.base + "/annotations", json={
            "paragraphId": paragraph["id"], "page": 1, "text": "World Models",
            "kind": "underline", "color": "green", "source": "en",
            "rects": [[.1, .2, .3, .22], [.1, .23, .18, .25]]})
        self.assertEqual(annotation.status_code, 201, annotation.text)
        saved = self.client.get(self.base + "/annotations").json()
        self.assertEqual(saved[0]["rects"], [[.1, .2, .3, .22], [.1, .23, .18, .25]])
        self.assertEqual(saved[0]["source"], "en")
        self.assertEqual(self.client.delete(self.base + "/annotations/" + saved[0]["id"]).status_code, 204)
        self.assertEqual(self.client.get(self.base + "/annotations").json(), [])

    def test_translate_and_explain_use_different_prompts(self):
        prompts = []
        async def fake_generate(prompt):
            prompts.append(prompt)
            return "回答"
        paragraph = self.client.get(self.base + "/paragraphs").json()[0]
        with patch("app.main.generate", fake_generate):
            for task in ("translate", "explain"):
                response = self.client.post(self.base + "/ask", json={
                    "question": "选中内容", "selectedText": "World Models",
                    "paragraphId": paragraph["id"], "task": task})
                self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("仅将选中文本忠实翻译", prompts[0])
        self.assertIn("本文中的作用", prompts[1])
        self.assertNotEqual(prompts[0], prompts[1])
        self.assertEqual(len(self.client.get(self.base + "/history").json()), 2)

    def test_question_includes_matching_distant_paragraph(self):
        first = self.client.get(self.base + "/paragraphs").json()[0]
        prompts = []
        async def fake_generate(prompt, json_mode=False):
            prompts.append(prompt)
            return json.dumps({"answer": "解释", "evidence": []})
        with patch("app.main.generate", fake_generate):
            response = self.client.post(self.base + "/ask", json={
                "question": "latent dynamics 是什么？", "paragraphId": first["id"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("latent dynamics model predicts future states", prompts[0].lower())


class MigrationAndParserTests(unittest.TestCase):
    def test_migration_keeps_existing_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "old.db"
            connection = sqlite3.connect(path)
            connection.execute("CREATE TABLE papers (id TEXT PRIMARY KEY, title TEXT)")
            connection.execute("CREATE TABLE annotations (id TEXT PRIMARY KEY, text TEXT)")
            connection.execute("CREATE TABLE paragraphs (id TEXT PRIMARY KEY, text TEXT)")
            connection.execute("CREATE TABLE notes (id TEXT PRIMARY KEY, content TEXT)")
            connection.execute("CREATE TABLE interactions (id TEXT PRIMARY KEY, answer TEXT)")
            connection.execute("CREATE TABLE quiz_questions (id TEXT PRIMARY KEY, prompt TEXT)")
            connection.execute("CREATE TABLE quiz_attempts (id TEXT PRIMARY KEY, score REAL)")
            connection.execute("INSERT INTO papers VALUES ('existing', 'Keep me')")
            connection.execute("INSERT INTO annotations VALUES ('mark', 'saved text')")
            connection.execute("INSERT INTO paragraphs VALUES ('paragraph', 'original')")
            connection.execute("INSERT INTO notes VALUES ('note', 'keep note')")
            connection.execute("INSERT INTO interactions VALUES ('answer', 'keep answer')")
            connection.execute("INSERT INTO quiz_questions VALUES ('quiz', 'keep question')")
            connection.execute("INSERT INTO quiz_attempts VALUES ('attempt', 1.0)")
            connection.commit()
            connection.close()
            engine = create_engine("sqlite:///" + str(path))
            with patch("app.database.engine", engine):
                migrate_existing_database()
                migrate_existing_database()
            connection = sqlite3.connect(path)
            self.assertEqual(connection.execute("SELECT title, folder_id FROM papers").fetchone(), ("Keep me", None))
            self.assertEqual(connection.execute("SELECT text, source, rects_json FROM annotations").fetchone(),
                             ("saved text", "en", None))
            self.assertEqual(connection.execute("SELECT text, line_boxes_json FROM paragraphs").fetchone(),
                             ("original", None))
            self.assertEqual(connection.execute("SELECT content, text_anchor, rects_json FROM notes").fetchone(),
                             ("keep note", "", None))
            self.assertEqual(connection.execute("SELECT answer, evidence_json FROM interactions").fetchone(),
                             ("keep answer", None))
            self.assertEqual(connection.execute("SELECT prompt, status FROM quiz_questions").fetchone(),
                             ("keep question", "needs_review"))
            self.assertEqual(connection.execute("SELECT score, grading_version FROM quiz_attempts").fetchone(),
                             (1.0, 1))
            connection.close()
            engine.dispose()

    def test_two_column_order_and_soft_hyphen_cleanup(self):
        def block(text, x0, y0, x1):
            return {"text": text, "x0": x0, "y0": y0, "x1": x1, "y1": y0 + 10}
        blocks = [block("title", 20, 10, 580), block("right 1", 330, 60, 550),
                  block("left 2", 40, 90, 260), block("left 1", 40, 60, 260),
                  block("right 2", 330, 90, 550)]
        self.assertEqual([item["text"] for item in reading_order(blocks, 600)],
                         ["title", "left 1", "left 2", "right 1", "right 2"])
        lines = [{"spans": [{"text": "repre-"}]}, {"spans": [{"text": "sentation and feed-forward"}]}]
        self.assertEqual(clean_lines(lines), "representation and feed-forward")
        compound = [{"spans": [{"text": "feed-"}]}, {"spans": [{"text": "forward network"}]}]
        self.assertEqual(clean_lines(compound), "feed-forward network")
