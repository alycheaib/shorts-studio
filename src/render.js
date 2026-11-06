// Cuts materials into equal segments, fits them to the canvas, concatenates, adds voice/music and burns subtitles.
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg, probe, IMAGE_EXT } from './ffmpeg.js';

const FPS = 30;

/**
 * Build a segment plan covering `total` seconds. Each material is used in turn; a video that is
 * reused starts from a later offset so repeats look different.
 */
export function planSegments(materials, total, clipDuration = 4, { order = 'sequential' } = {}) {
  if (!materials.length) throw new Error('No materials to render');
  const list = order === 'random' ? [...materials].sort(() => Math.random() - 0.5) : materials;
  const segs = [];
  const used = new Map();
  let t = 0, i = 0;
  while (t < total - 0.01) {
    let d = Math.min(clipDuration, total - t);
    if (d < 0.75 && segs.length) { segs.at(-1).duration = +(segs.at(-1).duration + d).toFixed(3); break; }
    const m = list[i % list.length];
    const n = used.get(m.file) || 0;
    const md = m.isImage ? 0 : (m.mediaDuration || 0);
    const base = m.skipIntro && md > d + 4 ? Math.min(md * 0.2, 5) : 0; // skip Commons title cards
    const start = md > d + base ? base + (n * d) % (md - d - base + 0.001) : 0;
    used.set(m.file, n + 1);
    segs.push({ ...m, start: +start.toFixed(2), duration: +d.toFixed(3) });
    t += d; i++;
  }
  for (const sg of segs) sg.loop = !sg.isImage && !!sg.mediaDuration && sg.mediaDuration < sg.start + sg.duration + 0.05;
  return segs;
}

/** Detect baked-in letterbox/pillarbox bars so they can be cropped away before filling the canvas. */
async function detectCrop(file, start, width, height) {
  if (!width || !height) return null;
  const log = await ffmpeg(['-ss', String(start), '-i', file, '-t', '2', '-vf', 'cropdetect=limit=24:round=2:reset=0', '-an', '-f', 'null', '-'])
    .catch(() => '');
  const all = [...log.matchAll(/crop=(d+):(d+):(d+):(d+)/g)];
  if (!all.length) return null;
  const [, w, h, x, y] = all.at(-1).map(Number);
  if (w < width * 0.3 || h < height * 0.3) return null; // mostly black frame, don't trust it
  if (w * h > width * height * 0.94) return null;
  return `crop=${w}:${h}:${x}:${y},`;
}

async function renderSegment(seg, out, W, H, idx) {
  const frames = Math.max(1, Math.round(seg.duration * FPS));
  const pre = seg.isImage ? '' : (await detectCrop(seg.file, seg.loop ? 0 : seg.start, seg.width0, seg.height0)) || '';
  const fit = `${pre}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  if (seg.isImage) {
    // Slow Ken Burns zoom; alternate zoom-in / zoom-out per segment.
    const zIn = idx % 2 === 0;
    const z = zIn ? `min(1+0.10*on/${frames},1.10)` : `max(1.10-0.10*on/${frames},1.0)`;
    const vf = `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
      `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p`;
    await ffmpeg(['-loop', '1', '-i', seg.file, '-vf', vf, '-frames:v', String(frames), '-an',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-r', String(FPS), out]);
    return;
  }
  const loop = seg.loop;
  await ffmpeg([...(loop ? ['-stream_loop', '-1'] : []), '-ss', String(loop ? 0 : seg.start), '-i', seg.file,
    '-t', seg.duration.toFixed(3), '-vf', `${fit},fps=${FPS},setsar=1,format=yuv420p`, '-frames:v', String(frames), '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-r', String(FPS), out]);
}

/**
 * opts: { materials:[{file}], audioPath, assPath?, outPath, width, height, clipDuration, order, bgmPath, bgmVolume, workDir }
 */
export async function renderVideo(opts) {
  const { audioPath, outPath, width: W, height: H, workDir, clipDuration = 4, order = 'sequential',
    assPath, bgmPath, bgmVolume = 0.15, onProgress = () => {} } = opts;
  fs.mkdirSync(workDir, { recursive: true });
  const audio = await probe(audioPath);
  if (!audio.duration) throw new Error('Could not read the voice-over duration');
  const total = audio.duration + 0.6;

  const materials = [];
  for (const m of opts.materials) {
    const info = await probe(m.file);
    if (!info.hasVideo) continue;
    materials.push({ ...m, isImage: info.isImage || IMAGE_EXT.test(m.file), mediaDuration: info.duration, width0: info.width, height0: info.height });
  }
  if (!materials.length) throw new Error('None of the materials could be opened');
  const segs = planSegments(materials, total, clipDuration, { order });
  const segFiles = [];
  for (let i = 0; i < segs.length; i++) {
    const f = path.join(workDir, `seg-${String(i).padStart(3, '0')}.mp4`);
    onProgress(`rendering clip ${i + 1}/${segs.length}`);
    await renderSegment(segs[i], f, W, H, i);
    segFiles.push(f);
  }
  const list = path.join(workDir, 'segments.txt');
  fs.writeFileSync(list, segFiles.map((f) => `file '${path.basename(f)}'`).join('\n'));
  const body = path.join(workDir, 'body.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-c', 'copy', 'body.mp4'], { cwd: workDir });

  onProgress('mixing audio and burning subtitles');
  const args = ['-i', 'body.mp4', '-i', audioPath];
  if (bgmPath) args.push('-stream_loop', '-1', '-i', bgmPath);
  const vf = [];
  if (assPath) {
    fs.copyFileSync(assPath, path.join(workDir, 'subs.ass'));
    const fontsDir = process.env.SHORTS_FONTS_DIR;
    vf.push(`[0:v]subtitles=subs.ass${fontsDir ? `:fontsdir='${fontsDir.replace(/\\/g, '/').replace(/:/g, '\\:')}'` : ''}[v]`);
  }
  const af = bgmPath
    ? `[1:a]aresample=48000,volume=1.0[a1];[2:a]aresample=48000,volume=${bgmVolume},afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[a2];[a1][a2]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`
    : `[1:a]aresample=48000,apad[a]`;
  const filter = [...vf, af].join(';');
  args.push('-filter_complex', filter, '-map', assPath ? '[v]' : '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(3), '-movflags', '+faststart', 'final.mp4');
  await ffmpeg(args, { cwd: workDir });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.renameSync(path.join(workDir, 'final.mp4'), outPath);
  for (const f of [...segFiles, list, body, path.join(workDir, 'subs.ass')]) fs.rmSync(f, { force: true });
  const info = await probe(outPath);
  return { path: outPath, duration: info.duration, width: info.width, height: info.height, segments: segs.length,
    sizeMB: +(fs.statSync(outPath).size / 1e6).toFixed(2), used_files: [...new Set(segs.map((s) => s.file))] };
}
