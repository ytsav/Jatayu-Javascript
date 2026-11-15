import { RGB } from './palette';
import { PaperSubstrate } from './paper';
import { clamp, hash2D, lerp, Point2D, Rng, smoothstep } from './rng';

export interface DryStrokeOpts {
  width?: number;
  opacity?: number;
  /** 0 = smooth painterly, 1 = strong paper-tooth & dry chalk grain */
  grain?: number;
  /** 0 = blunt ends, 1 = sharp pointed taper */
  taper?: number;
  /** Per-step organic wrist wobble amplitude in px */
  wobble?: number;
}

export function paintPixelRGB(
  pixels: Uint8ClampedArray,
  idx: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number
) {
  if (sa <= 0.004) return;
  const p4 = idx * 4;
  if (sa >= 0.996) {
    pixels[p4] = sr;
    pixels[p4 + 1] = sg;
    pixels[p4 + 2] = sb;
    pixels[p4 + 3] = 255;
    return;
  }
  const inv = 1 - sa;
  pixels[p4] = sr * sa + pixels[p4] * inv;
  pixels[p4 + 1] = sg * sa + pixels[p4 + 1] * inv;
  pixels[p4 + 2] = sb * sa + pixels[p4 + 2] * inv;
  pixels[p4 + 3] = 255;
}

/**
 * Fills a closed polygon with continuous velvety dry-media pigment modulated gently by cotton tooth.
 * Ensures solid forms (beak, talons, wings, beams) never leak background sky through them.
 */
export function fillPaintedPolygon(
  pixels: Uint8ClampedArray,
  paper: PaperSubstrate,
  poly: Point2D[],
  color: RGB,
  opacity = 1.0,
  toothAmp = 10
) {
  if (poly.length < 3) return;
  const { width: W, height: H, tooth } = paper;
  let minY = H;
  let maxY = 0;
  for (const p of poly) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(H - 1, Math.ceil(maxY));
  const [cr, cg, cb] = color;

  for (let y = yStart; y <= yEnd; y++) {
    const xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const yi = poly[i].y;
      const yj = poly[j].y;
      if ((yi <= y && yj > y) || (yj <= y && yi > y)) {
        const xi = poly[i].x;
        const xj = poly[j].x;
        xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) {
        const idx = y * W + x;
        const shade = (tooth[idx] - 0.5) * toothAmp;
        paintPixelRGB(
          pixels,
          idx,
          clamp(cr + shade, 0, 255),
          clamp(cg + shade, 0, 255),
          clamp(cb + shade, 0, 255),
          opacity
        );
      }
    }
  }
}

/**
 * Draws a continuous, velvety dry-media stroke using overlapping soft circular stamps
 * (zero comb/caterpillar rib artifacts) modulated by cold-pressed paper tooth.
 */
