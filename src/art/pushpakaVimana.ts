import { paintPixelRGB } from './dryBrush';
import { mixRgb } from './featherEngine';
import { RGB } from './palette';
import { PaperSubstrate } from './paper';
import { clamp, createRng, fbm2D, lerp, smoothstep } from './rng';

const SKY_PAL = {
  skyZenith: [34, 112, 200] as RGB,
  skyMid: [112, 186, 240] as RGB,
  skyHorizon: [222, 240, 254] as RGB,
  cloudWhite: [253, 251, 247] as RGB,
};

const VIMANA_PAL = {
  teakVoid: [14, 8, 4] as RGB,
  teakDeep: [34, 17, 7] as RGB,
  teakDark: [60, 31, 12] as RGB,
  teakMid: [126, 72, 24] as RGB,
  teakLit: [178, 112, 44] as RGB,
  bronzeDeep: [48, 24, 5] as RGB,
  bronzeMid: [118, 66, 12] as RGB,
  goldMid: [198, 136, 22] as RGB,
  goldBright: [246, 192, 54] as RGB,
  goldSpec: [255, 244, 182] as RGB,
  vaultShadow: [126, 102, 74] as RGB,
  vaultIvory: [226, 206, 172] as RGB,
};

// Perspective-tapered foreground chariot beam matched to Jatayu's rear gripping foot (x~865, y~496..602)
export const BEAM_TOP_Y = (x: number) => 136 + x * 0.4165;
export const BEAM_BOT_Y = (x: number) => 264 + x * 0.391;
const BEAM_SOFFIT_BOT = (x: number) => 298 + x * 0.386;

// True perspective-converging ceiling ribs beneath the main beam
const MID_BEAM_TOP = (x: number) => 432 + x * 0.335;
const MID_BEAM_BOT = (x: number) => 480 + x * 0.326;
const OUTER_RIM_TOP = (x: number) => 618 + x * 0.285;
const OUTER_RIM_BOT = (x: number) => 676 + x * 0.274;

interface CrossBeamSpec {
  xTop: number;
  xBot: number;
  halfW: number;
}

const CROSS_BEAMS: CrossBeamSpec[] = [
  { xTop: 268, xBot: 12, halfW: 22 },
  { xTop: 558, xBot: 268, halfW: 20 },
  { xTop: 865, xBot: 548, halfW: 19 },
  { xTop: 1185, xBot: 868, halfW: 18 },
  { xTop: 1495, xBot: 1190, halfW: 17 },
  { xTop: 1805, xBot: 1525, halfW: 16 },
];

function evalCrossBeamShadow(x: number, y: number): { dist: number; side: number } {
  let minD = 999;
  let bestSide = 0;
  for (const cb of CROSS_BEAMS) {
    const y0 = BEAM_SOFFIT_BOT(cb.xTop) - 12;
    const y1 = OUTER_RIM_BOT(cb.xBot) + 8;
    const vx = cb.xBot - cb.xTop;
    const vy = y1 - y0;
    const len = Math.hypot(vx, vy) || 1;
    const t = clamp(((x - cb.xTop) * vx + (y - y0) * vy) / (len * len), 0, 1);
    const cx = cb.xTop + vx * t;
    const cy = y0 + vy * t;
    const d = Math.hypot(x - cx, y - cy) - cb.halfW;
    if (d < minD) {
      minD = d;
      bestSide = ((x - cx) * -vy + (y - cy) * vx) / len;
    }
  }
  return { dist: minD, side: bestSide };
}

/**
 * Multi-scale Hoysala/Baroque Chased-Gold Temple Bas-Relief Heightfield (0..1).
 * Combines:
 *   1. Layered 12-petal central lotus mandala + beaded seed ring
 *   2. Sweeping S-scroll vine ribs connecting neighboring coffers
 *   3. Radiating spiral volutes surrounded by serrated feathery acanthus leaf fronds
 *   4. Fine chased hammered-gold granulation texture on raised leaf ridges
 */
function chasedGoldReliefHeight(u: number, v: number, tileSize = 116): number {
  // Subtle organic hand-carved warp so repeating carvings feel hand-sculpted rather than stamped
  const warpU = (fbm2D(u * 0.015, v * 0.015, 2, 307) - 0.5) * 9.5;
  const warpV = (fbm2D(u * 0.015 + 19.3, v * 0.015 + 7.1, 2, 619) - 0.5) * 9.5;
  const uu = u + warpU;
  const vv = v + warpV;

  // Fold into mirrored quadrant [0..1] x [0..1] inside each carved mandala tile
  const fu = (((uu / tileSize) % 1) + 1) % 1;
  const fv = (((vv / tileSize) % 1) + 1) % 1;
  const qx = Math.abs(fu - 0.5) * 2.0; // 0 at center -> 1 at border
  const qy = Math.abs(fv - 0.5) * 2.0;
  const r = Math.hypot(qx, qy);
  const ang = Math.atan2(qy, qx);

  // 1) Central Layered Temple Lotus Mandala
  const centerBoss = Math.exp(-Math.pow(r / 0.095, 2)) * 1.0;
  const innerBeadRing = Math.exp(-Math.pow((r - 0.145) / 0.032, 2)) * (0.65 + 0.35 * Math.cos(ang * 16));
  const innerPetals = Math.exp(-Math.pow((r - 0.25) / 0.075, 2)) * (0.48 + 0.52 * Math.cos(ang * 8));
  const outerPetals = Math.exp(-Math.pow((r - 0.41) / 0.09, 2)) * (0.42 + 0.58 * Math.cos(ang * 12 + 0.26));

  // 2) Sweeping Vine Stem & Serrated Acanthus Frond Lobes along diagonal & cardinal axes
  const vineCurve = Math.sin(qx * Math.PI * 1.15) * 0.22 + qx * 0.72;
  const dVine = Math.abs(qy - vineCurve);
  const mainStem = Math.exp(-Math.pow(dVine / 0.055, 2)) * smoothstep(0.28, 0.46, r);
  const crossStem = Math.exp(-Math.pow(Math.min(qx, qy) / 0.048, 2)) * smoothstep(0.32, 0.52, r);

  // 3) Corner Spiral Volute with Scalloped Acanthus Leaf Fronds radiating off the curl
  const vx = qx - 0.68;
  const vy = qy - 0.68;
  const vr = Math.hypot(vx, vy);
  const va = Math.atan2(vy, vx);
  const spiralArm = Math.exp(-Math.pow((vr - (0.09 + ((va + Math.PI) / (Math.PI * 2)) * 0.19)) / 0.045, 2));
  const voluteBud = Math.exp(-Math.pow(vr / 0.08, 2));
  const acanthusLobes =
    Math.exp(-Math.pow((vr - 0.26) / 0.11, 2)) *
    smoothstep(0.05, 0.78, Math.sin(va * 9 + vr * 16)) *
    0.88;

  // 4) Fine Interlocking Secondary Foil Scrolls filling negative pockets around r ~ 0.62
  const f2x = qx - 0.86;
  const f2y = qy - 0.32;
  const f2r = Math.hypot(f2x, f2y);
  const f2a = Math.atan2(f2y, f2x);
  const sideFoil = Math.exp(-Math.pow((f2r - 0.17) / 0.085, 2)) * (0.5 + 0.5 * Math.sin(f2a * 7)) * 0.82;
  const f3r = Math.hypot(qx - 0.32, qy - 0.86);
  const f3a = Math.atan2(qy - 0.86, qx - 0.32);
  const sideFoil2 = Math.exp(-Math.pow((f3r - 0.17) / 0.085, 2)) * (0.5 + 0.5 * Math.sin(f3a * 7)) * 0.82;

  const macroH = Math.max(
    centerBoss,
    innerBeadRing * 0.92,
    innerPetals * 0.94,
    outerPetals * 0.92,
    mainStem * 0.88,
    crossStem * 0.82,
    spiralArm * 0.92,
    voluteBud * 0.9,
    acanthusLobes,
    sideFoil,
    sideFoil2
  );

  // Subtle hammered gold chasing veins & micro-texture strictly on top of carved relief
  const vein = Math.sin(uu * 0.32 + vv * 0.28) * 0.035 * smoothstep(0.35, 0.8, macroH);
  const hammer = (fbm2D(uu * 0.14, vv * 0.14, 2, 911) - 0.5) * 0.09 * smoothstep(0.3, 0.85, macroH);

  return clamp(macroH + vein + hammer, 0, 1);
}

