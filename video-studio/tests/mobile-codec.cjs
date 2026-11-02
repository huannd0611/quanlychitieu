// Verify the real MP4 encoder path used by browsers without WebM recording.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
let browser;
(async () => {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox']});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:8081');
  await page.waitForSelector('.timeline-clip');
  const supported = await page.evaluate(() => MediaRecorder.isTypeSupported('video/mp4'));
  assert(supported, 'The test runtime must have a real native MP4 encoder');
  await page.evaluate(() => {
    const supports = MediaRecorder.isTypeSupported.bind(MediaRecorder);
    // Simulate the capability set; the actual encoder/recording remains native.
    MediaRecorder.isTypeSupported = type => type.startsWith('video/mp4') && supports(type);
  });
  while (await page.locator('.timeline-clip').count() > 1) await page.locator('#deleteBtn').click();
  await page.locator('#clipDuration').fill('1'); await page.locator('#clipDuration').press('Tab');
  await page.locator('#exportBtn').click(); await page.locator('#exportFormat').selectOption('mp4');
  await page.route('**/api/render/mp4', () => {throw new Error('Native MP4 output must not need transcoding');});
  await page.locator('#startExport').click();
  await page.waitForSelector('#exportResult:not(.hidden)', {timeout:15000});
  assert.match(await page.locator('#downloadVideo').getAttribute('download'), /\.mp4$/);
  const result = await page.evaluate(async () => {
    const blob = await (await fetch(document.getElementById('downloadVideo').href)).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const video = document.createElement('video'); video.muted = true; video.src = URL.createObjectURL(blob);
    await new Promise((resolve,reject) => {video.onloadeddata = resolve; video.onerror = reject;});
    await video.play();
    await new Promise((resolve,reject) => {const t=setTimeout(()=>reject(new Error('Native MP4 playback did not end')),5000);video.onended=()=>{clearTimeout(t);resolve();};});
    return {mime:blob.type,signature:String.fromCharCode(...bytes.slice(4,8)),width:video.videoWidth,height:video.videoHeight,duration:video.duration};
  });
  assert(result.mime.startsWith('video/mp4')); assert.equal(result.signature,'ftyp');
  assert.equal(result.width,720); assert.equal(result.height,1280);
  assert(result.duration > .7 && result.duration < 2);
  assert.deepEqual(errors,[]);
  console.log('PASS: MP4-only browser capability, real native MP4 recording, portrait dimensions and playback');
})().catch(error => {console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();});
