import { paintPixelRGB } from './dryBrush';
import { RGB } from './palette';
import { PaperSubstrate } from './paper';
import { clamp, fbm2D, lerp, Point2D, Rng, smoothstep } from './rng';

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const ct = clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * ct, a[1] + (b[1] - a[1]) * ct, a[2] + (b[2] - a[2]) * ct];
}

export function jitterRgb(c: RGB, amt: number, rng: Rng): RGB {
  return [
    clamp(c[0] + (rng() - 0.5) * amt, 0, 255),
    clamp(c[1] + (rng() - 0.5) * amt, 0, 255),
    clamp(c[2] + (rng() - 0.5) * amt, 0, 255),
  ];
}

/**
 * Paints a soft, organic, FBM-roughened elliptical volume so base anatomical masses
 * NEVER have razor-sharp polygon edges sticking out past the feathers.
 */
export function paintOrganicVolume(
  pixels: Uint8ClampedArray,
  paper: PaperSubstrate,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angle: number,
  coreCol: RGB,
  edgeCol: RGB,
  opacity = 0.95,
  noiseScale = 0.015,
  noiseAmp = 0.25
) {
  const { width: W, height: H, tooth } = paper;
  const bound = Math.ceil(Math.max(rx, ry) * (1 + noiseAmp) + 6);
  const minX = Math.max(0, Math.floor(cx - bound));
  const maxX = Math.min(W - 1, Math.ceil(cx + bound));
  const minY = Math.max(0, Math.floor(cy - bound));
  const maxY = Math.min(H - 1, Math.ceil(cy + bound));

  const ca = Math.cos(-angle);
  const sa = Math.sin(-angle);
  const invRx = 1 / Math.max(1, rx);
  const invRy = 1 / Math.max(1, ry);

  for (let y = minY; y <= maxY; y++) {
    const dy = y - cy;
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const u = (dx * ca - dy * sa) * invRx;
      const v = (dx * sa + dy * ca) * invRy;
      const n = (fbm2D(x * noiseScale, y * noiseScale, 3, 733) - 0.5) * noiseAmp;
      const d = Math.hypot(u, v) + n;
      if (d >= 1.0) continue;

      const alpha = smoothstep(1.0, 0.52, d) * opacity;
      const col = mixRgb(coreCol, edgeCol, smoothstep(0.15, 0.9, d));
      const idx = y * W + x;
      const shade = (tooth[idx] - 0.5) * 12;
      paintPixelRGB(
        pixels,
        idx,
        clamp(col[0] + shade, 0, 255),
        clamp(col[1] + shade, 0, 255),
        clamp(col[2] + shade, 0, 255),
        alpha
      );
    }
  }
}

/**
 * Draws a fine tapered dry-media hair/barbule stroke (fast, crisp, anti-aliased, tooth-textured).
 */
export function drawFineHairStroke(
  pixels: Uint8ClampedArray,
  paper: PaperSubstrate,
  p0: Point2D,
  ctrl: Point2D,
  p1: Point2D,
  color: RGB,
  width0: number,
  width1: number,
  opacity: number
) {
  const { width: W, height: H, tooth } = paper;
  const [cr, cg, cb] = color;
  const len = Math.hypot(ctrl.x - p0.x, ctrl.y - p0.y) + Math.hypot(p1.x - ctrl.x, p1.y - ctrl.y);
  if (len < 0.8) return;

  const steps = Math.max(4, Math.ceil(len * 1.15));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;
    const cx = mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x;
    const cy = mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y;

    const r = lerp(width0, width1, t) * 0.5;
    const endFade = smoothstep(0.0, 0.14, t) * smoothstep(1.0, 0.78, t);
    const saBase = opacity * (0.25 + 0.75 * endFade);
    if (r < 0.25 || saBase <= 0.01) continue;

    const minX = Math.max(0, Math.floor(cx - r - 0.8));
    const maxX = Math.min(W - 1, Math.ceil(cx + r + 0.8));
    const minY = Math.max(0, Math.floor(cy - r - 0.8));
    const maxY = Math.min(H - 1, Math.ceil(cy + r + 0.8));

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dist = Math.hypot(dx, dy);
        if (dist > r + 0.75) continue;
        const cov = clamp(1 - (dist - (r - 0.3)) / 1.05, 0, 1);
        const idx = y * W + x;
        const grain = 0.82 + 0.18 * tooth[idx];
        paintPixelRGB(pixels, idx, cr, cg, cb, cov * saBase * grain);
      }
    }
  }
}

/**
 * Draws a tousled, organic, multi-strand feather lock (for Jatayu's iconic white-cream ruff & crest).
 * Instead of a cookie-cutter polygon triangle, it layers a soft shadow bed + 7–11 splayed,
 * curving fine barbule strands so locks feel fluffy, sunlit, and hand-painted.
 */