/**
 * 3D Normal-Map & Metallic Specular Shader for Chased Temple Gold.
 * Produces deep oxidized bronze crevices, gleaming burnished midtones, and crisp pinpoint metallic glints.
 */
function shadeChasedGold(h: number, dhdu: number, dhdv: number, sunBoost: number, reliefGain = 4.2): RGB {
  // Construct 3D micro-normal from relief height slope
  const nx = -dhdu * reliefGain;
  const ny = -dhdv * reliefGain;
  const invLen = 1 / Math.hypot(nx, ny, 1.0);
  const ux = nx * invLen;
  const uy = ny * invLen;
  const uz = invLen;

  // Primary directional sun from upper-left front (-0.54, -0.58, 0.61)
  const ndl = clamp(ux * -0.54 + uy * -0.58 + uz * 0.61, 0, 1);
  // Half-vector for Blinn-Phong metallic gold sheen (view = [0, 0, 1])
  const hx = -0.32;
  const hy = -0.34;
  const hz = 0.88;
  const ndh = clamp(ux * hx + uy * hy + uz * hz, 0, 1);

  // Cavity ambient occlusion deepens every crevice between carved petals & leaves
  const ao = smoothstep(0.08, 0.72, h);
  const lit = clamp((ndl * 0.72 + 0.14 + sunBoost * 0.22) * (0.35 + 0.65 * ao), 0, 1);

  let col = mixRgb(VIMANA_PAL.teakVoid, VIMANA_PAL.bronzeDeep, smoothstep(0.04, 0.24, lit));
  col = mixRgb(col, VIMANA_PAL.bronzeMid, smoothstep(0.22, 0.48, lit));
  col = mixRgb(col, VIMANA_PAL.goldMid, smoothstep(0.42, 0.68, lit));
  col = mixRgb(col, VIMANA_PAL.goldBright, smoothstep(0.64, 0.9, lit));

  const spec = Math.pow(ndh, 14) * ao * (0.55 + sunBoost * 0.65);
  col = mixRgb(col, VIMANA_PAL.goldSpec, clamp(spec, 0, 0.88));
  return col;
}

/**
 * High-detail carved lotus rosette + feathered acanthus vine heightfield for the upper-right vaulted arch.
 */
function vaultFriezeRelief(u: number, v: number): number {
  const period = 152;
  const localU = ((((u % period) + period) % period) - period * 0.5) / (period * 0.5);
  const localV = (v - 0.5) * 2;

  const warp = (fbm2D(u * 0.036, v * 5.5, 2, 701) - 0.5) * 0.1;
  const r = Math.hypot(localU, localV) + warp * 0.22;
  const ang = Math.atan2(localV, localU);

  const outerPetals = Math.exp(-Math.pow((r - 0.45) / 0.09, 2)) * (0.42 + 0.58 * Math.cos(ang * 12));
  const beadRing = Math.exp(-Math.pow((r - 0.31) / 0.034, 2)) * (0.62 + 0.38 * Math.cos(ang * 18));
  const innerPetals = Math.exp(-Math.pow((r - 0.2) / 0.055, 2)) * (0.5 + 0.5 * Math.cos(ang * 8 + 0.4));
  const boss = Math.exp(-Math.pow(r / 0.095, 2));

  const absU = Math.abs(localU);
  const waveY = Math.sin(absU * Math.PI * 1.45 + warp * 1.8) * 0.52;
  const stem1 = Math.exp(-Math.pow((localV - waveY) / 0.075, 2)) * smoothstep(0.46, 0.62, absU);
  const stem2 = Math.exp(-Math.pow((localV + waveY * 0.86) / 0.07, 2)) * smoothstep(0.48, 0.64, absU);

  // Scalloped acanthus tendrils curling around scroll pockets
  const vDist = Math.hypot((absU - 0.78) * 1.25, Math.abs(localV) - 0.34);
  const va = Math.atan2(Math.abs(localV) - 0.34, absU - 0.78);
  const volute = Math.exp(-Math.pow((vDist - 0.18) / 0.065, 2)) * (0.65 + 0.35 * Math.sin(va * 7));
  const volBud = Math.exp(-Math.pow(vDist / 0.075, 2));

  const chisel = (fbm2D(u * 0.16, v * 28, 2, 409) - 0.5) * 0.08;

  return clamp(
    Math.max(outerPetals * 0.96, beadRing * 0.9, innerPetals * 0.92, boss, stem1 * 0.9, stem2 * 0.88, volute * 0.9, volBud * 0.88) + chisel,
    0,
    1
  );
}

function evalBeamStrip(x: number, y: number, yTop: number, yBot: number) {
  const h = yBot - yTop;
  if (h <= 0.5) return { inside: false, v: 0, edgeDist: 0 };
  const v = (y - yTop) / h;
  if (v < -0.02 || v > 1.02) return { inside: false, v, edgeDist: 0 };
  const edgeDist = Math.min(y - yTop, yBot - y);
  return { inside: true, v: clamp(v, 0, 1), edgeDist };
}

/**
 * Photorealistic aged carved teak wood shader in local plank coordinates (u = along grain in px, v = across grain in px).
 * Models:
 *   1. Cathedral growth-ring arches (gradual warm earlywood -> crisp dark dense latewood edge)
 *   2. Anisotropic open teak wood pores / vessels with 1px bump-lit upper rims
 *   3. Subtle weathered hairline checks & silky directional wood fibers
 */
