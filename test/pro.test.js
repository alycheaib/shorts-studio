import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ffmpeg, probe } from '../src/ffmpeg.js';
import { signLicense, verifyLicense, ProRequiredError } from '../src/license.js';
import { toAss } from '../src/subtitles.js';
import { proFeaturesUsed } from '../src/pipeline.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-pro-'));
const issuerKey = path.join(os.homedir(), '.shorts-studio-issuer', 'ed25519-private.pem');
const canIssue = fs.existsSync(issuerKey);
const fx = { video: path.join(tmp, 'clip.mp4'), voice: path.join(tmp, 'voice.mp3'), logo: path.join(tmp, 'logo.png') };

before(async () => {
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '6', '-pix_fmt', 'yuv420p', fx.video]);
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=7', '-c:a', 'libmp3lame', fx.voice]);
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=200x100', '-frames:v', '1', fx.logo]);
});

async function connect(env = {}) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src/cli.js')],
    env: { ...process.env, SHORTS_STUDIO_LICENSE: '', SHORTS_STUDIO_LICENSE_FILE: path.join(tmp, 'license.key'),
      SHORTS_OUTPUT_DIR: path.join(tmp, 'out'), SHORTS_CACHE_DIR: path.join(tmp, 'cache'), ...env }, stderr: 'pipe' }));
  return client;
}
const call = (c, name, args = {}) => c.callTool({ name, arguments: args }, undefined, { timeout: 600000 });

test('license keys: genuine verifies, tampering, foreign keys and expiry fail', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const key = signLicense({ id: 'x', name: 'Buyer' }, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.equal(verifyLicense(key, { publicKeyPem: pem }).valid, true);
  assert.equal(verifyLicense(key).valid, false, 'a key from another issuer must not pass the embedded public key');
  const [p, b, s] = key.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, 'base64url')), plan: 'agency' })).toString('base64url');
  assert.equal(verifyLicense(`${p}.${forged}.${s}`, { publicKeyPem: pem }).valid, false);
  const old = signLicense({ id: 'y', name: 'B', expires: '2020-01-01' }, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.match(verifyLicense(old, { publicKeyPem: pem }).reason, /expired/);
  assert.equal(verifyLicense('nonsense').valid, false);
});

test('Pro gating only triggers on Pro options', () => {
  assert.deepEqual(proFeaturesUsed({ script: 'x', subtitles: { style: 'classic' }, brand: { primary_color: '#ff0000' } }), []);
  assert.deepEqual(proFeaturesUsed({ hook_title: 'Hi', thumbnail: true, brand: { logo_file: 'l.png', handle: 'me' } }),
    ['brand.logo_file', 'brand end card (cta_text/handle)', 'hook_title', 'thumbnail']);
  assert.match(new ProRequiredError(['hook_title']).message, /Pro feature.*activate_license/s);
});

test('ASS presets, hook and CTA cards', () => {
  const caps = [{ text: 'Hello world.', start: 0, end: 2, words: [{ text: 'Hello', start: 0, end: 1 }, { text: 'world.', start: 1, end: 2 }] }];
  const pop = toAss(caps, { width: 1080, height: 1920, preset: 'pop', accentColor: '#FF0050', hook: { text: 'Top | tips', start: 0, end: 2.8 }, cta: { text: 'Follow @me', start: 5, end: 7 } });
  assert.match(pop, /\\fscx118\\fscy118\}HELLO/);
  assert.match(pop, /Dialogue: 1,0:00:00.00,0:00:02.80,Hook,.*Top\\Ntips/);
  assert.match(pop, /Dialogue: 1,0:00:05.00,0:00:07.00,CTA,.*Follow @me/);
  assert.match(pop, /Style: Hook,Arial,\d+,&H00FFFFFF,&H00FFFFFF,&H005000FF,/);
  assert.match(toAss(caps, { width: 1080, height: 1920, preset: 'neon', accentColor: '#00FFAA' }), /\{\\blur\d+\}/);
  assert.match(toAss(caps, { width: 1080, height: 1920, preset: 'bold-box' }), /Style: Default,(?:[^,]*,){14}3,/);
  assert.doesNotMatch(toAss(caps, { width: 1080, height: 1920, preset: 'minimal' }), /\\c&H/);
  assert.doesNotMatch(toAss(caps, { width: 1080, height: 1920 }), /Dialogue: 1,/);
});

