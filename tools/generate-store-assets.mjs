/**
 * Generador de activos gráficos de tienda de alta calidad para ChalaVoice (cero dependencias npm).
 * Renderiza piezas HTML/CSS reales usando Edge/Chrome Headless vía Chrome DevTools Protocol (WebSocket nativo de Node >= 22):
 *   - store/promo-440x280.png (440 x 280)
 *   - store/destacada-1400x560.png (1400 x 560)
 *   - store/captura-1-lector-web.png (1280 x 800)
 *   - store/captura-2-perfiles-voz.png (1280 x 800)
 *   - store/captura-3-biblioteca-epub.png (1280 x 800)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const STORE_DIR = path.join(ROOT, "store");
const ICON_SVG_PATH = path.join(ROOT, "src", "icons", "icon.svg");

function getIconDataUri() {
  const svg = fs.readFileSync(ICON_SVG_PATH, "utf8");
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function findBrowserBinary() {
  const candidates = [];
  if (process.env.CHALAVOICE_RENDER_BROWSER) {
    candidates.push(process.env.CHALAVOICE_RENDER_BROWSER);
  }
  if (process.platform === "win32") {
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const local = process.env.LOCALAPPDATA || "";
    candidates.push(
      path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      local ? path.join(local, "Google", "Chrome", "Application", "chrome.exe") : ""
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    );
  } else {
    candidates.push(
      "/usr/bin/microsoft-edge",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser"
    );
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error("No local Edge or Chrome binary found to render store assets.");
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForTargetWsUrl(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      // Browser still starting
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error("Timed out waiting for headless browser DevTools endpoint.");
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.readyPromise = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (err) => reject(err));
    });
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      }
    });
  }

  async connect() {
    await this.readyPromise;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // Ignore
    }
  }
}

function assertPngDimensions(filePath, expectedWidth, expectedHeight) {
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const buf = fs.readFileSync(filePath);
  if (!buf.subarray(0, 8).equals(pngSig)) {
    throw new Error(`Invalid PNG signature in ${filePath}`);
  }
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== expectedWidth || h !== expectedHeight) {
    throw new Error(`Dimension mismatch for ${filePath}: got ${w}x${h}, expected ${expectedWidth}x${expectedHeight}`);
  }
}

const BASE_CSS = `
  :root {
    --bg-dark: #0B0B0E;
    --bg-elevated: #121216;
    --surface: #1C1C22;
    --surface-alt: #2A2A32;
    --border: #3F3F46;
    --text-muted: #A1A1AA;
    --text-soft: #D4D4D8;
    --text-main: #F4F4F5;
    --text-white: #FFFFFF;
    --primary: #F97316;
    --primary-hover: #EA580C;
    --primary-soft: rgba(249, 115, 22, 0.16);
    --accent: #FB923C;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-dark);
    color: var(--text-main);
    font-family: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
`;

function wrapPage(width, height, extraCss, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<style>
${BASE_CSS}
body { width: ${width}px; height: ${height}px; }
${extraCss}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function buildPopupMockHtml(iconUri, opts = {}) {
  const mode = opts.mode || "web";
  const activePreset = opts.activePreset || "natural";
  const statusText = opts.statusText || "Leyendo en voz alta";
  const statusState = opts.statusState || "playing";
  const caption = opts.caption || "“La arquitectura local-first procesa cada párrafo directamente en tu dispositivo...”";
  const counter = opts.counter || "2 / 14";
  const progress = opts.progress ?? 24;
  const voiceName = opts.voiceName || "Dalia Online (Natural) — Español (MX)";
  const rate = opts.rate || "1.00x";
  const pitch = opts.pitch || "1.00";
  const volume = opts.volume || "100%";
  const sleepLabel = opts.sleepLabel || "Apagado";
  const sleepBadge = opts.sleepBadge || "";
  const showVoiceList = Boolean(opts.showVoiceList);

  const presets = [
    { id: "rustic", label: "Narrador Rústico" },
    { id: "soft", label: "Voz Suave" },
    { id: "study", label: "Modo Estudio" },
    { id: "natural", label: "Natural" }
  ];

  return `
    <div class="cv-popup">
      <div class="cv-topbar">
        <div class="cv-brand">
          <img src="${iconUri}" width="26" height="26" alt="" />
          <div>
            <div class="cv-brand-title">ChalaVoice</div>
            <div class="cv-brand-sub">100% local · Sin telemetría</div>
          </div>
        </div>
        <span class="cv-pill ${statusState}">${statusText}</span>
      </div>

      <div class="cv-tabs">
        <div class="cv-tab ${mode === "web" ? "active" : ""}">Página Web</div>
        <div class="cv-tab ${mode === "books" ? "active" : ""}">Libros y Textos</div>
      </div>

      ${
        mode === "web"
          ? `<div class="cv-card">
              <div class="cv-tab-head">
                <div class="cv-tab-meta">
                  <div class="cv-tab-title">Arquitectura local-first en la web moderna</div>
                  <div class="cv-tab-url">https://chaladev.site/articulos/local-first</div>
                </div>
                <div class="cv-icon-btn">↻</div>
              </div>
              <div class="cv-btn-primary">Leer página actual</div>
              <div class="cv-btn-inspector"><span>🎯</span><span>Seleccionar párrafo inicial</span></div>
            </div>`
          : ""
      }

      <div class="cv-card cv-player">
        <div class="cv-caption">${caption}</div>
        <div class="cv-prog-track"><div class="cv-prog-fill" style="width:${progress}%"></div></div>
        <div class="cv-prog-row">
          <span>${counter}</span>
          ${sleepBadge ? `<span class="cv-sleep-badge">${sleepBadge}</span>` : `<span>${mode === "web" ? "Párrafo 2 de 14" : "Estudio activo"}</span>`}
        </div>

        <div class="cv-transport">
          <div class="cv-tbtn">⏮</div>
          <div class="cv-play-btn">⏸</div>
          <div class="cv-tbtn">⏹</div>
          <div class="cv-tbtn">⏭</div>
        </div>

        <div class="cv-presets">
          ${presets
            .map(
              (p) =>
                `<div class="cv-preset ${p.id === activePreset ? "active" : ""}">${p.label}</div>`
            )
            .join("")}
        </div>

        <div class="cv-field">
          <div class="cv-label">Voz del sistema</div>
          <div class="cv-select">${voiceName}<span>▾</span></div>
          ${
            showVoiceList
              ? `<div class="cv-voice-dropdown">
                  <div class="cv-voice-opt active"><span>★ Dalia Online (Natural)</span><span>es-MX</span></div>
                  <div class="cv-voice-opt"><span>★ Elena Online (Natural)</span><span>es-AR</span></div>
                  <div class="cv-voice-opt"><span>Sabina Desktop · Local</span><span>es-MX</span></div>
                </div>`
              : ""
          }
        </div>

        <div class="cv-sliders">
          <div class="cv-slider-box">
            <div class="cv-slider-head"><span>Velocidad</span><b>${rate}</b></div>
            <div class="cv-slider-bar"><span style="width:${opts.ratePct || 35}%"></span></div>
          </div>
          <div class="cv-slider-box">
            <div class="cv-slider-head"><span>Tono</span><b>${pitch}</b></div>
            <div class="cv-slider-bar"><span style="width:${opts.pitchPct || 50}%"></span></div>
          </div>
          <div class="cv-slider-box">
            <div class="cv-slider-head"><span>Volumen</span><b>${volume}</b></div>
            <div class="cv-slider-bar"><span style="width:${opts.volPct || 95}%"></span></div>
          </div>
          <div class="cv-slider-box">
            <div class="cv-slider-head"><span>Temporizador</span><b>${sleepLabel}</b></div>
            <div class="cv-mini-select">${sleepLabel} ▾</div>
          </div>
        </div>
      </div>

      <div class="cv-footer">
        <span>Suite Chala</span> · <span>GitHub</span> · <span>Apoyar</span>
      </div>
    </div>
  `;
}

const POPUP_CSS = `
  .cv-popup {
    width: 344px;
    background: #0B0B0E;
    border: 1px solid #3F3F46;
    border-radius: 14px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(255,255,255,0.04);
  }
  .cv-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    background: #121216;
    border: 1px solid #2A2A32;
    border-radius: 10px;
  }
  .cv-brand { display: flex; align-items: center; gap: 8px; }
  .cv-brand img { border-radius: 6px; }
  .cv-brand-title { font-size: 13px; font-weight: 700; color: #FFFFFF; line-height: 1.2; }
  .cv-brand-sub { font-size: 10px; color: #A1A1AA; }
  .cv-pill {
    font-size: 10px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 999px;
    background: rgba(249, 115, 22, 0.16);
    color: #F97316;
    border: 1px solid #F97316;
    white-space: nowrap;
  }
  .cv-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .cv-tab {
    background: #121216;
    border: 1px solid #2A2A32;
    border-radius: 8px;
    padding: 6px 8px;
    text-align: center;
    font-size: 11.5px;
    font-weight: 600;
    color: #A1A1AA;
  }
  .cv-tab.active {
    background: rgba(249, 115, 22, 0.16);
    border-color: #F97316;
    color: #FFFFFF;
  }
  .cv-card {
    background: #121216;
    border: 1px solid #2A2A32;
    border-radius: 10px;
    padding: 9px 10px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .cv-tab-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .cv-tab-meta { min-width: 0; flex: 1; }
  .cv-tab-title {
    font-size: 12px; font-weight: 600; color: #FFFFFF;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cv-tab-url {
    font-size: 10px; color: #A1A1AA;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cv-icon-btn {
    width: 24px; height: 24px; border-radius: 7px;
    background: #1C1C22; border: 1px solid #3F3F46; color: #FFFFFF;
    display: flex; align-items: center; justify-content: center; font-size: 12px;
  }
  .cv-btn-primary {
    background: #F97316; color: #FFFFFF; font-weight: 700; font-size: 12px;
    text-align: center; padding: 7px 10px; border-radius: 8px;
  }
  .cv-btn-inspector {
    background: #1C1C22; color: #FFFFFF; border: 1px solid #F97316;
    font-weight: 600; font-size: 11.5px; padding: 6px 10px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  .cv-caption {
    background: #1C1C22; border: 1px solid #2A2A32; border-radius: 7px;
    padding: 6px 8px; font-size: 10.5px; color: #F4F4F5;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cv-prog-track { height: 5px; background: #2A2A32; border-radius: 999px; overflow: hidden; }
  .cv-prog-fill { height: 100%; background: #F97316; border-radius: 999px; }
  .cv-prog-row {
    display: flex; justify-content: space-between; font-size: 10px; color: #A1A1AA;
  }
  .cv-sleep-badge { color: #FB923C; font-weight: 700; }
  .cv-transport { display: flex; align-items: center; justify-content: center; gap: 8px; }
  .cv-tbtn {
    width: 32px; height: 28px; border-radius: 8px; background: #1C1C22;
    border: 1px solid #3F3F46; color: #FFFFFF; font-size: 12px;
    display: flex; align-items: center; justify-content: center;
  }
  .cv-play-btn {
    width: 46px; height: 32px; border-radius: 9px; background: #F97316;
    color: #FFFFFF; font-size: 14px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .cv-presets { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
  .cv-preset {
    background: #1C1C22; border: 1px solid #2A2A32; border-radius: 7px;
    padding: 5px 6px; text-align: center; font-size: 10.5px; font-weight: 600; color: #A1A1AA;
  }
  .cv-preset.active {
    background: rgba(249, 115, 22, 0.16); border-color: #F97316; color: #FFFFFF;
  }
  .cv-field { display: flex; flex-direction: column; gap: 3px; }
  .cv-label { font-size: 10px; color: #A1A1AA; }
  .cv-select {
    background: #1C1C22; border: 1px solid #3F3F46; border-radius: 7px;
    padding: 5px 8px; font-size: 11px; color: #FFFFFF;
    display: flex; justify-content: space-between; align-items: center;
  }
  .cv-voice-dropdown {
    margin-top: 3px; background: #18181D; border: 1px solid #3F3F46; border-radius: 7px;
    padding: 3px; display: flex; flex-direction: column; gap: 2px;
  }
  .cv-voice-opt {
    display: flex; justify-content: space-between; font-size: 10px; padding: 4px 6px;
    border-radius: 5px; color: #D4D4D8;
  }
  .cv-voice-opt.active { background: rgba(249, 115, 22, 0.18); color: #FFFFFF; font-weight: 600; }
  .cv-sliders { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .cv-slider-box { display: flex; flex-direction: column; gap: 4px; }
  .cv-slider-head { display: flex; justify-content: space-between; font-size: 10px; color: #A1A1AA; }
  .cv-slider-head b { color: #FFFFFF; font-weight: 600; }
  .cv-slider-bar { height: 5px; background: #2A2A32; border-radius: 999px; position: relative; }
  .cv-slider-bar span {
    display: block; height: 100%; background: #F97316; border-radius: 999px; position: relative;
  }
  .cv-slider-bar span::after {
    content: ""; position: absolute; right: -4px; top: -3px;
    width: 11px; height: 11px; border-radius: 999px; background: #FFFFFF; border: 2px solid #F97316;
  }
  .cv-mini-select {
    background: #1C1C22; border: 1px solid #3F3F46; border-radius: 6px;
    padding: 2px 6px; font-size: 10px; color: #FFFFFF;
  }
  .cv-footer {
    text-align: center; font-size: 10px; color: #FB923C; padding-top: 1px;
  }
`;

function buildPromo440x280(iconUri) {
  const css = `
    .canvas {
      width: 440px; height: 280px;
      padding: 24px 26px;
      background:
        radial-gradient(circle at 86% 24%, rgba(249, 115, 22, 0.24), transparent 52%),
        radial-gradient(circle at 12% 88%, rgba(251, 146, 60, 0.12), transparent 45%),
        #0B0B0E;
      border: 1px solid #2A2A32;
      display: flex; flex-direction: column; justify-content: space-between;
      position: relative;
    }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .brand { display: flex; align-items: center; gap: 14px; }
    .logo { width: 64px; height: 64px; border-radius: 14px; border: 1px solid #3F3F46; }
    .badge {
      display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
      color: #FB923C; background: rgba(249,115,22,0.14); border: 1px solid rgba(249,115,22,0.45);
      padding: 3px 8px; border-radius: 999px; margin-bottom: 5px;
    }
    h1 { margin: 0; font-size: 30px; font-weight: 800; color: #FFFFFF; letter-spacing: -0.02em; line-height: 1.05; }
    .eq { display: flex; align-items: flex-end; gap: 4px; height: 42px; padding-right: 2px; }
    .eq span { width: 5px; border-radius: 999px; background: linear-gradient(180deg, #FB923C, #F97316); }
    .tagline {
      margin: 0; font-size: 16.5px; font-weight: 600; color: #F4F4F5; line-height: 1.35;
      max-width: 380px;
    }
    .tagline strong { color: #FB923C; font-weight: 700; }
    .pills { display: flex; gap: 8px; flex-wrap: nowrap; }
    .pill {
      background: #1C1C22; border: 1px solid #3F3F46; border-radius: 8px;
      padding: 7px 10px; font-size: 11.5px; font-weight: 600; color: #FFFFFF;
      white-space: nowrap; display: flex; align-items: center; gap: 5px;
    }
    .pill .dot { width: 7px; height: 7px; border-radius: 999px; background: #F97316; }
  `;
  const html = `
    <div class="canvas">
      <div class="top">
        <div class="brand">
          <img class="logo" src="${iconUri}" alt="ChalaVoice" />
          <div>
            <span class="badge">100% LOCAL · OFFLINE</span>
            <h1>ChalaVoice</h1>
          </div>
        </div>
        <div class="eq" aria-hidden="true">
          <span style="height:14px;opacity:.6"></span>
          <span style="height:28px;opacity:.85"></span>
          <span style="height:40px"></span>
          <span style="height:24px;opacity:.8"></span>
          <span style="height:34px;opacity:.95"></span>
        </div>
      </div>

      <p class="tagline">Lector en voz alta privado para <strong>artículos web y libros digitales</strong>.</p>

      <div class="pills">
        <div class="pill"><span class="dot"></span>Voces Naturales</div>
        <div class="pill"><span class="dot"></span>Modo Inspector</div>
        <div class="pill"><span class="dot"></span>EPUB · MD · TXT</div>
      </div>
    </div>
  `;
  return wrapPage(440, 280, css, html);
}

function buildDestacada1400x560(iconUri) {
  const css = `
    ${POPUP_CSS}
    .canvas {
      width: 1400px; height: 560px;
      padding: 36px 48px;
      background:
        radial-gradient(circle at 76% 42%, rgba(249, 115, 22, 0.20), transparent 46%),
        radial-gradient(circle at 14% 18%, rgba(251, 146, 60, 0.10), transparent 36%),
        linear-gradient(135deg, #0B0B0E 0%, #121216 100%);
      display: grid;
      grid-template-columns: 580px 1fr;
      gap: 36px;
      align-items: center;
    }
    .hero { display: flex; flex-direction: column; gap: 18px; }
    .eyebrow-row { display: flex; align-items: center; gap: 12px; }
    .eyebrow-row img { width: 44px; height: 44px; border-radius: 10px; border: 1px solid #3F3F46; }
    .eyebrow {
      font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: #FB923C;
      background: rgba(249, 115, 22, 0.14); border: 1px solid rgba(249, 115, 22, 0.42);
      padding: 5px 12px; border-radius: 999px;
    }
    h1 {
      margin: 0; font-size: 46px; font-weight: 800; line-height: 1.08;
      letter-spacing: -0.025em; color: #FFFFFF;
    }
    h1 span { color: #F97316; }
    .sub {
      margin: 0; font-size: 18px; line-height: 1.48; color: #D4D4D8; max-width: 560px;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
    .chip {
      background: #1C1C22; border: 1px solid #3F3F46; border-radius: 10px;
      padding: 9px 14px; font-size: 13.5px; font-weight: 600; color: #FFFFFF;
      display: flex; align-items: center; gap: 8px;
    }
    .chip b { color: #F97316; }

    .stage { position: relative; height: 488px; }
    .article-card {
      position: absolute; left: 0; top: 22px; width: 378px; height: 378px;
      background: #FAFAFA; color: #18181B; border-radius: 14px;
      border: 1px solid #E4E4E7; padding: 22px 22px;
      box-shadow: 0 24px 54px rgba(0, 0, 0, 0.55);
    }
    .art-tag { font-size: 10.5px; font-weight: 700; color: #EA580C; letter-spacing: 0.06em; text-transform: uppercase; }
    .art-title { margin: 6px 0 12px; font-size: 19px; font-weight: 800; color: #09090B; line-height: 1.22; }
    .art-p { margin: 0 0 12px; font-size: 13px; line-height: 1.52; color: #3F3F46; }
    .art-p.active {
      outline: 2px solid #F97316; outline-offset: 5px;
      background: rgba(249, 115, 22, 0.14); border-radius: 6px;
      color: #09090B;
    }
    .art-p.active mark { background: rgba(249, 115, 22, 0.32); color: #09090B; border-radius: 3px; padding: 0 2px; }
    .popup-wrap {
      position: absolute; right: 0; top: 50%;
      transform: translateY(-50%) scale(0.84); transform-origin: center right;
    }
    .minibar {
      position: absolute; left: 16px; bottom: 18px;
      display: flex; align-items: center; gap: 7px;
      background: #121216; color: #FFFFFF; border: 1px solid #3F3F46;
      border-radius: 999px; padding: 7px 12px;
      box-shadow: 0 14px 30px rgba(0, 0, 0, 0.65);
      overflow: hidden;
    }
    .mb-grip { color: #A1A1AA; font-size: 13px; padding: 0 3px; }
    .mb-btn {
      width: 28px; height: 28px; border-radius: 999px; background: #1C1C22;
      border: 1px solid #2A2A32; color: #F4F4F5; font-size: 12px;
      display: flex; align-items: center; justify-content: center;
    }
    .mb-btn.play { background: #F97316; border-color: #F97316; width: 32px; height: 32px; font-weight: 700; }
    .mb-btn.inspect { color: #FB923C; }
    .mb-meta { font-size: 11.5px; color: #D4D4D8; padding: 0 4px; font-weight: 600; }
    .mb-prog { position: absolute; left: 0; bottom: 0; height: 3px; width: 42%; background: #F97316; }
  `;
  const html = `
    <div class="canvas">
      <div class="hero">
        <div class="eyebrow-row">
          <img src="${iconUri}" alt="ChalaVoice" />
          <span class="eyebrow">SUITE CHALA · 100% OFFLINE · SIN TELEMETRÍA</span>
        </div>
        <h1>Escucha cualquier web o libro <span>en voz alta</span></h1>
        <p class="sub">Popup compacto con audio persistente, Mini Barra Flotante, Modo Inspector visual y lector offline de EPUB, Markdown y TXT.</p>
        <div class="chips">
          <div class="chip"><b>●</b> 100% privado y local</div>
          <div class="chip"><b>●</b> Motor anti-cortes</div>
          <div class="chip"><b>●</b> Resaltado por oración</div>
        </div>
      </div>

      <div class="stage">
        <div class="article-card">
          <div class="art-tag">Artículo web · Resaltado en vivo</div>
          <div class="art-title">Diseño de software privado y rápido</div>
          <p class="art-p">Las herramientas locales funcionan sin enviar textos a servidores externos ni depender de conexión continua.</p>
          <p class="art-p active"><mark>ChalaVoice extrae el contenido principal y sincroniza cada oración</mark> con las voces naturales del sistema operativo.</p>
          <p class="art-p">Pulsa cualquier párrafo con el Modo Inspector para empezar exactamente desde ese punto.</p>
        </div>

        <div class="popup-wrap">
          ${buildPopupMockHtml(iconUri, {
            mode: "web",
            activePreset: "natural",
            caption: "“ChalaVoice extrae el contenido principal y sincroniza cada oración...”",
            counter: "2 / 12",
            progress: 32
          })}
        </div>

        <div class="minibar">
          <span class="mb-grip">⋮⋮</span>
          <div class="mb-btn">⏮</div>
          <div class="mb-btn play">⏸</div>
          <div class="mb-btn">⏭</div>
          <span class="mb-meta">2/12</span>
          <div class="mb-btn inspect">🎯</div>
          <div class="mb-btn">—</div>
          <div class="mb-btn">⏹</div>
          <div class="mb-prog"></div>
        </div>
      </div>
    </div>
  `;
  return wrapPage(1400, 560, css, html);
}

function buildCaptura1Web(iconUri) {
  const css = `
    ${POPUP_CSS}
    .canvas {
      width: 1280px; height: 800px;
      background: #0B0B0E;
      display: flex; flex-direction: column;
    }
    .showcase-head {
      height: 76px; padding: 0 32px;
      background: linear-gradient(90deg, #121216 0%, #1C1C22 100%);
      border-bottom: 1px solid #2A2A32;
      display: flex; align-items: center; justify-content: space-between;
    }
    .sh-left { display: flex; align-items: center; gap: 14px; }
    .sh-left img { width: 40px; height: 40px; border-radius: 9px; border: 1px solid #3F3F46; }
    .sh-title { font-size: 21px; font-weight: 800; color: #FFFFFF; letter-spacing: -0.01em; }
    .sh-sub { font-size: 13px; color: #A1A1AA; }
    .sh-badges { display: flex; gap: 10px; }
    .sh-badge {
      background: #0B0B0E; border: 1px solid #3F3F46; border-radius: 999px;
      padding: 6px 13px; font-size: 12px; font-weight: 600; color: #F4F4F5;
    }
    .sh-badge.orange {
      background: rgba(249, 115, 22, 0.16); border-color: #F97316; color: #FB923C;
    }

    .browser-frame {
      flex: 1; margin: 20px 28px 24px;
      background: #18181D; border: 1px solid #3F3F46; border-radius: 14px;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65);
      position: relative;
    }
    .browser-bar {
      height: 44px; background: #121216; border-bottom: 1px solid #2A2A32;
      padding: 0 16px; display: flex; align-items: center; gap: 14px;
    }
    .dots { display: flex; gap: 7px; }
    .dots span { width: 10px; height: 10px; border-radius: 999px; background: #3F3F46; }
    .url-pill {
      flex: 1; max-width: 680px; background: #1C1C22; border: 1px solid #2A2A32;
      border-radius: 8px; padding: 5px 12px; font-size: 12px; color: #D4D4D8;
    }
    .ext-chip {
      margin-left: auto; display: flex; align-items: center; gap: 7px;
      background: rgba(249,115,22,0.16); border: 1px solid #F97316; border-radius: 8px;
      padding: 4px 10px; font-size: 11.5px; font-weight: 700; color: #FFFFFF;
    }
    .viewport {
      flex: 1; background: #F4F4F5; padding: 34px 48px; position: relative; color: #18181B;
    }
    .article-col { max-width: 700px; }
    .kicker { font-size: 12px; font-weight: 700; color: #EA580C; letter-spacing: 0.06em; text-transform: uppercase; }
    .article-col h2 { margin: 8px 0 10px; font-size: 32px; font-weight: 800; color: #09090B; line-height: 1.15; }
    .meta-line { font-size: 13px; color: #52525B; margin-bottom: 22px; }
    .p-block {
      margin: 0 0 18px; font-size: 16.5px; line-height: 1.65; color: #27272A;
      padding: 8px 12px; border-radius: 8px;
    }
    .p-active {
      outline: 2px solid #F97316; outline-offset: 2px;
      background: rgba(249, 115, 22, 0.14); color: #09090B;
    }
    .p-active mark { background: rgba(249, 115, 22, 0.30); color: #09090B; border-radius: 4px; padding: 1px 3px; }
    .p-inspect {
      position: relative;
      outline: 2px dashed #F97316; outline-offset: 2px;
      background: rgba(249, 115, 22, 0.08);
    }
    .inspect-tip {
      position: absolute; top: -15px; right: 14px;
      background: #0B0B0E; color: #FFFFFF; border: 1px solid #F97316;
      border-radius: 8px; padding: 4px 10px; font-size: 11.5px; font-weight: 600;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
    }
    .inspect-tip b { color: #FB923C; }

    .popup-dock { position: absolute; top: 14px; right: 20px; }

    .minibar-float {
      position: absolute; left: 48px; bottom: 26px;
      display: flex; align-items: center; gap: 8px;
      background: #121216; color: #FFFFFF; border: 1px solid #3F3F46;
      border-radius: 999px; padding: 8px 14px;
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
      overflow: hidden;
    }
    .mb-grip { color: #A1A1AA; font-size: 14px; padding: 0 4px; }
    .mb-btn {
      width: 30px; height: 30px; border-radius: 999px; background: #1C1C22;
      border: 1px solid #2A2A32; color: #F4F4F5; font-size: 13px;
      display: flex; align-items: center; justify-content: center;
    }
    .mb-btn.play { background: #F97316; border-color: #F97316; width: 34px; height: 34px; font-weight: 700; }
    .mb-btn.inspect { color: #FB923C; border-color: rgba(249,115,22,0.5); }
    .mb-meta { font-size: 12px; color: #E4E4E7; padding: 0 6px; font-weight: 600; }
    .mb-prog { position: absolute; left: 0; bottom: 0; height: 3px; width: 30%; background: #F97316; }
  `;
  const html = `
    <div class="canvas">
      <header class="showcase-head">
        <div class="sh-left">
          <img src="${iconUri}" alt="ChalaVoice" />
          <div>
            <div class="sh-title">Lectura web con resaltado en vivo y Modo Inspector</div>
            <div class="sh-sub">El audio continúa en la pestaña activa aunque cierres el Popup</div>
          </div>
        </div>
        <div class="sh-badges">
          <span class="sh-badge orange">Mini Barra Flotante</span>
          <span class="sh-badge">100% offline · Web Speech API</span>
        </div>
      </header>

      <div class="browser-frame">
        <div class="browser-bar">
          <div class="dots"><span></span><span></span><span></span></div>
          <div class="url-pill">https://chaladev.site/articulos/arquitectura-local-first</div>
          <div class="ext-chip">
            <img src="${iconUri}" width="16" height="16" alt="" />
            <span>ChalaVoice activo</span>
          </div>
        </div>

        <div class="viewport">
          <article class="article-col">
            <div class="kicker">Ingeniería · Privacidad</div>
            <h2>Arquitectura local-first en la web moderna</h2>
            <div class="meta-line">Lectura estimada: 6 min · Idioma detectado: Español</div>

            <p class="p-block">Procesar documentos y artículos directamente en el dispositivo elimina latencias de red y protege por diseño cada texto que consultas.</p>

            <p class="p-block p-active"><mark>La lectura inteligente divide oraciones extensas en fragmentos naturales</mark> respetando abreviaturas comunes y pausando suavemente entre párrafos para mantener una cadencia humana.</p>

            <p class="p-block p-inspect">
              <span class="inspect-tip"><b>🎯 Modo Inspector:</b> Clic para leer desde aquí · Esc para cancelar</span>
              Además, puedes señalar cualquier párrafo, título o lista de la página con el puntero para comenzar la narración justo desde ese punto sin perder el hilo.
            </p>
          </article>

          <div class="popup-dock">
            ${buildPopupMockHtml(iconUri, {
              mode: "web",
              activePreset: "natural",
              caption: "“La lectura inteligente divide oraciones extensas en fragmentos...”",
              counter: "2 / 14",
              progress: 26
            })}
          </div>

          <div class="minibar-float">
            <span class="mb-grip">⋮⋮</span>
            <div class="mb-btn">⏮</div>
            <div class="mb-btn play">⏸</div>
            <div class="mb-btn">⏭</div>
            <span class="mb-meta">2 / 14</span>
            <div class="mb-btn inspect">🎯</div>
            <div class="mb-btn">—</div>
            <div class="mb-btn">⏹</div>
            <div class="mb-prog"></div>
          </div>
        </div>
      </div>
    </div>
  `;
  return wrapPage(1280, 800, css, html);
}

function buildCaptura2Studio(iconUri) {
  const css = `
    ${POPUP_CSS}
    .canvas {
      width: 1280px; height: 800px;
      background:
        radial-gradient(circle at 80% 25%, rgba(249, 115, 22, 0.14), transparent 44%),
        #0B0B0E;
      display: flex; flex-direction: column;
    }
    .showcase-head {
      height: 76px; padding: 0 36px;
      background: #121216;
      border-bottom: 1px solid #2A2A32;
      display: flex; align-items: center; justify-content: space-between;
    }
    .sh-left { display: flex; align-items: center; gap: 14px; }
    .sh-left img { width: 40px; height: 40px; border-radius: 9px; border: 1px solid #3F3F46; }
    .sh-title { font-size: 21px; font-weight: 800; color: #FFFFFF; }
    .sh-sub { font-size: 13px; color: #A1A1AA; }
    .sh-badge {
      background: rgba(249, 115, 22, 0.16); border: 1px solid #F97316;
      border-radius: 999px; padding: 6px 14px; font-size: 12px; font-weight: 700; color: #FB923C;
    }

    .studio-grid {
      flex: 1; padding: 28px 40px;
      display: grid; grid-template-columns: 380px 1fr; gap: 34px; align-items: center;
    }
    .left-col { display: flex; justify-content: center; }
    .cv-popup { width: 372px; }

    .right-col { display: flex; flex-direction: column; gap: 18px; }
    .feature-card {
      background: #121216; border: 1px solid #2A2A32; border-radius: 14px;
      padding: 20px 24px; display: flex; flex-direction: column; gap: 14px;
    }
    .fc-head { display: flex; align-items: center; justify-content: space-between; }
    .fc-title { font-size: 18px; font-weight: 700; color: #FFFFFF; }
    .fc-tag {
      font-size: 11px; font-weight: 700; color: #FB923C;
      background: rgba(249,115,22,0.14); border: 1px solid rgba(249,115,22,0.4);
      padding: 3px 10px; border-radius: 999px;
    }

    .presets-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .p-card {
      background: #1C1C22; border: 1px solid #2A2A32; border-radius: 10px;
      padding: 12px 14px; display: flex; flex-direction: column; gap: 4px;
    }
    .p-card.active { background: rgba(249, 115, 22, 0.15); border-color: #F97316; }
    .p-name { font-size: 14px; font-weight: 700; color: #FFFFFF; display: flex; justify-content: space-between; }
    .p-name span { font-size: 11px; color: #FB923C; }
    .p-desc { font-size: 12px; color: #A1A1AA; }

    .layers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .layer-box {
      background: #1C1C22; border: 1px solid #2A2A32; border-radius: 10px;
      padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;
    }
    .layer-num {
      width: 24px; height: 24px; border-radius: 999px; background: #F97316; color: #FFFFFF;
      font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center;
    }
    .layer-title { font-size: 13.5px; font-weight: 700; color: #FFFFFF; }
    .layer-desc { font-size: 12px; color: #A1A1AA; line-height: 1.4; }

    .sleep-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
    .sleep-pills { display: flex; gap: 8px; }
    .s-pill {
      background: #1C1C22; border: 1px solid #3F3F46; border-radius: 8px;
      padding: 7px 12px; font-size: 12.5px; font-weight: 600; color: #D4D4D8;
    }
    .s-pill.active { background: #F97316; border-color: #F97316; color: #FFFFFF; }
    .fade-bars { display: flex; align-items: flex-end; gap: 6px; height: 34px; }
    .fade-bars span { width: 10px; border-radius: 4px; background: #F97316; }
  `;
  const html = `
    <div class="canvas">
      <header class="showcase-head">
        <div class="sh-left">
          <img src="${iconUri}" alt="ChalaVoice" />
          <div>
            <div class="sh-title">Estudio de Voz inteligente, presets acústicos y Sleep Timer</div>
            <div class="sh-sub">Prioriza automáticamente voces Natural y Neural en tu idioma</div>
          </div>
        </div>
        <span class="sh-badge">4 Perfiles Acústicos + Motor Anti-Cortes</span>
      </header>

      <div class="studio-grid">
        <div class="left-col">
          ${buildPopupMockHtml(iconUri, {
            mode: "web",
            activePreset: "rustic",
            caption: "“Configuración acústica aplicada: tono grave y pausa natural.”",
            counter: "5 / 14",
            progress: 42,
            voiceName: "Dalia Online (Natural) — es-MX",
            rate: "0.90x",
            ratePct: 22,
            pitch: "0.82",
            pitchPct: 28,
            volume: "95%",
            volPct: 95,
            sleepLabel: "30 min",
            sleepBadge: "⏱ 28:40",
            showVoiceList: true
          })}
        </div>

        <div class="right-col">
          <section class="feature-card">
            <div class="fc-head">
              <div class="fc-title">4 Presets Acústicos en un clic</div>
              <span class="fc-tag">Ajuste instantáneo</span>
            </div>
            <div class="presets-cards">
              <div class="p-card active">
                <div class="p-name">Narrador Rústico <span>ACTIVO</span></div>
                <div class="p-desc">Velocidad 0.90x · Tono 0.82 · Pausa 700 ms</div>
              </div>
              <div class="p-card">
                <div class="p-name">Voz Suave <span>NOCTURNA</span></div>
                <div class="p-desc">Velocidad 0.94x · Tono 1.06 · Pausa 400 ms</div>
              </div>
              <div class="p-card">
                <div class="p-name">Modo Estudio <span>REPASO</span></div>
                <div class="p-desc">Velocidad 1.30x · Tono 1.00 · Pausa 200 ms</div>
              </div>
              <div class="p-card">
                <div class="p-name">Natural <span>ESTÁNDAR</span></div>
                <div class="p-desc">Velocidad 1.00x · Tono 1.00 · Pausa 500 ms</div>
              </div>
            </div>
          </section>

          <section class="feature-card">
            <div class="fc-head">
              <div class="fc-title">Motor Anti-Congelamiento de 3 Capas</div>
              <span class="fc-tag">Lectura continua</span>
            </div>
            <div class="layers">
              <div class="layer-box">
                <div class="layer-num">1</div>
                <div class="layer-title">Subdivisión segura</div>
                <div class="layer-desc">Respeta abreviaturas y divide frases largas sin cortar palabras.</div>
              </div>
              <div class="layer-box">
                <div class="layer-num">2</div>
                <div class="layer-title">Pausas diferenciadas</div>
                <div class="layer-desc">Cadencia natural entre oraciones y silencios amplios entre párrafos.</div>
              </div>
              <div class="layer-box">
                <div class="layer-num">3</div>
                <div class="layer-title">Watchdog y blindaje</div>
                <div class="layer-desc">Recupera la cola automáticamente si el motor nativo se detiene.</div>
              </div>
            </div>
          </section>

          <section class="feature-card">
            <div class="fc-head">
              <div class="fc-title">Temporizador con atenuación gradual</div>
              <span class="fc-tag">Fade-out suave</span>
            </div>
            <div class="sleep-row">
              <div class="sleep-pills">
                <span class="s-pill">15 min</span>
                <span class="s-pill active">30 min</span>
                <span class="s-pill">45 min</span>
                <span class="s-pill">60 min</span>
              </div>
              <div class="fade-bars" aria-hidden="true">
                <span style="height:32px;opacity:1"></span>
                <span style="height:28px;opacity:.9"></span>
                <span style="height:23px;opacity:.78"></span>
                <span style="height:18px;opacity:.62"></span>
                <span style="height:13px;opacity:.45"></span>
                <span style="height:8px;opacity:.3"></span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;
  return wrapPage(1280, 800, css, html);
}

function buildCaptura3Books(iconUri) {
  const css = `
    .canvas {
      width: 1280px; height: 800px;
      background: #0B0B0E;
      display: flex; flex-direction: column;
    }
    .showcase-head {
      height: 70px; padding: 0 32px;
      background: #121216; border-bottom: 1px solid #2A2A32;
      display: flex; align-items: center; justify-content: space-between;
    }
    .sh-left { display: flex; align-items: center; gap: 14px; }
    .sh-left img { width: 38px; height: 38px; border-radius: 9px; border: 1px solid #3F3F46; }
    .sh-title { font-size: 20px; font-weight: 800; color: #FFFFFF; }
    .sh-sub { font-size: 12.5px; color: #A1A1AA; }
    .sh-badge {
      background: rgba(249, 115, 22, 0.16); border: 1px solid #F97316;
      border-radius: 999px; padding: 5px 14px; font-size: 12px; font-weight: 700; color: #FB923C;
    }

    .reader-frame {
      flex: 1; margin: 16px 26px 20px;
      background: #0B0B0E; border: 1px solid #3F3F46; border-radius: 14px;
      overflow: hidden; display: flex; flex-direction: column;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65);
    }
    .reader-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 11px 20px; background: #121216; border-bottom: 1px solid #2A2A32;
    }
    .rh-brand { display: flex; align-items: center; gap: 10px; }
    .rh-brand img { width: 28px; height: 28px; border-radius: 6px; }
    .rh-brand h2 { margin: 0; font-size: 15px; font-weight: 700; color: #FFFFFF; }
    .rh-brand span { font-size: 11.5px; color: #A1A1AA; }
    .rh-status {
      font-size: 11.5px; font-weight: 700; padding: 4px 12px; border-radius: 999px;
      background: rgba(249, 115, 22, 0.16); color: #F97316; border: 1px solid #F97316;
    }

    .reader-layout { flex: 1; display: grid; grid-template-columns: 300px 1fr; min-height: 0; }
    .sidebar {
      background: #121216; border-right: 1px solid #2A2A32;
      padding: 16px; display: flex; flex-direction: column; gap: 12px;
    }
    .drop-zone {
      border: 1.5px dashed #F97316; border-radius: 10px;
      background: rgba(249, 115, 22, 0.08); padding: 15px 12px; text-align: center;
    }
    .drop-title { font-size: 13px; font-weight: 700; color: #FFFFFF; margin-bottom: 4px; }
    .drop-sub { font-size: 11.5px; color: #D4D4D8; }
    .btn-sec {
      background: #1C1C22; border: 1px solid #3F3F46; border-radius: 8px;
      padding: 8px 10px; text-align: center; font-size: 12.5px; font-weight: 600; color: #FFFFFF;
    }
    .lib-head { display: flex; align-items: center; justify-content: space-between; margin-top: 2px; }
    .lib-head span { font-size: 13px; font-weight: 700; color: #FFFFFF; }
    .lib-count {
      font-size: 11px; padding: 2px 8px; border-radius: 999px;
      background: #1C1C22; color: #F97316; border: 1px solid #3F3F46;
    }
    .book-item {
      background: #1C1C22; border: 1px solid #2A2A32; border-radius: 8px;
      padding: 9px 11px; display: flex; flex-direction: column; gap: 3px;
    }
    .book-item.active { border-color: #F97316; background: rgba(249,115,22,0.10); }
    .bi-title { font-size: 12.5px; font-weight: 700; color: #FFFFFF; }
    .bi-meta { font-size: 11px; color: #A1A1AA; }

    .content-pane { padding: 24px 32px; background: #0B0B0E; display: flex; flex-direction: column; gap: 14px; }
    .book-header {
      display: flex; align-items: flex-end; justify-content: space-between; gap: 16px;
      padding-bottom: 14px; border-bottom: 1px solid #2A2A32;
    }
    .fmt-badge {
      display: inline-block; font-size: 11px; font-weight: 800; padding: 2px 9px; border-radius: 6px;
      background: rgba(249,115,22,0.16); color: #F97316; border: 1px solid #F97316; margin-bottom: 6px;
    }
    .book-title { margin: 0 0 8px; font-size: 22px; font-weight: 800; color: #FFFFFF; }
    .meta-chips { display: flex; gap: 8px; }
    .m-chip {
      font-size: 11.5px; padding: 3px 10px; border-radius: 999px;
      background: #1C1C22; color: #D4D4D8; border: 1px solid #2A2A32;
    }
    .ch-select {
      background: #1C1C22; border: 1px solid #3F3F46; border-radius: 8px;
      padding: 7px 12px; font-size: 12.5px; color: #FFFFFF; min-width: 245px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .para-list { display: flex; flex-direction: column; gap: 10px; }
    .para {
      padding: 12px 15px; border-radius: 10px; background: #121216;
      border: 1px solid transparent; font-size: 14.5px; line-height: 1.55; color: #D4D4D8;
    }
    .para.active {
      background: rgba(249, 115, 22, 0.16); border-color: #F97316; color: #FFFFFF;
    }

    .player-dock {
      background: #121216; border-top: 1px solid #2A2A32;
      padding: 10px 20px; display: grid; grid-template-columns: 1.2fr auto 1.3fr; align-items: center; gap: 18px;
    }
    .dock-cap { font-size: 12px; color: #FFFFFF; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dock-prog-row { display: flex; align-items: center; gap: 10px; font-size: 11px; color: #A1A1AA; }
    .dock-track { flex: 1; height: 5px; background: #2A2A32; border-radius: 999px; overflow: hidden; }
    .dock-fill { width: 38%; height: 100%; background: #F97316; }
    .dock-sleep { color: #FB923C; font-weight: 700; }
    .dock-center { display: flex; align-items: center; gap: 8px; }
    .d-btn {
      width: 34px; height: 32px; border-radius: 8px; background: #1C1C22;
      border: 1px solid #3F3F46; color: #FFFFFF; font-size: 13px;
      display: flex; align-items: center; justify-content: center;
    }
    .d-play {
      width: 48px; height: 36px; border-radius: 10px; background: #F97316;
      color: #FFFFFF; font-size: 15px; font-weight: 800;
      display: flex; align-items: center; justify-content: center;
    }
    .dock-right { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
    .d-presets { display: flex; gap: 5px; }
    .d-preset {
      background: #1C1C22; border: 1px solid #2A2A32; border-radius: 7px;
      padding: 4px 9px; font-size: 11px; font-weight: 600; color: #A1A1AA;
    }
    .d-preset.active { background: rgba(249,115,22,0.16); border-color: #F97316; color: #FFFFFF; }
    .d-meta { font-size: 11.5px; color: #D4D4D8; }
  `;
  const html = `
    <div class="canvas">
      <header class="showcase-head">
        <div class="sh-left">
          <img src="${iconUri}" alt="ChalaVoice" />
          <div>
            <div class="sh-title">Lector dedicado de libros offline (.epub, .md, .txt)</div>
            <div class="sh-sub">Descomprime libros EPUB localmente y guarda tu capítulo y párrafo exactos</div>
          </div>
        </div>
        <span class="sh-badge">100% local · Progreso guardado</span>
      </header>

      <div class="reader-frame">
        <div class="reader-header">
          <div class="rh-brand">
            <img src="${iconUri}" alt="" />
            <div>
              <h2>ChalaVoice · Lector Local</h2>
              <span>100% local · Sin telemetría</span>
            </div>
          </div>
          <span class="rh-status">Leyendo en voz alta</span>
        </div>

        <div class="reader-layout">
          <aside class="sidebar">
            <div class="drop-zone">
              <div class="drop-title">Arrastra un archivo .epub, .md o .txt</div>
              <div class="drop-sub">O haz clic para seleccionarlo desde tu equipo</div>
            </div>
            <div class="btn-sec">Pegar texto directo</div>
            <div class="lib-head">
              <span>Biblioteca Local</span>
              <span class="lib-count">3</span>
            </div>
            <div class="book-item active">
              <div class="bi-title">Arquitectura de Software Local</div>
              <div class="bi-meta">EPUB · Cap. 3 de 8 · 38% leído</div>
            </div>
            <div class="book-item">
              <div class="bi-title">Apuntes de Sistemas.md</div>
              <div class="bi-meta">MD · 18 párrafos · Listo</div>
            </div>
            <div class="book-item">
              <div class="bi-title">Guía de Accesibilidad.txt</div>
              <div class="bi-meta">TXT · 12 párrafos · Listo</div>
            </div>
          </aside>

          <main class="content-pane">
            <div class="book-header">
              <div>
                <span class="fmt-badge">EPUB</span>
                <h2 class="book-title">Arquitectura de Software Local</h2>
                <div class="meta-chips">
                  <span class="m-chip">Capítulo 3 de 8</span>
                  <span class="m-chip">2,450 palabras</span>
                  <span class="m-chip">~16 min</span>
                </div>
              </div>
              <div class="ch-select"><span>Cap. 3: Diseño Offline-First</span><span>▾</span></div>
            </div>

            <div class="para-list">
              <div class="para">1. Cuando una aplicación procesa archivos directamente en memoria local, el usuario conserva control total sobre sus libros, notas técnicas y documentos privados.</div>
              <div class="para active">2. El lector integrado abre libros EPUB descomprimiendo cada capítulo al instante mediante Web APIs nativas, sin subir archivos a ningún servidor externo.</div>
              <div class="para">3. Cada cambio de capítulo o párrafo queda guardado automáticamente en el almacenamiento local del navegador para retomar exactamente donde lo dejaste.</div>
              <div class="para">4. Puedes combinar perfiles acústicos como Voz Suave o Modo Estudio con el temporizador de apagado para sesiones nocturnas o de repaso.</div>
            </div>
          </main>
        </div>

        <footer class="player-dock">
          <div>
            <div class="dock-cap">“El lector integrado abre libros EPUB descomprimiendo cada capítulo...”</div>
            <div class="dock-prog-row">
              <div class="dock-track"><div class="dock-fill"></div></div>
              <span>6 / 18</span>
              <span class="dock-sleep">⏱ 15:00</span>
            </div>
          </div>
          <div class="dock-center">
            <div class="d-btn">⏮</div>
            <div class="d-play">⏸</div>
            <div class="d-btn">⏹</div>
            <div class="d-btn">⏭</div>
          </div>
          <div class="dock-right">
            <div class="d-presets">
              <span class="d-preset">Narrador Rústico</span>
              <span class="d-preset active">Voz Suave</span>
              <span class="d-preset">Modo Estudio</span>
              <span class="d-preset">Natural</span>
            </div>
            <div class="d-meta">Voz: Elena Online (Natural) · Vel: 0.94x · Tono: 1.06 · Vol: 100%</div>
          </div>
        </footer>
      </div>
    </div>
  `;
  return wrapPage(1280, 800, css, html);
}

async function renderAll() {
  const iconUri = getIconDataUri();
  const browserPath = findBrowserBinary();
  const port = await getFreePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chalavoice-store-render-"));

  const assets = [
    { name: "promo-440x280.png", width: 440, height: 280, html: buildPromo440x280(iconUri) },
    { name: "destacada-1400x560.png", width: 1400, height: 560, html: buildDestacada1400x560(iconUri) },
    { name: "captura-1-lector-web.png", width: 1280, height: 800, html: buildCaptura1Web(iconUri) },
    { name: "captura-2-perfiles-voz.png", width: 1280, height: 800, html: buildCaptura2Studio(iconUri) },
    { name: "captura-3-biblioteca-epub.png", width: 1280, height: 800, html: buildCaptura3Books(iconUri) }
  ];

  const proc = spawn(
    browserPath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--mute-audio",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${tmpDir}`,
      "about:blank"
    ],
    { stdio: "ignore" }
  );

  let client;
  try {
    const wsUrl = await waitForTargetWsUrl(port);
    client = new CdpClient(wsUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");

    fs.mkdirSync(STORE_DIR, { recursive: true });

    for (const asset of assets) {
      const htmlPath = path.join(tmpDir, `${asset.name}.html`);
      fs.writeFileSync(htmlPath, asset.html, "utf8");

      await client.send("Emulation.setDeviceMetricsOverride", {
        width: asset.width,
        height: asset.height,
        deviceScaleFactor: 1,
        mobile: false
      });

      await client.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
      await client.send("Runtime.evaluate", {
        expression: `new Promise(resolve => {
          const waitPaint = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
          if (document.readyState === 'complete') {
            (document.fonts ? document.fonts.ready : Promise.resolve()).then(waitPaint);
          } else {
            window.addEventListener('load', () => {
              (document.fonts ? document.fonts.ready : Promise.resolve()).then(waitPaint);
            }, { once: true });
          }
        })`,
        awaitPromise: true
      });

      const shot = await client.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true
      });

      const outPath = path.join(STORE_DIR, asset.name);
      const dataBuf = Buffer.from(shot.data, "base64");
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          fs.writeFileSync(outPath, dataBuf);
          break;
        } catch (err) {
          if (attempt === 4) throw err;
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      assertPngDimensions(outPath, asset.width, asset.height);
      console.log(`Generated ${path.relative(ROOT, outPath)} (${asset.width}x${asset.height})`);
    }
  } finally {
    if (client) {
      await client.send("Browser.close").catch(() => {});
      client.close();
    }
    if (!proc.killed) {
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 1200);
        proc.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
        try {
          proc.kill();
        } catch {
          clearTimeout(t);
          resolve();
        }
      });
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    } catch {
      // Windows may keep a transient lock on Chromium temp dir; ignore cleanup error.
    }
  }
}

renderAll().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
