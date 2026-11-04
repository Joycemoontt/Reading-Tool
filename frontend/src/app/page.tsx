"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, FileText, Plus, Search, Trash2, Upload } from "lucide-react";
import { Paper, request } from "@/lib/api";

export default function Library() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function refresh() {
    try { setPapers(await request<Paper[]>("/api/papers")); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void refresh(); }, []);

  async function upload(file?: File) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.append("file", file);
      await request<Paper>("/api/papers", { method: "POST", body: form });
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }

  async function remove(paper: Paper) {
    if (!confirm(`删除《${paper.title}》及其阅读记录？`)) return;
    try { await request(`/api/papers/${paper.id}`, { method: "DELETE" }); await refresh(); }
    catch (e) { setError((e as Error).message); }
  }

  const filtered = papers.filter(p => `${p.title} ${p.filename}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="library-shell" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files[0]); }}>
    <header className="library-top"><div className="brand"><div className="brand-mark"><BookOpen size={19}/></div><span>PaperMind</span></div><span className="subtle">Research reading, made thoughtful.</span></header>
    <section className="library-hero"><div><div className="eyebrow">YOUR RESEARCH SPACE</div><h1>让每一篇论文，<br/>都读得更深一点。</h1><p>阅读原文、对照翻译、随手提问，也能闭上眼睛继续学习。</p></div><div className="hero-ornament"><span>PM</span><div className="hero-lines"/></div></section>
    <section className="library-content"><div className="section-heading"><div><div className="eyebrow">LIBRARY</div><h2>我的论文 <span>{papers.length}</span></h2></div><button className="primary-button" disabled={busy} onClick={() => input.current?.click()}><Plus size={17}/>{busy ? "正在解析…" : "上传 PDF"}</button><input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={e => void upload(e.target.files?.[0])}/></div>
      <div className="search-box"><Search size={17}/><input placeholder="搜索论文标题或文件名" value={search} onChange={e => setSearch(e.target.value)}/></div>
      {error && <div className="error-box">{error}</div>}
      {filtered.length ? <div className="paper-list">{filtered.map(p => <div className="paper-row" key={p.id}><div className="paper-icon"><FileText size={22}/></div><Link className="paper-main" href={`/paper/${p.id}`}><strong>{p.title}</strong><span>{p.filename} · {p.pages} 页 · 上次读到第 {p.page} 页</span></Link><div className="paper-progress"><div style={{width:`${Math.round(p.page / p.pages * 100)}%`}}/></div><Link className="icon-button" title="打开论文" href={`/paper/${p.id}`}><ArrowUpRight size={18}/></Link><button className="icon-button danger" title="删除论文" onClick={() => void remove(p)}><Trash2 size={17}/></button></div>)}</div> : <div className="empty-state"><div className="empty-icon"><Upload size={25}/></div><h3>{search ? "没有找到论文" : "从第一篇论文开始"}</h3><p>{search ? "试试其他关键词" : "上传或拖入 PDF，开始你的研究阅读。"}</p>{!search && <button className="text-button" onClick={() => input.current?.click()}>选择 PDF <ArrowUpRight size={16}/></button>}</div>}
    </section><footer className="library-footer">PaperMind · 思考，从阅读开始</footer>
  </main>;
}
