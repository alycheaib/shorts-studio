// Turns word timings (or a plain script + duration) into caption groups, SRT and styled ASS.

const STRONG = /[.!?。！？؟…]/;
const WEAK = /[,;:،؛，、—–]/;

/**
 * Group TTS words into short captions, breaking at punctuation found in the original script.
 * Edge word timings omit punctuation, so each word is located in the script to see what follows it.
 */
export function groupWords(words, script, { maxChars = 28 } = {}) {
  const captions = [];
  let cur = null;
  let cursor = 0;
  const src = script || '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let after = '';
    let shown = w.text;
    const idx = src.indexOf(w.text, cursor);
    if (idx >= 0 && idx - cursor < 80) {
      let j = idx + w.text.length;
      // carry trailing punctuation/quotes into the caption text
      while (j < src.length && /[^\s\p{L}\p{N}]/u.test(src[j])) j++;
      shown = src.slice(idx, j);
      after = src.slice(idx + w.text.length, j);
      cursor = j;
    }
    const candidate = cur ? `${cur.text} ${shown}` : shown;
    if (cur && candidate.length > maxChars) { captions.push(cur); cur = null; }
    if (!cur) cur = { text: shown, start: w.start, end: w.end, words: [] };
    else { cur.text = `${cur.text} ${shown}`; cur.end = w.end; }
    cur.words.push({ text: shown, start: w.start, end: w.end });
    if (STRONG.test(after) || (WEAK.test(after) && cur.text.length >= maxChars * 0.45)) { captions.push(cur); cur = null; }
  }
  if (cur) captions.push(cur);
  // Hold each caption until the next one starts when the pause is short, so text doesn't flicker.
  for (let i = 0; i < captions.length; i++) {
    const next = captions[i + 1];
    if (next && next.start - captions[i].end < 0.7) captions[i].end = next.start;
    else captions[i].end += 0.25;
  }
  return captions;
}

