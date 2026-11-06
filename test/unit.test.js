import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupWords, captionsFromScript, toSrt, toAss, assColor } from '../src/subtitles.js';
import { chunkText } from '../src/tts.js';
import { planSegments } from '../src/render.js';
import { cleanScript } from '../src/pipeline.js';

const words = (s, step = 0.4) => s.split(' ').map((w, i) => ({ text: w.replace(/[^\p{L}\p{N}']/gu, ''), start: i * step, end: i * step + step * 0.8 }));

test('captions break at sentence ends and respect max length', () => {
  const script = 'Hello world. This is a much longer sentence that should wrap, nicely.';
  const caps = groupWords(words(script), script, { maxChars: 24 });
  assert.equal(caps[0].text, 'Hello world.');
  for (const c of caps) assert.ok(c.text.length <= 24, c.text);
  assert.ok(caps.at(-1).text.endsWith('nicely.'));
  for (let i = 1; i < caps.length; i++) assert.ok(caps[i].start >= caps[i - 1].start);
});

test('captions work for Arabic text', () => {
  const script = 'مرحبا بكم في هذا الفيديو. اليوم نتحدث عن البحر، وأسراره العميقة.';
  const caps = groupWords(words(script), script, { maxChars: 22 });
  assert.ok(caps.length >= 3);
  assert.equal(caps[0].text, 'مرحبا بكم في هذا');
  assert.ok(caps.some((c) => c.text.endsWith('الفيديو.')));
});

test('script-only captions cover the whole duration', () => {
  const caps = captionsFromScript('One two three. Four five six seven eight nine ten.', 10);
  assert.ok(caps[0].start === 0);
  assert.ok(Math.abs(caps.at(-1).end - 10) < 0.4);
});

test('SRT and ASS output', () => {
  const script = 'Hi there. Bye now.';
  const caps = groupWords(words(script), script);
  const srt = toSrt(caps);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:00,\d{3}\nHi there\./);
  const ass = toAss(caps, { width: 1080, height: 1920 });
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,/);
  assert.ok(ass.includes(String.raw`{\c&H00D4FF&}`), "highlight colour tag");
  assert.equal(assColor('#FF8000'), '&H000080FF');
  assert.throws(() => assColor('red'));
  const classic = toAss(caps, { width: 1920, height: 1080, style: 'classic', uppercase: true });
  assert.ok(classic.includes(',HI THERE.'));
});

test('ASS text cannot inject override tags', () => {
  const script = 'Use {\pos(0,0)} braces.';
  const ass = toAss(groupWords(words(script), script), { width: 1080, height: 1920, style: 'classic' });
  assert.ok(!ass.includes('{\pos'));
});

test('long text is chunked at sentence boundaries', () => {
  const s = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const c = chunkText(s, 300);
  assert.ok(c.length > 1);
  for (const x of c) { assert.ok(x.length <= 300); assert.ok(x.endsWith('.')); }
  assert.equal(c.join(' '), s);
});

test('segment plan covers the audio exactly and varies reused clips', () => {
  const mats = [{ file: 'a.mp4', mediaDuration: 20 }, { file: 'b.jpg', isImage: true }];
  const segs = planSegments(mats, 17.3, 4);
  const sum = segs.reduce((n, s) => n + s.duration, 0);
  assert.ok(Math.abs(sum - 17.3) < 0.01);
  const aSegs = segs.filter((s) => s.file === 'a.mp4');
  assert.notEqual(aSegs[0].start, aSegs[1].start);
  assert.ok(segs.every((s) => s.duration >= 0.75));
  const short = planSegments([{ file: 'c.mp4', mediaDuration: 2 }], 5, 4);
  assert.ok(short.every((s) => s.loop));
});

test('script cleaning removes markdown and stage directions', () => {
  assert.equal(cleanScript('# Title\n**Narrator:** Hello [music fades] world'), 'Title\nHello world');
});
