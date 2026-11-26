import { CONFIG } from "../config.js";
import { parseBookInput } from "../lib/book-parser.js";

const { loadVoices, rankVoices } = globalThis.ChalaVoiceRanker;

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
  btnPickStart: document.getElementById("btnPickStart"),
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  btnTogglePaste: document.getElementById("btnTogglePaste"),
  btnOpenReader: document.getElementById("btnOpenReader"),
  pastePanel: document.getElementById("pastePanel"),
  pasteTitleInput: document.getElementById("pasteTitleInput"),
  pasteTextArea: document.getElementById("pasteTextArea"),
  btnLoadPasted: document.getElementById("btnLoadPasted"),
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
  mode: "web",
  activeTabId: null,
  restricted: false,
  targetSource: "web", // "web" | "book"
  playbackState: "idle",
  library: [],
  activeBookId: null,
  settings: { ...CONFIG.DEFAULT_SETTINGS },
  rankedVoices: []
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
    // Ignorar
  }
}

async function saveLibrary() {
  try {
    await chrome.storage?.local?.set({
      [CONFIG.STORAGE_KEYS.LIBRARY]: appState.library,
      [CONFIG.STORAGE_KEYS.ACTIVE_BOOK_ID]: appState.activeBookId
    });
  } catch (err) {
    elements.liveCaption.textContent = `Error de almacenamiento: ${err?.message || "espacio lleno"}`;
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
}

function applyRemoteStatus(status) {
  if (!status) return;
  appState.targetSource = status.source || "web";
  appState.playbackState = status.state || "idle";

  elements.statusBadge.dataset.state = appState.playbackState;
  if (appState.playbackState === "playing") {
    elements.statusBadge.textContent = t("statusReading", "Leyendo en voz alta");
    elements.btnPlayPause.textContent = "⏸";
  } else if (appState.playbackState === "paused") {
    elements.statusBadge.textContent = t("statusPaused", "En pausa");
    elements.btnPlayPause.textContent = "▶";
  } else {
    elements.statusBadge.textContent = t("statusReady", "Listo");
    elements.btnPlayPause.textContent = "▶";
  }

  if (status.currentText) {
    elements.liveCaption.textContent = status.currentText;
  }
  elements.progressScrubber.value = String(status.percent || 0);
  elements.progressCounter.textContent =
    status.totalChunks > 0
      ? `${status.chunkIndex + 1} / ${status.totalChunks} (${status.percent}%)`
      : "0 / 0";

  if (status.sleepActive && status.sleepRemainingMs > 0) {
    elements.sleepCountdown.classList.remove("hidden");
    elements.sleepCountdown.textContent = `⏱ ${formatDuration(status.sleepRemainingMs)}`;
  } else {
    elements.sleepCountdown.classList.add("hidden");
  }
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

async function sendActiveCommand(payload) {
  if (appState.targetSource === "book") {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "CHALAVOICE_READER_CMD",
        ...payload
      });
      if (resp?.status) applyRemoteStatus(resp.status);
      return resp;
    } catch {
      appState.targetSource = "web";
    }
  }

  const res = await chrome.runtime.sendMessage({
    type: "CHALAVOICE_TAB_COMMAND",
    tabId: appState.activeTabId,
    payload
  });
  if (res?.status) {
    applyRemoteStatus(res.status);
  }
  return res;
}

