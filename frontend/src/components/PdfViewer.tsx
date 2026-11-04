"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFPageProxy } from "pdfjs-dist";
import { API, Annotation } from "@/lib/api";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export type SelectionGeometry = { text: string; rects: number[][]; pdfPoint?: [number, number] };
export type PdfTarget = { id: string; bbox: number[]; boxes: number[][]; rects?: number[][]; text?: string; occurrence?: number; kind?: "search" | "note" | "paragraph" };

function normalizedRects(range: Range, page: HTMLElement): number[][] {
  const bounds = page.getBoundingClientRect();
  const seen = new Set<string>();
  return Array.from(range.getClientRects()).filter(rect => rect.width > 1 && rect.height > 1 && rect.height < bounds.height * .1)
    .map(rect => [
      Math.max(0, (rect.left - bounds.left) / bounds.width),
      Math.max(0, (rect.top - bounds.top) / bounds.height),
      Math.min(1, (rect.right - bounds.left) / bounds.width),
      Math.min(1, (rect.bottom - bounds.top) / bounds.height),
    ]).filter(rect => {
      if (rect[2] <= rect[0] || rect[3] <= rect[1]) return false;
      const key = rect.map(value => Math.round(value * 10000)).join(",");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function legacyRects(page: HTMLElement, text: string, preferredY?: number, endY?: number, occurrence?: number): number[][] {
  const layer = page.querySelector(".react-pdf__Page__textContent");
  if (!layer) return [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  const points: { node: Text; offset: number }[] = [];
  let haystack = "";
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    for (let offset = 0; offset < node.length; offset++) {
      const char = node.data[offset];
      if (/\s/.test(char) && haystack.endsWith(" ")) continue;
      haystack += /\s/.test(char) ? " " : char;
      points.push({ node, offset });
    }
  }
  const needle = text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  if (!needle) return [];
  let start = -1;
  let best: number[][] = [];
  let bestDistance = Infinity;
  const candidates: number[][][] = [];
  while ((start = haystack.toLocaleLowerCase().indexOf(needle, start + 1)) >= 0) {
    if (!points[start] || !points[start + needle.length - 1]) continue;
    const range = document.createRange();
    range.setStart(points[start].node, points[start].offset);
    range.setEnd(points[start + needle.length - 1].node, points[start + needle.length - 1].offset + 1);
    const rects = normalizedRects(range, page);
    if (!rects.length) continue;
    const center = (rects[0][1] + rects[0][3]) / 2;
    if (preferredY !== undefined && endY !== undefined && center >= preferredY - .02 && center <= endY + .02)
      candidates.push(rects);
    const distance = preferredY === undefined ? 0 : Math.abs(center - preferredY);
    if (distance < bestDistance) { best = rects; bestDistance = distance; }
    if (preferredY === undefined && occurrence === undefined) break;
  }
  if (occurrence !== undefined && candidates[occurrence]) return candidates[occurrence];
  return best;
}

function PdfViewer({ paperId, page, width, annotations, target, onSelection, onPageClick }: {
  paperId: string; page: number; width: number; annotations: Annotation[];
  target: PdfTarget | null;
  onSelection: (value: SelectionGeometry) => void;
  onPageClick: (x: number, y: number) => void;
}) {
  const [error, setError] = useState("");
  const [pageView, setPageView] = useState<[number, number, number, number] | null>(null);
  const [rendered, setRendered] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const pageNode = () => root.current?.querySelector<HTMLElement>(".react-pdf__Page");

  useEffect(() => {
    if (!target || !pageView) return;
    const node = pageNode();
    const scroll = root.current?.closest<HTMLElement>(".pdf-scroll");
    if (!node || !scroll) return;
    const bboxY = (target.bbox[1] - pageView[1]) / (pageView[3] - pageView[1]);
    const endY = (target.bbox[3] - pageView[1]) / (pageView[3] - pageView[1]);
    const exactY = target.text ? legacyRects(node, target.text, bboxY, endY, target.occurrence)[0]?.[1] : undefined;
    const y = target.rects?.[0]?.[1] ?? exactY ?? bboxY;
    scroll.scrollTo({ top: Math.max(0, node.offsetTop + node.clientHeight * y - scroll.clientHeight * .35), behavior: "smooth" });
  }, [target, pageView, rendered]);

  const onLoaded = useCallback((loaded: PDFPageProxy) => {
    setPageView(loaded.view as [number, number, number, number]);
  }, []);
  const onTextReady = useCallback(() => setRendered(value => value + 1), []);

  const onMouseUp = () => {
    const selection = window.getSelection();
    const node = pageNode();
    if (!selection || !node || !selection.rangeCount || !node.contains(selection.anchorNode)) return;
    const text = selection.toString().trim();
    if (text) {
      const rects = normalizedRects(selection.getRangeAt(0), node);
      const center = rects[0] && pageView ? [pageView[0] + (rects[0][0] + rects[0][2]) / 2 * (pageView[2] - pageView[0]),
        pageView[1] + (rects[0][1] + rects[0][3]) / 2 * (pageView[3] - pageView[1])] as [number, number] : undefined;
      onSelection({ text, rects, pdfPoint: center });
    }
  };
  const onClick = (event: React.MouseEvent) => {
    if (window.getSelection()?.toString().trim() || !pageView) return;
    const node = pageNode();
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const x = pageView[0] + (event.clientX - rect.left) / rect.width * (pageView[2] - pageView[0]);
    const y = pageView[1] + (event.clientY - rect.top) / rect.height * (pageView[3] - pageView[1]);
    onPageClick(x, y);
  };

  return <div className="pdf-stage" ref={root} onMouseUp={onMouseUp} onClick={onClick}>
    <Document file={`${API}/api/papers/${paperId}/file`} loading={<div className="pdf-loading">正在加载 PDF…</div>} onLoadError={e => setError(e.message)}>
      <Page pageNumber={page} width={width} renderTextLayer renderAnnotationLayer onLoadSuccess={onLoaded} onRenderTextLayerSuccess={onTextReady}/>
    </Document>
    {pageView && <div className="pdf-mark-layer" aria-hidden="true">
      {annotations.filter(a => a.page === page && a.source !== "zh").flatMap(a => {
        const node = pageNode();
        const rects = a.rects.length ? a.rects : node ? legacyRects(node, a.text) : [];
        return rects.map((rect, index) => <div key={`${a.id}-${index}`} className={`pdf-mark ${a.kind} color-${a.color}`}
          style={{ left: `${rect[0] * 100}%`, top: `${rect[1] * 100}%`, width: `${(rect[2] - rect[0]) * 100}%`, height: `${(rect[3] - rect[1]) * 100}%` }}/>);
      })}
      {target && (() => {
        const node = pageNode();
        const preferredY = (target.bbox[1] - pageView[1]) / (pageView[3] - pageView[1]);
        const endY = (target.bbox[3] - pageView[1]) / (pageView[3] - pageView[1]);
        const exact = target.rects?.length ? target.rects : node && target.text ? legacyRects(node, target.text, preferredY, endY, target.occurrence) : [];
        const rects = exact.length ? exact : target.boxes.map(box => [
          (box[0] - pageView[0]) / (pageView[2] - pageView[0]),
          (box[1] - pageView[1]) / (pageView[3] - pageView[1]),
          (box[2] - pageView[0]) / (pageView[2] - pageView[0]),
          (box[3] - pageView[1]) / (pageView[3] - pageView[1]),
        ]);
        return rects.map((rect, index) => <div key={target.id + "-" + index}
          className={`pdf-target ${target.kind === "search" ? "pdf-search-target" : ""}`}
          style={{ left: `${rect[0] * 100}%`, top: `${rect[1] * 100}%`,
            width: `${(rect[2] - rect[0]) * 100}%`, height: `${(rect[3] - rect[1]) * 100}%` }} />);
      })()}
    </div>}
    {error && <div className="error-box">PDF 加载失败：{error}</div>}
  </div>;
}

export default memo(PdfViewer);
