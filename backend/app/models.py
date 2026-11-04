from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def now():
    return datetime.now(timezone.utc)


class Paper(Base):
    __tablename__ = "papers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    filename: Mapped[str] = mapped_column(String(500))
    folder_id: Mapped[str | None] = mapped_column(ForeignKey("folders.id", ondelete="SET NULL"), nullable=True, index=True)
    pages: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Folder(Base):
    __tablename__ = "folders"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Paragraph(Base):
    __tablename__ = "paragraphs"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    page: Mapped[int] = mapped_column(Integer)
    order: Mapped[int] = mapped_column(Integer)
    section_id: Mapped[str] = mapped_column(String(80))
    text: Mapped[str] = mapped_column(Text)
    x0: Mapped[float] = mapped_column(Float)
    y0: Mapped[float] = mapped_column(Float)
    x1: Mapped[float] = mapped_column(Float)
    y1: Mapped[float] = mapped_column(Float)
    kind: Mapped[str] = mapped_column(String(20), default="body")
    line_boxes_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    column_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quality_status: Mapped[str] = mapped_column(String(20), default="needs_review")


class DocumentElement(Base):
    __tablename__ = "document_elements"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    page: Mapped[int] = mapped_column(Integer)
    reading_order_index: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20))
    bbox_json: Mapped[str] = mapped_column(Text)
    caption: Mapped[str] = mapped_column(Text, default="")
    raw_text: Mapped[str] = mapped_column(Text, default="")
    content_json: Mapped[str] = mapped_column(Text, default="{}")
    extraction_status: Mapped[str] = mapped_column(String(20), default="needs_review")


class ElementExplanation(Base):
    __tablename__ = "element_explanations"
    cache_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    paper_id: Mapped[str] = mapped_column(String(36), index=True)
    element_id: Mapped[str] = mapped_column(String(100), index=True)
    mode: Mapped[str] = mapped_column(String(12))
    model_name: Mapped[str] = mapped_column(String(100))
    answer: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Translation(Base):
    __tablename__ = "translations"
    paragraph_id: Mapped[str] = mapped_column(ForeignKey("paragraphs.id", ondelete="CASCADE"), primary_key=True)
    text: Mapped[str] = mapped_column(Text)


class SpeechText(Base):
    __tablename__ = "speech_texts"
    __table_args__ = (UniqueConstraint("paragraph_id", "language"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    paragraph_id: Mapped[str] = mapped_column(ForeignKey("paragraphs.id", ondelete="CASCADE"), index=True)
    language: Mapped[str] = mapped_column(String(2))
    text: Mapped[str] = mapped_column(Text)


class Annotation(Base):
    __tablename__ = "annotations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    paragraph_id: Mapped[str | None] = mapped_column(ForeignKey("paragraphs.id", ondelete="SET NULL"), nullable=True)
    page: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(20), default="yellow")
    kind: Mapped[str] = mapped_column(String(20), default="highlight")
    rects_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(2), default="en")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Note(Base):
    __tablename__ = "notes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    paragraph_id: Mapped[str | None] = mapped_column(ForeignKey("paragraphs.id", ondelete="SET NULL"), nullable=True)
    page: Mapped[int] = mapped_column(Integer)
    selected_text: Mapped[str] = mapped_column(Text, default="")
    text_anchor: Mapped[str] = mapped_column(Text, default="")
    rects_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Interaction(Base):
    __tablename__ = "interactions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    paragraph_id: Mapped[str | None] = mapped_column(ForeignKey("paragraphs.id", ondelete="SET NULL"), nullable=True)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    evidence_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_anchor_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_mode: Mapped[str] = mapped_column(String(10), default="text")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ReadingProgress(Base):
    __tablename__ = "reading_progress"
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), primary_key=True)
    page: Mapped[int] = mapped_column(Integer, default=1)
    mode: Mapped[str] = mapped_column(String(20), default="dual")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AudioProgress(Base):
    __tablename__ = "audio_progress"
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), primary_key=True)
    paragraph_id: Mapped[str] = mapped_column(String(80))
    section_id: Mapped[str] = mapped_column(String(80))
    char_index: Mapped[int] = mapped_column(Integer, default=0)
    language: Mapped[str] = mapped_column(String(2), default="en")
    speed: Mapped[float] = mapped_column(Float, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Vocabulary(Base):
    __tablename__ = "vocabulary"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    paragraph_id: Mapped[str | None] = mapped_column(ForeignKey("paragraphs.id", ondelete="SET NULL"), nullable=True)
    page: Mapped[int] = mapped_column(Integer)
    word: Mapped[str] = mapped_column(String(200))
    meaning: Mapped[str] = mapped_column(Text)
    context: Mapped[str] = mapped_column(Text, default="")
    source_sentence: Mapped[str] = mapped_column(Text, default="")
    review_status: Mapped[str] = mapped_column(String(20), default="new")
    interval_days: Mapped[int] = mapped_column(Integer, default=0)
    next_review_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    prompt: Mapped[str] = mapped_column(Text)
    options_json: Mapped[str] = mapped_column(Text, default="[]")
    reference_answer: Mapped[str] = mapped_column(Text)
    correct_option_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    explanation_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_paragraph_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="ready")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    question_id: Mapped[str] = mapped_column(ForeignKey("quiz_questions.id", ondelete="CASCADE"), index=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    answer: Mapped[str] = mapped_column(Text)
    score: Mapped[float] = mapped_column(Float)
    feedback: Mapped[str] = mapped_column(Text)
    evaluation_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    grading_version: Mapped[int] = mapped_column(Integer, default=2)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class PaperSummary(Base):
    __tablename__ = "paper_summaries"
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), primary_key=True)
    content: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="draft")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SummaryReview(Base):
    __tablename__ = "summary_reviews"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    original_content: Mapped[str] = mapped_column(Text)
    result_json: Mapped[str] = mapped_column(Text)
    accepted: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
