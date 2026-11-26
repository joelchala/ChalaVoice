import { isRestrictedUrl } from "./config.js";

const CONTENT_SCRIPT_FILES = [
  "lib/readability.js",
  "lib/voice-ranker.js",
  "lib/speech-queue.js",
  "content/highlighter.js"
];

/**
 * Obtiene la pestaña activa de la ventana actual o la última ventana enfocada.
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
export async function getActiveTab() {
  const current = await chrome.tabs.query({ active: true, currentWindow: true });
  if (current && current[0]) return current[0];
  const fallback = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return fallback?.[0] || null;
}

/**
 * Consulta la información básica de la pestaña activa y valida si es una URL restringida.
 */
export async function getActiveTabInfo() {
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number") {
    return { ok: false, restricted: true, reason: "NO_TAB", url: "", title: "" };
  }
  const url = tab.url || tab.pendingUrl || "";
  const restricted = !url || isRestrictedUrl(url);
  return {
    ok: !restricted,
    tabId: tab.id,
    url,
    title: tab.title || "",
    restricted,
    reason: restricted ? "RESTRICTED_URL" : "OK"
  };
}

/**
 * Inyecta los scripts locales en la pestaña destino solo si aún no están activos,
 * preservando cualquier reproducción en curso cuando el usuario reabre el Popup.
 * @param {number} tabId
 */
export async function ensureContentInjected(tabId) {
  let ping = null;
  try {
    ping = await chrome.tabs.sendMessage(tabId, { type: "CHALAVOICE_PING" });
  } catch {
    ping = null;
  }

  if (ping?.alive) {
    return { ok: true, alreadyInjected: true, status: ping.status || null };
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES
  });

  return { ok: true, alreadyInjected: false, status: null };
}

/**
 * Envía un comando de reproducción o Modo Inspector a una pestaña accesible.
 * @param {number|null|undefined} explicitTabId
 * @param {object} commandPayload
 */
export async function sendTabCommand(explicitTabId, commandPayload) {
  const tab =
    typeof explicitTabId === "number"
      ? (await chrome.tabs.get?.(explicitTabId).catch(() => null)) || (await getActiveTab())
      : await getActiveTab();

  if (!tab || typeof tab.id !== "number") {
    return { ok: false, restricted: true, reason: "NO_TAB" };
  }

  const rawUrl = tab.url || tab.pendingUrl || "";
  if (isRestrictedUrl(rawUrl)) {
    return {
      ok: false,
      restricted: true,
      reason: "RESTRICTED_URL",
      tabId: tab.id,
      url: rawUrl,
      title: tab.title || ""
    };
  }

  try {
    await ensureContentInjected(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, {
      ...commandPayload,
      type: "CHALAVOICE_CMD"
    });
    return {
      ok: Boolean(response?.ok),
      restricted: false,
      tabId: tab.id,
      url: rawUrl,
      status: response?.status || null,
      reason: response?.reason || null
    };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err || "")).toLowerCase();
    const isInternal =
      msg.includes("chrome:") ||
      msg.includes("edge:") ||
      msg.includes("about:") ||
      msg.includes("cannot access") ||
      msg.includes("webstore") ||
      msg.includes("addons");
    return {
      ok: false,
      restricted: isInternal,
      reason: isInternal ? "RESTRICTED_URL" : "INJECTION_ERROR",
      error: err instanceof Error ? err.message : String(err || ""),
      tabId: tab.id,
      url: rawUrl
    };
  }
}

/**
 * Abre o enfoca la pestaña dedicada del Lector de Libros (src/reader/index.html)
 * para que la reproducción de .epub / .md / .txt continúe aunque se cierre el Popup.
 */
export async function openBookReaderTab(options = {}) {
  const readerBaseUrl = chrome.runtime.getURL("reader/index.html");
  const targetUrl = options.autoplay ? `${readerBaseUrl}?autoplay=1` : readerBaseUrl;

  if (typeof chrome.tabs?.query === "function") {
    const tabs = await chrome.tabs.query({});
    const existing = (tabs || []).find((t) => typeof t.url === "string" && t.url.startsWith(readerBaseUrl));
    if (existing && typeof existing.id === "number") {
      await chrome.tabs.update?.(existing.id, { active: true });
      if (typeof existing.windowId === "number" && chrome.windows?.update) {
        await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
      }
      if (options.autoplay) {
        await chrome.tabs.sendMessage(existing.id, { type: "CHALAVOICE_READER_RELOAD_AND_PLAY" }).catch(() => {});
      }
      return { ok: true, tabId: existing.id, reused: true };
    }
  }

  const created = await chrome.tabs.create({ url: targetUrl });
  return { ok: true, tabId: created?.id ?? null, reused: false };
}

/**
 * Registra listeners del Service Worker / background script MV3.
 */
export function registerBackgroundListeners() {
  if (!chrome.runtime?.onMessage) return;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.tab && message?.type === "CHALAVOICE_STATE_UPDATE") {
      return false;
    }

    const handleAsync = async () => {
      switch (message?.type) {
        case "CHALAVOICE_GET_TAB_INFO":
          return getActiveTabInfo();
        case "CHALAVOICE_TAB_COMMAND":
          return sendTabCommand(message.tabId, message.payload || {});
        case "CHALAVOICE_OPEN_READER":
          return openBookReaderTab({ autoplay: Boolean(message.autoplay) });
        default:
          return null;
      }
    };

    const known = new Set([
      "CHALAVOICE_GET_TAB_INFO",
      "CHALAVOICE_TAB_COMMAND",
      "CHALAVOICE_OPEN_READER"
    ]);
    if (!known.has(message?.type)) {
      return false;
    }

    handleAsync().then(sendResponse, () => {
      sendResponse({ ok: false, restricted: true, reason: "UNKNOWN_ERROR" });
    });
    return true;
  });
}

export { isRestrictedUrl };

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  registerBackgroundListeners();
}
