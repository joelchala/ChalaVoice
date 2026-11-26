import { CONFIG } from "../config.js";
import { parseBookInput } from "../lib/book-parser.js";

const { SpeechQueueEngine } = globalThis.ChalaSpeechQueue;
const { detectLanguage, loadVoices, rankVoices } = globalThis.ChalaVoiceRanker;

const elements = {
  statusBadge: document.getElementById("statusBadge"),
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  btnTogglePaste: document.getElementById("btnTogglePaste"),
  pastePanel: document.getElementById("pastePanel"),
  pasteTitleInput: document.getElementById("pasteTitleInput"),
  pasteTextArea: document.getElementById("pasteTextArea"),
  btnLoadPasted: document.getElementById("btnLoadPasted"),
  libraryCount: document.getElementById("libraryCount"),
  libraryList: document.getElementById("libraryList"),
  emptyReader: document.getElementById("emptyReader"),
  bookViewer: document.getElementById("bookViewer"),
  bookFormatBadge: document.getElementById("bookFormatBadge"),
  bookTitle: document.getElementById("bookTitle"),
  bookStats: document.getElementById("bookStats"),
  chapterSelectRow: document.getElementById("chapterSelectRow"),
  chapterSelect: document.getElementById("chapterSelect"),
  bookParagraphList: document.getElementById("bookParagraphList"),
  liveCaption: document.getElementById("liveCaption"),
  progressScrubber: document.getElementById("progressScrubber"),
  progressCounter: document.getElementById("progressCounter"),
  sleepCountdown: document.getElementById("sleepCountdown"),
  btnPrevPara: document.getElementById("btnPrevPara"),
  btnPlayPause: document.getElementById("btnPlayPause"),
  btnStop: document.getElementById("btnStop"),
  btnNextPara: document.getElementById("btnNextPara"),
  presetButtons: Array.from(document.querySelectorAll(".preset-btn")),
  voiceSelect: document.getElementById("voiceSelect"),
  rateRange: document.getElementById("rateRange"),
  rateValue: document.getElementById("rateValue"),
  pitchRange: document.getElementById("pitchRange"),
  pitchValue: document.getElementById("pitchValue"),
  volumeRange: document.getElementById("volumeRange"),
  volumeValue: document.getElementById("volumeValue"),
  sleepSelect: document.getElementById("sleepSelect")
};

const appState = {
  library: [],
  activeBookId: null,
  activeChapterIndex: 0,
  settings: { ...CONFIG.DEFAULT_SETTINGS },
  rawVoices: [],
  rankedVoices: []
};

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

async function saveLibrary() {
  try {
    await chrome.storage?.local?.set({
      [CONFIG.STORAGE_KEYS.LIBRARY]: appState.library,
      [CONFIG.STORAGE_KEYS.ACTIVE_BOOK_ID]: appState.activeBookId
    });
  } catch {
    // Ignorar
  }
}

async function saveSettings() {
  try {
    await chrome.storage?.local?.set({
      [CONFIG.STORAGE_KEYS.SETTINGS]: appState.settings
    });
  } catch {
    // Ignorar
  }
}

function getActiveBook() {
  return appState.library.find((b) => b.id === appState.activeBookId) || null;
}

function getStatusPayload() {
  const st = engine.getStatus();
  const book = getActiveBook();
  return {
    ...st,
    source: "book",
    title: book?.title || "Lector de Libros",
    paragraphCount: book?.chapters?.[appState.activeChapterIndex]?.paragraphs?.length || 0
  };
}

function broadcastStatus() {
  try {
    const p = chrome.runtime?.sendMessage?.({
      type: "CHALAVOICE_STATE_UPDATE",
      status: getStatusPayload()
    });
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
    // Popup cerrado
  }
}

