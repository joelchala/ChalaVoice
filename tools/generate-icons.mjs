/**
 * Generador nativo (cero dependencias externas) de iconos PNG en src/icons/ (16, 32, 48, 128 px)
 * y piezas gráficas en store/ (logo 300x300, promo 440x280, destacada 1400x560, capturas 1280x800).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const ICONS_DIR = path.join(ROOT, "src", "icons");
const STORE_DIR = path.join(ROOT, "store");

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

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0))
  ]);
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function mixColor(c1, c2, t) {
  const k = clamp(t, 0, 1);
  return [
    c1[0] + (c2[0] - c1[0]) * k,
    c1[1] + (c2[1] - c1[1]) * k,
    c1[2] + (c2[2] - c1[2]) * k,
    c1[3] + (c2[3] - c1[3]) * k
  ];
}

function blendOver(dst, src, alpha) {
  const a = clamp(alpha * (src[3] / 255), 0, 1);
  if (a <= 0) return dst;
  const outA = a + (dst[3] / 255) * (1 - a);
  if (outA <= 0) return [0, 0, 0, 0];
  const r = (src[0] * a + dst[0] * (dst[3] / 255) * (1 - a)) / outA;
  const g = (src[1] * a + dst[1] * (dst[3] / 255) * (1 - a)) / outA;
  const b = (src[2] * a + dst[2] * (dst[3] / 255) * (1 - a)) / outA;
  return [r, g, b, outA * 255];
}

function sdRoundedBox(px, py, cx, cy, halfW, halfH, r) {
  const dx = Math.abs(px - cx) - (halfW - r);
  const dy = Math.abs(py - cy) - (halfH - r);
  const outDist = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inDist = Math.min(Math.max(dx, dy), 0);
  return outDist + inDist - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const denom = bax * bax + bay * bay || 1;
  const h = clamp((pax * bax + pay * bay) / denom, 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function sdPolygon(px, py, poly) {
  let minDist = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const d = sdSegment(px, py, a[0], a[1], b[0], b[1]);
    if (d < minDist) minDist = d;
  }
  return pointInPoly(px, py, poly) ? -minDist : minDist;
}

function makeShieldPoly(cx, topY, halfW, midY, bottomY) {
  return [
    [cx, topY],
    [cx + halfW, topY + (midY - topY) * 0.3],
    [cx + halfW, midY],
    [cx + halfW * 0.72, midY + (bottomY - midY) * 0.56],
    [cx, bottomY],
    [cx - halfW * 0.72, midY + (bottomY - midY) * 0.56],
    [cx - halfW, midY],
    [cx - halfW, topY + (midY - topY) * 0.3]
  ];
}

const OUTER_SHIELD = makeShieldPoly(64, 16, 40, 62, 114);
const INNER_SHIELD = makeShieldPoly(64, 23, 33, 61, 106);

const COL_BG_1 = [15, 23, 42, 255];      // #0F172A
const COL_BG_2 = [30, 41, 59, 255];      // #1E293B
const COL_PRIMARY = [16, 185, 129, 255]; // #10B981
const COL_ACCENT = [6, 182, 212, 255];   // #06B6D4
const COL_TEXT = [241, 245, 249, 255];   // #F1F5F9

function coverage(dist, pxScale) {
  const aa = Math.max(0.85, pxScale * 0.75);
  return clamp(0.5 - dist / aa, 0, 1);
}

function sampleIconPixel(ux, uy, pxScale, strokeBoost = 1) {
  let color = [0, 0, 0, 0];

  const dBg = sdRoundedBox(ux, uy, 64, 64, 60, 60, 28);
  const aBg = coverage(dBg, pxScale);
  if (aBg > 0) {
    const bgGrad = mixColor(COL_BG_1, COL_BG_2, (ux + uy) / 256);
    color = blendOver(color, bgGrad, aBg);

    const dTileStroke = Math.abs(dBg) - 2.0;
    const aTileStroke = coverage(dTileStroke, pxScale) * aBg;
    if (aTileStroke > 0) {
      color = blendOver(color, COL_BG_2, aTileStroke);
    }
  }

  const dOuter = sdPolygon(ux, uy, OUTER_SHIELD);
  const aOuter = coverage(dOuter, pxScale);
  if (aOuter > 0) {
    const shieldGrad = mixColor(COL_PRIMARY, COL_ACCENT, (ux + uy - 40) / 176);
    color = blendOver(color, shieldGrad, aOuter);
  }

  const dInner = sdPolygon(ux, uy, INNER_SHIELD);
  const aInner = coverage(dInner, pxScale);
  if (aInner > 0) {
    color = blendOver(color, COL_BG_1, aInner);
  }

  // Barras de onda acústica dentro del escudo (ChalaVoice)
  const bars = [
    [43, 65, 3.2 * strokeBoost, 9, 3, COL_ACCENT],
    [53.5, 65, 3.2 * strokeBoost, 19, 3, COL_PRIMARY],
    [64, 65, 3.4 * strokeBoost, 27, 3.2, COL_TEXT],
    [74.5, 65, 3.2 * strokeBoost, 19, 3, COL_PRIMARY],
    [85, 65, 3.2 * strokeBoost, 9, 3, COL_ACCENT]
  ];

  for (const [bx, by, halfW, halfH, radius, col] of bars) {
    const dBar = sdRoundedBox(ux, uy, bx, by, halfW, halfH, radius);
    const aBar = coverage(dBar, pxScale);
    if (aBar > 0) {
      color = blendOver(color, col, aBar);
    }
  }

  return color;
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const pxScale = 128 / size;
  const strokeBoost = size <= 16 ? 1.35 : size <= 32 ? 1.15 : 1.0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const ux = ((x + 0.5) / size) * 128;
      const uy = ((y + 0.5) / size) * 128;
      const color = sampleIconPixel(ux, uy, pxScale, strokeBoost);
      const idx = (y * size + x) * 4;
      rgba[idx] = Math.round(clamp(color[0], 0, 255));
      rgba[idx + 1] = Math.round(clamp(color[1], 0, 255));
      rgba[idx + 2] = Math.round(clamp(color[2], 0, 255));
      rgba[idx + 3] = Math.round(clamp(color[3], 0, 255));
    }
  }

  return encodePng(size, size, rgba);
}

function fillRect(buf, width, height, x0, y0, rw, rh, col, radius = 0) {
  const xStart = Math.max(0, Math.floor(x0));
  const yStart = Math.max(0, Math.floor(y0));
  const xEnd = Math.min(width, Math.ceil(x0 + rw));
  const yEnd = Math.min(height, Math.ceil(y0 + rh));
  const cx = x0 + rw / 2;
  const cy = y0 + rh / 2;

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      let a = 1;
      if (radius > 0) {
        const d = sdRoundedBox(x + 0.5, y + 0.5, cx, cy, rw / 2, rh / 2, radius);
        a = coverage(d, 1);
      }
      if (a <= 0) continue;
      const idx = (y * width + x) * 4;
      const dst = [buf[idx], buf[idx + 1], buf[idx + 2], buf[idx + 3]];
      const out = blendOver(dst, col, a);
      buf[idx] = Math.round(clamp(out[0], 0, 255));
      buf[idx + 1] = Math.round(clamp(out[1], 0, 255));
      buf[idx + 2] = Math.round(clamp(out[2], 0, 255));
      buf[idx + 3] = Math.round(clamp(out[3], 0, 255));
    }
  }
}

function renderStoreBanner(width, height, variant = "web") {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const grad = mixColor(COL_BG_1, COL_BG_2, (x / width + y / height) * 0.5);
      const idx = (y * width + x) * 4;
      rgba[idx] = Math.round(grad[0]);
      rgba[idx + 1] = Math.round(grad[1]);
      rgba[idx + 2] = Math.round(grad[2]);
      rgba[idx + 3] = 255;
    }
  }

  // Barra simulando progreso de audio
  fillRect(rgba, width, height, 0, 0, Math.round(width * 0.58), 6, COL_PRIMARY, 0);

  // Área principal de artículo / libro
  const pageX = Math.round(width * 0.06);
  const pageY = Math.round(height * 0.1);
  const pageW = Math.round(width * 0.6);
  const pageH = Math.round(height * 0.8);
  fillRect(rgba, width, height, pageX, pageY, pageW, pageH, [30, 41, 59, 245], 16);

  // Párrafo resaltado en vivo (verde + cian)
  const hlY = pageY + Math.round(pageH * 0.34);
  fillRect(rgba, width, height, pageX + 24, hlY, pageW - 48, Math.round(pageH * 0.2), [16, 185, 129, 45], 10);
  fillRect(rgba, width, height, pageX + 36, hlY + 18, Math.round(pageW * 0.66), 14, [6, 182, 212, 160], 5);

  for (let row = 0; row < 5; row += 1) {
    const ly = pageY + 32 + row * 28;
    const lw = row % 2 === 0 ? Math.round(pageW * 0.72) : Math.round(pageW * 0.54);
    fillRect(rgba, width, height, pageX + 36, ly, lw, 11, [203, 213, 225, 190], 4);
  }

  // Panel lateral ChalaVoice (Side Panel)
  const sideX = pageX + pageW + 20;
  const sideW = width - sideX - Math.round(width * 0.06);
  fillRect(rgba, width, height, sideX, pageY, sideW, pageH, [15, 23, 42, 245], 16);
  fillRect(rgba, width, height, sideX + 18, pageY + 20, sideW - 36, 36, COL_PRIMARY, 9);
  fillRect(rgba, width, height, sideX + 18, pageY + 72, (sideW - 44) / 2, 28, variant === "books" ? COL_ACCENT : [38, 51, 73, 255], 7);
  fillRect(rgba, width, height, sideX + 26 + (sideW - 44) / 2, pageY + 72, (sideW - 44) / 2, 28, variant === "presets" ? COL_ACCENT : [38, 51, 73, 255], 7);

  for (let p = 0; p < 4; p += 1) {
    const py = pageY + 120 + p * 36;
    if (py + 28 > pageY + pageH - 60) break;
    fillRect(rgba, width, height, sideX + 18, py, sideW - 36, 26, p === 1 ? [16, 185, 129, 70] : [30, 41, 59, 255], 7);
  }

  // Emblema del icono ChalaVoice en esquina inferior derecha
  const iconSize = Math.min(84, Math.round(Math.min(width, height) * 0.2));
  const ix0 = width - iconSize - 20;
  const iy0 = height - iconSize - 20;
  const pxScale = 128 / iconSize;
  for (let y = 0; y < iconSize; y += 1) {
    for (let x = 0; x < iconSize; x += 1) {
      const ux = ((x + 0.5) / iconSize) * 128;
      const uy = ((y + 0.5) / iconSize) * 128;
      const c = sampleIconPixel(ux, uy, pxScale, 1);
      if (c[3] <= 0) continue;
      const idx = ((iy0 + y) * width + (ix0 + x)) * 4;
      const dst = [rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3]];
      const out = blendOver(dst, c, 1);
      rgba[idx] = Math.round(clamp(out[0], 0, 255));
      rgba[idx + 1] = Math.round(clamp(out[1], 0, 255));
      rgba[idx + 2] = Math.round(clamp(out[2], 0, 255));
      rgba[idx + 3] = Math.round(clamp(out[3], 0, 255));
    }
  }

  return encodePng(width, height, rgba);
}

function main() {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  fs.mkdirSync(STORE_DIR, { recursive: true });

  for (const size of [16, 32, 48, 128]) {
    const outPath = path.join(ICONS_DIR, `icon${size}.png`);
    fs.writeFileSync(outPath, renderIcon(size));
    console.log(`Generated ${path.relative(ROOT, outPath)}`);
  }

  const storeAssets = [
    ["logo-300x300.png", renderIcon(300)],
    ["promo-440x280.png", renderStoreBanner(440, 280, "web")],
    ["destacada-1400x560.png", renderStoreBanner(1400, 560, "presets")],
    ["captura-1-lector-web.png", renderStoreBanner(1280, 800, "web")],
    ["captura-2-perfiles-voz.png", renderStoreBanner(1280, 800, "presets")],
    ["captura-3-biblioteca-epub.png", renderStoreBanner(1280, 800, "books")]
  ];

  for (const [name, buf] of storeAssets) {
    const outPath = path.join(STORE_DIR, name);
    fs.writeFileSync(outPath, buf);
    console.log(`Generated ${path.relative(ROOT, outPath)}`);
  }
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  path.resolve(fileURLToPath(import.meta.url)).toLowerCase() ===
    path.resolve(process.argv[1]).toLowerCase();

if (isDirectRun) {
  main();
}