export function drawDryStickStroke(
  pixels: Uint8ClampedArray,
  paper: PaperSubstrate,
  p0: Point2D,
  ctrl: Point2D,
  p1: Point2D,
  color: RGB,
  rng: Rng,
  opts: DryStrokeOpts = {}
) {
  const {
    width: strokeW = 10,
    opacity = 0.65,
    grain = 0.45,
    taper = 0.4,
    wobble = 0.65,
  } = opts;

  const { width: W, height: H, tooth } = paper;
  const [cr, cg, cb] = color;

  const approxLen =
    Math.hypot(ctrl.x - p0.x, ctrl.y - p0.y) + Math.hypot(p1.x - ctrl.x, p1.y - ctrl.y);
  if (approxLen < 0.6) return;

  // Tight step spacing proportional to stroke width -> smooth continuous overlap, zero gaps
  const stepDist = Math.max(0.65, Math.min(3.0, strokeW * 0.22));
  const steps = Math.max(3, Math.ceil(approxLen / stepDist));
  const phase = rng() * 50;
  const halfBase = Math.max(0.6, strokeW * 0.5);

  // Track max deposit per pixel within this stroke to prevent uneven over-darkening at slow curves
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;

    const bx = mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x;
    const by = mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y;

    let tx = 2 * mt * (ctrl.x - p0.x) + 2 * t * (p1.x - ctrl.x);
    let ty = 2 * mt * (ctrl.y - p0.y) + 2 * t * (p1.y - ctrl.y);
    const tLen = Math.hypot(tx, ty) || 1;
    tx /= tLen;
    ty /= tLen;
    const nx = -ty;
    const ny = tx;

    const tremor =
      wobble > 0
        ? (Math.sin(t * 14 + phase) * 0.6 + Math.cos(t * 31 + phase * 1.4) * 0.4) * wobble
        : 0;
    const cx = bx + nx * tremor;
    const cy = by + ny * tremor;

    const endCurve = Math.sin(t * Math.PI);
    const r = halfBase * (taper > 0 ? lerp(1 - taper * 0.88, 1.0, Math.pow(endCurve, 0.55)) : 1);
    if (r < 0.35) continue;

    const alphaEnd = lerp(0.45, 1.0, Math.pow(endCurve, 0.35));
    const minX = Math.max(0, Math.floor(cx - r - 1));
    const maxX = Math.min(W - 1, Math.ceil(cx + r + 1));
    const minY = Math.max(0, Math.floor(cy - r - 1));
    const maxY = Math.min(H - 1, Math.ceil(cy + r + 1));
    const invR = 1 / Math.max(0.75, r);

    // Per-step blend scaled by overlap ratio so overlapping stamps stay smooth & velvety
    const stepBlend = clamp((stepDist / Math.max(1.2, r * 1.3)) * opacity * alphaEnd * 1.15, 0.04, opacity);

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const d = Math.hypot(dx, dy) * invR;
        if (d >= 1) continue;

        const falloff = smoothstep(1, 0.15, d);
        const idx = y * W + x;
        const h = tooth[idx];
        const grainMod = lerp(1, smoothstep(0.15, 0.85, h + hash2D(x, y, 419) * 0.14), grain * 0.72);
        const sa = falloff * grainMod * stepBlend;
        if (sa > 0.008) {
          paintPixelRGB(pixels, idx, cr, cg, cb, sa);
        }
      }
    }
  }
}

/**
 * Draws a sculpted, tapered painterly feather blade (dark under-shadow, broad body,
 * central quill highlight, and delicate dry-brush edge softness).
 */
export function drawSculptedFeather(
  pixels: Uint8ClampedArray,
  paper: PaperSubstrate,
  bx: number,
  by: number,
  angle: number,
  length: number,
  width: number,
  shadowCol: RGB,
  bodyCol: RGB,
  highlightCol: RGB,
  rng: Rng,
  bend = 0.08
) {
  const { width: W, height: H, tooth } = paper;
  const mx = bx + Math.cos(angle + bend * 0.5) * length * 0.52;
  const my = by + Math.sin(angle + bend * 0.5) * length * 0.52;
  const ex = bx + Math.cos(angle + bend) * length;
  const ey = by + Math.sin(angle + bend) * length;

  // Bounding box around quadratic feather spline
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
      // Rotate into feather local space: u along shaft [0..length], v across width
      const u = dx * ca - dy * sa;
      const t = u * invLen;
      if (t < -0.05 || t > 1.04) continue;

      const ct = clamp(t, 0, 1);
      // Curved centerline offset along v
      const centerCurveV = Math.sin(ct * Math.PI) * (bend * length * 0.25);
      const vRaw = dx * sa + dy * ca - centerCurveV;

      // Lanceolate feather width profile (full mid-belly, pointed tip)
      const profile = Math.pow(Math.sin(ct * Math.PI), 0.62) * (1 - ct * 0.28);
      const curHalfW = halfW * profile;
      if (curHalfW < 0.5) continue;

      const distNorm = Math.abs(vRaw) / curHalfW;
      if (distNorm >= 1.15) continue;

      const idx = y * W + x;
      const h = tooth[idx];
      // Barbule serration & dry paper edge breakup
      const barbNoise = Math.sin(u * 0.85 - Math.abs(vRaw) * 0.65) * 0.14 + (h - 0.5) * 0.22;
      const edgeMask = smoothstep(1.08, 0.42, distNorm + barbNoise * 0.45);
      if (edgeMask <= 0.02) continue;

      // Shade across feather: dark shadow base/underside -> body -> sunlit tip & quill
      let col: RGB;
      const tipMix = smoothstep(0.32, 0.92, ct);
      if (ct < 0.28 || vRaw > curHalfW * 0.25) {
        col = [
          lerp(shadowCol[0], bodyCol[0], smoothstep(0.0, 0.45, ct)),
          lerp(shadowCol[1], bodyCol[1], smoothstep(0.0, 0.45, ct)),
          lerp(shadowCol[2], bodyCol[2], smoothstep(0.0, 0.45, ct)),
        ];
      } else {
        col = [
          lerp(bodyCol[0], highlightCol[0], tipMix),
          lerp(bodyCol[1], highlightCol[1], tipMix),
          lerp(bodyCol[2], highlightCol[2], tipMix),
        ];
      }

      // Fine bright central rachis (quill) & barb texture
      const quill = Math.exp(-Math.pow(vRaw / Math.max(0.8, width * 0.07), 2)) * (1 - ct * 0.45);
      const barbTex = (h - 0.5) * 16 + Math.sin(u * 0.9 - Math.abs(vRaw) * 0.7) * 7;

      const fr = clamp(lerp(col[0], highlightCol[0], quill * 0.55) + barbTex, 0, 255);
      const fg = clamp(lerp(col[1], highlightCol[1], quill * 0.55) + barbTex, 0, 255);
      const fb = clamp(lerp(col[2], highlightCol[2], quill * 0.55) + barbTex, 0, 255);

      paintPixelRGB(pixels, idx, fr, fg, fb, edgeMask * 0.94);
    }
  }

  // Crisp subtle ink/charcoal shaft accent on select feathers for hand-drawn definition
  if (rng() < 0.45) {
    drawDryStickStroke(
      pixels,
      paper,
      { x: bx + Math.cos(angle) * length * 0.15, y: by + Math.sin(angle) * length * 0.15 },
      { x: mx, y: my },
      { x: ex, y: ey },
      shadowCol,
      rng,
      { width: Math.max(1.1, width * 0.08), opacity: 0.35, grain: 0.3, taper: 0.8, wobble: 0.25 }
    );
  }
}

