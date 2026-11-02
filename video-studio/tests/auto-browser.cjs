// Start server.py first. Real local media + mocked generation provider, no paid API.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const base = process.env.STUDIO_URL || 'http://127.0.0.1:8081';
const origin = new URL(base).origin;
let browser;

async function fixtures(page) {
  return page.evaluate(async () => {
    const image = document.createElement('canvas'); image.width = 270; image.height = 480;
    const ink = image.getContext('2d'); ink.fillStyle = '#274663'; ink.fillRect(0, 0, 270, 480);
    ink.fillStyle = '#ffc560'; ink.fillRect(70, 110, 130, 230);
    ink.fillStyle = '#ffffff'; ink.font = '20px sans-serif'; ink.fillText('Source photo', 65, 400);
    const record = async (duration, reference) => {
      const canvas = document.createElement('canvas'); canvas.width = 270; canvas.height = 480;
      const context = canvas.getContext('2d'), stream = canvas.captureStream(20), chunks = [];
      const recorder = new MediaRecorder(stream, {mimeType:'video/webm'});
      const stopped = new Promise(resolve => {recorder.onstop = resolve;});
      recorder.ondataavailable = event => {if (event.data.size) chunks.push(event.data);};
      recorder.start();
      for (let i = 0; i < Math.round(duration * 20); i++) {
        context.fillStyle = reference ? ['#e71020', '#12cb30', '#1840e9'][Math.min(2, Math.floor(i / 22))] : '#274663';
        context.fillRect(0, 0, 270, 480);
        if (!reference) {
          context.fillStyle = '#ffc560'; context.fillRect(40 + i % 100, 110, 100, 230);
          context.fillStyle = '#ffffff'; context.font = '20px sans-serif'; context.fillText(`Motion ${i}`, 70, 400);
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
      return [...new Uint8Array(await new Blob(chunks, {type:'video/webm'}).arrayBuffer())];
    };
    return {image:image.toDataURL('image/png').split(',')[1], reference:await record(3.3, true), generated:await record(5.1, false)};
  });
}

async function main() {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox']});
  const page = await browser.newPage({viewport:{width:1440,height:1080}, acceptDownloads:true});
  page.setDefaultTimeout(20000);
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    external.push(url.origin); return route.abort();
  });
  await page.goto(base);
  await page.waitForSelector('.timeline-clip');
  const media = await fixtures(page);
  const imageFile = {name:'auto-source.png', mimeType:'image/png', buffer:Buffer.from(media.image,'base64')};
  const referenceFile = {name:'three-scene-reference.webm', mimeType:'video/webm', buffer:Buffer.from(media.reference)};
  const generatedBytes = Buffer.from(media.generated);
  const original = await page.locator('.timeline-clip').evaluateAll(nodes => nodes.map(node => node.dataset.clip));
  let videoConfigured = true, created = 0, deleted = 0, polls = 0, firstPollFails = true, holdPending = false;
  const submissions = [];
  await page.route('**/api/auto/status', route => route.fulfill({json:{plannerConfigured:false,videoConfigured,videoProvider:'fal.ai',videoModel:'mock-only'}}));
  await page.route('**/api/video/jobs', route => {
    assert.equal(route.request().method(), 'POST');
    const body = route.request().postDataJSON(); submissions.push(body); created++;
    assert(body.image.startsWith('data:image/jpeg;base64,'), 'actual starting image must be sent to the provider adapter');
    assert(body.prompt.length > 30, 'video generation needs a motion prompt');
    assert([5,10].includes(body.duration));
    assert.match(body.clientRequestId, /^[0-9a-f-]{36}$/);
    return route.fulfill({status:201,json:{id:`mock_job_${created}`,status:'queued'}});
  });
  await page.route('**/api/video/jobs/*', route => {
    if (route.request().method() === 'DELETE') {deleted++; return route.fulfill({json:{id:'mock_job_2',status:'cancel_requested'}});}
    polls++;
    if (firstPollFails) {firstPollFails = false; return route.fulfill({status:502,json:{error:'Lỗi kiểm tra tạm thời — có thể tiếp tục tác vụ cũ.'}});}
    return route.fulfill({json:{id:'mock_job_1',status:holdPending ? 'queued' : 'completed'}});
  });
  await page.route('**/api/video/jobs/*/content', route => route.fulfill({contentType:'video/webm',body:generatedBytes}));
  let localPlan;
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/auto/plan') {
      const payload = request.postDataJSON();
      assert.equal(payload.useAI, false, 'no planner key means local editing only');
      assert(payload.assets.every(asset => !asset.frames.length), 'local editing must not upload source thumbnails');
      if (payload.mode === 'edit') localPlan = payload;
    }
  });
  const open = async () => {
    await page.locator('#autoStudioBtn').click();
    await page.waitForFunction(() => !document.getElementById('autoConnectionStatus').textContent.includes('Đang kiểm tra'));
  };
  const waitIdle = () => page.waitForFunction(() => !document.getElementById('autoBuildBtn').disabled);
  const timelineIds = () => page.locator('.timeline-clip').evaluateAll(nodes => nodes.map(node => node.dataset.clip));

  await open();
  await page.locator('#autoSourceInput').setInputFiles(imageFile);
  await page.waitForFunction(() => document.getElementById('autoSourceCount').textContent.startsWith('1 '));
  await page.locator('#autoReferenceInput').setInputFiles(referenceFile);
  await page.locator('#autoIdea').fill('Dựng video dọc theo nhịp mẫu, màu tự nhiên, "Câu chuyện của tôi".');
  await page.locator('#autoExportAfter').uncheck();
  await page.locator('#autoBuildBtn').click();
  await page.waitForSelector('#autoResult:not(.hidden)', {timeout:30000});
  assert.match(await page.locator('#autoResultSummary').textContent(), /cục bộ/);
  assert.equal(localPlan.reference.frames.length, 0, 'local reference metadata must not include image uploads');
  assert.equal(localPlan.reference.shotDurations.length, 3, 'three actual visual scenes should be detected');
  assert.equal(localPlan.reference.ratio, '9:16');
  await page.locator('#autoViewResult').click();
  assert.equal(await page.locator('.timeline-clip').count(), 3);
  assert.equal(await page.locator('#ratioSelect').inputValue(), '9:16');
  const sceneDurations = await page.locator('.timeline-clip .clip-duration').allTextContents();
  const renderedDuration = sceneDurations.reduce((sum, value) => sum + parseFloat(value), 0);
  assert(Math.abs(renderedDuration - localPlan.reference.duration) < .25, 'timeline should match measured reference timing');
  await page.locator('#undoBtn').click();
  assert.deepEqual(await timelineIds(), original, 'automatic edit must be reversible as one change');
  console.log('PASS: actual reference analysis, local automatic edit, shot timing, portrait output and undo');

  await open();
  await page.locator('input[name="autoMode"][value="generate"]').check();
  await page.locator('#autoRemoveReference').click();
  await page.locator('#autoIdea').fill('Tạo chuyển động tự nhiên từ ảnh sản phẩm. Máy quay xoay chậm quanh hộp màu vàng.');
  await page.locator('#autoMaxScenes').selectOption('1');
  await page.locator('#autoConsent').uncheck();
  await page.locator('#autoBuildBtn').click();
  await page.waitForFunction(() => !document.getElementById('autoError').classList.contains('hidden'));
  assert.match(await page.locator('#autoError').textContent(), /đồng ý/);
  assert.equal(created, 0, 'no paid job may be submitted before consent');
  await page.locator('#autoConsent').check();
  await page.locator('#autoBuildBtn').click();
  await page.waitForFunction(() => document.getElementById('autoError').textContent.includes('Lỗi kiểm tra tạm thời'));
  await waitIdle();
  assert.equal(created, 1);
  assert.deepEqual(await timelineIds(), original, 'queue failure must leave the old timeline unchanged');
  await page.locator('#autoBuildBtn').click();
  await page.waitForSelector('#autoResult:not(.hidden)', {timeout:30000});
  await waitIdle();
  assert.equal(created, 1, 'retry must resume the same paid job instead of create another one');
  assert(polls >= 2);
  assert.match(await page.locator('#autoResultTitle').textContent(), /Video AI từ ảnh/);
  await page.locator('#autoViewResult').click();
  assert.equal(await page.locator('.timeline-clip').count(), 1);
  assert(await page.locator('#clipStart').isEnabled(), 'generated content must be imported as a real video asset');
  assert(Number(await page.locator('#clipDuration').inputValue()) >= 4.9);
  console.log('PASS: consent, real image payload, motion prompt, mock queue/content and retry without duplicate job');

  await page.locator('#exportBtn').click(); await page.locator('#exportFormat').selectOption('mp4'); await page.locator('#startExport').click();
  await page.waitForSelector('#exportResult:not(.hidden)', {timeout:20000});
  assert.match(await page.locator('#downloadVideo').getAttribute('download'), /\.mp4$/, 'MP4 must be created by the real local transcoder');
  assert.match(await page.locator('#exportResultText').textContent(), /MP4/);
  const output = await page.evaluate(async () => {
    const video = document.createElement('video'); video.src = document.getElementById('downloadVideo').href; video.muted = true;
    await new Promise((resolve,reject) => {video.onloadeddata = resolve; video.onerror = () => reject(new Error('Generated video export is not decodable'));});
    const result = {width:video.videoWidth,height:video.videoHeight};
    await video.play();
    await new Promise((resolve,reject) => {const timeout = setTimeout(() => reject(new Error('Generated video export never ended')),10000); video.onended = () => {clearTimeout(timeout);resolve();};});
    result.duration = video.duration; return result;
  });
  assert.equal(output.width,720); assert.equal(output.height,1280); assert(output.duration >= 4.9 && output.duration < 6);
  await page.locator('#exportDialog .dialog-close').click();
  console.log('PASS: generated-motion footage exported to a real decodable portrait MP4');

  const completedIds = await timelineIds();
  await open(); holdPending = true;
  await page.locator('#autoIdea').fill('Một chuyển động khác: máy quay trượt ngang nhẹ qua sản phẩm.');
  await page.locator('#autoBuildBtn').click();
  await page.waitForFunction(() => document.getElementById('autoProgressDetail').textContent.includes('hàng đợi'));
  assert.equal(created,2);
  await page.locator('#autoCancelBtn').click();
  await page.waitForFunction(() => document.getElementById('autoError').textContent.includes('Đã dừng'));
  await waitIdle();
  assert.equal(deleted,1, 'cancellation must reach the provider job adapter');
  assert.deepEqual(await timelineIds(), completedIds, 'cancelled generation must not replace a completed draft');
  await page.locator('#autoCloseBtn').click();
  videoConfigured = false;
  await open();
  await page.waitForFunction(() => document.getElementById('autoConnectionStatus').textContent.includes('cần LUMA_VIDEO_KEY'));
  await page.locator('#autoBuildBtn').click();
  assert.match(await page.locator('#autoError').textContent(), /Chưa có khóa tạo video AI/);
  assert.equal(created,2, 'unconfigured generation must never create a provider job');
  assert.deepEqual(await timelineIds(), completedIds);
  console.log('PASS: cancellation, preservation of existing draft and missing video-key guard');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: no external requests or unhandled browser errors');
}

main().catch(error => {console.error(error); process.exitCode = 1;}).finally(async () => {await browser?.close();});
