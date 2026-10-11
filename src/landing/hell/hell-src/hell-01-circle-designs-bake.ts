// COPIED from .claude/pages/ad/experiments/hell-src/hell-01-circle-designs-bake.ts by scripts/sync-hell.mjs — edit the source, then sync.
// @ts-nocheck — a protected experiment file, copied unchanged.
/**
 * HELL-01 Canvas2D side:
 *  - the GLYPH ATLAS (research T8): kanji and runes drawn with fillText into
 *    an 8×8 grid, R = crisp glyph, G = blurred glow. Missing glyphs ("tofu")
 *    are detected by comparing pixels with a known-missing code point and
 *    replaced by stroke-alphabet glyphs drawn with lineTo;
 *  - the BAKED CIRCLE (research T9): the same design list drawn once with
 *    Canvas2D paths into a big canvas (R = line, G = glow, B = hot core).
 *
 * Both are generated in code: no image files.
 */

import * as THREE from 'three';
import { C, hash12, L, type Alphabet, type Design } from './hell-01-circle-designs-designs';

const KANJI = ['獄', '封', '魔', '炎', '印', '呪', '鬼', '血', '冥', '闇', '滅', '業', '罪', '門', '陣', '焔'];
const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ'.split('');
const KANJI_FONT = '"Yu Mincho", "YuMincho", "MS Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif';
const RUNE_FONT = '"Segoe UI Historic", "Noto Sans Runic", "Segoe UI Symbol", sans-serif';

export type GlyphAtlas = { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; report: string };

