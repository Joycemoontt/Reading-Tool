"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import { API, Annotation } from "@/lib/api";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export default function PdfViewer({ paperId, page, width, annotations, onSelection }: {
  paperId: string; page: number; width: number; annotations: Annotation[]; onSelection: (text: string) => void;
}) {
  const [error, setError] = useState("");
  const renderText = ({ str }: { str: string }) => {
    const match = annotations.find(a => a.page === page && a.text.length > 2 && str.toLowerCase().includes(a.text.toLowerCase()));
    if (!match) return escapeHtml(str);
    const start = str.toLowerCase().indexOf(match.text.toLowerCase());
    const before = escapeHtml(str.slice(0, start));
    const selected = escapeHtml(str.slice(start, start + match.text.length));
    const after = escapeHtml(str.slice(start + match.text.length));
    return `${before}<span class="pdf-${match.kind} color-${match.color}">${selected}</span>${after}`;
  };
  return <div className="pdf-stage" onMouseUp={() => {
    const text = window.getSelection()?.toString().trim();
    if (text) onSelection(text);
  }}><Document file={`${API}/api/papers/${paperId}/file`} loading={<div className="pdf-loading">正在加载 PDF…</div>} onLoadError={e => setError(e.message)}>
    <Page pageNumber={page} width={width} renderTextLayer renderAnnotationLayer customTextRenderer={renderText}/>
  </Document>{error && <div className="error-box">PDF 加载失败：{error}</div>}</div>;
}
