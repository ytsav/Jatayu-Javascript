export type Rng = () => number;

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function hash2D(ix: number, iy: number, seed = 1337): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function noise2D(x: number, y: number, seed = 1337): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);

  const n00 = hash2D(ix, iy, seed);
  const n10 = hash2D(ix + 1, iy, seed);
  const n01 = hash2D(ix, iy + 1, seed);
  const n11 = hash2D(ix + 1, iy + 1, seed);

  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

export function fbm2D(x: number, y: number, octaves = 4, seed = 1337): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2D(x * freq, y * freq, seed + i * 97);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Converts an idealized geometric polyline into a natural, human-drawn stroke
 * with subtle hand tremor, wrist arc drift, and organic endpoint taper.
 */
export function humanizePolyline(
  points: Point2D[],
  rng: Rng,
  wobbleAmp = 1.6,
  stepLen = 4
): Point2D[] {
  if (points.length < 2) return points;
  const result: Point2D[] = [];
  const phase = rng() * 1000;
  let arc = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) continue;

    const nx = -dy / dist;
    const ny = dx / dist;
    const steps = Math.max(2, Math.ceil(dist / stepLen));

    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const d = arc + t * dist;
      // Smooth low + micro hand tremor
      const wave =
        (noise2D(d * 0.018 + phase, phase * 0.37, 401) - 0.5) * 1.4 +
        (noise2D(d * 0.075 + phase * 1.9, phase * 0.81, 709) - 0.5) * 0.6;
      const offset = wave * wobbleAmp;
      result.push({
        x: p0.x + dx * t + nx * offset,
        y: p0.y + dy * t + ny * offset,
      });
    }
    arc += dist;
  }

  const last = points[points.length - 1];
  result.push({
    x: last.x + (rng() - 0.5) * wobbleAmp * 0.6,
    y: last.y + (rng() - 0.5) * wobbleAmp * 0.6,
  });
  return result;
}

/**
 * Generates a cubic Bezier curve with human wrist bow and micro-tremor.
 */
export function humanBezier(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  rng: Rng,
  wobbleAmp = 1.4,
  segments = 24
): Point2D[] {
  const raw: Point2D[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const x =
      mt * mt * mt * p0.x +
      3 * mt * mt * t * p1.x +
      3 * mt * t * t * p2.x +
      t * t * t * p3.x;
    const y =
      mt * mt * mt * p0.y +
      3 * mt * mt * t * p1.y +
      3 * mt * t * t * p2.y +
      t * t * t * p3.y;
    raw.push({ x, y });
  }
  return humanizePolyline(raw, rng, wobbleAmp, 5);
}
