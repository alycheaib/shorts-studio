import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeShortVideo, outputRoot, cleanScript } from './pipeline.js';
import { synthesize, listVoices, DEFAULT_VOICES } from './tts.js';
import { groupWords, toSrt } from './subtitles.js';
import { searchFootage, availableProviders, cacheDir } from './materials.js';
import { findFfmpeg } from './ffmpeg.js';

export const INSTRUCTIONS = `Shorts Studio turns a topic into a narrated, subtitled short video (TikTok / Reels / YouTube Shorts).
You (the model) write the script and the stock-footage search terms; the tools do voice, footage, subtitles and rendering.
Script rules: start with a strong hook sentence, plain spoken text only (no markdown, emojis, headings, scene labels or "welcome to"),
~130-160 words for a 60-second short, in the user's language. Search terms: 3-8 short, concrete, visual English phrases
(e.g. "city traffic night", "doctor laptop"), in the order the script mentions them. Then call make_short_video.
Rendering takes 1-5 minutes. Report the video path, then suggest a title, description and hashtags, and mention credits.txt.`;

const json = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }], structuredContent: o });

function progress(extra) {
  const token = extra?._meta?.progressToken;
  let n = 0;
  return (message) => {
    if (token === undefined) return;
    extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: ++n, message } }).catch(() => {});
  };
}

const subtitleSchema = z.object({
  enabled: z.boolean().optional().describe('Burn subtitles into the video (default true)'),
  style: z.enum(['highlight', 'classic']).optional().describe('highlight = current word coloured (default); classic = plain lines'),
  position: z.enum(['bottom', 'center', 'top']).optional(),
  font: z.string().optional().describe('Installed font name, default Arial (supports Arabic)'),
  font_size: z.number().int().min(20).max(200).optional(),
  color: z.string().optional().describe('#RRGGBB text colour, default #FFFFFF'),
  highlight_color: z.string().optional().describe('#RRGGBB highlight colour, default #FFD400'),
  uppercase: z.boolean().optional(),
  box: z.boolean().optional().describe('Draw a dark box behind the text'),
  max_chars: z.number().int().min(8).max(80).optional().describe('Max characters per caption'),
}).optional();

