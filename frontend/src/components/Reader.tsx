"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Headphones, Highlighter, Languages, MessageCircle, Mic, MoreHorizontal, Pause, Play, Search, Send, Settings2, Square, StickyNote, Trash2, Underline, Volume2, X, ZoomIn, ZoomOut } from "lucide-react";
import { API, Annotation, DocumentElement, Evidence, Interaction, json, Note, Paper, PaperSummary, Paragraph, request, SelectionReference, SourceAnchor, Vocabulary, QuizQuestion } from "@/lib/api";
import { ReadingParagraph, ReadingScope, ReadingSession, ReadingSnapshot, SPEEDS } from "@/lib/audio-core";
import { attachMediaSession, BrowserSpeechProvider, BrowserVoiceInput, speechRecognitionAvailable } from "@/lib/browser-speech";
import type { PdfTarget, SelectionGeometry } from "./PdfViewer";
import FormattedAnswer from "./FormattedAnswer";
import MathMarkdownRenderer from "./MathMarkdownRenderer";
import { groupParagraphsByPage, isPageMarker, nearestParagraph, normalizeTerm, searchParagraphs } from "@/lib/reader-utils";

const PdfViewer = dynamic(() => import("./PdfViewer"), { ssr: false });
type Tab = "ai" | "notes" | "vocabulary" | "history" | "quiz" | "summary";

function translatedText(paragraph: Paragraph, annotations: Annotation[]) {
  const text = paragraph.translation || "";
  const marks = annotations.filter(a => a.source === "zh" && a.paragraphId === paragraph.id)
    .map(a => ({ annotation: a, start: text.indexOf(a.text) })).filter(item => item.start >= 0)
    .sort((a, b) => a.start - b.start);
  const pieces: React.ReactNode[] = [];
  let offset = 0;
  for (const { annotation, start } of marks) {
    if (start < offset) continue;
    pieces.push(text.slice(offset, start));
    pieces.push(<mark key={annotation.id} className={`translated-mark ${annotation.kind} color-${annotation.color}`}>{annotation.text}</mark>);
    offset = start + annotation.text.length;
  }
  pieces.push(text.slice(offset));
  return pieces;
}