function sampleAgedTeakWood(u: number, v: number, lightLevel: number, seed = 613): RGB {
  // 1) Oblique sawn cathedral growth rings
  const warp = (fbm2D(u * 0.0042, v * 0.042, 2, seed) - 0.5) * 4.4;
  const ringPhase = v * 0.24 + warp + Math.sin(u * 0.0024 + seed * 0.1) * 2.1;
  const ringFrac = ((ringPhase % 1) + 1) % 1;
  const earlyWood = smoothstep(0.0, 0.24, ringFrac) * smoothstep(1.0, 0.74, ringFrac);
  const lateRingLine = Math.exp(-Math.pow((ringFrac - 0.89) / 0.075, 2));

  // 2) Short, crisp anisotropic open pores aligned along the grain (3D pit + lit top ridge!)
  const poreN = fbm2D(u * 0.062, v * 1.18, 2, seed + 173);
  const porePit = smoothstep(0.66, 0.83, poreN);
  const poreTopRim = smoothstep(0.65, 0.82, fbm2D(u * 0.062, (v + 1.0) * 1.18, 2, seed + 173)) * (1 - porePit);

  // 3) Silky longitudinal fiber sheen & rare seasoning hairline check
  const fibers = (fbm2D(u * 0.16, v * 2.1, 2, seed + 97) - 0.5) * 0.2;
  const crackField = fbm2D(u * 0.011, v * 0.42, 2, seed + 311);
  const hairlineSplit =
    Math.exp(-Math.pow((crackField - 0.5) / 0.022, 2)) *
    smoothstep(0.35, 0.75, Math.sin(u * 0.009 + seed)) *
    0.72;

  const baseTone = clamp(
    lightLevel * 0.76 + earlyWood * 0.22 + fibers - lateRingLine * 0.24 + poreTopRim * 0.14,
    0,
    1
  );

  let col = mixRgb(VIMANA_PAL.teakVoid, VIMANA_PAL.teakDeep, smoothstep(0.02, 0.22, baseTone));
  col = mixRgb(col, VIMANA_PAL.teakDark, smoothstep(0.2, 0.44, baseTone));
  col = mixRgb(col, VIMANA_PAL.teakMid, smoothstep(0.42, 0.7, baseTone));
  col = mixRgb(col, VIMANA_PAL.teakLit, smoothstep(0.68, 0.94, baseTone));

  // Oiled teak ridge highlight on sunlit surfaces
  if (lightLevel > 0.45 && poreTopRim > 0.1) {
    col = mixRgb(col, [216, 152, 74], poreTopRim * (lightLevel - 0.35) * 0.38);
  }

  // Deepen open wood pores, latewood lines & fine seasoning cracks
  const grooveDark = clamp(Math.max(porePit * 0.62, lateRingLine * 0.44, hairlineSplit), 0, 0.85);
  col = mixRgb(col, VIMANA_PAL.teakVoid, grooveDark);
  return col;
}

/**
 * Renders ~2,400 distant accompanying birds in sweeping aerial murmuration streams across the sky:
 *   - Multi-scale aerial perspective (1.8px hazy horizon specks -> 22px banked raptor silhouettes)
 *   - Organic wingbeat phases, cambered gull/raptor wing arcs, fanned tails & sunlit upper rims
 *   - Drawn behind the Pushpaka Vimana pillars, pierced Jali lattice & Jatayu for true 3D depth
 */
function renderAccompanyingBirds(pixels: Uint8ClampedArray, paper: PaperSubstrate) {
  const { width: W, height: H, tooth } = paper;
  const rng = createRng(202699);

  interface SkyBird {
    x: number;
    y: number;
    span: number;
    heading: number;
    bank: number;
    flap: number;
    depth: number;
  }

  const birds: SkyBird[] = [];

  const pushStream = (
    count: number,
    xMin: number,
    xMax: number,
    pathY: (t: number) => number,
    spreadY: (t: number) => number,
    baseHeading: number,
    depthBias: number
  ) => {
    for (let i = 0; i < count; i++) {
      const t = rng();
      const gauss = (rng() + rng() + rng() - 1.5) * 0.72;
      const x = lerp(xMin, xMax, t) + (rng() - 0.5) * 28;
      const y = pathY(t) + gauss * spreadY(t);
      if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;

      // Natural thermal clumping via FBM so flocks gather organically instead of uniform noise
      const cluster = fbm2D(x * 0.0045, y * 0.0045, 2, 353);
      if (cluster < 0.34 && rng() < 0.65) continue;

      const dRaw = Math.pow(rng(), 2.25);
      const depth = clamp(dRaw * depthBias + (1 - Math.abs(gauss) * 0.4) * 0.14, 0.02, 1.0);
      const span = lerp(1.9, 22.0, Math.pow(depth, 1.45));
      birds.push({
        x,
        y,
        span,
        heading: baseHeading + (rng() - 0.5) * 0.42,
        bank: (rng() - 0.5) * 0.65,
        flap: (rng() - 0.5) * 1.15,
        depth,
      });
    }
  };

  // Stream 1: Upper-left sweeping aerial retinue soaring along the chariot toward Jatayu
  pushStream(
    620,
    -20,
    720,
    (t) => lerp(60, 290, t) + Math.sin(t * Math.PI * 1.7) * 58,
    (t) => lerp(145, 78, t),
    -0.26,
    0.88
  );

  // Stream 2: Vast lower-sky billowing murmuration rivers behind the Vimana pillars
  pushStream(
    980,
    -30,
    1580,
    (t) => lerp(735, 965, t) + Math.sin(t * Math.PI * 2.2 + 0.5) * 72,
    (t) => lerp(180, 115, t),
    -0.38,
    0.96
  );

  // Stream 3: Far-horizon thermal swarm (thousands of tiny misty distant companions)
  pushStream(
    860,
    0,
    1720,
    (t) => lerp(810, 1020, t) + Math.cos(t * Math.PI * 3.1) * 68,
    () => 165,
    -0.32,
    0.34
  );

  // Stream 4: Upper-right & far-right flanking flock trailing behind Jatayu's wing
  pushStream(
    360,
    1260,
    1930,
    (t) => lerp(52, 235, t) + Math.sin(t * Math.PI * 1.4) * 34,
    () => 86,
    -0.44,
    0.72
  );
  pushStream(
    220,
    1620,
    1930,
    (t) => lerp(540, 820, t),
    () => 145,
    -0.36,
    0.58
  );

  // Paint farthest atmospheric specks first, crisp closer birds last
  birds.sort((a, b) => a.depth - b.depth);

  for (const b of birds) {
    const halfSpan = b.span * 0.5;
    const pad = Math.ceil(halfSpan * 1.25 + 3);
    const minX = Math.max(0, Math.floor(b.x - pad));
    const maxX = Math.min(W - 1, Math.ceil(b.x + pad));
    const minY = Math.max(0, Math.floor(b.y - pad));
    const maxY = Math.min(H - 1, Math.ceil(b.y + pad));

    // Forward flight unit vector (fx, fy) and lateral wingspan right vector (rx, ry)
    const fx = Math.cos(b.heading);
    const fy = Math.sin(b.heading);
    const rx = -fy;
    const ry = fx;
    const invHalf = 1 / Math.max(0.8, halfSpan);
    const isTiny = b.span <= 4.8;

    // Atmospheric perspective color: hazy sky-slate far away -> rich umber-charcoal closer up
    const skyHaze: RGB = [124, 160, 202];
    const farBird: RGB = [58, 72, 94];
    const nearBelly: RGB = [26, 20, 18];
    const nearRim: RGB = [152, 120, 84];
    const baseDark = mixRgb(mixRgb(skyHaze, farBird, smoothstep(0.02, 0.35, b.depth)), nearBelly, smoothstep(0.28, 0.92, b.depth));
    const birdAlpha = lerp(0.42, 0.94, smoothstep(0.04, 0.72, b.depth));

    for (let y = minY; y <= maxY; y++) {
      const dy = y - b.y;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - b.x;
        // Local coordinates: u = lateral wingspan (-1..1), v = forward flight axis (+v nose, -v tail)
        const uRaw = (dx * rx + dy * ry) * invHalf;
        const vRaw = (dx * fx + dy * fy) * invHalf;

        const bankScale = 1 + (uRaw < 0 ? -b.bank : b.bank) * 0.24;
        const u = uRaw / Math.max(0.45, bankScale);
        const absU = Math.abs(u);
        if (absU > 1.08) continue;

        // Cambered raptor/gull M-wing curve + dihedral flap + graceful swept-back wingtips
        const flapLift = Math.sin(absU * Math.PI * 0.9) * b.flap * 0.32 - absU * absU * 0.28;
        const bankTilt = u * b.bank * 0.22;
        const wingCenterV = flapLift + bankTilt;

        // Chord thickness tapers smoothly from shoulder/elbow out to crisp feather tips
        const wingThick = isTiny
          ? lerp(0.24, 0.09, Math.pow(absU, 0.8))
          : lerp(0.2, 0.055, Math.pow(absU, 0.85)) * (1 + Math.exp(-Math.pow((absU - 0.35) / 0.2, 2)) * 0.28);

        const dWing = Math.abs(vRaw - wingCenterV) / wingThick;
        let shapeIn = 1 - dWing;

        // Small central bird fuselage (head forward + fanned wedge tail behind)
        if (absU < 0.24) {
          const bodyV = vRaw / (isTiny ? 0.34 : 0.44);
          const bodyU = u / (vRaw < -0.05 ? lerp(0.11, 0.17, clamp(-vRaw / 0.42, 0, 1)) : 0.11);
          const bodyIn = 1 - Math.hypot(bodyU, bodyV);
          if (bodyIn > shapeIn) shapeIn = bodyIn;
        }

        const edgeSoft = isTiny ? 0.45 : 0.28;
        const mask = smoothstep(-edgeSoft, edgeSoft, shapeIn);
        if (mask <= 0.02) continue;

        let col = baseDark;
        if (!isTiny && b.depth > 0.38) {
          // Subtle sunlit upper-edge rim highlight on mid/closer raptors
          const sunRim = smoothstep(-0.2, 0.55, -dy * invHalf) * smoothstep(0.35, 0.9, b.depth);
          col = mixRgb(col, nearRim, sunRim * 0.52);
        }

        const idx = y * W + x;
        const grain = (tooth[idx] - 0.5) * 4;
        paintPixelRGB(
          pixels,
          idx,
          clamp(col[0] + grain, 0, 255),
          clamp(col[1] + grain, 0, 255),
          clamp(col[2] + grain, 0, 255),
          mask * birdAlpha
        );
      }
    }
  }
}

