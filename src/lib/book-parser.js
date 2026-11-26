/**
 * Parser 100% local de libros y textos para ChalaVoice (.epub, .md, .txt y texto directo).
 * Implementa un lector PKZIP puro + DecompressionStream('deflate-raw') nativo y DOMParser
 * (con respaldo XML/XHTML en JS puro para ejecución sin DOM en Node.js), cero dependencias.
 */

const textDecoder = new TextDecoder("utf-8");

function countWords(text) {
  const clean = String(text || "").trim();
  if (!clean) return 0;
  return clean.split(/\s+/).filter(Boolean).length;
}

function normalizeLineEndings(text) {
  return String(text || "").replace(/\r\n?/g, "\n");
}

function baseNameWithoutExt(fileName) {
  const base = String(fileName || "Documento")
    .split(/[\\/]/)
    .pop();
  return base.replace(/\.[^.]+$/, "").trim() || "Documento";
}

function decodeXmlEntities(str) {
  return String(str || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

function stripTagsAndNormalize(htmlFragment) {
  return decodeXmlEntities(String(htmlFragment || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseAttributes(attrString) {
  const attrs = {};
  const attrRe = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attrRe.exec(attrString || "")) !== null) {
    attrs[match[1].toLowerCase()] = decodeXmlEntities(match[2] ?? match[3] ?? "");
  }
  return attrs;
}

function resolveZipPath(baseDir, relativeHref) {
  const cleanRel = decodeURIComponent(String(relativeHref || "").split("#")[0].trim());
  if (!cleanRel) return "";
  const baseParts = baseDir ? baseDir.split("/").filter(Boolean) : [];
  const relParts = cleanRel.split("/").filter(Boolean);
  const stack = [...baseParts];
  for (const part of relParts) {
    if (part === ".") continue;
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}

/**
 * Descomprime un payload deflate-raw usando el API Web Streams nativo (Chromium, Firefox y Node >= 22).
 * @param {Uint8Array} compressedBytes
 * @returns {Promise<Uint8Array>}
 */
async function inflateDeflateRaw(compressedBytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([compressedBytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Lee un archivo ZIP (PKZIP) en memoria y devuelve un mapa normalizado de rutas -> función lectora.
 * @param {ArrayBuffer|Uint8Array} inputBuffer
 */
export function indexZipArchive(inputBuffer) {
  const bytes = inputBuffer instanceof Uint8Array ? inputBuffer : new Uint8Array(inputBuffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocdOffset = -1;
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("Archivo EPUB/ZIP inválido: no se encontró el registro EOCD.");
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const entries = new Map();

  let cursor = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error("Archivo EPUB/ZIP inválido: directorio central corrupto.");
    }
    const method = view.getUint16(cursor + 10, true);
    const compSize = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);

    const entryName = textDecoder
      .decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen))
      .replace(/\\/g, "/");

    entries.set(entryName.toLowerCase(), {
      name: entryName,
      method,
      compSize,
      localOffset
    });

    cursor += 46 + nameLen + extraLen + commentLen;
  }

  async function readEntryBytes(entryPath) {
    const entry = entries.get(String(entryPath || "").replace(/\\/g, "/").toLowerCase());
    if (!entry) return null;
    if (view.getUint32(entry.localOffset, true) !== 0x04034b50) {
      throw new Error(`Cabecera local inválida para ${entry.name}`);
    }
    const lfhNameLen = view.getUint16(entry.localOffset + 26, true);
    const lfhExtraLen = view.getUint16(entry.localOffset + 28, true);
    const dataStart = entry.localOffset + 30 + lfhNameLen + lfhExtraLen;
    const compSlice = bytes.subarray(dataStart, dataStart + entry.compSize);

    if (entry.method === 0) {
      return new Uint8Array(compSlice);
    }
    if (entry.method === 8) {
      return inflateDeflateRaw(compSlice);
    }
    throw new Error(`Método de compresión ZIP no soportado (${entry.method}) en ${entry.name}`);
  }

  async function readEntryText(entryPath) {
    const raw = await readEntryBytes(entryPath);
    return raw ? textDecoder.decode(raw) : null;
  }

  return { entries, readEntryBytes, readEntryText };
}

/**
 * Extrae párrafos y título desde un documento XHTML/HTML de EPUB.
 * Usa DOMParser cuando está disponible en el navegador, con respaldo puro en JS para Node.js.
 * @param {string} xhtml
 * @param {string} fallbackTitle
 */
export function extractXhtmlChapter(xhtml, fallbackTitle = "Capítulo") {
  const source = String(xhtml || "");
  let title = "";
  const paragraphs = [];

  if (typeof DOMParser !== "undefined") {
    try {
      const parser = new DOMParser();
      let doc = parser.parseFromString(source, "application/xhtml+xml");
      if (!doc || doc.querySelector("parsererror")) {
        doc = parser.parseFromString(source, "text/html");
      }
      if (doc && doc.body) {
        const headingEl = doc.body.querySelector("h1, h2, h3");
        const docTitle = (doc.querySelector("title")?.textContent || "").trim();
        title = (headingEl?.textContent || docTitle || "").replace(/\s+/g, " ").trim();

        const blocks = doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6, p, blockquote, li");
        const seen = new Set();
        for (const el of blocks) {
          if ((el.tagName === "LI" || el.tagName === "BLOCKQUOTE") && el.querySelector("p")) {
            continue;
          }
          const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (!txt || seen.has(txt)) continue;
          seen.add(txt);
          paragraphs.push(txt);
        }
        if (paragraphs.length === 0) {
          const bodyTxt = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
          if (bodyTxt) paragraphs.push(bodyTxt);
        }
        return {
          title: title || fallbackTitle,
          paragraphs,
          wordCount: countWords(paragraphs.join(" "))
        };
      }
    } catch {
      // Continuar con extractor JS puro
    }
  }

  const cleaned = source
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "");

  const hMatch = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/i.exec(cleaned);
  const tMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(cleaned);
  title = stripTagsAndNormalize(hMatch?.[2] || tMatch?.[1] || "") || fallbackTitle;

  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(cleaned);
  const bodyHtml = bodyMatch ? bodyMatch[1] : cleaned;

  const blockRe = /<(h[1-6]|p|blockquote|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const seen = new Set();
  let match;
  while ((match = blockRe.exec(bodyHtml)) !== null) {
    const inner = match[2];
    if (/^(li|blockquote)$/i.test(match[1]) && /<p\b/i.test(inner)) {
      continue;
    }
    const text = stripTagsAndNormalize(inner);
    if (text && !seen.has(text)) {
      seen.add(text);
      paragraphs.push(text);
    }
  }

  if (paragraphs.length === 0) {
    const fallback = stripTagsAndNormalize(bodyHtml);
    if (fallback) paragraphs.push(fallback);
  }

  return {
    title,
    paragraphs,
    wordCount: countWords(paragraphs.join(" "))
  };
}

function parseOpfDocument(opfXml) {
  let title = "";
  let author = "";
  let language = "";
  const manifest = new Map();
  const spineIds = [];

  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(opfXml, "application/xml");
      if (doc && !doc.querySelector("parsererror")) {
        const getByLocal = (local) => {
          const all = doc.getElementsByTagName("*");
          for (const el of all) {
            if (el.localName === local || el.tagName.endsWith(`:${local}`)) {
              const val = (el.textContent || "").trim();
              if (val) return val;
            }
          }
          return "";
        };
        title = getByLocal("title");
        author = getByLocal("creator");
        language = getByLocal("language");

        for (const item of doc.querySelectorAll("manifest > item, item")) {
          const id = item.getAttribute("id");
          const href = item.getAttribute("href");
          const mediaType = item.getAttribute("media-type") || "";
          if (id && href) {
            manifest.set(id, { id, href, mediaType });
          }
        }
        for (const itemref of doc.querySelectorAll("spine > itemref, itemref")) {
          const idref = itemref.getAttribute("idref");
          if (idref) spineIds.push(idref);
        }
        if (manifest.size > 0 && spineIds.length > 0) {
          return { title, author, language, manifest, spineIds };
        }
      }
    } catch {
      // Continuar con parser XML ligero
    }
  }

  const titleMatch = /<(?:dc:)?title\b[^>]*>([\s\S]*?)<\/(?:dc:)?title>/i.exec(opfXml);
  const authorMatch = /<(?:dc:)?creator\b[^>]*>([\s\S]*?)<\/(?:dc:)?creator>/i.exec(opfXml);
  const langMatch = /<(?:dc:)?language\b[^>]*>([\s\S]*?)<\/(?:dc:)?language>/i.exec(opfXml);

  title = stripTagsAndNormalize(titleMatch?.[1] || "");
  author = stripTagsAndNormalize(authorMatch?.[1] || "");
  language = stripTagsAndNormalize(langMatch?.[1] || "");

  const itemRe = /<item\b([^>]*?)\/?>/gi;
  let im;
  while ((im = itemRe.exec(opfXml)) !== null) {
    const attrs = parseAttributes(im[1]);
    if (attrs.id && attrs.href) {
      manifest.set(attrs.id, {
        id: attrs.id,
        href: attrs.href,
        mediaType: attrs["media-type"] || ""
      });
    }
  }

  const spineRe = /<itemref\b([^>]*?)\/?>/gi;
  let sm;
  while ((sm = spineRe.exec(opfXml)) !== null) {
    const attrs = parseAttributes(sm[1]);
    if (attrs.idref && attrs.linear !== "no") {
      spineIds.push(attrs.idref);
    }
  }

  return { title, author, language, manifest, spineIds };
}

/**
 * Parsea un archivo .epub local (ArrayBuffer o Uint8Array) en capítulos y párrafos.
 * @param {ArrayBuffer|Uint8Array} bufferLike
 * @param {string} [fileName]
 */
export async function parseEpub(bufferLike, fileName = "Libro.epub") {
  const zip = indexZipArchive(bufferLike);
  const containerXml = await zip.readEntryText("META-INF/container.xml");
  if (!containerXml) {
    throw new Error("EPUB inválido: falta META-INF/container.xml");
  }

  const rootfileMatch = /<rootfile\b[^>]*full-path\s*=\s*["']([^"']+)["']/i.exec(containerXml);
  if (!rootfileMatch) {
    throw new Error("EPUB inválido: no se encontró rootfile en container.xml");
  }

  const opfPath = rootfileMatch[1].trim();
  const opfXml = await zip.readEntryText(opfPath);
  if (!opfXml) {
    throw new Error(`EPUB inválido: no se encontró el paquete OPF (${opfPath})`);
  }

  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
  const opf = parseOpfDocument(opfXml);

  const chapters = [];
  for (const idref of opf.spineIds) {
    const item = opf.manifest.get(idref);
    if (!item) continue;
    if (item.mediaType && !/html|xhtml|xml/i.test(item.mediaType)) {
      continue;
    }
    const chapterPath = resolveZipPath(opfDir, item.href);
    const xhtml = await zip.readEntryText(chapterPath);
    if (!xhtml) continue;

    const extracted = extractXhtmlChapter(xhtml, `Capítulo ${chapters.length + 1}`);
    if (extracted.paragraphs.length > 0) {
      chapters.push({
        index: chapters.length,
        title: extracted.title,
        paragraphs: extracted.paragraphs,
        wordCount: extracted.wordCount
      });
    }
  }

  if (chapters.length === 0) {
    throw new Error("No se encontró contenido de texto legible dentro del EPUB.");
  }

  const totalWords = chapters.reduce((acc, ch) => acc + ch.wordCount, 0);

  return {
    id: `book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: opf.title || baseNameWithoutExt(fileName),
    author: opf.author || "",
    lang: opf.language || "",
    format: "epub",
    chapters,
    totalWords,
    createdAt: Date.now()
  };
}

function cleanMarkdownInline(text) {
  return String(text || "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parsea un documento Markdown (.md) en capítulos por encabezados (# / ##) y párrafos limpios.
 * @param {string} mdText
 * @param {string} [fileName]
 */
export function parseMarkdown(mdText, fileName = "Documento.md") {
  let raw = normalizeLineEndings(mdText);
  // Eliminar frontmatter YAML si existe
  raw = raw.replace(/^---\n[\s\S]*?\n---\n+/, "");
  // Eliminar bloques de código largos para no leer sintaxis cruda
  raw = raw.replace(/```[\s\S]*?```/g, "\n[Bloque de código omitido]\n");

  const lines = raw.split("\n");
  let docTitle = "";
  const chapters = [];
  let currentChapter = {
    index: 0,
    title: baseNameWithoutExt(fileName),
    paragraphs: []
  };
  let buffer = [];

  const flushParagraph = () => {
    if (buffer.length === 0) return;
    const joined = cleanMarkdownInline(buffer.join(" "));
    if (joined) {
      currentChapter.paragraphs.push(joined);
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const headingText = cleanMarkdownInline(headingMatch[2]);
      if (!headingText) continue;

      if (level === 1 && !docTitle) {
        docTitle = headingText;
      }

      if (level <= 2 && currentChapter.paragraphs.length > 0) {
        chapters.push({
          ...currentChapter,
          wordCount: countWords(currentChapter.paragraphs.join(" "))
        });
        currentChapter = {
          index: chapters.length,
          title: headingText,
          paragraphs: [headingText]
        };
      } else {
        if (currentChapter.paragraphs.length === 0 && level <= 2) {
          currentChapter.title = headingText;
        }
        currentChapter.paragraphs.push(headingText);
      }
      continue;
    }

    if (/^([-*_]){3,}$/.test(trimmed)) {
      flushParagraph();
      continue;
    }

    buffer.push(trimmed);
  }
  flushParagraph();

  if (currentChapter.paragraphs.length > 0) {
    chapters.push({
      ...currentChapter,
      wordCount: countWords(currentChapter.paragraphs.join(" "))
    });
  }

  const totalWords = chapters.reduce((acc, ch) => acc + ch.wordCount, 0);
  return {
    id: `book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: docTitle || baseNameWithoutExt(fileName),
    author: "",
    lang: "",
    format: "md",
    chapters,
    totalWords,
    createdAt: Date.now()
  };
}

/**
 * Parsea un archivo de texto plano (.txt) o texto pegado en capítulos y párrafos.
 * @param {string} txt
 * @param {string} [fileName]
 */
export function parseTxt(txt, fileName = "Texto.txt") {
  const normalized = normalizeLineEndings(txt).trim();
  const rawParagraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const chapterHeadingRe = /^(?:cap[íi]tulo|chapter|parte|part|secci[óo]n|section)\s+[0-9ivxlcdm]+\b/i;
  const chapters = [];
  let current = {
    index: 0,
    title: baseNameWithoutExt(fileName),
    paragraphs: []
  };

  for (const para of rawParagraphs) {
    if (chapterHeadingRe.test(para) && para.length <= 100 && current.paragraphs.length > 0) {
      chapters.push({
        ...current,
        wordCount: countWords(current.paragraphs.join(" "))
      });
      current = {
        index: chapters.length,
        title: para,
        paragraphs: [para]
      };
    } else {
      if (current.paragraphs.length === 0 && chapterHeadingRe.test(para) && para.length <= 100) {
        current.title = para;
      }
      current.paragraphs.push(para);
    }
  }

  if (current.paragraphs.length > 0) {
    chapters.push({
      ...current,
      wordCount: countWords(current.paragraphs.join(" "))
    });
  }

  const totalWords = chapters.reduce((acc, ch) => acc + ch.wordCount, 0);
  return {
    id: `book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: baseNameWithoutExt(fileName),
    author: "",
    lang: "",
    format: "txt",
    chapters,
    totalWords,
    createdAt: Date.now()
  };
}

/**
 * Punto de entrada unificado para cargar libros (.epub, .md, .txt) o texto pegado.
 * @param {{ name?: string, content: string|ArrayBuffer|Uint8Array, type?: string }} input
 */
export async function parseBookInput(input) {
  const name = String(input?.name || "Documento.txt");
  const ext = (input?.type || name.split(".").pop() || "txt").toLowerCase().replace(/^\./, "");

  if (ext === "epub") {
    return parseEpub(input.content, name);
  }
  const textContent =
    typeof input.content === "string"
      ? input.content
      : textDecoder.decode(
          input.content instanceof Uint8Array ? input.content : new Uint8Array(input.content)
        );
  if (ext === "md" || ext === "markdown") {
    return parseMarkdown(textContent, name);
  }
  return parseTxt(textContent, name);
}