/** Does this font really draw this character (not an empty "tofu" box)? */
function renders(ch: string, font: string): boolean {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  const draw = (s: string) => {
    x.clearRect(0, 0, 64, 64);
    x.font = `48px ${font}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#fff';
    x.fillText(s, 32, 32);
    return x.getImageData(0, 0, 64, 64).data;
  };
  const a = draw(ch);
  const b = draw('￿');
  let ink = 0;
  let diff = 0;
  for (let i = 3; i < a.length; i += 4) {
    if (a[i] > 40) ink++;
    if (Math.abs(a[i] - b[i]) > 40) diff++;
  }
  return ink > 30 && diff > 30;
}

function strokeGlyph(ctx: CanvasRenderingContext2D, alphabet: Alphabet, g: number, cx: number, cy: number, size: number) {
  for (const e of alphabet.glyphs[g % alphabet.glyphs.length]) {
    const [x0, y0, x1, y1] = alphabet.edges[e];
    ctx.beginPath();
    if (x0 === x1 && y0 === y1) {
      ctx.arc(cx + x0 * size, cy - y0 * size, size * 0.05, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(cx + x0 * size, cy - y0 * size);
      ctx.lineTo(cx + x1 * size, cy - y1 * size);
      ctx.stroke();
    }
  }
}

/** 1024² atlas, 64 cells of 128 px: 0–15 kanji, 16–39 runes, 40–63 stroke glyphs. */
export function buildAtlas(renderer: THREE.WebGLRenderer, alphabet: Alphabet): GlyphAtlas {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.globalCompositeOperation = 'lighter';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineCap = 'round';
  let kanjiOk = 0;
  let runesOk = 0;
  for (let i = 0; i < 64; i++) {
    const cx = (i % 8) * 128 + 64;
    const cy = Math.floor(i / 8) * 128 + 64;
    let ch = '';
    let font = '';
    if (i < 16 && renders(KANJI[i], KANJI_FONT)) { ch = KANJI[i]; font = `700 88px ${KANJI_FONT}`; kanjiOk++; }
    else if (i >= 16 && i < 40 && renders(RUNES[i - 16], RUNE_FONT)) { ch = RUNES[i - 16]; font = `92px ${RUNE_FONT}`; runesOk++; }
    for (const pass of ['glow', 'crisp'] as const) {
      ctx.filter = pass === 'glow' ? 'blur(6px)' : 'none';
      ctx.fillStyle = ctx.strokeStyle = pass === 'glow' ? '#00ff00' : '#ff0000';
      if (ch) {
        ctx.font = font;
        ctx.fillText(ch, cx, cy + 4);
        if (pass === 'glow') { ctx.lineWidth = 5; ctx.strokeText(ch, cx, cy + 4); }
      } else {
        // Fallback: the procedural stroke alphabet, drawn with paths.
        ctx.lineWidth = pass === 'glow' ? 12 : 7;
        strokeGlyph(ctx, alphabet, i * 5 + 3, cx, cy, 120);
      }
    }
  }
  ctx.filter = 'none';
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const report = `kanji ${kanjiOk}/16, runes ${runesOk}/24 from system fonts (the rest: stroke glyphs)`;
  return { canvas, texture, report };
}

// ── baked circle ─────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

/** Seam-free lumpy noise round a circle (for the black-sun corona). */
function lumps(theta: number, seed: number): number {
  return 0.5 + 0.22 * Math.sin(theta * 3 + seed) + 0.16 * Math.sin(theta * 7 + seed * 1.7) + 0.08 * Math.sin(theta * 13 + seed * 2.3);
}

const glowCanvas = document.createElement('canvas');

/**
 * Draw the design into `canvas` (size × size). Returns the black-sun disc
 * radius (0 = none): the display shader draws that disc analytically.
 */
export function bakeCircle(canvas: HTMLCanvasElement, design: Design, alphabet: Alphabet, atlas: GlyphAtlas, size: number): number {
  canvas.width = canvas.height = size;
  const main = canvas.getContext('2d')!;
  // The glow pass is drawn sharp into its own canvas and blurred ONCE when
  // composited (a blur filter on every stroke costs seconds per bake).
  glowCanvas.width = glowCanvas.height = size;
  const glowCtx = glowCanvas.getContext('2d')!;
  for (const c of [main, glowCtx]) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.filter = 'none';
    c.fillStyle = '#000';
    c.fillRect(0, 0, size, size);
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }
  let ctx = main;
  const sc = size / 2 / 1.15;
  const pxU = 1 / sc; // one canvas pixel in circle units
  let blackR = 0;

  const passes = [
    { name: 'glow', colour: '#00ff00', widen: 1, extra: 3 * pxU * (size / 2048), blur: 7 * (size / 2048) },
    { name: 'line', colour: '#ff0000', widen: 1, extra: 0, blur: 0 },
    { name: 'core', colour: '#0000ff', widen: 0.45, extra: 0, blur: 0 },
  ];
  for (const pass of passes) {
    if (pass.name === 'line') {
      // Composite the finished glow pass, blurred once.
      main.setTransform(1, 0, 0, 1, 0, 0);
      main.filter = `blur(${passes[0].blur}px)`;
      main.drawImage(glowCanvas, 0, 0);
      main.filter = 'none';
    }
    ctx = pass.name === 'glow' ? glowCtx : main;
    ctx.setTransform(sc, 0, 0, -sc, size / 2, size / 2); // circle units, y up
    ctx.filter = 'none';
    ctx.strokeStyle = ctx.fillStyle = pass.colour;
    for (const layer of design.layers) {
      const p = layer.p ?? [0, 0, 0, 0];
      const rot = layer.rot ?? 0;
      const seed = layer.seed ?? 0;
      ctx.globalAlpha = pass.name === 'core' ? Math.min(1, (layer.inten ?? 1) * 0.9) : 1;
      const lw = (w: number) => Math.max(2 * w * pass.widen, pxU * 1.2) + pass.extra;
      ctx.lineWidth = lw(layer.w);
      ctx.setLineDash([]);
      const circle = (r: number) => { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); };
      const seg = (x0: number, y0: number, x1: number, y1: number) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
      const dot = (x: number, y: number, r: number) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };
      /** Glyph at a centre with an x axis (ax, ay) and y axis (bx, by), `unit` = node scale. */
      const glyph = (g: number, cx: number, cy: number, ax: number, ay: number, bx: number, by: number, unit: number) => {
        for (const e of alphabet.glyphs[g % alphabet.glyphs.length]) {
          const [x0, y0, x1, y1] = alphabet.edges[e];
          const X0 = cx + (x0 * ax + y0 * bx) * unit, Y0 = cy + (x0 * ay + y0 * by) * unit;
          if (x0 === x1 && y0 === y1) { dot(X0, Y0, 0.045 * unit + ctx.lineWidth / 2); continue; }
          seg(X0, Y0, cx + (x1 * ax + y1 * bx) * unit, cy + (x1 * ay + y1 * by) * unit);
        }
      };
      const atlasCell = (idx: number, cx: number, cy: number, ax: number, ay: number, bx: number, by: number, box: number) => {
        if (pass.name !== 'line') return; // the atlas already carries its own glow (G)
        ctx.save();
        // image x -> a axis, image y (down) -> minus b axis
        ctx.transform(ax * box, ay * box, -bx * box, -by * box, cx, cy);
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        ctx.drawImage(atlas.canvas, (idx % 8) * 128, Math.floor(idx / 8) * 128, 128, 128, -0.5, -0.5, 1, 1);
        ctx.restore();
      };

      switch (layer.type) {
        case L.RING: circle(layer.r); break;
        case L.RING2: circle(layer.r - p[0]); circle(layer.r + p[0]); break;
        case L.BAND:
          ctx.lineWidth = pass.name === 'line' ? 2 * layer.w : pass.name === 'core' ? Math.max(layer.w * 0.44, pxU * 1.6) : 2 * layer.w + pass.extra;
          circle(layer.r);
          break;
        case L.DASH: {
          const period = (TAU * layer.r) / p[0];
          ctx.setLineDash([period * p[1], period * (1 - p[1])]);
          ctx.beginPath(); ctx.arc(0, 0, layer.r, rot, rot + TAU); ctx.stroke();
          break;
        }
        case L.ARCS: {
          const sector = TAU / p[0];
          const gapHalf = (p[1] * Math.PI) / p[0];
          for (let k = 0; k < p[0]; k++) {
            ctx.beginPath();
            ctx.arc(0, 0, layer.r, rot + k * sector + gapHalf, rot + (k + 1) * sector - gapHalf);
            ctx.stroke();
          }
          break;
        }
        case L.STAR: {
          const [n, m, mOver, wOver] = p;
          const chords = (mm: number) => {
            for (let k = 0; k < n; k++) {
              const a0 = rot + (TAU * k) / n, a1 = rot + (TAU * (k + mm)) / n;
              seg(layer.r * Math.cos(a0), layer.r * Math.sin(a0), layer.r * Math.cos(a1), layer.r * Math.sin(a1));
            }
          };
          chords(m);
          if (mOver > 0.5) {
            // Woven under: erase a wide stroke along the over star (drawn next in the list).
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out';
            ctx.globalAlpha = 1;
            ctx.filter = 'none';
            ctx.lineCap = 'butt';
            ctx.lineWidth = 2 * (wOver + layer.w + 0.006);
            chords(mOver);
            ctx.restore();
          }
          break;
        }
        case L.POLY: {
          const n = p[0];
          ctx.beginPath();
          for (let k = 0; k <= n; k++) {
            const a = rot + ((k + 0.5) * TAU) / n;
            if (k === 0) ctx.moveTo(layer.r * Math.cos(a), layer.r * Math.sin(a));
            else ctx.lineTo(layer.r * Math.cos(a), layer.r * Math.sin(a));
          }
          ctx.stroke();
          break;
        }
        case L.GLYPHS: case L.ATLAS: {
          const [h, cells, density, extra] = p;
          for (let id = 0; id < cells; id++) {
            const th = rot + (0.5 - (id + 0.5) / cells) * TAU;
            const R = layer.r;
            const cx = R * Math.cos(th), cy = R * Math.sin(th);
            const ax = Math.sin(th), ay = -Math.cos(th); // along the band (clockwise)
            const bx = Math.cos(th), by = Math.sin(th); // outward
            if (layer.type === L.GLYPHS && extra > 0.5) {
              const tb = rot + (0.5 - id / cells) * TAU;
              dot(R * Math.cos(tb), R * Math.sin(tb), 0.035 * h + ctx.lineWidth / 2);
            }
            if (hash12(id, seed) >= density) continue;
            const pickG = hash12(id * 1.37 + 3.1, seed + 11);
            if (layer.type === L.GLYPHS) glyph(Math.floor(pickG * 64), cx, cy, ax, ay, bx, by, h / 1.15);
            else {
              const base = extra < 0.5 ? 0 : extra < 1.5 ? 16 : 0;
              const count = extra < 0.5 ? 16 : extra < 1.5 ? 24 : 40;
              atlasCell(base + Math.floor(pickG * count), cx, cy, ax, ay, bx, by, h / 1.05);
            }
          }
          break;
        }
        case L.SATS: {
          const [n, s, flagsF] = p;
          const flags = Math.round(flagsF);
          for (let k = 0; k < n; k++) {
            const th = rot + (TAU * k) / n;
            const bx = Math.cos(th), by = Math.sin(th);
            const cx = layer.r * bx, cy = layer.r * by;
            const ring = (r: number) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); };
            if (!(flags & 8)) ring(s);
            if (flags & 2) ring(s * 0.8);
            if (flags & 1) glyph(Math.floor(hash12(k + 0.5, seed) * 64), cx, cy, by, -bx, bx, by, s / 1.1);
            if (flags & 4) {
              ctx.beginPath();
              for (let v = 0; v <= 3; v++) {
                const a = th + (v * TAU) / 3;
                const x = cx + 0.62 * s * Math.cos(a), y = cy + 0.62 * s * Math.sin(a);
                if (v === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
              }
              ctx.stroke();
            }
          }
          break;
        }
        case L.TICKS: {
          const [n, len, longEvery] = p;
          for (let k = 0; k < n; k++) {
            const th = rot + (TAU * k) / n;
            const l = len * (longEvery > 0.5 && k % longEvery === 0 ? 2.2 : 1);
            seg(layer.r * Math.cos(th), layer.r * Math.sin(th), (layer.r + l) * Math.cos(th), (layer.r + l) * Math.sin(th));
          }
          break;
        }
        case L.SPOKES: {
          const [n, r0, r1] = p;
          for (let k = 0; k < n; k++) {
            const th = rot + (TAU * k) / n;
            seg(r0 * Math.cos(th), r0 * Math.sin(th), r1 * Math.cos(th), r1 * Math.sin(th));
          }
          break;
        }
        case L.BEADS: {
          const [n, br, alt, open] = p;
          for (let k = 0; k < n; k++) {
            const th = rot + (TAU * k) / n;
            const r = br * (alt > 0.5 && k % 2 === 1 ? 0.55 : 1);
            const x = layer.r * Math.cos(th), y = layer.r * Math.sin(th);
            if (open > 0.5) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
            else dot(x, y, r + ctx.lineWidth / 2);
          }
          break;
        }
        case L.MOONS: {
          const [n, sz, off] = p;
          for (let k = 0; k < n; k++) {
            const th = rot + (TAU * k) / n;
            const x = layer.r * Math.cos(th), y = layer.r * Math.sin(th);
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, sz + ctx.lineWidth / 2, 0, TAU);
            ctx.clip();
            ctx.beginPath();
            ctx.arc(x, y, sz + ctx.lineWidth / 2, 0, TAU);
            ctx.arc(x + sz * off * Math.cos(th), y + sz * off * Math.sin(th), sz * 0.9 - ctx.lineWidth / 2, 0, TAU);
            ctx.fill('evenodd');
            ctx.restore();
          }
          break;
        }
        case L.CENTRE: {
          const R = layer.r;
          const kind = p[0];
          if (kind === C.BLACKSUN) {
            blackR = R;
            // The lumpy corona stays OUTSIDE the round disc (the display
            // shader draws the disc), so the disc reads as a clean black sun.
            ctx.lineWidth = pass.name === 'glow' ? 0.06 : pass.name === 'line' ? 0.016 : 0.009;
            ctx.beginPath();
            for (let k = 0; k <= 180; k++) {
              const th = (k / 180) * TAU;
              const rc = R * (1 + 0.1 * lumps(th, seed)) + (pass.name === 'glow' ? 0.03 : 0.008);
              if (k === 0) ctx.moveTo(rc * Math.cos(th), rc * Math.sin(th)); else ctx.lineTo(rc * Math.cos(th), rc * Math.sin(th));
            }
            ctx.stroke();
          } else if (kind === C.EYE) {
            const d = R * 0.62, b = Math.sqrt(R * R - d * d);
            ctx.beginPath();
            for (let k = 0; k <= 64; k++) { const x = -b + (2 * b * k) / 64; ctx.lineTo(x, Math.sqrt(Math.max(R * R - x * x, 0)) - d); }
            for (let k = 0; k <= 64; k++) { const x = b - (2 * b * k) / 64; ctx.lineTo(x, d - Math.sqrt(Math.max(R * R - x * x, 0))); }
            ctx.stroke();
            circle(R * 0.33);
            const r2 = R * 0.3, d2 = R * 0.255, b2 = Math.sqrt(r2 * r2 - d2 * d2);
            ctx.beginPath();
            for (let k = 0; k <= 32; k++) { const y = -b2 + (2 * b2 * k) / 32; ctx.lineTo(Math.sqrt(Math.max(r2 * r2 - y * y, 0)) - d2, y); }
            for (let k = 0; k <= 32; k++) { const y = b2 - (2 * b2 * k) / 32; ctx.lineTo(d2 - Math.sqrt(Math.max(r2 * r2 - y * y, 0)), y); }
            ctx.fill();
          } else if (kind === C.VORTEX) {
            circle(R);
            for (let k = 0; k < 5; k++) {
              ctx.beginPath();
              for (let j = 0; j <= 80; j++) {
                const r = 0.02 + (R - 0.02) * (j / 80);
                const th = ((k + 0.5 - Math.log(r) * 1.6) * TAU) / 5;
                ctx.lineTo(r * Math.cos(th), r * Math.sin(th));
              }
              ctx.stroke();
            }
          } else if (kind === C.SEAL) {
            circle(R);
            glyph(Math.floor(hash12(seed, 77) * 64), 0, 0, 1, 0, 0, 1, R / 0.62);
          } else if (kind === C.KANJI) {
            const half = R * 1.02 * Math.cos(Math.PI / 4);
            ctx.strokeRect(-half, -half, 2 * half, 2 * half);
            atlasCell(1, 0, 0, 1, 0, 0, 1, R * 1.5);
          } else if (kind === C.HEX) {
            circle(R);
            for (let k = 0; k < 6; k++) {
              const a0 = Math.PI / 2 + (TAU * k) / 6, a1 = Math.PI / 2 + (TAU * (k + 2)) / 6;
              seg(0.86 * R * Math.cos(a0), 0.86 * R * Math.sin(a0), 0.86 * R * Math.cos(a1), 0.86 * R * Math.sin(a1));
            }
          }
          break;
        }
      }
    }
  }
  main.setTransform(1, 0, 0, 1, 0, 0);
  main.filter = 'none';
  main.globalAlpha = 1;
  return blackR;
}
