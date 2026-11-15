import { drawFineHairStroke, jitterRgb, mixRgb } from './featherEngine';
import { paintPixelRGB } from './dryBrush';
import { RGB } from './palette';
import { PaperSubstrate } from './paper';
import { clamp, fbm2D, humanBezier, lerp, Point2D, Rng, smoothstep } from './rng';

const PAL = {
  charcoal: [18, 15, 17] as RGB,
  espresso: [38, 26, 20] as RGB,
  umber: [78, 56, 42] as RGB,
  warmTaupe: [138, 112, 86] as RGB,
  peachTan: [204, 154, 108] as RGB,
  buff: [218, 190, 154] as RGB,
  cream: [244, 232, 210] as RGB,
  ivory: [254, 249, 240] as RGB,

  beakDark: [34, 31, 36] as RGB,
  beakSlate: [62, 56, 60] as RGB,
  beakAmber: [176, 112, 42] as RGB,
  beakGlow: [238, 184, 92] as RGB,

  talonShadow: [34, 28, 24] as RGB,
  talonMid: [118, 100, 78] as RGB,
  talonLight: [186, 166, 136] as RGB,
  clawBlack: [15, 13, 17] as RGB,
  clawSheen: [186, 200, 216] as RGB,
};

// Light from upper-left front
const LX = -0.52;
const LY = -0.58;
const LZ = 0.63;

interface CapsuleSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  ra: number;
  rb: number;
  jointBulge?: number;
}

function evalTaperedCapsule(px: number, py: number, cap: CapsuleSegment) {
  const vx = cap.bx - cap.ax;
  const vy = cap.by - cap.ay;
  const len2 = vx * vx + vy * vy || 1;
  const t = clamp(((px - cap.ax) * vx + (py - cap.ay) * vy) / len2, 0, 1);
  const cx = cap.ax + vx * t;
  const cy = cap.ay + vy * t;
  const dx = px - cx;
  const dy = py - cy;
  const dist = Math.hypot(dx, dy);

  let r = lerp(cap.ra, cap.rb, t);
  if (cap.jointBulge) {
    r += Math.sin(t * Math.PI * 2.0) * cap.jointBulge;
  }
  const inside = 1 - dist / Math.max(1, r);
  const invD = dist > 0.001 ? 1 / dist : 0;
  return { inside, t, nx: dx * invD, ny: dy * invD };
}

/** Converts a Bezier curve into a smooth chain of capsule segments (eliminates sharp angular elbows). */
function bezierToCapsules(
  p0: Point2D,
  c1: Point2D,
  c2: Point2D,
  p1: Point2D,
  rStart: number,
  rEnd: number,
  segments = 14,
  rng: Rng,
  knuckleEvery = 0
): CapsuleSegment[] {
  const pts = humanBezier(p0, c1, c2, p1, rng, 0.25, segments);
  const caps: CapsuleSegment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const t0 = i / (pts.length - 1);
    const t1 = (i + 1) / (pts.length - 1);
    let r0 = lerp(rStart, rEnd, Math.pow(t0, 0.85));
    let r1 = lerp(rStart, rEnd, Math.pow(t1, 0.85));
    if (knuckleEvery > 0) {
      r0 += Math.sin(t0 * Math.PI * knuckleEvery) * 2.2;
      r1 += Math.sin(t1 * Math.PI * knuckleEvery) * 2.2;
    }
    caps.push({
      ax: pts[i].x,
      ay: pts[i].y,
      bx: pts[i + 1].x,
      by: pts[i + 1].y,
      ra: Math.max(1.2, r0),
      rb: Math.max(1.2, r1),
    });
  }
  return caps;
}

/**
 * Draws a soft, broad, organically contoured barred feather (for forearm, chest & folded wings)
 * with curved silhouette, dark espresso interior, warm sunlit outer rim, and subtle barb texture.
 */
function drawBroadLayeredFeather(
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
  bend: number,
  opacity = 0.94
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
      const curveV = Math.sin(ct * Math.PI) * (bend * length * 0.22);
      const vRaw = dx * sa + dy * ca - curveV;

      const profile = Math.pow(Math.sin(ct * Math.PI), 0.45) * (1 - ct * 0.14);
      const curHalfW = halfW * profile;
      if (curHalfW < 0.7) continue;

      const distNorm = Math.abs(vRaw) / curHalfW;
      const barbRipple = Math.sin(u * 0.62 - Math.abs(vRaw) * 0.48);
      if (distNorm > 1.05 + barbRipple * 0.08) continue;

      const edgeAlpha = smoothstep(1.05 + barbRipple * 0.08, 0.55, distNorm);
      if (edgeAlpha <= 0.02) continue;

      let col = mixRgb(darkCol, midCol, smoothstep(0.2, 0.72, ct));
      const rimFactor = Math.max(
        smoothstep(0.56, 0.92, ct),
        smoothstep(0.6, 0.94, distNorm) * smoothstep(0.18, 0.52, ct)
      );
      col = mixRgb(col, rimCol, rimFactor * 0.9);

      const quill = Math.exp(-Math.pow(vRaw / Math.max(0.8, width * 0.065), 2)) * (1 - ct * 0.25);
      col = mixRgb(col, rimCol, quill * 0.35);

      const idx = y * W + x;
      const tex = (tooth[idx] - 0.5) * 12 + barbRipple * 6;
      paintPixelRGB(
        pixels,
        idx,
        clamp(col[0] + tex, 0, 255),
        clamp(col[1] + tex, 0, 255),
        clamp(col[2] + tex, 0, 255),
        edgeAlpha * opacity
      );
    }
  }
}

/**
 * Draws a soft, downy, subtly fringed ruff plume (rounded/tufted tip, warm shadowed base,
 * sunlit cream/ivory distal barbs) so Jatayu's collar feels lush and feathered rather than spiky.
 */
function drawSoftRuffPlume(
  pixels: Uint8ClampedArray,
  paper: PaperSubstrate,
  bx: number,
  by: number,
  angle: number,
  length: number,
  width: number,
  shadowCol: RGB,
  midCol: RGB,
  litCol: RGB,
  bend: number,
  seed: number,
  opacity = 0.9
) {
  const { width: W, height: H, tooth } = paper;
  const mx = bx + Math.cos(angle + bend * 0.5) * length * 0.52;
  const my = by + Math.sin(angle + bend * 0.5) * length * 0.52;
  const ex = bx + Math.cos(angle + bend) * length;
  const ey = by + Math.sin(angle + bend) * length;

  const pad = width * 0.85 + 6;
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
      if (t < -0.05 || t > 1.06) continue;

      const ct = clamp(t, 0, 1);
      const curveV = Math.sin(ct * Math.PI) * (bend * length * 0.28);
      const vRaw = dx * sa + dy * ca - curveV;

      // Full, softly rounded plume silhouette (not a needle!)
      const profile = Math.pow(Math.sin(ct * Math.PI), 0.4) * (1 - ct * 0.08);
      const curHalfW = halfW * profile;
      if (curHalfW < 0.8) continue;

      const distNorm = Math.abs(vRaw) / curHalfW;
      // Soft downy fringe breakup at the distal tip & outer edges
      const barbRipple = Math.sin(vRaw * 0.85 + seed) * smoothstep(0.42, 0.96, ct) * 0.16;
      const tipSoft = ct > 0.72 ? Math.sin((vRaw / Math.max(1, curHalfW)) * 9.0 + seed) * 0.12 * smoothstep(0.72, 1.0, ct) : 0;
      const limit = 1.04 + barbRipple + tipSoft;
      if (distNorm > limit) continue;

      const edgeAlpha = smoothstep(limit, 0.42, distNorm);
      if (edgeAlpha <= 0.02) continue;

      // Shadowed root tucked under previous layer -> buff mid -> sunlit ivory tip
      let col = mixRgb(shadowCol, midCol, smoothstep(0.08, 0.52, ct));
      const litMask = smoothstep(0.36, 0.88, ct) * (1 - distNorm * 0.25);
      col = mixRgb(col, litCol, litMask * 0.92);

      // Delicate cream central shaft
      const quill = Math.exp(-Math.pow(vRaw / Math.max(0.7, width * 0.06), 2)) * (1 - ct * 0.35);
      col = mixRgb(col, litCol, quill * 0.38);

      const idx = y * W + x;
      const tex = (tooth[idx] - 0.5) * 11 + barbRipple * 18;
      paintPixelRGB(
        pixels,
        idx,
        clamp(col[0] + tex, 0, 255),
        clamp(col[1] + tex, 0, 255),
        clamp(col[2] + tex, 0, 255),
        edgeAlpha * opacity
      );
    }
  }
}

/**
 * Renders Jatayu with proper depth layering:
 *   1. Back Wings (right folded wing + left covert wing)
 *   2. Main Diagonal Cedar Beam
 *   3. Rear Gripping Foot
 *   4. Chest & Lunging Forearm (broad layered barred feathers)
 *   5. Lush Rounded Eagle Ruff & Shoulder Mantle (shingled soft downy plumes)
 *   6. Bold Fierce Head, Hooded Brows, Deep-set Eyes & 3D Hooked Beak
 *   7. Colossal Reaching Front Talon & Smooth Curved Sickle Claws
 */