/**
 * Renders the dramatic sunlit sky & intricately carved Pushpaka Vimana palace interior behind Jatayu.
 */
export function renderVimanaBackground(pixels: Uint8ClampedArray, paper: PaperSubstrate) {
  const { width: W, height: H, tooth } = paper;

  // 1. Luminous Cerulean Sky, Sculpted Cumulus Clouds & Sunlit Horizon Haze
  for (let y = 0; y < H; y++) {
    const ny = y / H;
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const nx = x / W;
      let col = mixRgb(SKY_PAL.skyZenith, SKY_PAL.skyMid, clamp(ny * 0.84 + nx * 0.16, 0, 1));
      col = mixRgb(col, SKY_PAL.skyHorizon, smoothstep(0.46, 1.0, ny * 0.84 + (1 - nx) * 0.3));

      // Warm golden atmospheric sun scatter near upper-left & lower-left horizon
      const sunHaze = Math.exp(-Math.pow((x - 240) / 560, 2) - Math.pow((y - 820) / 480, 2)) * 0.28;
      col = mixRgb(col, [252, 242, 220], sunHaze);

      const cMain = fbm2D(x * 0.0038, y * 0.0054, 4, 809);
      const cDetail = fbm2D(x * 0.011 + 17.3, y * 0.014 + 5.1, 3, 991);
      const cBelly = fbm2D(x * 0.0038 + 0.08, y * 0.0054 - 0.12, 3, 809);
      const cField = cMain * 0.78 + cDetail * 0.22;
      if (cField > 0.5) {
        const cloudMask = smoothstep(0.5, 0.74, cField);
        const cloudShade = smoothstep(0.46, 0.76, cBelly);
        const cloudCol = mixRgb([196, 214, 232], SKY_PAL.cloudWhite, clamp(cloudShade * 0.88 + 0.18, 0, 1));
        col = mixRgb(col, cloudCol, cloudMask * 0.88);
      }

      const shade = (tooth[idx] - 0.5) * 7;
      paintPixelRGB(
        pixels,
        idx,
        clamp(col[0] + shade, 0, 255),
        clamp(col[1] + shade, 0, 255),
        clamp(col[2] + shade, 0, 255),
        1.0
      );
    }
  }

  // 1B. Thousands of Accompanying Distant Birds Soaring in Aerial Murmurations Behind Vimana & Jatayu
  renderAccompanyingBirds(pixels, paper);

  /**
   * True rectangular architectural beam/column with planar corner arris & subtle aerial perspective depth.
   */
  const paintPlanarTimber = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    halfWTop: number,
    halfWBot: number,
    sunFaceRatio: number,
    rimLight: number,
    clipMinY?: (x: number) => number,
    clipMaxY?: (x: number) => number,
    capitalAtStart = false,
    hazeAmt = 0.0
  ) => {
    const vx = x1 - x0;
    const vy = y1 - y0;
    const len = Math.hypot(vx, vy) || 1;
    const len2 = len * len;
    const pad = Math.max(halfWTop, halfWBot) + 18;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + pad));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + pad));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (clipMinY && y < clipMinY(x)) continue;
        if (clipMaxY && y > clipMaxY(x)) continue;

        const px = x - x0;
        const py = y - y0;
        const t = (px * vx + py * vy) / len2;
        if (t < -0.02 || t > 1.02) continue;

        const cx = x0 + vx * t;
        const cy = y0 + vy * t;
        const lat = ((x - cx) * -vy + (y - cy) * vx) / len;
        const dist = Math.abs(lat);

        const capFlare = capitalAtStart ? smoothstep(0.14, 0.0, t) * 14 : 0;
        const curHalfW = lerp(halfWTop, halfWBot, clamp(t, 0, 1)) + capFlare;
        if (dist > curHalfW + 1.5) continue;

        const alpha = smoothstep(curHalfW + 1.5, curHalfW - 0.8, dist);
        const sNorm = lat / Math.max(1, curHalfW);
        const uTimber = t * len;
        const vTimber = lat * 1.15;

        const splitS = -1 + sunFaceRatio * 2;
        let col: RGB;
        if (sNorm < splitS) {
          const faceT = clamp((sNorm + 1) / Math.max(0.1, splitS + 1), 0, 1);
          col = sampleAgedTeakWood(uTimber, vTimber, clamp(0.84 - faceT * 0.28, 0.35, 0.95), 419);
          const edgeGlow = Math.exp(-Math.pow((sNorm + 0.92) / 0.1, 2)) * rimLight;
          col = mixRgb(col, VIMANA_PAL.goldBright, clamp(edgeGlow * 0.72, 0, 0.72));
        } else {
          const shadeT = clamp((sNorm - splitS) / Math.max(0.1, 1 - splitS), 0, 1);
          col = sampleAgedTeakWood(uTimber, vTimber, clamp(0.32 - shadeT * 0.24, 0.04, 0.38), 523);
          const cornerHi = Math.exp(-Math.pow((sNorm - splitS) / 0.08, 2)) * rimLight * 0.45;
          col = mixRgb(col, VIMANA_PAL.teakMid, cornerHi);
        }

        if (capitalAtStart && t < 0.13) {
          const capBand = Math.exp(-Math.pow((t - 0.085) / 0.014, 2));
          const topOcc = smoothstep(0.08, 0.0, t) * 0.78;
          col = mixRgb(col, VIMANA_PAL.teakVoid, clamp(Math.max(topOcc, capBand * 0.65), 0, 0.9));
        }

        if (hazeAmt > 0.01) {
          col = mixRgb(col, SKY_PAL.skyMid, hazeAmt);
        }

        const idx = y * W + x;
        const grain = (tooth[idx] - 0.5) * 6;
        paintPixelRGB(pixels, idx, clamp(col[0] + grain, 0, 255), clamp(col[1] + grain, 0, 255), clamp(col[2] + grain, 0, 255), alpha);
      }
    }
  };

  // 2. Massive Planar Perspective Pillars (Foreground bold & dark; background columns subtly depth-hazed!)
  paintPlanarTimber(238, 738, 92, 1110, 28, 46, 0.28, 0.65, (x) => OUTER_RIM_BOT(x) - 10, undefined, true, 0.0);
  paintPlanarTimber(445, 796, 336, 1110, 19, 30, 0.24, 0.42, (x) => OUTER_RIM_BOT(x) - 10, undefined, true, 0.12);
  paintPlanarTimber(768, 882, 682, 1110, 21, 32, 0.22, 0.36, (x) => OUTER_RIM_BOT(x) - 10, undefined, true, 0.18);
  paintPlanarTimber(1148, 982, 1086, 1110, 20, 28, 0.24, 0.38, (x) => OUTER_RIM_BOT(x) - 10, undefined, true, 0.12);
  paintPlanarTimber(1612, 470, 1848, 925, 21, 24, 0.22, 0.45, undefined, (x) => BEAM_TOP_Y(x) + 12);

  // 3. Coffered Golden Temple Canopy Beneath Main Beam (Multi-Scale Chased Bas-Relief + 3D Normal Shading!)
  for (let y = 260; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const yTopCut = BEAM_SOFFIT_BOT(x) - 12;
      const yMidCut = (MID_BEAM_TOP(x) + MID_BEAM_BOT(x)) * 0.5;
      const yOuterCut = OUTER_RIM_BOT(x) - 6;
      if (y < yTopCut || y > yOuterCut) continue;

      const isOuterBay = y > yMidCut;
      const bayTop = isOuterBay ? yMidCut : yTopCut;
      const bayBot = isOuterBay ? yOuterCut : yMidCut;
      const bayT = clamp((y - bayTop) / Math.max(24, bayBot - bayTop), 0, 1);

      const convScale = lerp(0.92, 1.48, x / W);
      const u = x * convScale + (y - yTopCut) * 0.78;
      const v = (y - bayTop) * (isOuterBay ? 1.88 : 1.58) * convScale;
      const tile = isOuterBay ? 88 : 112;

      const h = chasedGoldReliefHeight(u, v, tile);
      const dhdu = chasedGoldReliefHeight(u + 1.4, v, tile) - h;
      const dhdv = chasedGoldReliefHeight(u, v + 1.4, tile) - h;

      // Cast shadows onto ceiling panels from overhanging beam soffits & transverse ribs
      const topCofferShadow = smoothstep(bayTop + 76, bayTop + 6, y) * (isOuterBay ? 0.54 : 0.7);
      const botCofferShadow = smoothstep(bayBot - 22, bayBot, y) * 0.45;
      const { dist: cbDist, side: cbSide } = evalCrossBeamShadow(x, y);
      const ribCastShadow = cbSide < 0 ? smoothstep(42, 0, cbDist) * 0.64 : smoothstep(14, 0, cbDist) * 0.44;
      const totalCofferShadow = clamp(Math.max(topCofferShadow, botCofferShadow, ribCastShadow), 0, 0.84);

      const wingShadow = smoothstep(780, 1180, x) * smoothstep(760, 560, y) * 0.48;
      const sunWash = Math.exp(-Math.pow(Math.hypot((x - 260) / 440, (y - 460) / 190), 2)) * 0.65;

      const borderRim = smoothstep(0.11, 0.02, bayT) + smoothstep(0.89, 0.98, bayT);
      const idx = y * W + x;
      const grain = (tooth[idx] - 0.5) * 6;

      if (!isOuterBay) {
        // INNER BAY: Deeply recessed bronze ground + finely chiseled 3D gold lotus & acanthus carvings
        let col = shadeChasedGold(h, dhdu, dhdv, sunWash, 4.4);
        if (borderRim > 0.1) {
          col = mixRgb(col, VIMANA_PAL.goldBright, borderRim * 0.32);
        }
        col = mixRgb(col, VIMANA_PAL.teakVoid, clamp(Math.max(totalCofferShadow, wingShadow), 0, 0.86));
        paintPixelRGB(pixels, idx, clamp(col[0] + grain, 0, 255), clamp(col[1] + grain, 0, 255), clamp(col[2] + grain, 0, 255), 1.0);
      } else {
        // OUTER BAY: Intricate lacy pierced Jali lattice (delicate filigree cutouts over warm backlit sky!)
        const holeCut = lerp(0.32, 0.44, bayT);
        const metalMask = Math.max(smoothstep(holeCut - 0.06, holeCut + 0.06, h), borderRim * 0.9);
        if (metalMask <= 0.02) continue;

        let col = shadeChasedGold(h, dhdu, dhdv, sunWash + 0.16, 4.0);
        // Subtle sunlit gold rim-bleed around lacy pinhole openings
        const laceEdge = smoothstep(holeCut + 0.14, holeCut, h) * 0.35;
        col = mixRgb(col, VIMANA_PAL.goldSpec, laceEdge * (0.4 + sunWash * 0.5));
        col = mixRgb(col, VIMANA_PAL.teakVoid, clamp(totalCofferShadow * 0.72, 0, 0.78));
        paintPixelRGB(pixels, idx, clamp(col[0] + grain, 0, 255), clamp(col[1] + grain, 0, 255), clamp(col[2] + grain, 0, 255), metalMask);
      }
    }
  }

  // 4. Transverse Perspective Ceiling Ribs
  for (const cb of CROSS_BEAMS) {
    const y0 = BEAM_SOFFIT_BOT(cb.xTop) - 12;
    const y1 = OUTER_RIM_BOT(cb.xBot) + 4;
    paintPlanarTimber(
      cb.xTop,
      y0,
      cb.xBot,
      y1,
      cb.halfW * 0.85,
      cb.halfW * 1.15,
      0.24,
      0.48,
      (x) => BEAM_SOFFIT_BOT(x) - 14,
      (x) => OUTER_RIM_BOT(x) - 4
    );
  }

  // 5. Longitudinal Coffered Framing Beams (With Broad Dark Underside Soffit + Carved Top Beading)
  for (let y = 415; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const b1 = evalBeamStrip(x, y, MID_BEAM_TOP(x), MID_BEAM_BOT(x));
      const b2 = evalBeamStrip(x, y, OUTER_RIM_TOP(x), OUTER_RIM_BOT(x));
      const b = b1.inside ? b1 : b2.inside ? b2 : null;
      if (!b) continue;

      const idx = y * W + x;
      const alpha = smoothstep(0, 2.2, b.edgeDist);
      const v = b.v;
      const uLong = x * 1.06;
      const vLong = v * 48;

      let col: RGB;
      if (v < 0.28) {
        const dentPhase = (((x * 0.044) % 1) + 1) % 1;
        const dentTooth = smoothstep(0.16, 0.3, dentPhase) * smoothstep(0.84, 0.7, dentPhase);
        const woodRim = sampleAgedTeakWood(uLong, vLong, 0.68, 577);
        col = mixRgb(woodRim, VIMANA_PAL.goldBright, smoothstep(0.28, 0.04, v) * (0.28 + dentTooth * 0.52));
      } else if (v < 0.44) {
        col = sampleAgedTeakWood(uLong, vLong, 0.56, 577);
      } else {
        col = sampleAgedTeakWood(uLong, vLong, clamp(0.24 - (v - 0.44) * 0.26, 0.04, 0.28), 577);
      }

      const grain = (tooth[idx] - 0.5) * 7;
      paintPixelRGB(pixels, idx, clamp(col[0] + grain, 0, 255), clamp(col[1] + grain, 0, 255), clamp(col[2] + grain, 0, 255), alpha);
    }
  }

  // 6. Upper-Left Multi-Tiered Roof Soffits, Carved Golden Gable & Coffered Concave Pushpaka Dome
  for (let y = 0; y < 395; y++) {
    for (let x = 155; x < 1265; x++) {
      const stepEaveY = -98 + x * 0.555;
      const domeCurveY = 232 - Math.pow((x - 740) / 380, 2) * 145 + Math.sin(clamp((x - 560) / 620, 0, 1) * Math.PI) * 34;
      const roofBotY = x < 565 ? stepEaveY : lerp(stepEaveY, domeCurveY, smoothstep(555, 620, x));
      if (y > roofBotY) continue;

      const idx = y * W + x;
      const distEdge = roofBotY - y;
      const alpha = smoothstep(0, 2.5, distEdge);

      const gableLeftX = 552 + (y + 10) * (24 / 226);
      const gableRightX = 694 + (y + 10) * (46 / 188);
      const inGoldGable = x > gableLeftX + 6 && x < gableRightX - 6 && distEdge > 18 && y > 10;
      const alcoveBlend =
        smoothstep(744, 796, x) *
        smoothstep(948, 865, x) *
        smoothstep(105, 40, distEdge) *
        smoothstep(8, 24, distEdge) *
        smoothstep(132, 172, y);

      let col: RGB;

      if (inGoldGable) {
        const gu = x * 1.35 + y * 0.22;
        const gv = y * 1.35 + x * 0.14;
        const h = chasedGoldReliefHeight(gu, gv, 86);
        const dhdu = chasedGoldReliefHeight(gu + 1.4, gv, 86) - h;
        const dhdv = chasedGoldReliefHeight(gu, gv + 1.4, 86) - h;

        const frameShadow = Math.max(
          smoothstep(28, 0, y) * 0.62,
          smoothstep(gableLeftX + 26, gableLeftX + 6, x) * 0.55,
          smoothstep(gableRightX - 24, gableRightX - 6, x) * 0.45
        );

        col = shadeChasedGold(h, dhdu, dhdv, 0.35, 4.4);
        col = mixRgb(col, VIMANA_PAL.teakVoid, frameShadow);
      } else if (x < 680) {
        // Multi-tiered stepped underside roof cornice slats with real sawn teak wood grain
        const slat = Math.sin((y - x * 0.555) * 0.34) * 0.5 + 0.5;
        const tierStep = Math.exp(-Math.pow((distEdge - 36) / 4.5, 2)) * 0.5;
        const uEave = x * 0.87 + y * 0.49;
        const vEave = -x * 0.49 + y * 0.87;
        const edgeBoost = distEdge < 18 ? smoothstep(18, 2, distEdge) * 0.34 : 0;
        col = sampleAgedTeakWood(uEave, vEave, clamp(0.14 + slat * 0.16 + edgeBoost, 0.04, 0.58), 233);
        col = mixRgb(col, VIMANA_PAL.goldMid, tierStep);
      } else {
        // Curved concave Pushpaka Vimana dome with radial carved timber rafters & shadowed chased-gold coffers
        const dAng = Math.atan2(y - 380, x - 920);
        const dRad = Math.hypot(x - 920, y - 380);
        const rafterPhase = (((dAng * 9.5) % 1) + 1) % 1;
        const isRafter = Math.exp(-Math.pow((rafterPhase - 0.5) / 0.14, 2));
        const ringBand = Math.exp(-Math.pow(((((dRad * 0.016) % 1) + 1) % 1) - 0.5, 2) / 0.022);

        const gu = dAng * 420;
        const gv = dRad * 1.1;
        const h = chasedGoldReliefHeight(gu, gv, 84);
        const dhdu = chasedGoldReliefHeight(gu + 1.4, gv, 84) - h;
        const dhdv = chasedGoldReliefHeight(gu, gv + 1.4, 84) - h;
        let cofferGold = shadeChasedGold(h, dhdu, dhdv, 0.08, 4.0);
        cofferGold = mixRgb(cofferGold, VIMANA_PAL.teakVoid, 0.56);

        const rafterCol = sampleAgedTeakWood(dRad, rafterPhase * 28, 0.18, 487);
        col = mixRgb(cofferGold, rafterCol, clamp(Math.max(isRafter * 0.88, ringBand * 0.72), 0, 0.92));

        const radialSpec = Math.exp(-Math.pow(distEdge / 22, 2)) * smoothstep(660, 820, x);
        col = mixRgb(col, VIMANA_PAL.goldMid, radialSpec * 0.62);

        if (alcoveBlend > 0.02) {
          const agu = x * 1.35 + y * 0.22;
          const agv = y * 1.35 + x * 0.14;
          const ah = chasedGoldReliefHeight(agu, agv, 86);
          const adhdu = chasedGoldReliefHeight(agu + 1.4, agv, 86) - ah;
          const adhdv = chasedGoldReliefHeight(agu, agv + 1.4, 86) - ah;
          const alcoveCol = shadeChasedGold(ah, adhdu, adhdv, 0.48, 4.4);
          col = mixRgb(col, alcoveCol, alcoveBlend);
        }
      }

      const nGrain = (tooth[idx] - 0.5) * 6;
      paintPixelRGB(pixels, idx, clamp(col[0] + nGrain, 0, 255), clamp(col[1] + nGrain, 0, 255), clamp(col[2] + nGrain, 0, 255), alpha);
    }
  }
  paintPlanarTimber(168, -14, 568, 212, 16, 18, 0.25, 0.42);
  paintPlanarTimber(552, -10, 578, 216, 12, 13, 0.3, 0.45);
  paintPlanarTimber(694, -10, 742, 178, 15, 16, 0.25, 0.32);

  // 7. Upper-Right Grand Concave Burnished Sandstone & Carved Gold Vaulted Arch
  const corniceBotY = (x: number) => -24 + (x - 1080) * 0.406;
  for (let y = 0; y < 625; y++) {
    const leftClipX = 1152 + y * 0.26;
    for (let x = 1152; x < W; x++) {
      if (x < leftClipX) continue;
      const curveArchY = 395 + (x - 1340) * 0.34 - Math.sin(clamp((x - 1160) / 760, 0, 1) * Math.PI) * 75;
      if (y > curveArchY || y < corniceBotY(x) - 10) continue;

      const idx = y * W + x;
      const distRim = curveArchY - y;
      const alpha = smoothstep(0, 3.0, distRim);

      const slopeApprox = 0.34 - Math.cos(clamp((x - 1160) / 760, 0, 1) * Math.PI) * 0.31;
      const tangentLen = Math.hypot(1, slopeApprox);
      const u = (x - 1140) * tangentLen + (distRim - 140) * slopeApprox * 0.45;
      const bandT = clamp((distRim - 48) / 188, 0, 1);

      // Subtle depth shadow behind Jatayu's hunched nape & wing
      const jatayuVaultShadow = Math.exp(-Math.pow((x - 1200) / 185, 2) - Math.pow((y - 255) / 170, 2)) * 0.24;

      let col: RGB;
      if (distRim < 28) {
        // Curved fluted 3D golden arch molding rim
        const dentPhase = (((x * 0.044) % 1) + 1) % 1;
        const dentBlock = smoothstep(0.14, 0.28, dentPhase) * smoothstep(0.86, 0.72, dentPhase);
        const flute = Math.exp(-Math.pow((dentPhase - 0.5) / 0.14, 2)) * 0.22;
        const rimShade = smoothstep(0, 12, distRim) * smoothstep(28, 12, distRim);
        col = mixRgb(VIMANA_PAL.teakVoid, VIMANA_PAL.goldBright, clamp(0.24 + rimShade * 0.44 + dentBlock * 0.34 - flute, 0, 1));
      } else if (distRim < 48) {
        col = mixRgb(VIMANA_PAL.teakVoid, VIMANA_PAL.teakDeep, 0.42);
      } else if (distRim < 238) {
        // Warm sandstone concave cove with high-relief sculpted lotus rosettes & scalloped acanthus tendrils
        const topCorniceShade = smoothstep(corniceBotY(x) + 46, corniceBotY(x), y) * 0.52;
        const coveCurveLit = clamp(0.64 - bandT * 0.36 + (x - 1220) / 1550 - topCorniceShade - jatayuVaultShadow, 0, 1);
        const plasterGrain = (fbm2D(x * 0.055, y * 0.055, 2, 431) - 0.5) * 10;
        const ivoryBase = mixRgb(VIMANA_PAL.vaultShadow, VIMANA_PAL.vaultIvory, coveCurveLit);
        const ivoryTone: RGB = [
          clamp(ivoryBase[0] + plasterGrain, 0, 255),
          clamp(ivoryBase[1] + plasterGrain, 0, 255),
          clamp(ivoryBase[2] + plasterGrain, 0, 255),
        ];

        const relief = vaultFriezeRelief(u, bandT);
        const reliefDx = vaultFriezeRelief(u + 1.8, bandT) - relief;
        const reliefDy = vaultFriezeRelief(u, bandT + 0.01) - relief;
        const goldMask = smoothstep(0.36, 0.52, relief);

        const goldCol = shadeChasedGold(relief, reliefDx, reliefDy * 6.0, 0.32 - topCorniceShade * 0.38, 4.2);
        const dropShadow = smoothstep(0.34, 0.5, vaultFriezeRelief(u - 3.6, bandT - 0.018)) * (1 - goldMask) * 0.48;
        col = mixRgb(ivoryTone, VIMANA_PAL.teakDark, dropShadow);
        col = mixRgb(col, goldCol, goldMask);
        col = mixRgb(col, VIMANA_PAL.teakVoid, jatayuVaultShadow * 0.28);
      } else if (distRim < 274) {
        // Inner carved golden rope & dentil arch rib framing the upper palace vault!
        const ribDent = Math.sin(x * 0.16) * 0.5 + 0.5;
        col = mixRgb(VIMANA_PAL.bronzeDeep, VIMANA_PAL.goldBright, 0.32 + ribDent * 0.54);
      } else {
        // UPPER-RIGHT PALACE VAULT DOME: Deeply shadowed & richly embossed antique gold coffer ceiling!
        const du = u * 1.15;
        const dv = (distRim - 274) * 1.25;
        const h = chasedGoldReliefHeight(du, dv, 96);
        const dhdu = chasedGoldReliefHeight(du + 1.4, dv, 96) - h;
        const dhdv = chasedGoldReliefHeight(du, dv + 1.4, 96) - h;
        const vaultShade = clamp(0.18 - smoothstep(320, 480, distRim) * 0.14, 0, 0.3);
        col = shadeChasedGold(h, dhdu, dhdv, vaultShade, 4.2);
        col = mixRgb(col, VIMANA_PAL.teakVoid, 0.42);
      }

      const grain = (tooth[idx] - 0.5) * 7;
      paintPixelRGB(pixels, idx, clamp(col[0] + grain, 0, 255), clamp(col[1] + grain, 0, 255), clamp(col[2] + grain, 0, 255), alpha);
    }
  }
  paintPlanarTimber(1080, -24, 1940, 325, 22, 24, 0.24, 0.42);
}

