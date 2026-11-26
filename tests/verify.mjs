import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import zlib from "node:zlib";
import { extractZipEntry } from "../tools/make-mv3.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");

let passed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`PASS: ${name}`);
    })
    .catch((err) => {
      console.error(`FAIL: ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

function assertPngDimensions(filePath, expectedWidth, expectedHeight) {
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(fs.existsSync(filePath), `Missing PNG file: ${filePath}`);
  const buf = fs.readFileSync(filePath);
  assert.ok(buf.length > 24, `PNG too small: ${filePath}`);
  assert.ok(buf.subarray(0, 8).equals(pngSig), `Invalid PNG signature: ${filePath}`);
  assert.equal(buf.subarray(12, 16).toString("ascii"), "IHDR", `Missing IHDR: ${filePath}`);
  assert.equal(buf.readUInt32BE(16), expectedWidth, `${path.basename(filePath)} width mismatch`);
  assert.equal(buf.readUInt32BE(20), expectedHeight, `${path.basename(filePath)} height mismatch`);
}

function buildTestZipFromEntries(entryMap) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c >>> 0;
  }
  const crc32 = (buf) => {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  const entries = Object.entries(entryMap);
  for (const [name, content] of entries) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
    const comp = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    localParts.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centralParts.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }

  const cd = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, cd, eocd]);
}

function createMiniDomEnv() {
  class MiniNode {
    constructor(nodeType, nodeValue = "") {
      this.nodeType = nodeType;
      this.nodeValue = nodeValue;
      this.parentNode = null;
      this.childNodes = [];
    }
    get textContent() {
      if (this.nodeType === 3) return this.nodeValue;
      return this.childNodes.map((c) => c.textContent).join("");
    }
    set textContent(val) {
      this.childNodes = [];
      if (val !== "" && val !== null && val !== undefined) {
        this.appendChild(new MiniNode(3, String(val)));
      }
    }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx !== -1) {
        this.childNodes.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }
  }

  class MiniElement extends MiniNode {
    constructor(tagName, ownerDoc) {
      super(1);
      this.tagName = tagName.toUpperCase();
      this.ownerDocument = ownerDoc;
      this._attrs = new Map();
      this.hidden = false;
      this.style = { cssText: "", display: "", top: "", left: "", right: "", bottom: "", width: "" };
      this.classList = {
        toggle: (cls, force) => {
          const set = new Set((this.className || "").split(/\s+/).filter(Boolean));
          const add = force === undefined ? !set.has(cls) : Boolean(force);
          if (add) set.add(cls);
          else set.delete(cls);
          this.className = [...set].join(" ");
        }
      };
      this.listeners = new Map();
      this.shadowRoot = null;
      this.offsetWidth = 220;
      this.offsetHeight = 40;
    }
    get id() {
      return this._attrs.get("id") || "";
    }
    set id(v) {
      this._attrs.set("id", String(v));
    }
    get className() {
      return this._attrs.get("class") || "";
    }
    set className(v) {
      this._attrs.set("class", String(v));
    }
    get children() {
      return this.childNodes.filter((c) => c.nodeType === 1);
    }
    getAttribute(name) {
      const k = String(name).toLowerCase();
      return this._attrs.has(k) ? this._attrs.get(k) : null;
    }
    setAttribute(name, val) {
      this._attrs.set(String(name).toLowerCase(), String(val));
    }
    hasAttribute(name) {
      return this._attrs.has(String(name).toLowerCase());
    }
    removeAttribute(name) {
      this._attrs.delete(String(name).toLowerCase());
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    attachShadow({ mode }) {
      this.shadowRoot = new MiniElement("#shadow-root", this.ownerDocument);
      this.shadowRoot.mode = mode;
      this.shadowRoot.host = this;
      return this.shadowRoot;
    }
    getBoundingClientRect() {
      return { top: 120, left: 40, bottom: 160, right: 400, width: 360, height: 40 };
    }
    scrollIntoView() {}
    get innerHTML() {
      return this.childNodes
        .map((c) => {
          if (c.nodeType === 3) return c.nodeValue;
          const attrStr = [...c._attrs.entries()]
            .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, "&quot;")}"`)
            .join("");
          return `<${c.tagName.toLowerCase()}${attrStr}>${c.innerHTML}</${c.tagName.toLowerCase()}>`;
        })
        .join("");
    }
    set innerHTML(html) {
      this.childNodes = [];
      if (!html) return;
      const tagRegex = /<\/?([a-zA-Z0-9-]+)([^>]*)>|([^<]+)/g;
      const stack = [this];
      let match;
      while ((match = tagRegex.exec(html)) !== null) {
        if (match[3]) {
          stack[stack.length - 1].appendChild(new MiniNode(3, match[3]));
          continue;
        }
        const raw = match[0];
        const tag = match[1].toUpperCase();
        const attrRaw = match[2] || "";
        if (raw.startsWith("</")) {
          if (stack.length > 1 && stack[stack.length - 1].tagName === tag) stack.pop();
          continue;
        }
        const el = new MiniElement(tag, this.ownerDocument);
        const attrRegex = /([a-zA-Z0-9:-]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g;
        let am;
        while ((am = attrRegex.exec(attrRaw)) !== null) {
          el.setAttribute(am[1], am[2] ?? am[3] ?? "");
        }
        stack[stack.length - 1].appendChild(el);
        if (!raw.endsWith("/>") && !["IMG", "BR", "HR", "META", "LINK"].includes(tag)) {
          stack.push(el);
        }
      }
    }
    matchesSelectorPart(part) {
      const p = part.trim();
      if (!p) return false;
      if (p === "*") return true;
      if (p.startsWith("#")) return this.id === p.slice(1);
      if (p.startsWith(".")) return (this.className || "").split(/\s+/).includes(p.slice(1));
      const tagAttr = /^([a-zA-Z0-9]+)?(?:\[([^\]]+)\])?$/.exec(p);
      if (!tagAttr) return false;
      if (tagAttr[1] && this.tagName !== tagAttr[1].toUpperCase()) return false;
      if (tagAttr[2]) {
        const eq = /^([a-zA-Z0-9-]+)(?:=['"]?([^'"]+)['"]?(?:\s+i)?)?$/.exec(tagAttr[2].trim());
        if (!eq) return false;
        const val = this.getAttribute(eq[1]);
        if (val === null) return false;
        if (eq[2] !== undefined) return val.toLowerCase() === eq[2].toLowerCase();
      }
      return true;
    }
    querySelectorAll(selector) {
      const groups = selector.split(",").map((s) => s.trim()).filter(Boolean);
      const out = [];
      const visit = (node) => {
        for (const child of node.children) {
          for (const g of groups) {
            const parts = g.split(/\s+/);
            const last = parts[parts.length - 1];
            if (child.matchesSelectorPart(last)) {
              if (parts.length === 1) {
                out.push(child);
                break;
              }
              let anc = child.parentNode;
              let idx = parts.length - 2;
              while (anc && anc.nodeType === 1 && idx >= 0) {
                if (anc.matchesSelectorPart(parts[idx])) idx -= 1;
                anc = anc.parentNode;
              }
              if (idx < 0) {
                out.push(child);
                break;
              }
            }
          }
          visit(child);
        }
      };
      visit(this);
      return out;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  }

  class MiniDocument {
    constructor(title = "Prueba", url = "https://ejemplo.test/articulo") {
      this.title = title;
      this.URL = url;
      this.listeners = new Map();
      this.documentElement = new MiniElement("html", this);
      this.documentElement.setAttribute("lang", "es");
      this.head = new MiniElement("head", this);
      this.body = new MiniElement("body", this);
      this.documentElement.appendChild(this.head);
      this.documentElement.appendChild(this.body);
    }
    createElement(tag) {
      return new MiniElement(tag, this);
    }
    querySelector(sel) {
      return this.documentElement.querySelector(sel);
    }
    querySelectorAll(sel) {
      return this.documentElement.querySelectorAll(sel);
    }
    getElementById(id) {
      return this.querySelector(`#${id}`);
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    removeEventListener(type, fn) {
      const arr = this.listeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    }
    dispatch(type, eventObj) {
      for (const fn of [...(this.listeners.get(type) || [])]) {
        fn(eventObj);
      }
    }
  }

  return { MiniDocument, MiniElement, MiniNode };
}

