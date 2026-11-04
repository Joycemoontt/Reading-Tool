import type { ReadingLanguage, TtsProvider, VoiceOption } from "./audio-core.ts";

export class BrowserSpeechProvider implements TtsProvider {
  private active = 0;

  available(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  }

  voices(): VoiceOption[] {
    if (!this.available()) return [];
    return window.speechSynthesis.getVoices()
      .filter(voice => /^(en|zh)(-|$)/i.test(voice.lang))
      .map(voice => ({ id: voice.voiceURI, name: voice.name, lang: voice.lang }));
  }

  onVoicesChanged(listener: () => void): () => void {
    if (!this.available()) return () => {};
    window.speechSynthesis.addEventListener("voiceschanged", listener);
    listener();
    return () => window.speechSynthesis.removeEventListener("voiceschanged", listener);
  }

  speak(text: string, options: {
    language: ReadingLanguage;
    speed: number;
    voiceId?: string;
    onStart?: () => void;
    onBoundary?: (charIndex: number) => void;
    onEnd?: () => void;
    onError?: (message: string) => void;
  }): void {
    if (!this.available()) {
      options.onError?.("此浏览器不支持语音合成");
      return;
    }
    const synth = window.speechSynthesis;
    const token = ++this.active;
    synth.cancel();
    synth.resume();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.language === "zh" ? "zh-CN" : "en-US";
    utterance.rate = options.speed;
    const selected = synth.getVoices().find(voice => voice.voiceURI === options.voiceId);
    if (selected && selected.lang.toLowerCase().startsWith(options.language)) utterance.voice = selected;
    utterance.onstart = () => { if (token === this.active) options.onStart?.(); };
    utterance.onboundary = event => { if (token === this.active) options.onBoundary?.(event.charIndex); };
    utterance.onend = () => { if (token === this.active) options.onEnd?.(); };
    utterance.onerror = event => {
      if (token === this.active) {
        options.onError?.(`朗读失败：${event.error}`);
      }
    };
    synth.speak(utterance);
  }

  pause(): void { if (this.available()) window.speechSynthesis.pause(); }
  resume(): void { if (this.available()) window.speechSynthesis.resume(); }
  stop(): void {
    ++this.active;
    if (this.available()) window.speechSynthesis.cancel();
  }
}

type RecognitionResult = { transcript: string; isFinal: boolean };
type RecognitionError = { error: string };
type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: RecognitionError) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionConstructor = new () => RecognitionLike;

export function speechRecognitionAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const browser = window as typeof window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return !!(browser.SpeechRecognition || browser.webkitSpeechRecognition);
}

export class BrowserVoiceInput {
  private recognition: RecognitionLike | null = null;

  start(language: "en-US" | "zh-CN", onText: (result: RecognitionResult) => void, onError: (message: string) => void, onStop: () => void): boolean {
    if (!speechRecognitionAvailable() || this.recognition) return false;
    const browser = window as typeof window & {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    };
    const Constructor = browser.SpeechRecognition || browser.webkitSpeechRecognition!;
    const recognition = new Constructor();
    this.recognition = recognition;
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        onText({ transcript: result[0].transcript, isFinal: result.isFinal });
      }
    };
    recognition.onerror = event => {
      const messages: Record<string, string> = {
        "not-allowed": "麦克风权限被拒绝，请在浏览器设置中允许使用麦克风",
        "audio-capture": "未找到可用的麦克风",
        "no-speech": "没有识别到语音，请重试",
        "network": "语音识别服务不可用，请改用文字输入",
      };
      onError(messages[event.error] || `语音识别失败：${event.error}`);
    };
    recognition.onend = () => {
      if (this.recognition === recognition) this.recognition = null;
      onStop();
    };
    try {
      recognition.start();
      return true;
    } catch (error) {
      this.recognition = null;
      onError(error instanceof Error ? error.message : "无法启动语音识别");
      return false;
    }
  }

  stop(): void { this.recognition?.stop(); }
  dispose(): void {
    const recognition = this.recognition;
    this.recognition = null;
    recognition?.abort();
  }
}

export function attachMediaSession(handlers: {
  play: () => void;
  pause: () => void;
  previous: () => void;
  next: () => void;
  stop: () => void;
}): () => void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return () => {};
  const session = navigator.mediaSession;
  const actions = {
    play: handlers.play,
    pause: handlers.pause,
    previoustrack: handlers.previous,
    nexttrack: handlers.next,
    stop: handlers.stop,
  } as const;
  for (const [action, handler] of Object.entries(actions)) {
    try { session.setActionHandler(action as MediaSessionAction, handler); } catch { /* unsupported action */ }
  }
  return () => {
    for (const action of Object.keys(actions)) {
      try { session.setActionHandler(action as MediaSessionAction, null); } catch { /* unsupported action */ }
    }
    session.playbackState = "none";
  };
}
