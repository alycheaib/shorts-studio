#!/usr/bin/env node
// Issue a shorts-studio Pro license key (for the maintainer only).
// The private key lives OUTSIDE the repo: ~/.shorts-studio-issuer/ed25519-private.pem (back it up!).
//   node scripts/issue-license.mjs --name "Client Co" [--email a@b.com] [--plan pro|agency] [--seats 1] [--expires 2027-12-31]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { signLicense, verifyLicense } from '../src/license.js';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s*--/).filter(Boolean).map((s) => {
  const i = s.indexOf(' ');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1).replace(/^"|"$/g, '')];
}));
const keyFile = process.env.SHORTS_ISSUER_KEY || path.join(os.homedir(), '.shorts-studio-issuer', 'ed25519-private.pem');
if (!fs.existsSync(keyFile)) { console.error(`Private key not found: ${keyFile}`); process.exit(1); }
if (!args.name) { console.error('Usage: --name "Buyer" [--email x] [--plan pro|agency] [--seats n] [--expires YYYY-MM-DD]'); process.exit(1); }

const payload = {
  id: crypto.randomUUID(), name: String(args.name), email: args.email || undefined,
  plan: args.plan === 'agency' ? 'agency' : 'pro', seats: Number(args.seats || (args.plan === 'agency' ? 5 : 1)),
  issued: new Date().toISOString().slice(0, 10), expires: args.expires || undefined,
};
const key = signLicense(payload, fs.readFileSync(keyFile, 'utf8'));
if (!verifyLicense(key).valid) { console.error('Self-check failed: the private key does not match the public key in src/license.js'); process.exit(1); }
const log = path.join(path.dirname(keyFile), 'issued.jsonl');
fs.appendFileSync(log, JSON.stringify({ ...payload, key }) + '\n');
console.log(key);
console.error(`\nIssued ${payload.plan} license ${payload.id} to ${payload.name} (logged in ${log}).`);
