"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, FileText, Folder as FolderIcon, FolderPlus, Search, Trash2, Upload } from "lucide-react";
import { Folder, Paper, request } from "@/lib/api";
import { createUploadQueue } from "@/lib/upload-queue";

type FolderFilter = "all" | "unsorted" | string;

export default function Library() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeFolder, setActiveFolder] = useState<FolderFilter>("all");
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState("");
  const [dragging, setDragging] = useState(false);
  const [folderDrop, setFolderDrop] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const uploadQueue = useRef<ReturnType<typeof createUploadQueue<{ files: File[]; folder: string | null }>> | null>(null);

  async function refresh() {
    const [nextPapers, nextFolders] = await Promise.all([request<Paper[]>("/api/papers"), request<Folder[]>("/api/folders")]);
    setPapers(nextPapers); setFolders(nextFolders);
  }
  useEffect(() => { void refresh().catch(e => setError((e as Error).message)); }, []);

  async function uploadFiles(files: File[], folder: string | null) {
    if (!files.length) return;
    setError("");
    const failures: string[] = [];
    try { for (let index = 0; index < files.length; index++) {
      const file = files[index];
      if (!file.name.toLowerCase().endsWith(".pdf") || file.size > 30 * 1024 * 1024 || file.size === 0) {
        failures.push(file.name + "：仅支持不超过 30 MB 的 PDF"); continue;
      }
      setUploading("正在处理 " + (index + 1) + "/" + files.length + "：" + file.name);
      try {
        const form = new FormData();
        form.append("file", file);
        await request<Paper>("/api/papers" + (folder ? "?folder_id=" + encodeURIComponent(folder) : ""), { method: "POST", body: form });
        await refresh();
      } catch (e) { failures.push(file.name + "：" + (e as Error).message); }
    }} finally {
      setUploading("");
      if (input.current) input.current.value = "";
      setDragging(false); setFolderDrop(null);
      if (failures.length) setError(failures.join("；"));
    }
  }

  if (!uploadQueue.current) uploadQueue.current = createUploadQueue(({ files, folder }) => uploadFiles(files, folder));
  function enqueueFiles(files: File[], folder: string | null) {
    if (!files.length) return;
    void uploadQueue.current!.enqueue({ files, folder }).catch(e => setError((e as Error).message));
  }

  async function createFolder() {
    const name = folderName.trim();
    if (!name) return;
    try {
      const created = await request<Folder>("/api/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      await refresh(); setActiveFolder(created.id); setError(""); setEditingFolder(null); setFolderName("");
    } catch (e) { setError((e as Error).message); }
  }
  async function renameFolder(folder: Folder) {
    const name = folderName.trim();
    if (!name || name === folder.name) return;
    try { await request("/api/folders/" + folder.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); await refresh(); setEditingFolder(null); setFolderName(""); }
    catch (e) { setError((e as Error).message); }
  }
  async function deleteFolder(folder: Folder) {
    if (!confirm("删除“" + folder.name + "”？其中的论文会移至“未分类”，不会删除论文。")) return;
    try { await request("/api/folders/" + folder.id, { method: "DELETE" }); if (activeFolder === folder.id) setActiveFolder("unsorted"); await refresh(); }
    catch (e) { setError((e as Error).message); }
  }
  async function movePaper(paper: Paper, folderId: string | null) {
    try {
      await request("/api/papers/" + paper.id + "/folder", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId }) });
      await refresh();
    } catch (e) { setError((e as Error).message); }
  }
  async function remove(paper: Paper) {
    if (!confirm("删除《" + paper.title + "》及其全部阅读记录？")) return;
    try { await request("/api/papers/" + paper.id, { method: "DELETE" }); await refresh(); }
    catch (e) { setError((e as Error).message); }
  }

  const filtered = papers.filter(p => (activeFolder === "all" || (activeFolder === "unsorted" ? !p.folderId : p.folderId === activeFolder))
    && (p.title + " " + p.filename).toLowerCase().includes(search.toLowerCase()));
  const uploadFolder = activeFolder === "all" || activeFolder === "unsorted" ? null : activeFolder;
  const activeName = activeFolder === "all" ? "全部论文" : activeFolder === "unsorted" ? "未分类" : folders.find(f => f.id === activeFolder)?.name || "全部论文";

  return <main className={"library-v2 " + (dragging ? "is-dragging" : "")}
    onDragEnter={e => { if (e.dataTransfer.types.includes("Files")) setDragging(true); }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setDragging(false); setFolderDrop(null); } }}
    onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragging(true); } }}
    onDrop={e => { e.preventDefault(); setDragging(false); enqueueFiles(Array.from(e.dataTransfer.files), uploadFolder); setFolderDrop(null); }}>
    <header className="library-v2-header"><div className="brand"><div className="brand-mark"><BookOpen size={18}/></div><span>PaperMind</span></div><span className="subtle">论文阅读与学习</span></header>
    <div className="library-v2-layout">
      <nav className="library-nav" aria-label="论文文件夹">
        <div className="library-nav-title"><span>文献库</span><button title="新建文件夹" onClick={() => { setEditingFolder("new"); setFolderName(""); }}><FolderPlus size={17}/></button></div>
        {editingFolder === "new" && <div className="folder-editor"><input autoFocus aria-label="新文件夹名称" value={folderName} onChange={e => setFolderName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void createFolder(); if (e.key === "Escape") setEditingFolder(null); }}/><button onClick={() => void createFolder()}>创建</button></div>}
        <button className={activeFolder === "all" ? "active" : ""} onClick={() => setActiveFolder("all")}><BookOpen size={16}/> 全部论文 <span>{papers.length}</span></button>
        <button className={activeFolder === "unsorted" ? "active" : ""} onClick={() => setActiveFolder("unsorted")}><FolderIcon size={16}/> 未分类 <span>{papers.filter(p => !p.folderId).length}</span></button>
        {folders.map(folder => <div key={folder.id} className={"folder-row " + (folderDrop === folder.id ? "drop-target" : "")}
          onDragOver={e => { e.preventDefault(); setFolderDrop(folder.id); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFolderDrop(null); }}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragging(false); setFolderDrop(null); enqueueFiles(Array.from(e.dataTransfer.files), folder.id); }}>
          {editingFolder === folder.id ? <div className="folder-editor"><input autoFocus aria-label="重命名文件夹" value={folderName} onChange={e => setFolderName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void renameFolder(folder); if (e.key === "Escape") setEditingFolder(null); }}/><button onClick={() => void renameFolder(folder)}>保存</button></div> :
            <button className={activeFolder === folder.id ? "active" : ""} onClick={() => setActiveFolder(folder.id)}><FolderIcon size={16}/>{folder.name}<span>{papers.filter(p => p.folderId === folder.id).length}</span></button>}
          <button className="folder-more" title="重命名文件夹" onClick={() => { setEditingFolder(folder.id); setFolderName(folder.name); }}>···</button>
          <button className="folder-more" title="删除文件夹" onClick={() => void deleteFolder(folder)}><Trash2 size={13}/></button>
        </div>)}
      </nav>
      <section className="library-v2-main">
        <div className="library-v2-heading"><div><h1>{activeName}</h1><p>{filtered.length} 篇论文</p></div><button className="primary-button" onClick={() => input.current?.click()}><Upload size={16}/>上传 PDF</button><input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ""; enqueueFiles(files, uploadFolder); }}/></div>
        <div className="search-box"><Search size={17}/><input placeholder="搜索论文" value={search} onChange={e => setSearch(e.target.value)}/></div>
        {uploading && <div className="upload-status" role="status">{uploading}</div>}
        {error && <div className="error-box" role="alert">{error}</div>}
        {filtered.length ? <div className="paper-list">{filtered.map(p => <div className="paper-row" key={p.id}>
          <div className="paper-icon"><FileText size={20}/></div>
          <Link className="paper-main" href={"/paper/" + p.id}><strong>{p.title}</strong><span>{p.filename} · {p.pages} 页 · 阅读至第 {p.page} 页</span></Link>
          <select aria-label={"移动论文 " + p.title} value={p.folderId || ""} onChange={e => void movePaper(p, e.target.value || null)}><option value="">未分类</option>{folders.map(folder => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select>
          <Link className="icon-button" title="打开论文" href={"/paper/" + p.id}><ArrowUpRight size={17}/></Link>
          <button className="icon-button danger" title="删除论文" onClick={() => void remove(p)}><Trash2 size={16}/></button>
        </div>)}</div> : <div className="empty-state"><FileText size={25}/><h3>{search ? "没有找到论文" : "这里还没有论文"}</h3><p>{search ? "试试其他关键词" : "拖入 PDF，或点击右上角上传。"}</p></div>}
      </section>
    </div>
    {dragging && <div className="drop-overlay"><strong>松开以导入 PDF</strong><span>拖到左侧文件夹可直接分类 · 支持多文件</span></div>}
  </main>;
}
