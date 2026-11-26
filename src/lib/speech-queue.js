import { CONFIG } from "../config.js";

/**
 * Abreviaturas comunes en español e inglés que no deben partir una oración.
 */
const ABBREVIATION_LIST = [
  "Sr", "Sra", "Srta", "Dr", "Dra", "Prof", "Ing", "Lic", "Arq",
  "Ud", "Uds", "Vd", "Vds", "etc", "pág", "págs", "cap", "fig",
  "núm", "vol", "ed", "aprox", "ej", "tel", "av", "gral", "dept",
  "Mr", "Mrs", "Ms", "St", "Jr", "vs", "Inc", "Ltd", "Co", "No",
  "e.g", "i.e", "U.S"
];

const ABBR_PATTERN = new RegExp(
  `\\b(?:${ABBREVIATION_LIST.map((a) => a.replace(/\./g, "\\.")).join("|")})\\.$`,
  "i"
);

function countWords(text) {
  const clean = String(text || "").trim();
  return clean ? clean.split(/\s+/).filter(Boolean).length : 0;
}

function splitSentencesProtectingAbbreviations(paragraph) {
  const text = String(paragraph || "").replace(/\s+/g, " ").trim();
  if (!text) return [];

  const sentences = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== "." && ch !== "?" && ch !== "!" && ch !== ";" && ch !== "…") {
      continue;
    }

    // Consumir signos de cierre consecutivos (ej. "?!", "...", ".”")
    let end = i + 1;
    while (end < text.length && /[.?!;…"”'")\]]/.test(text[end])) {
      end += 1;
    }

    const nextChar = text[end] || "";
    const atBoundary = end >= text.length || /\s/.test(nextChar);
    if (!atBoundary) {
      // Ej. números decimales (3.14) o URLs (chaladev.site)
      continue;
    }

    if (ch === ".") {
      const prefix = text.slice(start, i + 1);
      // Proteger abreviaturas conocidas o iniciales simples ("J.")
      if (ABBR_PATTERN.test(prefix) || /(?:^|\s)[A-ZÁÉÍÓÚÑ]\.$/.test(prefix)) {
        continue;
      }
    }

    const segment = text.slice(start, end).trim();
    if (segment) {
      sentences.push(segment);
    }
    while (end < text.length && /\s/.test(text[end])) {
      end += 1;
    }
    start = end;
    i = end - 1;
  }

  const tail = text.slice(start).trim();
  if (tail) {
    sentences.push(tail);
  }
  return sentences;
}

function subdivideLongSentence(sentence, maxChars = 200, targetMin = 150) {
  const text = String(sentence || "").trim();
  if (text.length <= maxChars) {
    return [text];
  }

  const parts = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    const windowSlice = remaining.slice(0, maxChars + 1);
    let splitAt = -1;

    // 1. Preferir coma, dos puntos, punto y coma o guion cerca de ~180-200 chars
    for (let i = Math.min(maxChars, windowSlice.length - 1); i >= Math.min(targetMin, 80); i -= 1) {
      if (windowSlice[i] === "," || windowSlice[i] === ":" || windowSlice[i] === ";" || windowSlice[i] === "—") {
        splitAt = i + 1;
        break;
      }
    }

    // 2. Si no hubo puntuación interna, buscar el espacio más cercano antes de maxChars
    if (splitAt === -1) {
      splitAt = windowSlice.lastIndexOf(" ");
    }

    // 3. Último recurso si una palabra única excede maxChars
    if (splitAt <= 0) {
      splitAt = maxChars;
    }

    const piece = remaining.slice(0, splitAt).trim();
    if (piece) parts.push(piece);
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    parts.push(remaining);
  }
  return parts;
}

/**
 * Capa 1 — Subdivisión inteligente en chunks seguros para Chromium (< ~200 chars / < 15s).
 * Cada chunk conserva `paragraphIndex`, `sentenceIndex`, `subIndex` e `isParagraphEnd`.
 *
 * @param {string[]} paragraphs
 * @param {{ maxChars?: number }} [options]
 */
