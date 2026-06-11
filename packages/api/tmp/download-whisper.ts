import { downloadWhisper } from '../src/ml/whisper/download.ts';

downloadWhisper((pct, msg) => {
  console.log(`${pct}% ${msg}`);
}).then(() => {
  console.log('done');
  process.exit(0);
}).catch(e => {
  console.error('failed', e);
  process.exit(1);
});
