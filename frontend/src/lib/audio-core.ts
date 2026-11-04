export type ReadingLanguage = "en" | "zh";
export type ReadingScope = "full" | "section" | "selection";
export type ReadingStatus = "idle" | "playing" | "paused" | "ended" | "error";

export interface ReadingParagraph {
  id: string;
  sectionId: string;
  page: number;
  sourceText: string;
  translatedText?: string | null;
  /** Optional verified speech text, e.g. a cached explanation of a formula. */
  sourceSpeechText?: string | null;
  translatedSpeechText?: string | null;
}

export interface ReadingPosition {
  paperId: string;
  paragraphId: string;
  sectionId: string;
  language: ReadingLanguage;
  speed: number;
  charIndex: number;
  updatedAt: string;
}

export interface PositionStore {
  load(paperId: string): Promise<ReadingPosition | null>;
  save(position: ReadingPosition): Promise<void>;
}

export interface VoiceOption {
  id: string;
  name: string;
  lang: string;
}

export interface TtsProvider {
  available(): boolean;
  voices(): VoiceOption[];
  onVoicesChanged(listener: () => void): () => void;
  speak(text: string, options: {
    language: ReadingLanguage;
    speed: number;
    voiceId?: string;
    onStart?: () => void;
    onBoundary?: (charIndex: number) => void;
    onEnd?: () => void;
    onError?: (message: string) => void;
  }): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface ReadingSnapshot {
  status: ReadingStatus;
  paragraphId: string | null;
  index: number;
  total: number;
  charIndex: number;
  language: ReadingLanguage;
  speed: number;
  error: string | null;
}

export const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

/** Reject visibly corrupt extraction rather than reading it as if it were paper text. */
export function speechText(paragraph: ReadingParagraph, language: ReadingLanguage, simplifyCitations = true): string | null {
  const raw = language === "en"
    ? paragraph.sourceSpeechText || paragraph.sourceText
    : paragraph.translatedSpeechText || paragraph.translatedText;
  if (!raw) return null;
  let result = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!result || result.includes("\ufffd") || /(?:\S\s){12,}\S/.test(result)) return null;
  // Citation markers are omitted only from speech; the stored source is untouched.
  if (simplifyCitations) result = result.replace(/\[(?:\d+(?:\s*[-,–]\s*\d+)*)\]/g, "");
  return result.replace(/\s+/g, " ").trim() || null;
}

export class ReadingSession {
  private paperId: string;
  private provider: TtsProvider;
  private store: PositionStore;
  private queue: ReadingParagraph[] = [];
  private current = 0;
  private charIndex = 0;
  private language: ReadingLanguage = "en";
  private speed = 1;
  private voiceId?: string;
  private simplifyCitations = true;
  private status: ReadingStatus = "idle";
  private error: string | null = null;
  private generation = 0;
  private listeners = new Set<(snapshot: ReadingSnapshot) => void>();
  private saveChain: Promise<void> = Promise.resolve();
  private lastSavedAt = 0;

  constructor(paperId: string, provider: TtsProvider, store: PositionStore) {
    this.paperId = paperId;
    this.provider = provider;
    this.store = store;
  }

