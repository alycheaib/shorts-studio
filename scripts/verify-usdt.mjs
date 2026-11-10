#!/usr/bin/env node
// Maintainer tool: confirm a USDT (TRC20) payment on-chain, then issue the Pro license for it.
//   node scripts/verify-usdt.mjs <tx hash> --name "Buyer"            (plan is picked from the amount)
//   node scripts/verify-usdt.mjs --list                               (recent incoming payments)
// Wallet: ~/.shorts-studio-issuer/config.json {"usdt_trc20": "T..."} or env SHORTS_USDT_WALLET.
// Read-only: it only queries the public TronGrid API. No keys or wallet secrets are needed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { signLicense, verifyLicense } from '../src/license.js';

export const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const PRICES = { pro: 29, agency: 99 };
const issuerDir = path.join(os.homedir(), '.shorts-studio-issuer');
const API = process.env.TRONGRID_URL || 'https://api.trongrid.io';

export function walletAddress() {
  if (process.env.SHORTS_USDT_WALLET) return process.env.SHORTS_USDT_WALLET.trim();
  const f = path.join(issuerDir, 'config.json');
  const w = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).usdt_trc20 : '';
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(w || '')) throw new Error(`Set your TRC20 wallet in ${f} as {"usdt_trc20":"T..."}`);
  return w;
}

/** Incoming USDT transfers to `wallet`, newest first. */
export async function incoming(wallet, { limit = 200, fetchImpl = fetch } = {}) {
  const url = `${API}/v1/accounts/${wallet}/transactions/trc20?only_to=true&only_confirmed=true&limit=${limit}&contract_address=${USDT_TRC20}`;
  const headers = { Accept: 'application/json', ...(process.env.TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY } : {}) };
  let res;
  for (let attempt = 1; ; attempt++) {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20000) });
    if (res.status !== 429 || attempt >= 4) break;
    await new Promise((r) => setTimeout(r, 6000)); // free tier: 1 req/s, 5 s penalty
  }
  if (!res.ok) throw new Error(`TronGrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return (body.data || []).map((t) => ({
    tx: t.transaction_id, from: t.from, to: t.to, usdt: Number(t.value) / 10 ** Number(t.token_info?.decimals ?? 6),
    token: t.token_info?.address, at: new Date(t.block_timestamp).toISOString(),
  }));
}

/** Decide which plan a payment buys. Allows up to 1 USDT short for exchange withdrawal rounding. */
export function planFor(usdt) {
  if (usdt >= PRICES.agency - 1) return 'agency';
  if (usdt >= PRICES.pro - 1) return 'pro';
  return null;
}

export function alreadyUsed(tx) {
  const log = path.join(issuerDir, 'issued.jsonl');
  if (!fs.existsSync(log)) return null;
  return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.payment_tx === tx) || null;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const wallet = walletAddress();
  const list = await incoming(wallet);
  if (argv.includes('--list')) {
    for (const t of list.slice(0, 30)) console.log(`${t.at}  ${t.usdt.toFixed(2).padStart(8)} USDT  ${t.tx}  ${alreadyUsed(t.tx) ? 'licensed' : planFor(t.usdt) || 'too small'}`);
    return;
  }
  const tx = (argv.find((a) => /^[0-9a-f]{64}$/i.test(a)) || '').toLowerCase();
  const name = opt('name');
  if (!tx || !name) { console.error('Usage: verify-usdt.mjs <64-char tx hash> --name "Buyer" [--email x] | --list'); process.exit(1); }
  const pay = list.find((t) => t.tx.toLowerCase() === tx);
  if (!pay) { console.error(`No confirmed USDT-TRC20 payment ${tx} to ${wallet} found (it can take ~1 minute to confirm; wrong network or wrong address?).`); process.exit(2); }
  if (pay.token !== USDT_TRC20) { console.error('That transfer is not genuine USDT (wrong token contract).'); process.exit(2); }
  const used = alreadyUsed(tx);
  if (used) { console.error(`Already licensed to ${used.name} on ${used.issued}. Key:\n${used.key}`); process.exit(3); }
  const plan = opt('plan') || planFor(pay.usdt);
  if (!plan) { console.error(`Payment is ${pay.usdt} USDT, below the $${PRICES.pro} price.`); process.exit(2); }
  const keyFile = process.env.SHORTS_ISSUER_KEY || path.join(issuerDir, 'ed25519-private.pem');
  const payload = { id: crypto.randomUUID(), name, email: opt('email'), plan, seats: plan === 'agency' ? 5 : 1, issued: new Date().toISOString().slice(0, 10) };
  const key = signLicense(payload, fs.readFileSync(keyFile, 'utf8'));
  if (!verifyLicense(key).valid) throw new Error('Private key does not match the public key in src/license.js');
  fs.appendFileSync(path.join(issuerDir, 'issued.jsonl'), JSON.stringify({ ...payload, key, payment_tx: tx, paid_usdt: pay.usdt, paid_from: pay.from }) + '\n');
  console.log(key);
  console.error(`\nPaid ${pay.usdt} USDT at ${pay.at} → ${plan} license for ${name}. Send the key above to the buyer privately.`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`) main().catch((e) => { console.error(e.message); process.exit(1); });
