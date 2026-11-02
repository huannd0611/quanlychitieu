// Start the app first. Requires Playwright and Chromium, with no remote services.
// STUDIO_URL=http://127.0.0.1:8081 CHROMIUM_PATH=/usr/bin/chromium node tests/browser-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const baseURL = process.env.STUDIO_URL || 'http://127.0.0.1:8081';
const origin = new URL(baseURL).origin;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-browser-test-'));
let browser;

async function main() {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
  page.setDefaultTimeout(15000);
  const errors = [], externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    externalRequests.push(url.origin); return route.abort();
  });
  const count = () => page.locator('.timeline-clip').count();
  const edit = async (id, value) => { await page.locator(`#${id}`).fill(value); await page.locator(`#${id}`).press('Tab'); };
  await page.goto(baseURL);
  await page.waitForFunction(() => document.querySelectorAll('.timeline-clip').length === 4);
  assert.equal(await page.locator('#ratioSelect').inputValue(), '9:16');
  assert.equal(await page.locator('#previewCanvas').evaluate(c => c.height / c.width), 16 / 9);
  console.log('PASS: initial portrait project and four sample scenes');

  await page.locator('.media-card').first().click(); assert.equal(await count(), 5);
  await page.locator('#duplicateBtn').click(); assert.equal(await count(), 6);
  await page.locator('#deleteBtn').click(); assert.equal(await count(), 5);
  await page.locator('#undoBtn').click(); assert.equal(await count(), 6);
  await page.locator('#redoBtn').click(); assert.equal(await count(), 5);
  await edit('clipCaption', 'Cảnh kiểm thử tiếng Việt');
  await edit('clipDuration', '1.5');
  assert.equal(await page.locator('#clipCaption').inputValue(), 'Cảnh kiểm thử tiếng Việt');
  assert.equal(await page.locator('#clipDuration').inputValue(), '1.5');
  console.log('PASS: add, duplicate, delete, undo/redo and caption/duration edits');

  await page.locator('#quickTemplates [data-template="cinema"]').click();
  assert.equal(await page.locator('#ratioSelect').inputValue(), '16:9');
  await page.locator('#quickTemplates [data-template="reels"]').click();
  assert.equal(await page.locator('#ratioSelect').inputValue(), '9:16');
  await page.locator('#prompt').fill('TikTok Reels nhịp nhanh, đen trắng, "Tiêu đề từ ý tưởng"');
  await page.locator('#generateBtn').click();
  assert.equal(await page.locator('#styleSelect').inputValue(), 'mono');
  assert.equal(await page.locator('#clipCaption').inputValue(), 'Tiêu đề từ ý tưởng');
  assert.equal(await page.locator('#clipDuration').inputValue(), '2');
  console.log('PASS: template formats and local prompt-based editing');

  // Exercise the AI consent boundary and plan application with a mocked service.
  // No paid API or provider credentials are used by this test.
  await page.locator('#openAiBtn').click();
  await page.waitForFunction(() => !document.getElementById('aiConnectionStatus').textContent.includes('Đang kiểm tra'));
  assert(await page.locator('#runAiBtn').isDisabled(), 'AI must not run without consent');
  await page.locator('#aiDialog .dialog-close').click();
  await page.route('**/api/ai/status', route => route.fulfill({json:{configured:true, provider:'OpenAI', model:'test-only'}}));
  const beforeAi = await page.locator('.timeline-clip').evaluateAll(nodes => nodes.map(node => node.dataset.clip));
  let sentSamples = 0, aiMode = 'valid';
  await page.route('**/api/ai/storyboard', async route => {
    const body = route.request().postDataJSON();
    sentSamples = body.clips.filter(clip => clip.thumbnail).length;
    assert(sentSamples > 0 && sentSamples <= 4);
    assert(body.clips.every(clip => !clip.thumbnail || clip.thumbnail.startsWith('data:image/jpeg;base64,')));
    const scenes = body.clips.slice().reverse().map(clip => ({id:clip.id, caption:'Gợi ý AI kiểm thử', duration:2}));
    if (aiMode === 'invalid') scenes[0].id = 'nonexistent-clip';
    await route.fulfill({json:{plan:{ratio:'1:1',style:'natural',transition:'fade',scenes}}});
  });
  const openConnectedAi = async () => {
    await page.locator('#openAiBtn').click();
    await page.waitForFunction(() => document.getElementById('aiConnectionStatus').classList.contains('connected'));
    assert(await page.locator('#runAiBtn').isDisabled());
    await page.locator('#aiConsent').check();
  };
  await openConnectedAi(); await page.locator('#runAiBtn').click();
  await page.waitForFunction(() => !document.getElementById('aiDialog').open);
  assert.equal(await page.locator('#ratioSelect').inputValue(), '1:1');
  assert.equal(await page.locator('#clipCaption').inputValue(), 'Gợi ý AI kiểm thử');
  assert.deepEqual(await page.locator('.timeline-clip').evaluateAll(nodes => nodes.map(node => node.dataset.clip)), beforeAi.slice().reverse());
  await page.locator('#undoBtn').click();
  assert.equal(await page.locator('#ratioSelect').inputValue(), '9:16');
  aiMode = 'invalid'; await openConnectedAi(); await page.locator('#runAiBtn').click();
  await page.waitForFunction(() => document.getElementById('aiRunStatus').textContent.includes('không hợp lệ'));
  assert.deepEqual(await page.locator('.timeline-clip').evaluateAll(nodes => nodes.map(node => node.dataset.clip)), beforeAi);
  await page.locator('#aiDialog .dialog-close').click();
  console.log('PASS: AI consent, sampled media, plan order, undo and rejection of invalid plans (mock service)');

  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 400;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ec5a92'; ctx.fillRect(0, 0, 300, 400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#mediaInput').setInputFiles({ name: 'smoke-image.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await page.waitForFunction(() => document.getElementById('mediaCount').textContent === '6');
  await page.locator('.media-card').last().click(); assert.equal(await count(), 6);
  // Create a genuine moving video, rather than a fake file with a video extension.
  const video = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d'), stream = canvas.captureStream(20), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.ondataavailable = event => chunks.push(event.data); recorder.start();
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `hsl(${i * 10} 80% 50%)`; ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = '#fff'; ctx.font = '30px sans-serif'; ctx.fillText(`Frame ${i}`, 40, 120);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()));
  });
  await page.locator('#mediaInput').setInputFiles({ name: 'smoke-video.webm', mimeType: 'video/webm', buffer: Buffer.from(video) });
  await page.waitForFunction(() => document.getElementById('mediaCount').textContent === '7');
  await page.locator('.media-card').last().click(); assert.equal(await count(), 7);
  assert(await page.locator('#clipStart').isEnabled());
  await edit('clipDuration', '1'); await edit('clipStart', '0.2');
  assert.equal(await page.locator('#clipStart').inputValue(), '0.2');
  console.log('PASS: real PNG/WebM uploads and video trimming');

  await page.locator('#restartBtn').click(); await page.locator('#playBtn').click();
  await page.waitForFunction(() => document.getElementById('currentTime').textContent !== '00:00');
  await page.locator('#playBtn').click();
  await page.locator('#saveBtn').click();
  await page.waitForFunction(() => document.getElementById('saveStatus').textContent === 'Đã lưu trên thiết bị này');
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.timeline-clip').length === 7);
  assert.equal(await page.locator('#mediaCount').innerText(), '7');
  assert.equal(await page.locator('#clipStart').inputValue(), '0.2');
  console.log('PASS: playback and local project restoration with uploaded media');

  await page.setViewportSize({ width: 390, height: 844 });
  const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, rect: document.getElementById('previewCanvas').getBoundingClientRect().toJSON() }));
  assert(layout.scrollWidth <= layout.width, 'mobile page must not overflow horizontally');
  assert(Math.abs(layout.rect.width / layout.rect.height - 9 / 16) < 0.01, 'mobile preview must preserve portrait aspect ratio');
  await page.setViewportSize({ width: 1440, height: 1080 });
  console.log('PASS: mobile layout and undistorted portrait preview');

  while (await count() > 1) { await page.locator('.timeline-clip').first().click(); await page.locator('#deleteBtn').click(); }
  // A real PCM WAV exercises audio decoding and inclusion in the recorded output.
  const rate = 16000, samples = 32000, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(36 + samples * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i / rate * 440 * Math.PI * 2) * 12000), 44 + i * 2);
  await page.locator('#audioInput').setInputFiles({ name: 'smoke-tone.wav', mimeType: 'audio/wav', buffer: wav });
  await page.waitForFunction(() => document.getElementById('audioTrack').classList.contains('has-audio'));
  await page.locator('#exportBtn').click(); await page.locator('#exportFormat').selectOption('webm'); await page.locator('#startExport').click();
  await page.waitForSelector('#exportResult:not(.hidden)', { timeout: 20000 });
  const downloaded = page.waitForEvent('download'); await page.locator('#downloadVideo').click();
  const outputPath = path.join(temp, 'output.webm'); await (await downloaded).saveAs(outputPath);
  assert(fs.statSync(outputPath).size > 1000, 'export should contain encoded media');
  const decoded = await page.evaluate(async () => {
    const video = document.createElement('video'); video.src = document.getElementById('downloadVideo').href; video.muted = true;
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('Export cannot be decoded')); });
    const result = { width: video.videoWidth, height: video.videoHeight };
    await video.play(); result.audioTracks = video.captureStream().getAudioTracks().length;
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Export playback never completed')), 6000); video.onended = () => { clearTimeout(timer); resolve(); }; });
    result.duration = video.duration; result.endTime = video.currentTime; return result;
  });
  assert.equal(decoded.width, 720); assert.equal(decoded.height, 1280); assert.equal(decoded.audioTracks, 1);
  assert(Number.isFinite(decoded.duration) && decoded.duration >= 0.8 && decoded.duration < 2.5);
  assert(Math.abs(decoded.endTime - decoded.duration) < 0.1);
  console.log('PASS: real WebM export, audio track, decoding and playback to completion');
  await page.locator('#exportDialog .dialog-close').click();
  await page.locator('#deleteBtn').click(); assert.equal(await count(), 0); assert(await page.locator('#previewEmpty').isVisible());
  await page.locator('#undoBtn').click(); assert.equal(await count(), 1);
  assert.deepEqual(errors, [], 'no unhandled browser errors');
  assert.deepEqual(externalRequests, [], 'local editor smoke test must not contact external services');
  console.log('PASS: empty state, undo and no external requests or page errors');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); fs.rmSync(temp, { recursive: true, force: true });
});