  subscribe(listener: (snapshot: ReadingSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): ReadingSnapshot {
    return {
      status: this.status,
      paragraphId: this.queue[this.current]?.id ?? null,
      index: this.current,
      total: this.queue.length,
      charIndex: this.charIndex,
      language: this.language,
      speed: this.speed,
      error: this.error,
    };
  }

  async load(paragraphs: ReadingParagraph[], scope: ReadingScope, anchorId?: string): Promise<void> {
    this.provider.stop();
    const loadGeneration = ++this.generation;
    const anchor = paragraphs.find(p => p.id === anchorId);
    this.queue = scope === "section" && anchor
      ? paragraphs.filter(p => p.sectionId === anchor.sectionId)
      : scope === "selection" && anchor ? [anchor] : [...paragraphs];
    this.current = Math.max(0, this.queue.findIndex(p => p.id === anchorId));
    this.charIndex = 0;
    this.status = "idle";
    this.error = null;
    if (!anchorId && scope === "full") {
      const saved = await this.store.load(this.paperId);
      if (loadGeneration !== this.generation) return;
      if (saved && saved.paperId === this.paperId) {
        const index = this.queue.findIndex(p => p.id === saved.paragraphId);
        if (index >= 0) {
          this.current = index;
          this.charIndex = Math.max(0, saved.charIndex);
          this.language = saved.language;
          this.speed = SPEEDS.includes(saved.speed as typeof SPEEDS[number]) ? saved.speed : 1;
        }
      }
    }
    this.emit();
  }

  play(): void {
    if (!this.provider.available()) return this.fail("此浏览器不支持语音合成");
    if (this.status === "ended") { this.current = 0; this.charIndex = 0; this.status = "idle"; }
    if (this.status === "paused") {
      this.provider.resume();
      this.status = "playing";
      this.emit();
      return;
    }
    if (!this.queue.length) return this.fail("没有可朗读的段落");
    if (this.status === "playing") return;
    this.speakCurrent();
  }

  pause(): void {
    if (this.status !== "playing") return;
    this.provider.pause();
    this.status = "paused";
    this.persist(true);
    this.emit();
  }

  stop(): void {
    ++this.generation;
    this.provider.stop();
    this.status = "idle";
    this.persist(true);
    this.emit();
  }

  seek(index: number): void {
    if (index < 0 || index >= this.queue.length) return;
    const wasPlaying = this.status === "playing";
    ++this.generation;
    this.provider.stop();
    this.current = index;
    this.charIndex = 0;
    this.status = "idle";
    this.persist(true);
    this.emit();
    if (wasPlaying) this.speakCurrent();
  }

  next(): void { this.seek(this.current + 1); }
  previous(): void { this.seek(this.current - 1); }

  setLanguage(language: ReadingLanguage): void {
    if (this.language === language) return;
    this.language = language;
    this.restartFromParagraph(true);
  }

  setSpeed(speed: number): void {
    if (!SPEEDS.includes(speed as typeof SPEEDS[number])) return;
    this.speed = speed;
    this.restartFromParagraph();
  }

  setVoice(voiceId?: string): void {
    this.voiceId = voiceId;
    this.restartFromParagraph();
  }

  setSimplifyCitations(value: boolean): void {
    if (this.simplifyCitations === value) return;
    this.simplifyCitations = value;
    this.restartFromParagraph(true);
  }

  /** Capture paper context before recognition or answer speech changes synthesis state. */
  context(): { paragraph: ReadingParagraph | null; previous: ReadingParagraph | null; next: ReadingParagraph | null; position: ReadingPosition | null } {
    const paragraph = this.queue[this.current] ?? null;
    return {
      paragraph,
      previous: this.queue[this.current - 1] ?? null,
      next: this.queue[this.current + 1] ?? null,
      position: paragraph ? this.position() : null,
    };
  }

  private restartFromParagraph(resetIndex = false): void {
    const wasPlaying = this.status === "playing";
    ++this.generation;
    this.provider.stop();
    if (resetIndex) this.charIndex = 0;
    this.status = "idle";
    this.persist(true);
    this.emit();
    if (wasPlaying) this.speakCurrent();
  }

  private speakCurrent(): void {
    while (this.current < this.queue.length && !speechText(this.queue[this.current], this.language, this.simplifyCitations)) this.current++;
    if (this.current >= this.queue.length) {
      this.status = "ended";
      this.emit();
      return;
    }
    const text = speechText(this.queue[this.current], this.language, this.simplifyCitations)!;
    // A browser may not offer exact word resume. Restart from a safe word boundary.
    const start = Math.min(this.charIndex, text.length);
    const safeStart = start > 0 ? Math.max(0, text.lastIndexOf(" ", start) + 1) : 0;
    const generation = ++this.generation;
    this.status = "playing";
    this.error = null;
    this.emit();
    this.persist(true);
    this.provider.speak(text.slice(safeStart), {
      language: this.language,
      speed: this.speed,
      voiceId: this.voiceId,
      onBoundary: index => {
        if (generation !== this.generation) return;
        this.charIndex = safeStart + index;
        this.persist();
        this.emit();
      },
      onEnd: () => {
        if (generation !== this.generation) return;
        this.current++;
        this.charIndex = 0;
        this.persist(true);
        this.speakCurrent();
      },
      onError: message => {
        if (generation !== this.generation) return;
        this.fail(message);
      },
    });
  }

  private position(): ReadingPosition {
    const paragraph = this.queue[this.current];
    return {
      paperId: this.paperId,
      paragraphId: paragraph.id,
      sectionId: paragraph.sectionId,
      language: this.language,
      speed: this.speed,
      charIndex: this.charIndex,
      updatedAt: new Date().toISOString(),
    };
  }

  private persist(force = false): void {
    if (!this.queue[this.current]) return;
    const now = Date.now();
    if (!force && now - this.lastSavedAt < 2000) return;
    this.lastSavedAt = now;
    const position = this.position();
    this.saveChain = this.saveChain.catch(() => {}).then(() => this.store.save(position));
  }

  private fail(message: string): void {
    ++this.generation;
    this.provider.stop();
    this.status = "error";
    this.error = message;
    this.persist(true);
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
