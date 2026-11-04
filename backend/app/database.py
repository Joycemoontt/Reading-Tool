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