export function buildSpeechChunks(paragraphs, options = {}) {
  const maxChars = options.maxChars || 200;
  const list = Array.isArray(paragraphs) ? paragraphs : [];
  const chunks = [];

  for (let pIdx = 0; pIdx < list.length; pIdx += 1) {
    const paraText = String(list[pIdx] || "").replace(/\s+/g, " ").trim();
    if (!paraText) continue;

    const sentences = splitSentencesProtectingAbbreviations(paraText);
    const paraChunks = [];

    for (let sIdx = 0; sIdx < sentences.length; sIdx += 1) {
      const subParts = subdivideLongSentence(sentences[sIdx], maxChars);
      for (let subIdx = 0; subIdx < subParts.length; subIdx += 1) {
        paraChunks.push({
          chunkIndex: 0,
          paragraphIndex: pIdx,
          sentenceIndex: sIdx,
          subIndex: subIdx,
          text: subParts[subIdx],
          wordCount: countWords(subParts[subIdx]),
          isParagraphEnd: false
        });
      }
    }

    if (paraChunks.length > 0) {
      paraChunks[paraChunks.length - 1].isParagraphEnd = true;
      for (const ch of paraChunks) {
        ch.chunkIndex = chunks.length;
        chunks.push(ch);
      }
    }
  }

  return chunks;
}

/**
 * Calcula la duración límite del Watchdog para un chunk:
 * (palabras / (150 * rate)) * 60000 + 6000 ms.
 */
export function estimateWatchdogMs(wordCount, rate = 1.0) {
  const safeWords = Math.max(1, Number(wordCount) || 1);
  const safeRate = Math.max(0.5, Number(rate) || 1.0);
  return Math.round((safeWords / (150 * safeRate)) * 60000) + 6000;
}

/**
 * Motor de reproducción en 3 capas (Anti-congelamiento, Pausas diferenciadas, GC/Watchdog shield)
 * con soporte de presets acústicos y Sleep Timer con fade-out gradual.
 */
export class SpeechQueueEngine {
  constructor(options = {}) {
    this.synth = options.synth || (typeof speechSynthesis !== "undefined" ? speechSynthesis : null);
    this.UtteranceCtor =
      options.UtteranceCtor ||
      (typeof SpeechSynthesisUtterance !== "undefined" ? SpeechSynthesisUtterance : null);
    this.watchdogDurationFn = options.watchdogDurationFn || estimateWatchdogMs;

    this.chunks = [];
    this.currentIndex = 0;
    this.state = "idle"; // "idle" | "playing" | "paused"
    this.activeUtterance = null; // Capa 3: previene GC prematuro de onend en Chromium
    this.playbackToken = 0;

    this.nextTimer = null;
    this.watchdogTimer = null;

    // Parámetros acústicos
    this.rate = options.rate ?? 1.0;
    this.pitch = options.pitch ?? 1.0;
    this.volume = options.volume ?? 1.0;
    this.sentencePauseMs = options.sentencePauseMs ?? 120;
    this.paragraphPauseMs = options.paragraphPauseMs ?? 500;
    this.voice = options.voice || null;
    this.lang = options.lang || "";

    // Sleep Timer
    this.sleepEndAt = 0;
    this.sleepDurationMs = 0;
    this.sleepInterval = null;
    this.sleepFadeMultiplier = 1.0;

    // Callbacks
    this.onChunkStart = options.onChunkStart || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onSleepTick = options.onSleepTick || (() => {});
    this.onWatchdogRecovery = options.onWatchdogRecovery || (() => {});
    this.onError = options.onError || (() => {});
  }

  loadParagraphs(paragraphs, options = {}) {
    this.stop();
    this.chunks = buildSpeechChunks(paragraphs, options);
    this.currentIndex = Math.max(0, Math.min(options.startChunkIndex || 0, Math.max(0, this.chunks.length - 1)));
    this.emitProgress();
    return this.chunks;
  }

  applyPreset(presetId) {
    const preset = CONFIG.VOICE_PRESETS[presetId];
    if (!preset) return null;
    this.rate = preset.rate;
    this.pitch = preset.pitch;
    this.paragraphPauseMs = preset.paragraphPauseMs;
    this.sentencePauseMs = preset.sentencePauseMs;
    return preset;
  }

  setRate(rate) {
    this.rate = Math.min(2.0, Math.max(0.6, Number(rate) || 1.0));
  }

