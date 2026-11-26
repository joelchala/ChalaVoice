import { CONFIG } from "../config.js";
import { parseBookInput } from "../lib/book-parser.js";
import { SpeechQueueEngine } from "../lib/speech-queue.js";
import { detectLanguage, loadVoices, rankVoices } from "../lib/voice-ranker.js";

const elements = {
  statusBadge: document.getElementById("statusBadge"),
  tabBtnWeb: document.getElementById("tabBtnWeb"),
  tabBtnBooks: document.getElementById("tabBtnBooks"),
  viewWeb: document.getElementById("viewWeb"),
  viewBooks: document.getElementById("viewBooks"),
  activeTabTitle: document.getElementById("activeTabTitle"),
  activeTabUrl: document.getElementById("activeTabUrl"),
  btnRefreshTab: document.getElementById("btnRefreshTab"),
  restrictedNotice: document.getElementById("restrictedNotice"),
  btnReadPage: document.getElementById("btnReadPage"),
  webEmptyState: document.getElementById("webEmptyState"),
  webArticleCard: document.getElementById("webArticleCard"),
  webArticleTitle: document.getElementById("webArticleTitle"),
  webArticleStats: document.getElementById("webArticleStats"),
  webParagraphList: document.getElementById("webParagraphList"),
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  btnTogglePaste: document.getElementById("btnTogglePaste"),
  pastePanel: document.getElementById("pastePanel"),
  pasteTitleInput: document.getElementById("pasteTitleInput"),
  pasteTextArea: document.getElementById("pasteTextArea"),
  btnLoadPasted: document.getElementById("btnLoadPasted"),
  bookReaderCard: document.getElementById("bookReaderCard"),
  bookTitle: document.getElementById("bookTitle"),
  bookFormatBadge: document.getElementById("bookFormatBadge"),
  bookStats: document.getElementById("bookStats"),
  chapterSelectRow: document.getElementById("chapterSelectRow"),
  chapterSelect: document.getElementById("chapterSelect"),
  bookParagraphList: document.getElementById("bookParagraphList"),
  libraryCount: document.getElementById("libraryCount"),
  libraryList: document.getElementById("libraryList"),
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
  sleepSelect: document.getElementById("sleepSelect"),
  linkSuite: document.getElementById("linkSuite"),
  linkGithub: document.getElementById("linkGithub"),
  linkDonate: document.getElementById("linkDonate")
};

const appState = {
  mode: "web", // "web" | "books"
  activeSource: null, // "web" | "book"
  activeTabId: null,
  webArticle: null,
  library: [],
  activeBookId: null,
  activeChapterIndex: 0,
  settings: { ...CONFIG.DEFAULT_SETTINGS },
  rawVoices: [],
  rankedVoices: [],
  currentLang: "es"
};

function t(key, fallback) {
  try {
    const msg = chrome.i18n?.getMessage?.(key);
    return msg || fallback;
  } catch {
    return fallback;
  }
}

function applyI18n() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    const msg = t(key, "");
    if (msg) el.textContent = msg;
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    const key = el.getAttribute("data-i18n-placeholder");
    const msg = t(key, "");
    if (msg) el.setAttribute("placeholder", msg);
  }
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

async function saveSettings() {
  try {
    await chrome.storage?.local?.set({
      [CONFIG.STORAGE_KEYS.SETTINGS]: appState.settings
    });
  } catch {
    // Ignorar errores de almacenamiento
  }
}

async function saveLibrary() {
  try {
    await chrome.storage?.local?.set({
      [CONFIG.STORAGE_KEYS.LIBRARY]: appState.library,
      [CONFIG.STORAGE_KEYS.ACTIVE_BOOK_ID]: appState.activeBookId
    });
  } catch (err) {
    elements.liveCaption.textContent = `Aviso de almacenamiento local: ${err?.message || "espacio lleno"}`;
  }
}