const engine = new SpeechQueueEngine({
  onChunkStart(chunk) {
    elements.liveCaption.textContent = chunk.text;
    for (const child of elements.bookParagraphList.children) {
      const idx = Number.parseInt(child.dataset.paragraphIndex || "-1", 10);
      const isActive = idx === chunk.paragraphIndex;
      child.classList.toggle("active", isActive);
      if (isActive && typeof child.scrollIntoView === "function") {
        child.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
    const book = getActiveBook();
    if (book) {
      book.progress = {
        chapterIndex: appState.activeChapterIndex,
        paragraphIndex: chunk.paragraphIndex,
        chunkIndex: chunk.chunkIndex
      };
      book.updatedAt = Date.now();
      saveLibrary();
      renderLibraryList();
    }
    broadcastStatus();
  },
  onStateChange(nextState) {
    elements.statusBadge.dataset.state = nextState;
    elements.statusBadge.textContent =
      nextState === "playing" ? "Leyendo" : nextState === "paused" ? "En pausa" : "Listo";
    elements.btnPlayPause.textContent = nextState === "playing" ? "⏸" : "▶";
    broadcastStatus();
  },
  onProgress({ chunkIndex, totalChunks, percent }) {
    elements.progressScrubber.value = String(percent);
    elements.progressCounter.textContent =
      totalChunks > 0 ? `${chunkIndex + 1} / ${totalChunks} (${percent}%)` : "0 / 0";
  },
  onComplete() {
    const book = getActiveBook();
    if (book && appState.activeChapterIndex + 1 < book.chapters.length) {
      loadBookChapter(book, appState.activeChapterIndex + 1, 0, true);
      return;
    }
    elements.liveCaption.textContent = "Lectura del libro completada.";
    broadcastStatus();
  },
  onSleepTick({ active, remainingMs, expired }) {
    if (active) {
      elements.sleepCountdown.classList.remove("hidden");
      elements.sleepCountdown.textContent = `⏱ ${formatDuration(remainingMs)}`;
    } else {
      elements.sleepCountdown.classList.add("hidden");
      if (expired) {
        elements.sleepSelect.value = "0";
        elements.liveCaption.textContent = "Temporizador finalizado. Lectura en pausa.";
      }
    }
    broadcastStatus();
  }
});

function refreshVoicesForText(sampleText, declaredLang = "") {
  const detected = detectLanguage(sampleText, declaredLang);
  appState.rankedVoices = rankVoices(appState.rawVoices, detected);
  engine.setLang(detected);

  elements.voiceSelect.innerHTML = "";
  for (const item of appState.rankedVoices) {
    const opt = document.createElement("option");
    opt.value = item.voiceURI;
    opt.textContent = `${item.name} (${item.lang || "?"})${item.qualityTier === "neural" ? " ★" : ""}`;
    elements.voiceSelect.appendChild(opt);
  }

  const chosen =
    appState.rankedVoices.find((v) => v.voiceURI === appState.settings.voiceURI) ||
    appState.rankedVoices[0];
  if (chosen) {
    elements.voiceSelect.value = chosen.voiceURI;
    engine.setVoice(chosen.voice);
  }
}

function syncControls() {
  elements.rateRange.value = String(appState.settings.rate);
  elements.rateValue.textContent = `${Number(appState.settings.rate).toFixed(2)}x`;
  elements.pitchRange.value = String(appState.settings.pitch);
  elements.pitchValue.textContent = Number(appState.settings.pitch).toFixed(2);
  elements.volumeRange.value = String(appState.settings.volume);
  elements.volumeValue.textContent = `${Math.round(appState.settings.volume * 100)}%`;
  for (const btn of elements.presetButtons) {
    btn.classList.toggle("active", btn.dataset.preset === appState.settings.preset);
  }
  engine.setRate(appState.settings.rate);
  engine.setPitch(appState.settings.pitch);
  engine.setVolume(appState.settings.volume);
  engine.paragraphPauseMs = appState.settings.paragraphPauseMs || 500;
}

function loadBookChapter(book, chapterIndex = 0, startParagraph = 0, autoPlay = false, startChunk = null) {
  if (!book || !book.chapters?.length) return;
  const safeChapter = Math.max(0, Math.min(chapterIndex, book.chapters.length - 1));
  const chapter = book.chapters[safeChapter];

  appState.activeBookId = book.id;
  appState.activeChapterIndex = safeChapter;

  elements.emptyReader.classList.add("hidden");
  elements.bookViewer.classList.remove("hidden");
  elements.bookFormatBadge.textContent = String(book.format || "txt").toUpperCase();
  elements.bookTitle.textContent = book.title;
  const estMins = Math.max(1, Math.ceil((book.totalWords || 0) / CONFIG.WORDS_PER_MINUTE));
  elements.bookStats.innerHTML = [
    `<span class="chip">${book.totalWords} palabras</span>`,
    `<span class="chip">~${estMins} min</span>`,
    `<span class="chip">${book.chapters.length} cap.</span>`
  ].join("");

  if (book.chapters.length > 1) {
    elements.chapterSelectRow.classList.remove("hidden");
    elements.chapterSelect.innerHTML = "";
    book.chapters.forEach((ch, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = `${idx + 1}. ${ch.title}`;
      elements.chapterSelect.appendChild(opt);
    });
    elements.chapterSelect.value = String(safeChapter);
  } else {
    elements.chapterSelectRow.classList.add("hidden");
  }

  elements.bookParagraphList.innerHTML = "";
  chapter.paragraphs.forEach((txt, idx) => {
    const div = document.createElement("div");
    div.className = "para-item";
    div.dataset.paragraphIndex = String(idx);
    div.textContent = txt;
    div.addEventListener("click", () => {
      engine.jumpToParagraph(idx);
      if (engine.state !== "playing") engine.play(engine.currentIndex);
    });
    elements.bookParagraphList.appendChild(div);
  });

  refreshVoicesForText(chapter.paragraphs.join(" "), book.lang);
  engine.loadParagraphs(chapter.paragraphs);
  if (typeof startChunk === "number" && startChunk > 0) {
    engine.jumpToChunk(startChunk);
  } else if (startParagraph > 0) {
    engine.jumpToParagraph(startParagraph);
  }

  saveLibrary();
  renderLibraryList();

  if (autoPlay) {
    engine.play(engine.currentIndex);
  }
}

function renderLibraryList() {
  elements.libraryCount.textContent = String(appState.library.length);
  elements.libraryList.innerHTML = "";
  if (appState.library.length === 0) {
    elements.libraryList.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">Sin libros guardados aún.</p>`;
    return;
  }

  for (const book of appState.library) {
    const row = document.createElement("div");
    row.className = `book-item${book.id === appState.activeBookId ? " active" : ""}`;

    const info = document.createElement("div");
    info.className = "book-item-info";
    const prog = book.progress || { chapterIndex: 0, paragraphIndex: 0 };

    const tEl = document.createElement("div");
    tEl.className = "book-item-title";
    tEl.textContent = book.title;

    const mEl = document.createElement("div");
    mEl.className = "book-item-meta";
    mEl.textContent = `${String(book.format || "txt").toUpperCase()} · Cap. ${(prog.chapterIndex || 0) + 1}/${book.chapters.length} · Párr. ${(prog.paragraphIndex || 0) + 1}`;

    info.appendChild(tEl);
    info.appendChild(mEl);
    info.addEventListener("click", () => {
      loadBookChapter(book, prog.chapterIndex || 0, prog.paragraphIndex || 0, true, prog.chunkIndex ?? null);
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn-mini danger";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => {
      appState.library = appState.library.filter((b) => b.id !== book.id);
      if (appState.activeBookId === book.id) {
        appState.activeBookId = appState.library[0]?.id || null;
        engine.stop();
        if (appState.activeBookId) {
          const next = getActiveBook();
          loadBookChapter(next, 0, 0, false);
        } else {
          elements.bookViewer.classList.add("hidden");
          elements.emptyReader.classList.remove("hidden");
        }
      }
      saveLibrary();
      renderLibraryList();
    });

    row.appendChild(info);
    row.appendChild(delBtn);
    elements.libraryList.appendChild(row);
  }
}

async function handleFileUpload(file) {
  if (!file) return;
  try {
    const isEpub = /\.epub$/i.test(file.name);
    const content = isEpub ? await file.arrayBuffer() : await file.text();
    const book = await parseBookInput({ name: file.name, content });
    appState.library.unshift(book);
    appState.activeBookId = book.id;
    loadBookChapter(book, 0, 0, true);
  } catch (err) {
    elements.liveCaption.textContent = `Error al abrir ${file.name}: ${err?.message || "formato inválido"}`;
  }
}

async function handleLoadPasted() {
  const raw = elements.pasteTextArea.value.trim();
  if (!raw) return;
  const title = elements.pasteTitleInput.value.trim() || "Texto pegado";
  const book = await parseBookInput({ name: `${title}.txt`, content: raw, type: "txt" });
  book.title = title;
  appState.library.unshift(book);
  appState.activeBookId = book.id;
  elements.pastePanel.classList.add("hidden");
  elements.pasteTextArea.value = "";
  elements.pasteTitleInput.value = "";
  loadBookChapter(book, 0, 0, true);
}

function bindEvents() {
  elements.dropZone.addEventListener("click", () => elements.fileInput.click());
  elements.dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    elements.dropZone.classList.add("drag-over");
  });
  elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("drag-over"));
  elements.dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    elements.dropZone.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileUpload(file);
  });
  elements.fileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    elements.fileInput.value = "";
  });

  elements.btnTogglePaste.addEventListener("click", () => elements.pastePanel.classList.toggle("hidden"));
  elements.btnLoadPasted.addEventListener("click", handleLoadPasted);
  elements.chapterSelect.addEventListener("change", (e) => {
    const book = getActiveBook();
    if (book) loadBookChapter(book, Number(e.target.value) || 0, 0, engine.state === "playing");
  });

  elements.btnPlayPause.addEventListener("click", () => {
    if (engine.state === "playing") engine.pause();
    else if (engine.state === "paused") engine.resume();
    else engine.play(engine.currentIndex);
  });
  elements.btnStop.addEventListener("click", () => engine.stop());
  elements.btnPrevPara.addEventListener("click", () => engine.prevParagraph());
  elements.btnNextPara.addEventListener("click", () => engine.nextParagraph());

  elements.progressScrubber.addEventListener("change", (e) => {
    if (engine.chunks.length === 0) return;
    const pct = Number(e.target.value) / 100;
    engine.jumpToChunk(Math.min(engine.chunks.length - 1, Math.floor(pct * engine.chunks.length)));
  });

  for (const btn of elements.presetButtons) {
    btn.addEventListener("click", () => {
      const preset = engine.applyPreset(btn.dataset.preset);
      if (!preset) return;
      appState.settings.preset = btn.dataset.preset;
      appState.settings.rate = preset.rate;
      appState.settings.pitch = preset.pitch;
      appState.settings.paragraphPauseMs = preset.paragraphPauseMs;
      syncControls();
      saveSettings();
    });
  }

  elements.voiceSelect.addEventListener("change", (e) => {
    appState.settings.voiceURI = e.target.value;
    const match = appState.rankedVoices.find((v) => v.voiceURI === e.target.value);
    engine.setVoice(match ? match.voice : null);
    saveSettings();
  });

  elements.rateRange.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    appState.settings.rate = val;
    appState.settings.preset = "custom";
    elements.rateValue.textContent = `${val.toFixed(2)}x`;
    engine.setRate(val);
    for (const b of elements.presetButtons) b.classList.remove("active");
    saveSettings();
  });

  elements.pitchRange.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    appState.settings.pitch = val;
    appState.settings.preset = "custom";
    elements.pitchValue.textContent = val.toFixed(2);
    engine.setPitch(val);
    for (const b of elements.presetButtons) b.classList.remove("active");
    saveSettings();
  });

  elements.volumeRange.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    appState.settings.volume = val;
    elements.volumeValue.textContent = `${Math.round(val * 100)}%`;
    engine.setVolume(val);
    saveSettings();
  });

  elements.sleepSelect.addEventListener("change", (e) => {
    engine.setSleepTimer(Number(e.target.value) || 0);
  });

  if (chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "CHALAVOICE_READER_PING") {
        sendResponse({ alive: true, status: getStatusPayload() });
        return false;
      }
      if (message?.type === "CHALAVOICE_READER_RELOAD_AND_PLAY") {
        reloadStorageAndOpen(true).then(() => sendResponse({ ok: true, status: getStatusPayload() }));
        return true;
      }
      if (message?.type === "CHALAVOICE_READER_CMD") {
        const act = message.action;
        if (act === "TOGGLE_PLAY") {
          if (engine.state === "playing") engine.pause();
          else engine.resume();
        } else if (act === "PAUSE") engine.pause();
        else if (act === "RESUME") engine.resume();
        else if (act === "STOP") engine.stop();
        else if (act === "NEXT_PARA") engine.nextParagraph();
        else if (act === "PREV_PARA") engine.prevParagraph();
        else if (act === "SEEK_PERCENT" && engine.chunks.length > 0) {
          const pct = Math.max(0, Math.min(100, Number(message.percent) || 0)) / 100;
          engine.jumpToChunk(Math.min(engine.chunks.length - 1, Math.floor(pct * engine.chunks.length)));
        } else if (act === "UPDATE_SETTINGS") {
          if (message.settings) {
            appState.settings = { ...appState.settings, ...message.settings };
            syncControls();
          }
          if (message.sleepMinutes !== undefined) {
            engine.setSleepTimer(Number(message.sleepMinutes) || 0);
          }
        }
        sendResponse({ ok: true, status: getStatusPayload() });
        return false;
      }
      return false;
    });
  }
}