  setPitch(pitch) {
    this.pitch = Math.min(1.4, Math.max(0.6, Number(pitch) || 1.0));
  }

  setVolume(volume) {
    this.volume = Math.min(1.0, Math.max(0, Number(volume) ?? 1.0));
  }

  setVoice(voice) {
    this.voice = voice || null;
  }

  setLang(lang) {
    this.lang = String(lang || "");
  }

  setSleepTimer(minutes) {
    this.clearSleepTimer();
    const mins = Number(minutes) || 0;
    if (mins <= 0) {
      this.sleepFadeMultiplier = 1.0;
      this.onSleepTick({ active: false, remainingMs: 0, fadeMultiplier: 1.0 });
      return;
    }

    this.sleepDurationMs = mins * 60000;
    this.sleepEndAt = Date.now() + this.sleepDurationMs;
    this.sleepFadeMultiplier = 1.0;
    const tickIntervalMs = Math.min(1000, Math.max(25, Math.floor(this.sleepDurationMs / 10)));

    this.sleepInterval = setInterval(() => {
      const remainingMs = Math.max(0, this.sleepEndAt - Date.now());
      const fadeWindowMs = Math.min(30000, this.sleepDurationMs * 0.35);

      if (remainingMs <= 0) {
        this.clearSleepTimer();
        this.pause();
        this.sleepFadeMultiplier = 1.0;
        this.onSleepTick({ active: false, remainingMs: 0, fadeMultiplier: 1.0, expired: true });
        return;
      }

      if (remainingMs < fadeWindowMs && fadeWindowMs > 0) {
        this.sleepFadeMultiplier = Math.max(0.05, remainingMs / fadeWindowMs);
      } else {
        this.sleepFadeMultiplier = 1.0;
      }

      this.onSleepTick({
        active: true,
        remainingMs,
        fadeMultiplier: this.sleepFadeMultiplier
      });
    }, tickIntervalMs);

    this.onSleepTick({
      active: true,
      remainingMs: this.sleepDurationMs,
      fadeMultiplier: 1.0
    });
  }

  clearSleepTimer() {
    if (this.sleepInterval) {
      clearInterval(this.sleepInterval);
      this.sleepInterval = null;
    }
    this.sleepEndAt = 0;
    this.sleepDurationMs = 0;
    this.sleepFadeMultiplier = 1.0;
  }

