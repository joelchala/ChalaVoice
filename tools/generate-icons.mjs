/**
 * Generador nativo (cero dependencias externas) de iconos PNG en src/icons/ (16, 32, 48, 128 px)
 * y piezas gráficas en store/ (logo 300x300, promo 440x280, destacada 1400x560, capturas 1280x800).
 *
 * Renderiza el logotipo oficial de ChalaVoice en paleta Negro / Gris / Naranja / Blanco:
 * parlante circular negro mate (con 4 tornillos y 3 anillos concéntricos), micrófono de
 * estudio gris acero al frente y 3 ondas laterales naranja (#FB923C -> #F97316).
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

function blendOver(dst, src, alpha = 1) {
  const a = clamp(alpha * (src[3] / 255), 0, 1);
  if (a <= 0) return dst;
  const dstA = dst[3] / 255;
  const outA = a + dstA * (1 - a);
  if (outA <= 0) return [0, 0, 0, 0];
  const r = (src[0] * a + dst[0] * dstA * (1 - a)) / outA;
  const g = (src[1] * a + dst[1] * dstA * (1 - a)) / outA;
  const b = (src[2] * a + dst[2] * dstA * (1 - a)) / outA;
  return [r, g, b, outA * 255];
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdRoundedBox(px, py, cx, cy, halfW, halfH, r) {
  const cr = Math.min(r, halfW, halfH);
  const dx = Math.abs(px - cx) - (halfW - cr);
  const dy = Math.abs(py - cy) - (halfH - cr);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - cr;
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

function sdRightArc(px, py, cx, cy, r, halfAngRad) {
  const dx = px - cx;
  const dy = py - cy;
  const ang = Math.atan2(dy, dx);
  if (Math.abs(ang) <= halfAngRad) {
    return Math.abs(Math.hypot(dx, dy) - r);
  }
  const ex = cx + r * Math.cos(halfAngRad);
  const ey1 = cy - r * Math.sin(halfAngRad);
  const ey2 = cy + r * Math.sin(halfAngRad);
  return Math.min(Math.hypot(px - ex, py - ey1), Math.hypot(px - ex, py - ey2));
}

function sdUMountCenterline(px, py, cx, yTop, yArcCenter, r) {
  const dLeft = sdSegment(px, py, cx - r, yTop, cx - r, yArcCenter);
  const dRight = sdSegment(px, py, cx + r, yTop, cx + r, yArcCenter);
  let dArc;
  if (py >= yArcCenter) {
    dArc = Math.abs(Math.hypot(px - cx, py - yArcCenter) - r);
  } else {
    dArc = Math.min(
      Math.hypot(px - (cx - r), py - yArcCenter),
      Math.hypot(px - (cx + r), py - yArcCenter)
    );
  }
  return Math.min(dLeft, dRight, dArc);
}

function coverage(dist, pxScale) {
  const aa = Math.max(1.0, pxScale * 0.48);
  return clamp(0.5 - dist / aa, 0, 1);
}

// Paleta oficial ChalaVoice (Negro, Gris, Naranja y Blanco)
const COL_CANVAS = [11, 11, 14, 255];          // #0B0B0E
const COL_BG_ELEVATED = [18, 18, 22, 255];     // #121216
const COL_SURFACE = [28, 28, 34, 255];         // #1C1C22
const COL_SURFACE_ALT = [42, 42, 50, 255];     // #2A2A32
const COL_BORDER = [63, 63, 70, 255];          // #3F3F46
const COL_TEXT_MUTED = [161, 161, 170, 255];   // #A1A1AA
const COL_TEXT_WHITE = [255, 255, 255, 255];   // #FFFFFF

const COL_OUTLINE = [9, 9, 11, 255];           // #09090B
const COL_SCREW = [8, 8, 10, 255];             // #08080A
const COL_SCREW_RIM = [42, 42, 50, 255];       // #2A2A32
const COL_RING_DARK = [11, 11, 14, 255];       // #0B0B0E
const COL_RING_GRAPHITE = [42, 42, 50, 255];   // #2A2A32
const COL_RING_MID = [34, 34, 40, 255];        // #222228
const COL_CAP_CORE = [28, 28, 34, 255];        // #1C1C22

const COL_SPK_LIGHT = [42, 42, 50, 255];       // #2A2A32
const COL_SPK_MID = [28, 28, 34, 255];         // #1C1C22
const COL_SPK_DARK = [18, 18, 22, 255];        // #121216

const COL_STEEL_BRIGHT = [226, 232, 240, 255]; // #E2E8F0
const COL_STEEL_LIGHT = [203, 213, 225, 255];  // #CBD5E1
const COL_STEEL_MID = [148, 163, 184, 255];    // #94A3B8
const COL_STEEL_DARK = [100, 116, 139, 255];   // #64748B
const COL_STEEL_SHADOW = [82, 82, 91, 255];    // #52525B

const COL_ORANGE_TOP = [251, 146, 60, 255];    // #FB923C
const COL_ORANGE_BOT = [249, 115, 22, 255];    // #F97316

function steelGradient(ux, uy) {
  const t = clamp((ux - 208) / 96, 0, 1);
  let col;
  if (t < 0.25) {
    col = mixColor(COL_STEEL_LIGHT, COL_STEEL_BRIGHT, t / 0.25);
  } else if (t < 0.58) {
    col = mixColor(COL_STEEL_BRIGHT, COL_STEEL_MID, (t - 0.25) / 0.33);
  } else {
    col = mixColor(COL_STEEL_MID, COL_STEEL_DARK, (t - 0.58) / 0.42);
  }
  if (ux >= 224 && ux <= 238) {
    col = mixColor(col, COL_STEEL_BRIGHT, 0.55);
  } else if (ux >= 282) {
    col = mixColor(col, COL_STEEL_SHADOW, 0.4);
  }
  if (uy > 290) {
    col = mixColor(col, COL_STEEL_SHADOW, clamp((uy - 290) / 100, 0, 0.3));
  }
  return col;
}

const SCREWS = [
  [143, 145],
  [369, 145],
  [143, 371],
  [369, 371]
];

const GRILLE_Y = [160.5, 176.5, 192.5, 208.5];

const WAVES = [
  { r: 82, halfAng: (29 * Math.PI) / 180 },
  { r: 106, halfAng: (35 * Math.PI) / 180 },
  { r: 130, halfAng: (40 * Math.PI) / 180 }
];

function sampleLogoPixel(ux, uy, pxScale, opts = {}) {
  const boost = opts.strokeBoost || 1;
  let color = opts.solidBg ? [...COL_CANVAS] : [0, 0, 0, 0];

  // 1. Capa Trasera: Parlante circular negro mate (~76% del lienzo)
  const spkCx = 256;
  const spkCy = 258;
  const dSpeakerBorder = sdCircle(ux, uy, spkCx, spkCy, 197);
  const aSpeakerBorder = coverage(dSpeakerBorder, pxScale);
  if (aSpeakerBorder > 0) {
    color = blendOver(color, COL_OUTLINE, aSpeakerBorder);
  }

  const dSpeaker = sdCircle(ux, uy, spkCx, spkCy, 194);
  const aSpeaker = coverage(dSpeaker, pxScale);
  if (aSpeaker > 0) {
    const gradT = clamp(((ux - 62) * 0.7 + (uy - 64) * 0.3) / 388, 0, 1);
    const spkFill =
      gradT < 0.5
        ? mixColor(COL_SPK_LIGHT, COL_SPK_MID, gradT * 2)
        : mixColor(COL_SPK_MID, COL_SPK_DARK, (gradT - 0.5) * 2);
    color = blendOver(color, spkFill, aSpeaker);

    const dRim = Math.abs(sdCircle(ux, uy, spkCx, spkCy, 189)) - 1.2;
    const aRim = coverage(dRim, pxScale) * aSpeaker;
    if (aRim > 0) color = blendOver(color, COL_BORDER, aRim * 0.55);

    const rings = [
      [134, COL_RING_DARK],
      [122, COL_RING_GRAPHITE],
      [110, COL_RING_DARK],
      [98, COL_RING_MID],
      [86, COL_RING_DARK],
      [74, COL_CAP_CORE]
    ];
    for (const [rad, ringCol] of rings) {
      const dr = sdCircle(ux, uy, spkCx, spkCy, rad);
      const ar = coverage(dr, pxScale);
      if (ar > 0) color = blendOver(color, ringCol, ar);
    }

    for (const [sx, sy] of SCREWS) {
      const dRimS = sdCircle(ux, uy, sx, sy, 10.5);
      const aRimS = coverage(dRimS, pxScale);
      if (aRimS > 0) color = blendOver(color, COL_SCREW_RIM, aRimS * 0.8);

      const dS = sdCircle(ux, uy, sx, sy, 9.0);
      const aS = coverage(dS, pxScale);
      if (aS > 0) color = blendOver(color, COL_SCREW, aS);
    }
  }

  // 2. Acento Lateral: 3 ondas de sonido en naranja (#FB923C -> #F97316)
  const waveCx = 266;
  const waveCy = 253;
  const waveHalfWidth = 5.2 * boost;
  const waveHaloHalf = waveHalfWidth + 3.2;
  const waveCol = mixColor(COL_ORANGE_TOP, COL_ORANGE_BOT, clamp((uy - 170) / 165, 0, 1));

  for (const w of WAVES) {
    const distCenter = sdRightArc(ux, uy, waveCx, waveCy, w.r, w.halfAng);
    const aHalo = coverage(distCenter - waveHaloHalf, pxScale);
    if (aHalo > 0) color = blendOver(color, COL_OUTLINE, aHalo);
    const aWave = coverage(distCenter - waveHalfWidth, pxScale);
    if (aWave > 0) color = blendOver(color, waveCol, aWave);
  }

  // 3. Capa Frontal: Micrófono de estudio gris acero
  const dCapsule = sdRoundedBox(ux, uy, 256, 222, 48, 108, 48);
  const dU = sdUMountCenterline(ux, uy, 256, 224, 282, 59) - 7.5;
  const dNeck = sdRoundedBox(ux, uy, 256, 367, 13, 23, 2);
  const dBase = sdRoundedBox(ux, uy, 256, 399, 58, 9, 9);

  const dMicSilhouette = Math.min(dCapsule, dU, dNeck, dBase);
  const aOutline = coverage(dMicSilhouette - 6.5 * boost, pxScale);
  if (aOutline > 0) {
    color = blendOver(color, COL_OUTLINE, aOutline);
  }

  const aNeck = coverage(dNeck, pxScale);
  if (aNeck > 0) {
    let neckCol = steelGradient(ux, uy);
    if (ux >= 248 && ux <= 254) neckCol = mixColor(neckCol, COL_STEEL_BRIGHT, 0.45);
    color = blendOver(color, neckCol, aNeck);
  }

  const aBase = coverage(dBase, pxScale);
  if (aBase > 0) {
    let baseCol = steelGradient(ux, uy);
    if (uy <= 394) baseCol = mixColor(baseCol, COL_STEEL_BRIGHT, 0.55);
    color = blendOver(color, baseCol, aBase);
  }

  const aCapsule = coverage(dCapsule, pxScale);
  if (aCapsule > 0) {
    let capCol = steelGradient(ux, uy);
    if (uy >= 224 && uy <= 229) {
      capCol = COL_OUTLINE;
    } else if (uy > 229 && uy <= 233) {
      capCol = mixColor(capCol, COL_STEEL_BRIGHT, 0.6);
    } else if (uy >= 253 && uy <= 258) {
      capCol = COL_OUTLINE;
    }
    color = blendOver(color, capCol, aCapsule);

    for (const gy of GRILLE_Y) {
      const dSlotL = sdRoundedBox(ux, uy, 220.5, gy, 16.5, 4.5 * boost, 4.5);
      const dSlotR = sdRoundedBox(ux, uy, 291.5, gy, 16.5, 4.5 * boost, 4.5);
      const aSlot = coverage(Math.min(dSlotL, dSlotR), pxScale) * aCapsule;
      if (aSlot > 0) color = blendOver(color, COL_OUTLINE, aSlot);
    }
  }

  const dUBack = sdUMountCenterline(ux, uy, 256, 224, 282, 59) - 10.5;
  const aUBack = coverage(dUBack, pxScale);
  if (aUBack > 0) color = blendOver(color, COL_OUTLINE, aUBack);

  const aU = coverage(dU, pxScale);
  if (aU > 0) {
    const tU = clamp((ux - 190) / 132, 0, 1);
    let uCol = mixColor(COL_STEEL_LIGHT, COL_STEEL_SHADOW, tU);
    if (uy <= 236) uCol = mixColor(uCol, COL_STEEL_BRIGHT, 0.55);
    color = blendOver(color, uCol, aU);
  }

  return color;
}

function renderLogoPng(size, { solidBg = false, cropMargin = 0 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const span = 512 - cropMargin * 2;
  const pxScale = span / size;
  const strokeBoost = size <= 16 ? 1.25 : size <= 32 ? 1.08 : 1.0;
  const ss = size <= 48 ? 4 : 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const samples = ss * ss;

      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const fx = (x + (sx + 0.5) / ss) / size;
          const fy = (y + (sy + 0.5) / ss) / size;
          const ux = cropMargin + fx * span;
          const uy = cropMargin + fy * span;
          const c = sampleLogoPixel(ux, uy, pxScale, { solidBg, strokeBoost });
          const ca = c[3] / 255;
          r += c[0] * ca;
          g += c[1] * ca;
          b += c[2] * ca;
          a += ca;
        }
      }

      const avgA = a / samples;
      const idx = (y * size + x) * 4;
      if (avgA > 0) {
        rgba[idx] = Math.round(clamp(r / a, 0, 255));
        rgba[idx + 1] = Math.round(clamp(g / a, 0, 255));
        rgba[idx + 2] = Math.round(clamp(b / a, 0, 255));
        rgba[idx + 3] = Math.round(clamp(avgA * 255, 0, 255));
      } else {
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 0;
      }
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
      const grad = mixColor(COL_CANVAS, COL_SURFACE, (x / width + y / height) * 0.4);
      const idx = (y * width + x) * 4;
      rgba[idx] = Math.round(grad[0]);
      rgba[idx + 1] = Math.round(grad[1]);
      rgba[idx + 2] = Math.round(grad[2]);
      rgba[idx + 3] = 255;
    }
  }

  // Tarjeta principal de página web / libro con resaltado naranja (Modo Inspector / Lectura)
  const pageX = Math.round(width * 0.06);
  const pageY = Math.round(height * 0.1);
  const pageW = Math.round(width * 0.58);
  const pageH = Math.round(height * 0.78);
  fillRect(rgba, width, height, pageX, pageY, pageW, pageH, [18, 18, 22, 248], 16);

  const hlY = pageY + Math.round(pageH * 0.34);
  fillRect(rgba, width, height, pageX + 24, hlY, pageW - 48, Math.round(pageH * 0.22), [249, 115, 22, 42], 10);
  fillRect(rgba, width, height, pageX + 24, hlY, pageW - 48, 3, COL_ORANGE_BOT, 0);
  fillRect(rgba, width, height, pageX + 36, hlY + 20, Math.round(pageW * 0.64), 14, [249, 115, 22, 190], 5);

  for (let row = 0; row < 5; row += 1) {
    const ly = pageY + 32 + row * 28;
    const lw = row % 2 === 0 ? Math.round(pageW * 0.72) : Math.round(pageW * 0.52);
    fillRect(rgba, width, height, pageX + 36, ly, lw, 11, [244, 244, 245, 190], 4);
  }

  // Mini Barra Flotante discreta en la esquina inferior del área web
  const barW = Math.min(260, Math.round(pageW * 0.56));
  const barX = pageX + pageW - barW - 18;
  const barY = pageY + pageH - 48;
  fillRect(rgba, width, height, barX, barY, barW, 34, COL_BG_ELEVATED, 17);
  fillRect(rgba, width, height, barX + 44, barY + 5, 24, 24, COL_ORANGE_BOT, 12);
  fillRect(rgba, width, height, barX + 14, barY + 7, 20, 20, COL_SURFACE, 10);
  fillRect(rgba, width, height, barX + 78, barY + 7, 20, 20, COL_SURFACE, 10);

  // Popup compacto ChalaVoice (360px estilo negro/gris/naranja)
  const popX = pageX + pageW + 22;
  const popW = width - popX - Math.round(width * 0.06);
  fillRect(rgba, width, height, popX, pageY, popW, pageH, [18, 18, 22, 248], 16);
  fillRect(rgba, width, height, popX + 16, pageY + 18, popW - 32, 34, COL_ORANGE_BOT, 8);
  fillRect(
    rgba,
    width,
    height,
    popX + 16,
    pageY + 62,
    popW - 32,
    28,
    variant === "books" ? COL_SURFACE_ALT : [249, 115, 22, 40],
    8
  );

  for (let p = 0; p < 4; p += 1) {
    const py = pageY + 106 + p * 36;
    if (py + 28 > pageY + pageH - 60) break;
    fillRect(
      rgba,
      width,
      height,
      popX + 16,
      py,
      popW - 32,
      26,
      p === 1 ? [249, 115, 22, 55] : COL_SURFACE,
      7
    );
  }

  // Emblema circular del logo ChalaVoice con ondas naranjas
  const iconSize = Math.min(86, Math.round(Math.min(width, height) * 0.21));
  const ix0 = width - iconSize - 20;
  const iy0 = height - iconSize - 20;
  const span = 424;
  const margin = 44;
  const pxScale = span / iconSize;
  for (let y = 0; y < iconSize; y += 1) {
    for (let x = 0; x < iconSize; x += 1) {
      const ux = margin + ((x + 0.5) / iconSize) * span;
      const uy = margin + ((y + 0.5) / iconSize) * span;
      const c = sampleLogoPixel(ux, uy, pxScale, { solidBg: false, strokeBoost: 1 });
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
    fs.writeFileSync(outPath, renderLogoPng(size, { solidBg: false, cropMargin: 44 }));
    console.log(`Generated ${path.relative(ROOT, outPath)}`);
  }

  const forceStore = process.argv.includes("--force-store");
  const logoPath = path.join(STORE_DIR, "logo-300x300.png");
  fs.writeFileSync(logoPath, renderLogoPng(300, { solidBg: true, cropMargin: 0 }));
  console.log(`Generated ${path.relative(ROOT, logoPath)}`);

  const storeAssets = [
    ["promo-440x280.png", () => renderStoreBanner(440, 280, "web")],
    ["destacada-1400x560.png", () => renderStoreBanner(1400, 560, "presets")],
    ["captura-1-lector-web.png", () => renderStoreBanner(1280, 800, "web")],
    ["captura-2-perfiles-voz.png", () => renderStoreBanner(1280, 800, "presets")],
    ["captura-3-biblioteca-epub.png", () => renderStoreBanner(1280, 800, "books")]
  ];

  for (const [name, renderFn] of storeAssets) {
    const outPath = path.join(STORE_DIR, name);
    if (!forceStore && fs.existsSync(outPath)) {
      console.log(`Kept existing ${path.relative(ROOT, outPath)}`);
      continue;
    }
    fs.writeFileSync(outPath, renderFn());
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
