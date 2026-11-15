import { renderJatayuSculpted } from './jatayuSculpt';
import { ART_HEIGHT, ART_WIDTH, createPaperSubstrate } from './paper';
import { renderVimanaBackground, renderVimanaMainBeam } from './pushpakaVimana';
import { clamp, createRng, smoothstep } from './rng';

const W = ART_WIDTH;
const H = ART_HEIGHT;

/**
 * Final cinematic lighting & filmic color-grading post-pass:
 *   - Softens contrast curves subtly for rich shadows and glowing amber sunlight
 *   - Adds warm golden-hour sunlight bloom from upper-left sky & temple interior bounce warmth
 *   - Applies subtle atmospheric peripheral vignette so focus snaps straight to Jatayu's eyes, beak & reaching talon
 */
function applyCinematicGrade(pixels: Uint8ClampedArray) {
  for (let y = 0; y < H; y++) {
    const ny = y / H;
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      let r = pixels[idx];
      let g = pixels[idx + 1];
      let b = pixels[idx + 2];

      // 1) Filmic S-curve contrast boost (deepens blacks slightly while preserving luminous highlights)
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const contrast = (lum - 0.45) * 0.085;
      r += r * contrast;
      g += g * contrast;
      b += b * contrast;

      // 2) Warm golden sunlight scatter from upper-left open sky & temple interior bounce warmth
      const sunRays = Math.exp(-Math.pow((x - 360) / 680, 2) - Math.pow((y - 260) / 480, 2));
      const warmBounce = smoothstep(0.32, 0.85, ny) * smoothstep(0.15, 0.72, lum);
      r += sunRays * 9.5 + warmBounce * 8.0;
      g += sunRays * 5.5 + warmBounce * 3.5;
      b -= warmBounce * 6.5;

      // 3) Subtle cool sky tint inside deep upper-shadow pockets for rich cinematic warm-vs-cool contrast
      const shadowCool = smoothstep(0.24, 0.04, lum) * 0.25;
      b += shadowCool * 5.0;
      r -= shadowCool * 2.5;

      // 4) Gentle peripheral framing vignette centered around Jatayu's face & reaching talon (x~980, y~500)
      const vx = (x - 980) / 1120;
      const vy = (y - 500) / 680;
      const vig = 1 - clamp((vx * vx + vy * vy - 0.48) * 0.26, 0, 0.28);
      r *= vig;
      g *= vig;
      b *= vig;

      pixels[idx] = clamp(r, 0, 255);
      pixels[idx + 1] = clamp(g, 0, 255);
      pixels[idx + 2] = clamp(b, 0, 255);
    }
  }
}

/**
 * Renders Jatayu extending his talon to rescue Sita from inside the ornate Pushpaka Vimana:
 *   1. Open cerulean sky & carved golden Pushpaka Vimana interior (canopy filigree, timber eaves & vaulted arch)
 *   2. Sculpted Jatayu interleaved with the 3D carved teak & lotus-medallion main beam
 *   3. Filmic warm-vs-cool lighting & sunlight bloom grade unifying Jatayu and architecture
 */
export function renderMasterpiece(canvas: HTMLCanvasElement) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rng = createRng(202611);
  const paper = createPaperSubstrate(W, H, 1997);
  const pixels = new Uint8ClampedArray(paper.basePixels);

  // 1. Sunlit Cerulean Sky + Pushpaka Vimana Interior Architecture
  renderVimanaBackground(pixels, paper);

  // 2. Sculpted Jatayu Interleaved with the Foreground Carved Teak & Lotus Chariot Beam
  renderJatayuSculpted(pixels, paper, rng, () => {
    renderVimanaMainBeam(pixels, paper);
  });

  // 3. Cinematic Sunlight Scatter, Warm Temple Bounce & Filmic Contrast Grade
  applyCinematicGrade(pixels);

  // Final canvas commit
  const imgData = ctx.createImageData(W, H);
  imgData.data.set(pixels);
  ctx.putImageData(imgData, 0, 0);
}