export function renderJatayuSculpted(
  pixels: Uint8ClampedArray,
  paper: PaperSubstrate,
  rng: Rng,
  drawCedarBeamPass: () => void
) {
  const { width: W, height: H, tooth } = paper;

  // =========================================================================
  // 1. BACK FOLDED RIGHT WING & LEFT UNDER-WING COVERTS
  // =========================================================================
  const rightWingCaps: CapsuleSegment[] = [
    { ax: 1385, ay: 295, bx: 1585, by: 425, ra: 105, rb: 122 },
    { ax: 1565, ay: 405, bx: 1645, by: 710, ra: 122, rb: 68 },
    { ax: 1410, ay: 430, bx: 1515, by: 745, ra: 112, rb: 62 },
  ];
  const leftUnderWingCaps: CapsuleSegment[] = [
    { ax: 765, ay: 345, bx: 895, by: 465, ra: 98, rb: 82 },
    { ax: 705, ay: 365, bx: 790, by: 495, ra: 68, rb: 52 },
  ];

  const wingFeathers: Array<{ x: number; y: number; ang: number; len: number; w: number; rim: RGB }> = [];

  for (let y = 140; y < 820; y++) {
    for (let x = 600; x < 1755; x++) {
      let wingIn = -1;
      let wNx = 0;
      let wNy = 0;
      for (const c of [...leftUnderWingCaps, ...rightWingCaps]) {
        const res = evalTaperedCapsule(x, y, c);
        if (res.inside > wingIn) {
          wingIn = res.inside;
          wNx = res.nx;
          wNy = res.ny;
        }
      }
      const isLeft = x < 980;
      const wAng = isLeft ? 2.02 : 1.38;
      const wu = x * Math.cos(wAng) + y * Math.sin(wAng);
      const wv = -x * Math.sin(wAng) + y * Math.cos(wAng);
      const edgeN = (fbm2D(wu * 0.014, wv * 0.045, 3, 911) - 0.5) * 0.22;
      const mask = smoothstep(0.0, 0.14, wingIn + edgeN);
      if (mask <= 0.02) continue;

      const nz = Math.sqrt(Math.max(0.05, 1 - Math.pow(1 - clamp(wingIn, 0, 1), 2)));
      const ndl = clamp(wNx * LX + wNy * LY + nz * LZ, 0, 1);
      const clump = fbm2D(wu * 0.02, wv * 0.055, 3, 619);
      const lit = clamp(ndl * 0.72 + clump * 0.35, 0, 1);

      let col = mixRgb(PAL.charcoal, PAL.espresso, smoothstep(0.2, 0.6, lit));
      col = mixRgb(col, PAL.umber, smoothstep(0.55, 0.9, lit));
      const idx = y * W + x;
      const shade = (tooth[idx] - 0.5) * 10;
      paintPixelRGB(pixels, idx, clamp(col[0] + shade, 0, 255), clamp(col[1] + shade, 0, 255), clamp(col[2] + shade, 0, 255), mask);

      if (mask > 0.35 && rng() < 0.0028) {
        wingFeathers.push({
          x,
          y,
          ang: wAng + (rng() - 0.5) * 0.22,
          len: 54 + rng() * 44,
          w: 22 + rng() * 12,
          rim: isLeft ? PAL.buff : x > 1540 && y < 480 ? PAL.warmTaupe : PAL.umber,
        });
      }
    }
  }

  for (const wf of wingFeathers) {
    drawBroadLayeredFeather(
      pixels,
      paper,
      wf.x,
      wf.y,
      wf.ang,
      wf.len,
      wf.w,
      PAL.charcoal,
      PAL.espresso,
      wf.rim,
      (rng() - 0.5) * 0.12,
      0.88
    );
  }

  // =========================================================================
  // 2. MAIN DIAGONAL CEDAR BEAM
  // =========================================================================
  drawCedarBeamPass();

  // =========================================================================
  // 3. SCULPTED REPTILIAN TALON & WORLEY SCALE ENGINE
  // =========================================================================
  const hash2D = (ix: number, iy: number, seed: number) => {
    let n = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };

  // True 3D Worley/Voronoi cellular scale geometry (recessed crevices + tilted beveled scale domes!)
  const worleyScales = (px: number, py: number, freq: number, seed: number) => {
    const x = px * freq;
    const y = py * freq;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let d1 = 99;
    let d2 = 99;
    let bestDx = 0;
    let bestDy = 0;

    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = ix + ox;
        const cy = iy + oy;
        const jx = cx + 0.14 + 0.72 * hash2D(cx, cy, seed);
        const jy = cy + 0.14 + 0.72 * hash2D(cx, cy, seed + 97);
        const dx = x - jx;
        const dy = y - jy;
        const d = Math.hypot(dx, dy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          bestDx = dx;
          bestDy = dy;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
    const edge = smoothstep(0.01, 0.22, d2 - d1);
    const invD = d1 > 0.001 ? 1 / d1 : 0;
    return {
      edge,
      dome: clamp(1 - d1 * 1.45, 0, 1),
      bumpNx: bestDx * invD,
      bumpNy: bestDy * invD,
    };
  };

  interface BezierTubeSpec {
    p0: Point2D;
    c1: Point2D;
    c2: Point2D;
    p1: Point2D;
    rStart: number;
    rEnd: number;
    knuckFreq?: number;
    scuteCount?: number;
    sheathEnd?: boolean;
  }
  interface SculptedToeSpec {
    toe: BezierTubeSpec;
    claw: BezierTubeSpec;
  }

  interface SampledTube {
    bx: Float32Array;
    by: Float32Array;
    tx: Float32Array;
    ty: Float32Array;
    rx: Float32Array;
    samples: number;
  }

  const sampleBezierTube = (spec: BezierTubeSpec, samples = 160, isClaw = false): SampledTube => {
    const bx = new Float32Array(samples + 1);
    const by = new Float32Array(samples + 1);
    const tx = new Float32Array(samples + 1);
    const ty = new Float32Array(samples + 1);
    const rx = new Float32Array(samples + 1);

    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const mt = 1 - t;
      bx[i] = mt * mt * mt * spec.p0.x + 3 * mt * mt * t * spec.c1.x + 3 * mt * t * t * spec.c2.x + t * t * t * spec.p1.x;
      by[i] = mt * mt * mt * spec.p0.y + 3 * mt * mt * t * spec.c1.y + 3 * mt * t * t * spec.c2.y + t * t * t * spec.p1.y;

      const dxdt = 3 * mt * mt * (spec.c1.x - spec.p0.x) + 6 * mt * t * (spec.c2.x - spec.c1.x) + 3 * t * t * (spec.p1.x - spec.c2.x);
      const dydt = 3 * mt * mt * (spec.c1.y - spec.p0.y) + 6 * mt * t * (spec.c2.y - spec.c1.y) + 3 * t * t * (spec.p1.y - spec.c2.y);
      const tLen = Math.hypot(dxdt, dydt) || 1;
      tx[i] = dxdt / tLen;
      ty[i] = dydt / tLen;

      if (isClaw) {
        rx[i] = lerp(spec.rStart, spec.rEnd, Math.pow(t, 0.76));
      } else {
        // Phalanx joint swellings tapering neatly down into the claw sheath collar
        let r = lerp(spec.rStart, spec.rEnd, Math.pow(t, 0.72));
        if (spec.knuckFreq) {
          r += Math.sin(t * Math.PI * spec.knuckFreq) * (spec.rEnd * 0.14);
        }
        if (spec.sheathEnd) {
          r += Math.exp(-Math.pow((t - 0.76) / 0.14, 2)) * (spec.rEnd * 0.16);
        }
        rx[i] = Math.max(2.0, r);
      }
    }
    return { bx, by, tx, ty, rx, samples };
  };

  const evalSampledTube = (px: number, py: number, tube: SampledTube) => {
    let bestD2 = 1e9;
    let bestI = 0;
    for (let i = 0; i <= tube.samples; i++) {
      const dx = px - tube.bx[i];
      const dy = py - tube.by[i];
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestI = i;
      }
    }

    let bestSegF = bestI;
    let minSegD2 = bestD2;
    const iStart = Math.max(0, bestI - 1);
    const iEnd = Math.min(tube.samples - 1, bestI);
    for (let i = iStart; i <= iEnd; i++) {
      const ax = tube.bx[i];
      const ay = tube.by[i];
      const vx = tube.bx[i + 1] - ax;
      const vy = tube.by[i + 1] - ay;
      const vLen2 = vx * vx + vy * vy || 1;
      const f = clamp(((px - ax) * vx + (py - ay) * vy) / vLen2, 0, 1);
      const cx = ax + vx * f;
      const cy = ay + vy * f;
      const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d2 < minSegD2) {
        minSegD2 = d2;
        bestSegF = i + f;
      }
    }

    const i0 = Math.min(tube.samples - 1, Math.floor(bestSegF));
    const frac = bestSegF - i0;
    const cx = lerp(tube.bx[i0], tube.bx[i0 + 1], frac);
    const cy = lerp(tube.by[i0], tube.by[i0 + 1], frac);
    let ux = lerp(tube.tx[i0], tube.tx[i0 + 1], frac);
    let uy = lerp(tube.ty[i0], tube.ty[i0 + 1], frac);
    const uLen = Math.hypot(ux, uy) || 1;
    ux /= uLen;
    uy /= uLen;
    const r = lerp(tube.rx[i0], tube.rx[i0 + 1], frac);

    const dx = px - cx;
    const dy = py - cy;
    const s = dx * -uy + dy * ux;
    const along = dx * ux + dy * uy;
    const endAlong = bestSegF <= 0.001 ? Math.min(0, along) : bestSegF >= tube.samples - 0.001 ? Math.max(0, along) : 0;
    const effDist = Math.hypot(s, endAlong);
    const normD = effDist / r;
    const invD = effDist > 0.001 ? 1 / effDist : 0;
    return {
      normD,
      t: bestSegF / tube.samples,
      sNorm: clamp(s / r, -1, 1),
      nx: (dx * invD) || 0,
      ny: (dy * invD) || 0,
    };
  };

  const drawSculptedFoot = (
    palmCenter: Point2D,
    palmRx: number,
    palmRy: number,
    palmTilt: number,
    toes: SculptedToeSpec[],
    isRear: boolean
  ) => {
    const sampledToes = toes.map((item) => ({
      toeSpec: item.toe,
      toeTube: sampleBezierTube(item.toe, 160, false),
      clawTube: sampleBezierTube(item.claw, 170, true),
    }));

    const cosP = Math.cos(palmTilt);
    const sinP = Math.sin(palmTilt);

    const paintScalySkin = (
      x: number,
      y: number,
      normD: number,
      nx: number,
      ny: number,
      tAlong: number,
      sNorm: number,
      scuteCount: number,
      alphaOverride = 1.0
    ) => {
      const idx = y * W + x;
      const alpha = smoothstep(1.03, 0.85, normD) * alphaOverride;
      if (alpha <= 0.01) return;

      const nz = Math.sqrt(Math.max(0.05, 1 - clamp(normD * normD, 0, 0.95)));
      const warpX = x + (fbm2D(x * 0.07, y * 0.07, 2, 409) - 0.5) * 4.0;
      const warpY = y + (fbm2D(x * 0.07 + 37, y * 0.07 + 13, 2, 709) - 0.5) * 4.0;

      // Real 3D Worley scale tiles (larger scutes along top ridge, fine pebble skin on palm/sides)
      const coarseScale = worleyScales(warpX, warpY, isRear ? 0.14 : 0.125, 311);
      const fineScale = worleyScales(warpX, warpY, 0.25, 757);

      // Transverse overlapping scute plates along the upper/front side of toes
      let scutePlate = 0;
      let scuteGroove = 0;
      if (scuteCount > 0) {
        const phase = tAlong * scuteCount + (1 - sNorm * sNorm) * 0.32 + (coarseScale.dome - 0.5) * 0.35;
        const frac = phase - Math.floor(phase);
        const topZone = smoothstep(0.85, 0.1, Math.abs(sNorm));
        scutePlate = smoothstep(0.14, 0.72, frac) * smoothstep(0.98, 0.76, frac) * topZone;
        scuteGroove = Math.exp(-Math.pow((frac - 0.06) / 0.1, 2)) * topZone;
      }

      // Wrinkled leather skin folds around joints
      const wrinkleNoise = fbm2D(warpX * 0.16, warpY * 0.16, 2, 521);
      const jointPinch = scuteCount > 0 ? Math.exp(-Math.pow((tAlong - 0.48) / 0.07, 2)) * 0.36 : 0;

      // Tilt pixel normal by individual scale dome normal for genuine 3D bumpy reptile skin!
      const sNx = clamp(nx + coarseScale.bumpNx * 0.34 + fineScale.bumpNx * 0.18, -1, 1);
      const sNy = clamp(ny + coarseScale.bumpNy * 0.34 + fineScale.bumpNy * 0.18, -1, 1);
      const ndl = clamp(sNx * LX + sNy * LY + nz * LZ, 0, 1);

      const scaleShadow = Math.max(1 - coarseScale.edge, (1 - fineScale.edge) * 0.65);
      const litBump = clamp(
        ndl * 0.8 + coarseScale.dome * 0.22 + scutePlate * (isRear ? 0.32 : 0.22) + (wrinkleNoise - 0.5) * 0.14 - scuteGroove * 0.24 - jointPinch,
        0,
        1
      );

      let col = isRear
        ? mixRgb([15, 11, 9], [86, 67, 49], smoothstep(0.16, 0.84, litBump))
        : mixRgb([24, 17, 12], [118, 86, 56], smoothstep(0.12, 0.56, litBump));

      if (!isRear) {
        col = mixRgb(col, [186, 154, 114], smoothstep(0.54, 0.94, litBump));
        // Warm golden Vimana beam bounce along lower underside & sunlit top edge rim
        const warmBounce = smoothstep(0.15, 0.75, ny) * 0.28;
        col = mixRgb(col, [208, 148, 72], warmBounce);
        col = mixRgb(col, [238, 206, 154], Math.pow(clamp(ndl, 0, 1), 3.6) * 0.34);
      } else {
        // Warm highlight edges on rear foot scutes just like the reference beam foot
        col = mixRgb(col, [148, 112, 74], scutePlate * clamp(ndl, 0, 1) * 0.6);
      }

      // Darken recessed scale cracks & joint folds so every scale tile reads crisply
      col = mixRgb(col, [14, 10, 8], clamp(scaleShadow * 0.62 + scuteGroove * 0.38 + jointPinch * 0.65, 0, 0.86));

      const shade = (tooth[idx] - 0.5) * 7;
      paintPixelRGB(pixels, idx, clamp(col[0] + shade, 0, 255), clamp(col[1] + shade, 0, 255), clamp(col[2] + shade, 0, 255), alpha);
    };

    const paintTalonHorn = (x: number, y: number, normD: number, nx: number, ny: number, tAlong: number, sNorm: number) => {
      const idx = y * W + x;
      const alpha = smoothstep(1.03, 0.78, normD);
      const nz = Math.sqrt(Math.max(0.05, 1 - clamp(normD * normD, 0, 0.96)));
      const ndl = clamp(nx * LX + ny * LY + nz * LZ, 0, 1);

      const hornGrain = (fbm2D(sNorm * 8.0, tAlong * 4.0, 3, 733) - 0.5) * 0.14;
      const ventralGroove = smoothstep(0.32, 0.9, sNorm) * 0.58;
      const rootShadow = smoothstep(0.18, 0.0, tAlong) * 0.72;
      const topRidgeSpec = Math.pow(clamp(ndl + hornGrain * 0.45, 0, 1), 6.2) * (1 - tAlong * 0.28) * (1 - ventralGroove);
      const goldBounce = smoothstep(0.25, 0.85, ny) * (1 - rootShadow) * 0.24;

      let col = mixRgb([10, 9, 10], [68, 56, 46], clamp(ndl * 0.68 + hornGrain - ventralGroove * 0.38, 0, 1));
      col = mixRgb(col, [164, 114, 52], goldBounce);
      col = mixRgb(col, [230, 218, 192], clamp(topRidgeSpec * 0.92, 0, 0.92));
      col = mixRgb(col, [7, 6, 8], clamp(Math.max(rootShadow, ventralGroove * 0.76), 0, 0.9));

      const shade = (tooth[idx] - 0.5) * 5;
      paintPixelRGB(pixels, idx, clamp(col[0] + shade, 0, 255), clamp(col[1] + shade, 0, 255), clamp(col[2] + shade, 0, 255), alpha);
    };

    // Pass A: Render unified palm + diverging toe bases so toes grow seamlessly out of palm (NO cut-off oval seam!)
    const pPad = Math.max(palmRx, palmRy) + 34;
    const pMinX = Math.max(0, Math.floor(palmCenter.x - pPad));
    const pMaxX = Math.min(W - 1, Math.ceil(palmCenter.x + pPad));
    const pMinY = Math.max(0, Math.floor(palmCenter.y - pPad));
    const pMaxY = Math.min(H - 1, Math.ceil(palmCenter.y + pPad));

    for (let y = pMinY; y <= pMaxY; y++) {
      for (let x = pMinX; x <= pMaxX; x++) {
        const rxLocal = x - palmCenter.x;
        const ryLocal = y - palmCenter.y;
        const u = (rxLocal * cosP + ryLocal * sinP) / palmRx;
        const v = (-rxLocal * sinP + ryLocal * cosP) / palmRy;
        let normD = Math.hypot(u, v) + (fbm2D(x * 0.045, y * 0.045, 2, 317) - 0.5) * 0.07;
        let nx = u;
        let ny = v;
        let sNorm = u * 0.6;

        // Smoothly blend the root 26% of each toe into the palm ellipse
        for (const { toeTube } of sampledToes) {
          const ev = evalSampledTube(x, y, toeTube);
          if (ev.t < 0.32 && ev.normD < normD) {
            const w = smoothstep(0.32, 0.08, ev.t);
            normD = lerp(normD, ev.normD, w);
            nx = lerp(nx, ev.nx, w);
            ny = lerp(ny, ev.ny, w);
            sNorm = lerp(sNorm, ev.sNorm, w);
          }
        }
        if (normD >= 1.03) continue;
        paintScalySkin(x, y, normD, nx, ny, 0.5, sNorm, 0, 1.0);
      }
    }

    // Pass B: Render each toe back-to-front with smooth V-collar ungual sheath overlapping claw root
    for (let ti = 0; ti < sampledToes.length; ti++) {
      const { toeSpec, toeTube, clawTube } = sampledToes[ti];

      // 1) Draw claw horn
      let cMinX = W;
      let cMaxX = 0;
      let cMinY = H;
      let cMaxY = 0;
      for (let i = 0; i <= clawTube.samples; i++) {
        const pad = clawTube.rx[i] + 6;
        cMinX = Math.min(cMinX, clawTube.bx[i] - pad);
        cMaxX = Math.max(cMaxX, clawTube.bx[i] + pad);
        cMinY = Math.min(cMinY, clawTube.by[i] - pad);
        cMaxY = Math.max(cMaxY, clawTube.by[i] + pad);
      }
      cMinX = Math.max(0, Math.floor(cMinX));
      cMaxX = Math.min(W - 1, Math.ceil(cMaxX));
      cMinY = Math.max(0, Math.floor(cMinY));
      cMaxY = Math.min(H - 1, Math.ceil(cMaxY));

      for (let y = cMinY; y <= cMaxY; y++) {
        for (let x = cMinX; x <= cMaxX; x++) {
          const ev = evalSampledTube(x, y, clawTube);
          if (ev.normD >= 1.03) continue;
          paintTalonHorn(x, y, ev.normD, ev.nx, ev.ny, ev.t, ev.sNorm);
        }
      }

      // 2) Draw toe skin with soft root fade into palm (t=0..0.16) and V-collar sheath wrapping claw root!
      let tMinX = W;
      let tMaxX = 0;
      let tMinY = H;
      let tMaxY = 0;
      for (let i = 0; i <= toeTube.samples; i++) {
        const pad = toeTube.rx[i] + 6;
        tMinX = Math.min(tMinX, toeTube.bx[i] - pad);
        tMaxX = Math.max(tMaxX, toeTube.bx[i] + pad);
        tMinY = Math.min(tMinY, toeTube.by[i] - pad);
        tMaxY = Math.max(tMaxY, toeTube.by[i] + pad);
      }
      tMinX = Math.max(0, Math.floor(tMinX));
      tMaxX = Math.min(W - 1, Math.ceil(tMaxX));
      tMinY = Math.max(0, Math.floor(tMinY));
      tMaxY = Math.min(H - 1, Math.ceil(tMaxY));

      for (let y = tMinY; y <= tMaxY; y++) {
        for (let x = tMinX; x <= tMaxX; x++) {
          const ev = evalSampledTube(x, y, toeTube);
          if (ev.normD >= 1.03) continue;

          // Fade base gently onto palm so there is NO pasted-on circular cap seam!
          const rootFade = smoothstep(0.0, 0.16, ev.t);
          // Crisp V-shaped sheath collar: top & center extend slightly forward, sides tuck neatly onto claw!
          const collarCut = 0.94 - smoothstep(0.2, 0.95, Math.abs(ev.sNorm)) * 0.09;
          const sheathAlpha = smoothstep(collarCut + 0.014, collarCut - 0.014, ev.t);
          const alphaMul = Math.min(rootFade, sheathAlpha);
          if (alphaMul <= 0.02) continue;

          const scutes = toeSpec.scuteCount ?? (isRear ? 10 : 12);
          paintScalySkin(x, y, ev.normD, ev.nx, ev.ny, ev.t, ev.sNorm, scutes, alphaMul);
        }
      }
    }
  };

  // =========================================================================
  // 3B. REAR GRIPPING FOOT (Boldly Scuted Toes Clutching Diagonal Temple Beam)
  // =========================================================================
  drawSculptedFoot(
    { x: 896, y: 498 },
    38,
    30,
    0.24,
    [
      {
        toe: { p0: { x: 878, y: 490 }, c1: { x: 848, y: 506 }, c2: { x: 826, y: 532 }, p1: { x: 816, y: 564 }, rStart: 17, rEnd: 12, knuckFreq: 2.0, scuteCount: 11 },
        claw: { p0: { x: 819, y: 554 }, c1: { x: 814, y: 576 }, c2: { x: 818, y: 594 }, p1: { x: 828, y: 608 }, rStart: 11, rEnd: 1.2 },
      },
      {
        toe: { p0: { x: 902, y: 498 }, c1: { x: 870, y: 526 }, c2: { x: 850, y: 558 }, p1: { x: 840, y: 596 }, rStart: 18, rEnd: 13, knuckFreq: 2.0, scuteCount: 12 },
        claw: { p0: { x: 843, y: 586 }, c1: { x: 839, y: 610 }, c2: { x: 846, y: 628 }, p1: { x: 856, y: 644 }, rStart: 12, rEnd: 1.2 },
      },
      {
        toe: { p0: { x: 928, y: 514 }, c1: { x: 898, y: 546 }, c2: { x: 880, y: 582 }, p1: { x: 872, y: 618 }, rStart: 18, rEnd: 13, knuckFreq: 2.0, scuteCount: 12 },
        claw: { p0: { x: 875, y: 608 }, c1: { x: 872, y: 630 }, c2: { x: 880, y: 648 }, p1: { x: 890, y: 662 }, rStart: 12, rEnd: 1.2 },
      },
    ],
    true
  );

  // =========================================================================
  // 4. CHEST & LUNGING FOREARM / ANKLE PLUMAGE (Sunlit Cream-Buff Cuff onto Foot!)
  // =========================================================================
  const armCaps: CapsuleSegment[] = [
    { ax: 1175, ay: 455, bx: 1055, by: 685, ra: 158, rb: 82 },
    { ax: 1245, ay: 475, bx: 1125, by: 665, ra: 112, rb: 68 },
  ];
  const armFeathers: Array<{ x: number; y: number; ang: number; len: number; w: number; mid: RGB; rim: RGB }> = [];

  for (let y = 390; y < 765; y++) {
    for (let x = 860; x < 1410; x++) {
      let armIn = -1;
      let aNx = 0;
      let aNy = 0;
      let aT = 0;
      for (const c of armCaps) {
        const res = evalTaperedCapsule(x, y, c);
        if (res.inside > armIn) {
          armIn = res.inside;
          aNx = res.nx;
          aNy = res.ny;
          aT = res.t;
        }
      }
      const armAng = 1.72;
      const au = x * Math.cos(armAng) + y * Math.sin(armAng);
      const av = -x * Math.sin(armAng) + y * Math.cos(armAng);
      const edgeN = (fbm2D(au * 0.015, av * 0.045, 3, 331) - 0.5) * 0.22;
      const mask = smoothstep(0.0, 0.14, armIn + edgeN);
      if (mask <= 0.02) continue;

      const nz = Math.sqrt(Math.max(0.05, 1 - Math.pow(1 - clamp(armIn, 0, 1), 2)));
      const ndl = clamp(aNx * LX + aNy * LY + nz * LZ, 0, 1);
      const isWristZone = smoothstep(510, 660, y) * smoothstep(1180, 1015, x);
      const goldBounce = smoothstep(480, 680, y) * 0.28;
      let col = mixRgb(PAL.espresso, isWristZone > 0.35 ? PAL.warmTaupe : PAL.umber, ndl * 0.78);
      col = mixRgb(col, PAL.peachTan, goldBounce * (0.4 + ndl * 0.6));
      const idx = y * W + x;
      const shade = (tooth[idx] - 0.5) * 10;
      paintPixelRGB(pixels, idx, clamp(col[0] + shade, 0, 255), clamp(col[1] + shade, 0, 255), clamp(col[2] + shade, 0, 255), mask);

      if (mask > 0.22 && rng() < 0.0074) {
        const cuffLit = isWristZone > 0.18 && ndl > 0.14;
        armFeathers.push({
          x,
          y,
          ang: lerp(armAng, 2.28, isWristZone * 0.6) + (x - 1105) * 0.0014 + (rng() - 0.5) * 0.26,
          len: lerp(62, 42, aT) + rng() * 18,
          w: lerp(26, 17, aT) + rng() * 6,
          mid: cuffLit ? PAL.warmTaupe : ndl > 0.24 ? PAL.umber : PAL.espresso,
          rim: cuffLit ? (rng() < 0.5 ? PAL.ivory : PAL.cream) : ndl > 0.34 ? PAL.peachTan : PAL.buff,
        });
      }
    }
  }
  armFeathers.sort((a, b) => a.y - b.y);
  for (const af of armFeathers) {
    drawBroadLayeredFeather(
      pixels,
      paper,
      af.x,
      af.y,
      af.ang,
      af.len,
      af.w,
      PAL.espresso,
      af.mid,
      af.rim,
      (rng() - 0.5) * 0.14,
      0.94
    );
  }

  // =========================================================================
  // 5. LUSH ROUNDED EAGLE RUFF & HUNCHED SHOULDER MANTLE
  //    (Smooth organic dome/mantle + shingled soft downy plumes, NO electric spikes!)
  // =========================================================================
  const headC = { x: 1040, y: 348 };
  const mantleCaps: CapsuleSegment[] = [
    // Hunched nape/crown crest arching up and slightly back-right (rounded eagle silhouette)
    { ax: 1035, ay: 270, bx: 1148, by: 158, ra: 118, rb: 96 },
    { ax: 1148, ay: 158, bx: 1265, by: 235, ra: 96, rb: 116 },
    // Left shoulder mantle sweeping smoothly into the left wing
    { ax: 970, ay: 288, bx: 795, by: 318, ra: 112, rb: 84 },
    { ax: 795, ay: 318, bx: 702, by: 360, ra: 84, rb: 56 },
    // Right neck & collar wrapping behind cheek onto the chest/right wing
    { ax: 1135, ay: 280, bx: 1325, by: 310, ra: 126, rb: 92 },
    { ax: 1120, ay: 370, bx: 1235, by: 428, ra: 96, rb: 74 },
    // Soft upper chest bib rim right beneath lower cheeks
    { ax: 965, ay: 365, bx: 1140, by: 388, ra: 82, rb: 88 },
  ];

  interface RuffPlumeItem {
    x: number;
    y: number;
    dist: number;
    ang: number;
    len: number;
    w: number;
    bend: number;
    shadow: RGB;
    mid: RGB;
    lit: RGB;
    seed: number;
  }
  const ruffPlumes: RuffPlumeItem[] = [];

  for (let y = 30; y < 540; y++) {
    for (let x = 600; x < 1490; x++) {
      let ruffIn = -1;
      let rNx = 0;
      let rNy = 0;
      for (const c of mantleCaps) {
        const res = evalTaperedCapsule(x, y, c);
        if (res.inside > ruffIn) {
          ruffIn = res.inside;
          rNx = res.nx;
          rNy = res.ny;
        }
      }

      const rdx = x - headC.x;
      const rdy = y - headC.y;
      const rDist = Math.hypot(rdx, rdy);
      const rAng = Math.atan2(rdy, rdx);

      // Gentle FBM organic contour so edges feel fluffy rather than geometric
      const contourNoise = (fbm2D(x * 0.016, y * 0.016, 3, 557) - 0.5) * 0.22;
      const ruffMask = smoothstep(0.0, 0.16, ruffIn + contourNoise);
      if (ruffMask <= 0.02) continue;

      const nz = Math.sqrt(Math.max(0.06, 1 - Math.pow(1 - clamp(ruffIn, 0, 1), 2)));
      const ndl = clamp(rNx * LX + rNy * LY + nz * LZ, 0, 1);
      const clump = fbm2D(x * 0.024, y * 0.024, 3, 823);
      const litFactor = clamp(ndl * 0.62 + clump * 0.44, 0, 1);

      let col = mixRgb(PAL.umber, PAL.warmTaupe, smoothstep(0.08, 0.34, litFactor));
      col = mixRgb(col, PAL.buff, smoothstep(0.3, 0.62, litFactor));
      col = mixRgb(col, PAL.cream, smoothstep(0.56, 0.84, litFactor));
      col = mixRgb(col, PAL.ivory, smoothstep(0.82, 0.98, litFactor));

      // Warm ambient pocket under chin and along right collar crease
      if (rDist < 138 && y > 350) {
        col = mixRgb(PAL.umber, col, smoothstep(95, 138, rDist));
      }

      const idx = y * W + x;
      const shade = (tooth[idx] - 0.5) * 10;
      paintPixelRGB(pixels, idx, clamp(col[0] + shade, 0, 255), clamp(col[1] + shade, 0, 255), clamp(col[2] + shade, 0, 255), ruffMask);

      // Scatter shingled soft downy plumes inside the ruff (staying inside outer rim to avoid spiky aura!)
      if (ruffIn > 0.03 && rng() < 0.009) {
        // Natural sweeping feather flow around skull & across hunched shoulders (NOT radial star spikes!)
        let flowAng = rAng;
        let bend = 0.14;
        if (x < 940) {
          // Left shoulder mantle sweeps outward & down-left into wing
          flowAng = lerp(2.85, 2.28, smoothstep(680, 940, x)) + (y - 310) * 0.0022;
          bend = -0.18;
        } else if (y < 245) {
          // Upper crown & hunched nape sweep UP-AND-BACK-RIGHT gracefully (never sticking straight up!)
          flowAng = lerp(-1.25, -0.35, smoothstep(940, 1260, x));
          bend = 0.22;
        } else if (x > 1130) {
          // Right collar sweeps back-right and downward over shoulder
          flowAng = lerp(-0.22, 0.95, smoothstep(230, 440, y));
          bend = 0.2;
        } else {
          // Inner halo around forehead & cheeks sweeps cleanly outward/back along skull
          flowAng = rAng + (rAng < -1.57 ? -0.32 : 0.34);
          bend = rAng < -1.57 ? -0.14 : 0.14;
        }

        const innerFactor = smoothstep(285, 105, rDist);
        const len = lerp(46, 22, innerFactor) + rng() * 14;
        const w = lerp(28, 13, innerFactor) + rng() * 7;

        const isShadowPocket = ndl < 0.24 || (x > 1210 && y > 260);
        ruffPlumes.push({
          x,
          y,
          dist: rDist,
          ang: flowAng + (rng() - 0.5) * 0.24,
          len,
          w,
          bend: bend + (rng() - 0.5) * 0.12,
          shadow: isShadowPocket ? PAL.umber : PAL.warmTaupe,
          mid: isShadowPocket ? PAL.warmTaupe : PAL.buff,
          lit: isShadowPocket ? PAL.buff : ndl > 0.42 ? PAL.ivory : PAL.cream,
          seed: rng() * 100,
        });
      }
    }
  }

  // Draw outer mantle plumes FIRST, inner collar plumes LAST -> natural overlapping shingling!
  ruffPlumes.sort((a, b) => b.dist - a.dist);
  for (const rp of ruffPlumes) {
    drawSoftRuffPlume(pixels, paper, rp.x, rp.y, rp.ang, rp.len, rp.w, rp.shadow, rp.mid, rp.lit, rp.bend, rp.seed, 0.88);
  }

  // =========================================================================
  // 6. 3/4 FIERCE EAGLE HEAD (Photorealistic Raptor Gaze, Leathery Cheek Folds,
  //    Sunburst Crown Flecks, Two-Plate Slate Cere & Burnished Amber Hooked Beak)
  // =========================================================================
  const facePlumes: Array<{ x: number; y: number; dist: number; ang: number; len: number; w: number; shadow: RGB; mid: RGB; lit: RGB; bend: number }> = [];
  const crownStrokes: Array<{ x: number; y: number; ang: number; len: number; w: number; col: RGB; alpha: number }> = [];

  for (let y = 218; y < 486; y++) {
    for (let x = 896; x < 1164; x++) {
      const fdx = (x - 1022) / 116;
      const fdy = (y - 348) / 108;
      const fDist = Math.hypot(fdx, fdy);
      const faceNoise = (fbm2D(x * 0.022, y * 0.022, 3, 211) - 0.5) * 0.14;
      const faceMask = smoothstep(1.03, 0.68, fDist + faceNoise);
      if (faceMask <= 0.02) continue;

      const idx = y * W + x;
      const nz = Math.sqrt(Math.max(0.05, 1 - clamp(fDist * fDist, 0, 0.96)));
      const ndl = clamp(fdx * LX + fdy * LY + nz * LZ, 0, 1);

      // Warm golden-ochre forehead dome & sunlit cream cheek base
      const foreheadWarmth = Math.exp(-Math.pow(Math.hypot((x - 1018) / 56, (y - 290) / 44), 2));
      const rightShadow = smoothstep(998, 1096, x) * smoothstep(280, 390, y);

      let fCol = mixRgb(PAL.buff, PAL.cream, clamp(ndl * 0.72 + 0.36, 0, 1));
      fCol = mixRgb(fCol, PAL.peachTan, foreheadWarmth * 0.78);
      fCol = mixRgb(fCol, PAL.warmTaupe, rightShadow * 0.66);

      // High-detail bare wrinkled skin:
      // 1) Left lore: pale dry ash-taupe with crisp curved vertical skin creases
      const leftLore = Math.exp(-Math.pow(Math.hypot((x - 968) / 24, (y - 344) / 26), 2));
      // 2) Right nasal/cheek pad: warm terracotta-umber deeply furrowed pebble leather
      const rightCheekPad = Math.exp(-Math.pow(Math.hypot((x - 1046) / 36, (y - 368) / 36), 2));
      // 3) Deep dark orbital cave under overhanging right brow
      const rightSocket = Math.exp(-Math.pow(Math.hypot((x - 1068) / 26, (y - 337) / 17), 2));
      const leftSocketRim = Math.exp(-Math.pow(Math.hypot((x - 958) / 19, (y - 324) / 13), 2)) * 0.45;

      const warpX = x + (fbm2D(x * 0.11, y * 0.11, 2, 313) - 0.5) * 6.5;
      const warpY = y + (fbm2D(x * 0.11 + 41, y * 0.11 + 19, 2, 617) - 0.5) * 6.5;
      const fineNoise = fbm2D(warpX * 0.24, warpY * 0.24, 3, 509);
      const ridgeCellular = 1 - Math.abs(fbm2D(warpX * 0.28, warpY * 0.28, 2, 881) * 2 - 1);
      const leftCreases = Math.sin((warpX - 946) * 0.78 - (warpY - 324) * 0.22) * 0.5 + 0.5;
      const rightRad = Math.hypot(warpX - 1066, warpY - 338);
      const rightCreases = Math.sin(rightRad * 0.72 + (warpX - 1020) * 0.18) * 0.5 + 0.5;

      const leftLeather = clamp(ndl * 0.44 + leftCreases * 0.34 + ridgeCellular * 0.26, 0, 1);
      const rightLeather = clamp(ndl * 0.32 + rightCreases * 0.28 + ridgeCellular * 0.42, 0, 1);

      const leftBareCol = mixRgb([68, 60, 54], [192, 180, 166], smoothstep(0.18, 0.84, leftLeather));
      const rightBareCol = mixRgb([24, 15, 11], [156, 102, 68], smoothstep(0.22, 0.86, rightLeather));

      fCol = mixRgb(fCol, leftBareCol, clamp(leftLore * 0.9, 0, 0.92));
      fCol = mixRgb(fCol, rightBareCol, clamp(rightCheekPad * 0.96, 0, 0.97));
      fCol = mixRgb(fCol, [16, 11, 10], clamp(rightSocket * 0.84 + leftSocketRim, 0, 0.88));

      // Subtle sculptural brow overhang shadow above right eye socket (blending seamlessly into forehead)
      const rightBrowShade =
        Math.exp(-Math.pow(((x - 1064) / 36), 2) - Math.pow(((y - 318 - (x - 1030) * 0.08) / 14), 2)) * 0.48;
      fCol = mixRgb(fCol, PAL.umber, rightBrowShade);

      const grain = (fineNoise - 0.5) * 20 + (tooth[idx] - 0.5) * 8;
      paintPixelRGB(pixels, idx, clamp(fCol[0] + grain, 0, 255), clamp(fCol[1] + grain, 0, 255), clamp(fCol[2] + grain, 0, 255), faceMask);

      // Miniature shingled plumes framing the outer temple/cheek/chin perimeter
      const bareDist = Math.hypot((x - 1020) / 72, (y - 356) / 56);
      if (faceMask > 0.22 && bareDist > 0.84 && rng() < 0.014) {
        const outAng = Math.atan2(y - 348, x - 1020);
        const isRightShadow = x > 1054 && y > 312;
        facePlumes.push({
          x,
          y,
          dist: fDist,
          ang: outAng + (rng() - 0.5) * 0.22,
          len: 14 + rng() * 9,
          w: 7.5 + rng() * 4,
          shadow: isRightShadow ? PAL.umber : y < 326 ? PAL.peachTan : PAL.warmTaupe,
          mid: isRightShadow ? PAL.warmTaupe : PAL.buff,
          lit: isRightShadow ? PAL.buff : PAL.cream,
          bend: x < 1020 ? -0.1 : 0.1,
        });
      }

      // Crisp barbule wisps & sunburst crown bristle flecks overlapping bare skin borders & outer ruff
      const crownDist = Math.hypot((x - 1020) / 96, (y - 332) / 98);
      if (y > 232 && y < 342 && x > 932 && x < 1112 && crownDist > 0.18 && crownDist < 0.98 && rng() < 0.042) {
        const fanAng = Math.atan2(y - 344, x - 1020) + (rng() - 0.5) * 0.16;
        const nearBridge = Math.exp(-Math.pow(Math.hypot((x - 1020) / 48, (y - 302) / 36), 2));
        const isDarkFleck = rng() < lerp(0.16, 0.38, nearBridge);
        crownStrokes.push({
          x,
          y,
          ang: fanAng,
          len: isDarkFleck ? 5 + rng() * 5 : 11 + rng() * 10,
          w: isDarkFleck ? 1.4 + rng() * 0.7 : 1.9 + rng() * 1.0,
          col: isDarkFleck
            ? mixRgb(PAL.espresso, [96, 48, 22], rng() * 0.5)
            : mixRgb(PAL.peachTan, PAL.ivory, clamp(0.38 + rng() * 0.62 - nearBridge * 0.25, 0, 1)),
          alpha: isDarkFleck ? 0.48 + rng() * 0.24 : 0.72 + rng() * 0.2,
        });
      } else if (faceMask > 0.28 && bareDist > 0.62 && bareDist < 1.05 && rng() < 0.02) {
        // Fine facial bristle wisps overlapping cheek skin edges & softening ruff contours
        const wispAng = Math.atan2(y - 350, x - 1020) + (rng() - 0.5) * 0.28;
        const isDarkCheek = x > 1038 && y > 320;
        crownStrokes.push({
          x,
          y,
          ang: wispAng,
          len: 9 + rng() * 8,
          w: 1.3 + rng() * 0.7,
          col: isDarkCheek ? mixRgb(PAL.umber, PAL.buff, rng() * 0.55) : mixRgb(PAL.buff, PAL.ivory, 0.4 + rng() * 0.6),
          alpha: 0.55 + rng() * 0.25,
        });
      }
    }
  }

  // Paint outer face plumes first, then crisp sunburst crown & facial bristle wisps
  facePlumes.sort((a, b) => b.dist - a.dist);
  for (const fp of facePlumes) {
    drawSoftRuffPlume(pixels, paper, fp.x, fp.y, fp.ang, fp.len, fp.w, fp.shadow, fp.mid, fp.lit, fp.bend, rng() * 100, 0.86);
  }
  for (const cs of crownStrokes) {
    const mx = cs.x + Math.cos(cs.ang) * cs.len * 0.52;
    const my = cs.y + Math.sin(cs.ang) * cs.len * 0.52;
    const ex = cs.x + Math.cos(cs.ang) * cs.len;
    const ey = cs.y + Math.sin(cs.ang) * cs.len;
    drawFineHairStroke(pixels, paper, { x: cs.x, y: cs.y }, { x: mx, y: my }, { x: ex, y: ey }, cs.col, cs.w, 0.55, cs.alpha);
  }

  // Lower jaw & chin cheek-ruff feathers framing the jaw cleanly above chest
  for (let i = 0; i < 30; i++) {
    const t = i / 29;
    const cx = lerp(962, 1094, t) + (rng() - 0.5) * 7;
    const cy = lerp(420, 434, t) + Math.sin(t * Math.PI) * 14;
    const ang = lerp(2.1, 0.88, t) + (rng() - 0.5) * 0.14;
    const isShadowSide = cx > 1044;
    drawSoftRuffPlume(
      pixels,
      paper,
      cx,
      cy,
      ang,
      24 + rng() * 14,
      12 + rng() * 5,
      isShadowSide ? PAL.umber : PAL.warmTaupe,
      isShadowSide ? PAL.warmTaupe : PAL.buff,
      isShadowSide ? PAL.buff : PAL.cream,
      isShadowSide ? 0.14 : -0.14,
      rng() * 100,
      0.92
    );
  }

  // Fierce Photorealistic Raptor Eyes (Almond contour, subtle sclera gleam, upper brow overhang shadow, pale lower lid fold)
  const drawEye = (ex: number, ey: number, rx: number, ry: number, slant: number, shadowed: boolean) => {
    for (let y = Math.floor(ey - ry - 7); y <= Math.ceil(ey + ry + 7); y++) {
      for (let x = Math.floor(ex - rx - 7); x <= Math.ceil(ex + rx + 7); x++) {
        const dx = (x - ex) / rx;
        const tiltedDy = (y - ey) / ry - dx * slant * 0.28;
        const almondScale = 1 + 0.36 * dx * dx;
        const dy = tiltedDy * almondScale;
        const d = Math.hypot(dx, dy);
        if (d > 1.26) continue;

        // Heavy overhanging brow lid sloping firmly down toward the beak bridge
        const lidY = -0.34 + dx * slant;
        if (dy < lidY - 0.22) continue;

        const idx = y * W + x;
        const lidCastShadow = smoothstep(lidY + 0.44, lidY + 0.02, dy);

        if (dy < lidY + 0.04) {
          // Dark glossy upper eyelid rim
          const lidAlpha = smoothstep(lidY - 0.22, lidY - 0.01, dy) * smoothstep(1.26, 0.84, d) * 0.94;
          paintPixelRGB(pixels, idx, 16, 11, 10, lidAlpha);
        } else if (d > 0.88) {
          // Sculpted pale lower palpebral eyelid ridge cradling the socket
          const lowerRim = dy > 0.1 ? smoothstep(0.88, 1.05, d) * smoothstep(1.26, 1.05, d) : 0;
          const rimCol: RGB = shadowed
            ? mixRgb([20, 14, 12], [116, 94, 78], lowerRim * 0.82)
            : mixRgb([24, 17, 15], [198, 182, 166], lowerRim * 0.94);
          paintPixelRGB(pixels, idx, rimCol[0], rimCol[1], rimCol[2], smoothstep(1.26, 0.88, d) * 0.92);
        } else if (d > 0.72 && !shadowed && dx < 0.15 && dy > 0.05) {
          // Subtle wet cream-ivory sclera crescent on lower-left of sunlit eye (gives living 3D gaze!)
          const scleraCol = mixRgb([138, 118, 98], [224, 214, 198], smoothstep(0.72, 0.84, d) * (1 - lidCastShadow * 0.6));
          paintPixelRGB(pixels, idx, scleraCol[0], scleraCol[1], scleraCol[2], 0.96);
        } else if (d > 0.39) {
          // Rich fibrous chestnut-amber iris shaded smoothly under the overhanging upper lid
          const irisAngle = Math.atan2(dy, dx);
          const irisFiber = Math.sin(irisAngle * 22) * 0.065;
          const irisBright: RGB = shadowed ? [112, 60, 18] : [192, 108, 28];
          const irisDark: RGB = shadowed ? [24, 13, 8] : [52, 24, 9];
          let irisGrad = mixRgb(irisBright, irisDark, clamp(smoothstep(0.4, 0.88, d) + irisFiber, 0, 1));
          irisGrad = mixRgb(irisGrad, [18, 10, 7], lidCastShadow * (shadowed ? 0.82 : 0.6));
          paintPixelRGB(pixels, idx, irisGrad[0], irisGrad[1], irisGrad[2], 0.99);
        } else {
          paintPixelRGB(pixels, idx, 8, 7, 9, 0.99);
        }
      }
    }
    // Sharp wet catchlight nestled right against the upper-left lid edge
    const specAlpha = shadowed ? 0.48 : 0.98;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const d = Math.hypot(dx, dy);
        if (d < 2.4) {
          const px = Math.round(ex - 2.8 + dx);
          const py = Math.round(ey - 1.4 + dy);
          paintPixelRGB(pixels, py * W + px, 255, 252, 244, smoothstep(2.4, 0.25, d) * specAlpha);
        }
      }
    }
  };
  drawEye(960, 324, 15.2, 12.2, 0.46, false);
  drawEye(1068, 336, 15.6, 12.0, -0.46, true);

  // Sculpted Overhanging Brow Ridges (Sunlit left brow + naturally blended shadowed right supraorbital ridge)
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    // Left brow arch softening smoothly into sunlit temple plumage
    drawSoftRuffPlume(
      pixels,
      paper,
      lerp(988, 934, t),
      lerp(314, 305, t) - Math.sin(t * Math.PI) * 6,
      lerp(-2.05, -2.85, t),
      15 + rng() * 5,
      8.5 + rng() * 3,
      PAL.peachTan,
      PAL.buff,
      PAL.cream,
      -0.14,
      rng() * 100,
      0.86
    );
    // Right brow ridge: warm taupe/buff upper forehead feathers grading smoothly into umber socket overhang (NO dark pasted strip!)
    drawSoftRuffPlume(
      pixels,
      paper,
      lerp(1030, 1102, t),
      lerp(322, 320, t) - Math.sin(t * Math.PI) * 5,
      lerp(-1.18, -0.32, t),
      16 + rng() * 5,
      8.5 + rng() * 3,
      PAL.umber,
      PAL.warmTaupe,
      t < 0.4 ? PAL.peachTan : PAL.buff,
      0.14,
      rng() * 100,
      0.84
    );
  }
  // Short subtle outer orbital bristle-feathers on left corner (replacing drawn-on ink lashes)
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    drawFineHairStroke(
      pixels,
      paper,
      { x: 944 - t * 2, y: 319 - t * 2 },
      { x: 938 - t * 2, y: 315 - t * 2 },
      { x: 933 - t * 3, y: 312 - t * 2 },
      PAL.warmTaupe,
      1.3,
      0.55,
      0.48
    );
  }

  // Subtle Lower Mandible & Anatomical Rictal Crease Tucked Cleanly Under Upper Beak Edge
  const jawCaps = bezierToCapsules({ x: 1002, y: 416 }, { x: 1018, y: 412 }, { x: 1034, y: 408 }, { x: 1048, y: 407 }, 5.5, 4.2, 10, rng);
  for (let y = 398; y <= 430; y++) {
    for (let x = 994; x <= 1058; x++) {
      let jIn = -1;
      let jNx = 0;
      let jNy = 0;
      for (const jc of jawCaps) {
        const res = evalTaperedCapsule(x, y, jc);
        if (res.inside > jIn) {
          jIn = res.inside;
          jNx = res.nx;
          jNy = res.ny;
        }
      }
      if (jIn <= 0) continue;
      // Softly fade into cheek skin toward back corner so it never looks like a pasted lip
      const cornerFade = smoothstep(1054, 1020, x);
      const alpha = smoothstep(0.0, 0.35, jIn) * 0.82 * cornerFade;
      if (alpha <= 0.02) continue;
      const nz = Math.sqrt(Math.max(0.06, 1 - Math.pow(1 - clamp(jIn, 0, 1), 2)));
      const ndl = clamp(jNx * LX + jNy * LY + nz * LZ, 0, 1);
      const jCol = mixRgb([26, 17, 13], [134, 92, 48], clamp(smoothstep(0.22, 0.84, ndl) * 0.72, 0, 1));
      paintPixelRGB(pixels, y * W + x, jCol[0], jCol[1], jCol[2], alpha);
    }
  }
  // Crisp short rictal tomium crease tucking cleanly back into shadowed cheek corner
  drawFineHairStroke(pixels, paper, { x: 1002, y: 414 }, { x: 1024, y: 409 }, { x: 1046, y: 407 }, [20, 12, 9], 2.1, 0.9, 0.84);
  drawFineHairStroke(pixels, paper, { x: 1004, y: 417 }, { x: 1023, y: 412 }, { x: 1040, y: 410 }, [132, 96, 58], 1.1, 0.5, 0.42);

  // Asymmetric 3/4 Hooked Eagle Beak + Two-Plate Sculpted Slate Cere Collar
  const BEAK_SAMPLES = 220;
  const bP0 = { x: 1022, y: 326 };
  const bC1 = { x: 984, y: 384 };
  const bC2 = { x: 970, y: 444 };
  const bP1 = { x: 980, y: 498 };

  const bxArr = new Float32Array(BEAK_SAMPLES + 1);
  const byArr = new Float32Array(BEAK_SAMPLES + 1);
  const btxArr = new Float32Array(BEAK_SAMPLES + 1);
  const btyArr = new Float32Array(BEAK_SAMPLES + 1);
  const brLeftArr = new Float32Array(BEAK_SAMPLES + 1);
  const brRightArr = new Float32Array(BEAK_SAMPLES + 1);

  for (let i = 0; i <= BEAK_SAMPLES; i++) {
    const t = i / BEAK_SAMPLES;
    const mt = 1 - t;
    bxArr[i] = mt * mt * mt * bP0.x + 3 * mt * mt * t * bC1.x + 3 * mt * t * t * bC2.x + t * t * t * bP1.x;
    byArr[i] = mt * mt * mt * bP0.y + 3 * mt * mt * t * bC1.y + 3 * mt * t * t * bC2.y + t * t * t * bP1.y;

    const dxdt = 3 * mt * mt * (bC1.x - bP0.x) + 6 * mt * t * (bC2.x - bC1.x) + 3 * t * t * (bP1.x - bC2.x);
    const dydt = 3 * mt * mt * (bC1.y - bP0.y) + 6 * mt * t * (bC2.y - bC1.y) + 3 * t * t * (bP1.y - bC2.y);
    const tLen = Math.hypot(dxdt, dydt) || 1;
    btxArr[i] = dxdt / tLen;
    btyArr[i] = dydt / tLen;

    const archIn = Math.pow(smoothstep(0.0, 0.16, t), 0.44);
    const leftProfile = Math.pow(1 - Math.pow(t, 1.98), 0.72);
    const rightProfile = Math.pow(1 - Math.pow(t, 1.2), 1.05);
    const cereStep = t < 0.31 ? 2.8 * smoothstep(0.04, 0.22, t) : 0;
    brLeftArr[i] = lerp(2.5, 42, archIn * leftProfile) + cereStep;
    brRightArr[i] = lerp(2.5, 40, archIn * rightProfile) + cereStep;
  }

  for (let y = 312; y <= 514; y++) {
    for (let x = 928; x <= 1078; x++) {
      let bestDist2 = 1e9;
      let bestI = 0;

      for (let i = 0; i <= BEAK_SAMPLES; i++) {
        const dx = x - bxArr[i];
        const dy = y - byArr[i];
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist2) {
          bestDist2 = d2;
          bestI = i;
        }
      }

      const bestT = bestI / BEAK_SAMPLES;
      const dx = x - bxArr[bestI];
      const dy = y - byArr[bestI];
      const tx = btxArr[bestI];
      const ty = btyArr[bestI];
      const px = -ty;
      const py = tx;

      const s = dx * px + dy * py;
      const bestR = Math.max(1.2, s < 0 ? brLeftArr[bestI] : brRightArr[bestI]);
      const along = dx * tx + dy * ty;
      const endAlong = bestI === 0 ? Math.min(0, along) : bestI === BEAK_SAMPLES ? Math.max(0, along) : 0;
      const effDist = Math.hypot(s, endAlong);
      const normD = effDist / bestR;
      if (normD >= 1.04) continue;

      const alpha = smoothstep(1.04, 0.82, normD);
      const nx = clamp(s / bestR, -1, 1);
      const ny = clamp(endAlong / bestR, -1, 1) * 0.45 - 0.15;
      const nz = Math.sqrt(Math.max(0.04, 1 - clamp(normD * normD, 0, 0.96)));
      const kNx = clamp(nx + 0.14, -1, 1);
      const ndl = clamp(kNx * LX + ny * LY + nz * LZ, 0, 1);

      // Rich fibrous keratin horn striations, weathered matte slate texture & organic cere boundary
      const hornFibers = (fbm2D(nx * 14.0, bestT * 5.2, 3, 719) - 0.5) * 0.32;
      const hornMicro = (fbm2D(nx * 24.0, bestT * 18.0, 2, 233) - 0.5) * 0.14;
      const cereGrain = (fbm2D(nx * 8.0, bestT * 14.0, 3, 419) - 0.5) * 0.24;
      const cereRidge = (fbm2D(nx * 16.0, bestT * 4.5, 2, 887) - 0.5) * 0.16;
      const cereEdgeNoise = (fbm2D(nx * 5.5, 1.5, 2, 419) - 0.5) * 0.045;
      const cereEnd = 0.25 + Math.abs(nx) * 0.085 - (nx > 0 ? 0.025 : 0) + cereEdgeNoise;
      const cereBlend = smoothstep(cereEnd + 0.036, cereEnd - 0.026, bestT);

      // Matte weathered dark slate-charcoal cere skin (NO metallic horizontal pipe stripe!)
      let cereCol = mixRgb([22, 19, 19], [98, 90, 84], clamp(ndl * 0.78 + cereGrain + cereRidge, 0, 1));
      // Soft matte keratin highlight along culmen bridge (capped so it reads as horn/skin, NOT chrome!)
      cereCol = mixRgb(cereCol, [142, 134, 126], Math.pow(ndl, 3.8) * 0.42);

      // Steep anatomical teardrop nostril tucked higher into right flank + narrow recessed left slit
      const nU = (nx - 0.49) * 0.92 + (bestT - 0.155) * 2.2;
      const nV = -(nx - 0.49) * 0.38 + (bestT - 0.155) * 4.4;
      const rightSlit = Math.exp(-Math.pow(nU / 0.16, 2) - Math.pow(nV / 0.065, 2));
      const rightLip = Math.exp(-Math.pow((nU - 0.15) / 0.11, 2) - Math.pow((nV - 0.01) / 0.08, 2)) * 0.38;
      const rightWingGroove = Math.exp(-Math.pow((nx - 0.8) / 0.09, 2)) * smoothstep(0.14, 0.28, bestT) * 0.7;
      const leftCrescentSlit = Math.exp(-Math.pow((nx + 0.81) / 0.09, 2) - Math.pow((bestT - 0.165) / 0.032, 2)) * 0.84;
      const leftEdgeShadow = smoothstep(-0.72, -0.98, nx) * 0.68;

      cereCol = mixRgb(cereCol, [144, 134, 124], rightLip);
      cereCol = mixRgb(cereCol, PAL.charcoal, clamp(Math.max(Math.max(rightSlit, leftCrescentSlit), Math.max(rightWingGroove, leftEdgeShadow)), 0, 0.95));

      // Burnished weathered amber horn with organic keratin striations, subtle mineral blotches & dark hook tip
      const lipShadow = smoothstep(cereEnd + 0.048, cereEnd - 0.006, bestT) * 0.72;
      const leftRimDark = smoothstep(-0.68, -0.98, nx) * 0.74;
      const rightShade = smoothstep(0.12, 0.86, nx) * 0.66;
      const tipDark = smoothstep(0.6, 0.98, bestT);
      const culmenSpec = Math.exp(-Math.pow((nx + 0.18) / 0.15, 2)) * smoothstep(0.28, 0.42, bestT) * smoothstep(0.76, 0.46, bestT);

      const deepHorn: RGB = [32, 20, 10];
      const midHorn: RGB = [148, 88, 24];
      const brightHorn: RGB = [224, 158, 60];

      let hornCol = mixRgb(deepHorn, midHorn, clamp(smoothstep(0.08, 0.54, ndl) + hornFibers + hornMicro, 0, 1));
      hornCol = mixRgb(hornCol, brightHorn, clamp(smoothstep(0.52, 0.88, ndl) + hornFibers * 0.52, 0, 1));
      hornCol = mixRgb(hornCol, [246, 224, 174], Math.max(Math.pow(ndl, 10.0) * 0.45, culmenSpec * 0.34));
      hornCol = mixRgb(hornCol, PAL.charcoal, clamp(Math.max(Math.max(lipShadow, leftRimDark), Math.max(rightShade, tipDark * 0.92)), 0, 0.95));

      const bCol = mixRgb(hornCol, cereCol, cereBlend);

      const idx = y * W + x;
      const grain = (tooth[idx] - 0.5) * 7;
      paintPixelRGB(pixels, idx, clamp(bCol[0] + grain, 0, 255), clamp(bCol[1] + grain, 0, 255), clamp(bCol[2] + grain, 0, 255), alpha);
    }
  }
  // Fine sunburst forehead feather tips & dark shaft flecks overlapping upper rim of the cere bridge
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const fx = lerp(986, 1054, t);
    const fy = 330 - Math.sin(t * Math.PI) * 6;
    const ang = lerp(-2.26, -0.84, t);
    const isDark = i % 4 === 1;
    drawFineHairStroke(
      pixels,
      paper,
      { x: fx, y: fy },
      { x: fx + Math.cos(ang) * 7, y: fy + Math.sin(ang) * 7 },
      { x: fx + Math.cos(ang) * (isDark ? 11 : 15), y: fy + Math.sin(ang) * (isDark ? 11 : 15) },
      isDark ? PAL.espresso : t > 0.72 ? PAL.umber : PAL.peachTan,
      isDark ? 1.5 : 2.1,
      0.5,
      0.78
    );
  }

  // =========================================================================
  // 7. COLOSSAL FOREGROUND REACHING TALON (Tangent-Matched V-Sheath Claws,
  //    Worley Reptile Scales & Clear Separation from Rear Beam Foot)
  // =========================================================================
  drawSculptedFoot(
    { x: 1034, y: 706 },
    62,
    48,
    -0.28,
    [
      // 1. Back-left index toe + tangent-matched upward sickle talon (clear to left of rear foot!)
      {
        toe: { p0: { x: 996, y: 696 }, c1: { x: 944, y: 702 }, c2: { x: 890, y: 698 }, p1: { x: 842, y: 682 }, rStart: 25, rEnd: 17, knuckFreq: 2.0, scuteCount: 10, sheathEnd: true },
        claw: { p0: { x: 858, y: 688 }, c1: { x: 806, y: 668 }, c2: { x: 774, y: 618 }, p1: { x: 778, y: 562 }, rStart: 16.5, rEnd: 1.2 },
      },
      // 2. Middle foreshortened toe + tangent-matched heavy upward talon
      {
        toe: { p0: { x: 1014, y: 720 }, c1: { x: 958, y: 744 }, c2: { x: 904, y: 750 }, p1: { x: 856, y: 736 }, rStart: 27, rEnd: 18, knuckFreq: 2.0, scuteCount: 10, sheathEnd: true },
        claw: { p0: { x: 872, y: 740 }, c1: { x: 802, y: 720 }, c2: { x: 758, y: 662 }, p1: { x: 752, y: 594 }, rStart: 17.5, rEnd: 1.2 },
      },
      // 3. Lower foreground toe + colossal tangent-matched curved bottom talon
      {
        toe: { p0: { x: 1036, y: 738 }, c1: { x: 990, y: 778 }, c2: { x: 940, y: 806 }, p1: { x: 894, y: 808 }, rStart: 29, rEnd: 19, knuckFreq: 2.0, scuteCount: 11, sheathEnd: true },
        claw: { p0: { x: 910, y: 808 }, c1: { x: 830, y: 822 }, c2: { x: 772, y: 776 }, p1: { x: 756, y: 696 }, rStart: 18.5, rEnd: 1.3 },
      },
      // 4. Foreground upper-right thumb (hallux) growing seamlessly from palm + leftward hook talon
      {
        toe: { p0: { x: 1054, y: 682 }, c1: { x: 1038, y: 652 }, c2: { x: 1018, y: 628 }, p1: { x: 996, y: 614 }, rStart: 28, rEnd: 18, knuckFreq: 1.8, scuteCount: 8, sheathEnd: true },
        claw: { p0: { x: 1006, y: 620 }, c1: { x: 974, y: 598 }, c2: { x: 938, y: 594 }, p1: { x: 908, y: 608 }, rStart: 16.5, rEnd: 1.2 },
      },
    ],
    false
  );

  // Staggered warm cream-buff ankle cuff feathers softening the wrist-to-palm seam organically
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const fx = lerp(1082, 1142, Math.sin(t * Math.PI)) + (rng() - 0.5) * 28;
    const fy = lerp(572, 738, t) + (rng() - 0.5) * 18;
    const ang = lerp(2.52, 1.86, t) + (rng() - 0.5) * 0.24;
    drawBroadLayeredFeather(
      pixels,
      paper,
      fx,
      fy,
      ang,
      36 + rng() * 24,
      14 + rng() * 7,
      PAL.espresso,
      PAL.umber,
      t < 0.7 ? PAL.cream : PAL.buff,
      (rng() - 0.5) * 0.22,
      0.86
    );
  }
}