export function drawSoftGlow(
  pixels: Uint8ClampedArray,
  paper: PaperSubstrate,
  cx: number,
  cy: number,
  radius: number,
  color: RGB,
  opacity: number
) {
  const { width: W, height: H, tooth } = paper;
  const [cr, cg, cb] = color;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(W - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(H - 1, Math.ceil(cy + radius));
  const invR = 1 / radius;

  for (let y = minY; y <= maxY; y++) {
    const dy = y - cy;
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const d = Math.hypot(dx, dy) * invR;
      if (d >= 1) continue;
      const idx = y * W + x;
      const falloff = Math.pow(1 - d, 2.0);
      const toothMod = 0.9 + 0.1 * tooth[idx];
      paintPixelRGB(pixels, idx, cr, cg, cb, falloff * opacity * toothMod);
    }
  }
}

export function drawHandStar(
  pixels: Uint8ClampedArray,
  paper: PaperSubstrate,
  cx: number,
  cy: number,
  size: number,
  color: RGB,
  rng: Rng,
  opacity = 0.85
) {
  drawSoftGlow(pixels, paper, cx, cy, size * 0.9, [254, 224, 150], opacity * 0.28);
  const tilt = (rng() - 0.5) * 0.08;
  const rays = [
    { a: tilt, l: size },
    { a: Math.PI + tilt, l: size },
    { a: Math.PI * 0.5 + tilt, l: size * 0.85 },
    { a: -Math.PI * 0.5 + tilt, l: size * 0.85 },
  ];
  for (const r of rays) {
    const ex = cx + Math.cos(r.a) * r.l;
    const ey = cy + Math.sin(r.a) * r.l;
    drawDryStickStroke(
      pixels,
      paper,
      { x: cx, y: cy },
      { x: lerp(cx, ex, 0.5), y: lerp(cy, ey, 0.5) },
      { x: ex, y: ey },
      color,
      rng,
      { width: Math.max(1.4, size * 0.15), opacity, grain: 0.2, taper: 0.95, wobble: 0.2 }
    );
  }
  drawSoftGlow(pixels, paper, cx, cy, Math.max(2, size * 0.18), [255, 252, 240], opacity * 0.9);
}
