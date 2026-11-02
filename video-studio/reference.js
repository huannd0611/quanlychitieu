/* Local, temporal reference-video analysis. No upload or external model call. */
(() => {
  'use strict';
  const MAX_BYTES = 250 * 1024 ** 2;
  const MAX_DURATION = 120;
  const MAX_SAMPLES = 120;
  const round = value => Math.round(value * 1000) / 1000;
  const abortError = () => new DOMException('Đã hủy phân tích video mẫu.', 'AbortError');
  function check(signal) {if (signal?.aborted) throw abortError();}
  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  // Every wait removes its own event listeners, timer and abort hook.
  function waitFor(element, eventName, signal, action, timeout = 15000) {
    check(signal);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer); element.removeEventListener(eventName, ready);
        element.removeEventListener('error', failed); signal?.removeEventListener('abort', aborted);
      };
      const ready = () => {cleanup(); resolve();};
      const failed = () => {cleanup(); reject(new Error('Không đọc được video mẫu. Hãy thử MP4/H.264 hoặc WebM.'));};
      const aborted = () => {cleanup(); reject(abortError());};
      const timer = setTimeout(() => {cleanup(); reject(new Error('Video mẫu phản hồi quá lâu. Hãy thử tệp ngắn hơn hoặc codec khác.'));}, timeout);
      element.addEventListener(eventName, ready, {once:true}); element.addEventListener('error', failed, {once:true});
      signal?.addEventListener('abort', aborted, {once:true});
      try {action?.();} catch (error) {cleanup(); reject(error);}
    });
  }
  async function seek(video, time, signal) {
    check(signal);
    if (Math.abs(video.currentTime - time) < .005 && video.readyState >= 2) return;
    await waitFor(video, 'seeked', signal, () => {video.currentTime = time;});
    check(signal);
  }
  async function openVideo(file, signal) {
    check(signal);
    if (!(file instanceof Blob) || !file.size) throw new Error('Hãy chọn một tệp video mẫu có nội dung.');
    if (file.size > MAX_BYTES) throw new Error('Video mẫu không được vượt quá 250 MB.');
    if (file.type && !file.type.startsWith('video/')) throw new Error('Video mẫu phải là tệp video, không phải hình ảnh.');
    const url = URL.createObjectURL(file), video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    try {
      await waitFor(video, 'loadeddata', signal, () => {video.src = url; video.load();});
      let duration = video.duration;
      // MediaRecorder WebM often lacks a duration header. A seek to the end asks
      // the browser demuxer to determine the real duration without playing aloud.
      if (!Number.isFinite(duration)) {
        await seek(video, Number.MAX_SAFE_INTEGER, signal);
        duration = Number.isFinite(video.duration) ? video.duration : video.currentTime;
      }
      if (!Number.isFinite(duration) || duration < .5) throw new Error('Video mẫu cần có thời lượng hợp lệ từ 0,5 giây.');
      if (duration > MAX_DURATION) throw new Error('Video mẫu tối đa 120 giây. Hãy cắt đoạn bạn muốn tham chiếu trước khi tải lên.');
      if (!video.videoWidth || !video.videoHeight) throw new Error('Không đọc được kích thước video mẫu.');
      await seek(video, 0, signal);
      return {video, url, duration};
    } catch (error) {
      video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
      throw error;
    }
  }
  function descriptor(context, video) {
    context.drawImage(video, 0, 0, 48, 32);
    const pixels = context.getImageData(0, 0, 48, 32).data;
    const histogram = new Float32Array(24), count = pixels.length / 4;
    let brightness = 0, saturation = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      histogram[Math.min(7, r >> 5)]++; histogram[8 + Math.min(7, g >> 5)]++; histogram[16 + Math.min(7, b >> 5)]++;
      brightness += (.2126 * r + .7152 * g + .0722 * b) / 255;
      const high = Math.max(r, g, b), low = Math.min(r, g, b);
      saturation += high ? (high - low) / high : 0;
    }
    for (let i = 0; i < histogram.length; i++) histogram[i] /= count;
    return {pixels:new Uint8ClampedArray(pixels), histogram, brightness:brightness / count, saturation:saturation / count};
  }
  function difference(previous, next) {
    let histogram = 0, pixels = 0;
    for (let i = 0; i < previous.histogram.length; i++) histogram += Math.abs(previous.histogram[i] - next.histogram[i]);
    for (let i = 0; i < previous.pixels.length; i += 4) for (let j = 0; j < 3; j++) pixels += Math.abs(previous.pixels[i + j] - next.pixels[i + j]);
    histogram /= 6; pixels /= previous.pixels.length / 4 * 3 * 255;
    return {histogram, pixels, score:histogram * .65 + pixels * .35};
  }
  function closestRatio(width, height) {
    return [['9:16', 9 / 16], ['16:9', 16 / 9], ['1:1', 1]].sort((a, b) => Math.abs(width / height - a[1]) - Math.abs(width / height - b[1]))[0][0];
  }
  function thumb(video, width = 384) {
    const canvas = document.createElement('canvas'), scale = width / Math.max(video.videoWidth, video.videoHeight);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .7);
  }
  /**
   * Returns serializable metadata and up to eight timestamped JPEG frames.
   * onProgress receives {stage:'loading'|'sampling'|'frames'|'complete',
   * progress:0..1, completed:number, total:number}. Cut detection is a local
   * visual heuristic, not a semantic or music-beat model.
   */
  async function analyze(file, {onProgress, signal} = {}) {
    check(signal);
    const report = (stage, progress, completed = 0, total = 0) => onProgress?.({stage, progress, completed, total});
    report('loading', 0);
    const {video, url, duration} = await openVideo(file, signal);
    try {
      const sampleCanvas = document.createElement('canvas'); sampleCanvas.width = 48; sampleCanvas.height = 32;
      const context = sampleCanvas.getContext('2d', {willReadFrequently:true});
      const count = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(duration / .5) + 1));
      const span = Math.max(0, duration - .04), differences = [];
      let previous = null, brightness = 0, saturation = 0;
      for (let index = 0; index < count; index++) {
        check(signal); const time = index / (count - 1) * span;
        await seek(video, time, signal);
        const current = descriptor(context, video);
        if (previous) differences.push({...difference(previous, current), time, previousTime:(index - 1) / (count - 1) * span});
        previous = current; brightness += current.brightness; saturation += current.saturation;
        report('sampling', .05 + (index + 1) / count * .7, index + 1, count);
      }
      const baseline = median(differences.map(item => item.score));
      const threshold = Math.max(.26, baseline * 2.6);
      const cuts = [0];
      for (const item of differences) {
        const boundary = round((item.time + item.previousTime) / 2);
        if (item.histogram > .25 && item.pixels > .1 && item.score > threshold && boundary - cuts[cuts.length - 1] >= .5 && duration - boundary >= .5) cuts.push(boundary);
      }
      cuts.push(round(duration));
      const shotDurations = cuts.slice(1).map((cut, index) => round(cut - cuts[index]));
      const centers = cuts.slice(1).map((cut, index) => (cut + cuts[index]) / 2);
      // Include the whole temporal range even when the reference is a single shot.
      const desired = Math.min(8, Math.max(3, centers.length));
      const frameTimes = centers.length >= desired ? Array.from({length:desired}, (_, index) => centers[Math.round(index * (centers.length - 1) / (desired - 1))]) : Array.from({length:desired}, (_, index) => (index + .5) / desired * duration);
      const frames = [];
      for (let index = 0; index < frameTimes.length; index++) {
        const time = Math.min(frameTimes[index], duration - .04); await seek(video, time, signal);
        frames.push({time:round(time), thumbnail:thumb(video)});
        report('frames', .75 + (index + 1) / frameTimes.length * .24, index + 1, frameTimes.length);
      }
      check(signal);
      const shotMedian = median(shotDurations);
      const result = {duration:round(duration), width:video.videoWidth, height:video.videoHeight, ratio:closestRatio(video.videoWidth, video.videoHeight), cuts, shotDurations, tempo:shotMedian <= 2 ? 'fast' : shotMedian >= 4 ? 'slow' : 'medium', brightness:round(brightness / count), saturation:round(saturation / count), frames};
      report('complete', 1, frames.length, frames.length);
      return result;
    } finally {video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);}
  }
  // Results contain only strings/numbers/arrays; there is no retained URL to free.
  function release() {}
  window.LumaReference = Object.freeze({analyze, release});
})();
