// Stock footage search + download: Pexels / Pixabay (free API keys) and Wikimedia Commons (no key).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { probe } from './ffmpeg.js';

const UA = 'shorts-studio-mcp/0.1 (+https://github.com/alycheaib/shorts-studio)';
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024; // skip huge Commons originals (slow to fetch)

export const ASPECTS = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
};

export function cacheDir() {
  const d = process.env.SHORTS_CACHE_DIR || path.join(os.homedir(), '.shorts-studio', 'cache');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function availableProviders() {
  const p = [];
  if (process.env.PEXELS_API_KEY) p.push('pexels');
  if (process.env.PIXABAY_API_KEY) p.push('pixabay');
  p.push('wikimedia');
  return p;
}

const orientOk = (w, h, aspect) =>
  aspect === 'square' ? true : aspect === 'portrait' ? h >= w * 0.95 : w >= h * 1.05;

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(30000) });
  if (r.status === 401 || r.status === 403) throw new Error(`${new URL(url).host}: API key rejected (${r.status})`);
  if (r.status === 429) throw new Error(`${new URL(url).host}: rate limited, try again later`);
  if (!r.ok) throw new Error(`${new URL(url).host}: HTTP ${r.status}`);
  return r.json();
}

async function searchPexels(term, aspect, minDuration) {
  const q = new URLSearchParams({ query: term, per_page: '20' });
  if (aspect !== 'square') q.set('orientation', aspect);
  const j = await getJson(`https://api.pexels.com/videos/search?${q}`, { Authorization: process.env.PEXELS_API_KEY });
  const { width: W, height: H } = ASPECTS[aspect];
  const out = [];
  for (const v of j.videos || []) {
    if (!(v.duration >= minDuration)) continue;
    const files = (v.video_files || []).filter((f) => f.link && f.width && f.height && orientOk(f.width, f.height, aspect))
      .sort((a, b) => a.width * a.height - b.width * b.height);
    const f = files.find((x) => Math.min(x.width, x.height) >= Math.min(W, H)) || files.at(-1);
    if (!f) continue;
    out.push({ provider: 'pexels', term, url: f.link, width: f.width, height: f.height, duration: v.duration,
      page: v.url, author: v.user?.name, license: 'Pexels License (free to use, attribution appreciated)' });
  }
  return out;
}

async function searchPixabay(term, aspect, minDuration) {
  const q = new URLSearchParams({ key: process.env.PIXABAY_API_KEY, q: term, per_page: '50', video_type: 'film', safesearch: 'true' });
  const j = await getJson(`https://pixabay.com/api/videos/?${q}`);
  const { width: W, height: H } = ASPECTS[aspect];
  const out = [];
  for (const v of j.hits || []) {
    if (!(v.duration >= minDuration)) continue;
    const files = ['tiny', 'small', 'medium', 'large'].map((k) => v.videos?.[k]).filter((f) => f?.url && f.width && orientOk(f.width, f.height, aspect));
    const f = files.find((x) => Math.min(x.width, x.height) >= Math.min(W, H)) || files.at(-1);
    if (!f) continue;
    out.push({ provider: 'pixabay', term, url: f.url, width: f.width, height: f.height, duration: v.duration,
      page: v.pageURL, author: v.user, license: 'Pixabay Content License (free to use)' });
  }
  return out;
}

