/**
 * Configuración centralizada de ChalaVoice (Suite Chala).
 * Define la paleta de alto contraste (Negro, Gris, Naranja y Blanco),
 * presets acústicos de voz, URLs restringidas, enlaces Suite Chala y PayPal.
 */

export const PAYPAL_DONATE_URL = "https://www.paypal.com/ncp/payment/VSWPSS7D4ZRH2";

export const CONFIG = {
  APP_NAME: "ChalaVoice",
  VERSION: "1.1.0",
  WEBSITE_URL: "https://chaladev.site",
  GITHUB_REPO_URL: "https://github.com/joelchala/ChalaVoice",
  PAYPAL_DONATE_URL,
  SUITE_LINKS: {
    chalablock: "https://github.com/joelchala/Chalablock",
    chalavpn: "https://github.com/joelchala/ChalaVPN",
    chaladev: "https://github.com/joelchala/ChalaDev",
    chalacookiesedit: "https://github.com/joelchala/ChalaCookiesEdit",
    chalareader: "https://github.com/joelchala/ChalaReader",
    chalascrape: "https://github.com/joelchala/ChalaScrape",
    chalatabs: "https://github.com/joelchala/ChalaTabs",
    chalavoice: "https://github.com/joelchala/ChalaVoice"
  },
  COLORS: {
    BG_DARK: "#0B0B0E",
    BG_ELEVATED: "#121216",
    SURFACE: "#1C1C22",
    SURFACE_ALT: "#2A2A32",
    BORDER: "#3F3F46",
    TEXT_MUTED: "#A1A1AA",
    PRIMARY: "#F97316",
    PRIMARY_HOVER: "#EA580C",
    ACCENT: "#FB923C",
    TEXT_WHITE: "#FFFFFF",
    TEXT_MAIN: "#F4F4F5"
  },
  VOICE_PRESETS: {
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
  },
  SLEEP_TIMER_MINUTES: [0, 15, 30, 45, 60],
  WORDS_PER_MINUTE: 150,
  DEFAULT_SETTINGS: {
    preset: "natural",
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    paragraphPauseMs: 500,
    voiceURI: "",
    autoDetectLang: true
  },
  STORAGE_KEYS: {
    SETTINGS: "chalavoice_settings",
    LIBRARY: "chalavoice_library",
    ACTIVE_BOOK_ID: "chalavoice_active_book"
  },
  PROTECTED_URL_PREFIXES: [
    "chrome://",
    "edge://",
    "about:",
    "chrome-extension://",
    "moz-extension://",
    "extension://",
    "devtools://",
    "view-source:",
    "chrome-search://",
    "chrome-untrusted://",
    "edge-untrusted://",
    "data:",
    "javascript:",
    "https://chrome.google.com/webstore",
    "https://chromewebstore.google.com",
    "https://microsoftedge.microsoft.com/addons",
    "https://addons.mozilla.org"
  ]
};

/**
 * Determina si una URL pertenece a una página interna o protegida del navegador
 * donde Chromium/Edge/Firefox restringen la inyección de scripts.
 * @param {string} rawUrl
 * @returns {boolean}
 */
export function isRestrictedUrl(rawUrl) {
  if (typeof rawUrl !== "string") {
    return true;
  }
  const normalized = rawUrl.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return CONFIG.PROTECTED_URL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