async function refreshTabAndSyncState() {
  try {
    const info = await chrome.runtime.sendMessage({ type: "CHALAVOICE_GET_TAB_INFO" });
    appState.activeTabId = info?.tabId ?? null;
    appState.restricted = Boolean(info?.restricted);
    elements.activeTabTitle.textContent = info?.title || "Pestaña activa";
    elements.activeTabUrl.textContent = info?.url || "";
    elements.restrictedNotice.classList.toggle("hidden", !appState.restricted);
    elements.btnReadPage.disabled = appState.restricted;
    elements.btnPickStart.disabled = appState.restricted;

    if (!appState.restricted && typeof appState.activeTabId === "number") {
      try {
        const ping = await chrome.tabs.sendMessage(appState.activeTabId, { type: "CHALAVOICE_PING" });
        if (ping?.alive && ping.status) {
          applyRemoteStatus(ping.status);
          return;
        }
      } catch {
        // Contenido aún no inyectado en esta pestaña
      }
    }

    // Revisar si el Lector de Libros dedicado está reproduciendo actualmente
    try {
      const readerPing = await chrome.runtime.sendMessage({ type: "CHALAVOICE_READER_PING" });
      if (readerPing?.alive && readerPing.status) {
        applyRemoteStatus(readerPing.status);
      }
    } catch {
      // Lector de libros cerrado
    }
  } catch {
    elements.activeTabTitle.textContent = "Pestaña no disponible";
    elements.restrictedNotice.classList.remove("hidden");
    elements.btnReadPage.disabled = true;
    elements.btnPickStart.disabled = true;
  }
}

async function handleReadCurrentPage() {
  if (appState.restricted) return;
  appState.targetSource = "web";
  elements.liveCaption.textContent = "Iniciando lectura persistente...";
  const res = await sendActiveCommand({ action: "PLAY_PAGE", paragraphIndex: 0 });
  if (!res?.ok) {
    elements.liveCaption.textContent = "No se encontró texto legible en esta página.";
  }
}

