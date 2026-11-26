/**
 * ChalaSpeechQueue — Motor de lectura anti-congelamiento de 3 capas,
 * presets acústicos y Sleep Timer con atenuación gradual.
 *
 * Diseñado como IIFE idempotente compatible con chrome.scripting.executeScript
 * (sin sentencias export/import) para persistir en la pestaña aunque el Popup se cierre,
 * y utilizable directamente en src/reader/ y tests Node.js.
 */
(function (globalScope) {
  "use strict";

  var VOICE_PRESETS = {
    rustic: {
      id: "rustic",
      pitch: 0.82,
      rate: 0.90,
      paragraphPauseMs: 700,
      sentencePauseMs: 140
    },
    soft: {
      id: "soft",
      pitch: 1.06,
      rate: 0.94,
      paragraphPauseMs: 400,
      sentencePauseMs: 120
    },
    study: {
      id: "study",
      pitch: 1.00,
      rate: 1.30,
      paragraphPauseMs: 200,
      sentencePauseMs: 90
    },
    natural: {
      id: "natural",
      pitch: 1.00,
      rate: 1.00,
      paragraphPauseMs: 500,
      sentencePauseMs: 120
    }
  };

  var ABBREVIATION_LIST = [
    "Sr", "Sra", "Srta", "Dr", "Dra", "Prof", "Ing", "Lic", "Arq",
    "Ud", "Uds", "Vd", "Vds", "etc", "pág", "págs", "cap", "fig",
    "núm", "vol", "ed", "aprox", "ej", "tel", "av", "gral", "dept",
    "Mr", "Mrs", "Ms", "St", "Jr", "vs", "Inc", "Ltd", "Co", "No",
    "e.g", "i.e", "U.S"
  ];

  var ABBR_PATTERN = new RegExp(
    "\\b(?:" + ABBREVIATION_LIST.map(function (a) { return a.replace(/\./g, "\\."); }).join("|") + ")\\.$",
    "i"
  );

  function countWords(text) {
    var clean = String(text || "").trim();
    return clean ? clean.split(/\s+/).filter(Boolean).length : 0;
  }

  function splitSentencesProtectingAbbreviations(paragraph) {
    var text = String(paragraph || "").replace(/\s+/g, " ").trim();
    if (!text) return [];

    var sentences = [];
    var start = 0;

    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      if (ch !== "." && ch !== "?" && ch !== "!" && ch !== ";" && ch !== "…") {
        continue;
      }

      var end = i + 1;
      while (end < text.length && /[.?!;…"”'")\]]/.test(text[end])) {
        end += 1;
      }

      var nextChar = text[end] || "";
      var atBoundary = end >= text.length || /\s/.test(nextChar);
      if (!atBoundary) {
        continue;
      }

      if (ch === ".") {
        var prefix = text.slice(start, i + 1);
        if (ABBR_PATTERN.test(prefix) || /(?:^|\s)[A-ZÁÉÍÓÚÑ]\.$/.test(prefix)) {
          continue;
        }
      }

      var segment = text.slice(start, end).trim();
      if (segment) {
        sentences.push(segment);
      }
      while (end < text.length && /\s/.test(text[end])) {
        end += 1;
      }
      start = end;
      i = end - 1;
    }

    var tail = text.slice(start).trim();
    if (tail) {
      sentences.push(tail);
    }
    return sentences;
  }

  function subdivideLongSentence(sentence, maxChars, targetMin) {
    var limit = maxChars || 200;
    var minSplit = targetMin || 150;
    var text = String(sentence || "").trim();
    if (text.length <= limit) {
      return [text];
    }

    var parts = [];
    var remaining = text;

    while (remaining.length > limit) {
      var windowSlice = remaining.slice(0, limit + 1);
      var splitAt = -1;

      for (var i = Math.min(limit, windowSlice.length - 1); i >= Math.min(minSplit, 80); i -= 1) {
        var c = windowSlice[i];
        if (c === "," || c === ":" || c === ";" || c === "—") {
          splitAt = i + 1;
          break;
        }
      }

      if (splitAt === -1) {
        splitAt = windowSlice.lastIndexOf(" ");
      }
      if (splitAt <= 0) {
        splitAt = limit;
      }

      var piece = remaining.slice(0, splitAt).trim();
      if (piece) parts.push(piece);
      remaining = remaining.slice(splitAt).trim();
    }

    if (remaining) {
      parts.push(remaining);
    }
    return parts;
  }

  /**
   * Capa 1 — Subdivisión inteligente en chunks seguros para Chromium (<= ~200 chars / < 15s).
   */
  function buildSpeechChunks(paragraphs, options) {
    var opts = options || {};
    var maxChars = opts.maxChars || 200;
    var list = Array.isArray(paragraphs) ? paragraphs : [];
    var chunks = [];

    for (var pIdx = 0; pIdx < list.length; pIdx += 1) {
      var paraText = String(list[pIdx] || "").replace(/\s+/g, " ").trim();
      if (!paraText) continue;

      var sentences = splitSentencesProtectingAbbreviations(paraText);
      var paraChunks = [];

      for (var sIdx = 0; sIdx < sentences.length; sIdx += 1) {
        var subParts = subdivideLongSentence(sentences[sIdx], maxChars);
        for (var subIdx = 0; subIdx < subParts.length; subIdx += 1) {
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
        for (var c = 0; c < paraChunks.length; c += 1) {
          paraChunks[c].chunkIndex = chunks.length;
          chunks.push(paraChunks[c]);
        }
      }
    }

    return chunks;
  }

  function estimateWatchdogMs(wordCount, rate) {
    var safeWords = Math.max(1, Number(wordCount) || 1);
    var safeRate = Math.max(0.5, Number(rate) || 1.0);
    return Math.round((safeWords / (150 * safeRate)) * 60000) + 6000;
  }

  class SpeechQueueEngine {
    constructor(options) {
      var opts = options || {};
      this.synth = opts.synth || (typeof speechSynthesis !== "undefined" ? speechSynthesis : null);
      this.UtteranceCtor =
        opts.UtteranceCtor ||
        (typeof SpeechSynthesisUtterance !== "undefined" ? SpeechSynthesisUtterance : null);
      this.watchdogDurationFn = opts.watchdogDurationFn || estimateWatchdogMs;

      this.chunks = [];
      this.currentIndex = 0;
      this.state = "idle"; // "idle" | "playing" | "paused"
      this.activeUtterance = null; // Capa 3: previene GC prematuro de onend
      this.playbackToken = 0;

      this.nextTimer = null;
      this.watchdogTimer = null;

      this.preset = opts.preset || "natural";
      this.rate = opts.rate !== undefined ? opts.rate : 1.0;
      this.pitch = opts.pitch !== undefined ? opts.pitch : 1.0;
      this.volume = opts.volume !== undefined ? opts.volume : 1.0;
      this.sentencePauseMs = opts.sentencePauseMs !== undefined ? opts.sentencePauseMs : 120;
      this.paragraphPauseMs = opts.paragraphPauseMs !== undefined ? opts.paragraphPauseMs : 500;
      this.voice = opts.voice || null;
      this.lang = opts.lang || "";

      this.sleepMinutes = 0;
      this.sleepEndAt = 0;
      this.sleepDurationMs = 0;
      this.sleepInterval = null;
      this.sleepFadeMultiplier = 1.0;

      this.onChunkStart = opts.onChunkStart || function () {};
      this.onStateChange = opts.onStateChange || function () {};
      this.onProgress = opts.onProgress || function () {};
      this.onComplete = opts.onComplete || function () {};
      this.onSleepTick = opts.onSleepTick || function () {};
      this.onWatchdogRecovery = opts.onWatchdogRecovery || function () {};
      this.onError = opts.onError || function () {};
    }

    loadParagraphs(paragraphs, options) {
      var opts = options || {};
      this.stop();
      this.chunks = buildSpeechChunks(paragraphs, opts);
      this.currentIndex = Math.max(0, Math.min(opts.startChunkIndex || 0, Math.max(0, this.chunks.length - 1)));
      this.emitProgress();
      return this.chunks;
    }

    applyPreset(presetId) {
      var preset = VOICE_PRESETS[presetId];
      if (!preset) return null;
      this.preset = presetId;
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
      var val = Number(volume);
      this.volume = Math.min(1.0, Math.max(0, Number.isFinite(val) ? val : 1.0));
    }

    setVoice(voice) {
      this.voice = voice || null;
    }

    setLang(lang) {
      this.lang = String(lang || "");
    }

    setSleepTimer(minutes) {
      this.clearSleepTimer();
      var mins = Number(minutes) || 0;
      this.sleepMinutes = mins;
      if (mins <= 0) {
        this.sleepFadeMultiplier = 1.0;
        this.onSleepTick({ active: false, remainingMs: 0, fadeMultiplier: 1.0, minutes: 0 });
        return;
      }

      this.sleepDurationMs = mins * 60000;
      this.sleepEndAt = Date.now() + this.sleepDurationMs;
      this.sleepFadeMultiplier = 1.0;
      var tickIntervalMs = Math.min(1000, Math.max(25, Math.floor(this.sleepDurationMs / 10)));
      var self = this;

      this.sleepInterval = setInterval(function () {
        var remainingMs = Math.max(0, self.sleepEndAt - Date.now());
        var fadeWindowMs = Math.min(30000, self.sleepDurationMs * 0.35);

        if (remainingMs <= 0) {
          self.clearSleepTimer();
          self.pause();
          self.sleepFadeMultiplier = 1.0;
          self.onSleepTick({ active: false, remainingMs: 0, fadeMultiplier: 1.0, expired: true, minutes: 0 });
          return;
        }

        if (remainingMs < fadeWindowMs && fadeWindowMs > 0) {
          self.sleepFadeMultiplier = Math.max(0.05, remainingMs / fadeWindowMs);
        } else {
          self.sleepFadeMultiplier = 1.0;
        }

        self.onSleepTick({
          active: true,
          remainingMs: remainingMs,
          fadeMultiplier: self.sleepFadeMultiplier,
          minutes: self.sleepMinutes
        });
      }, tickIntervalMs);

      this.onSleepTick({
        active: true,
        remainingMs: this.sleepDurationMs,
        fadeMultiplier: 1.0,
        minutes: this.sleepMinutes
      });
    }

    clearSleepTimer() {
      if (this.sleepInterval) {
        clearInterval(this.sleepInterval);
        this.sleepInterval = null;
      }
      this.sleepEndAt = 0;
      this.sleepDurationMs = 0;
      this.sleepMinutes = 0;
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
      var current = this.chunks[this.currentIndex] || null;
      this.onProgress({
        chunkIndex: this.currentIndex,
        totalChunks: this.chunks.length,
        paragraphIndex: current ? current.paragraphIndex : 0,
        percent: this.chunks.length > 0 ? Math.round(((this.currentIndex + 1) / this.chunks.length) * 100) : 0
      });
    }

    getStatus() {
      var current = this.chunks[this.currentIndex] || null;
      var remainingMs = this.sleepEndAt > 0 ? Math.max(0, this.sleepEndAt - Date.now()) : 0;
      return {
        state: this.state,
        chunkIndex: this.currentIndex,
        totalChunks: this.chunks.length,
        paragraphIndex: current ? current.paragraphIndex : 0,
        percent: this.chunks.length > 0 ? Math.round(((this.currentIndex + 1) / this.chunks.length) * 100) : 0,
        currentText: current ? current.text : "",
        preset: this.preset,
        rate: this.rate,
        pitch: this.pitch,
        volume: this.volume,
        voiceURI: (this.voice && (this.voice.voiceURI || this.voice.name)) || "",
        sleepActive: this.sleepEndAt > 0,
        sleepMinutes: this.sleepMinutes,
        sleepRemainingMs: remainingMs
      };
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
      try {
        this.synth.cancel();
      } catch {
        // Ignorar errores iniciales
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
        if (this.synth) this.synth.cancel();
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
      var wasActive = this.state !== "idle" || this.activeUtterance !== null;
      this.playbackToken += 1;
      this.clearTimers();
      this.activeUtterance = null;
      if (wasActive) {
        try {
          if (this.synth) this.synth.cancel();
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
      var clamped = Math.max(0, Math.min(chunkIndex, this.chunks.length - 1));
      this.currentIndex = clamped;
      this.emitProgress();
      if (this.state === "playing") {
        this.play(clamped);
      } else {
        var chunk = this.chunks[clamped];
        if (chunk) this.onChunkStart(chunk);
      }
    }

    jumpToParagraph(paragraphIndex) {
      var idx = this.chunks.findIndex(function (c) { return c.paragraphIndex >= paragraphIndex; });
      if (idx !== -1) {
        this.jumpToChunk(idx);
      }
    }

    nextParagraph() {
      var current = this.chunks[this.currentIndex];
      if (!current) return;
      var nextIdx = this.chunks.findIndex(function (c, i) {
        return i > this.currentIndex && c.paragraphIndex > current.paragraphIndex;
      }, this);
      if (nextIdx !== -1) {
        this.jumpToChunk(nextIdx);
      }
    }

    prevParagraph() {
      var current = this.chunks[this.currentIndex];
      if (!current) return;
      var targetPara = Math.max(0, current.paragraphIndex - 1);
      var prevIdx = this.chunks.findIndex(function (c) { return c.paragraphIndex === targetPara; });
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

      var chunk = this.chunks[this.currentIndex];
      var utter = new this.UtteranceCtor(chunk.text);
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

      var self = this;
      var chunkSettled = false;
      var advanceAfterPause = function (pauseMs) {
        if (chunkSettled || token !== self.playbackToken || self.state !== "playing") return;
        chunkSettled = true;
        if (self.watchdogTimer) {
          clearTimeout(self.watchdogTimer);
          self.watchdogTimer = null;
        }
        self.currentIndex += 1;
        if (self.currentIndex >= self.chunks.length) {
          self.activeUtterance = null;
          self.setState("idle");
          self.onComplete();
          return;
        }
        self.nextTimer = setTimeout(function () {
          self.speakCurrent(token);
        }, pauseMs);
      };

      utter.onend = function () {
        var delay = chunk.isParagraphEnd ? self.paragraphPauseMs : self.sentencePauseMs;
        advanceAfterPause(delay);
      };

      utter.onerror = function (ev) {
        if (ev && (ev.error === "canceled" || ev.error === "interrupted")) {
          return;
        }
        self.onError(ev);
        advanceAfterPause(self.sentencePauseMs);
      };

      var watchdogMs = this.watchdogDurationFn(chunk.wordCount, this.rate);
      this.watchdogTimer = setTimeout(function () {
        if (chunkSettled || token !== self.playbackToken || self.state !== "playing") return;
        chunkSettled = true;
        self.onWatchdogRecovery(chunk);
        try {
          self.synth.cancel();
        } catch {
          // Ignorar
        }
        self.currentIndex += 1;
        self.speakCurrent(token);
      }, watchdogMs);

      this.onChunkStart(chunk);
      this.emitProgress();
      this.synth.speak(utter);
    }
  }

  globalScope.ChalaSpeechQueue = {
    VOICE_PRESETS: VOICE_PRESETS,
    buildSpeechChunks: buildSpeechChunks,
    estimateWatchdogMs: estimateWatchdogMs,
    SpeechQueueEngine: SpeechQueueEngine
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
