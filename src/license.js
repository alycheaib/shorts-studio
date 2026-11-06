// shorts-studio Pro licensing: offline Ed25519-signed keys. No server, no phone-home.
// Key format: SS1.<base64url(JSON payload)>.<base64url(signature)>
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAqivj3GkGuCGI3sROwqK4gdlTVw2AduhV59bNUkEQkg0=
-----END PUBLIC KEY-----`;

export const BUY_URL = process.env.SHORTS_STUDIO_BUY_URL || 'https://github.com/alycheaib/shorts-studio#-pro';

export const licenseFile = () => process.env.SHORTS_STUDIO_LICENSE_FILE || path.join(os.homedir(), '.shorts-studio', 'license.key');

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function signLicense(payload, privateKeyPem) {
  const body = b64u(JSON.stringify({ v: 1, plan: 'pro', ...payload }));
  const sig = crypto.sign(null, Buffer.from(`SS1.${body}`), privateKeyPem);
  return `SS1.${body}.${b64u(sig)}`;
}

export function verifyLicense(key, { publicKeyPem = PUBLIC_KEY_PEM, now = new Date() } = {}) {
  const k = String(key || '').trim();
  const m = /^SS1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(k);
  if (!m) return { valid: false, reason: 'Not a shorts-studio license key (expected SS1.xxx.yyy).' };
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(`SS1.${m[1]}`), publicKeyPem, Buffer.from(m[2], 'base64url')); } catch { ok = false; }
  if (!ok) return { valid: false, reason: 'Signature check failed: the key was altered or is not genuine.' };
  let payload;
  try { payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { return { valid: false, reason: 'Corrupt license payload.' }; }
  if (payload.expires && new Date(payload.expires) < now) return { valid: false, reason: `License expired on ${payload.expires}.`, payload };
  return { valid: true, payload };
}

/** Env var wins over the saved file. */
export function currentLicense() {
  const key = process.env.SHORTS_STUDIO_LICENSE || (fs.existsSync(licenseFile()) ? fs.readFileSync(licenseFile(), 'utf8') : '');
  if (!key.trim()) return { valid: false, reason: 'No license installed.' };
  return verifyLicense(key);
}

export function saveLicense(key) {
  const r = verifyLicense(key);
  if (!r.valid) throw new Error(r.reason);
  fs.mkdirSync(path.dirname(licenseFile()), { recursive: true });
  fs.writeFileSync(licenseFile(), key.trim() + '\n');
  return r;
}

export class ProRequiredError extends Error {
  constructor(features) {
    super(`${features.join(', ')} ${features.length > 1 ? 'are' : 'is a'} shorts-studio Pro feature${features.length > 1 ? 's' : ''}. ` +
      `Get a license at ${BUY_URL} and activate it with the activate_license tool, or run again without ${features.length > 1 ? 'these options' : 'this option'}. ` +
      'Everything else stays free.');
    this.features = features;
  }
}

export function requirePro(features) {
  if (!features.length) return null;
  const lic = currentLicense();
  if (!lic.valid) throw new ProRequiredError(features);
  return lic.payload;
}
