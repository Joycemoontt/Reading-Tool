import test from "node:test";
import assert from "node:assert/strict";
import { ReadingSession, speechText } from "../src/lib/audio-core.ts";
import { BrowserSpeechProvider, BrowserVoiceInput, speechRecognitionAvailable } from "../src/lib/browser-speech.ts";

const paragraphs = [
  { id: "p1", sectionId: "s1", page: 1, sourceText: "World models [1, 2] predict future states.", translatedText: "世界模型预测未来状态。" },
  { id: "p2", sectionId: "s1", page: 1, sourceText: "Latent dynamics are compact.", translatedText: "潜在动力学是紧凑的。" },
  { id: "p3", sectionId: "s2", page: 2, sourceText: "The conclusion is limited.", translatedText: null },
];

class MockTts {
  calls = [];
  paused = false;
  available() { return true; }
  voices() { return []; }
  onVoicesChanged() { return () => {}; }
  speak(text, options) { this.calls.push({ text, options }); }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  stop() { this.stopped = (this.stopped || 0) + 1; }
}

test("speech text keeps source intact and removes optional citation markers", () => {
  assert.equal(speechText(paragraphs[0], "en"), "World models predict future states.");
  assert.equal(speechText(paragraphs[0], "en", false), "World models [1, 2] predict future states.");
  assert.equal(paragraphs[0].sourceText, "World models [1, 2] predict future states.");
  assert.equal(speechText({ ...paragraphs[0], sourceText: "bad \ufffd" }, "en"), null);
  assert.equal(speechText(paragraphs[2], "zh"), null);
});

test("unsupported browsers leave text input available", () => {
  assert.equal(new BrowserSpeechProvider().available(), false);
  assert.equal(speechRecognitionAvailable(), false);
});

test("read, pause, resume, skip and restore position", async () => {
  const tts = new MockTts();
  const saved = [];
  const store = { load: async () => null, save: async value => { saved.push(value); } };
  const session = new ReadingSession("paper-1", tts, store);
  await session.load(paragraphs, "full");
  session.play();
  session.play();
  assert.equal(tts.calls.length, 1, "repeated play must not queue twice");
  assert.equal(tts.calls[0].text, "World models predict future states.");
  tts.calls[0].options.onBoundary(14);
  session.pause();
  assert.equal(tts.paused, true);
  session.play();
  assert.equal(tts.paused, false);
  session.next();
  assert.equal(session.snapshot().paragraphId, "p2");
  assert.equal(tts.calls.at(-1).text, "Latent dynamics are compact.");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(saved.at(-1).paragraphId, "p2");
  session.stop();
  const resumed = new ReadingSession("paper-1", new MockTts(), { load: async () => saved.at(-1), save: async () => {} });
  await resumed.load(paragraphs, "full");
  assert.equal(resumed.snapshot().paragraphId, "p2");
});

test("obsolete utterance callback cannot advance after seeking", async () => {
  const tts = new MockTts();
  const session = new ReadingSession("paper-1", tts, { load: async () => null, save: async () => {} });
  await session.load(paragraphs, "full");
  session.play();
  const firstEnd = tts.calls[0].options.onEnd;
  session.seek(2);
  firstEnd();
  assert.equal(session.snapshot().paragraphId, "p3");
});

test("section and Chinese playback skip unavailable translations", async () => {
  const tts = new MockTts();
  const session = new ReadingSession("paper-1", tts, { load: async () => null, save: async () => {} });
  await session.load(paragraphs, "section", "p2");
  assert.equal(session.snapshot().total, 2);
  await session.load(paragraphs, "full");
  session.setLanguage("zh");
  session.play();
  assert.equal(tts.calls[0].text, "世界模型预测未来状态。");
  tts.calls[0].options.onEnd();
  assert.equal(tts.calls[1].text, "潜在动力学是紧凑的。");
});

test("browser TTS controls real synthesis interface and reports playback errors", () => {
  const calls = [];
  globalThis.window = { speechSynthesis: {
    getVoices: () => [{ voiceURI: "en-voice", name: "English", lang: "en-US" }, { voiceURI: "zh-voice", name: "Chinese", lang: "zh-CN" }],
    addEventListener: () => {}, removeEventListener: () => {},
    cancel: () => calls.push("cancel"), speak: utterance => calls.push(utterance), pause: () => calls.push("pause"), resume: () => calls.push("resume"),
  }, SpeechSynthesisUtterance: class {} };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  const provider = new BrowserSpeechProvider();
  assert.equal(provider.available(), true);
  assert.equal(provider.voices().length, 2);
  let error = "";
  provider.speak("Hello", { language: "en", speed: 1.25, voiceId: "en-voice", onError: value => error = value });
  const utterance = calls.at(-1);
  assert.equal(utterance.text, "Hello");
  assert.equal(utterance.rate, 1.25);
  assert.equal(utterance.voice.voiceURI, "en-voice");
  utterance.onerror({ error: "audio-busy" });
  assert.match(error, /audio-busy/);
  provider.pause(); provider.resume(); provider.stop();
  assert.deepEqual(calls.slice(-3), ["pause", "resume", "cancel"]);
  delete globalThis.window;
  delete globalThis.SpeechSynthesisUtterance;
});

test("voice input surfaces final transcript and permission errors", () => {
  let instance;
  class Recognition {
    constructor() { instance = this; }
    start() { this.started = true; }
    stop() { this.onend(); }
    abort() {}
  }
  globalThis.window = { SpeechRecognition: Recognition };
  assert.equal(speechRecognitionAvailable(), true);
  const input = new BrowserVoiceInput();
  const results = []; const errors = []; let stopped = false;
  assert.equal(input.start("zh-CN", result => results.push(result), value => errors.push(value), () => stopped = true), true);
  instance.onresult({ resultIndex: 0, results: [{ 0: { transcript: "latent dynamics 是什么" }, isFinal: true }] });
  instance.onerror({ error: "not-allowed" });
  input.stop();
  assert.equal(results[0].transcript, "latent dynamics 是什么");
  assert.match(errors[0], /权限/);
  assert.equal(stopped, true);
  delete globalThis.window;
});
