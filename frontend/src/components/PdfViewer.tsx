"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFPageProxy } from "pdfjs-dist";
import { API, Annotation } from "@/lib/api";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export type SelectionGeometry = { text: string; rects: number[][] };

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

function legacyRects(page: HTMLElement, text: string): number[][] {
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
  const start = haystack.toLocaleLowerCase().indexOf(needle);
  if (start < 0 || !points[start] || !points[start + needle.length - 1]) return [];
  const range = document.createRange();
  range.setStart(points[start].node, points[start].offset);
  range.setEnd(points[start + needle.length - 1].node, points[start + needle.length - 1].offset + 1);
  return normalizedRects(range, page);
}

function PdfViewer({ paperId, page, width, annotations, target, onSelection, onPageClick }: {
  paperId: string; page: number; width: number; annotations: Annotation[];
  target: { id: string; bbox: number[]; boxes: number[][] } | null;
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
    const y = (target.bbox[1] - pageView[1]) / (pageView[3] - pageView[1]);
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
    if (text) onSelection({ text, rects: normalizedRects(selection.getRangeAt(0), node) });
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
      {target && target.boxes.map((box, index) => <div key={target.id + "-" + index} className="pdf-target" style={{
        left: `${(box[0] - pageView[0]) / (pageView[2] - pageView[0]) * 100}%`,
        top: `${(box[1] - pageView[1]) / (pageView[3] - pageView[1]) * 100}%`,
        width: `${(box[2] - box[0]) / (pageView[2] - pageView[0]) * 100}%`,
        height: `${(box[3] - box[1]) / (pageView[3] - pageView[1]) * 100}%`,
      }}/>)}
    </div>}
    {error && <div className="error-box">PDF 加载失败：{error}</div>}
  </div>;
}

export default memo(PdfViewer);