async function handlePickStartInspector() {
  if (appState.restricted) return;
  await chrome.runtime.sendMessage({
    type: "CHALAVOICE_TAB_COMMAND",
    tabId: appState.activeTabId,
    payload: { action: "START_INSPECTOR" }
  });
  // Cierra el Popup automáticamente para despejar la vista mientras el usuario señala en la página
  window.close();
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
    metaEl.textContent = `${String(book.format || "txt").toUpperCase()} · Cap. ${(prog.chapterIndex || 0) + 1}/${book.chapters.length}`;

    info.appendChild(titleEl);
    info.appendChild(metaEl);

    const openBook = async () => {
      appState.activeBookId = book.id;
      await saveLibrary();
      await chrome.runtime.sendMessage({ type: "CHALAVOICE_OPEN_READER", autoplay: true });
      window.close();
    };
    info.addEventListener("click", openBook);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "4px";

    const playBtn = document.createElement("button");
    playBtn.className = "btn-mini";
    playBtn.textContent = "▶";
    playBtn.title = "Abrir y leer";
    playBtn.addEventListener("click", openBook);

    const delBtn = document.createElement("button");
    delBtn.className = "btn-mini danger";
    delBtn.textContent = "✕";
    delBtn.title = "Eliminar";
    delBtn.addEventListener("click", async () => {
      appState.library = appState.library.filter((b) => b.id !== book.id);
      if (appState.activeBookId === book.id) {
        appState.activeBookId = appState.library[0]?.id || null;
      }
      await saveLibrary();
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
    await saveLibrary();
    renderLibraryList();
    await chrome.runtime.sendMessage({ type: "CHALAVOICE_OPEN_READER", autoplay: true });
    window.close();
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
  await saveLibrary();
  renderLibraryList();
  await chrome.runtime.sendMessage({ type: "CHALAVOICE_OPEN_READER", autoplay: true });
  window.close();
}

async function populateVoiceSelect() {
  if (typeof speechSynthesis === "undefined") return;
  const voices = await loadVoices(speechSynthesis);
  appState.rankedVoices = rankVoices(voices, "es");
  elements.voiceSelect.innerHTML = "";

  if (appState.rankedVoices.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("statusNoVoices", "Sin voces del sistema");
    elements.voiceSelect.appendChild(opt);
    return;
  }

  for (const item of appState.rankedVoices) {
    const opt = document.createElement("option");
    opt.value = item.voiceURI;
    const star = item.qualityTier === "neural" ? " ★" : "";
    opt.textContent = `${item.name} (${item.lang || "?"})${star}`;
    elements.voiceSelect.appendChild(opt);
  }

  if (appState.settings.voiceURI && appState.rankedVoices.some((v) => v.voiceURI === appState.settings.voiceURI)) {
    elements.voiceSelect.value = appState.settings.voiceURI;
  } else if (appState.rankedVoices[0]) {
    elements.voiceSelect.value = appState.rankedVoices[0].voiceURI;
  }
}

function bindEvents() {
  elements.tabBtnWeb.addEventListener("click", () => switchTabMode("web"));
  elements.tabBtnBooks.addEventListener("click", () => switchTabMode("books"));
  elements.btnRefreshTab.addEventListener("click", refreshTabAndSyncState);
  elements.btnReadPage.addEventListener("click", handleReadCurrentPage);
  elements.btnPickStart.addEventListener("click", handlePickStartInspector);

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
  elements.btnOpenReader.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CHALAVOICE_OPEN_READER", autoplay: false });
    window.close();
  });
  elements.btnLoadPasted.addEventListener("click", handleLoadPastedText);

  elements.btnPlayPause.addEventListener("click", () => {
    if (appState.playbackState === "idle" && appState.targetSource === "web") {
      handleReadCurrentPage();
      return;
    }
    sendActiveCommand({ action: "TOGGLE_PLAY" });
  });
  elements.btnStop.addEventListener("click", () => sendActiveCommand({ action: "STOP" }));
  elements.btnPrevPara.addEventListener("click", () => sendActiveCommand({ action: "PREV_PARA" }));
  elements.btnNextPara.addEventListener("click", () => sendActiveCommand({ action: "NEXT_PARA" }));

  elements.progressScrubber.addEventListener("change", (e) => {
    sendActiveCommand({ action: "SEEK_PERCENT", percent: Number(e.target.value) || 0 });
  });

  for (const btn of elements.presetButtons) {
    btn.addEventListener("click", async () => {
      const presetId = btn.dataset.preset;
      const preset = CONFIG.VOICE_PRESETS[presetId];
      if (!preset) return;
      appState.settings.preset = presetId;
      appState.settings.rate = preset.rate;
      appState.settings.pitch = preset.pitch;
      appState.settings.paragraphPauseMs = preset.paragraphPauseMs;
      syncControlsFromSettings();
      await saveSettings();
      sendActiveCommand({ action: "UPDATE_SETTINGS", settings: appState.settings });
    });
  }

  elements.voiceSelect.addEventListener("change", async (e) => {
    appState.settings.voiceURI = e.target.value;
    await saveSettings();
    sendActiveCommand({ action: "UPDATE_SETTINGS", settings: { voiceURI: e.target.value } });
  });

  elements.rateRange.addEventListener("input", async (e) => {
    const val = Number(e.target.value);
    appState.settings.rate = val;
    appState.settings.preset = "custom";
    elements.rateValue.textContent = `${val.toFixed(2)}x`;
    for (const b of elements.presetButtons) b.classList.remove("active");
    await saveSettings();
    sendActiveCommand({ action: "UPDATE_SETTINGS", settings: { rate: val, preset: "custom" } });
  });

  elements.pitchRange.addEventListener("input", async (e) => {
    const val = Number(e.target.value);
    appState.settings.pitch = val;
    appState.settings.preset = "custom";
    elements.pitchValue.textContent = val.toFixed(2);
    for (const b of elements.presetButtons) b.classList.remove("active");
    await saveSettings();
    sendActiveCommand({ action: "UPDATE_SETTINGS", settings: { pitch: val, preset: "custom" } });
  });

  elements.volumeRange.addEventListener("input", async (e) => {
    const val = Number(e.target.value);
    appState.settings.volume = val;
    elements.volumeValue.textContent = `${Math.round(val * 100)}%`;
    await saveSettings();
    sendActiveCommand({ action: "UPDATE_SETTINGS", settings: { volume: val } });
  });

  elements.sleepSelect.addEventListener("change", (e) => {
    const mins = Number(e.target.value) || 0;
    sendActiveCommand({ action: "UPDATE_SETTINGS", sleepMinutes: mins });
  });

  if (chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "CHALAVOICE_STATE_UPDATE" && message.status) {
        applyRemoteStatus(message.status);
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

  syncControlsFromSettings();
  renderLibraryList();
  await populateVoiceSelect();
  bindEvents();
  await refreshTabAndSyncState();
}

init();