export function createServer() {
  const server = new McpServer({ name: 'shorts-studio', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  server.registerTool('make_short_video', {
    title: 'Make a short video',
    description: 'Render a narrated, subtitled short video from a script you wrote: free neural voice-over (Microsoft Edge TTS), stock footage for each search term (Pexels/Pixabay with free keys, else Wikimedia Commons), word-highlight subtitles, optional background music, MP4 output. Takes 1-5 minutes.',
    inputSchema: {
      script: z.string().min(10).max(6000).describe('Spoken narration only, in the target language'),
      search_terms: z.array(z.string().min(1).max(60)).max(12).optional().describe('English visual search terms in script order'),
      title: z.string().max(100).optional().describe('Used for the file name'),
      language: z.string().optional().describe('ISO code, e.g. en, ar, fr (picks a default voice)'),
      voice: z.string().optional().describe('Edge voice, e.g. en-US-AndrewNeural, en-US-AvaNeural, ar-SA-HamedNeural, ar-EG-SalmaNeural. See list_voices'),
      rate: z.string().regex(/^[+-]\d{1,2}%$/).optional().describe('Speaking speed, e.g. "+10%"'),
      pitch: z.string().regex(/^[+-]\d{1,2}Hz$/).optional(),
      aspect: z.enum(['portrait', 'landscape', 'square']).optional().describe('portrait 1080x1920 (default), landscape 1920x1080, square 1080x1080'),
      clip_duration: z.number().min(2).max(10).optional().describe('Seconds per clip before cutting (default 4)'),
      clips_per_term: z.number().int().min(1).max(6).optional(),
      order: z.enum(['sequential', 'random']).optional(),
      provider: z.enum(['auto', 'pexels', 'pixabay', 'wikimedia']).optional(),
      materials: z.array(z.string()).max(40).optional().describe('Your own video/image files (absolute paths) or URLs, used before stock footage'),
      materials_only: z.boolean().optional().describe('Use only "materials", no stock search'),
      voice_file: z.string().optional().describe('Use this audio file as narration instead of TTS (subtitles are timed by text length)'),
      subtitles: subtitleSchema,
      bgm_file: z.string().optional().describe('Background music file (mp3/m4a/wav). Or set SHORTS_BGM_DIR for a random track'),
      bgm: z.boolean().optional().describe('false disables background music'),
      bgm_volume: z.number().min(0).max(1).optional().describe('Default 0.15'),
      output_dir: z.string().optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async (args, extra) => {
    for (const f of [args.voice_file, args.bgm_file]) if (f && !fs.existsSync(f)) throw new Error(`File not found: ${f}`);
    const r = await makeShortVideo(args, { onProgress: progress(extra) });
    return json(r);
  });

  server.registerTool('generate_voiceover', {
    title: 'Generate a voice-over',
    description: 'Free neural text-to-speech (Microsoft Edge voices, 300+ voices, 70+ languages) to MP3, plus an SRT subtitle file timed to the words.',
    inputSchema: {
      text: z.string().min(1).max(6000),
      voice: z.string().optional(),
      language: z.string().optional(),
      rate: z.string().regex(/^[+-]\d{1,2}%$/).optional(),
      pitch: z.string().regex(/^[+-]\d{1,2}Hz$/).optional(),
      output_dir: z.string().optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async (a) => {
    const text = cleanScript(a.text);
    const voice = a.voice || DEFAULT_VOICES[(a.language || 'en').slice(0, 2)] || DEFAULT_VOICES.en;
    const dir = a.output_dir || path.join(outputRoot(), 'voiceovers', new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19));
    const r = await synthesize({ text, voice, rate: a.rate, pitch: a.pitch, outDir: dir });
    const srt = path.join(dir, 'voice.srt');
    fs.writeFileSync(srt, toSrt(groupWords(r.words, text, { maxChars: 42 })));
    return json({ audio: r.audioPath, subtitles_srt: srt, duration: +r.duration.toFixed(2), voice, words: r.words.length });
  });

  server.registerTool('list_voices', {
    title: 'List voices',
    description: 'List the free Edge neural voices, optionally filtered by language prefix (e.g. "ar", "en-GB") and gender.',
    inputSchema: { language: z.string().optional(), gender: z.enum(['Male', 'Female']).optional() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (a) => {
    const voices = await listVoices(a);
    return json({ count: voices.length, voices: voices.slice(0, 120), defaults: DEFAULT_VOICES });
  });

  server.registerTool('search_footage', {
    title: 'Search stock footage',
    description: 'Preview stock clips for a search term (no download): source, size, duration, author and licence.',
    inputSchema: {
      term: z.string().min(1).max(60),
      aspect: z.enum(['portrait', 'landscape', 'square']).optional(),
      provider: z.enum(['auto', 'pexels', 'pixabay', 'wikimedia']).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (a) => {
    const r = await searchFootage(a.term, { aspect: a.aspect || 'portrait', provider: a.provider || 'auto', minDuration: 3 });
    return json({ term: a.term, results: r.results.slice(0, a.limit || 8), errors: r.errors });
  });

  server.registerTool('doctor', {
    title: 'Check setup',
    description: 'Check ffmpeg, footage providers, output and cache folders.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    let ffmpeg; try { ffmpeg = findFfmpeg(); } catch (e) { ffmpeg = `MISSING: ${e.message}`; }
    return json({
      ffmpeg, providers: availableProviders(), output_dir: outputRoot(), cache_dir: cacheDir(),
      background_music_dir: process.env.SHORTS_BGM_DIR || null,
      tips: [
        !process.env.PEXELS_API_KEY && 'Set PEXELS_API_KEY (free at https://www.pexels.com/api/) for the best footage; Wikimedia Commons is used without a key.',
        !process.env.SHORTS_BGM_DIR && 'Set SHORTS_BGM_DIR to a folder of royalty-free music for automatic background tracks.',
      ].filter(Boolean),
    });
  });

  return server;
}