async function run() {
  // 1. Sintaxis, cero dependencias, LF en scripts .sh y remoción de sidepanel/
  await test("Syntax check, zero dependencies, popup/reader files, and LF on shell scripts", () => {
    assert.equal(fs.existsSync(path.join(SRC, "sidepanel")), false, "src/sidepanel/ must be removed");

    const jsFiles = [
      path.join(SRC, "config.js"),
      path.join(SRC, "background.js"),
      path.join(SRC, "lib", "readability.js"),
      path.join(SRC, "lib", "book-parser.js"),
      path.join(SRC, "lib", "voice-ranker.js"),
      path.join(SRC, "lib", "speech-queue.js"),
      path.join(SRC, "content", "highlighter.js"),
      path.join(SRC, "popup", "app.js"),
      path.join(SRC, "reader", "app.js"),
      path.join(ROOT, "tools", "generate-icons.mjs"),
      path.join(ROOT, "tools", "make-mv3.mjs")
    ];
    for (const file of jsFiles) {
      assert.ok(fs.existsSync(file), `Missing JS file: ${file}`);
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.equal(pkg.type, "module");
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
    assert.equal(pkg.engines?.node, ">=22");

    for (const sh of ["make-mv3.sh", "make-clean.sh"]) {
      const raw = fs.readFileSync(path.join(ROOT, "tools", sh), "utf8");
      assert.equal(raw.includes("\r\n"), false, `${sh} must use LF line endings`);
    }
  });

  // 2. Manifest V3 con default_popup (sin sidePanel) & i18n <= 132 chars
  await test("Manifest V3 uses default_popup, minimal permissions without sidePanel, and i18n parity <= 132 chars", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.default_locale, "es");
    assert.deepEqual([...(manifest.permissions || [])].sort(), ["activeTab", "scripting", "storage"]);
    assert.equal(manifest.action?.default_popup, "popup/index.html");
    assert.equal(manifest.side_panel, undefined, "Must NOT declare side_panel");
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);

    const esMsgs = JSON.parse(fs.readFileSync(path.join(SRC, "_locales", "es", "messages.json"), "utf8"));
    const enMsgs = JSON.parse(fs.readFileSync(path.join(SRC, "_locales", "en", "messages.json"), "utf8"));
    assert.deepEqual(Object.keys(esMsgs).sort(), Object.keys(enMsgs).sort());
    assert.ok(esMsgs.extDescription.message.length <= 132);
    assert.ok(enMsgs.extDescription.message.length <= 132);
    assert.ok(esMsgs.btnPickStart?.message, "Must define btnPickStart key");
    assert.ok(esMsgs.inspectorTooltip?.message, "Must define inspectorTooltip key");
  });

  // 3. Paleta Negro / Gris / Naranja / Blanco + Logo SVG naranja
  await test("Black/Gray/Orange/White palette across UI, config, highlighter, docs, and SVG logo", async () => {
    const { CONFIG } = await import("../src/config.js");
    assert.equal(CONFIG.COLORS.BG_DARK, "#0B0B0E");
    assert.equal(CONFIG.COLORS.SURFACE, "#1C1C22");
    assert.equal(CONFIG.COLORS.PRIMARY, "#F97316");
    assert.equal(CONFIG.COLORS.TEXT_WHITE, "#FFFFFF");

    const checkedFiles = [
      path.join(SRC, "config.js"),
      path.join(SRC, "popup", "styles.css"),
      path.join(SRC, "reader", "styles.css"),
      path.join(SRC, "content", "highlighter.js"),
      path.join(SRC, "icons", "icon.svg"),
      path.join(ROOT, "docs", "index.html")
    ];
    const forbiddenColors = ["#0F172A", "#1E293B", "#10B981", "#06B6D4", "#38BDF8", "#141B26"];
    for (const file of checkedFiles) {
      const text = fs.readFileSync(file, "utf8").toUpperCase();
      for (const oldCol of forbiddenColors) {
        assert.equal(text.includes(oldCol), false, `${path.basename(file)} still contains legacy color ${oldCol}`);
      }
    }

    const svgText = fs.readFileSync(path.join(SRC, "icons", "icon.svg"), "utf8");
    assert.ok(svgText.includes('viewBox="0 0 512 512"'));
    assert.ok(svgText.includes("#0B0B0E"));
    assert.ok(svgText.includes("#F97316") && svgText.includes("#FB923C"));

    for (const size of [16, 32, 48, 128]) {
      assertPngDimensions(path.join(SRC, "icons", `icon${size}.png`), size, size);
    }
    assertPngDimensions(path.join(ROOT, "store", "logo-300x300.png"), 300, 300);
    assertPngDimensions(path.join(ROOT, "store", "promo-440x280.png"), 440, 280);
    assertPngDimensions(path.join(ROOT, "store", "destacada-1400x560.png"), 1400, 560);
    assertPngDimensions(path.join(ROOT, "store", "captura-1-lector-web.png"), 1280, 800);
    assertPngDimensions(path.join(ROOT, "store", "captura-2-perfiles-voz.png"), 1280, 800);
    assertPngDimensions(path.join(ROOT, "store", "captura-3-biblioteca-epub.png"), 1280, 800);
  });

  // 4. Motor anti-congelamiento de 3 capas (IIFE compatible con scripting.executeScript)
  await import("../src/lib/speech-queue.js");
  const { buildSpeechChunks, SpeechQueueEngine, estimateWatchdogMs } = globalThis.ChalaSpeechQueue;

  await test("SpeechQueue Capa 1: smart chunking respects abbreviations and splits >200 chars", () => {
    const longSentence =
      "El Sr. García explicó que cuando una oración supera ampliamente el límite de doscientos caracteres en Chromium, el motor de síntesis debe dividirla de forma limpia en la coma o espacio más cercano para evitar cortes inesperados después de quince segundos de reproducción continua.";
    const chunks = buildSpeechChunks([
      "Hola Dr. Pérez. ¿Cómo está Ud. hoy? Bien, etc. Todo listo.",
      longSentence
    ]);

    assert.equal(chunks[0].paragraphIndex, 0);
    assert.ok(chunks[0].text.includes("Dr. Pérez."));
    assert.ok(chunks.every((c) => c.text.length <= 210));
    const p1Chunks = chunks.filter((c) => c.paragraphIndex === 1);
    assert.ok(p1Chunks.length >= 2);
    assert.equal(p1Chunks[p1Chunks.length - 1].isParagraphEnd, true);
  });

  await test("SpeechQueue Capas 2 & 3: no cancel() between normal chunks, GC retention, Watchdog recovery, presets & sleep timer", async () => {
    let cancelCalls = 0;
    const spoken = [];
    let hangFirst = true;

    class MockUtterance {
      constructor(text) {
        this.text = text;
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
      }
    }

    const mockSynth = {
      cancel() {
        cancelCalls += 1;
      },
      speak(utter) {
        spoken.push(utter);
        if (hangFirst && spoken.length === 1) {
          hangFirst = false;
          return;
        }
        setTimeout(() => {
          utter.onend?.();
        }, 10);
      }
    };

    let watchdogRecovered = 0;
    let completed = false;
    const engine = new SpeechQueueEngine({
      synth: mockSynth,
      UtteranceCtor: MockUtterance,
      watchdogDurationFn: () => 45,
      onWatchdogRecovery: () => {
        watchdogRecovered += 1;
      },
      onComplete: () => {
        completed = true;
      }
    });

    const rustic = engine.applyPreset("rustic");
    assert.equal(rustic.pitch, 0.82);
    assert.equal(rustic.rate, 0.9);
    assert.equal(rustic.paragraphPauseMs, 700);
    engine.paragraphPauseMs = 20;
    engine.sentencePauseMs = 10;

    engine.loadParagraphs(["Primer bloque que se cuelga.", "Segundo bloque normal. Tercera frase."]);
    assert.equal(estimateWatchdogMs(150, 1.0), 66000);

    engine.play(0);
    assert.ok(engine.activeUtterance instanceof MockUtterance);

    await new Promise((r) => setTimeout(r, 240));
    assert.equal(watchdogRecovered, 1);
    assert.equal(completed, true);
    assert.equal(spoken.length, 3);
    assert.equal(cancelCalls, 2);

    const sleepEvents = [];
    engine.onSleepTick = (ev) => sleepEvents.push(ev);
    engine.loadParagraphs([
      "Párrafo uno de lectura continua.",
      "Párrafo dos de lectura continua.",
      "Párrafo tres de lectura continua.",
      "Párrafo cuatro de lectura continua.",
      "Párrafo cinco de lectura continua.",
      "Párrafo seis de lectura continua.",
      "Párrafo siete de lectura continua.",
      "Párrafo ocho de lectura continua."
    ]);
    engine.play(0);
    engine.setSleepTimer(0.0015);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(engine.state, "paused");
    assert.ok(sleepEvents.some((e) => e.active && e.fadeMultiplier < 1.0));
  });

  // 5. voice-ranker.js (IIFE)
  await import("../src/lib/voice-ranker.js");
  const { detectLanguage, rankVoices } = globalThis.ChalaVoiceRanker;

  await test("voice-ranker.js detects language and prioritizes Natural/Neural/Google/Apple voices", () => {
    assert.equal(detectLanguage("El perro corre por el parque con la pelota."), "es");
    assert.equal(detectLanguage("The quick brown fox jumps over the lazy dog."), "en");

    const voices = [
      { name: "eSpeak Spanish", voiceURI: "espeak-es", lang: "es-ES", localService: true },
      { name: "Microsoft Sabina", voiceURI: "ms-sabina", lang: "es-MX", localService: true },
      { name: "Microsoft Dalia Online (Natural) - Spanish (Mexico)", voiceURI: "dalia-natural", lang: "es-MX", localService: false },
      { name: "Google US English", voiceURI: "google-en", lang: "en-US", localService: false }
    ];

    const rankedEs = rankVoices(voices, "es-MX");
    assert.equal(rankedEs[0].voiceURI, "dalia-natural");
    assert.equal(rankedEs[rankedEs.length - 1].voiceURI, "google-en");
    assert.ok(rankedEs[1].score > rankedEs[2].score);
  });

  // 6. book-parser.js (.txt, .md, .epub)
  const { parseBookInput } = await import("../src/lib/book-parser.js");
  await test("book-parser.js parses TXT, Markdown, and real deflated EPUB via DecompressionStream", async () => {
    const txtBook = await parseBookInput({
      name: "notas.txt",
      content: "Capítulo 1\n\nPrimer párrafo del libro.\n\nCapítulo 2\n\nSegundo párrafo del libro."
    });
    assert.equal(txtBook.format, "txt");
    assert.equal(txtBook.chapters.length, 2);

    const mdBook = await parseBookInput({
      name: "guia.md",
      content: "# Guía Local\n\nTexto con **negrita** y [enlace](https://chaladev.site).\n\n## Sección Dos\n\nOtro párrafo."
    });
    assert.equal(mdBook.format, "md");
    assert.equal(mdBook.chapters.length, 2);

    const epubZip = buildTestZipFromEntries({
      mimetype: "application/epub+zip",
      "META-INF/container.xml":
        '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      "OEBPS/content.opf":
        '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Libro Offline</dc:title><dc:creator>Joel Chala</dc:creator><dc:language>es</dc:language></metadata><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
      "OEBPS/ch1.xhtml":
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Inicio</h1><p>Primer capítulo del EPUB.</p></body></html>',
      "OEBPS/ch2.xhtml":
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Final</h1><p>Segundo capítulo del EPUB.</p></body></html>'
    });

    const epubBook = await parseBookInput({ name: "libro.epub", content: epubZip });
    assert.equal(epubBook.format, "epub");
    assert.equal(epubBook.title, "Libro Offline");
    assert.equal(epubBook.chapters.length, 2);
    assert.equal(epubBook.chapters[1].paragraphs[1], "Segundo capítulo del EPUB.");
  });

  // 7. In-tab persistent engine + Shadow DOM Mini-Bar + Modo Inspector en VM aislada
  await test("highlighter.js supports persistent in-tab playback, Shadow DOM Mini-Bar, and Inspector Mode", async () => {
    const { MiniDocument } = createMiniDomEnv();
    const doc = new MiniDocument("Artículo de Prueba", "https://ejemplo.test/post");
    doc.body.innerHTML = [
      "<article>",
      "  <h1>Título Principal</h1>",
      "  <p id='p1'>Primer párrafo introductorio con texto suficiente para lectura.</p>",
      "  <p id='p2'>Segundo párrafo con <a id='linkInside' href='https://otra.test'>un enlace interno</a> para probar bloqueo en Inspector.</p>",
      "  <p id='p3'>Tercer párrafo final de cierre.</p>",
      "</article>"
    ].join("");

    const spokenTexts = [];
    let messageHandler = null;
    class MockUtterance {
      constructor(text) {
        this.text = text;
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
      }
    }

    const ctx = {
      console,
      URL,
      Set,
      Map,
      innerWidth: 1200,
      innerHeight: 800,
      document: doc,
      window: null,
      location: { href: doc.URL },
      SpeechSynthesisUtterance: MockUtterance,
      speechSynthesis: {
        getVoices: () => [{ name: "Microsoft Dalia Natural", voiceURI: "dalia", lang: "es-MX", localService: false }],
        cancel() {},
        speak(u) {
          spokenTexts.push(u.text);
        }
      },
      chrome: {
        i18n: { getMessage: () => "" },
        storage: { local: { get: async () => ({}), set: async () => {} } },
        runtime: {
          onMessage: { addListener: (fn) => { messageHandler = fn; } },
          sendMessage: () => Promise.resolve()
        }
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval
    };
    ctx.window = ctx;
    ctx.globalThis = ctx;

    const vmCtx = vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(SRC, "lib", "readability.js"), "utf8"), vmCtx);
    vm.runInContext(fs.readFileSync(path.join(SRC, "lib", "voice-ranker.js"), "utf8"), vmCtx);
    vm.runInContext(fs.readFileSync(path.join(SRC, "lib", "speech-queue.js"), "utf8"), vmCtx);
    vm.runInContext(fs.readFileSync(path.join(SRC, "content", "highlighter.js"), "utf8"), vmCtx);

    // 7a. Activar Modo Inspector y cancelar con Escape
    await new Promise((resolve) => {
      messageHandler({ type: "CHALAVOICE_CMD", action: "START_INSPECTOR" }, {}, resolve);
    });
    assert.equal(ctx.ChalaVoiceHighlighter.getStatus().inspectorActive, true);
    const p2 = doc.getElementById("p2");
    doc.dispatch("mousemove", { target: p2 });
    assert.equal(p2.getAttribute("data-chalavoice-inspect-hover"), "true");
    const tooltip = doc.getElementById("chalavoice-inspector-tooltip");
    assert.ok(tooltip && tooltip.style.display === "block");
    assert.ok(tooltip.shadowRoot.innerHTML.includes("Clic para leer desde aquí"));

    doc.dispatch("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
    assert.equal(ctx.ChalaVoiceHighlighter.getStatus().inspectorActive, false);
    assert.equal(p2.getAttribute("data-chalavoice-inspect-hover"), null);
    assert.equal(spokenTexts.length, 0, "Escape must cancel without starting playback");

    // 7b. Activar Modo Inspector y hacer clic en un enlace dentro de #p2 -> bloquea clic y lee desde #p2
    await new Promise((resolve) => {
      messageHandler({ type: "CHALAVOICE_CMD", action: "START_INSPECTOR" }, {}, resolve);
    });
    const linkInside = doc.getElementById("linkInside");
    let prevented = false;
    let stopped = false;
    doc.dispatch("click", {
      target: linkInside,
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
      stopImmediatePropagation() {}
    });
    assert.equal(prevented, true, "Inspector click must preventDefault on links");
    assert.equal(stopped, true, "Inspector click must stopPropagation");

    await new Promise((r) => setTimeout(r, 30));
    const st = ctx.ChalaVoiceHighlighter.getStatus();
    assert.equal(st.inspectorActive, false);
    assert.equal(st.state, "playing");
    assert.equal(st.paragraphIndex, 2, "Must start reading from clicked paragraph #p2 (index 2)");
    assert.equal(p2.getAttribute("data-chalavoice-active"), "true");
    assert.ok(spokenTexts[0].includes("Segundo párrafo"), "Spoken utterance must begin at #p2");

    // 7c. Mini Barra Flotante Shadow DOM presente al reproducir y removida al detener
    const minibar = doc.getElementById("chalavoice-minibar-host");
    assert.ok(minibar && minibar.shadowRoot, "Shadow DOM Mini-Bar must exist while playing");
    await new Promise((resolve) => {
      messageHandler({ type: "CHALAVOICE_CMD", action: "STOP" }, {}, resolve);
    });
    assert.equal(doc.getElementById("chalavoice-minibar-host"), null, "Mini-Bar must close on STOP");
  });

  // 8. background.js + ZIPs generados (Chromium, Edge, Firefox AMO sin sidePanel)
  await test("background.js injects 4 classic scripts, opens book reader, and packages valid ZIPs without sidePanel", async () => {
    const executeCalls = [];
    const openedUrls = [];
    const makeEvent = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });

    globalThis.chrome = {
      runtime: {
        onMessage: makeEvent(),
        getURL: (p) => `chrome-extension://chalavoice/${p}`
      },
      tabs: {
        query: async () => [{ id: 5, url: "https://articulo.test/nota", title: "Nota" }],
        get: async (id) => ({ id, url: "https://articulo.test/nota", title: "Nota" }),
        create: async ({ url }) => {
          openedUrls.push(url);
          return { id: 88, url };
        },
        sendMessage: async () => ({ ok: true, status: { state: "playing" } })
      },
      scripting: {
        executeScript: async (opts) => {
          executeCalls.push(opts);
          return [{ result: true }];
        }
      }
    };

    const bg = await import("../src/background.js");
    assert.equal(bg.isRestrictedUrl("chrome://extensions"), true);
    assert.equal(bg.isRestrictedUrl("https://ejemplo.com/post"), false);

    // URL restringida
    globalThis.chrome.tabs.get = async () => ({ id: 9, url: "edge://settings" });
    const blocked = await bg.sendTabCommand(9, { action: "PLAY_PAGE" });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.restricted, true);
    assert.equal(executeCalls.length, 0);

    // URL válida cuando no estaba inyectado
    globalThis.chrome.tabs.get = async () => ({ id: 5, url: "https://articulo.test/nota" });
    globalThis.chrome.tabs.sendMessage = async (_id, msg) => {
      if (msg.type === "CHALAVOICE_PING") throw new Error("Not injected");
      return { ok: true, status: { state: "playing" } };
    };
    const okRes = await bg.sendTabCommand(5, { action: "PLAY_PAGE" });
    assert.equal(okRes.ok, true);
    assert.deepEqual(executeCalls[0].files, [
      "lib/readability.js",
      "lib/voice-ranker.js",
      "lib/speech-queue.js",
      "content/highlighter.js"
    ]);

    // Lector de libros
    await bg.openBookReaderTab({ autoplay: true });
    assert.equal(openedUrls[0], "chrome-extension://chalavoice/reader/index.html?autoplay=1");

    // Validar build y 3 ZIPs
    const version = fs.readFileSync(path.join(ROOT, "dist", "version"), "utf8").trim();
    const chromiumZip = path.join(ROOT, "store", "paquetes", `ChalaVoice_${version}.chromium.zip`);
    const edgeZip = path.join(ROOT, "store", "paquetes", `ChalaVoice_${version}.edge.zip`);
    const firefoxZip = path.join(ROOT, "store", "paquetes", `ChalaVoice_${version}.firefox.zip`);
    assert.ok(fs.existsSync(chromiumZip));
    assert.ok(fs.existsSync(edgeZip));
    assert.ok(fs.existsSync(firefoxZip));

    const ffManifest = JSON.parse(extractZipEntry(fs.readFileSync(firefoxZip), "manifest.json").toString("utf8"));
    assert.equal(ffManifest.browser_specific_settings?.gecko?.id, "chalavoice@chaladev.site");
    assert.equal(ffManifest.browser_specific_settings?.gecko?.strict_min_version, "113.0");
    assert.deepEqual(ffManifest.background?.scripts, ["background.js"]);
    assert.equal(ffManifest.background?.service_worker, undefined);
    assert.equal(ffManifest.action?.default_popup, "popup/index.html");
    assert.equal(ffManifest.sidebar_action, undefined, "Firefox manifest must NOT define sidebar_action");
    assert.equal(ffManifest.side_panel, undefined);
    assert.equal(ffManifest.permissions.includes("sidePanel"), false);
  });

  if (!process.exitCode) {
    console.log(`\nAll ${passed} ChalaVoice verification suites passed.`);
  }
}

run();
