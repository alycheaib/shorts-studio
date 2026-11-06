import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ffmpeg, probe } from '../src/ffmpeg.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-test-'));
const fx = { video: path.join(tmp, 'clip.mp4'), image: path.join(tmp, 'pic.png'), voice: path.join(tmp, 'voice.mp3') };

async function connect(server = 'src/cli.js') {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, server)],
    env: { ...process.env, SHORTS_OUTPUT_DIR: path.join(tmp, 'out'), SHORTS_CACHE_DIR: path.join(tmp, 'cache') }, stderr: 'pipe' }));
  return client;
}
const call = async (c, name, args = {}) => {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 600000 });
  if (r.isError) throw new Error(r.content[0].text);
  return r.structuredContent;
};

async function online() {
  try { return (await fetch('https://commons.wikimedia.org/', { method: 'HEAD', signal: AbortSignal.timeout(8000) })).ok; } catch { return false; }
}

before(async () => {
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '6', '-pix_fmt', 'yuv420p', fx.video]);
  await ffmpeg(['-f', 'lavfi', '-i', 'mandelbrot=size=1200x1600', '-frames:v', '1', fx.image]);
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=9', '-c:a', 'libmp3lame', fx.voice]);
});

const servers = ['src/cli.js', ...(fs.existsSync(path.join(root, 'plugin/server.mjs')) ? ['plugin/server.mjs'] : [])];

for (const server of servers) {
  test(`[${server}] lists tools and passes doctor`, async () => {
    const c = await connect(server);
    const { tools } = await c.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['doctor', 'generate_voiceover', 'list_voices', 'make_short_video', 'search_footage']);
    const d = await call(c, 'doctor');
    assert.ok(!String(d.ffmpeg).startsWith('MISSING'), d.ffmpeg);
    assert.ok(d.providers.includes('wikimedia'));
    await c.close();
  });

  test(`[${server}] renders offline from local video + image + voice file (landscape, classic subs)`, async () => {
    const c = await connect(server);
    const r = await call(c, 'make_short_video', {
      script: 'Local files only. This checks rendering without any network access at all.',
      materials: [fx.video, fx.image], materials_only: true, voice_file: fx.voice, aspect: 'landscape', clip_duration: 3,
      subtitles: { style: 'classic', position: 'center', box: true }, title: 'offline test',
    });
    assert.equal(r.width, 1920); assert.equal(r.height, 1080);
    assert.ok(Math.abs(r.duration - 9.6) < 0.3, `duration ${r.duration}`);
    assert.equal(r.clips_used, 2);
    const info = await probe(r.path);
    assert.ok(info.hasAudio && info.hasVideo);
    assert.ok(fs.readFileSync(r.subtitles_srt, 'utf8').includes('Local files only.'));
    await c.close();
  });

  test(`[${server}] rejects bad input`, async () => {
    const c = await connect(server);
    await assert.rejects(call(c, 'make_short_video', { script: 'Hello there world', materials: [path.join(tmp, 'nope.mp4')], materials_only: true }), /not found/);
    await assert.rejects(call(c, 'make_short_video', { script: 'Hello there world', voice_file: path.join(tmp, 'nope.mp3'), materials: [fx.image] }), /not found/i);
    await c.close();
  });
}

test('online: Edge voice-over with word-timed SRT (English + Arabic)', async (t) => {
  if (!(await online())) return t.skip('offline');
  const c = await connect();
  const en = await call(c, 'generate_voiceover', { text: 'Testing the free neural voice. It should sound natural.', voice: 'en-US-AvaNeural' });
  assert.ok(en.duration > 2 && en.words >= 8);
  assert.match(fs.readFileSync(en.subtitles_srt, 'utf8'), /Testing the free neural voice\./);
  const ar = await call(c, 'generate_voiceover', { text: 'مرحبا، هذا اختبار للصوت العربي.', language: 'ar' });
  assert.equal(ar.voice, 'ar-SA-HamedNeural');
  assert.ok(ar.duration > 1.5);
  const v = await call(c, 'list_voices', { language: 'ar' });
  assert.ok(v.count > 10);
  await c.close();
});

test('online: full pipeline with Wikimedia footage (portrait, highlight subs)', async (t) => {
  if (!(await online())) return t.skip('offline');
  const c = await connect();
  const r = await call(c, 'make_short_video', {
    script: 'Mountains are older than you think. Some peaks rose from the sea floor millions of years ago.',
    search_terms: ['mountain', 'snow mountain'], title: 'mountains', provider: 'wikimedia',
  });
  assert.equal(r.width, 1080); assert.equal(r.height, 1920);
  assert.ok(r.duration > 4);
  assert.ok(r.clips_used >= 1);
  assert.ok(fs.readFileSync(r.credits_file, 'utf8').includes('commons.wikimedia.org'));
  await c.close();
});
