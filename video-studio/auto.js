/* Automatic reference-guided editing and real image-to-video queue orchestration. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const svg = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const aborted = () => new DOMException('Đã dừng', 'AbortError');
  let adapter, dialog, initialized = false, status = {}, busy = false, uploading = false;
  let controller = null, activeJob = null, referenceFile = null, analysis = null, referenceUrl = null;
  const selected = new Set(), jobs = new Map();

  function markup() {
    return `<div class="auto-head"><div><span class="auto-eyebrow">LUMA AUTOPILOT · ẢNH → VIDEO</span><h2>Từ một ý tưởng.<br>Đến cả một thước phim.</h2><p>Chọn tư liệu, thêm mẫu bạn thích. Để bản dựng tự hoàn thành.</p></div><button class="auto-close" id="autoCloseBtn" aria-label="Đóng">×</button><span class="auto-head-art" aria-hidden="true">${svg('image')}<i>✦</i>${svg('film')}</span></div>
    <div class="auto-content"><div class="auto-mode-grid" role="radiogroup" aria-label="Cách dựng video"><label class="auto-mode-card"><input type="radio" name="autoMode" value="generate"><span class="auto-mode-icon">✦</span><strong>Ảnh thành video AI</strong><small>Tạo chuyển động mới từ ảnh qua fal.ai.<br>Có phí dịch vụ · cần khóa video API</small></label><label class="auto-mode-card"><input type="radio" name="autoMode" value="edit" checked><span class="auto-mode-icon">${svg('cut')}</span><strong>Dựng tư liệu theo mẫu</strong><small>Tự cắt, sắp cảnh, thêm chữ và màu.<br>Dựng cục bộ hoặc AI phân tích</small></label></div>
    <div class="auto-connect" id="autoConnectionStatus" role="status">Đang kiểm tra khả năng AI…</div>
    <div class="auto-steps"><section class="auto-step"><div class="auto-step-heading"><span>01</span><div><h3>Những khoảnh khắc của bạn</h3><p id="autoSourceHint">Chọn ảnh hoặc video để làm tư liệu chính.</p></div></div><label class="auto-upload" id="autoSourceDrop">${svg('upload')}<strong>Chọn ảnh & video từ thiết bị</strong><span>hoặc kéo thả vào đây · tối đa 12 tư liệu mỗi bản dựng</span><input id="autoSourceInput" type="file" accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,video/quicktime" multiple hidden></label><div class="auto-source-heading"><span id="autoSourceCount">Chưa có tư liệu</span><label><input id="autoUseDemo" type="checkbox"> Dùng ảnh minh họa để thử</label></div><div class="auto-source-grid" id="autoSourceGrid"></div></section>
    <section class="auto-step"><div class="auto-step-heading"><span>02</span><div><h3>Phong cách bạn muốn hướng đến</h3><p id="autoReferenceHint">Video mẫu giúp nhận biết nhịp cắt, màu sắc và bố cục.</p></div></div><label class="auto-upload auto-reference-upload" id="autoReferenceDrop">${svg('film')}<strong id="autoReferenceName">Thêm video mẫu tham chiếu</strong><span>MP4, WebM · tối đa 120 giây / 250 MB</span><input id="autoReferenceInput" type="file" accept="video/mp4,video/webm,video/quicktime" hidden></label><div class="auto-reference-preview hidden" id="autoReferencePreview"><video id="autoReferenceVideo" muted playsinline controls></video><div><p id="autoReferenceInfo">Sẽ phân tích các khung hình theo thời gian.</p><button type="button" class="text-btn" id="autoRemoveReference">Bỏ video mẫu</button></div></div><div class="auto-reference-analysis hidden" id="autoReferenceAnalysis"></div></section>
    <section class="auto-step"><div class="auto-step-heading"><span>03</span><div><h3>Kể điều bạn đang hình dung</h3><p>Chủ thể, chuyển động, cảm xúc và thông điệp bạn muốn giữ lại.</p></div></div><textarea id="autoIdea" maxlength="1500" rows="4" placeholder="Ví dụ: Dùng ảnh sản phẩm của tôi tạo video dọc. Máy quay tiến nhẹ, ánh sáng buổi sáng, chuyển động tự nhiên; dựng nhịp và chữ như video mẫu."></textarea><div class="auto-options"><label id="autoScenesControl" class="hidden">Số cảnh AI tạo <select id="autoMaxScenes"><option value="1">1 cảnh · tối đa 10 giây</option><option value="2">2 cảnh · tối đa 20 giây</option><option value="3">3 cảnh · tối đa 30 giây</option><option value="4">4 cảnh · tối đa 40 giây</option></select></label><label class="auto-check"><input type="checkbox" id="autoExportAfter"><span>Tự xuất video sau khi dựng xong</span></label></div></section></div>
    <div class="auto-consent-panel"><label class="auto-check"><input type="checkbox" id="autoConsent"><span id="autoConsentText">Tôi đồng ý gửi ý tưởng và ảnh/khung mẫu đến OpenAI để phân tích khi có kết nối AI. Dựng cục bộ không cần gửi ảnh đi.</span></label><p id="autoPrivacyNote">Video mẫu đầy đủ không được gửi đi. Phong cách được tham khảo từ các khung mẫu; kết quả có thể khác video gốc.</p></div>
    <div class="auto-error hidden" id="autoError" role="alert"></div><div class="auto-progress hidden" id="autoProgress" role="status" aria-live="polite"><span class="auto-spinner"></span><div><strong id="autoProgressTitle">Đang chuẩn bị</strong><p id="autoProgressDetail"></p></div><button class="btn btn-ghost" id="autoCancelBtn">Dừng</button></div><div class="auto-result hidden" id="autoResult"><span>✓</span><div><h3 id="autoResultTitle">Bản dựng đã hoàn thành</h3><p id="autoResultSummary"></p></div><button class="btn btn-primary" id="autoViewResult">Xem bản dựng</button></div></div>
    <div class="auto-footer"><p id="autoFooterNote">Bản dựng hiện tại được giữ nguyên cho tới khi có kết quả hoàn chỉnh.</p><button class="btn btn-primary" id="autoBuildBtn">${svg('spark')}<span>Dựng tự động theo mẫu</span>${svg('chevron')}</button></div>`;
  }
  const mode = () => dialog.querySelector('input[name="autoMode"]:checked').value;
  function fail(message) {$('autoError').textContent = message; $('autoError').classList.remove('hidden');}
  function progress(title, detail = '') {$('autoProgressTitle').textContent = title; $('autoProgressDetail').textContent = detail;}
  function availableAssets() {
    return adapter.getAssets().filter(asset => (!asset.builtin || $('autoUseDemo').checked) && (mode() !== 'generate' || asset.type === 'image'));
  }
  function renderSources(selectNew = false) {
    const items = availableAssets();
    if (selectNew) items.forEach(asset => {if (items.filter(item => selected.has(item.id)).length < 12) selected.add(asset.id);});
    $('autoSourceGrid').innerHTML = items.map(asset => `<label class="auto-source-card"><input type="checkbox" data-auto-asset="${esc(asset.id)}" ${selected.has(asset.id) ? 'checked' : ''}><span>${asset.type === 'image' ? `<img src="${esc(asset.url)}" alt="">` : `<video src="${esc(asset.url)}" muted preload="metadata"></video><i>VIDEO</i>`}</span><small title="${esc(asset.name)}">${esc(asset.name)}</small></label>`).join('') || '<p class="auto-source-empty">Tư liệu bạn tải lên sẽ xuất hiện ở đây.</p>';
    const count = items.filter(asset => selected.has(asset.id)).length;
    $('autoSourceCount').textContent = `${count} tư liệu được chọn`;
    $('autoSourceGrid').querySelectorAll('[data-auto-asset]').forEach(input => input.onchange = () => {
      if (input.checked && availableAssets().filter(a => selected.has(a.id)).length >= 12) {input.checked = false; adapter.notify('Mỗi bản dựng dùng tối đa 12 tư liệu.'); return;}
      input.checked ? selected.add(input.dataset.autoAsset) : selected.delete(input.dataset.autoAsset);
      $('autoSourceCount').textContent = `${availableAssets().filter(a => selected.has(a.id)).length} tư liệu được chọn`;
    });
  }
  function updateMode() {
    const generating = mode() === 'generate';
    $('autoScenesControl').classList.toggle('hidden', !generating);
    $('autoSourceInput').accept = generating ? 'image/jpeg,image/png,image/webp,image/avif' : 'image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,video/quicktime';
    $('autoSourceHint').textContent = generating ? 'Mỗi ảnh là khung bắt đầu để AI tạo chuyển động mới.' : 'Chọn ảnh hoặc video để làm tư liệu chính.';
    $('autoReferenceHint').textContent = generating ? 'Tùy chọn: thêm video mẫu để tham khảo phong cách. Không có mẫu, AI làm theo ý tưởng.' : 'Cần video mẫu để đo nhịp cắt, màu sắc và bố cục theo thời gian.';
    $('autoConsentText').textContent = generating ? 'Tôi đồng ý gửi ảnh gốc được chọn và mô tả chuyển động đến fal.ai để tạo video có phí. Nếu bật OpenAI, ý tưởng và ảnh/khung mẫu cũng được gửi để lập bản dựng.' : 'Tôi đồng ý gửi ý tưởng và ảnh/khung mẫu đến OpenAI để phân tích khi có kết nối AI. Không đánh dấu: chỉ dựng theo phân tích cục bộ, không gọi AI.';
    $('autoPrivacyNote').textContent = generating ? 'Video mẫu đầy đủ không được gửi đi. Mỗi cảnh tạo mới là một lượt API có thể phát sinh phí. Không có cam kết sao chép chính xác chuyển động trong video mẫu.' : 'Video mẫu đầy đủ không được gửi đi. Dựng theo nhịp đo được không tạo ra chuyển động AI mới từ ảnh.';
    $('autoBuildBtn').querySelector('span').textContent = generating ? 'Tạo video AI từ ảnh' : 'Dựng tự động theo mẫu';
    $('autoFooterNote').textContent = generating ? 'Chỉ tạo tối đa số cảnh bạn chọn. Không có lượt API tạo video trước khi bạn nhấn nút này.' : 'Bản dựng hiện tại được giữ nguyên cho tới khi có kết quả hoàn chỉnh.';
    renderSources(); renderStatus();
  }
  function renderStatus() {
    if (status.unavailable) {$('autoConnectionStatus').textContent = 'Cần chạy máy chủ Luma để dùng luồng tự động: python3 server.py --port 8081'; $('autoConnectionStatus').className = 'auto-connect unavailable'; return;}
    const planner = status.plannerConfigured ? 'AI phân tích: đã cấu hình OpenAI' : 'Phân tích cục bộ: sẵn sàng · chưa cấu hình OpenAI';
    const generation = status.videoConfigured ? `Tạo video AI: đã cấu hình ${status.videoProvider || 'fal.ai'}` : 'Tạo video AI: cần LUMA_VIDEO_KEY trên máy chủ';
    $('autoConnectionStatus').textContent = `${planner}. ${generation}.`;
    $('autoConnectionStatus').className = `auto-connect ${status.videoConfigured ? 'ready' : ''}`;
  }
  async function checkStatus() {
    try {
      const response = await fetch('api/auto/status', {signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error(); status = await response.json();
    } catch {status = {unavailable:true};}
    renderStatus();
  }
  function setBusy(value) {
    busy = value;
    dialog.querySelectorAll('input,textarea,select').forEach(element => element.disabled = value);
    $('autoBuildBtn').disabled = value || uploading;
    $('autoProgress').classList.toggle('hidden', !value);
    $('autoCloseBtn').disabled = value;
  }
  function checkAbort(signal) {if (signal?.aborted) throw aborted();}
  const delay = (ms, signal) => new Promise((resolve, reject) => {
    checkAbort(signal);
    const done = () => {signal?.removeEventListener('abort', cancel); resolve();};
    const timer = setTimeout(done, ms);
    const cancel = () => {clearTimeout(timer); reject(aborted());};
    signal?.addEventListener('abort', cancel, {once:true});
  });
  async function jsonRequest(url, options = {}) {
    const response = await fetch(url, options); let data;
    try {data = await response.json();} catch {throw new Error('Máy chủ không trả về dữ liệu hợp lệ. Hãy chạy máy chủ Luma mới nhất.');}
    if (!response.ok) {const error = new Error(typeof data.error === 'string' ? data.error : 'Máy chủ chưa xử lý được yêu cầu.'); error.httpStatus = response.status; throw error;}
    return data;
  }
  function waitFor(element, eventName, signal, timeout = 20000) {
    return new Promise((resolve, reject) => {
      checkAbort(signal);
      const cleanup = () => {clearTimeout(timer); element.removeEventListener(eventName, done); element.removeEventListener('error', bad); signal?.removeEventListener('abort', cancel);};
      const done = () => {cleanup(); resolve();}, bad = () => {cleanup(); reject(new Error('Không đọc được tư liệu. Hãy dùng ảnh JPG/PNG hoặc video MP4/WebM.'));}, cancel = () => {cleanup(); reject(aborted());};
      const timer = setTimeout(() => {cleanup(); reject(new Error('Đọc tư liệu quá lâu. Hãy thử tệp nhỏ hơn hoặc định dạng khác.'));}, timeout);
      element.addEventListener(eventName, done, {once:true}); element.addEventListener('error', bad, {once:true}); signal?.addEventListener('abort', cancel, {once:true});
    });
  }
  async function sampleAsset(asset, {signal} = {}) {
    const image = asset.type === 'image'; const element = image ? new Image() : document.createElement('video');
    if (!image) {element.muted = true; element.playsInline = true; element.preload = 'auto';}
    try {
      const loaded = waitFor(element, image ? 'load' : 'loadeddata', signal); element.src = asset.url; await loaded;
      const w = element.videoWidth || element.naturalWidth, h = element.videoHeight || element.naturalHeight;
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(w / Math.max(w, h) * 384)); canvas.height = Math.max(1, Math.round(h / Math.max(w, h) * 384));
      const ctx = canvas.getContext('2d'), samples = [];
      const times = image ? [0] : [0, Math.max(0, Math.min(element.duration - .08, element.duration * .65))];
      for (const time of times) {
        checkAbort(signal);
        if (!image && Math.abs(element.currentTime - time) > .02) {const seeked = waitFor(element, 'seeked', signal); element.currentTime = time; await seeked;}
        ctx.drawImage(element, 0, 0, canvas.width, canvas.height); samples.push({time, thumbnail:canvas.toDataURL('image/jpeg', .65)});
      }
      return samples;
    } finally {if (!image) element.pause(); element.removeAttribute('src'); if (!image) element.load();}
  }
  async function generationImage(asset, ratio, signal) {
    const image = new Image(); const loaded = waitFor(image, 'load', signal); image.src = asset.url; await loaded;
    const [width,height] = ratio === '16:9' ? [1280,720] : ratio === '1:1' ? [1024,1024] : [720,1280];
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight), w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    canvas.getContext('2d').drawImage(image, (width-w)/2, (height-h)/2, w, h);
    return canvas.toDataURL('image/jpeg', .9);
  }
  async function generateScenes(plan, assets, signal) {
    const sceneCount = Number($('autoMaxScenes').value), chosen = plan.scenes.slice(0, sceneCount), completed = [];
    if (!chosen.length) throw new Error('Kế hoạch không có cảnh để tạo video.');
    for (let index = 0; index < chosen.length; index++) {
      checkAbort(signal); const scene = {...chosen[index]}, source = assets.find(asset => asset.id === scene.assetId);
      if (!source || source.type !== 'image') throw new Error('Tạo chuyển động AI cần một ảnh nguồn hợp lệ cho từng cảnh.');
      const duration = scene.duration * (scene.speed || 1) > 5 ? 10 : 5;
      const prompt = `${scene.generationPrompt || 'Create natural, coherent motion from the supplied image. Preserve the subject and its identity.'}\nUser idea: ${$('autoIdea').value.trim()}`.slice(0,2000);
      const cacheKey = JSON.stringify([source.id, prompt, duration, plan.ratio]);
      let entry = jobs.get(cacheKey);
      if (entry?.ambiguous) throw new Error('Chưa xác nhận được lần gửi trước. Không tự gửi lại để tránh tính phí hai lần. Kiểm tra tác vụ trong tài khoản fal.ai trước khi thử bằng một mô tả mới.');
      if (entry?.mediaId && adapter.getAssets().some(asset => asset.id === entry.mediaId)) {
        completed.push({...scene, assetId:entry.mediaId, duration:Math.min(scene.duration, entry.duration), start:0, speed:1, motion:'none'}); continue;
      }
      progress(`Tạo chuyển động AI · cảnh ${index+1}/${chosen.length}`, 'Chuẩn bị ảnh bắt đầu và mô tả chuyển động.');
      if (!entry?.id) {
        entry ||= {clientRequestId:crypto.randomUUID()}; jobs.set(cacheKey, entry);
        const image = await generationImage(source, plan.ratio, signal);
        // A client request id also lets a supporting backend deduplicate a retry.
        try {
          const job = await jsonRequest('api/video/jobs', {method:'POST', signal, headers:{'Content-Type':'application/json'}, body:JSON.stringify({image,prompt,duration,clientRequestId:entry.clientRequestId})});
          if (typeof job.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(job.id)) throw new Error('Máy chủ không trả mã tác vụ hợp lệ.');
          entry.id = job.id;
        } catch (error) {
          // The request may have reached the paid provider even if its response was lost.
          if (!error.httpStatus || error.httpStatus >= 500) entry.ambiguous = true; else jobs.delete(cacheKey); throw error;
        }
      }
      activeJob = entry.id;
      const started = Date.now();
      while (true) {
        checkAbort(signal);
        if (Date.now() - started > 15 * 60 * 1000) throw new Error('Tác vụ đã chờ 15 phút. Tác vụ được giữ lại; nhấn thử lại để tiếp tục kiểm tra thay vì tạo lượt mới.');
        const job = await jsonRequest(`api/video/jobs/${encodeURIComponent(entry.id)}`, {signal});
        const labels = {queued:'Đang chờ trong hàng đợi fal.ai.',processing:'AI đang tạo chuyển động từ ảnh.',in_progress:'AI đang tạo chuyển động từ ảnh.',completed:'Đã tạo xong chuyển động. Đang nhận video.',cancel_requested:'Đã gửi yêu cầu dừng, chờ nhà cung cấp xác nhận.'};
        const pct = typeof job.progress === 'number' && Number.isFinite(job.progress) ? ` ${Math.max(0,Math.min(100,Math.round(job.progress)))}%` : '';
        progress(`Tạo chuyển động AI · cảnh ${index+1}/${chosen.length}${pct}`, labels[job.status] || 'Đang kiểm tra trạng thái từ nhà cung cấp.');
        if (job.status === 'failed' || job.status === 'cancelled') {jobs.delete(cacheKey); throw new Error(job.status === 'cancelled' ? 'Tác vụ đã bị hủy. Chọn tạo lại sẽ bắt đầu lượt API mới.' : 'Nhà cung cấp không tạo được cảnh này. Tạo lại sẽ là lượt API mới.');}
        if (job.status === 'completed') break;
        await delay(3000, signal);
      }
      const response = await fetch(`api/video/jobs/${encodeURIComponent(entry.id)}/content`, {signal});
      if (!response.ok) {let data; try {data = await response.json();} catch {} throw new Error(data?.error || 'Chưa tải được video đã tạo. Thử lại sẽ dùng tác vụ cũ.');}
      const contentType = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
      if (!['video/mp4','video/webm'].includes(contentType)) throw new Error('Dịch vụ trả về định dạng video chưa được hỗ trợ. Chỉ nhận MP4 hoặc WebM.');
      const blob = await response.blob(); checkAbort(signal);
      const file = new File([blob], `ai-scene-${index+1}.${contentType === 'video/webm' ? 'webm' : 'mp4'}`, {type:contentType});
      const result = await adapter.addGenerated(file, source.id);
      entry.mediaId = typeof result === 'string' ? result : result.id;
      entry.duration = adapter.getAssets().find(asset => asset.id === entry.mediaId)?.duration || duration;
      if (!entry.mediaId || !Number.isFinite(entry.duration)) throw new Error('Video tạo xong chưa nhập được vào thư viện.');
      activeJob = null;
      completed.push({...scene, assetId:entry.mediaId, duration:Math.min(scene.duration, entry.duration), start:0, speed:1, motion:'none'});
    }
    return {...plan, scenes:completed};
  }
  async function build() {
    if (busy || uploading) return;
    $('autoError').classList.add('hidden'); $('autoResult').classList.add('hidden');
    const generating = mode() === 'generate', idea = $('autoIdea').value.trim();
    const assets = availableAssets().filter(asset => selected.has(asset.id));
    if (!assets.length) return fail(generating ? 'Hãy chọn ít nhất một ảnh để AI tạo video.' : 'Hãy chọn ít nhất một ảnh hoặc video làm tư liệu.');
    if (!idea) return fail('Hãy nêu ý tưởng cho bản dựng của bạn.');
    if (!generating && !referenceFile) return fail('Thêm video mẫu để dựng theo phong cách và nhịp cắt tham chiếu.');
    if (status.unavailable) return fail('Luồng tự động cần máy chủ Luma. Chạy python3 server.py --port 8081 rồi mở trang từ máy chủ đó.');
    if (generating && !status.videoConfigured) return fail('Chưa có khóa tạo video AI. Thiết lập LUMA_VIDEO_KEY trên máy chủ và cho phép queue.fal.run / *.fal.media trong cài đặt mạng, rồi khởi động lại máy chủ.');
    if (generating && !$('autoConsent').checked) return fail('Tạo video AI cần sự đồng ý gửi ảnh tới fal.ai và thực hiện lượt API có phí.');
    controller = new AbortController(); const signal = controller.signal; setBusy(true);
    try {
      if (referenceFile && !analysis) {
        progress('Đọc phong cách video mẫu', 'Phân tích các khung hình theo thời gian ngay trên thiết bị.');
        analysis = await window.LumaReference.analyze(referenceFile, {signal,onProgress:info => {
          const number = typeof info === 'number' ? info : info?.progress;
          progress('Đọc phong cách video mẫu', Number.isFinite(number) ? `Đang lấy mẫu ${Math.round(number <= 1 ? number*100 : number)}% · không gửi video đầy đủ đi.` : 'Đang đo nhịp cắt và màu sắc theo thời gian.');
        }});
        $('autoReferenceAnalysis').classList.remove('hidden');
        $('autoReferenceAnalysis').innerHTML = `<strong>${analysis.shotDurations.length} đoạn đo được · ${analysis.duration.toFixed(1)} giây · ${esc(analysis.ratio)}</strong><span>Nhịp ${analysis.tempo === 'fast' ? 'nhanh' : analysis.tempo === 'slow' ? 'chậm' : 'vừa'} · lấy mẫu ${analysis.frames.length} khung hình</span><div>${analysis.frames.slice(0,6).map(frame=>`<img src="${frame.thumbnail}" alt="Khung mẫu tại ${frame.time.toFixed(1)} giây">`).join('')}</div>`;
      }
      const useAI = !!status.plannerConfigured && $('autoConsent').checked;
      progress(useAI ? 'AI đang lập bản dựng' : 'Đang khớp nhịp dựng theo mẫu', useAI ? 'Chuẩn bị ảnh thu nhỏ và ý tưởng để phân tích.' : 'Dùng số đo nhịp cắt và màu sắc cục bộ, không gọi AI phân tích.');
      const inputs = [];
      for (const asset of assets) {
        checkAbort(signal);
        inputs.push({id:asset.id,name:asset.name,mediaType:asset.type,duration:asset.type === 'image' ? 30 : asset.duration,frames:useAI ? await sampleAsset(asset,{signal}) : []});
      }
      const reference = analysis ? {...analysis,frames:useAI ? analysis.frames : []} : null;
      const response = await jsonRequest('api/auto/plan', {method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:idea,mode:mode(),reference,assets:inputs,useAI,maxScenes:generating ? Number($('autoMaxScenes').value) : 30})});
      let plan = response.plan;
      if (!plan || !Array.isArray(plan.scenes) || !plan.scenes.length) throw new Error('Máy chủ chưa tạo được kế hoạch dựng hợp lệ.');
      if (generating) plan = await generateScenes(plan, assets, signal);
      checkAbort(signal); progress('Hoàn thiện bản dựng', 'Áp dụng thứ tự cảnh, thời lượng, chữ và màu sắc.');
      await adapter.applyPlan(plan);
      const duration = plan.scenes.reduce((sum,scene)=>sum+scene.duration,0);
      $('autoResultTitle').textContent = generating ? 'Video AI từ ảnh đã sẵn sàng' : 'Đã dựng tư liệu theo mẫu';
      $('autoResultSummary').textContent = `${plan.scenes.length} cảnh · ${duration.toFixed(1)} giây · ${plan.ratio}. ${response.method === 'ai' ? 'AI phân tích mẫu và lập bản dựng.' : 'Nhịp dựng từ số đo cục bộ.'} ${generating ? 'Chuyển động mới được tạo bởi fal.ai. ' : ''}${plan.summary || ''}`;
      $('autoResult').classList.remove('hidden');
      if ($('autoExportAfter').checked) {dialog.close(); await adapter.exportVideo();}
      else adapter.notify(generating ? 'Đã tạo video AI từ ảnh và hoàn thiện timeline.' : 'Đã hoàn thành bản dựng theo mẫu. Bạn có thể xem hoặc xuất ngay.');
    } catch (error) {
      if (error.name === 'AbortError') fail('Đã dừng luồng tự động. Bản dựng chưa hoàn tất không được áp dụng. Tác vụ AI đã gửi có thể vẫn phát sinh phí từ nhà cung cấp.');
      else fail(error.message || 'Không hoàn thành được bản dựng. Tư liệu và dự án hiện tại được giữ lại.');
    } finally {controller = null; activeJob = null; setBusy(false);}
  }
  async function cancel() {
    const id = activeJob;
    controller?.abort();
    if (id) {
      try {await fetch(`api/video/jobs/${encodeURIComponent(id)}`, {method:'DELETE',signal:AbortSignal.timeout(10000)});} catch {}
    }
  }
  async function upload(files) {
    if (busy || uploading) return;
    const chosen = Array.from(files).slice(0,12);
    if (mode() === 'generate' && chosen.some(file => !file.type.startsWith('image/'))) return fail('Chế độ ảnh thành video AI chỉ nhận ảnh nguồn. Video mẫu được thêm ở bước 02.');
    uploading = true; $('autoBuildBtn').disabled = true;
    const before = new Set(adapter.getAssets().map(asset=>asset.id));
    try {
      await adapter.uploadFiles(chosen);
      adapter.getAssets().filter(asset=>!before.has(asset.id)).forEach(asset=>{if (availableAssets().filter(item=>selected.has(item.id)).length < 12) selected.add(asset.id);});
      renderSources();
    } catch(error) {fail(error.message || 'Không tải được tư liệu.');}
    finally {uploading = false; $('autoBuildBtn').disabled = false; $('autoSourceInput').value = '';}
  }
  function setReference(file) {
    if (busy || !file) return;
    if (!file.type.startsWith('video/') || file.size > 250*1024**2) return fail('Video mẫu cần là MP4/WebM, tối đa 250 MB và 120 giây.');
    referenceFile = file; analysis = null;
    if (referenceUrl) URL.revokeObjectURL(referenceUrl); referenceUrl = URL.createObjectURL(file);
    $('autoReferenceVideo').src = referenceUrl; $('autoReferenceName').textContent = file.name;
    $('autoReferencePreview').classList.remove('hidden'); $('autoReferenceAnalysis').classList.add('hidden');
    $('autoReferenceInfo').textContent = `${file.name} · ${(file.size/1024**2).toFixed(1)} MB`;
    $('autoReferenceInput').value = '';
  }
  function wireDrop(id, handler) {
    const target = $(id);
    target.addEventListener('dragover', event => {event.preventDefault(); if (!busy) target.classList.add('drag-over');});
    target.addEventListener('dragleave', () => target.classList.remove('drag-over'));
    target.addEventListener('drop', event => {event.preventDefault(); target.classList.remove('drag-over'); if (!busy) handler(event.dataTransfer.files);});
  }
  function init(nextAdapter) {
    if (initialized) return;
    adapter = nextAdapter; initialized = true;
    dialog = document.createElement('dialog'); dialog.id = 'autoDialog'; dialog.className = 'auto-dialog'; dialog.innerHTML = markup(); document.body.append(dialog);
    const open = () => {
      if (!$('autoIdea').value) $('autoIdea').value = adapter.getPrompt?.() || '';
      renderSources(selected.size === 0); $('autoError').classList.add('hidden'); dialog.showModal(); checkStatus();
    };
    $('autoStudioBtn').addEventListener('click',open);
    $('autoCloseBtn').onclick = () => dialog.close(); $('autoViewResult').onclick = () => dialog.close();
    dialog.addEventListener('cancel', event=>{if(busy){event.preventDefault();adapter.notify('Chọn Dừng để hủy luồng đang thực hiện.');}});
    dialog.querySelectorAll('[name="autoMode"]').forEach(input=>input.onchange=updateMode);
    $('autoUseDemo').onchange=()=>renderSources($('autoUseDemo').checked);
    $('autoSourceInput').onchange=event=>upload(event.target.files);
    $('autoReferenceInput').onchange=event=>setReference(event.target.files[0]);
    $('autoRemoveReference').onclick=()=>{referenceFile=null;analysis=null;if(referenceUrl)URL.revokeObjectURL(referenceUrl);referenceUrl=null;$('autoReferenceVideo').removeAttribute('src');$('autoReferencePreview').classList.add('hidden');$('autoReferenceAnalysis').classList.add('hidden');$('autoReferenceName').textContent='Thêm video mẫu tham chiếu';};
    wireDrop('autoSourceDrop',upload);wireDrop('autoReferenceDrop',files=>setReference(files[0]));
    $('autoBuildBtn').onclick=build;$('autoCancelBtn').onclick=cancel;
    updateMode();
    return {open};
  }
  window.LumaAuto = {init};
})();
