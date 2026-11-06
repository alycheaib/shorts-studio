// End-to-end: script + search terms -> narrated, subtitled short video (MoneyPrinterTurbo-style pipeline).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { synthesize, DEFAULT_VOICES } from './tts.js';
import { groupWords, captionsFromScript, toSrt, toAss } from './subtitles.js';
import { ASPECTS, searchFootage, download } from './materials.js';
import { renderVideo } from './render.js';
import { probe, IMAGE_EXT } from './ffmpeg.js';

export function outputRoot() {
  return process.env.SHORTS_OUTPUT_DIR || path.join(os.homedir(), 'Videos', 'shorts-studio');
}

const slug = (s) => (s || 'video').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';

/** Strip markdown and stage directions the way MoneyPrinterTurbo cleans LLM scripts. */
export function cleanScript(s) {
  return String(s || '')
    .replace(/\*+/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]\n]+)\]\([^)]*\)/g, '$1')
    .replace(/\[[^\]\n]*\]/g, '')
    .replace(/^\s*(narrator|voiceover|voice over|scene \d+)\s*:\s*/gim, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export async function gatherMaterials({ terms, aspect, provider, perTerm, minDuration, log }) {
  const notes = [];
  const searches = await mapLimit(terms, 3, (t) => searchFootage(t, { aspect, provider, minDuration }).catch((e) => ({ results: [], errors: [e.message] })));
  const seen = new Set();
  const perTermPicks = await mapLimit(terms, 3, async (term, k) => {
    const { results, errors } = searches[k];
    notes.push(...errors.map((e) => `"${term}": ${e}`));
    const got = [];
    for (const item of results) {
      if (got.length >= perTerm) break;
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      try {
        log(`downloading ${item.provider} ${item.kind || 'video'} for "${term}"`);
        got.push({ ...item, file: await download(item) });
      } catch (e) { notes.push(`"${term}": ${e.message}`); }
    }
    if (!got.length) notes.push(`"${term}": no usable footage found`);
    return got;
  });
  return { picked: perTermPicks.flat(), notes };
}

/**
 * params: see the make_short_video tool schema in server.js.
 */
export async function makeShortVideo(params, { onProgress = () => {} } = {}) {
  const script = cleanScript(params.script);
  if (script.length < 10) throw new Error('script is too short');
  const aspect = params.aspect || 'portrait';
  const { width, height } = ASPECTS[aspect] || (() => { throw new Error(`aspect must be ${Object.keys(ASPECTS).join(', ')}`); })();
  const lang = (params.language || 'en').slice(0, 2).toLowerCase();
  const voice = params.voice || DEFAULT_VOICES[lang] || DEFAULT_VOICES.en;
  const clipDuration = Math.min(10, Math.max(2, params.clip_duration ?? 4));
  const dir = params.output_dir || path.join(outputRoot(), `${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}-${slug(params.title || params.search_terms?.[0])}`);
  const work = path.join(dir, '.work');
  fs.mkdirSync(work, { recursive: true });
  const log = (m) => onProgress(m);

  // 1. voice-over
  let audioPath, duration, captions;
  const sub = { enabled: true, style: 'highlight', position: 'bottom', ...(params.subtitles || {}) };
  const maxChars = sub.max_chars || (aspect === 'portrait' ? 22 : 40);
  if (params.voice_file) {
    log('using the supplied voice-over');
    audioPath = path.join(dir, 'voice' + path.extname(params.voice_file));
    fs.copyFileSync(params.voice_file, audioPath);
    duration = (await probe(audioPath)).duration;
    if (!duration) throw new Error('voice_file has no readable audio');
    captions = captionsFromScript(script, duration, { maxChars });
  } else {
    log(`generating voice-over with ${voice}`);
    const r = await synthesize({ text: script, voice, rate: params.rate || '+0%', pitch: params.pitch || '+0Hz', outDir: dir });
    audioPath = r.audioPath; duration = r.duration;
    captions = r.words.length ? groupWords(r.words, script, { maxChars }) : captionsFromScript(script, duration, { maxChars });
  }
  fs.writeFileSync(path.join(dir, 'script.txt'), script + '\n');
  fs.writeFileSync(path.join(dir, 'subtitles.srt'), toSrt(captions));
  let assPath = null;
  if (sub.enabled !== false) {
    assPath = path.join(work, 'subs.ass');
    fs.writeFileSync(assPath, toAss(captions, {
      width, height, font: sub.font || (lang === 'ar' ? 'Arial' : 'Arial'), fontSize: sub.font_size, color: sub.color,
      highlightColor: sub.highlight_color, position: sub.position, style: sub.style, uppercase: sub.uppercase, box: sub.box,
    }));
  }

  // 2. footage
  const total = duration + 0.6;
  const needed = Math.ceil(total / clipDuration);
  const local = [];
  for (const m of params.materials || []) {
    if (/^https?:\/\//i.test(m)) local.push({ url: m, provider: 'url', kind: IMAGE_EXT.test(new URL(m).pathname) ? 'image' : 'video' });
    else if (fs.existsSync(m)) local.push({ file: path.resolve(m), provider: 'local' });
    else throw new Error(`material not found: ${m}`);
  }
  for (const m of local) if (!m.file) m.file = await download(m);
  let picked = [...local];
  let notes = [];
  const terms = (params.search_terms || []).map((t) => String(t).trim()).filter(Boolean);
  if (terms.length && (params.materials_only !== true)) {
    const perTerm = params.clips_per_term || Math.max(1, Math.min(4, Math.ceil(needed / terms.length)));
    const g = await gatherMaterials({ terms, aspect, provider: params.provider || 'auto', perTerm, minDuration: Math.min(clipDuration, 3), log });
    picked = picked.concat(g.picked);
    notes = g.notes;
  }
  if (!picked.length) {
    throw new Error(`No footage found. ${notes.join(' | ')}\nTry broader English search terms (e.g. "city night", "ocean"), set PEXELS_API_KEY (free at pexels.com/api), or pass local files in "materials".`);
  }

  // 3. render
  let bgmPath = params.bgm_file || null;
  if (!bgmPath && process.env.SHORTS_BGM_DIR && params.bgm !== false && fs.existsSync(process.env.SHORTS_BGM_DIR)) {
    const songs = fs.readdirSync(process.env.SHORTS_BGM_DIR).filter((f) => /\.(mp3|m4a|wav|ogg)$/i.test(f));
    if (songs.length) bgmPath = path.join(process.env.SHORTS_BGM_DIR, songs[Math.floor(Math.random() * songs.length)]);
  }
  const outPath = path.join(dir, `${slug(params.title || 'video')}.mp4`);
  const result = await renderVideo({
    materials: picked, audioPath, assPath, outPath, width, height, workDir: work, clipDuration,
    order: params.order || 'sequential', bgmPath, bgmVolume: params.bgm_volume ?? 0.15, onProgress: log,
  });
  fs.rmSync(work, { recursive: true, force: true });

  const usedFiles = new Set(result.used_files);
  const used = picked.filter((p) => usedFiles.has(p.file));
  const credits = used.filter((p) => p.page || p.provider === 'local').map((p) =>
    p.provider === 'local' ? `- ${path.basename(p.file)} (your file)` : `- "${p.term}" — ${p.author || 'unknown'} · ${p.license} · ${p.page}`);
  fs.writeFileSync(path.join(dir, 'credits.txt'), `Footage credits\n${credits.join('\n')}\n\nVoice: Microsoft Edge neural TTS (${params.voice_file ? 'custom file' : voice})\n`);
  const summary = { ...result, folder: dir, voice: params.voice_file ? 'custom' : voice, voice_duration: +duration.toFixed(2),
    captions: captions.length, clips_used: used.length, subtitles_srt: path.join(dir, 'subtitles.srt'),
    credits_file: path.join(dir, 'credits.txt'), credits: used.map((p) => ({ term: p.term, provider: p.provider, author: p.author, license: p.license, page: p.page })),
    warnings: notes };
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ params: { ...params, script }, result: summary }, null, 2));
  return summary;
}
