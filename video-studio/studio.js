/* Luma Studio: local editing plus explicitly requested AI planning/generation. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const uid = () => crypto.randomUUID();
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc = str => String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const timeLabel = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const initialMedia = [
    ['coast', 'Bờ biển xanh', 'scene-coast.svg'],
    ['mountain', 'Giữa những tầng mây', 'scene-mountain.svg'],
    ['forest', 'Một khoảng bình yên', 'scene-forest.svg'],
    ['city', 'Phố nhỏ Kyoto', 'scene-city.svg'],
    ['sunset', 'Chạm vào hoàng hôn', 'scene-sunset.svg']
  ].map(([id, name, filename]) => ({id, name, type:'image', builtin:`assets/${filename}`, url:`assets/${filename}`, duration:30}));
  const templates = [
    {id:'reels', name:'Daily moments', description:'Dọc 9:16 · nhanh & bắt mắt', tag:'REELS', image:'scene-city.svg', ratio:'9:16', style:'vivid', duration:2.5, transition:'cut', captions:['Một ngày rất khác ✦', 'Những điều nhỏ xíu', 'Lại khiến mình mỉm cười', 'Lưu lại khoảnh khắc này.']},
    {id:'cinema', name:'Cinematic journey', description:'Ngang 16:9 · chậm & cảm xúc', tag:'CINEMATIC', image:'scene-mountain.svg', ratio:'16:9', style:'cinematic', duration:5, transition:'fade', captions:['Đi xa một chút.', 'Chạm vào bình yên.', 'Giữ lại những điều đẹp đẽ.', 'Hẹn một hành trình mới.']},
    {id:'product', name:'Made to stand out', description:'Dọc 9:16 · sản phẩm & thương hiệu', tag:'PRODUCT', image:'scene-coast.svg', ratio:'9:16', style:'natural', duration:3, transition:'cut', captions:['Điều bạn đang tìm kiếm.', 'Từng chi tiết tạo khác biệt.', 'Đơn giản. Nhưng đặc biệt.', 'Khám phá ngay hôm nay.']},
    {id:'memories', name:'Little memories', description:'Vuông 1:1 · nhật ký nhẹ nhàng', tag:'LIFESTYLE', image:'scene-sunset.svg', ratio:'1:1', style:'cinematic', duration:4, transition:'fade', captions:['Có những ngày như thế.', 'Chỉ muốn bước thật chậm.', 'Để nhớ thật lâu.', 'Một chút hạnh phúc.']}
  ];
  let media = [...initialMedia], clips = [], selected = null;
  let settings = {ratio:'9:16', style:'vivid', transition:'cut', motion:true, template:'reels'};
  let projectName = 'Một ngày, ngàn khoảnh khắc';
  let audioData = null, audioElement = null, volume = 0.6, muted = false;
  let current = 0, playing = false, exporting = false, exportCancelled = false;
  let history = [], future = [], filter = 'all', db = null, saveTimer, toastTimer;
  let storageFailed = false, audioContext = null, audioSource = null, audioDestination = null;
  let aiConfigured = false, aiBusy = false, aiAbort = null;
  let exportUrl = null, exportRecorder = null, frameHandle = null, lastFrame = 0, lastClipId = null;
  let exportConversionAbort = null;
  const resources = new Map();
  const canvas = $('previewCanvas');
  const ctx = canvas.getContext('2d');
  const total = () => clips.reduce((sum, clip) => sum + clip.duration, 0);
  const activeClip = () => clips.find(clip => clip.id === selected);
  const mediaFor = clip => media.find(item => item.id === clip?.mediaId);
  const snapshot = () => JSON.stringify({clips, settings, selected, projectName});
  const remember = () => {history.push(snapshot()); if (history.length > 50) history.shift(); future = [];};
  function notice(message) {
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4500);
  }
  function locate(t) {
    let offset = 0;
    for (let i = 0; i < clips.length; i++) {
      if (t < offset + clips[i].duration || i === clips.length - 1) return {clip:clips[i], index:i, offset, local:clamp(t - offset, 0, clips[i].duration)};
      offset += clips[i].duration;
    }
    return null;
  }
  const clipOffset = id => {let offset = 0; for (const c of clips) {if (c.id === id) return offset; offset += c.duration;} return 0;};

  async function loadResource(item) {
    if (resources.has(item.id)) return resources.get(item.id);
    let element;
    if (item.type === 'video') {
      element = document.createElement('video');
      element.muted = true; element.playsInline = true; element.preload = 'auto';
    } else {element = new Image(); element.decoding = 'async';}
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {element.src = ''; reject(new Error('Tệp tải quá lâu hoặc định dạng chưa được hỗ trợ.'));}, 20000);
      element.addEventListener(item.type === 'video' ? 'loadeddata' : 'load', () => {clearTimeout(timer); resolve();}, {once:true});
      element.addEventListener('error', () => {clearTimeout(timer); reject(new Error(`Không thể đọc ${item.name}. Hãy thử JPG, PNG, MP4 (H.264) hoặc WebM.`));}, {once:true});
      element.src = item.url;
    });
    if (item.type === 'video') {
      if (!Number.isFinite(element.duration) || element.duration < 0.5) throw new Error('Video cần có thời lượng từ 0,5 giây và metadata hợp lệ.');
      item.duration = element.duration;
      // A same-origin thumbnail keeps the timeline light while retaining the real source.
      const thumbnail = document.createElement('canvas'); thumbnail.width = 240; thumbnail.height = 140;
      thumbnail.getContext('2d').drawImage(element, 0, 0, 240, 140);
      item.thumbnail = thumbnail.toDataURL('image/jpeg', .7);
    }
    resources.set(item.id, element);
    return element;
  }

  function setCanvasSize() {
    const [a, b] = settings.ratio.split(':').map(Number);
    canvas.width = a >= b ? 1280 : 720;
    canvas.height = Math.round(canvas.width * b / a);
    $('canvasWrap').style.aspectRatio = `${a} / ${b}`;
    $('canvasWrap').style.width = `min(100%, calc(var(--preview-height, 420px) * ${a / b}))`;
    $('canvasWrap').style.height = 'auto';
    $('ratioSelect').value = settings.ratio;
  }
  function wrapText(context, text, maxWidth) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const word of paragraph.split(' ')) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && context.measureText(candidate).width > maxWidth) {lines.push(line); line = word;} else line = candidate;
      }
      lines.push(line);
    }
    return lines;
  }
  function drawScene(context, clip, local, width, height) {
    const element = resources.get(clip.mediaId);
    context.save();
    context.fillStyle = '#142b2b'; context.fillRect(0, 0, width, height);
    if (element) {
      const iw = element.videoWidth || element.naturalWidth, ih = element.videoHeight || element.naturalHeight;
      const motion = clip.motion || (settings.motion ? 'push' : 'none');
      const progress = motion === 'pull' ? 1 - local / clip.duration : local / clip.duration;
      const scale = Math.max(width / iw, height / ih) * (motion !== 'none' && mediaFor(clip).type === 'image' ? 1.02 + .075 * progress : 1);
      const dw = iw * scale, dh = ih * scale;
      context.filter = ({cinematic:'saturate(0.8) sepia(0.19) contrast(1.07)', natural:'none', vivid:'saturate(1.22) contrast(1.04)', mono:'grayscale(1) contrast(1.1)'})[settings.style];
      context.drawImage(element, (width - dw) / 2, (height - dh) / 2, dw, dh);
      context.filter = 'none';
    }
    // Darken title-safe areas without altering the uploaded media itself.
    const shade = context.createLinearGradient(0, height * .32, 0, height);
    shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(8,16,24,.62)');
    context.fillStyle = shade; context.fillRect(0, 0, width, height);
    if (clip.caption) {
      const fontSize = Math.round(width * (settings.ratio === '9:16' ? .079 : .055));
      context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillStyle = clip.color || '#ffffff';
      context.shadowColor = 'rgba(0,0,0,.32)'; context.shadowBlur = width * .014;
      context.font = `700 ${fontSize}px system-ui, -apple-system, sans-serif`;
      const maxLines = settings.ratio === '16:9' ? 3 : 5;
      const lines = wrapText(context, clip.caption, width * .81).slice(0, maxLines);
      const lh = fontSize * 1.3;
      const textY = clip.position === 'top' ? .23 : clip.position === 'center' ? .5 : (settings.ratio === '9:16' ? .67 : .73);
      const y = height * textY - (lines.length - 1) * lh / 2;
      for (let i = 0; i < lines.length; i++) context.fillText(lines[i], width / 2, y + i * lh, width * .84);
      context.shadowBlur = 0;
    }
    context.restore();
  }
  function draw(context = ctx, width = canvas.width, height = canvas.height, at = current) {
    context.clearRect(0, 0, width, height);
    const location = locate(at);
    if (!location) {context.fillStyle = '#172129'; context.fillRect(0, 0, width, height); return;}
    const {clip, index, local} = location;
    if ((clip.transition || settings.transition) === 'fade' && index > 0 && local < Math.min(.45, clip.duration / 2)) {
      const previous = clips[index - 1];
      drawScene(context, previous, previous.duration, width, height);
      context.save(); context.globalAlpha = local / Math.min(.45, clip.duration / 2);
      drawScene(context, clip, local, width, height); context.restore();
    } else drawScene(context, clip, local, width, height);
  }
  function syncMedia(t, run) {
    const location = locate(t), target = location ? resources.get(location.clip.mediaId) : null;
    for (const [id, element] of resources) {
      if (!(element instanceof HTMLVideoElement)) continue;
      if (element !== target) {if (!element.paused) element.pause(); continue;}
      const speed = location.clip.speed || 1;
      const mediaTime = Math.min((location.clip.start || 0) + location.local * speed, element.duration - .03);
      element.playbackRate = speed;
      if (Math.abs(element.currentTime - mediaTime) > (run ? .3 : .04)) element.currentTime = mediaTime;
      if (run && element.paused) element.play().catch(() => notice('Không phát được clip. Hãy thử MP4/H.264 hoặc WebM.'));
      if (!run && !element.paused) element.pause();
    }
    if (audioElement) {
      const audioTime = t % audioElement.duration;
      if (Number.isFinite(audioTime) && Math.abs(audioElement.currentTime - audioTime) > .3) audioElement.currentTime = audioTime;
      audioElement.volume = muted ? 0 : volume;
      if (run && audioElement.paused) audioElement.play().catch(() => {});
      if (!run) audioElement.pause();
    }
    lastClipId = location?.clip.id;
  }
  function updateTime() {
    $('currentTime').textContent = timeLabel(current);
    $('totalTime').textContent = timeLabel(total());
    const track = $('timelineClips');
    const position = track.offsetLeft + (total() ? current / total() : 0) * track.offsetWidth;
    $('playhead').style.left = `${position}px`;
    $('playBtn').innerHTML = icon(playing ? 'pause' : 'play');
    $('playBtn').setAttribute('aria-label', playing ? 'Dừng video' : 'Phát video');
  }
  function seek(t) {current = clamp(t, 0, total()); syncMedia(current, playing); draw(); updateTime();}
  function pause() {
    playing = false; cancelAnimationFrame(frameHandle); frameHandle = null;
    syncMedia(current, false); updateTime();
  }
  function play() {
    if (!clips.length || exporting) return;
    if (playing) return pause();
    if (current >= total() - .03) current = 0;
    playing = true; lastFrame = performance.now(); syncMedia(current, true); updateTime();
    const step = now => {
      if (!playing) return;
      current = Math.min(total(), current + (now - lastFrame) / 1000); lastFrame = now;
      syncMedia(current, current < total()); draw(); updateTime();
      if (current >= total()) {pause(); return;}
      frameHandle = requestAnimationFrame(step);
    };
    frameHandle = requestAnimationFrame(step);
  }

  function renderLibrary() {
    const items = media.filter(item => filter === 'all' || item.type === filter);
    $('mediaCount').textContent = media.length;
    $('mediaGrid').innerHTML = items.length ? items.map(item => `<button class="media-card" data-add="${esc(item.id)}" title="Thêm ${esc(item.name)} vào timeline"><img src="${esc(item.thumbnail || item.url)}" alt="${esc(item.name)}"><span class="media-duration">${item.type === 'video' ? `${icon('film')} ${timeLabel(item.duration)}` : item.builtin ? 'Minh họa' : 'Ảnh'}</span><span class="media-add">+</span><span class="media-label">${esc(item.name)}</span></button>`).join('') : '<p class="empty-library">Chưa có video. Tải video của bạn lên để bắt đầu.</p>';
    $('mediaGrid').querySelectorAll('[data-add]').forEach(button => button.onclick = () => addClip(button.dataset.add));
  }
  function templateMarkup(template) {
    return `<button class="template-card ${settings.template === template.id ? 'active' : ''}" data-template="${template.id}"><div class="template-art"><img src="assets/${template.image}" alt=""><span>${icon('play')}</span></div><div class="template-copy"><span class="template-name">${template.name}</span><span class="template-meta">${template.description}</span><span class="template-tag">${template.tag}</span></div>${icon('chevron')}</button>`;
  }
  function renderTemplates() {
    $('quickTemplates').innerHTML = templates.slice(0, 2).map(templateMarkup).join('');
    $('fullTemplates').innerHTML = templates.map(templateMarkup).join('');
    document.querySelectorAll('[data-template]').forEach(button => button.onclick = () => applyTemplate(button.dataset.template));
  }
  function renderTimeline() {
    const width = Math.max(440, Math.min(2600, total() * 33));
    $('timelineTracks').style.minWidth = `${width + 92}px`;
    $('timelineRuler').style.minWidth = `${width + 92}px`;
    $('timelineClips').style.width = `${width}px`;
    $('captionTrack').style.width = `${width}px`;
    $('audioTrack').style.width = `${width}px`;
    $('timelineClips').innerHTML = clips.map((clip, i) => {
      const item = mediaFor(clip), proportion = total() ? clip.duration / total() * 100 : 0;
      return `<button class="timeline-clip ${selected === clip.id ? 'selected' : ''}" draggable="true" data-clip="${clip.id}" style="width:${proportion}%;flex:0 0 ${proportion}%" title="${esc(item.name)} — ${clip.duration} giây. Kéo để sắp xếp."><img src="${esc(item.thumbnail || item.url)}" alt=""><span class="clip-index">${String(i + 1).padStart(2, '0')}</span><span class="clip-name">${esc(item.name)}</span><span class="clip-duration">${clip.duration.toFixed(1)}s</span></button>`;
    }).join('');
    $('captionTrack').innerHTML = clips.map(clip => `<button class="caption-block" data-caption-clip="${clip.id}" style="width:${total() ? clip.duration / total() * 100 : 0}%;flex:0 0 ${total() ? clip.duration / total() * 100 : 0}%" title="${esc(clip.caption)}">${icon('text')}<span>${esc(clip.caption || 'Thêm lời dẫn')}</span></button>`).join('');
    const marks = Math.max(1, Math.ceil(total() / 2));
    $('timelineRuler').innerHTML = `<div style="position:relative;margin-left:92px;width:${width}px;height:100%">${Array.from({length:marks + 1}, (_, i) => `<button class="ruler-mark" data-seek="${i / marks * total()}" style="left:${i / marks * 100}%">${timeLabel(i / marks * total())}</button>`).join('')}</div>`;
    $('clipCount').textContent = `${clips.length} cảnh`;
    $('timelineDuration').textContent = `${Number(total().toFixed(1))} giây · ${clips.length} cảnh`;
    $('timelineClips').querySelectorAll('[data-clip]').forEach(button => {
      button.onclick = () => selectClip(button.dataset.clip);
      button.ondragstart = event => {event.dataTransfer.setData('text/luma-clip', button.dataset.clip); button.classList.add('dragging');};
      button.ondragend = () => button.classList.remove('dragging');
      button.ondragover = event => {event.preventDefault(); button.classList.add('drag-over');};
      button.ondragleave = () => button.classList.remove('drag-over');
      button.ondrop = event => {
        event.preventDefault(); button.classList.remove('drag-over');
        const id = event.dataTransfer.getData('text/luma-clip');
        const from = clips.findIndex(clip => clip.id === id), to = clips.findIndex(clip => clip.id === button.dataset.clip);
        if (from < 0 || from === to) return;
        remember(); const [clip] = clips.splice(from, 1); clips.splice(to, 0, clip); selected = id;
        pause(); current = clipOffset(id); changed();
      };
    });
    $('captionTrack').querySelectorAll('[data-caption-clip]').forEach(button => button.onclick = () => {selectClip(button.dataset.captionClip); openPanel('text');});
    $('timelineRuler').querySelectorAll('[data-seek]').forEach(button => button.onclick = () => seek(Number(button.dataset.seek)));
    updateAudioUI(); updateTime();
  }
  function renderInspector() {
    const clip = activeClip(), item = mediaFor(clip);
    $('selectedNumber').textContent = clip ? String(clips.indexOf(clip) + 1).padStart(2, '0') : '—';
    $('clipCaption').value = clip?.caption || '';
    $('captionLibrary').value = clip?.caption || '';
    $('clipDuration').value = clip?.duration || 3;
    $('clipDuration').max = item?.type === 'video' ? Math.min(30, (item.duration - (clip.start || 0)) / (clip.speed || 1)) : 30;
    $('clipStart').value = clip?.start || 0;
    $('clipStart').disabled = item?.type !== 'video';
    $('clipStart').max = item?.type === 'video' ? Math.max(0, item.duration - clip.duration * (clip.speed || 1)) : 0;
    for (const id of ['clipCaption', 'clipDuration', 'captionLibrary', 'applyCaption', 'deleteBtn', 'duplicateBtn', 'splitBtn']) $(id).disabled = !clip;
    $('styleSelect').value = settings.style; $('motionToggle').checked = settings.motion;
    document.querySelectorAll('[data-transition]').forEach(button => button.classList.toggle('active', button.dataset.transition === settings.transition));
    document.querySelectorAll('[data-color]').forEach(button => {button.classList.toggle('active', button.dataset.color === clip?.color); button.disabled = !clip;});
    $('undoBtn').disabled = !history.length; $('redoBtn').disabled = !future.length;
    $('previewEmpty').classList.toggle('hidden', !!clips.length);
    $('previewBadge').textContent = templates.find(template => template.id === settings.template)?.tag === 'REELS' ? 'MADE FOR YOUR MOMENTS' : (templates.find(template => template.id === settings.template)?.name || 'YOUR STORY').toUpperCase();
    $('previewBadge').classList.toggle('hidden', !clips.length);
  }
  function changed(save = true) {
    current = clamp(current, 0, total());
    setCanvasSize(); renderLibrary(); renderTimeline(); renderTemplates(); renderInspector(); syncMedia(current, playing); draw();
    if (save) scheduleSave();
  }
  function selectClip(id) {
    pause(); selected = id; current = clipOffset(id); renderTimeline(); renderInspector(); syncMedia(current, false); draw();
  }
  function addClip(mediaId) {
    if (clips.length >= 60) return notice('Mỗi dự án hỗ trợ tối đa 60 cảnh.');
    const item = media.find(m => m.id === mediaId); if (!item) return;
    remember();
    const clip = {id:uid(), mediaId, duration:Math.min(item.type === 'video' ? item.duration : 3, 5), start:0, caption:'', color:'#ffffff'};
    clips.push(clip); selected = clip.id; pause(); current = clipOffset(clip.id); changed(); notice('Đã thêm cảnh vào timeline.');
  }
  function applyTemplate(id) {
    const template = templates.find(item => item.id === id); if (!template) return;
    remember(); pause();
    settings = {...settings, ratio:template.ratio, style:template.style, transition:template.transition, template:id, motion:true};
    if (!clips.length) clips = initialMedia.slice(0, 4).map(item => ({id:uid(), mediaId:item.id, duration:template.duration, start:0, caption:'', color:'#ffffff'}));
    clips.forEach((clip, index) => {clip.duration = Math.min(template.duration, mediaFor(clip).duration - (clip.start || 0)); clip.caption = template.captions[index % template.captions.length];});
    selected = clips[0]?.id; current = 0; changed(); notice(`Đã áp dụng mẫu ${template.name}. Bạn có thể sửa từng cảnh.`);
  }
  function openPanel(name) {
    document.querySelectorAll('.library-section').forEach(panel => panel.classList.toggle('hidden', panel.id !== `panel-${name}`));
    document.querySelectorAll('[data-panel]').forEach(button => button.classList.toggle('active', button.dataset.panel === name));
  }

  async function uploadFiles(files) {
    const supported = /^(image\/(jpeg|png|webp|avif)|video\/(mp4|webm|quicktime))$/;
    let count = 0;
    for (const file of Array.from(files).slice(0, 20)) {
      if (media.length >= 100) {notice('Thư viện hỗ trợ tối đa 100 tệp.'); break;}
      if (!supported.test(file.type)) {notice(`Bỏ qua ${file.name}: định dạng chưa hỗ trợ.`); continue;}
      if (file.size > 250 * 1024 ** 2) {notice(`${file.name} vượt giới hạn 250 MB.`); continue;}
      const item = {id:uid(), name:file.name, type:file.type.startsWith('video') ? 'video' : 'image', file, url:URL.createObjectURL(file), duration:30};
      try {await loadResource(item); media.push(item); count++;} catch (error) {URL.revokeObjectURL(item.url); notice(error.message);}
    }
    renderLibrary(); scheduleSave();
    if (count) notice(`Đã thêm ${count} tư liệu. Nhấn + trên ảnh để đưa vào timeline.`);
    if (files.length > 20) notice(`Đã xử lý 20 tệp đầu tiên. Bạn có thể tải phần còn lại trong lượt tiếp theo.`);
    $('mediaInput').value = '';
  }
  function updateAudioUI() {
    $('audioTrack').innerHTML = audioData ? `${icon('music')}<span>${esc(audioData.name)}</span><span class="waveform" aria-hidden="true">▂▅▃▆▂▇▅▃▅▂▆▃▇▅▂▅▃▆▂▇▅▃▅▂▆▃▇▅▂▅▃▆▂▇▅▃</span>` : `${icon('plus')}<span>Thêm nhạc nền cho câu chuyện của bạn</span>`;
    $('audioTrack').classList.toggle('has-audio', !!audioData);
    $('audioInfo').textContent = audioData ? `${audioData.name} · ${timeLabel(audioElement?.duration || 0)}` : 'Chưa có nhạc nền. Video gốc được dựng không tiếng để dễ phối nhạc.';
    $('removeAudio').disabled = !audioData;
    $('audioVolume').value = Math.round(volume * 100); $('audioVolumeValue').textContent = `${Math.round(volume * 100)}%`;
    $('muteBtn').style.opacity = muted ? '.35' : '1';
    $('muteBtn').setAttribute('aria-pressed', String(muted));
  }
  async function attachAudio(data) {
    const next = new Audio(); next.loop = true; next.preload = 'auto';
    const url = URL.createObjectURL(data.file);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Không đọc được âm thanh.')), 15000);
        next.onloadeddata = () => {clearTimeout(timer); resolve();};
        next.onerror = () => {clearTimeout(timer); reject(new Error('Định dạng âm thanh không được hỗ trợ.'));}; next.src = url;
      });
      if (!Number.isFinite(next.duration) || next.duration <= 0) throw new Error('Tệp âm thanh không có thời lượng hợp lệ.');
    } catch (error) {URL.revokeObjectURL(url); throw error;}
    if (audioElement) {audioElement.pause(); URL.revokeObjectURL(audioElement.src); audioSource?.disconnect();}
    audioElement = next; audioData = data; audioSource = null; audioElement.volume = muted ? 0 : volume;
    // After an element has been routed into Web Audio it must stay connected for preview.
    if (audioContext) connectAudio();
    updateAudioUI();
  }
  function connectAudio() {
    if (!audioElement) return;
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    audioDestination ||= audioContext.createMediaStreamDestination();
    if (!audioSource) {audioSource = audioContext.createMediaElementSource(audioElement); audioSource.connect(audioContext.destination); audioSource.connect(audioDestination);}
    return audioDestination;
  }

  async function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('luma-studio-local', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('projects');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  const persistedMedia = () => media.map(({id, name, type, builtin, file, duration, generated, sourceId}) => ({id, name, type, builtin, file, duration, generated, sourceId}));
  async function saveProject(manual = false) {
    clearTimeout(saveTimer);
    if (!db) {if (manual) notice('Trình duyệt không cho phép lưu cục bộ. Hãy dùng cửa sổ thường và cho phép lưu trữ.'); return;}
    $('saveStatus').textContent = 'Đang lưu trên thiết bị…';
    try {
      const data = {version:1, name:projectName, clips, settings, media:persistedMedia(), audio:audioData, volume, selected, prompt:$('prompt').value};
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('projects', 'readwrite'); transaction.objectStore('projects').put(data, 'draft');
        transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
      });
      $('saveStatus').textContent = 'Đã lưu trên thiết bị này'; storageFailed = false;
      if (manual) notice('Đã lưu dự án và tư liệu trong trình duyệt này.');
    } catch {storageFailed = true; $('saveStatus').textContent = 'Chưa lưu · bộ nhớ trình duyệt không khả dụng'; notice('Không lưu được dự án. Thiết bị có thể đã hết dung lượng. Bạn vẫn có thể xuất video.');}
  }
  function scheduleSave() {clearTimeout(saveTimer); $('saveStatus').textContent = 'Có thay đổi chưa lưu…'; saveTimer = setTimeout(saveProject, 650);}
  async function restoreProject() {
    try {
      db = await openDatabase();
      const data = await new Promise((resolve, reject) => {const request = db.transaction('projects').objectStore('projects').get('draft'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
      if (!data || data.version !== 1) return false;
      const restored = [];
      for (const item of data.media) {
        item.url = item.builtin || URL.createObjectURL(item.file);
        try {await loadResource(item); restored.push(item);} catch {if (!item.builtin) URL.revokeObjectURL(item.url);}
      }
      // Keep bundled assets available even if a prior draft did not reference all of them.
      for (const item of initialMedia) if (!restored.some(m => m.id === item.id)) restored.push(item);
      media = restored; clips = data.clips.filter(clip => media.some(item => item.id === clip.mediaId));
      settings = data.settings; projectName = data.name; selected = clips.some(clip => clip.id === data.selected) ? data.selected : clips[0]?.id;
      volume = data.volume ?? .6; $('prompt').value = data.prompt || '';
      if (data.audio) {try {await attachAudio(data.audio);} catch {notice('Không khôi phục được nhạc nền. Vui lòng chọn lại tệp nhạc.');}}
      $('saveStatus').textContent = 'Đã khôi phục dự án trên thiết bị này';
      return true;
    } catch {storageFailed = true; $('saveStatus').textContent = 'Lưu cục bộ không khả dụng'; return false;}
  }

  function editClip(property, value) {
    const clip = activeClip(); if (!clip) return;
    const item = mediaFor(clip);
    if (property === 'duration') {
      const maximum = item.type === 'video' ? Math.min(30, (item.duration - (clip.start || 0)) / (clip.speed || 1)) : 30;
      if (!Number.isFinite(value) || value < .5 || value > maximum) {renderInspector(); return notice(`Thời lượng cần từ 0,5 đến ${maximum.toFixed(1)} giây.`);}
    }
    if (property === 'start' && (!Number.isFinite(value) || value < 0 || value + clip.duration * (clip.speed || 1) > item.duration + .001)) {renderInspector(); return notice('Điểm bắt đầu và thời lượng phải nằm trong video gốc.');}
    if (clip[property] === value) return;
    remember(); clip[property] = value; pause(); current = clipOffset(clip.id); changed();
  }
  function undo(redo = false) {
    const source = redo ? future : history, dest = redo ? history : future;
    if (!source.length) return;
    dest.push(snapshot()); const previous = JSON.parse(source.pop());
    clips = previous.clips; settings = previous.settings; selected = previous.selected; projectName = previous.projectName;
    $('projectName').value = projectName; pause(); current = clipOffset(selected); changed();
  }
  function generateStoryboard() {
    const prompt = $('prompt').value.trim();
    if (!prompt) return notice('Hãy mô tả câu chuyện bạn muốn kể.');
    if (!clips.length) return notice('Thêm ít nhất một cảnh vào timeline trước khi dựng.');
    remember(); pause();
    const text = prompt.toLocaleLowerCase('vi');
    const fast = /nhanh|năng động|sôi động|tiktok|reels|viral/.test(text);
    const slow = /chậm|bình yên|nhẹ nhàng|cảm xúc/.test(text);
    settings.transition = fast ? 'cut' : 'fade';
    settings.style = /đen trắng|cổ điển/.test(text) ? 'mono' : /tự nhiên|trong trẻo/.test(text) ? 'natural' : fast ? 'vivid' : 'cinematic';
    if (/tiktok|reels|dọc/.test(text)) settings.ratio = '9:16';
    if (/ngang|youtube/.test(text)) settings.ratio = '16:9';
    const duration = fast ? 2 : slow ? 4 : 3;
    clips.forEach(clip => {clip.duration = Math.min(duration, mediaFor(clip).duration - clip.start);});
    // Quoted text is an explicit caption request, never a claim of model generation.
    const quotes = Array.from(prompt.matchAll(/[“"]([^”"]{1,120})[”"]/g), match => match[1]);
    if (quotes.length) clips.forEach((clip, i) => {if (quotes[i]) clip.caption = quotes[i];});
    settings.motion = !/tĩnh|không chuyển động/.test(text);
    settings.template = '';
    current = 0; selected = clips[0].id; changed();
    notice(`Đã gợi ý nhịp ${duration} giây/cảnh và phong cách từ từ khóa. Bạn có thể tiếp tục chỉnh sửa.`);
  }

  async function showAiDialog() {
    pause(); aiConfigured = false; aiBusy = false;
    $('aiConsent').checked = false; $('runAiBtn').disabled = true;
    $('aiConnectionStatus').textContent = 'Đang kiểm tra kết nối…';
    $('aiConnectionStatus').className = 'connection-status';
    $('aiRunStatus').textContent = '';
    $('aiDialog').showModal();
    try {
      const response = await fetch('api/ai/status', {signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error('unavailable');
      const status = await response.json();
      aiConfigured = status.configured === true;
      $('aiConnectionStatus').textContent = aiConfigured ? `Đã kết nối ${status.provider || 'OpenAI'} · ${status.model}` : 'Máy chủ sẵn sàng · chưa cấu hình khóa API';
      $('aiConnectionStatus').classList.add(aiConfigured ? 'connected' : 'not-connected');
      $('aiSetupNote').textContent = aiConfigured ? 'Khóa API nằm ở máy chủ. Chỉ gửi mẫu sau khi bạn đồng ý và chọn tạo bản dựng.' : 'Thiết lập LUMA_AI_KEY trên máy chủ rồi khởi động lại server.py. Không nhập khóa API vào trình duyệt.';
    } catch {
      $('aiConnectionStatus').textContent = 'Bạn đang dùng bản biên tập cục bộ';
      $('aiConnectionStatus').classList.add('not-connected');
      $('aiSetupNote').textContent = 'Để kết nối AI, chạy python3 server.py --port 8081 trong thư mục video-studio với LUMA_AI_KEY đã cấu hình, rồi mở trang từ máy chủ đó. Xem README để biết chi tiết.';
    }
    $('runAiBtn').disabled = !aiConfigured || !$('aiConsent').checked || !clips.length;
  }
  async function runAiStoryboard() {
    if (!aiConfigured || !$('aiConsent').checked || aiBusy || !clips.length) return;
    if (!$('prompt').value.trim()) { $('aiRunStatus').textContent = 'Hãy viết ý tưởng trước khi dùng AI.'; return; }
    aiBusy = true; $('runAiBtn').disabled = true; $('aiConsent').disabled = true;
    $('aiRunStatus').textContent = 'Đang phân tích ý tưởng và tư liệu mẫu…';
    aiAbort = new AbortController();
    const timeout = setTimeout(() => aiAbort?.abort(), 70000);
    try {
      const sampled = new Set();
      const inputs = clips.map(clip => {
        const item = mediaFor(clip);
        const input = {id:clip.id, caption:clip.caption, duration:clip.duration, mediaType:item.type};
        if (sampled.size < 4 && !sampled.has(item.id)) {
          const element = resources.get(item.id);
          if (element) {
            const sample = document.createElement('canvas');
            const w = element.videoWidth || element.naturalWidth, h = element.videoHeight || element.naturalHeight;
            sample.width = Math.max(1, Math.round(w / Math.max(w, h) * 512)); sample.height = Math.max(1, Math.round(h / Math.max(w, h) * 512));
            sample.getContext('2d').drawImage(element, 0, 0, sample.width, sample.height);
            input.thumbnail = sample.toDataURL('image/jpeg', .65); sampled.add(item.id);
          }
        }
        return input;
      });
      const response = await fetch('api/ai/storyboard', {method:'POST', headers:{'Content-Type':'application/json'}, signal:aiAbort.signal, body:JSON.stringify({prompt:$('prompt').value.trim(), clips:inputs, ratio:settings.ratio})});
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Máy chủ AI không phản hồi.');
      const plan = payload.plan;
      if (!plan || !['9:16','16:9','1:1'].includes(plan.ratio) || !['cinematic','natural','vivid','mono'].includes(plan.style) || !['cut','fade'].includes(plan.transition) || !Array.isArray(plan.scenes) || !plan.scenes.length || plan.scenes.length > clips.length) throw new Error('Bản dựng AI không đúng định dạng. Dự án hiện tại được giữ nguyên.');
      const used = new Set();
      const updated = plan.scenes.map(scene => {
        const existing = clips.find(clip => clip.id === scene.id);
        if (!existing || used.has(scene.id) || typeof scene.caption !== 'string' || scene.caption.length > 120 || typeof scene.duration !== 'number' || !Number.isFinite(scene.duration) || scene.duration < .5 || scene.duration > 30) throw new Error('AI trả về cảnh không hợp lệ. Dự án hiện tại được giữ nguyên.');
        used.add(scene.id);
        return {...existing, caption:scene.caption, duration:Math.min(scene.duration, mediaFor(existing).duration - existing.start)};
      });
      // Retain any omitted clips rather than lose the user's existing footage.
      updated.push(...clips.filter(clip => !used.has(clip.id)));
      remember(); clips = updated; settings = {...settings, ratio:plan.ratio, style:plan.style, transition:plan.transition, template:''};
      selected = clips[0].id; current = 0; changed();
      $('aiDialog').close(); notice('Đã áp dụng gợi ý từ AI. Bạn có thể sửa tiếp hoặc hoàn tác.');
    } catch (error) {
      $('aiRunStatus').textContent = error.name === 'AbortError' ? 'Đã dừng yêu cầu AI. Bạn có thể thử lại.' : error.message;
    } finally {
      clearTimeout(timeout); aiBusy = false; aiAbort = null; $('aiConsent').disabled = false;
      $('runAiBtn').disabled = !aiConfigured || !$('aiConsent').checked;
    }
  }

  async function exportVideo() {
    if (!clips.length) return notice('Hãy thêm ít nhất một cảnh để xuất.');
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return notice('Trình duyệt chưa hỗ trợ xuất video. Hãy dùng Chrome/Edge phiên bản mới.');
    const webmTypes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mp4Types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'];
    const candidates = $('exportFormat').value === 'mp4' ? [...mp4Types, ...webmTypes] : [...webmTypes, ...mp4Types];
    const mime = candidates.find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) return notice('Trình duyệt này chưa hỗ trợ định dạng ghi video phù hợp. Hãy thử trình duyệt phiên bản mới.');
    pause(); const previousTime = current; current = 0;
    exporting = true; exportCancelled = false;
    $('exportOptions').classList.add('hidden'); $('exportResult').classList.add('hidden'); $('exportProgress').classList.remove('hidden');
    $('progressFill').style.width = '0%';
    const [a, b] = settings.ratio.split(':').map(Number), size = Number($('exportResolution').value);
    const out = document.createElement('canvas'); out.width = a >= b ? Math.round(size * a / b) : size; out.height = a >= b ? size : Math.round(size * b / a);
    const outContext = out.getContext('2d'); draw(outContext, out.width, out.height, 0);
    let stream = null, chunks = [], recordedSeconds = 0;
    let settled = false;
    try {
      stream = out.captureStream(30);
      if (audioElement && audioData && !muted && volume > 0) {
        const destination = connectAudio(); await audioContext.resume();
        destination.stream.getAudioTracks().forEach(track => stream.addTrack(track.clone()));
      }
      exportRecorder = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond:size === 1080 ? 8000000 : 4500000});
      exportRecorder.ondataavailable = event => {if (event.data.size) chunks.push(event.data);};
      const stopped = new Promise((resolve, reject) => {exportRecorder.onstop = resolve; exportRecorder.onerror = event => reject(event.error || new Error('Không ghi được video.'));});
      // Prime the first video frame before recording, so a preceding preview position cannot leak into the export.
      syncMedia(0, false);
      const firstVideo = resources.get(clips[0].mediaId);
      if (firstVideo instanceof HTMLVideoElement && firstVideo.seeking) await new Promise(resolve => {firstVideo.addEventListener('seeked', resolve, {once:true}); setTimeout(resolve, 1500);});
      exportRecorder.start(200);
      syncMedia(0, true);
      const started = performance.now();
      await new Promise(resolve => {
        const frame = now => {
          if (exportCancelled || !exporting) {resolve(); return;}
          current = Math.min((now - started) / 1000, total()); recordedSeconds = current;
          syncMedia(current, current < total()); draw(outContext, out.width, out.height, current); draw(); updateTime();
          const percent = Math.round(current / total() * 100);
          $('progressFill').style.width = `${percent}%`; $('exportProgressText').textContent = `Đang xuất ${percent}% · ${timeLabel(current)} / ${timeLabel(total())}`;
          if (current >= total()) {resolve(); return;}
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      if (exportRecorder.state !== 'inactive') exportRecorder.stop();
      await stopped; settled = true;
      if (!exportCancelled) {
        let blob = new Blob(chunks, {type:mime}), extension = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
        if (blob.size < 1000 || recordedSeconds < total() - .1) throw new Error('Bản xuất chưa hoàn tất. Hãy giữ tab mở và thử lại.');
        if ($('exportFormat').value === 'mp4' && extension !== 'mp4') {
          $('exportProgressText').textContent = 'Đang chuyển sang MP4 cho TikTok / Reels…';
          try {
            exportConversionAbort = new AbortController();
            const response = await fetch('api/render/mp4', {method:'POST', headers:{'Content-Type':'video/webm'}, body:blob, signal:AbortSignal.any([exportConversionAbort.signal, AbortSignal.timeout(190000)])});
            if (!response.ok) throw new Error('Không chuyển được MP4.');
            const converted = await response.blob();
            if (!converted.type.startsWith('video/mp4') || converted.size < 1000) throw new Error('MP4 không hợp lệ.');
            blob = converted; extension = 'mp4';
          } catch {if (!exportCancelled) notice('Chưa chuyển được MP4. Bản WebM đã hoàn tất và vẫn tải được; dùng máy chủ Luma để chuyển MP4.');}
        }
        if (exportCancelled) return;
        if (exportUrl) URL.revokeObjectURL(exportUrl);
        exportUrl = URL.createObjectURL(blob); $('downloadVideo').href = exportUrl;
        $('downloadVideo').download = `${projectName.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'luma-video'}.${extension}`;
        $('exportResultText').textContent = `Đã xuất ${extension.toUpperCase()} · ${(blob.size / 1024 ** 2).toFixed(1)} MB · ${out.width} × ${out.height} · ${Number(total().toFixed(1))} giây`;
        $('exportProgress').classList.add('hidden'); $('exportResult').classList.remove('hidden');
      }
    } catch (error) {
      notice(`Xuất video không thành công: ${error.message}`);
      $('exportOptions').classList.remove('hidden'); $('exportProgress').classList.add('hidden');
    } finally {
      if (!settled && exportRecorder?.state !== 'inactive') exportRecorder?.stop();
      stream?.getTracks().forEach(track => track.stop());
      exporting = false; exportRecorder = null; exportConversionAbort = null; current = previousTime; syncMedia(current, false); draw(); updateTime();
      if (exportCancelled) { $('exportOptions').classList.remove('hidden'); $('exportProgress').classList.add('hidden'); notice('Đã hủy xuất video.'); }
    }
  }

  function bindEvents() {
    document.querySelectorAll('[data-panel]').forEach(button => button.onclick = () => openPanel(button.dataset.panel));
    document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => {
      filter = button.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(tab => {tab.classList.toggle('active', tab === button); tab.setAttribute('aria-selected', String(tab === button));}); renderLibrary();
    });
    $('allTemplates').onclick = () => openPanel('templates');
    $('mediaInput').onchange = event => uploadFiles(event.target.files);
    $('dropZone').onkeydown = event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); $('mediaInput').click();}};
    $('dropZone').ondragover = event => {event.preventDefault(); $('dropZone').classList.add('drag-over');};
    $('dropZone').ondragleave = () => $('dropZone').classList.remove('drag-over');
    $('dropZone').ondrop = event => {event.preventDefault(); $('dropZone').classList.remove('drag-over'); uploadFiles(event.dataTransfer.files);};
    $('emptyUpload').onclick = $('addSceneBtn').onclick = () => {openPanel('media'); $('mediaInput').click();};
    $('playBtn').onclick = play; $('restartBtn').onclick = () => seek(0);
    $('undoBtn').onclick = () => undo(); $('redoBtn').onclick = () => undo(true);
    $('ratioSelect').onchange = event => {remember(); settings.ratio = event.target.value; changed();};
    $('styleSelect').onchange = event => {remember(); settings.style = event.target.value; changed();};
    $('motionToggle').onchange = event => {remember(); settings.motion = event.target.checked; changed();};
    document.querySelectorAll('[data-transition]').forEach(button => button.onclick = () => {remember(); settings.transition = button.dataset.transition; changed();});
    document.querySelectorAll('[data-color]').forEach(button => button.onclick = () => editClip('color', button.dataset.color));
    $('clipCaption').onchange = event => editClip('caption', event.target.value);
    $('clipDuration').onchange = event => editClip('duration', Number(event.target.value));
    $('clipStart').onchange = event => editClip('start', Number(event.target.value));
    $('applyCaption').onclick = () => editClip('caption', $('captionLibrary').value);
    document.querySelectorAll('[data-caption]').forEach(button => button.onclick = () => editClip('caption', button.dataset.caption));
    $('deleteBtn').onclick = () => {const clip = activeClip(); if (!clip) return; remember(); pause(); const index = clips.indexOf(clip); clips.splice(index, 1); selected = clips[Math.min(index, clips.length - 1)]?.id; current = clipOffset(selected); changed();};
    $('duplicateBtn').onclick = () => {const clip = activeClip(); if (!clip) return; if (clips.length >= 60) return notice('Mỗi dự án hỗ trợ tối đa 60 cảnh.'); remember(); const copy = {...clip, id:uid()}; clips.splice(clips.indexOf(clip) + 1, 0, copy); selected = copy.id; pause(); current = clipOffset(selected); changed();};
    $('splitBtn').onclick = () => {
      const location = locate(current); if (!location) return;
      if (clips.length >= 60) return notice('Mỗi dự án hỗ trợ tối đa 60 cảnh.');
      if (location.local < .5 || location.clip.duration - location.local < .5) return notice('Đặt đầu phát cách hai đầu cảnh ít nhất 0,5 giây để tách.');
      remember(); pause(); const {clip, index, local} = location;
      const copy = {...clip, id:uid(), duration:clip.duration - local, start:mediaFor(clip).type === 'video' ? clip.start + local * (clip.speed || 1) : 0};
      clip.duration = local; clips.splice(index + 1, 0, copy); selected = copy.id; changed(); notice('Đã tách cảnh tại đầu phát.');
    };
    // Click empty areas of the ruler/track to seek; clip clicks select instead.
    $('timelineRuler').addEventListener('click', event => {if (event.target.closest('button')) return; const rect = $('timelineClips').getBoundingClientRect(); seek((event.clientX - rect.left) / rect.width * total());});
    $('audioTrack').onclick = () => {openPanel('audio'); if (!audioData) $('audioInput').click();};
    $('audioInput').onchange = async event => {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 50 * 1024 ** 2 || !file.type.startsWith('audio/')) return notice('Chọn tệp âm thanh dưới 50 MB.');
      pause(); try {await attachAudio({name:file.name, file}); scheduleSave(); notice('Đã thêm nhạc nền vào dự án.');} catch (error) {notice(error.message);} event.target.value = '';
    };
    $('removeAudio').onclick = () => {if (!audioElement) return; pause(); audioSource?.disconnect(); audioSource = null; audioElement.pause(); URL.revokeObjectURL(audioElement.src); audioElement = null; audioData = null; updateAudioUI(); scheduleSave();};
    $('audioVolume').oninput = event => {volume = Number(event.target.value) / 100; if (audioElement) audioElement.volume = muted ? 0 : volume; updateAudioUI(); scheduleSave();};
    $('muteBtn').onclick = () => {muted = !muted; if (audioElement) audioElement.volume = muted ? 0 : volume; updateAudioUI(); notice(muted ? 'Đã tắt nhạc nền cho xem trước và bản xuất.' : 'Đã bật nhạc nền.');};
    $('fullscreenBtn').onclick = () => {if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else $('canvasWrap').requestFullscreen().catch(() => notice('Không thể bật toàn màn hình trong trình duyệt này.'));};
    $('projectName').onchange = event => {remember(); projectName = event.target.value.trim() || 'Video chưa đặt tên'; event.target.value = projectName; scheduleSave();};
    $('prompt').oninput = () => {$('promptLength').textContent = `${$('prompt').value.length} / 1000`; scheduleSave();};
    $('generateBtn').onclick = generateStoryboard;
    $('openAiBtn').onclick = showAiDialog;
    $('aiConsent').onchange = () => {$('runAiBtn').disabled = !aiConfigured || !$('aiConsent').checked || aiBusy || !clips.length;};
    $('runAiBtn').onclick = runAiStoryboard;
    $('aiDialog').addEventListener('close', () => {if (aiBusy) aiAbort?.abort();});
    $('saveBtn').onclick = () => saveProject(true);
    $('helpBtn').onclick = () => $('helpDialog').showModal();
    $('exportBtn').onclick = () => {
      if (!clips.length) return notice('Hãy thêm ít nhất một cảnh vào timeline.');
      pause(); $('exportDuration').textContent = `${Number(total().toFixed(1))} giây`;
      $('exportOptions').classList.remove('hidden'); $('exportProgress').classList.add('hidden'); $('exportResult').classList.add('hidden'); $('exportDialog').showModal();
    };
    $('startExport').onclick = exportVideo; $('cancelExport').onclick = () => {exportCancelled = true; exportConversionAbort?.abort();};
    $('exportDialog').addEventListener('cancel', event => {if (exporting) {event.preventDefault(); notice('Hãy chọn Hủy xuất trước khi đóng.');}});
    $('exportDialog').querySelector('form').addEventListener('submit', event => {if (exporting) {event.preventDefault(); notice('Hãy chọn Hủy xuất trước khi đóng.');}});
    document.addEventListener('visibilitychange', () => {if (document.hidden && playing) pause(); if (document.hidden && exporting) {exportCancelled = true; notice('Đã hủy xuất vì tab bị ẩn. Giữ tab hiển thị khi xuất để video không bị thiếu khung hình.');}});
    document.addEventListener('keydown', event => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.querySelector('dialog[open]')) return;
      if (event.code === 'Space') {event.preventDefault(); play();}
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {event.preventDefault(); undo(event.shiftKey);}
      if (event.key === 'Delete' || event.key === 'Backspace') {event.preventDefault(); $('deleteBtn').click();}
      if (event.key === 'ArrowRight') {event.preventDefault(); seek(current + .5);}
      if (event.key === 'ArrowLeft') {event.preventDefault(); seek(current - .5);}
    });
    window.addEventListener('resize', updateTime);
    window.addEventListener('beforeunload', event => {if (exporting || storageFailed) {event.preventDefault(); event.returnValue = '';}});
  }

  function applyAutomaticPlan(plan) {
    if (!plan || !['9:16','16:9','1:1'].includes(plan.ratio) || !['cinematic','natural','vivid','mono'].includes(plan.style) || !['cut','fade'].includes(plan.transition) || !Array.isArray(plan.scenes) || !plan.scenes.length || plan.scenes.length > 60) throw new Error('Bản dựng tự động không hợp lệ.');
    const next = plan.scenes.map(scene => {
      const item = media.find(asset => asset.id === scene.assetId);
      const start = scene.start ?? 0, speed = scene.speed ?? 1;
      if (!item || typeof scene.duration !== 'number' || !Number.isFinite(scene.duration) || scene.duration < .5 || scene.duration > 30 || !Number.isFinite(start) || start < 0 || !Number.isFinite(speed) || speed < .5 || speed > 2 || typeof scene.caption !== 'string' || scene.caption.length > 120) throw new Error('Một cảnh tự động không sử dụng được. Bản cũ được giữ nguyên.');
      const available = item.type === 'video' ? (item.duration - start) / speed : 30;
      if (available < .5) throw new Error('Video được tạo không đủ thời lượng cho cảnh.');
      return {id:uid(), mediaId:item.id, duration:Math.min(scene.duration, available), start, speed,
        caption:scene.caption, position:['top','center','bottom'].includes(scene.position) ? scene.position : 'bottom',
        color:/^#[a-f0-9]{6}$/i.test(scene.color) ? scene.color : '#ffffff',
        motion:['none','push','pull'].includes(scene.motion) ? scene.motion : 'none',
        transition:['cut','fade'].includes(scene.transition) ? scene.transition : plan.transition};
    });
    remember(); pause(); clips = next;
    settings = {...settings, ratio:plan.ratio, style:plan.style, transition:plan.transition, template:''};
    if (typeof plan.title === 'string' && plan.title.trim()) {projectName = plan.title.slice(0, 70); $('projectName').value = projectName;}
    selected = clips[0].id; current = 0; changed();
  }

  async function addGeneratedMedia(file, sourceId) {
    const item = {id:uid(), name:file.name, type:'video', file, url:URL.createObjectURL(file), duration:0, generated:true, sourceId};
    try {await loadResource(item);} catch (error) {URL.revokeObjectURL(item.url); throw error;}
    media.push(item); renderLibrary(); scheduleSave(); return item.id;
  }

  async function boot() {
    // Bundled illustrations are always usable, with no network or credentials.
    await Promise.all(initialMedia.map(item => loadResource(item)));
    const restored = await restoreProject();
    if (!restored) {
      const template = templates[0];
      clips = media.slice(0, 4).map((item, index) => ({id:uid(), mediaId:item.id, duration:3, start:0, caption:template.captions[index], color:'#ffffff'}));
      selected = clips[0].id;
      $('prompt').value = 'Một video TikTok/Reels dọc, nhịp nhanh, màu trong trẻo. Kể câu chuyện một ngày đi khám phá qua những khoảnh khắc nhỏ.';
    }
    $('projectName').value = projectName;
    $('promptLength').textContent = `${$('prompt').value.length} / 1000`;
    bindEvents(); changed(false);
    window.LumaAuto?.init({
      getAssets:() => media.slice(), uploadFiles,
      getPrompt:() => $('prompt').value, applyPlan:applyAutomaticPlan,
      addGenerated:addGeneratedMedia, notify:notice,
      exportVideo:async () => {$('exportBtn').click(); await exportVideo();},
    });
    if (!restored && db) scheduleSave();
  }
  boot().catch(error => {console.error(error); notice('Không thể mở dự án. Hãy tải lại trang và kiểm tra các tệp tư liệu.');});
})();
