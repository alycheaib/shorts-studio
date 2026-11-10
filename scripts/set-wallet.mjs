#!/usr/bin/env node
// Maintainer setup: put your USDT (TRC20) address in the README checkout, the Pro request form and the QR code.
//   node scripts/set-wallet.mjs <T... address> <contact for key delivery, e.g. an email or t.me/handle>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';

const [wallet, contact] = process.argv.slice(2);
if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet || '') || !contact) {
  console.error('Usage: set-wallet.mjs <TRC20 address starting with T> <contact>'); process.exit(1);
}
const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')));
const issuer = path.join(os.homedir(), '.shorts-studio-issuer');
fs.mkdirSync(issuer, { recursive: true });
fs.writeFileSync(path.join(issuer, 'config.json'), JSON.stringify({ usdt_trc20: wallet, contact }, null, 2));
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
await QRCode.toFile(path.join(root, 'docs', 'usdt-trc20.png'), wallet, { width: 360, margin: 2 });

const checkout = `<!-- checkout:start -->
**Get it with USDT (instant, worldwide):**

| | |
|---|---|
| Network | **TRON (TRC20)** only. Other networks lose the funds |
| Address | \`${wallet}\` |
| Amount | **29 USDT** Pro · **99 USDT** Agency |

<img src="docs/usdt-trc20.png" width="180" alt="USDT TRC20 QR code">

1. Send the amount from any wallet or exchange (Binance, OKX, Bybit, Trust Wallet…). If the exchange deducts a fee, add it so ${'≥'} 28 USDT arrives. Sending from Binance? Choose the TRC20 network withdrawal (not "internal transfer"/Binance Pay) so there is an on-chain hash.
2. Email **${contact}** with the subject **shorts-studio key**: paste the **transaction hash** and the name for the license.
3. Your key is emailed back **automatically**, usually within 2 hours, once the payment is confirmed on-chain.
4. Tell Claude *"activate my shorts-studio license SS1.…"*, or set \`SHORTS_STUDIO_LICENSE\`.

Lebanon: you can also pay by Whish. Email first and you'll get the details.
<!-- checkout:end -->`;
const readmePath = path.join(root, 'README.md');
let readme = fs.readFileSync(readmePath, 'utf8');
readme = /<!-- checkout:start -->[\s\S]*<!-- checkout:end -->/.test(readme)
  ? readme.replace(/<!-- checkout:start -->[\s\S]*<!-- checkout:end -->/, checkout)
  : readme.replace(/^\*\*Get it:\*\*.*$/m, checkout);
fs.writeFileSync(readmePath, readme);

const formPath = path.join(root, '.github', 'ISSUE_TEMPLATE', 'pro-license.yml');
let form = fs.readFileSync(formPath, 'utf8');
form = form.replace(/(Thanks for supporting shorts-studio!).*\n/, `$1 Pay **29 / 99 USDT on TRON (TRC20)** to \`${wallet}\`, then email ${contact} with the transaction hash. Your key is emailed back **automatically**.\n`);
if (!form.includes('id: tx')) {
  form = form.replace(/  - type: input\n    id: name/, `  - type: input
    id: tx
    attributes:
      label: USDT transaction hash · رقم العملية
      placeholder: "64 characters, from your wallet or exchange withdrawal history"
  - type: input
    id: name`);
}
fs.writeFileSync(formPath, form);
console.log(`Wallet set to ${wallet}. Updated README.md, the Pro request form and docs/usdt-trc20.png. Verify payments with: node scripts/verify-usdt.mjs <tx> --name "Buyer"`);
