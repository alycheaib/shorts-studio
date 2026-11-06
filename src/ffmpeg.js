// Locates an ffmpeg binary and wraps the few ffmpeg calls the pipeline needs.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
let cached = null;

function works(bin) {
  try {
    const r = spawnSync(bin, ['-hide_banner', '-version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return r.status === 0;
  } catch { return false; }
}

/** Resolution order: FFMPEG_PATH, ~/.shorts-studio/bin, the ffmpeg-static npm package, ffmpeg on PATH. */
export function findFfmpeg() {
  if (cached) return cached;
  const candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  candidates.push(path.join(os.homedir(), '.shorts-studio', 'bin', exe));
  try {
    const p = createRequire(import.meta.url)('ffmpeg-static');
    if (p) candidates.push(p);
  } catch { /* optional */ }
  candidates.push('ffmpeg');
  for (const c of candidates) {
    if ((c === 'ffmpeg' || fs.existsSync(c)) && works(c)) return (cached = c);
  }
  throw new Error(
    'ffmpeg not found. Install it (Windows: winget install Gyan.FFmpeg · macOS: brew install ffmpeg · Linux: apt install ffmpeg) ' +
    'or set FFMPEG_PATH to the ffmpeg executable.'
  );
}

/** Run ffmpeg; resolves with stderr, rejects with the tail of stderr on failure. */
export function ffmpeg(args, { cwd, timeoutMs = 15 * 60 * 1000 } = {}) {
  const bin = findFfmpeg();
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-hide_banner', '-nostdin', '-y', ...args], { cwd, windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 400000) err = err.slice(-200000); });
    p.stdout.on('data', () => {});
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg timed out')); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(err);
      else reject(new Error(`ffmpeg exited with ${code}: ${err.split('\n').slice(-12).join('\n')}`));
    });
  });
}

/** Probe a media file using `ffmpeg -i` (no ffprobe needed). */
export async function probe(file) {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  const bin = findFfmpeg();
  const r = spawnSync(bin, ['-hide_banner', '-i', file], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  const out = r.stderr || '';
  const d = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : null;
  const v = out.match(/Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/);
  const rot = out.match(/rotate\s*:\s*(-?\d+)|rotation of (-?\d+(?:\.\d+)?)/);
  let width = v ? +v[1] : null, height = v ? +v[2] : null;
  if (rot && Math.abs(Math.round(+(rot[1] ?? rot[2]))) % 180 === 90) [width, height] = [height, width];
  const hasVideo = /Stream #[^\n]*Video:/.test(out);
  const isImage = IMAGE_EXT.test(file) || (hasVideo && /Input #0, (image2|png_pipe|jpeg_pipe|webp_pipe|bmp_pipe)/.test(out));
  return { duration: isImage ? null : duration, hasVideo, isImage, hasAudio: /Stream #[^\n]*Audio:/.test(out), width, height };
}

export const IMAGE_EXT = /\.(jpe?g|png|webp|bmp)$/i;
