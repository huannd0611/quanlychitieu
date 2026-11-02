// Temporal analysis regression using a genuine three-scene recorded video.
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');
const base = process.env.STUDIO_URL || 'http://127.0.0.1:8081';
let browser;

(async () => {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox']});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.addScriptTag({path:path.join(__dirname, '..', 'reference.js')});
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 270; canvas.height = 480;
    const context = canvas.getContext('2d'), stream = canvas.captureStream(20), chunks = [];
    const recorder = new MediaRecorder(stream, {mimeType:'video/webm'});
    recorder.ondataavailable = event => {if (event.data.size) chunks.push(event.data);};
    const stopped = new Promise(resolve => {recorder.onstop = resolve;});
    recorder.start();
    for (const color of ['#e71020', '#12cb30', '#1840e9']) {
      for (let i = 0; i < 22; i++) {
        context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    const file = new File(chunks, 'reference.webm', {type:'video/webm'});
    const progress = [];
    const analysis = await LumaReference.analyze(file, {onProgress:event => progress.push(event)});
    const samples = [];
    for (const frame of analysis.frames) {
      const image = new Image(); image.src = frame.thumbnail; await image.decode();
      const sample = document.createElement('canvas'); sample.width = 1; sample.height = 1;
      sample.getContext('2d').drawImage(image, 0, 0, 1, 1); samples.push([...sample.getContext('2d').getImageData(0, 0, 1, 1).data]);
    }
    let preAbort, midAbort, badDecode, badType;
    const pre = new AbortController(); pre.abort();
    try {await LumaReference.analyze(file, {signal:pre.signal});} catch (error) {preAbort = error.name;}
    const mid = new AbortController();
    try {await LumaReference.analyze(file, {signal:mid.signal, onProgress:event => {if (event.stage === 'sampling' && event.completed === 2) mid.abort();}});} catch (error) {midAbort = error.name;}
    try {await LumaReference.analyze(new File(['broken video'], 'bad.mp4', {type:'video/mp4'}));} catch (error) {badDecode = error.message;}
    try {await LumaReference.analyze(new File(['not video'], 'bad.png', {type:'image/png'}));} catch (error) {badType = error.message;}
    return {analysis, progress, samples, preAbort, midAbort, badDecode, badType};
  });
  const {analysis, progress, samples} = result;
  assert(analysis.duration > 3 && analysis.duration < 4.5);
  assert.equal(analysis.width, 270); assert.equal(analysis.height, 480); assert.equal(analysis.ratio, '9:16');
  assert.equal(analysis.cuts.length, 4, `Expected two real cuts, got ${analysis.cuts.join(',')}`);
  assert.equal(analysis.cuts[0], 0); assert.equal(analysis.cuts.at(-1), analysis.duration);
  assert(Math.abs(analysis.cuts[1] - 1.1) < .5); assert(Math.abs(analysis.cuts[2] - 2.2) < .5);
  assert(Math.abs(analysis.shotDurations.reduce((sum, n) => sum + n, 0) - analysis.duration) < .01);
  assert(analysis.frames.length >= 3 && analysis.frames.length <= 8);
  assert(analysis.frames.every((frame, index) => frame.thumbnail.startsWith('data:image/jpeg;base64,') && (!index || frame.time > analysis.frames[index - 1].time)));
  assert.equal(samples.length, 3);
  assert(samples[0][0] > samples[0][1] * 2, 'first extracted frame should be red');
  assert(samples[1][1] > samples[1][0] * 2, 'middle extracted frame should be green');
  assert(samples[2][2] > samples[2][0] * 2, 'last extracted frame should be blue');
  assert(progress.every((entry, index) => entry.progress >= 0 && entry.progress <= 1 && (!index || entry.progress >= progress[index - 1].progress)));
  assert.equal(progress.at(-1).stage, 'complete'); assert.equal(progress.at(-1).progress, 1);
  assert.equal(result.preAbort, 'AbortError'); assert.equal(result.midAbort, 'AbortError');
  assert(result.badDecode.includes('Không đọc được video')); assert(result.badType.includes('phải là tệp video'));
  assert.deepEqual(errors, []);
  console.log('PASS: actual temporal frames, two detected cuts, shot durations, portrait metadata, monotonic progress, cancellation and malformed input');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(async () => {await browser?.close();});