export default function Reader({ paperId }: { paperId: string }) {
  const [paper, setPaper] = useState<Paper | null>(null);
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
  const [elements, setElements] = useState<DocumentElement[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [reparsing, setReparsing] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [history, setHistory] = useState<Interaction[]>([]);
  const [vocabulary, setVocabulary] = useState<Vocabulary[]>([]);
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [summary, setSummary] = useState<PaperSummary | null>(null);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<Paper["mode"]>("dual");
  const [zoom, setZoom] = useState(1);
  const [sidebar, setSidebar] = useState(false);
  const [tab, setTab] = useState<Tab>("ai");
  const [audioOpen, setAudioOpen] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const [simplifyCitations, setSimplifyCitations] = useState(true);
  const [selected, setSelected] = useState("");
  const [activeReference, setActiveReference] = useState<SelectionReference | null>(null);
  const [formulaFocus, setFormulaFocus] = useState<{ elementId: string; mode: "brief" | "deep" } | null>(null);
  const [formulaReplies, setFormulaReplies] = useState<Record<string, string>>({});
  const [formulaBusy, setFormulaBusy] = useState(false);
  const [previewElementId, setPreviewElementId] = useState<string | null>(null);
  const [selectionSource, setSelectionSource] = useState<"en" | "zh">("en");
  const [selectionRects, setSelectionRects] = useState<number[][]>([]);
  const [selectionPage, setSelectionPage] = useState(1);
  const [selectionPosition, setSelectionPosition] = useState<{ left: number; top: number } | null>(null);
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(null);
  const [targetParagraph, setTargetParagraph] = useState<PdfTarget | null>(null);
  const [splitRatio, setSplitRatio] = useState(55);
  const [assistantWidth, setAssistantWidth] = useState(340);
  const [annotationColor, setAnnotationColor] = useState("yellow");
  const [question, setQuestion] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteContext, setNoteContext] = useState<{ paragraphId: string | null; page: number; selectedText: string; textAnchor: string; rects: number[][] } | null>(null);
  const [voiceInterim, setVoiceInterim] = useState("");
  const [voiceLang, setVoiceLang] = useState<"zh-CN" | "en-US">("zh-CN");
  const [recording, setRecording] = useState(false);
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");
  const [busy, setBusy] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState(0);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [failedAsk, setFailedAsk] = useState<{ question: string; task: "ask" | "translate" | "explain"; reference: SelectionReference | null } | null>(null);
  const [voices, setVoices] = useState<{ id: string; name: string; lang: string }[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [snapshot, setSnapshot] = useState<ReadingSnapshot>({ status: "idle", paragraphId: null, index: 0, total: 0, charIndex: 0, language: "en", speed: 1, error: null });
  const [pdfWidth, setPdfWidth] = useState(0);
  const pdfContainer = useRef<HTMLDivElement>(null);
  const selectionContext = useRef<{ page: number; paragraphs: Paragraph[] }>({ page, paragraphs });
  selectionContext.current = { page, paragraphs };
  const translationContainer = useRef<HTMLDivElement>(null);
  const progressWrite = useRef<Promise<void>>(Promise.resolve());
  const summaryWrite = useRef<Promise<void>>(Promise.resolve());
  const summarySaved = useRef("");
  const summaryLatest = useRef("");
  summaryLatest.current = summaryDraft;
  const chatBody = useRef<HTMLDivElement>(null);
  const questionInput = useRef<HTMLTextAreaElement>(null);
  const askAbort = useRef<AbortController | null>(null);
  const askRequestId = useRef(0);
  const formulaAbort = useRef<AbortController | null>(null);
  const formulaRequestId = useRef(0);
  const recognition = useRef<BrowserVoiceInput | null>(null);
  const provider = useMemo(() => new BrowserSpeechProvider(), []);
  const session = useMemo(() => new ReadingSession(paperId, provider, {
    load: id => request(`/api/papers/${id}/audio-progress`),
    save: async position => {
      await request(`/api/papers/${position.paperId}/audio-progress`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(position),
      });
    },
  }), [paperId, provider]);

  const refresh = useCallback(async () => {
    const [p, ps, es, as, ns, hs, vs, qs, sm] = await Promise.all([
      request<Paper>(`/api/papers/${paperId}`), request<Paragraph[]>(`/api/papers/${paperId}/paragraphs`),
      request<DocumentElement[]>(`/api/papers/${paperId}/elements`),
      request<Annotation[]>(`/api/papers/${paperId}/annotations`), request<Note[]>(`/api/papers/${paperId}/notes`),
      request<Interaction[]>(`/api/papers/${paperId}/history`),
      request<Vocabulary[]>(`/api/papers/${paperId}/vocabulary`),
      request<QuizQuestion[]>(`/api/papers/${paperId}/quiz`),
      request<PaperSummary>(`/api/papers/${paperId}/summary`),
    ]);
    setPaper(p); setParagraphs(ps); setElements(es); setAnnotations(as); setNotes(ns); setHistory(hs); setVocabulary(vs); setQuiz(qs);
    setSummary(sm); setSummaryDraft(sm.content); summarySaved.current = sm.content;
    setPage(p.page); setMode(p.mode);
  }, [paperId]);

  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [refresh]);
  useEffect(() => {
    const container = translationContainer.current;
    if (!container) return;
    const match = selectedParagraphId && paragraphs.find(p => p.id === selectedParagraphId && p.page === page);
    const node = match && container.querySelector(`[data-para="${CSS.escape(match.id)}"]`);
    if (node) node.scrollIntoView({ block: "center", behavior: "smooth" });
    else container.scrollTo({ top: 0 });
  }, [page, mode, selectedParagraphId, paragraphs]);
  useEffect(() => {
    if (!summary || summaryDraft === summarySaved.current) return;
    const timeout = window.setTimeout(() => { void saveSummaryNow(summaryLatest.current).catch(e => setError((e as Error).message)); }, 700);
    return () => window.clearTimeout(timeout);
  }, [summaryDraft, summary]);
  useEffect(() => {
    chatBody.current?.scrollTo({ top: chatBody.current.scrollHeight, behavior: "smooth" });
  }, [answer, history.length, busy, sidebar, tab]);
  useEffect(() => {
    if (!targetParagraph) return;
    const timeout = window.setTimeout(() => setTargetParagraph(value => value?.id === targetParagraph.id ? null : value), 3500);
    return () => window.clearTimeout(timeout);
  }, [targetParagraph]);
  useEffect(() => session.subscribe(setSnapshot), [session]);
  useEffect(() => {
    recognition.current = new BrowserVoiceInput();
    const unsubscribeVoices = provider.onVoicesChanged(() => setVoices(provider.voices()));
    const detachMedia = attachMediaSession({ play: () => session.play(), pause: () => session.pause(),
      previous: () => session.previous(), next: () => session.next(), stop: () => session.stop() });
    return () => { recognition.current?.dispose(); askAbort.current?.abort(); formulaAbort.current?.abort(); session.stop(); detachMedia(); unsubscribeVoices(); };
  }, [provider, session]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = snapshot.status === "playing" ? "playing" : snapshot.status === "paused" ? "paused" : "none";
    if (paper && typeof MediaMetadata !== "undefined") navigator.mediaSession.metadata = new MediaMetadata({ title: paper.title, artist: "PaperMind", album: "AI 朗读" });
  }, [snapshot.status, paper]);

  useEffect(() => {
    if (!autoFollow || snapshot.status !== "playing" || !snapshot.paragraphId) return;
    const current = paragraphs.find(p => p.id === snapshot.paragraphId);
    if (!current) return;
    if (current.page !== page) {
      setPage(current.page);
      void request(`/api/papers/${paperId}/progress`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page: current.page, mode }) }).catch(() => {});
    }
    translationContainer.current?.querySelector(`[data-para="${CSS.escape(current.id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [snapshot.paragraphId, snapshot.status, paragraphs, autoFollow, page, paperId, mode]);

  useEffect(() => {
    if (!pdfContainer.current) return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width || 720;
      setPdfWidth(Math.max(300, Math.min(920, width - 40)) * zoom);
    });
    observer.observe(pdfContainer.current);
    return () => observer.disconnect();
  }, [zoom, mode, sidebar, paper?.id]);

  function persistProgress(nextPage: number, nextMode: Paper["mode"]) {
    progressWrite.current = progressWrite.current.catch(() => {}).then(async () => {
      await request(`/api/papers/${paperId}/progress`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: nextPage, mode: nextMode }),
      });
    }).catch(e => setError(e.message));
  }
  function changePage(next: number) {
    if (!paper) return;
    const safe = Math.max(1, Math.min(paper.pages, next)); setPage(safe); setSelectedParagraphId(null); setSelectedElementId(null); persistProgress(safe, mode);
  }
  function changeMode(next: Paper["mode"]) { setMode(next); persistProgress(page, next); }

  const onPdfSelection = useCallback((value: SelectionGeometry) => {
    setSelected(value.text); setSelectionSource("en"); setSelectionRects(value.rects);
    const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
    if (rect) setSelectionPosition({ left: Math.min(window.innerWidth - 220, Math.max(12, rect.left)), top: Math.min(window.innerHeight - 64, rect.bottom + 10) });
    const { page, paragraphs } = selectionContext.current;
    setSelectionPage(page);
    const normalized = value.text.replace(/\s+/g, " ").slice(0, 60).toLowerCase();
    const match = paragraphs.find(p => p.page === page && p.text.toLowerCase().includes(normalized));
    const nearest = value.pdfPoint && nearestParagraph(paragraphs, page, value.pdfPoint[0], value.pdfPoint[1]);
    setSelectedParagraphId(match?.id || nearest?.id || null);
  }, []);

  const onPdfClick = useCallback((x: number, y: number) => {
    const { page, paragraphs } = selectionContext.current;
    const element = elements.filter(item => item.page === page && x >= item.bbox[0] && x <= item.bbox[2]
      && y >= item.bbox[1] && y <= item.bbox[3]).sort((a, b) =>
      (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) - (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]))[0];
    setSelectedElementId(element?.id || null);
    const nearest = nearestParagraph(paragraphs, page, x, y);
    if (!nearest) return;
    setSelectedParagraphId(nearest.id);
    translationContainer.current?.querySelector(`[data-para="${CSS.escape(nearest.id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [elements]);

  function onTranslationSelection(event: React.MouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-para]");
    const paragraph = paragraphs.find(p => p.id === element?.dataset.para);
    if (!paragraph) return;
    const rect = selection?.getRangeAt(0).getBoundingClientRect();
    setSelected(text); setSelectionSource("zh"); setSelectionRects([]);
    setSelectionPage(paragraph.page); setSelectedParagraphId(paragraph.id);
    if (rect) setSelectionPosition({ left: Math.min(window.innerWidth - 220, Math.max(12, rect.left)), top: Math.min(window.innerHeight - 64, rect.bottom + 10) });
  }

  function locateParagraph(paragraph: Paragraph) {
    if (window.getSelection()?.toString().trim()) return;
    changePage(paragraph.page);
    setSelectedParagraphId(paragraph.id);
    setTargetParagraph({ id: `${paragraph.id}-${Date.now()}`, bbox: paragraph.bbox, kind: "paragraph",
      boxes: paragraph.boxes?.length ? paragraph.boxes : [paragraph.bbox] });
  }

  function locateElement(element: DocumentElement) {
    changePage(element.page);
    setTargetParagraph({ id: `${element.id}-${Date.now()}`, bbox: element.bbox,
      boxes: [element.bbox], kind: "paragraph" });
  }

  function selectionReference(): SelectionReference | null {
    if (!selected.trim()) return null;
    return { paragraphId: selectedParagraphId, elementId: null, page: selectionPage,
      sourceLanguage: selectionSource, selectedText: selected.trim(),
      rects: selectionSource === "en" ? selectionRects : [] };
  }

  function confirmSelectionForAsk() {
    const reference = selectionReference();
    if (!reference) { setError("无法定位当前选区，请重新选中文字"); return; }
    askAbort.current?.abort(); askRequestId.current++; setBusy(false);
    formulaAbort.current?.abort();
    setActiveReference(reference); setFormulaFocus(null); setSelected("");
    window.getSelection()?.removeAllRanges();
    setSidebar(true); setTab("ai"); setError("");
    requestAnimationFrame(() => questionInput.current?.focus());
  }

  function locateReference(reference: SourceAnchor) {
    if (reference.elementId) {
      const element = elements.find(item => item.id === reference.elementId);
      if (element) { locateElement(element); return; }
    }
    const paragraph = paragraphs.find(item => item.id === reference.paragraphId);
    if (paragraph) {
      changePage(paragraph.page);
      setSelectedParagraphId(paragraph.id);
      setTargetParagraph({ id: `${paragraph.id}-${Date.now()}`, bbox: paragraph.bbox,
        boxes: paragraph.boxes?.length ? paragraph.boxes : [paragraph.bbox],
        rects: reference.alignment === "exact" && reference.sourceLanguage === "en" ? reference.rects : undefined,
        kind: "paragraph" });
    } else if (reference.page) {
      changePage(reference.page);
      setError("已回到原页；旧引用缺少可核对的精确锚点。");
    }
  }

  async function reparsePaper() {
    setReparsing(true); setError("");
    try {
      await request(`/api/papers/${paperId}/reparse`, { method: "POST" });
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setReparsing(false); }
  }

  async function explainElement(element: DocumentElement) {
    setBusy(true); setError(""); setSidebar(true); setTab("ai"); session.pause();
    try {
      const result = await request<{ answer: string; reference: SourceAnchor }>(`/api/papers/${paperId}/elements/${encodeURIComponent(element.id)}/explain?mode=deep`, { method: "POST" });
      setActiveReference({ paragraphId: result.reference.paragraphId, elementId: element.id, page: element.page,
        sourceLanguage: "en", selectedText: "", rects: [] });
      setFormulaFocus(null);
      setAnswer(result.answer);
      setHistory(await request(`/api/papers/${paperId}/history`));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function openFormula(element: DocumentElement, mode: "brief" | "deep" = "brief") {
    formulaAbort.current?.abort();
    const requestId = ++formulaRequestId.current;
    setFormulaFocus({ elementId: element.id, mode }); setSidebar(true); setTab("ai");
    setActiveReference({ paragraphId: element.content.paragraphId || null, elementId: element.id,
      page: element.page, sourceLanguage: "en", selectedText: "", rects: [] });
    setSelected(""); setError(""); session.pause();
    const key = `${element.id}:${mode}`;
    if (formulaReplies[key]) { setFormulaBusy(false); return; }
    const controller = new AbortController();
    formulaAbort.current = controller;
    setFormulaBusy(true);
    try {
      const result = await request<{ answer: string }>(`/api/papers/${paperId}/elements/${encodeURIComponent(element.id)}/explain?mode=${mode}`,
        { method: "POST", signal: controller.signal });
      if (formulaRequestId.current !== requestId || controller.signal.aborted) return;
      setFormulaReplies(previous => ({ ...previous, [key]: result.answer }));
      if (mode === "deep") setHistory(await request(`/api/papers/${paperId}/history`));
    } catch (e) {
      if (!controller.signal.aborted && formulaRequestId.current === requestId) setError((e as Error).message);
    } finally {
      if (formulaRequestId.current === requestId) setFormulaBusy(false);
    }
  }

  function cancelFormula() {
    formulaRequestId.current++;
    formulaAbort.current?.abort();
    setFormulaBusy(false);
  }

  function locateEvidence(evidence: { paragraphId?: string | null; page: number; quote?: string; rects?: number[][]; occurrence?: number }, kind: "note" | "search" | "paragraph" = "paragraph") {
    const match = paragraphs.find(p => p.id === evidence.paragraphId) ||
      paragraphs.find(p => p.page === evidence.page && evidence.quote && p.text.toLocaleLowerCase().includes(evidence.quote.toLocaleLowerCase()));
    changePage(match?.page || evidence.page);
    if (!match) { setTargetParagraph(null); setError("已跳转到原页，但旧记录缺少可精确匹配的原文位置。"); return; }
    setSelectedParagraphId(match.id);
    setTargetParagraph({ id: `${match.id}-${Date.now()}`, bbox: match.bbox, boxes: match.boxes?.length ? match.boxes : [match.bbox],
      rects: evidence.rects?.length ? evidence.rects : undefined, text: evidence.quote, occurrence: evidence.occurrence, kind });
    translationContainer.current?.querySelector(`[data-para="${CSS.escape(match.id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  const searchHits = useMemo(() => searchParagraphs(paragraphs, searchQuery), [paragraphs, searchQuery]);
  function goToSearch(index: number) {
    if (!searchHits.length) return;
    const next = (index + searchHits.length) % searchHits.length;
    setSearchIndex(next);
    const hit = searchHits[next];
    locateEvidence({ paragraphId: hit.paragraphId, page: hit.page,
      quote: hit.source === "en" ? hit.query : undefined, occurrence: hit.occurrence }, "search");
  }

  function beginResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const move = (pointer: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      setSplitRatio(Math.max(35, Math.min(70, (pointer.clientX - rect.left) / rect.width * 100)));
    };
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function beginSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const move = (pointer: PointerEvent) => setAssistantWidth(Math.max(290, Math.min(500, window.innerWidth - pointer.clientX)));
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  async function startAudio(scope: ReadingScope, anchor?: string) {
    setError("");
    const queue: ReadingParagraph[] = paragraphs.filter(p => !isPageMarker(p.text)).map(p => ({ id: p.id, sectionId: p.sectionId, page: p.page,
      sourceText: p.text, translatedText: p.translation, sourceSpeechText: p.speech.en, translatedSpeechText: p.speech.zh }));
    await session.load(queue, scope, anchor);
    session.play();
    setAudioOpen(true);
  }

  async function translate() {
    setTranslating(true); setError("");
    try {
      let remaining = paragraphs.filter(p => p.kind !== "table" && !p.translation).length;
      while (remaining > 0) {
        const result = await request<{ translated: number; remaining: number }>(`/api/papers/${paperId}/translate?limit=8`, { method: "POST" });
        remaining = result.remaining;
        const updated = await request<Paragraph[]>(`/api/papers/${paperId}/paragraphs`);
        setParagraphs(updated);
        setTranslationProgress(updated.filter(p => p.kind !== "table").length - remaining);
      }
    }
    catch (e) { setError((e as Error).message); }
    finally { setTranslating(false); }
  }

  async function prepareSpeech(paragraph: Paragraph) {
    try {
      const result = await request<{ text: string }>(`/api/papers/${paperId}/paragraphs/${encodeURIComponent(paragraph.id)}/speech?language=${snapshot.language}`, { method: "POST" });
      setParagraphs(items => items.map(p => p.id === paragraph.id ? { ...p, speech: { ...p.speech, [snapshot.language]: result.text } } : p));
      setError("公式朗读说明已缓存。重新选择朗读范围后生效。");
    } catch (e) { setError((e as Error).message); }
  }

  async function addAnnotation(kind: "highlight" | "underline") {
    if (!selected) return;
    try {
      await request(`/api/papers/${paperId}/annotations`, json({ paragraphId: selectedParagraphId, page: selectionPage,
        text: selected, color: annotationColor, kind, source: selectionSource, rects: selectionSource === "en" ? selectionRects : [] }));
      setAnnotations(await request(`/api/papers/${paperId}/annotations`)); setSelected(""); window.getSelection()?.removeAllRanges();
    } catch (e) { setError((e as Error).message); }
  }

  function addNote() {
    setNoteContext({ paragraphId: selectedParagraphId, page: selectionPage, selectedText: selected,
      textAnchor: selected, rects: selectionSource === "en" ? selectionRects : [] });
    setNoteDraft(""); setNoteEditingId(null); setSidebar(true); setTab("notes"); setSelected("");
  }

  async function saveNote() {
    if (!noteDraft.trim() || !noteContext) return;
    try {
      const path = `/api/papers/${paperId}/notes` + (noteEditingId ? "/" + noteEditingId : "");
      await request(path, noteEditingId
        ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...noteContext, content: noteDraft.trim() }) }
        : json({ ...noteContext, content: noteDraft.trim() }));
      setNotes(await request(`/api/papers/${paperId}/notes`)); setNoteContext(null); setNoteDraft(""); setNoteEditingId(null);
    }
    catch (e) { setError((e as Error).message); }
  }

  function editNote(note: Note) {
    setNoteContext({ paragraphId: note.paragraphId, page: note.page, selectedText: note.selectedText,
      textAnchor: note.textAnchor, rects: note.rects });
    setNoteEditingId(note.id); setNoteDraft(note.content);
  }

  function findText() {
    if (searchHits.length) goToSearch(searchIndex);
    else if (searchQuery.trim()) setError("全文和已有译文中没有匹配结果；未翻译的段落无法进行中文搜索。");
  }

  async function saveWord() {
    const word = normalizeTerm(selected);
    if (!word || word.length > 200) { setError("请选择不超过 200 个字符的英文词汇或短语"); return; }
    setBusy(true); setError("");
    try {
      const sourceSentence = paragraphs.find(p => p.id === selectedParagraphId)?.text || "";
      await request(`/api/papers/${paperId}/vocabulary`, json({ word, paragraphId: selectedParagraphId, page: selectionPage, sourceSentence }));
      setVocabulary(await request(`/api/papers/${paperId}/vocabulary`));
      setSidebar(true); setTab("vocabulary"); setSelected("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function reviewWord(id: string, rating: string) {
    try {
      await request(`/api/papers/${paperId}/vocabulary/${id}/review`, json({ rating }));
      setVocabulary(await request(`/api/papers/${paperId}/vocabulary`));
    } catch (e) { setError((e as Error).message); }
  }

  async function generateQuiz() {
    setBusy(true); setError("");
    try {
      await request(`/api/papers/${paperId}/quiz/generate`, { method: "POST" });
      setQuiz(await request(`/api/papers/${paperId}/quiz`));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function submitQuiz(questionId: string) {
    const answer = quizAnswers[questionId]?.trim();
    if (!answer) return;
    setBusy(true); setError("");
    try {
      await request(`/api/papers/${paperId}/quiz/${questionId}/answer`, json({ answer }));
      setQuiz(await request(`/api/papers/${paperId}/quiz`));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function saveSummaryNow(content: string): Promise<void> {
    if (content === summarySaved.current) return summaryWrite.current;
    summaryWrite.current = summaryWrite.current.catch(() => {}).then(async () => {
      const saved = await request<PaperSummary>(`/api/papers/${paperId}/summary`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
      });
      summarySaved.current = content;
      setSummary(previous => ({ ...saved, reviews: previous?.reviews || [] }));
    });
    return summaryWrite.current;
  }

  async function reviewSummary(action: "check" | "polish") {
    if (!summaryDraft.trim()) return;
    setSummaryBusy(true); setError("");
    try {
      await saveSummaryNow(summaryLatest.current);
      const review = await request<PaperSummary["reviews"][number]>(`/api/papers/${paperId}/summary/${action}`, { method: "POST" });
      setSummary(previous => previous ? { ...previous, status: action === "check" ? "feedback" : previous.status,
        reviews: [review, ...previous.reviews].slice(0, 10) } : previous);
    } catch (e) { setError((e as Error).message); }
    finally { setSummaryBusy(false); }
  }

  async function acceptPolish(reviewId: string) {
    setSummaryBusy(true); setError("");
    try {
      const saved = await request<PaperSummary>(`/api/papers/${paperId}/summary/polish/${reviewId}/accept`, { method: "POST" });
      summarySaved.current = saved.content;
      setSummaryDraft(saved.content);
      setSummary(previous => ({ ...saved, reviews: (previous?.reviews || []).map(item => item.id === reviewId ? { ...item, accepted: true } : item) }));
    } catch (e) { setError((e as Error).message); }
    finally { setSummaryBusy(false); }
  }

  function evidenceLinks(items: Evidence[] | undefined) {
    return items?.length ? <div className="evidence-links"><strong>论文依据</strong>{items.map((item, index) =>
      <button key={`${item.paragraphId}-${index}`} onClick={() => locateEvidence(item)} title={item.quote}>
        第 {item.page} 页 · {item.quote.slice(0, 80)}
      </button>)}</div> : null;
  }

  function toggleMic() {
    if (recording) { recognition.current?.stop(); return; }
    if (!speechRecognitionAvailable()) { setError("此浏览器不支持语音识别，请使用文字输入"); return; }
    session.pause();
    setSidebar(true); setTab("ai"); setVoiceInterim(""); setError(""); setInputMode("voice");
    const started = recognition.current?.start(voiceLang, result => {
      if (result.isFinal) { setQuestion(previous => [previous, result.transcript].filter(Boolean).join(" ")); setVoiceInterim(""); }
      else setVoiceInterim(result.transcript);
    }, setError, () => setRecording(false));
    if (started) setRecording(true);
  }

  function cancelAsk() {
    askRequestId.current++;
    askAbort.current?.abort();
    setBusy(false);
  }

  async function ask(override?: string, task: "ask" | "translate" | "explain" = "ask",
                     referenceOverride?: SelectionReference | null) {
    if (!(override || question).trim() || busy) return;
    const reference = referenceOverride !== undefined ? referenceOverride : selected ? selectionReference() : activeReference;
    const contextId = reference ? reference.paragraphId : snapshot.paragraphId || selectedParagraphId || null;
    const asked = (override || question).trim();
    askAbort.current?.abort();
    const controller = new AbortController();
    const requestId = ++askRequestId.current;
    askAbort.current = controller;
    setBusy(true); setError(""); setAnswer(""); setFailedAsk(null); session.pause();
    if (reference) setActiveReference(reference);
    setSelected(""); window.getSelection()?.removeAllRanges();
    try {
      const response = await request<{ answer: string }>(`/api/papers/${paperId}/ask`, { ...json({ question: asked,
        paragraphId: contextId, selectedText: reference?.selectedText || "", reference, inputMode, task }), signal: controller.signal });
      if (controller.signal.aborted || askRequestId.current !== requestId) return;
      setAnswer(response.answer);
      try { setHistory(await request(`/api/papers/${paperId}/history`)); }
      catch { setError("回答已保存，但历史暂时未刷新；重新打开论文即可查看。"); }
      if (askRequestId.current === requestId) { setQuestion(""); setInputMode("text"); }
    } catch (e) {
      if (!controller.signal.aborted && askRequestId.current === requestId) {
        setFailedAsk({ question: asked, task, reference });
        setError((e as Error).message);
      }
    } finally { if (askRequestId.current === requestId) setBusy(false); }
  }

  function speakAnswer(text: string) {
    session.stop();
    provider.speak(text, { language: /[\u3400-\u9fff]/.test(text) ? "zh" : "en", speed: 1,
      onError: setError });
  }

  const current = paragraphs.find(p => p.id === snapshot.paragraphId);
  const visibleParagraphs = useMemo(() => paragraphs.filter(p => p.kind !== "table" && !isPageMarker(p.text)), [paragraphs]);
  const pageGroups = useMemo(() => groupParagraphsByPage(visibleParagraphs), [visibleParagraphs]);
  const currentPageGroup = pageGroups.filter(([number]) => number === page);
  const translatedCount = visibleParagraphs.filter(p => p.translation).length;
  const selectedVoiceOptions = voices.filter(v => v.lang.toLowerCase().startsWith(snapshot.language));
  const selectedElement = elements.find(item => item.id === selectedElementId);
  const focusedFormula = elements.find(item => item.id === formulaFocus?.elementId);
  const previewElement = elements.find(item => item.id === previewElementId);

  function pageContent(pageNumber: number, group: Paragraph[]) {
    const pageElements = elements.filter(element => element.page === pageNumber);
    const withinTable = (paragraph: Paragraph) => pageElements.some(element => element.kind === "table" &&
      (paragraph.bbox[0] + paragraph.bbox[2]) / 2 >= element.bbox[0] &&
      (paragraph.bbox[0] + paragraph.bbox[2]) / 2 <= element.bbox[2] &&
      (paragraph.bbox[1] + paragraph.bbox[3]) / 2 >= element.bbox[1] &&
      (paragraph.bbox[1] + paragraph.bbox[3]) / 2 <= element.bbox[3]);
    const items: { order: number; paragraph?: Paragraph; element?: DocumentElement }[] = [
      ...group.filter(p => !withinTable(p)).map(paragraph => ({ order: paragraph.order, paragraph })),
      ...pageElements.map(element => ({ order: element.readingOrderIndex + .5, element })),
    ];
    return items.sort((a, b) => a.order - b.order).map(item => {
      const element = item.element;
      if (element) return <div className="science-element" key={element.id}>
        <div className="science-element-head"><strong>{element.kind === "table" ? "表格" : element.kind === "equation" ? "公式" : "图片"}</strong><span>第 {element.page} 页 · 需与原 PDF 核对</span></div>
        {element.caption && <p className="science-caption">{element.caption}</p>}
        {element.kind === "table" && <div className="science-table-scroll"><table><thead><tr>{element.content.columnHeaders?.map((cell, index) => <th key={index}>{cell}</th>)}</tr></thead><tbody>{element.content.rows?.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index}>{cell.originalValue}</td>)}</tr>)}</tbody></table></div>}
        <button className="science-image-button" onClick={() => setPreviewElementId(element.id)} title="放大原 PDF 区域"><img src={`${API}/api/papers/${paperId}/elements/${encodeURIComponent(element.id)}/image`} alt={`${element.kind} 原 PDF 裁剪图`}/></button>
        <div className="science-actions"><button onClick={() => locateElement(element)}>定位原文</button>{element.kind === "equation" ? <><button onClick={() => void openFormula(element, "brief")}>简明解释</button><button onClick={() => void openFormula(element, "deep")}>深入解释</button></> : <button disabled={busy} onClick={() => void explainElement(element)}>解释{element.kind === "table" ? "表格" : "图片"}</button>}</div>
      </div>;
      const p = item.paragraph!;
      return <div key={p.id} data-para={p.id} className={`translation-paragraph ${p.id === snapshot.paragraphId && snapshot.status === "playing" ? "speaking" : ""} ${p.kind === "heading" ? "is-heading" : ""}`} onClick={() => locateParagraph(p)}>
        <div className="para-actions">{/[=∑∫∂Σ]|\b(?:Eq\.|equation)\b/i.test(p.text) && <button title="生成并缓存公式口语说明" onClick={e => { e.stopPropagation(); void prepareSpeech(p); }}>∑</button>}<button title="从此段朗读" onClick={e => { e.stopPropagation(); void startAudio("full", p.id); }}><Play size={13}/></button></div>
        {mode === "paragraph" && <p className="original-text">{p.text}</p>}
        {p.translation ? annotations.some(a => a.source === "zh" && a.paragraphId === p.id)
          ? <p>{translatedText(p, annotations)}</p> : <MathMarkdownRenderer text={p.translation} className="translated-math"/>
          : <p><span className="untranslated">尚未翻译 · 点击顶部“全文翻译”</span></p>}
      </div>;
    });
  }

  if (!paper) return <div className="loading-screen"><div className="brand"><div className="brand-mark"><BookOpen size={19}/></div>PaperMind</div><p>{error || "正在打开论文…"}</p></div>;
  return <div className="reader-shell">
    <header className="reader-header"><Link href="/" className="back-button" title="返回文献库"><ArrowLeft size={19}/></Link><div className="reader-title"><span className="brand-small">PAPERMIND / READER</span><strong title={paper.title}>{paper.title}</strong></div><div className="header-actions">
      <div className="segmented"><button className={mode === "dual" ? "active" : ""} onClick={() => changeMode("dual")}>双栏</button><button className={mode === "paragraph" ? "active" : ""} onClick={() => changeMode("paragraph")}>段落</button><button className={mode === "original" ? "active" : ""} onClick={() => changeMode("original")}>原版</button></div>
      <button aria-label="全文翻译" className="toolbar-button" onClick={() => void translate()} disabled={translating}><Languages size={17}/><span>{translating ? `翻译中 ${translationProgress}/${paragraphs.length}` : "全文翻译"}</span></button>
      <button aria-label="AI 朗读" className={`toolbar-button ${audioOpen ? "is-selected" : ""}`} onClick={() => { setAudioOpen(!audioOpen); if (!audioOpen && !snapshot.total) void session.load(visibleParagraphs.map(p => ({ id: p.id, sectionId: p.sectionId, page: p.page, sourceText: p.text, translatedText: p.translation, sourceSpeechText: p.speech.en, translatedSpeechText: p.speech.zh })), "full"); }}><Headphones size={17}/><span>AI 朗读</span></button>
      <button aria-label="学习助手" className={`toolbar-button ${sidebar ? "is-selected" : ""}`} onClick={() => setSidebar(!sidebar)}><MessageCircle size={17}/><span>学习助手</span></button>
      <button aria-label="复习论文" className="toolbar-button" onClick={() => { setSidebar(true); setTab("quiz"); }}><BookOpen size={17}/><span>复习</span></button>
    </div></header>

    {error && <div className="reader-error"><span>{error}</span><button onClick={() => setError("")}><X size={15}/></button></div>}
    <div className="reader-main">
      <div className="reading-area"><div className="reading-toolbar"><div className="page-controls"><button onClick={() => changePage(page - 1)} disabled={page <= 1}><ChevronLeft size={18}/></button><span>第 <strong>{page}</strong> / {paper.pages} 页</span><button onClick={() => changePage(page + 1)} disabled={page >= paper.pages}><ChevronRight size={18}/></button></div><div className="reading-tools"><button title="缩小" onClick={() => setZoom(v => Math.max(.6, +(v - .1).toFixed(1)))}><ZoomOut size={17}/></button><span>{Math.round(zoom * 100)}%</span><button title="放大" onClick={() => setZoom(v => Math.min(1.6, +(v + .1).toFixed(1)))}><ZoomIn size={17}/></button><button title="查找论文文字" onClick={() => setSearchOpen(value => !value)}><Search size={17}/></button><button title="安全重新解析：保留段落 ID、译文和笔记" disabled={reparsing} onClick={() => void reparsePaper()}>{reparsing ? "解析中…" : "重新解析"}</button>{searchOpen && <input className="reader-search" autoFocus value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setSearchIndex(0); if (!e.target.value.trim()) setTargetParagraph(null); }} onKeyDown={e => { if (e.key === "Enter") findText(); if (e.key === "Escape") setSearchOpen(false); }} placeholder="搜索原文或译文"/>}</div></div>
        {selectedElement && <div className="pdf-object-toolbar"><span>第 {selectedElement.page} 页 · {selectedElement.kind === "equation" ? "公式" : selectedElement.kind === "table" ? "表格" : "图片"} · 需核对原图</span>{selectedElement.kind === "equation" ? <><button onClick={() => void openFormula(selectedElement, "brief")}>简明</button><button onClick={() => void openFormula(selectedElement, "deep")}>深入</button></> : <button disabled={busy} onClick={() => void explainElement(selectedElement)}>解释{selectedElement.kind === "table" ? "表格" : "图片"}</button>}<button aria-label="关闭对象工具栏" onClick={() => setSelectedElementId(null)}><X size={13}/></button></div>}
        {searchOpen && searchQuery.trim() && <div className="search-results" role="region" aria-label="论文全文搜索结果">
          <div className="search-results-head"><strong>{searchHits.length} 处匹配</strong><span>英文全文 · 已有中文译文</span><button title="上一个结果" disabled={!searchHits.length} onClick={() => goToSearch(searchIndex - 1)}><ChevronLeft size={15}/></button><button title="下一个结果" disabled={!searchHits.length} onClick={() => goToSearch(searchIndex + 1)}><ChevronRight size={15}/></button><button title="清除搜索" onClick={() => { setSearchQuery(""); setTargetParagraph(null); }}><X size={15}/></button></div>
          {searchHits.length ? <div className="search-results-list">{searchHits.map((hit, index) => <button key={hit.key} className={index === searchIndex ? "active" : ""} onClick={() => goToSearch(index)}><span>第 {hit.page} 页 · {hit.source === "en" ? "原文" : "中文"}</span><small>{hit.snippet}</small></button>)}</div> : <p>没有找到结果。未翻译段落无法进行中文搜索。</p>}
        </div>}
        <div className={`reading-columns mode-${mode}`} style={{ "--split-ratio": `${splitRatio}%` } as React.CSSProperties}><div className="pdf-scroll" ref={pdfContainer}>{pdfWidth > 0 ? <PdfViewer paperId={paperId} page={page} width={pdfWidth} annotations={annotations} target={targetParagraph} onSelection={onPdfSelection} onPageClick={onPdfClick}/> : <div className="pdf-loading">正在准备 PDF…</div>}</div>
          {mode !== "original" && <div className="column-divider" role="separator" aria-label="调整 PDF 与译文宽度" onPointerDown={beginResize}/>}
          {mode !== "original" && <div className="translation-scroll" ref={translationContainer} onMouseUp={onTranslationSelection}><div className="translation-heading"><div><h3>{mode === "dual" ? "中文对照" : "段落对照"}</h3></div><span>{translatedCount}/{visibleParagraphs.length}</span></div>
            {paragraphs.length === 0 && <div className="translation-empty">没有提取到可阅读文本。这份 PDF 可能是扫描件；原版 PDF 仍可阅读。</div>}
            {currentPageGroup.map(([pageNumber, group]) => <section className="translation-page" key={pageNumber}>
              <h4>第 {pageNumber} 页</h4>
              {pageContent(pageNumber, group)}
            </section>)}
          </div>}
        </div>
      </div>
      {sidebar && <aside className="assistant-sidebar" style={{ width: assistantWidth, minWidth: assistantWidth }}><div className="sidebar-resizer" role="separator" aria-label="调整助手宽度" onPointerDown={beginSidebarResize}/><div className="sidebar-header"><strong>学习助手</strong><button onClick={() => setSidebar(false)} title="关闭"><X size={18}/></button></div><div className="sidebar-tabs"><button className={tab === "ai" ? "active" : ""} onClick={() => setTab("ai")}>AI</button><button className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}>笔记 <span>{notes.length}</span></button><button className={tab === "vocabulary" ? "active" : ""} onClick={() => setTab("vocabulary")}>词汇 <span>{vocabulary.length}</span></button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>历史 <span>{history.length}</span></button><button className={tab === "quiz" ? "active" : ""} onClick={() => setTab("quiz")}>复习 <span>{quiz.length}</span></button><button className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}>我的总结</button></div>
        {tab === "ai" && <>
          <div className="sidebar-body chat-body" ref={chatBody}>
            {focusedFormula && <div className="formula-focus"><div className="formula-focus-head"><strong>公式 · 第 {focusedFormula.page} 页</strong><button onClick={() => locateElement(focusedFormula)}>定位原文</button></div><button className="formula-focus-image" onClick={() => setPreviewElementId(focusedFormula.id)} title="放大公式原图"><img src={`${API}/api/papers/${paperId}/elements/${encodeURIComponent(focusedFormula.id)}/image`} alt="公式原图"/></button><div className="formula-modes"><button className={formulaFocus?.mode === "brief" ? "active" : ""} onClick={() => void openFormula(focusedFormula, "brief")}>简明</button><button className={formulaFocus?.mode === "deep" ? "active" : ""} onClick={() => void openFormula(focusedFormula, "deep")}>深入</button></div>{formulaBusy ? <p role="status">正在核对公式与上下文… <button className="small-link" onClick={cancelFormula}>取消</button></p> : formulaReplies[`${focusedFormula.id}:${formulaFocus?.mode}`] ? <FormattedAnswer text={formulaReplies[`${focusedFormula.id}:${formulaFocus?.mode}`]}/> : <button className="small-link" onClick={() => void openFormula(focusedFormula, formulaFocus?.mode || "brief")}>重试公式解释</button>}<button className="small-link" onClick={() => questionInput.current?.focus()}>继续追问公式</button></div>}
            {!activeReference && selected && <div className="context-card"><span>当前选区 · {selectionSource === "zh" ? "中文" : "英文"}</span><p>{selected.slice(0, 240)}</p></div>}
            {!activeReference && !selected && current && <div className="context-card"><span>当前朗读 · 第 {current.page} 页</span><p>{current.text.slice(0, 180)}</p></div>}
            {history.length === 0 && !busy && <p className="chat-empty">询问论文中的概念、方法或结论。选中文字后可直接翻译或解释。</p>}
            {history.slice(0, 20).reverse().map(item => <div className="chat-turn" key={item.id}>
              {item.reference && <button className="chat-source" onClick={() => locateReference(item.reference!)} title="定位这次提问的原文">{item.reference.elementId ? "论文元素" : item.reference.sourceLanguage === "zh" ? "中文选区" : "英文选区"} · 第 {item.reference.page || item.page} 页 · {item.reference.selectedText?.slice(0, 90) || "查看原文"} →</button>}
              <div className="chat-question">{item.question}</div>
              <div className="chat-answer"><FormattedAnswer text={item.answer}/>{evidenceLinks(item.evidence)}<button className="small-link" onClick={() => speakAnswer(item.answer)} title="朗读回答"><Volume2 size={14}/></button></div>
            </div>)}
            {busy && <p className="chat-pending" role="status">正在阅读论文并生成回答… <button className="small-link" onClick={cancelAsk}>取消</button></p>}
            {failedAsk && <button className="retry-button" onClick={() => void ask(failedAsk.question, failedAsk.task, failedAsk.reference)}>重试上次提问</button>}
          </div>
          <div className="ask-box">
            {activeReference && <div className="ask-reference"><span>{activeReference.elementId ? "公式 / 图表" : activeReference.sourceLanguage === "zh" ? "中文选区" : "英文选区"} · 第 {activeReference.page} 页</span><p>{activeReference.selectedText?.slice(0, 160) || "已关联原文位置，可继续追问"}</p><button title="移除引用" onClick={() => { setActiveReference(null); setFormulaFocus(null); }}><X size={14}/></button></div>}
            <div className="voice-language"><span>{recording ? "正在识别语音…" : "语音输入"}</span><select value={voiceLang} onChange={e => setVoiceLang(e.target.value as "zh-CN" | "en-US")}><option value="zh-CN">中文 / 中英混合</option><option value="en-US">English</option></select></div>
            <div className="ask-entry"><textarea ref={questionInput} value={question} onChange={e => setQuestion(e.target.value)} placeholder={activeReference ? "针对所引原文提问…" : "问问这篇论文…"} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } }}/><div className="ask-buttons"><button className={"mic-button " + (recording ? "recording" : "")} onClick={toggleMic} title={recording ? "停止录音" : "语音提问"}>{recording ? <Square size={17}/> : <Mic size={18}/>}</button><button className="send-button" disabled={!question.trim() || busy} onClick={() => void ask()} title="发送"><Send size={17}/></button></div></div>
            {voiceInterim && <div className="interim">识别中：{voiceInterim}</div>}
            {!speechRecognitionAvailable() && <div className="compat-note">当前浏览器不支持语音识别，可继续使用文字输入。</div>}
          </div>
        </>}
        {tab === "notes" && <div className="sidebar-body list-body">
          {noteContext && <div className="note-composer">
            <strong>{noteEditingId ? "编辑笔记" : "新笔记"} · 第 {noteContext.page} 页</strong>
            {noteContext.selectedText && <blockquote>{noteContext.selectedText.slice(0, 180)}</blockquote>}
            <textarea autoFocus value={noteDraft} onChange={e => setNoteDraft(e.target.value)} placeholder="写下你的理解…" />
            <div><button onClick={() => { setNoteContext(null); setNoteDraft(""); setNoteEditingId(null); }}>取消</button><button className="note-save" disabled={!noteDraft.trim()} onClick={() => void saveNote()}>保存</button></div>
          </div>}
          {notes.length ? notes.map(n => <div className="record-card" key={n.id}>
            <div className="record-meta">第 {n.page} 页 <button title="删除笔记" onClick={async () => { try { await request("/api/papers/" + paperId + "/notes/" + n.id, { method: "DELETE" }); setNotes(await request("/api/papers/" + paperId + "/notes")); } catch (e) { setError((e as Error).message); } }}><Trash2 size={15}/></button></div>
            <button className="note-location" title="定位到 PDF 原文" onClick={() => locateEvidence({ paragraphId: n.paragraphId, page: n.page, quote: n.textAnchor || n.selectedText, rects: n.rects }, "note")}>{n.selectedText && <blockquote>{n.selectedText}</blockquote>}<p>{n.content}</p><span>定位原文 →</span></button><button className="small-link" onClick={() => editNote(n)}>编辑</button>
          </div>) : !noteContext && <div className="empty-sidebar">选中文字后，点击“笔记”。</div>}
        </div>}
        {tab === "notes" && annotations.length > 0 && <div className="annotation-list"><strong>标注 {annotations.length}</strong>{annotations.map(a => <div className="annotation-item" key={a.id}><span>{a.kind === "underline" ? "下划线" : "高亮"} · 第 {a.page} 页</span><p>{a.text}</p><div><select value={a.color} aria-label="修改标注颜色" onChange={async e => { await request(`/api/papers/${paperId}/annotations/${a.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ color: e.target.value }) }); setAnnotations(await request(`/api/papers/${paperId}/annotations`)); }}><option value="yellow">黄色</option><option value="green">绿色</option><option value="blue">蓝色</option><option value="pink">粉色</option></select><button title="删除标注" onClick={async () => { await request(`/api/papers/${paperId}/annotations/${a.id}`, { method: "DELETE" }); setAnnotations(await request(`/api/papers/${paperId}/annotations`)); }}><Trash2 size={14}/></button></div></div>)}</div>}
        {tab === "vocabulary" && <div className="sidebar-body list-body">{vocabulary.length ? vocabulary.map(v => <div className="record-card" key={v.id}><div className="record-meta">第 {v.page} 页 · 下次复习 {new Date(v.nextReviewAt).toLocaleDateString()} <button onClick={async () => { await request(`/api/papers/${paperId}/vocabulary/${v.id}`, { method: "DELETE" }); setVocabulary(await request(`/api/papers/${paperId}/vocabulary`)); }}><Trash2 size={15}/></button></div><strong>{v.word}</strong><p>{v.meaning}</p><p>{v.context}</p><div className="review-buttons">{[["again","Again"],["hard","Hard"],["good","Good"],["easy","Easy"]].map(([value,label]) => <button key={value} onClick={() => void reviewWord(v.id, value)}>{label}</button>)}</div></div>) : <div className="empty-sidebar">选中英文词汇或专业短语后，点击“保存词汇”。</div>}</div>}
        {tab === "history" && <div className="sidebar-body list-body">{history.length ? history.map(h => <div className="record-card" key={h.id}><div className="record-meta">{h.inputMode === "voice" ? "语音提问" : "文字提问"} · {h.page ? `第 ${h.page} 页` : "论文"} · {new Date(h.createdAt).toLocaleString()}</div><strong>{h.question}</strong><FormattedAnswer text={h.answer}/>{evidenceLinks(h.evidence)}<button className="small-link" onClick={() => speakAnswer(h.answer)}>朗读回答</button></div>) : <div className="empty-sidebar">你的问题和回答会保存在这里。</div>}</div>}
        {tab === "quiz" && <div className="sidebar-body list-body"><div className="quiz-intro"><strong>复习论文</strong><p>选择题按保存的选项 ID 判分；旧题成绩需要重新评估。</p><button className="primary-button" disabled={busy} onClick={() => void generateQuiz()}>{busy ? "生成中…" : "生成新测试"}</button></div>{quiz.map(q => <div className="record-card quiz-card" key={q.id}>
          <div className="record-meta">{q.kind.replaceAll("_", " ")}{q.status !== "ready" && <span> · 题目需重新评估</span>}</div><strong>{q.prompt}</strong>
          {q.options.length > 0 ? <div className="quiz-options">{q.options.map(option => <label key={option.id}><input type="radio" name={`quiz-${q.id}`} value={option.id} checked={quizAnswers[q.id] === option.id} onChange={e => setQuizAnswers(previous => ({ ...previous, [q.id]: e.target.value }))}/>{option.text}</label>)}</div> : <textarea className="quiz-answer" placeholder="写下你的回答…" value={quizAnswers[q.id] || ""} onChange={e => setQuizAnswers(previous => ({ ...previous, [q.id]: e.target.value }))}/>}
          <button className="small-link" disabled={busy || !quizAnswers[q.id] || q.status !== "ready"} onClick={() => void submitQuiz(q.id)}>提交回答</button>
          {q.attempt && <div className="quiz-feedback"><strong>{q.attempt.verified ? (q.attempt.evaluation?.status === "problematic" ? "题目有问题，不计分" : `最近得分 ${Math.round(q.attempt.score * 100)}%`) : "历史成绩待重新评估"}</strong>{q.attempt.verified && <p>{q.attempt.feedback}</p>}
            {q.attempt.evaluation && <div className="quiz-evaluation"><p><b>你的答案：</b>{q.attempt.evaluation.yourAnswer}</p><p><b>正确答案：</b>{q.attempt.evaluation.correctAnswer}</p>{q.attempt.evaluation.whyCorrect && <p><b>为什么正确：</b>{q.attempt.evaluation.whyCorrect}</p>}{q.attempt.evaluation.whyOthers?.map((item, index) => <p key={index}><b>{item.option}：</b>{item.reason}</p>)}{q.attempt.evaluation.correct && <p><b>正确的部分：</b>{q.attempt.evaluation.correct}</p>}{q.attempt.evaluation.inaccurate && <p><b>不准确的部分：</b>{q.attempt.evaluation.inaccurate}</p>}{q.attempt.evaluation.missing && <p><b>遗漏：</b>{q.attempt.evaluation.missing}</p>}{q.attempt.evaluation.improvement && <p><b>改进建议：</b>{q.attempt.evaluation.improvement}</p>}{evidenceLinks(q.attempt.evaluation.evidence)}</div>}
          </div>}
        </div>)}</div>}
        {tab === "summary" && <div className="sidebar-body list-body summary-body"><div className="summary-head"><strong>我的论文总结</strong><span>{summary?.status === "empty" ? "尚未总结" : summary?.status === "feedback" ? "已获得 AI 反馈" : summary?.status === "revised" ? "已完成修改" : "已完成总结"}</span></div><p className="summary-hint">用自己的话写下问题、方法、结果和疑问。中英文均可，自动保存。</p>
          <textarea className="summary-editor" value={summaryDraft} onChange={e => setSummaryDraft(e.target.value)} placeholder="这篇论文研究了什么？作者的方法和证据是什么？我还有哪些疑问？" />
          <div className="summary-actions"><span>{summaryDraft === summarySaved.current ? (summary?.updatedAt ? `已保存 · ${new Date(summary.updatedAt).toLocaleString()}` : "尚未保存") : "等待自动保存…"}</span><button disabled={summaryBusy || !summaryDraft.trim()} onClick={() => void reviewSummary("check")}>检查我的理解</button><button disabled={summaryBusy || !summaryDraft.trim()} onClick={() => void reviewSummary("polish")}>AI 润色</button></div>
          {summary?.reviews.map(review => <div className="summary-review" key={review.id}><strong>{review.kind === "check" ? "理解检查" : "润色建议"} · {new Date(review.createdAt).toLocaleString()}</strong>
            {review.kind === "check" ? <>{[["整体理解评价", "overall"],["理解正确的地方", "correct"],["需要纠正的地方", "corrections"],["遗漏的重要知识", "missing"],["可继续思考的问题", "questions"]].map(([label, field]) => <div key={field}><b>{label}</b><FormattedAnswer text={Array.isArray(review.result[field]) ? (review.result[field] as string[]).join("\n") : String(review.result[field] || "未提及")}/></div>)}{evidenceLinks(review.result.evidence as Evidence[] | undefined)}{review.result.evidenceWarning && <p>{String(review.result.evidenceWarning)}</p>}</> : <><div className="summary-compare"><div><b>我的原始总结</b><p>{review.originalContent}</p></div><div><b>AI 建议版本</b><p>{String(review.result.suggested || "")}</p></div></div>{review.result.notes && <p>{String(review.result.notes)}</p>}{!review.accepted && <button className="small-link" disabled={summaryBusy} onClick={() => void acceptPolish(review.id)}>接受建议</button>}{review.accepted && <span>已接受，原始版本永久保留在此记录中</span>}</>}
          </div>)}
        </div>}
      </aside>}
    </div>

    {previewElement && <div className="element-preview" role="dialog" aria-modal="true" aria-label="论文原图预览" onClick={() => setPreviewElementId(null)}><div className="element-preview-panel" onClick={event => event.stopPropagation()}><div><strong>{previewElement.kind === "equation" ? "公式" : previewElement.kind === "table" ? "表格" : "图片"} · 第 {previewElement.page} 页</strong><button onClick={() => setPreviewElementId(null)} aria-label="关闭原图预览"><X size={18}/></button></div><img src={`${API}/api/papers/${paperId}/elements/${encodeURIComponent(previewElement.id)}/image`} alt="论文原始区域放大图"/><button onClick={() => { locateElement(previewElement); setPreviewElementId(null); }}>定位到 PDF</button></div></div>}
    {selected && <div className="selection-toolbar" style={selectionPosition ? { left: selectionPosition.left, top: selectionPosition.top } : undefined}>
      <span className="selection-preview">{selected.slice(0, 42)}{selected.length > 42 ? "…" : ""}</span>
      <div className="selection-actions">
        {selectionSource === "en" && <button onClick={() => { setSidebar(true); setTab("ai"); void ask("翻译选中内容", "translate"); }}>翻译</button>}
        <button onClick={() => { setSidebar(true); setTab("ai"); void ask("解释选中内容", "explain"); }}>解释</button>
        <select title="标注颜色" value={annotationColor} onChange={e => setAnnotationColor(e.target.value)}><option value="yellow">黄色</option><option value="green">绿色</option><option value="blue">蓝色</option><option value="pink">粉色</option></select>
        <button onClick={() => void addAnnotation("highlight")}><Highlighter size={16}/> 高亮</button>
        {selectionSource === "en" && <button onClick={() => void addAnnotation("underline")}><Underline size={16}/> 下划线</button>}
        <button onClick={() => void addNote()}><StickyNote size={16}/> 笔记</button>
        {selectionSource === "en" && <button onClick={() => void saveWord()} disabled={busy}>保存词汇</button>}
        <button onClick={confirmSelectionForAsk}><MessageCircle size={16}/> 问 AI</button>
        <button onClick={() => setSelected("")} title="关闭"><X size={16}/></button>
      </div>
    </div>}

    {audioOpen && <div className="audio-player"><div className="audio-header"><div className="audio-label"><Headphones size={16}/><strong>AI 朗读</strong><span>{current ? `第 ${current.page} 页 · ${current.kind === "heading" ? "章节" : "段落"} ${snapshot.index + 1}/${snapshot.total}` : "选择朗读范围"}</span></div><button className="icon-button" onClick={() => setAudioOpen(false)} title="收起播放器，继续播放"><X size={17}/></button></div>
      <div className="audio-content"><div className="audio-scopes"><button onClick={() => void startAudio("full")}>全文</button><button disabled={!selectedParagraphId && !snapshot.paragraphId} onClick={() => void startAudio("section", selectedParagraphId || snapshot.paragraphId || undefined)}>当前章节</button><button disabled={!selectedParagraphId} onClick={() => void startAudio("selection", selectedParagraphId || undefined)}>选中段落</button></div>
        <div className="audio-controls"><button title="上一段" onClick={() => session.previous()} disabled={snapshot.index <= 0}><ChevronLeft size={20}/></button><button className="audio-play" onClick={() => snapshot.status === "playing" ? session.pause() : session.play()} title={snapshot.status === "playing" ? "暂停" : "播放"}>{snapshot.status === "playing" ? <Pause size={20} fill="currentColor"/> : <Play size={20} fill="currentColor"/>}</button><button title="下一段" onClick={() => session.next()} disabled={snapshot.index >= snapshot.total - 1}><ChevronRight size={20}/></button><input aria-label="朗读进度" type="range" min={0} max={Math.max(0, snapshot.total - 1)} value={Math.min(snapshot.index, Math.max(0, snapshot.total - 1))} onChange={e => session.seek(Number(e.target.value))}/><span className="audio-count">{snapshot.total ? `${Math.min(snapshot.index + 1, snapshot.total)}/${snapshot.total}` : "0/0"}</span><button title="停止朗读" onClick={() => session.stop()}><Square size={15}/></button></div>
        <div className="audio-settings"><select aria-label="朗读语言" value={snapshot.language} onChange={e => session.setLanguage(e.target.value as "en" | "zh")}><option value="en">English</option><option value="zh">中文</option></select><select aria-label="朗读速度" value={snapshot.speed} onChange={e => session.setSpeed(Number(e.target.value))}>{SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}</select><select aria-label="朗读声音" value={voiceId} onChange={e => { setVoiceId(e.target.value); session.setVoice(e.target.value); }}><option value="">系统默认声音</option>{selectedVoiceOptions.map(v => <option key={v.id} value={v.id}>{v.name} ({v.lang})</option>)}</select><label className="follow-toggle"><input type="checkbox" checked={simplifyCitations} onChange={e => { setSimplifyCitations(e.target.checked); session.setSimplifyCitations(e.target.checked); }}/> 简化引用</label><label className="follow-toggle"><input type="checkbox" checked={autoFollow} onChange={e => setAutoFollow(e.target.checked)}/> 自动跟随</label></div></div>
      {snapshot.error && <div className="audio-error">{snapshot.error}</div>}{snapshot.language === "zh" && translatedCount < paragraphs.length && <div className="audio-hint">部分段落尚未翻译，中文朗读会跳过这些段落。</div>}{selectedVoiceOptions.length === 0 && <div className="audio-hint">系统未列出此语言的声音；朗读效果取决于浏览器默认声音。</div>}
    </div>}
  </div>;
}
