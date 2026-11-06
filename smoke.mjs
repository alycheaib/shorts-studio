import { makeShortVideo } from './src/pipeline.js';
const t=Date.now();
const r = await makeShortVideo({
  title: 'ocean facts',
  script: 'The ocean covers more than seventy percent of our planet. Yet we have explored less than a quarter of its floor. Its waves carry energy across thousands of kilometres, and every second breath you take comes from tiny ocean plants.',
  search_terms: ['ocean waves', 'underwater', 'beach sunset'],
  output_dir: process.argv[2],
}, { onProgress: (m) => console.log('  ·', m) });
console.log(JSON.stringify({...r, credits: r.credits.length}, null, 1), ((Date.now()-t)/1000)+'s');
