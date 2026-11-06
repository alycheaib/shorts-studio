// Free narration through Microsoft Edge's online neural voices (no API key), with word timings.
import fs from 'node:fs';
import path from 'node:path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { ffmpeg, probe } from './ffmpeg.js';

const TICKS_PER_MS = 10000;
let voiceCache = null;

export const DEFAULT_VOICES = {
  en: 'en-US-AndrewNeural', ar: 'ar-SA-HamedNeural', fr: 'fr-FR-HenriNeural', es: 'es-ES-AlvaroNeural',
  de: 'de-DE-ConradNeural', zh: 'zh-CN-YunxiNeural', hi: 'hi-IN-MadhurNeural', tr: 'tr-TR-AhmetNeural',
  pt: 'pt-BR-AntonioNeural', it: 'it-IT-DiegoNeural', ru: 'ru-RU-DmitryNeural', ja: 'ja-JP-KeitaNeural',
};

export async function listVoices({ language, gender } = {}) {
  if (!voiceCache) {
    const tts = new MsEdgeTTS();
    try { voiceCache = await tts.getVoices(); } finally { tts.close(); }
  }
  return voiceCache
    .filter((v) => !language || v.Locale.toLowerCase().startsWith(language.toLowerCase()))
    .filter((v) => !gender || v.Gender.toLowerCase() === gender.toLowerCase())
    .map((v) => ({ voice: v.ShortName, gender: v.Gender, locale: v.Locale }));
}

/** Split long text at sentence ends so each Edge request stays small. */
export function chunkText(text, max = 1200) {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?。！？؟]+[.!?。！？؟]*["'”’)]*\s*/g) || [text];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > max && cur) { chunks.push(cur.trim()); cur = ''; }
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max).trim());
    } else cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function synthChunk(voice, text, dir, prosody, attempt = 1) {
  const tts = new MsEdgeTTS({ synthesisTimeoutMs: 60000, connectionTimeoutMs: 20000 });
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { wordBoundaryEnabled: true, sentenceBoundaryEnabled: false });
    fs.mkdirSync(dir, { recursive: true });
    const r = await tts.toFile(dir, escapeXml(text), prosody);
    const size = fs.existsSync(r.audioFilePath) ? fs.statSync(r.audioFilePath).size : 0;
    if (!size) throw new Error('Edge TTS returned no audio (check the voice name)');
    let words = [];
    if (r.metadataFilePath && fs.existsSync(r.metadataFilePath)) {
      const meta = JSON.parse(fs.readFileSync(r.metadataFilePath, 'utf8'));
      words = (meta.Metadata || []).filter((m) => m.Type === 'WordBoundary').map((m) => ({
        text: m.Data.text.Text,
        start: m.Data.Offset / TICKS_PER_MS / 1000,
        end: (m.Data.Offset + m.Data.Duration) / TICKS_PER_MS / 1000,
      }));
    }
    return { audio: r.audioFilePath, words };
  } catch (e) {
    if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * attempt)); return synthChunk(voice, text, dir, prosody, attempt + 1); }
    throw new Error(`Text-to-speech failed for voice ${voice}: ${e.message || e}`);
  } finally { tts.close(); }
}

/** rate like "+10%" / "-5%"; pitch like "+2Hz". Returns {audioPath, duration, words}. */
export async function synthesize({ text, voice = DEFAULT_VOICES.en, rate = '+0%', pitch = '+0Hz', outDir }) {
  if (!text || !text.trim()) throw new Error('text is empty');
  fs.mkdirSync(outDir, { recursive: true });
  const chunks = chunkText(text);
  const parts = [];
  let offset = 0;
  const words = [];
  for (let i = 0; i < chunks.length; i++) {
    const dir = path.join(outDir, `.tts-${i}`);
    const r = await synthChunk(voice, chunks[i], dir, { rate, pitch });
    const dur = (await probe(r.audio)).duration ?? (r.words.at(-1)?.end ?? 0);
    for (const w of r.words) words.push({ text: w.text, start: w.start + offset, end: w.end + offset });
    parts.push(r.audio);
    offset += dur;
  }
  const audioPath = path.join(outDir, 'voice.mp3');
  if (parts.length === 1) fs.copyFileSync(parts[0], audioPath);
  else {
    const list = path.join(outDir, 'voice-parts.txt');
    fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', audioPath]);
    fs.rmSync(list, { force: true });
  }
  for (let i = 0; i < chunks.length; i++) fs.rmSync(path.join(outDir, `.tts-${i}`), { recursive: true, force: true });
  const duration = (await probe(audioPath)).duration ?? offset;
  return { audioPath, duration, words, voice };
}
