import os
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATA_DIR = Path(os.getenv("PAPERMIND_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
engine = create_engine(f"sqlite:///{DATA_DIR / 'papermind.db'}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def migrate_existing_database():
    """Add nullable v2 columns without replacing existing tables or rows."""
    with engine.begin() as connection:
        tables = set(connection.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).scalars())
        if "papers" in tables:
            columns = {row[1] for row in connection.execute(text("PRAGMA table_info(papers)"))}
            if "folder_id" not in columns:
                connection.execute(text("ALTER TABLE papers ADD COLUMN folder_id VARCHAR(36)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_papers_folder_id ON papers(folder_id)"))
        if "annotations" in tables:
            columns = {row[1] for row in connection.execute(text("PRAGMA table_info(annotations)"))}
            if "rects_json" not in columns:
                connection.execute(text("ALTER TABLE annotations ADD COLUMN rects_json TEXT"))
            if "source" not in columns:
                connection.execute(text("ALTER TABLE annotations ADD COLUMN source VARCHAR(2) NOT NULL DEFAULT 'en'"))
        if "paragraphs" in tables:
            columns = {row[1] for row in connection.execute(text("PRAGMA table_info(paragraphs)"))}
            if "line_boxes_json" not in columns:
                connection.execute(text("ALTER TABLE paragraphs ADD COLUMN line_boxes_json TEXT"))
            if "column_index" not in columns:
                connection.execute(text("ALTER TABLE paragraphs ADD COLUMN column_index INTEGER"))
            if "quality_status" not in columns:
                connection.execute(text("ALTER TABLE paragraphs ADD COLUMN quality_status VARCHAR(20) NOT NULL DEFAULT 'needs_review'"))
        additions = {
            "notes": {"text_anchor": "TEXT NOT NULL DEFAULT ''", "rects_json": "TEXT", "updated_at": "DATETIME"},
            "interactions": {"evidence_json": "TEXT"},
            "quiz_questions": {"correct_option_id": "VARCHAR(36)", "explanation_json": "TEXT",
                               "evidence_paragraph_id": "VARCHAR(80)", "status": "VARCHAR(20) NOT NULL DEFAULT 'needs_review'"},
            "quiz_attempts": {"evaluation_json": "TEXT", "grading_version": "INTEGER NOT NULL DEFAULT 1"},
        }
        for table, fields in additions.items():
            if table not in tables:
                continue
            columns = {row[1] for row in connection.execute(text(f"PRAGMA table_info({table})"))}
            for column, definition in fields.items():
                if column not in columns:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))