const engine = new SpeechQueueEngine({
  onChunkStart(chunk) {
    elements.liveCaption.textContent = chunk.text;
    highlightPanelParagraph(chunk.paragraphIndex);
    if (appState.activeSource === "web" && typeof appState.activeTabId === "number") {
      chrome.runtime
        .sendMessage({
          type: "CHALAVOICE_HIGHLIGHT_CHUNK",
          tabId: appState.activeTabId,
          paragraphIndex: chunk.paragraphIndex,
          sentenceText: chunk.text
        })
        .catch(() => {});
    } else if (appState.activeSource === "book" && appState.activeBookId) {
      updateActiveBookProgress(appState.activeChapterIndex, chunk.paragraphIndex, chunk.chunkIndex);
    }
  },
  onStateChange(nextState) {
    elements.statusBadge.dataset.state = nextState;
    if (nextState === "playing") {
      elements.statusBadge.textContent = t("statusReading", "Leyendo en voz alta");
      elements.btnPlayPause.textContent = "⏸";
    } else if (nextState === "paused") {
      elements.statusBadge.textContent = t("statusPaused", "En pausa");
      elements.btnPlayPause.textContent = "▶";
    } else {
      elements.statusBadge.textContent = t("statusReady", "Listo");
      elements.btnPlayPause.textContent = "▶";
    }
  },
  onProgress({ chunkIndex, totalChunks, percent }) {
    elements.progressScrubber.value = String(percent);
    elements.progressCounter.textContent =
      totalChunks > 0 ? `${chunkIndex + 1} / ${totalChunks} (${percent}%)` : "0 / 0";
  },
  onComplete() {
    if (appState.activeSource === "book") {
      const book = getActiveBook();
      if (book && appState.activeChapterIndex + 1 < book.chapters.length) {
        loadBookChapter(book, appState.activeChapterIndex + 1, 0, true);
        return;
      }
    }
    elements.liveCaption.textContent = "Lectura completada.";
  },
  onSleepTick({ active, remainingMs, expired }) {
    if (active) {
      elements.sleepCountdown.classList.remove("hidden");
      elements.sleepCountdown.textContent = `⏱ ${formatDuration(remainingMs)}`;
    } else {
      elements.sleepCountdown.classList.add("hidden");
      if (expired) {
        elements.sleepSelect.value = "0";
        elements.liveCaption.textContent = "Temporizador finalizado. Lectura pausada.";
      }
    }
  }
});

