import { build } from 'esbuild';
import fs from 'node:fs';

const out = 'plugin/server.mjs';
await build({
  entryPoints: ['src/cli.js'], bundle: true, platform: 'node', format: 'esm', target: 'node20', minify: true,
  outfile: out, external: ['ffmpeg-static'], legalComments: 'none', logLevel: 'warning',
  banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
});
// esbuild keeps the entry's shebang after the banner; move it to line 1.
const code = fs.readFileSync(out, 'utf8').replace(/^#!.*\n/gm, '');
fs.writeFileSync(out, '#!/usr/bin/env node\n' + code);
console.log('built', out);