test('without a license: Pro options are refused with an upsell, free renders still allowed', async () => {
  const c = await connect();
  try {
    const st = (await call(c, 'license_status')).structuredContent;
    assert.equal(st.pro, false);
    const r = await call(c, 'make_short_video', { script: 'Testing the Pro gate here.', materials: [fx.video], materials_only: true, voice_file: fx.voice, hook_title: 'Hi' });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /hook_title is a shorts-studio Pro feature/);
    const b = await call(c, 'make_short_videos', { videos: [{ script: 'Batch needs Pro too.' }] });
    assert.equal(b.isError, true);
    const bad = await call(c, 'activate_license', { key: 'SS1.' + 'a'.repeat(30) + '.' + 'b'.repeat(30) });
    assert.equal(bad.isError, true);
  } finally { await c.close(); }
});

test('with a license: activate, then brand + hook + progress bar + preset + extra aspect + thumbnail render', { skip: !canIssue && 'issuer private key not on this machine' }, async () => {
  const key = signLicense({ id: crypto.randomUUID(), name: 'Test Agency', plan: 'pro', issued: '2026-11-06' }, fs.readFileSync(issuerKey, 'utf8'));
  const c = await connect();
  try {
    const a = await call(c, 'activate_license', { key });
    assert.equal(a.structuredContent.licensed_to, 'Test Agency');
    assert.equal((await call(c, 'license_status')).structuredContent.pro, true);
    const r = await call(c, 'make_short_video', {
      script: 'Three quick tips. Save money every week. Then invest the rest.', materials: [fx.video], materials_only: true,
      voice_file: fx.voice, aspect: 'portrait', title: 'pro test', clip_duration: 3,
      brand: { logo_file: fx.logo, logo_position: 'top-left', primary_color: '#00FF00', handle: 'alycheaib' },
      hook_title: '3 money tips', progress_bar: true, caption_preset: 'pop', extra_aspects: ['square'], thumbnail: true,
    });
    assert.ok(!r.isError, r.content?.[0]?.text);
    const s = r.structuredContent;
    assert.equal(s.width, 1080); assert.equal(s.height, 1920);
    assert.equal(s.pro.licensed_to, 'Test Agency');
    assert.equal(s.variants.length, 1);
    const sq = await probe(s.variants[0].path);
    assert.equal(sq.width, 1080); assert.equal(sq.height, 1080);
    assert.ok(Math.abs(sq.duration - s.duration) < 0.3);
    assert.ok(fs.statSync(s.cover).size > 5000);
    assert.ok(fs.existsSync(s.variants[0].cover));
    // Progress bar: near the end, the bottom-left strip should be the brand green.
    const raw = path.join(tmp, 'px.rgb');
    await ffmpeg(['-ss', String(s.duration - 0.4), '-i', s.path, '-frames:v', '1', '-vf', 'crop=200:8:0:ih-8,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
    const [R, G, B] = fs.readFileSync(raw);
    assert.ok(G > 180 && R < 90 && B < 90, `progress bar pixel ${R},${G},${B}`);
    // Logo: top-left corner area should be red.
    await ffmpeg(['-ss', '3', '-i', s.path, '-frames:v', '1', '-vf', 'crop=80:30:70:70,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
    const [lr, lg, lb] = fs.readFileSync(raw);
    assert.ok(lr > 150 && lg < 110 && lb < 110, `logo pixel ${lr},${lg},${lb}`);
  } finally { await c.close(); }
});
