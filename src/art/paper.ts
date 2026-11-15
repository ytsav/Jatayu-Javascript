import { clamp, createRng, hash2D, lerp } from './rng';

export const ART_WIDTH = 1920;
export const ART_HEIGHT = 1080;

export interface PaperSubstrate {
  width: number;
  height: number;
  /** Physical fine pastel-paper tooth heightmap in [0, 1] */
  tooth: Float32Array;
  /** Warm archival pastel-paper base pixels (RGBA) */
  basePixels: Uint8ClampedArray;
}

/**
 * Generates a fine-tooth 300gsm pastel cotton paper substrate.
 * Uses tight fine grain + subtle laid weave rather than coarse blotches,
 * ensuring smooth velvety pastel coverage with authentic microscopic texture.
 */
export function createPaperSubstrate(
  width = ART_WIDTH,
  height = ART_HEIGHT,
  seed = 1997
): PaperSubstrate {
  const count = width * height;
  const tooth = new Float32Array(count);
  const basePixels = new Uint8ClampedArray(count * 4);
  const rng = createRng(seed);

  // Fine-scale noise grid (~3px cells) for authentic cotton tooth
  const medW = 640;
  const medH = 360;
  const medGrid = new Float32Array(medW * medH);
  for (let i = 0; i < medGrid.length; i++) {
    medGrid[i] = rng();
  }

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    const gy = ny * medH;
    const y0 = Math.floor(gy) % medH;
    const y1 = (y0 + 1) % medH;
    const fy = gy - Math.floor(gy);
    const sy = fy * fy * (3 - 2 * fy);
    const row0 = y0 * medW;
    const row1 = y1 * medW;

    // Subtle fine horizontal laid-paper wire texture
    const laidH = Math.sin((y / 4.5) * Math.PI * 2) * 0.5 + 0.5;

    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const nx = x / width;
      const gx = nx * medW;
      const x0 = Math.floor(gx) % medW;
      const x1 = (x0 + 1) % medW;
      const fx = gx - Math.floor(gx);
      const sx = fx * fx * (3 - 2 * fx);

      const fineTooth = lerp(
        lerp(medGrid[row0 + x0], medGrid[row0 + x1], sx),
        lerp(medGrid[row1 + x0], medGrid[row1 + x1], sx),
        sy
      );
      const micro = hash2D(x, y, 503);
      const chain = Math.sin((x / 72.0) * Math.PI * 2) > 0.965 ? 0.05 : 0;

      // Balanced fine cotton tooth centered smoothly around 0.52
      const h = clamp(fineTooth * 0.55 + micro * 0.32 + laidH * 0.1 + chain * 0.03, 0, 1);
      tooth[idx] = h;

      const shade = (h - 0.5) * 9;
      const p4 = idx * 4;
      basePixels[p4] = clamp(244 + shade, 0, 255);
      basePixels[p4 + 1] = clamp(237 + shade, 0, 255);
      basePixels[p4 + 2] = clamp(224 + shade, 0, 255);
      basePixels[p4 + 3] = 255;
    }
  }

  return { width, height, tooth, basePixels };
}