/** Without word timings (e.g. a user-supplied voice file): spread sentences over the duration by length. */
export function captionsFromScript(script, duration, { maxChars = 28 } = {}) {
  const tokens = script.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const total = tokens.reduce((n, t) => n + t.length + 1, 0) || 1;
  let t = 0;
  const words = tokens.map((tok) => {
    const d = ((tok.length + 1) / total) * duration;
    const w = { text: tok.replace(/[^\p{L}\p{N}'’-]+$/u, '') || tok, start: t, end: t + d };
    t += d;
    return w;
  });
  return groupWords(words, script, { maxChars });
}

function ts(sec, sep = ',') {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`;
}

export function toSrt(captions) {
  return captions.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
}

function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** "#RRGGBB" -> ASS "&H00BBGGRR" */
export function assColor(hex, alpha = 0) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) throw new Error(`Invalid colour "${hex}" (use #RRGGBB)`);
  const [r, g, b] = [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)];
  return `&H${alpha.toString(16).padStart(2, '0')}${b}${g}${r}`.toUpperCase();
}

/** inline override colour: \c&HBBGGRR& */
export function assInline(hex) { return assColor(hex).replace(/^&H00/, '&H') + '&'; }

const escAss = (s) => s.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, ' ');

/** Pro caption presets. Each one only changes defaults; explicit options still win. */
export const CAPTION_PRESETS = ['pop', 'neon', 'bold-box', 'minimal'];

/**
 * style: "highlight" (current word coloured, viral-shorts look) or "classic" (plain line).
 * position: bottom | center | top.
 * Pro: preset (pop | neon | bold-box | minimal), accentColor (brand colour),
 *      hook {text, start, end} (big title card at the top), cta {text, start, end} (end card in the centre).
 */
export function toAss(captions, opts) {
  const { preset } = opts;
  const accent = opts.accentColor || '#FFD400';
  const presetDefaults = {
    pop: { style: 'highlight', highlightColor: accent, uppercase: true },
    neon: { style: 'highlight', highlightColor: '#FFFFFF', color: '#FFFFFF', outlineColor: accent },
    'bold-box': { style: 'highlight', box: true, uppercase: true, highlightColor: accent },
    minimal: { style: 'classic', outline: 0, sizeFactor: 0.8 },
  }[preset] || {};
  const pick = (k, d) => (opts[k] !== undefined && opts[k] !== null ? opts[k] : presetDefaults[k] !== undefined ? presetDefaults[k] : d);
  const { width, height } = opts;
  const font = pick('font', 'Arial'), color = pick('color', '#FFFFFF'), highlightColor = pick('highlightColor', '#FFD400');
  const outlineColor = pick('outlineColor', '#000000'), position = pick('position', 'bottom'), style = pick('style', 'highlight');
  const uppercase = pick('uppercase', false), box = pick('box', false);
  const size = opts.fontSize || Math.round(Math.min(width, height) * (height > width ? 0.078 : 0.062) * (presetDefaults.sizeFactor || 1));
  const align = { bottom: 2, center: 5, top: 8 }[position] ?? 2;
  const marginV = position === 'center' ? 0 : Math.round(height * (height > width ? 0.2 : 0.08));
  const ol = pick('outline', undefined) ?? Math.max(2, Math.round(size / 14));
  const borderStyle = box ? 3 : 1;
  const shadow = box ? 0 : preset === 'minimal' ? 2 : Math.round(ol / 2);
  const mL = Math.round(width * 0.08);
  const hookSize = Math.round(size * 1.05);
  const ctaSize = Math.round(size * 1.15);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${font},${size},${assColor(color)},${assColor(highlightColor)},${assColor(outlineColor)},${assColor('#000000', 0x60)},-1,0,0,0,100,100,0,0,${borderStyle},${ol},${shadow},${align},${mL},${mL},${marginV},1
Style: Hook,${font},${hookSize},${assColor('#FFFFFF')},${assColor('#FFFFFF')},${assColor(accent)},${assColor('#000000', 0x80)},-1,0,0,0,100,100,0,0,3,${Math.round(hookSize / 3)},0,8,${mL},${mL},${Math.round(height * (height > width ? 0.11 : 0.07))},1
Style: CTA,${font},${ctaSize},${assColor('#FFFFFF')},${assColor('#FFFFFF')},${assColor(accent)},${assColor('#000000', 0x80)},-1,0,0,0,100,100,0,0,3,${Math.round(ctaSize / 3)},0,5,${mL},${mL},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const pop = preset === 'pop';
  const hl = `{\\c${assInline(highlightColor)}${pop ? '\\fscx118\\fscy118' : ''}}`;
  const reset = `{\\c${assInline(color)}${pop ? '\\fscx100\\fscy100' : ''}}`;
  const lead = preset === 'neon' ? `{\\blur${Math.max(2, Math.round(ol / 2))}}` : '';
  const fmt = (t) => escAss(uppercase ? t.toUpperCase() : t);
  const lines = [];

  for (const c of captions) {
    if (style !== 'highlight' || !c.words?.length) {
      lines.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${lead}${fmt(c.text)}`);
      continue;
    }
    c.words.forEach((w, i) => {
      const start = i === 0 ? c.start : w.start;
      const end = i === c.words.length - 1 ? c.end : c.words[i + 1].start;
      if (end <= start) return;
      const text = c.words.map((x, j) => (j === i ? `${hl}${fmt(x.text)}${reset}` : fmt(x.text))).join(' ');
      lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${lead}${text}`);
    });
  }
  const card = (st, c) => c?.text && lines.push(`Dialogue: 1,${assTime(c.start ?? 0)},${assTime(c.end)},${st},,0,0,0,,{\\fad(150,250)}${escAss(String(c.text)).replace(/\s*\|\s*/g, '\\N')}`);
  card('Hook', opts.hook);
  card('CTA', opts.cta);
  return header + lines.join('\n') + '\n';
}
