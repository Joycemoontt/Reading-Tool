export const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export type Paper = { id: string; title: string; filename: string; folderId: string | null; pages: number; createdAt: string; page: number; mode: "dual" | "paragraph" | "original" };
export type Folder = { id: string; name: string };
export type Paragraph = { id: string; paperId: string; page: number; order: number; sectionId: string; text: string; translation: string | null; speech: Record<string, string>; bbox: number[]; boxes: number[][]; kind: string };
export type Annotation = { id: string; paragraphId: string | null; page: number; text: string; color: string; kind: string; source: "en" | "zh"; rects: number[][] };
export type Note = { id: string; paragraphId: string | null; page: number; selectedText: string; content: string };
export type Interaction = { id: string; question: string; answer: string; paragraphId: string | null; page: number | null; inputMode: "text" | "voice"; createdAt: string };
export type Vocabulary = { id: string; word: string; meaning: string; context: string; sourceSentence: string; page: number; reviewStatus: string; nextReviewAt: string };
export type QuizQuestion = { id: string; kind: string; prompt: string; options: string[]; attempt: null | { answer: string; score: number; feedback: string } };

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const signal = init?.signal || (typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(90000) : undefined);
    response = await fetch(`${API}${path}`, { ...init, signal });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError"))
      throw new Error("请求超时，请重试");
    throw new Error("无法连接本地后端，请确认 FastAPI 已在 127.0.0.1:8000 启动");
  }
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const body = await response.json();
      message = typeof body.detail === "string" ? body.detail : message;
    } catch { /* response may not be JSON */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function json(data: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}