export function drawRuffPlumeLock(
  pixels: Uint8ClampedArray,
  paper: PaperSubstrate,
  bx: number,
  by: number,
  angle: number,
  length: number,
  spreadW: number,
  shadowCol: RGB,
  midCol: RGB,
  litCol: RGB,
  rng: Rng,
  bend = 0.16,
  strandCount = 9
) {
  const perpX = -Math.sin(angle);
  const perpY = Math.cos(angle);
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);

  // 1) Soft shadow under-tuft tucked beneath the lock
  const smx = bx + dirX * length * 0.45 + perpX * (bend * length * 0.18);
  const smy = by + dirY * length * 0.45 + perpY * (bend * length * 0.18);
  const sex = bx + dirX * length * 0.86 + perpX * (bend * length * 0.42);
  const sey = by + dirY * length * 0.86 + perpY * (bend * length * 0.42);
  drawFineHairStroke(pixels, paper, { x: bx, y: by }, { x: smx, y: smy }, { x: sex, y: sey }, shadowCol, spreadW * 0.85, spreadW * 0.25, 0.55);

  // 2) Bundled, slightly splayed individual fine feather strands forming a tousled pointed lock
  for (let i = 0; i < strandCount; i++) {
    const u = strandCount > 1 ? (i / (strandCount - 1)) * 2 - 1 : 0; // -1..+1 across lock
    const rootOff = u * spreadW * 0.34;
    const tipSplay = u * spreadW * (0.28 + rng() * 0.24);
    const sLen = length * (1 - Math.abs(u) * 0.22 + (rng() - 0.5) * 0.14);

    const sx = bx + perpX * rootOff;
    const sy = by + perpY * rootOff;
    const cx = sx + dirX * sLen * 0.52 + perpX * (bend * sLen * 0.28 + tipSplay * 0.45);
    const cy = sy + dirY * sLen * 0.52 + perpY * (bend * sLen * 0.28 + tipSplay * 0.45);
    const ex = sx + dirX * sLen + perpX * (bend * sLen * 0.65 + tipSplay);
    const ey = sy + dirY * sLen + perpY * (bend * sLen * 0.65 + tipSplay);

    const isOuterHighlight = Math.abs(u) < 0.55 && rng() < 0.72;
    const col = jitterRgb(isOuterHighlight ? litCol : midCol, 14, rng);
    drawFineHairStroke(
      pixels,
      paper,
      { x: sx, y: sy },
      { x: cx, y: cy },
      { x: ex, y: ey },
      col,
      2.3 + rng() * 1.1,
      0.7 + rng() * 0.5,
      isOuterHighlight ? 0.82 : 0.68
    );
  }
}

/**
 * Draws a rich shingled body/wing feather with dark espresso base, warm midtone vane,
 * finely striated barbs, and a bright sunlit cream/buff rim (for forearm, chest & wings).
 */
export function drawShingledFeather(
  pixels: Uint8ClampedArray,
  paper: PaperSubstrate,
  bx: number,
  by: number,
  angle: number,
  length: number,
  width: number,
  darkCol: RGB,
  midCol: RGB,
  rimCol: RGB,
  rng: Rng,
  bend = 0.08
) {
  const { width: W, height: H, tooth } = paper;
  const mx = bx + Math.cos(angle + bend * 0.5) * length * 0.52;
  const my = by + Math.sin(angle + bend * 0.5) * length * 0.52;
  const ex = bx + Math.cos(angle + bend) * length;
  const ey = by + Math.sin(angle + bend) * length;

  const pad = width * 0.8 + 4;
  const minX = Math.max(0, Math.floor(Math.min(bx, mx, ex) - pad));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(bx, mx, ex) + pad));
  const minY = Math.max(0, Math.floor(Math.min(by, my, ey) - pad));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(by, my, ey) + pad));

  const ca = Math.cos(-angle);
  const sa = Math.sin(-angle);
  const halfW = width * 0.5;
  const invLen = 1 / Math.max(4, length);

  for (let y = minY; y <= maxY; y++) {
    const dy = y - by;
    for (let x = minX; x <= maxX; x++) {
      const dx = x - bx;
      const u = dx * ca - dy * sa;
      const t = u * invLen;
      if (t < -0.04 || t > 1.03) continue;

      const ct = clamp(t, 0, 1);
      const curveV = Math.sin(ct * Math.PI) * (bend * length * 0.24);
      const vRaw = dx * sa + dy * ca - curveV;

      // Broad organic feather vane with slightly notched/fringed outer edge
      const profile = Math.pow(Math.sin(ct * Math.PI), 0.52) * (1 - ct * 0.22);
      const curHalfW = halfW * profile;
      if (curHalfW < 0.6) continue;

      const distNorm = Math.abs(vRaw) / curHalfW;
      const barbRipple = Math.sin(u * 0.72 - Math.abs(vRaw) * 0.55);
      if (distNorm > 1.05 + barbRipple * 0.08) continue;

      const edgeAlpha = smoothstep(1.05 + barbRipple * 0.08, 0.58, distNorm);
      if (edgeAlpha <= 0.02) continue;

      // Dark base fading into midtone, with crisp sunlit rim around distal edges
      let col = mixRgb(darkCol, midCol, smoothstep(0.18, 0.68, ct));
      const rimMask = Math.max(smoothstep(0.55, 0.94, ct), smoothstep(0.62, 0.96, distNorm) * smoothstep(0.2, 0.55, ct));
      col = mixRgb(col, rimCol, rimMask * 0.88);

      // Central rachis highlight & fine barb striations
      const quill = Math.exp(-Math.pow(vRaw / Math.max(0.8, width * 0.06), 2)) * (1 - ct * 0.3);
      col = mixRgb(col, rimCol, quill * 0.45);

      const idx = y * W + x;
      const tex = (tooth[idx] - 0.5) * 14 + barbRipple * 7;
      paintPixelRGB(
        pixels,
        idx,
        clamp(col[0] + tex, 0, 255),
        clamp(col[1] + tex, 0, 255),
        clamp(col[2] + tex, 0, 255),
        edgeAlpha * 0.94
      );
    }
  }
}