  clearTimers() {
    if (this.nextTimer) {
      clearTimeout(this.nextTimer);
      this.nextTimer = null;
    }
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  setState(nextState) {
    this.state = nextState;
    this.onStateChange(nextState);
  }

  emitProgress() {
    const current = this.chunks[this.currentIndex] || null;
    this.onProgress({
      chunkIndex: this.currentIndex,
      totalChunks: this.chunks.length,
      paragraphIndex: current ? current.paragraphIndex : 0,
      percent: this.chunks.length > 0 ? Math.round(((this.currentIndex + 1) / this.chunks.length) * 100) : 0
    });
  }

  play(startIndex) {
    if (typeof startIndex === "number") {
      this.currentIndex = Math.max(0, Math.min(startIndex, Math.max(0, this.chunks.length - 1)));
    }
    if (this.chunks.length === 0) return false;
    if (!this.synth || !this.UtteranceCtor) {
      this.onError(new Error("Web Speech API no disponible en este entorno."));
      return false;
    }

    this.clearTimers();
    this.playbackToken += 1;
    // Solo cancelamos al iniciar o saltar explícitamente, nunca entre chunks consecutivos
    try {
      this.synth.cancel();
    } catch {
      // Ignorar errores de cancelación inicial
    }

    this.setState("playing");
    this.speakCurrent(this.playbackToken);
    return true;
  }

  pause() {
    if (this.state !== "playing") return;
    this.playbackToken += 1;
    this.clearTimers();
    this.activeUtterance = null;
    try {
      this.synth?.cancel();
    } catch {
      // Ignorar
    }
    this.setState("paused");
  }

  resume() {
    if (this.state === "playing") return;
    if (this.chunks.length === 0) return;
    this.play(this.currentIndex);
  }

  stop() {
    const wasActive = this.state !== "idle" || this.activeUtterance !== null;
    this.playbackToken += 1;
    this.clearTimers();
    this.activeUtterance = null;
    if (wasActive) {
      try {
        this.synth?.cancel();
      } catch {
        // Ignorar
      }
    }
    this.currentIndex = 0;
    this.setState("idle");
    this.emitProgress();
  }

  jumpToChunk(chunkIndex) {
    if (this.chunks.length === 0) return;
    const clamped = Math.max(0, Math.min(chunkIndex, this.chunks.length - 1));
    this.currentIndex = clamped;
    this.emitProgress();
    if (this.state === "playing") {
      this.play(clamped);
    } else {
      const chunk = this.chunks[clamped];
      if (chunk) this.onChunkStart(chunk);
    }
  }

  jumpToParagraph(paragraphIndex) {
    const idx = this.chunks.findIndex((c) => c.paragraphIndex >= paragraphIndex);
    if (idx !== -1) {
      this.jumpToChunk(idx);
    }
  }

  nextParagraph() {
    const current = this.chunks[this.currentIndex];
    if (!current) return;
    const nextIdx = this.chunks.findIndex(
      (c, i) => i > this.currentIndex && c.paragraphIndex > current.paragraphIndex
    );
    if (nextIdx !== -1) {
      this.jumpToChunk(nextIdx);
    }
  }

  prevParagraph() {
    const current = this.chunks[this.currentIndex];
    if (!current) return;
    const targetPara = Math.max(0, current.paragraphIndex - 1);
    const prevIdx = this.chunks.findIndex((c) => c.paragraphIndex === targetPara);
    if (prevIdx !== -1) {
      this.jumpToChunk(prevIdx);
    } else {
      this.jumpToChunk(0);
    }
  }

  speakCurrent(token) {
    if (token !== this.playbackToken || this.state !== "playing") return;

    if (this.currentIndex >= this.chunks.length) {
      this.activeUtterance = null;
      this.clearTimers();
      this.setState("idle");
      this.onComplete();
      return;
    }

    const chunk = this.chunks[this.currentIndex];
    const utter = new this.UtteranceCtor(chunk.text);
    utter.rate = this.rate;
    utter.pitch = this.pitch;
    utter.volume = Math.max(0, Math.min(1, this.volume * this.sleepFadeMultiplier));
    if (this.voice) {
      utter.voice = this.voice;
      if (this.voice.lang) utter.lang = this.voice.lang;
    } else if (this.lang) {
      utter.lang = this.lang;
    }

    // Capa 3: mantener referencia viva contra GC de Chromium
    this.activeUtterance = utter;

    let chunkSettled = false;
    const advanceAfterPause = (pauseMs) => {
      if (chunkSettled || token !== this.playbackToken || this.state !== "playing") return;
      chunkSettled = true;
      if (this.watchdogTimer) {
        clearTimeout(this.watchdogTimer);
        this.watchdogTimer = null;
      }
      this.currentIndex += 1;
      if (this.currentIndex >= this.chunks.length) {
        this.activeUtterance = null;
        this.setState("idle");
        this.onComplete();
        return;
      }
      this.nextTimer = setTimeout(() => {
        this.speakCurrent(token);
      }, pauseMs);
    };

    utter.onend = () => {
      // Capa 2: pausa diferenciada sin llamar a cancel()
      const delay = chunk.isParagraphEnd ? this.paragraphPauseMs : this.sentencePauseMs;
      advanceAfterPause(delay);
    };

    utter.onerror = (ev) => {
      if (ev?.error === "canceled" || ev?.error === "interrupted") {
        return;
      }
      this.onError(ev);
      advanceAfterPause(this.sentencePauseMs);
    };

    // Capa 3: Watchdog anti-congelamiento
    const watchdogMs = this.watchdogDurationFn(chunk.wordCount, this.rate);
    this.watchdogTimer = setTimeout(() => {
      if (chunkSettled || token !== this.playbackToken || this.state !== "playing") return;
      chunkSettled = true;
      this.onWatchdogRecovery(chunk);
      try {
        this.synth.cancel();
      } catch {
        // Ignorar
      }
      this.currentIndex += 1;
      this.speakCurrent(token);
    }, watchdogMs);

    this.onChunkStart(chunk);
    this.emitProgress();
    this.synth.speak(utter);
  }
}
