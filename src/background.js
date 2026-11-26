import { isRestrictedUrl } from "./config.js";

let highlightedTabs = new Set();

/**
 * Configura el Side Panel para que action.onClicked siempre se dispare,
 * otorgando activeTab y abriendo el panel lateral (Chromium/Edge) o sidebarAction (Firefox).
 */
export async function configureSidePanelBehavior() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch {
    // Ignorar en navegadores sin setPanelBehavior
  }
}

/**
 * Obtiene la pestaña activa de la ventana actual o de la última ventana enfocada.
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
export async function getActiveTab() {
  const current = await chrome.tabs.query({ active: true, currentWindow: true });
  if (current && current[0]) return current[0];
  const fallback = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return fallback?.[0] || null;
}

function notifyPanel(payload) {
  try {
    const maybePromise = chrome.runtime.sendMessage(payload);
    if (maybePromise && typeof maybePromise.catch === "function") {
      maybePromise.catch(() => {});
    }
  } catch {
    // El panel lateral puede no estar abierto todavía
  }
}

/**
 * Abre el panel lateral nativo de Chromium/Edge o sidebarAction en Firefox
 * preservando el gesto de usuario de forma síncrona.
 * @param {chrome.tabs.Tab} tab
 */
export function openSidePanelForTab(tab) {
  if (chrome.sidePanel?.open && typeof tab?.windowId === "number") {
    return Promise.resolve(chrome.sidePanel.open({ windowId: tab.windowId }))
      .catch(() => {})
      .finally(() => {
        notifyPanel({ type: "CHALAVOICE_TAB_UPDATED", tabId: tab?.id ?? null });
      });
  }

  const firefoxSidebarOpen =
    globalThis.browser?.sidebarAction?.open || chrome.sidebarAction?.open;
  if (typeof firefoxSidebarOpen === "function") {
    return Promise.resolve(firefoxSidebarOpen())
      .catch(() => {})
      .finally(() => {
        notifyPanel({ type: "CHALAVOICE_TAB_UPDATED", tabId: tab?.id ?? null });
      });
  }

  notifyPanel({ type: "CHALAVOICE_TAB_UPDATED", tabId: tab?.id ?? null });
  return Promise.resolve();
}

/**
 * Consulta la información básica de la pestaña activa y si está restringida.
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
 * Inyecta readability.js + highlighter.js en la pestaña indicada (si no está restringida)
 * y extrae los bloques legibles del artículo para lectura en voz alta.
 * @param {number} [explicitTabId]
 */
export async function extractFromTab(explicitTabId) {
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
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/readability.js", "content/highlighter.js"]
    });

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "CHALAVOICE_CONTENT_EXTRACT"
    });

    if (!response?.ok) {
      return {
        ok: false,
        restricted: false,
        reason: response?.reason || "EXTRACTION_FAILED",
        tabId: tab.id,
        url: rawUrl
      };
    }

    highlightedTabs.add(tab.id);
    return {
      ok: true,
      restricted: false,
      tabId: tab.id,
      url: rawUrl,
      article: response.article
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

async function clearAllHighlights() {
  const targets = Array.from(highlightedTabs);
  highlightedTabs.clear();
  await Promise.allSettled(
    targets.map((tabId) =>
      chrome.tabs
        .sendMessage(tabId, { type: "CHALAVOICE_CONTENT_CLEAR" })
        .catch(() => {})
    )
  );
}

/**
 * Registra todos los listeners del Service Worker / background script MV3.
 */
export function registerBackgroundListeners() {
  highlightedTabs = new Set();

  if (chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      configureSidePanelBehavior();
    });
  }

  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      configureSidePanelBehavior();
    });
  }

  if (chrome.action?.onClicked) {
    chrome.action.onClicked.addListener((tab) => {
      openSidePanelForTab(tab);
    });
  }

  if (chrome.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener(({ tabId }) => {
      notifyPanel({ type: "CHALAVOICE_TAB_UPDATED", tabId });
    });
  }

  if (chrome.tabs?.onUpdated) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (tab?.active && (changeInfo.status === "complete" || changeInfo.url || changeInfo.title)) {
        notifyPanel({ type: "CHALAVOICE_TAB_UPDATED", tabId });
      }
    });
  }

  if (chrome.tabs?.onRemoved) {
    chrome.tabs.onRemoved.addListener((tabId) => {
      highlightedTabs.delete(tabId);
    });
  }

  if (chrome.runtime.onConnect) {
    chrome.runtime.onConnect.addListener((port) => {
      if (port?.name !== "chalavoice-sidepanel") return;
      if (port.onDisconnect?.addListener) {
        port.onDisconnect.addListener(() => {
          clearAllHighlights();
        });
      }
    });
  }

  if (chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender?.tab) {
        if (message?.type === "CHALAVOICE_JUMP_TO_PARAGRAPH") {
          notifyPanel({
            type: "CHALAVOICE_PANEL_JUMP",
            tabId: sender.tab.id,
            paragraphIndex: Number(message.paragraphIndex) || 0
          });
        }
        return false;
      }

      const handleAsync = async () => {
        switch (message?.type) {
          case "CHALAVOICE_GET_TAB_INFO":
            return getActiveTabInfo();
          case "CHALAVOICE_EXTRACT_TAB":
            return extractFromTab(message.tabId);
          case "CHALAVOICE_HIGHLIGHT_CHUNK":
            if (typeof message.tabId === "number") {
              highlightedTabs.add(message.tabId);
              await chrome.tabs
                .sendMessage(message.tabId, {
                  type: "CHALAVOICE_CONTENT_HIGHLIGHT",
                  paragraphIndex: Number(message.paragraphIndex) || 0,
                  sentenceText: String(message.sentenceText || "")
                })
                .catch(() => {});
            }
            return { ok: true };
          case "CHALAVOICE_CLEAR_HIGHLIGHT":
            if (typeof message.tabId === "number") {
              highlightedTabs.delete(message.tabId);
              await chrome.tabs
                .sendMessage(message.tabId, { type: "CHALAVOICE_CONTENT_CLEAR" })
                .catch(() => {});
            } else {
              await clearAllHighlights();
            }
            return { ok: true };
          default:
            return null;
        }
      };

      const knownTypes = new Set([
        "CHALAVOICE_GET_TAB_INFO",
        "CHALAVOICE_EXTRACT_TAB",
        "CHALAVOICE_HIGHLIGHT_CHUNK",
        "CHALAVOICE_CLEAR_HIGHLIGHT"
      ]);
      if (!knownTypes.has(message?.type)) {
        return false;
      }

      handleAsync().then(sendResponse, () => {
        sendResponse({ ok: false, restricted: true, reason: "UNKNOWN_ERROR" });
      });
      return true;
    });
  }
}

export { isRestrictedUrl };

if (
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  (chrome.sidePanel || globalThis.browser?.sidebarAction || chrome.sidebarAction)
) {
  configureSidePanelBehavior();
  registerBackgroundListeners();
}
