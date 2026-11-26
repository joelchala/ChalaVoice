import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SRC_DIR = path.join(ROOT, "src");
const BUILD_DIR = path.join(ROOT, "dist", "build");
const UNPACKED_DIR = path.join(BUILD_DIR, "ChalaVoice.chromium");
const PACKAGES_DIR = path.join(ROOT, "store", "paquetes");
const VERSION_FILE = path.join(ROOT, "dist", "version");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function collectFiles(dirPath, baseDir = dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(abs, baseDir));
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, abs).split(path.sep).join("/");
      files.push({ rel, abs });
    }
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return files;
}

/**
 * Transforma el manifest.json MV3 de Chromium/Edge a formato compatible con Mozilla Firefox (AMO).
 */
export function toFirefoxManifest(manifest, geckoId = "chalavoice@chaladev.site") {
  const ff = structuredClone(manifest);
  ff.browser_specific_settings = {
    ...(ff.browser_specific_settings || {}),
    gecko: {
      ...(ff.browser_specific_settings?.gecko || {}),
      id: geckoId,
      strict_min_version: "113.0",
      data_collection_permissions: {
        required: ["none"]
      }
    }
  };

  if (ff.background && ff.background.service_worker) {
    const { service_worker: sw, ...rest } = ff.background;
    ff.background = {
      scripts: [sw],
      ...rest
    };
  }

  delete ff.side_panel;
  if (Array.isArray(ff.permissions)) {
    ff.permissions = ff.permissions.filter((perm) => perm !== "sidePanel");
  }
  delete ff.minimum_chrome_version;
  return ff;
}

/**
 * Extrae una entrada específica desde un buffer ZIP estándar PKZIP.
 */
export function extractZipEntry(zipBuffer, targetName) {
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= Math.max(0, zipBuffer.length - 65557); i -= 1) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("Invalid ZIP: missing EOCD");
  }
  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  let cursor = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (zipBuffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Invalid ZIP: corrupt Central Directory");
    }
    const method = zipBuffer.readUInt16LE(cursor + 10);
    const compSize = zipBuffer.readUInt32LE(cursor + 20);
    const nameLen = zipBuffer.readUInt16LE(cursor + 28);
    const extraLen = zipBuffer.readUInt16LE(cursor + 30);
    const commentLen = zipBuffer.readUInt16LE(cursor + 32);
    const localOffset = zipBuffer.readUInt32LE(cursor + 42);
    const entryName = zipBuffer.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");

    if (entryName === targetName) {
      const lfhNameLen = zipBuffer.readUInt16LE(localOffset + 26);
      const lfhExtraLen = zipBuffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lfhNameLen + lfhExtraLen;
      const compData = zipBuffer.subarray(dataStart, dataStart + compSize);
      return method === 8 ? zlib.inflateRawSync(compData) : Buffer.from(compData);
    }
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/**
 * Crea un archivo ZIP estándar compatible con Chrome Web Store, Edge Add-ons y Firefox AMO.
 */
export function buildZipBuffer(sourceDir, fileOverrides = {}) {
  const files = collectFiles(sourceDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const file of files) {
    const raw = Object.prototype.hasOwnProperty.call(fileOverrides, file.rel)
      ? Buffer.from(fileOverrides[file.rel])
      : fs.readFileSync(file.abs);
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const nameBuf = Buffer.from(file.rel, "utf8");
    const crc = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function readTargetVersion() {
  const cliVersion = process.argv[2]?.trim().replace(/^v/i, "");
  if (cliVersion) return cliVersion;
  if (fs.existsSync(VERSION_FILE)) {
    const v = fs.readFileSync(VERSION_FILE, "utf8").trim().replace(/^v/i, "");
    if (v) return v;
  }
  return "1.0.0";
}

function main() {
  const version = readTargetVersion();

  fs.rmSync(UNPACKED_DIR, { recursive: true, force: true });
  fs.mkdirSync(UNPACKED_DIR, { recursive: true });
  fs.cpSync(SRC_DIR, UNPACKED_DIR, { recursive: true });

  const manifestPath = path.join(UNPACKED_DIR, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const zipBuffer = buildZipBuffer(UNPACKED_DIR);
  const firefoxManifest = toFirefoxManifest(manifest);
  const firefoxZipBuffer = buildZipBuffer(UNPACKED_DIR, {
    "manifest.json": Buffer.from(`${JSON.stringify(firefoxManifest, null, 2)}\n`, "utf8")
  });

  fs.mkdirSync(PACKAGES_DIR, { recursive: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  const outputs = [
    path.join(PACKAGES_DIR, `ChalaVoice_${version}.chromium.zip`),
    path.join(PACKAGES_DIR, `ChalaVoice_${version}.edge.zip`),
    path.join(PACKAGES_DIR, `ChalaVoice_${version}.firefox.zip`),
    path.join(BUILD_DIR, `ChalaVoice_${version}.chromium.zip`),
    path.join(BUILD_DIR, `ChalaVoice_${version}.edge.zip`),
    path.join(BUILD_DIR, `ChalaVoice_${version}.firefox.zip`)
  ];

  for (const outPath of outputs) {
    const buf = outPath.endsWith(".firefox.zip") ? firefoxZipBuffer : zipBuffer;
    fs.writeFileSync(outPath, buf);
  }

  console.log(`Built unpacked extension: ${UNPACKED_DIR}`);
  console.log(`Created Chromium, Edge & Firefox (AMO) packages for version ${version}:`);
  for (const outPath of outputs) {
    console.log(`  - ${path.relative(ROOT, outPath)}`);
  }
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  path.resolve(fileURLToPath(import.meta.url)).toLowerCase() ===
    path.resolve(process.argv[1]).toLowerCase();

if (isDirectRun) {
  main();
}