async function reloadStorageAndOpen(autoplay = false) {
  try {
    const stored = await chrome.storage?.local?.get([
      CONFIG.STORAGE_KEYS.SETTINGS,
      CONFIG.STORAGE_KEYS.LIBRARY,
      CONFIG.STORAGE_KEYS.ACTIVE_BOOK_ID
    ]);
    if (stored?.[CONFIG.STORAGE_KEYS.SETTINGS]) {
      appState.settings = { ...CONFIG.DEFAULT_SETTINGS, ...stored[CONFIG.STORAGE_KEYS.SETTINGS] };
    }
    if (Array.isArray(stored?.[CONFIG.STORAGE_KEYS.LIBRARY])) {
      appState.library = stored[CONFIG.STORAGE_KEYS.LIBRARY];
    }
    if (stored?.[CONFIG.STORAGE_KEYS.ACTIVE_BOOK_ID]) {
      appState.activeBookId = stored[CONFIG.STORAGE_KEYS.ACTIVE_BOOK_ID];
    }
  } catch {
    // Valores por defecto
  }

  syncControls();
  renderLibraryList();

  const book = getActiveBook() || appState.library[0] || null;
  if (book) {
    const prog = book.progress || { chapterIndex: 0, paragraphIndex: 0, chunkIndex: 0 };
    loadBookChapter(book, prog.chapterIndex || 0, prog.paragraphIndex || 0, autoplay, prog.chunkIndex ?? null);
  }
}

async function init() {
  if (typeof speechSynthesis !== "undefined") {
    appState.rawVoices = await loadVoices(speechSynthesis);
  }
  const params = new URLSearchParams(window.location.search);
  const autoplay = params.get("autoplay") === "1";
  await reloadStorageAndOpen(autoplay);
  bindEvents();
}

init();