const stripHtml = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function searchWikimedia(term, aspect, minDuration, { images = false } = {}) {
  const q = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrnamespace: '6', gsrlimit: '30',
    gsrsearch: `${images ? 'filetype:bitmap' : 'filetype:video'} ${term}`,
    prop: images ? 'imageinfo' : 'videoinfo',
    [images ? 'iiprop' : 'viprop']: images ? 'url|size|mime|extmetadata' : 'url|size|mime|derivatives|extmetadata',
    [images ? 'iiextmetadatafilter' : 'viextmetadatafilter']: 'LicenseShortName|Artist',
    ...(images ? { iiurlwidth: '2160' } : {}),
  });
  const j = await getJson(`https://commons.wikimedia.org/w/api.php?${q}`);
  const pages = (j.query?.pages || []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out = [];
  for (const p of pages) {
    const v = (images ? p.imageinfo : p.videoinfo)?.[0];
    if (!v?.width || !v?.height) continue;
    const license = stripHtml(v.extmetadata?.LicenseShortName?.value) || 'see source page';
    if (/fair use|non-free/i.test(license)) continue;
    const author = stripHtml(v.extmetadata?.Artist?.value);
    if (images) {
      if (!/jpeg|png|webp/.test(v.mime) || Math.min(v.width, v.height) < 700) continue;
      if (!orientOk(v.width, v.height, aspect) && aspect !== 'square' && v.width / v.height > 2.5) continue;
      out.push({ provider: 'wikimedia', kind: 'image', term, url: v.thumburl || v.url, width: v.thumbwidth || v.width,
        height: v.thumbheight || v.height, page: v.descriptionurl, author, license });
      continue;
    }
    if (!(v.duration >= minDuration)) continue;
    if (Math.min(v.width, v.height) < 480) continue;
    const ders = (v.derivatives || []).filter((d) => /webm/.test(d.type) && d.width && Math.min(d.width, d.height) >= 720)
      .sort((a, b) => a.width * a.height - b.width * b.height);
    const src = ders[0] ? { url: ders[0].src, width: ders[0].width, height: ders[0].height }
      : v.size <= MAX_ORIGINAL_BYTES ? { url: v.url, width: v.width, height: v.height } : null;
    if (!src) continue;
    out.push({ provider: 'wikimedia', term, ...src, duration: v.duration, skipIntro: true, page: v.descriptionurl, author, license });
  }
  // Prefer clips that already match the output orientation.
  return out.sort((a, b) => Number(orientOk(b.width, b.height, aspect)) - Number(orientOk(a.width, a.height, aspect)));
}

/** Search one term across the chosen providers (first provider that returns results wins). */
export async function searchFootage(term, { aspect = 'portrait', provider = 'auto', minDuration = 3, includeImages = true } = {}) {
  const order = provider === 'auto' ? availableProviders() : [provider];
  const errors = [];
  for (const p of order) {
    try {
      const r = p === 'pexels' ? await searchPexels(term, aspect, minDuration)
        : p === 'pixabay' ? await searchPixabay(term, aspect, minDuration)
          : p === 'wikimedia' ? await searchWikimedia(term, aspect, minDuration)
            : (() => { throw new Error(`unknown provider ${p}`); })();
      if (r.length) return { results: r, errors };
    } catch (e) { errors.push(`${p}: ${e.message}`); }
  }
  if (includeImages) {
    try {
      const r = await searchWikimedia(term, aspect, 0, { images: true });
      if (r.length) return { results: r, errors };
    } catch (e) { errors.push(`wikimedia images: ${e.message}`); }
  }
  return { results: [], errors };
}

/** Download to the cache (keyed by URL) and validate with ffmpeg. */
export async function download(item) {
  const ext = (item.kind === 'image' ? (item.url.match(/\.(jpe?g|png|webp)(?:$|\?)/i)?.[1] || 'jpg')
    : (item.url.match(/\.(mp4|webm|mov|ogv|m4v)(?:$|\?)/i)?.[1] || 'mp4')).toLowerCase();
  const file = path.join(cacheDir(), crypto.createHash('sha1').update(item.url).digest('hex').slice(0, 20) + '.' + ext);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  const headers = { 'User-Agent': UA };
  const r = await fetch(item.url, { headers, signal: AbortSignal.timeout(Number(process.env.SHORTS_DOWNLOAD_TIMEOUT_MS) || 120000), redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`download failed (HTTP ${r.status}) ${item.url}`);
  const len = Number(r.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error(`file too large (${Math.round(len / 1e6)} MB)`);
  const tmp = file + '.part';
  let bytes = 0;
  const body = Readable.fromWeb(r.body);
  body.on('data', (c) => { bytes += c.length; if (bytes > MAX_BYTES) body.destroy(new Error('file too large')); });
  try { await pipeline(body, fs.createWriteStream(tmp)); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  const info = await probe(tmp).catch(() => null);
  if (!info?.hasVideo) { fs.rmSync(tmp, { force: true }); throw new Error(`not a playable media file: ${item.url}`); }
  fs.renameSync(tmp, file);
  return file;
}
