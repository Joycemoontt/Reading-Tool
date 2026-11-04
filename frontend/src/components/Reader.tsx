"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Headphones, Highlighter, Languages, MessageCircle, Mic, MoreHorizontal, Pause, Play, Search, Send, Settings2, Square, StickyNote, Trash2, Underline, Volume2, X, ZoomIn, ZoomOut } from "lucide-react";
import { Annotation, Interaction, json, Note, Paper, Paragraph, request, Vocabulary, QuizQuestion } from "@/lib/api";
import { ReadingParagraph, ReadingScope, ReadingSession, ReadingSnapshot, SPEEDS } from "@/lib/audio-core";
import { attachMediaSession, BrowserSpeechProvider, BrowserVoiceInput, speechRecognitionAvailable } from "@/lib/browser-speech";
import type { SelectionGeometry } from "./PdfViewer";
import FormattedAnswer from "./FormattedAnswer";
import { groupParagraphsByPage, isPageMarker, nearestParagraph, normalizeTerm } from "@/lib/reader-utils";

const PdfViewer = dynamic(() => import("./PdfViewer"), { ssr: false });
type Tab = "ai" | "notes" | "vocabulary" | "history" | "quiz";

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
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [history, setHistory] = useState<Interaction[]>([]);
  const [vocabulary, setVocabulary] = useState<Vocabulary[]>([]);
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
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
  const [selectionSource, setSelectionSource] = useState<"en" | "zh">("en");
  const [selectionRects, setSelectionRects] = useState<number[][]>([]);
  const [selectionPage, setSelectionPage] = useState(1);
  const [selectionPosition, setSelectionPosition] = useState<{ left: number; top: number } | null>(null);
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(null);
  const [targetParagraph, setTargetParagraph] = useState<{ id: string; bbox: number[]; boxes: number[][] } | null>(null);
  const [splitRatio, setSplitRatio] = useState(55);
  const [assistantWidth, setAssistantWidth] = useState(340);
  const [annotationColor, setAnnotationColor] = useState("yellow");
  const [question, setQuestion] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteContext, setNoteContext] = useState<{ paragraphId: string | null; page: number; selectedText: string } | null>(null);
  const [voiceInterim, setVoiceInterim] = useState("");
  const [voiceLang, setVoiceLang] = useState<"zh-CN" | "en-US">("zh-CN");
  const [recording, setRecording] = useState(false);
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");
  const [busy, setBusy] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState(0);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [failedAsk, setFailedAsk] = useState<{ question: string; task: "ask" | "translate" | "explain" } | null>(null);
  const [voices, setVoices] = useState<{ id: string; name: string; lang: string }[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [snapshot, setSnapshot] = useState<ReadingSnapshot>({ status: "idle", paragraphId: null, index: 0, total: 0, charIndex: 0, language: "en", speed: 1, error: null });
  const [pdfWidth, setPdfWidth] = useState(0);
  const pdfContainer = useRef<HTMLDivElement>(null);
  const selectionContext = useRef<{ page: number; paragraphs: Paragraph[] }>({ page, paragraphs });
  selectionContext.current = { page, paragraphs };
  const translationContainer = useRef<HTMLDivElement>(null);
  const progressWrite = useRef<Promise<void>>(Promise.resolve());
  const chatBody = useRef<HTMLDivElement>(null);
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
    const [p, ps, as, ns, hs, vs, qs] = await Promise.all([
      request<Paper>(`/api/papers/${paperId}`), request<Paragraph[]>(`/api/papers/${paperId}/paragraphs`),
      request<Annotation[]>(`/api/papers/${paperId}/annotations`), request<Note[]>(`/api/papers/${paperId}/notes`),
      request<Interaction[]>(`/api/papers/${paperId}/history`),
      request<Vocabulary[]>(`/api/papers/${paperId}/vocabulary`),
      request<QuizQuestion[]>(`/api/papers/${paperId}/quiz`),
    ]);
    setPaper(p); setParagraphs(ps); setAnnotations(as); setNotes(ns); setHistory(hs); setVocabulary(vs); setQuiz(qs); setPage(p.page); setMode(p.mode);
  }, [paperId]);

  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [refresh]);
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
    return () => { recognition.current?.dispose(); session.stop(); detachMedia(); unsubscribeVoices(); };
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
    const safe = Math.max(1, Math.min(paper.pages, next)); setPage(safe); setSelectedParagraphId(null); persistProgress(safe, mode);
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
    setSelectedParagraphId(match?.id || paragraphs.find(p => p.page === page)?.id || null);
  }, []);

  const onPdfClick = useCallback((x: number, y: number) => {
    const { page, paragraphs } = selectionContext.current;
    const nearest = nearestParagraph(paragraphs, page, x, y);
    if (!nearest) return;
    setSelectedParagraphId(nearest.id);
    translationContainer.current?.querySelector(`[data-para="${CSS.escape(nearest.id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

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
    setTargetParagraph({ id: `${paragraph.id}-${Date.now()}`, bbox: paragraph.bbox,
      boxes: paragraph.boxes?.length ? paragraph.boxes : [paragraph.bbox] });
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
      let remaining = paragraphs.length - paragraphs.filter(p => p.translation).length;
      while (remaining > 0) {
        const result = await request<{ translated: number; remaining: number }>(`/api/papers/${paperId}/translate?limit=8`, { method: "POST" });
        remaining = result.remaining;
        const updated = await request<Paragraph[]>(`/api/papers/${paperId}/paragraphs`);
        setParagraphs(updated);
        setTranslationProgress(updated.length - remaining);
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
    setNoteContext({ paragraphId: selectedParagraphId, page: selectionPage, selectedText: selected });
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
    setNoteContext({ paragraphId: note.paragraphId, page: note.page, selectedText: note.selectedText });
    setNoteEditingId(note.id); setNoteDraft(note.content);
  }

  function findText() {
    const term = searchQuery.trim().toLowerCase();
    if (!term) return;
    const match = paragraphs.find(p => p.text.toLowerCase().includes(term) || p.translation?.toLowerCase().includes(term));
    if (match) { locateParagraph(match); setSearchOpen(false); }
    else setError("未找到匹配文字");
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

  async function ask(override?: string, task: "ask" | "translate" | "explain" = "ask") {
    if (!(override || question).trim() || busy) return;
    const contextId = (selected ? selectedParagraphId : null) || snapshot.paragraphId || selectedParagraphId || null;
    const asked = (override || question).trim();
    setBusy(true); setError(""); setAnswer(""); setFailedAsk(null); session.pause();
    try {
      const response = await request<{ answer: string }>(`/api/papers/${paperId}/ask`, json({ question: asked, paragraphId: contextId, selectedText: selected, inputMode, task }));
      setAnswer(response.answer); setHistory(await request(`/api/papers/${paperId}/history`)); setQuestion(""); setSelected(""); setInputMode("text");
    } catch (e) { setFailedAsk({ question: asked, task }); setError(e instanceof DOMException && e.name === "TimeoutError" ? "请求超时，请重试；问题仍保留在输入框中。" : (e as Error).message); }
    finally { setBusy(false); }
  }

  function speakAnswer(text: string) {
    session.stop();
    provider.speak(text, { language: /[\u3400-\u9fff]/.test(text) ? "zh" : "en", speed: 1,
      onError: setError });
  }

  const current = paragraphs.find(p => p.id === snapshot.paragraphId);
  const visibleParagraphs = useMemo(() => paragraphs.filter(p => !isPageMarker(p.text)), [paragraphs]);
  const pageGroups = useMemo(() => groupParagraphsByPage(visibleParagraphs), [visibleParagraphs]);
  const translatedCount = visibleParagraphs.filter(p => p.translation).length;
  const selectedVoiceOptions = voices.filter(v => v.lang.toLowerCase().startsWith(snapshot.language));

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
      <div className="reading-area"><div className="reading-toolbar"><div className="page-controls"><button onClick={() => changePage(page - 1)} disabled={page <= 1}><ChevronLeft size={18}/></button><span>第 <strong>{page}</strong> / {paper.pages} 页</span><button onClick={() => changePage(page + 1)} disabled={page >= paper.pages}><ChevronRight size={18}/></button></div><div className="reading-tools"><button title="缩小" onClick={() => setZoom(v => Math.max(.6, +(v - .1).toFixed(1)))}><ZoomOut size={17}/></button><span>{Math.round(zoom * 100)}%</span><button title="放大" onClick={() => setZoom(v => Math.min(1.6, +(v + .1).toFixed(1)))}><ZoomIn size={17}/></button><button title="查找论文文字" onClick={() => setSearchOpen(value => !value)}><Search size={17}/></button>{searchOpen && <input className="reader-search" autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") findText(); if (e.key === "Escape") setSearchOpen(false); }} placeholder="搜索原文或译文"/>}</div></div>
        <div className={`reading-columns mode-${mode}`} style={{ "--split-ratio": `${splitRatio}%` } as React.CSSProperties}><div className="pdf-scroll" ref={pdfContainer}>{pdfWidth > 0 ? <PdfViewer paperId={paperId} page={page} width={pdfWidth} annotations={annotations} target={targetParagraph} onSelection={onPdfSelection} onPageClick={onPdfClick}/> : <div className="pdf-loading">正在准备 PDF…</div>}</div>
          {mode !== "original" && <div className="column-divider" role="separator" aria-label="调整 PDF 与译文宽度" onPointerDown={beginResize}/>}
          {mode !== "original" && <div className="translation-scroll" ref={translationContainer} onMouseUp={onTranslationSelection}><div className="translation-heading"><div><h3>{mode === "dual" ? "中文对照" : "段落对照"}</h3></div><span>{translatedCount}/{visibleParagraphs.length}</span></div>
            {paragraphs.length === 0 && <div className="translation-empty">没有提取到可阅读文本。这份 PDF 可能是扫描件；原版 PDF 仍可阅读。</div>}
            {pageGroups.map(([pageNumber, group]) => <section className="translation-page" key={pageNumber}>
              <h4>第 {pageNumber} 页</h4>
              {group.map(p => <div key={p.id} data-para={p.id} className={`translation-paragraph ${p.id === snapshot.paragraphId && snapshot.status === "playing" ? "speaking" : ""} ${p.kind === "heading" ? "is-heading" : ""}`} onClick={() => locateParagraph(p)}>
                <div className="para-actions">{/[=∑∫∂Σ]|\b(?:Eq\.|equation)\b/i.test(p.text) && <button title="生成并缓存公式口语说明" onClick={e => { e.stopPropagation(); void prepareSpeech(p); }}>∑</button>}<button title="从此段朗读" onClick={e => { e.stopPropagation(); void startAudio("full", p.id); }}><Play size={13}/></button></div>
                {mode === "paragraph" && <p className="original-text">{p.text}</p>}
                <p>{p.translation ? translatedText(p, annotations) : <span className="untranslated">尚未翻译 · 点击顶部“全文翻译”</span>}</p>
              </div>)}
            </section>)}
          </div>}
        </div>
      </div>
      {sidebar && <aside className="assistant-sidebar" style={{ width: assistantWidth, minWidth: assistantWidth }}><div className="sidebar-resizer" role="separator" aria-label="调整助手宽度" onPointerDown={beginSidebarResize}/><div className="sidebar-header"><strong>学习助手</strong><button onClick={() => setSidebar(false)} title="关闭"><X size={18}/></button></div><div className="sidebar-tabs"><button className={tab === "ai" ? "active" : ""} onClick={() => setTab("ai")}>AI</button><button className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}>笔记 <span>{notes.length}</span></button><button className={tab === "vocabulary" ? "active" : ""} onClick={() => setTab("vocabulary")}>词汇 <span>{vocabulary.length}</span></button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>历史 <span>{history.length}</span></button><button className={tab === "quiz" ? "active" : ""} onClick={() => setTab("quiz")}>复习 <span>{quiz.length}</span></button></div>
        {tab === "ai" && <>
          <div className="sidebar-body chat-body" ref={chatBody}>
            {selected && <div className="context-card"><span>当前选区 · {selectionSource === "zh" ? "中文" : "英文"}</span><p>{selected.slice(0, 240)}</p></div>}
            {!selected && current && <div className="context-card"><span>当前朗读 · 第 {current.page} 页</span><p>{current.text.slice(0, 180)}</p></div>}
            {history.length === 0 && !busy && <p className="chat-empty">询问论文中的概念、方法或结论。选中文字后可直接翻译或解释。</p>}
            {history.slice(0, 20).reverse().map(item => <div className="chat-turn" key={item.id}>
              <div className="chat-question">{item.question}</div>
              <div className="chat-answer"><FormattedAnswer text={item.answer}/><button className="small-link" onClick={() => speakAnswer(item.answer)} title="朗读回答"><Volume2 size={14}/></button></div>
            </div>)}
            {busy && <p className="chat-pending" role="status">正在阅读论文并生成回答…</p>}
            {failedAsk && <button className="retry-button" onClick={() => void ask(failedAsk.question, failedAsk.task)}>重试上次提问</button>}
          </div>
          <div className="ask-box">
            <div className="voice-language"><span>{recording ? "正在识别语音…" : "语音输入"}</span><select value={voiceLang} onChange={e => setVoiceLang(e.target.value as "zh-CN" | "en-US")}><option value="zh-CN">中文 / 中英混合</option><option value="en-US">English</option></select></div>
            <div className="ask-entry"><textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="问问这篇论文…" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } }}/><div className="ask-buttons"><button className={"mic-button " + (recording ? "recording" : "")} onClick={toggleMic} title={recording ? "停止录音" : "语音提问"}>{recording ? <Square size={17}/> : <Mic size={18}/>}</button><button className="send-button" disabled={!question.trim() || busy} onClick={() => void ask()} title="发送"><Send size={17}/></button></div></div>
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
            {n.selectedText && <blockquote>{n.selectedText}</blockquote>}
            <p>{n.content}</p><button className="small-link" onClick={() => editNote(n)}>编辑</button>
          </div>) : !noteContext && <div className="empty-sidebar">选中文字后，点击“笔记”。</div>}
        </div>}
        {tab === "notes" && annotations.length > 0 && <div className="annotation-list"><strong>标注 {annotations.length}</strong>{annotations.map(a => <div className="annotation-item" key={a.id}><span>{a.kind === "underline" ? "下划线" : "高亮"} · 第 {a.page} 页</span><p>{a.text}</p><div><select value={a.color} aria-label="修改标注颜色" onChange={async e => { await request(`/api/papers/${paperId}/annotations/${a.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ color: e.target.value }) }); setAnnotations(await request(`/api/papers/${paperId}/annotations`)); }}><option value="yellow">黄色</option><option value="green">绿色</option><option value="blue">蓝色</option><option value="pink">粉色</option></select><button title="删除标注" onClick={async () => { await request(`/api/papers/${paperId}/annotations/${a.id}`, { method: "DELETE" }); setAnnotations(await request(`/api/papers/${paperId}/annotations`)); }}><Trash2 size={14}/></button></div></div>)}</div>}
        {tab === "vocabulary" && <div className="sidebar-body list-body">{vocabulary.length ? vocabulary.map(v => <div className="record-card" key={v.id}><div className="record-meta">第 {v.page} 页 · 下次复习 {new Date(v.nextReviewAt).toLocaleDateString()} <button onClick={async () => { await request(`/api/papers/${paperId}/vocabulary/${v.id}`, { method: "DELETE" }); setVocabulary(await request(`/api/papers/${paperId}/vocabulary`)); }}><Trash2 size={15}/></button></div><strong>{v.word}</strong><p>{v.meaning}</p><p>{v.context}</p><div className="review-buttons">{[["again","Again"],["hard","Hard"],["good","Good"],["easy","Easy"]].map(([value,label]) => <button key={value} onClick={() => void reviewWord(v.id, value)}>{label}</button>)}</div></div>) : <div className="empty-sidebar">选中英文词汇或专业短语后，点击“保存词汇”。</div>}</div>}
        {tab === "history" && <div className="sidebar-body list-body">{history.length ? history.map(h => <div className="record-card" key={h.id}><div className="record-meta">{h.inputMode === "voice" ? "语音提问" : "文字提问"} · {h.page ? `第 ${h.page} 页` : "论文"} · {new Date(h.createdAt).toLocaleString()}</div><strong>{h.question}</strong><FormattedAnswer text={h.answer}/><button className="small-link" onClick={() => speakAnswer(h.answer)}>朗读回答</button></div>) : <div className="empty-sidebar">你的问题和回答会保存在这里。</div>}</div>}
        {tab === "quiz" && <div className="sidebar-body list-body"><div className="quiz-intro"><strong>Review This Paper</strong><p>根据论文原文、笔记和词汇生成理解题，回答与反馈会长期保存。</p><button className="primary-button" disabled={busy} onClick={() => void generateQuiz()}>{busy ? "生成中…" : "生成新测试"}</button></div>{quiz.map(q => <div className="record-card quiz-card" key={q.id}><div className="record-meta">{q.kind.replaceAll("_", " ")}</div><strong>{q.prompt}</strong>{q.options.length > 0 ? <div className="quiz-options">{q.options.map((option, index) => <label key={index}><input type="radio" name={`quiz-${q.id}`} value={"ABCD"[index]} checked={quizAnswers[q.id] === "ABCD"[index]} onChange={e => setQuizAnswers(previous => ({ ...previous, [q.id]: e.target.value }))}/>{option}</label>)}</div> : <textarea className="quiz-answer" placeholder="写下你的回答…" value={quizAnswers[q.id] || ""} onChange={e => setQuizAnswers(previous => ({ ...previous, [q.id]: e.target.value }))}/>}<button className="small-link" disabled={busy || !quizAnswers[q.id]} onClick={() => void submitQuiz(q.id)}>提交回答</button>{q.attempt && <div className="quiz-feedback"><strong>最近得分 {Math.round(q.attempt.score * 100)}%</strong><p>{q.attempt.feedback}</p></div>}</div>)}</div>}
      </aside>}
    </div>

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
        <button onClick={() => { setSidebar(true); setTab("ai"); }}><MessageCircle size={16}/> 问 AI</button>
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