/**
 * Renders the perspective-tapered foreground Pushpaka Vimana chariot beam:
 *   - Fluted 3D dentil console blocks (top & bottom courses) with dark hollow pockets
 *   - Rich weathered honey-teak fascia with fine wood pores, beveled channels & chased lotus medallions
 *   - Broad dark underside soffit & deep cast contact shadows from Jatayu
 */
export function renderVimanaMainBeam(pixels: Uint8ClampedArray, paper: PaperSubstrate) {
  const { width: W, height: H, tooth } = paper;

  const medallionXs = [58, 268, 482, 696, 1308, 1528, 1746];

  for (let x = 0; x < W; x++) {
    const topY = BEAM_TOP_Y(x);
    const frontBotY = BEAM_BOT_Y(x);
    const soffitBotY = BEAM_SOFFIT_BOT(x);
    const frontH = frontBotY - topY;
    const minY = Math.max(0, Math.floor(topY - 3));
    const maxY = Math.min(H - 1, Math.ceil(soffitBotY + 3));

    const perspScale = lerp(1.0, 1.38, x / W);
    const alongDist = x * 1.078 * (0.94 + (x / W) * 0.16);

    const footOcc = Math.exp(-Math.pow((x - 865) / 96, 2)) * 0.68;
    const armOcc = Math.exp(-Math.pow((x - 1110) / 135, 2)) * 0.62;
    const wingOcc = Math.exp(-Math.pow((x - 1520) / 170, 2)) * 0.38;
    const occlusion = clamp(Math.max(footOcc, armOcc, wingOcc), 0, 0.72);

    let medDx = 0;
    let medCy = 0;
    let medR = 21;
    let hasMed = false;
    for (const mx of medallionXs) {
      const localR = lerp(23.5, 16.0, mx / W);
      if (Math.abs(x - mx) < localR * 1.45) {
        hasMed = true;
        medDx = x - mx;
        medCy = (BEAM_TOP_Y(mx) + BEAM_BOT_Y(mx)) * 0.51;
        medR = localR;
        break;
      }
    }

    for (let y = minY; y <= maxY; y++) {
      const idx = y * W + x;

      // 1) Broad Dark Underside Soffit Plane (y = frontBotY .. soffitBotY) with real dark wood rings & pores
      if (y > frontBotY) {
        const sv = (y - frontBotY) / Math.max(4, soffitBotY - frontBotY);
        if (sv > 1.03) continue;
        const sAlpha = smoothstep(1.03, 0.92, sv);
        const soffitRidge = Math.exp(-Math.pow((sv - 0.26) / 0.1, 2)) * 0.24;
        let sCol = sampleAgedTeakWood(alongDist, sv * 36, clamp(0.24 - sv * 0.18 + soffitRidge, 0.04, 0.34), 311);
        if (occlusion > 0.02) {
          sCol = mixRgb(sCol, VIMANA_PAL.teakVoid, occlusion * 0.65);
        }
        const grain = (tooth[idx] - 0.5) * 6;
        paintPixelRGB(pixels, idx, clamp(sCol[0] + grain, 0, 255), clamp(sCol[1] + grain, 0, 255), clamp(sCol[2] + grain, 0, 255), sAlpha);
        continue;
      }

      const v = (y - topY) / frontH;
      if (v < -0.02 || v > 1.0) continue;

      const edgeAlpha = smoothstep(-0.02, 0.014, v);
      if (edgeAlpha <= 0.01) continue;

      const uBeam = alongDist;
      const vBeam = v * frontH;

      let col: RGB;

      if (v < 0.185) {
        // Fluted 3D Top Console Dentils with vertical teak grain + crisp chamfers & black hollow slots
        const blockPhase = (((alongDist * 0.038 * perspScale) % 1) + 1) % 1;
        const inTooth = smoothstep(0.11, 0.21, blockPhase) * smoothstep(0.89, 0.79, blockPhase);
        const topRail = smoothstep(0.036, 0.01, v);
        const chamferLit = smoothstep(0.085, 0.032, v) * inTooth;
        const leftBevel = smoothstep(0.32, 0.15, blockPhase) * inTooth;
        const rightShadow = smoothstep(0.68, 0.85, blockPhase) * inTooth;
        const centerFlute = Math.exp(-Math.pow((blockPhase - 0.5) / 0.09, 2)) * smoothstep(0.055, 0.11, v) * smoothstep(0.17, 0.12, v);

        const blockFace = sampleAgedTeakWood(uBeam, vBeam, clamp(0.56 + leftBevel * 0.34 - rightShadow * 0.32, 0.15, 0.94), 613);
        col = mixRgb(VIMANA_PAL.teakVoid, blockFace, inTooth);
        col = mixRgb(col, VIMANA_PAL.teakVoid, centerFlute * 0.72);
        col = mixRgb(col, VIMANA_PAL.goldBright, Math.max(topRail * 0.65, chamferLit * 0.78));
      } else if (v < 0.245) {
        const fillet = Math.exp(-Math.pow((v - 0.22) / 0.014, 2));
        col = mixRgb(VIMANA_PAL.teakVoid, VIMANA_PAL.goldBright, fillet * 0.84);
      } else if (v < 0.765) {
        // Authentic aged sawn teak fascia plank: warped growth rings, crisp open pores, split checks & carved grooves!
        const fasciaV = (v - 0.245) / 0.52;
        const fasciaLight = clamp(0.76 - (fasciaV - 0.32) * 0.32, 0.38, 0.92);
        col = sampleAgedTeakWood(uBeam, vBeam, fasciaLight, 613);

        // Beveled upper & lower carpentry trim channels + subtle plank seam
        const groove1 = Math.exp(-Math.pow((fasciaV - 0.11) / 0.018, 2));
        const groove2 = Math.exp(-Math.pow((fasciaV - 0.89) / 0.018, 2));
        const seamJoin = Math.exp(-Math.pow((fasciaV - 0.51) / 0.01, 2)) * 0.38;
        const ridgeHi = Math.exp(-Math.pow((fasciaV - 0.15) / 0.015, 2)) * 0.38;
        col = mixRgb(col, VIMANA_PAL.teakLit, ridgeHi);
        col = mixRgb(col, VIMANA_PAL.teakVoid, clamp(Math.max(groove1 * 0.8, groove2 * 0.8, seamJoin), 0, 0.88));

        if (hasMed) {
          const dy = y - medCy;
          const r = Math.hypot(medDx * 1.12, dy);
          if (r < medR + 3.5) {
            const normR = r / medR;
            const medAlpha = smoothstep(1.06, 0.88, normR);
            const ang = Math.atan2(dy, medDx * 1.12);

            const outerBeads = Math.exp(-Math.pow((normR - 0.9) / 0.055, 2)) * (0.45 + 0.55 * Math.cos(ang * 20));
            const innerBeads = Math.exp(-Math.pow((normR - 0.36) / 0.045, 2)) * (0.5 + 0.5 * Math.cos(ang * 12));
            const petalRelief = smoothstep(0.36, 0.72, normR) * smoothstep(0.84, 0.64, normR) * (0.38 + 0.62 * Math.cos(ang * 8));
            const centerHub = Math.exp(-Math.pow(normR / 0.22, 2));

            const dirShadow = medDx + dy > 0 ? 0.82 : 0.44;
            const socketShadow = smoothstep(medR + 3.5, medR * 0.86, r) * dirShadow;
            col = mixRgb(col, VIMANA_PAL.teakVoid, socketShadow);

            if (normR < 1.0) {
              const ndl = clamp(
                0.38 - (medDx / medR) * 0.36 - (dy / medR) * 0.38 + petalRelief * 0.4 + outerBeads * 0.36 + innerBeads * 0.28 + centerHub * 0.34,
                0,
                1
              );
              let gCol = mixRgb(VIMANA_PAL.teakVoid, VIMANA_PAL.bronzeDeep, smoothstep(0.06, 0.3, ndl));
              gCol = mixRgb(gCol, VIMANA_PAL.goldMid, smoothstep(0.28, 0.62, ndl));
              gCol = mixRgb(gCol, VIMANA_PAL.goldBright, smoothstep(0.6, 0.88, ndl));
              gCol = mixRgb(gCol, VIMANA_PAL.goldSpec, Math.pow(ndl, 7.0) * 0.84);
              col = mixRgb(col, gCol, medAlpha);
            }
          }
        }
      } else if (v < 0.845) {
        const beadPhase = (((alongDist * 0.11 * perspScale) % 1) + 1) % 1;
        const pearl = smoothstep(0.18, 0.5, beadPhase) * smoothstep(0.82, 0.5, beadPhase);
        const fillet = Math.exp(-Math.pow((v - 0.79) / 0.014, 2));
        col = mixRgb(VIMANA_PAL.teakVoid, VIMANA_PAL.goldBright, fillet * (0.55 + pearl * 0.4));
      } else {
        const blockPhase = (((alongDist * 0.038 * perspScale) % 1) + 1) % 1;
        const inTooth = smoothstep(0.13, 0.23, blockPhase) * smoothstep(0.87, 0.77, blockPhase);
        const centerFlute = Math.exp(-Math.pow((blockPhase - 0.5) / 0.09, 2)) * 0.55;
        const toothWood = sampleAgedTeakWood(uBeam, vBeam, clamp(0.45 + (1 - blockPhase) * 0.25 - centerFlute * 0.35, 0.12, 0.76), 727);
        const underTooth = mixRgb(toothWood, VIMANA_PAL.goldMid, 0.22);
        col = mixRgb(VIMANA_PAL.teakVoid, underTooth, inTooth * 0.94);
      }

      if (occlusion > 0.02) {
        col = mixRgb(col, VIMANA_PAL.teakVoid, occlusion * smoothstep(0.95, 0.08, v));
      }

      const grain = (tooth[idx] - 0.5) * 7;
      paintPixelRGB(pixels, idx, clamp(col[0] + grain, 0, 255), clamp(col[1] + grain, 0, 255), clamp(col[2] + grain, 0, 255), edgeAlpha);
    }
  }
}