function highlightPanelParagraph(paragraphIndex) {
  const container =
    appState.activeSource === "book" ? elements.bookParagraphList : elements.webParagraphList;
  if (!container) return;
  for (const child of container.children) {
    const idx = Number.parseInt(child.dataset.paragraphIndex || "-1", 10);
    const isActive = idx === paragraphIndex;
    child.classList.toggle("active", isActive);
    if (isActive && typeof child.scrollIntoView === "function") {
      child.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }
}

function renderParagraphList(container, paragraphs) {
  container.innerHTML = "";
  paragraphs.forEach((text, index) => {
    const item = document.createElement("div");
    item.className = "para-item";
    item.dataset.paragraphIndex = String(index);
    item.textContent = text;
    item.addEventListener("click", () => {
      const targetSource = container === elements.bookParagraphList ? "book" : "web";
      if (appState.activeSource !== targetSource) {
        if (targetSource === "web" && appState.webArticle) {
          activateWebArticleQueue(appState.webArticle, index);
        } else if (targetSource === "book") {
          const book = getActiveBook();
          if (book) loadBookChapter(book, appState.activeChapterIndex, index, true);
        }
        return;
      }
      engine.jumpToParagraph(index);
      if (engine.state !== "playing") {
        engine.play(engine.currentIndex);
      }
    });
    container.appendChild(item);
  });
}

function refreshVoiceSelect(sampleText, declaredLang = "") {
  const detected = detectLanguage(sampleText, declaredLang);
  appState.currentLang = detected;
  appState.rankedVoices = rankVoices(appState.rawVoices, detected);
  engine.setLang(detected);

  elements.voiceSelect.innerHTML = "";
  if (appState.rankedVoices.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("statusNoVoices", "No se detectaron voces del sistema");
    elements.voiceSelect.appendChild(opt);
    engine.setVoice(null);
    return;
  }

  for (const item of appState.rankedVoices) {
    const opt = document.createElement("option");
    opt.value = item.voiceURI;
    const tierLabel = item.qualityTier === "neural" ? " ★" : "";
    opt.textContent = `${item.name} (${item.lang || "?"})${tierLabel}`;
    elements.voiceSelect.appendChild(opt);
  }

  const preferred =
    appState.rankedVoices.find((v) => v.voiceURI === appState.settings.voiceURI) ||
    appState.rankedVoices[0];

  if (preferred) {
    elements.voiceSelect.value = preferred.voiceURI;
    engine.setVoice(preferred.voice);
  }
}

function syncControlsFromSettings() {
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
  engine.paragraphPauseMs = appState.settings.paragraphPauseMs ?? 500;
}

function switchTabMode(mode) {
  appState.mode = mode === "books" ? "books" : "web";
  const isWeb = appState.mode === "web";
  elements.tabBtnWeb.classList.toggle("active", isWeb);
  elements.tabBtnBooks.classList.toggle("active", !isWeb);
  elements.tabBtnWeb.setAttribute("aria-selected", String(isWeb));
  elements.tabBtnBooks.setAttribute("aria-selected", String(!isWeb));
  elements.viewWeb.classList.toggle("hidden", !isWeb);
  elements.viewBooks.classList.toggle("hidden", isWeb);
}

async function refreshTabContext() {
  try {
    const info = await chrome.runtime.sendMessage({ type: "CHALAVOICE_GET_TAB_INFO" });
    appState.activeTabId = info?.tabId ?? null;
    elements.activeTabTitle.textContent = info?.title || "Pestaña activa";
    elements.activeTabUrl.textContent = info?.url || "";
    const restricted = Boolean(info?.restricted);
    elements.restrictedNotice.classList.toggle("hidden", !restricted);
    elements.btnReadPage.disabled = restricted;
  } catch {
    elements.activeTabTitle.textContent = "Pestaña no disponible";
    elements.restrictedNotice.classList.remove("hidden");
    elements.btnReadPage.disabled = true;
  }
}

function activateWebArticleQueue(article, startParagraph = 0, autoPlay = true) {
  appState.activeSource = "web";
  appState.webArticle = article;
  const paragraphs = article.blocks.map((b) => b.text);
  refreshVoiceSelect(article.textContent, article.lang);
  engine.loadParagraphs(paragraphs);
  if (startParagraph > 0) {
    engine.jumpToParagraph(startParagraph);
  }
  if (autoPlay && paragraphs.length > 0) {
    engine.play(engine.currentIndex);
  }
}

async function handleReadCurrentPage() {
  elements.btnReadPage.disabled = true;
  elements.liveCaption.textContent = "Extrayendo artículo de la página...";
  try {
    const res = await chrome.runtime.sendMessage({
      type: "CHALAVOICE_EXTRACT_TAB",
      tabId: appState.activeTabId
    });
    if (!res?.ok || !res.article) {
      elements.liveCaption.textContent = "No se pudo extraer texto legible de esta página.";
      return;
    }

    const article = res.article;
    appState.activeTabId = res.tabId;
    elements.webEmptyState.classList.add("hidden");
    elements.webArticleCard.classList.remove("hidden");
    elements.webArticleTitle.textContent = article.title;
    elements.webArticleStats.innerHTML = [
      `<span class="chip">${article.wordCount} palabras</span>`,
      `<span class="chip">~${article.readingTimeMinutes} min</span>`,
      article.lang ? `<span class="chip">${article.lang.toUpperCase()}</span>` : ""
    ].join("");

    renderParagraphList(
      elements.webParagraphList,
      article.blocks.map((b) => b.text)
    );
    activateWebArticleQueue(article, 0, true);
  } finally {
    elements.btnReadPage.disabled = false;
  }
}

function getActiveBook() {
  return appState.library.find((b) => b.id === appState.activeBookId) || null;
}

function updateActiveBookProgress(chapterIndex, paragraphIndex, chunkIndex) {
  const book = getActiveBook();
  if (!book) return;
  book.progress = { chapterIndex, paragraphIndex, chunkIndex };
  book.updatedAt = Date.now();
  saveLibrary();
  renderLibraryList();
}

function loadBookChapter(book, chapterIndex = 0, startParagraph = 0, autoPlay = false, startChunk = null) {
  if (!book || !book.chapters || book.chapters.length === 0) return;
  const safeChapter = Math.max(0, Math.min(chapterIndex, book.chapters.length - 1));
  const chapter = book.chapters[safeChapter];

  appState.activeSource = "book";
  appState.activeBookId = book.id;
  appState.activeChapterIndex = safeChapter;

  if (typeof appState.activeTabId === "number") {
    chrome.runtime.sendMessage({ type: "CHALAVOICE_CLEAR_HIGHLIGHT", tabId: appState.activeTabId }).catch(() => {});
  }

  elements.bookReaderCard.classList.remove("hidden");
  elements.bookTitle.textContent = book.title;
  elements.bookFormatBadge.textContent = String(book.format || "TXT").toUpperCase();
  const estMinutes = Math.max(1, Math.ceil((book.totalWords || 0) / CONFIG.WORDS_PER_MINUTE));
  elements.bookStats.innerHTML = [
    `<span class="chip">${book.totalWords} palabras</span>`,
    `<span class="chip">~${estMinutes} min</span>`,
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

  renderParagraphList(elements.bookParagraphList, chapter.paragraphs);
  refreshVoiceSelect(chapter.paragraphs.join(" "), book.lang);
  engine.loadParagraphs(chapter.paragraphs);

  if (typeof startChunk === "number" && startChunk > 0) {
    engine.jumpToChunk(startChunk);
  } else if (startParagraph > 0) {
    engine.jumpToParagraph(startParagraph);
  }

  book.progress = {
    chapterIndex: safeChapter,
    paragraphIndex: startParagraph,
    chunkIndex: engine.currentIndex
  };
  saveLibrary();
  renderLibraryList();

  if (autoPlay) {
    engine.play(engine.currentIndex);
  }
}

function renderLibraryList() {
  elements.libraryCount.textContent = String(appState.library.length);
  if (appState.library.length === 0) {
    elements.libraryList.innerHTML = `<p class="muted-empty">${t(
      "libraryEmpty",
      "Aún no hay documentos guardados. Carga un EPUB, Markdown, TXT o pega texto."
    )}</p>`;
    return;
  }

  elements.libraryList.innerHTML = "";
  for (const book of appState.library) {
    const row = document.createElement("div");
    row.className = `book-item${book.id === appState.activeBookId ? " active" : ""}`;

    const info = document.createElement("div");
    info.className = "book-item-info";
    const prog = book.progress || { chapterIndex: 0, paragraphIndex: 0 };
    const titleEl = document.createElement("div");
    titleEl.className = "book-item-title";
    titleEl.textContent = book.title;
    const metaEl = document.createElement("div");
    metaEl.className = "book-item-meta";
    metaEl.textContent = `${String(book.format || "txt").toUpperCase()} · Cap. ${
      (prog.chapterIndex || 0) + 1
    }/${book.chapters.length} · Párr. ${(prog.paragraphIndex || 0) + 1}`;

    info.appendChild(titleEl);
    info.appendChild(metaEl);
    info.addEventListener("click", () => {
      loadBookChapter(book, prog.chapterIndex || 0, prog.paragraphIndex || 0, true, prog.chunkIndex ?? null);
    });

    const actions = document.createElement("div");
    actions.className = "book-item-actions";
    const playBtn = document.createElement("button");
    playBtn.className = "btn-mini";
    playBtn.textContent = "▶";
    playBtn.title = "Reanudar";
    playBtn.addEventListener("click", () => {
      loadBookChapter(book, prog.chapterIndex || 0, prog.paragraphIndex || 0, true, prog.chunkIndex ?? null);
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn-mini danger";
    delBtn.textContent = "✕";
    delBtn.title = "Eliminar";
    delBtn.addEventListener("click", () => {
      appState.library = appState.library.filter((b) => b.id !== book.id);
      if (appState.activeBookId === book.id) {
        appState.activeBookId = null;
        engine.stop();
        elements.bookReaderCard.classList.add("hidden");
      }
      saveLibrary();
      renderLibraryList();
    });

    actions.appendChild(playBtn);
    actions.appendChild(delBtn);
    row.appendChild(info);
    row.appendChild(actions);
    elements.libraryList.appendChild(row);
  }
}

async function handleFileUpload(file) {
  if (!file) return;
  try {
    elements.liveCaption.textContent = `Procesando ${file.name}...`;
    const isEpub = /\.epub$/i.test(file.name);
    const content = isEpub ? await file.arrayBuffer() : await file.text();
    const book = await parseBookInput({ name: file.name, content });
    appState.library.unshift(book);
    appState.activeBookId = book.id;
    switchTabMode("books");
    loadBookChapter(book, 0, 0, false);
    elements.liveCaption.textContent = `Cargado: ${book.title}`;
  } catch (err) {
    elements.liveCaption.textContent = `Error al abrir ${file.name}: ${err?.message || "formato inválido"}`;
  }
}

async function handleLoadPastedText() {
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
  elements.tabBtnWeb.addEventListener("click", () => switchTabMode("web"));
  elements.tabBtnBooks.addEventListener("click", () => switchTabMode("books"));
  elements.btnRefreshTab.addEventListener("click", refreshTabContext);
  elements.btnReadPage.addEventListener("click", handleReadCurrentPage);

  elements.dropZone.addEventListener("click", () => elements.fileInput.click());
  elements.dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      elements.fileInput.click();
    }
  });
  elements.dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    elements.dropZone.classList.add("drag-over");
  });
  elements.dropZone.addEventListener("dragleave", () => {
    elements.dropZone.classList.remove("drag-over");
  });
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

  elements.btnTogglePaste.addEventListener("click", () => {
    elements.pastePanel.classList.toggle("hidden");
  });
  elements.btnLoadPasted.addEventListener("click", handleLoadPastedText);

  elements.chapterSelect.addEventListener("change", (e) => {
    const book = getActiveBook();
    if (!book) return;
    const chIdx = Number.parseInt(e.target.value, 10) || 0;
    loadBookChapter(book, chIdx, 0, engine.state === "playing");
  });

  elements.btnPlayPause.addEventListener("click", () => {
    if (engine.state === "playing") {
      engine.pause();
    } else if (engine.state === "paused") {
      engine.resume();
    } else if (engine.chunks.length > 0) {
      engine.play(engine.currentIndex);
    } else if (appState.mode === "web") {
      handleReadCurrentPage();
    }
  });

  elements.btnStop.addEventListener("click", () => {
    engine.stop();
    if (appState.activeSource === "web" && typeof appState.activeTabId === "number") {
      chrome.runtime.sendMessage({ type: "CHALAVOICE_CLEAR_HIGHLIGHT", tabId: appState.activeTabId }).catch(() => {});
    }
  });

  elements.btnPrevPara.addEventListener("click", () => engine.prevParagraph());
  elements.btnNextPara.addEventListener("click", () => engine.nextParagraph());

  elements.progressScrubber.addEventListener("change", (e) => {
    if (engine.chunks.length === 0) return;
    const pct = Number(e.target.value) / 100;
    const idx = Math.min(engine.chunks.length - 1, Math.max(0, Math.floor(pct * engine.chunks.length)));
    engine.jumpToChunk(idx);
  });

  for (const btn of elements.presetButtons) {
    btn.addEventListener("click", () => {
      const presetId = btn.dataset.preset;
      const preset = engine.applyPreset(presetId);
      if (!preset) return;
      appState.settings.preset = presetId;
      appState.settings.rate = preset.rate;
      appState.settings.pitch = preset.pitch;
      appState.settings.paragraphPauseMs = preset.paragraphPauseMs;
      syncControlsFromSettings();
      saveSettings();
    });
  }

  elements.voiceSelect.addEventListener("change", (e) => {
    const uri = e.target.value;
    appState.settings.voiceURI = uri;
    const match = appState.rankedVoices.find((v) => v.voiceURI === uri);
    engine.setVoice(match ? match.voice : null);
    saveSettings();
  });

  elements.rateRange.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    appState.settings.rate = val;
    appState.settings.preset = "custom";
    elements.rateValue.textContent = `${val.toFixed(2)}x`;
    engine.setRate(val);
    for (const btn of elements.presetButtons) btn.classList.remove("active");
    saveSettings();
  });

  elements.pitchRange.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    appState.settings.pitch = val;
    appState.settings.preset = "custom";
    elements.pitchValue.textContent = val.toFixed(2);
    engine.setPitch(val);
    for (const btn of elements.presetButtons) btn.classList.remove("active");
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
    const mins = Number(e.target.value) || 0;
    engine.setSleepTimer(mins);
  });

  if (chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "CHALAVOICE_TAB_UPDATED") {
        refreshTabContext();
      } else if (message?.type === "CHALAVOICE_PANEL_JUMP") {
        if (appState.activeSource === "web") {
          engine.jumpToParagraph(Number(message.paragraphIndex) || 0);
          if (engine.state !== "playing") {
            engine.play(engine.currentIndex);
          }
        }
      }
    });
  }
}

async function init() {
  applyI18n();
  elements.linkSuite.href = CONFIG.WEBSITE_URL;
  elements.linkGithub.href = CONFIG.GITHUB_REPO_URL;
  elements.linkDonate.href = CONFIG.PAYPAL_DONATE_URL;

  try {
    chrome.runtime?.connect({ name: "chalavoice-sidepanel" });
  } catch {
    // Ignorar fuera de contexto de extensión
  }

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
    // Usar valores por defecto
  }

  syncControlsFromSettings();
  renderLibraryList();

  const savedBook = getActiveBook();
  if (savedBook) {
    const prog = savedBook.progress || { chapterIndex: 0, paragraphIndex: 0, chunkIndex: 0 };
    loadBookChapter(savedBook, prog.chapterIndex || 0, prog.paragraphIndex || 0, false, prog.chunkIndex ?? null);
  }

  if (typeof speechSynthesis !== "undefined") {
    appState.rawVoices = await loadVoices(speechSynthesis);
    refreshVoiceSelect(savedBook ? savedBook.title : "", savedBook?.lang || "es");
  }

  bindEvents();
  await refreshTabContext();
}

init();
