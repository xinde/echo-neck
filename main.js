import { ARROW, LABEL, DIRECTIONS, Round, Motion, Calibration, chart, readFace } from './engine.js';
import { Sound } from './audio.js';
import { Scope } from './scope.js';
import { loadTracker } from './camera.js';

const $ = (id) => document.getElementById(id);
const sound = new Sound(),
  scope = new Scope($('radar')),
  motion = new Motion();
const video = $('video'),
  arrows = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const grades = {
  perfect: '精准命中',
  good: '命中',
  wrong: '方向不对',
  early: '动作偏早',
  late: '动作偏晚',
  miss: '错过目标',
};
const pad = (n) => String(n).padStart(4, '0');
let bpm = 60,
  mode = 'home',
  input = 'camera',
  round,
  generation = 0;
let tracker,
  stream,
  calibration,
  origin,
  point,
  lastVideo = -1,
  lastFrame = null;
let closedSince = null,
  invalidSince = null,
  lastDraw = 0,
  readyAfter = 0,
  holdSince = null;
let visualResult = null,
  sampleToken = 0,
  lastHud = '',
  sizeKey = '';
const bestKey = 'echo-neck:camera-best';
function best() {
  try {
    return Number(localStorage.getItem(bestKey)) || 0;
  } catch {
    return 0;
  }
}
$('best').textContent = pad(best());

function message(big = '', small = '') {
  const k = big + '|' + small;
  if (k === lastHud) return;
  lastHud = k;
  $('stage-big').textContent = big;
  $('stage-small').textContent = small;
}
function view(state, title = '', detail = '') {
  mode = state;
  const home = state === 'home';
  $('setup').hidden = !home;
  $('active').hidden = home;
  $('error').hidden = true;
  $('panel-title').textContent = home ? '本轮设置' : title;
  $('panel-en').textContent = {
    home: 'SESSION SETUP',
    loading: 'CONNECTING',
    calibrate: 'CALIBRATION',
    eyes: 'CALIBRATION',
    play: 'SESSION LIVE',
    paused: 'PAUSED',
    done: 'SESSION RESULT',
  }[state];
  $('status').textContent =
    '● ' +
    {
      home: '待机',
      loading: '连接中',
      calibrate: '定位中心',
      eyes: '等待闭眼',
      play: input === 'camera' ? '体感跟拍' : '按键试玩',
      paused: '已暂停',
      done: '已结束',
    }[state];
  $('detail').textContent = detail;
  $('stats').hidden = !['play', 'paused', 'done'].includes(state);
  $('action').hidden = !['play', 'paused', 'done'].includes(state);
  $('action').textContent =
    state === 'done' ? '再来一轮' : state === 'paused' ? '继续本轮' : '暂停';
  $('exit').textContent = ['loading', 'calibrate', 'eyes'].includes(state) ? '取消' : '返回设置';
  $('pad').hidden = state !== 'play' || input !== 'demo';
  video.hidden = !stream;
  video.classList.toggle('preview', state === 'calibrate');
  document.querySelectorAll('.sound-card').forEach((b) => (b.disabled = !home));
  message();
}
function counters() {
  const n = round?.results.length || 0;
  $('counter').textContent = String(n).padStart(2, '0') + ' / 12';
  $('score').textContent = pad(round?.score || 0);
  $('hits').textContent = (round?.hits || 0) + ' / 12';
}
function clearSample() {
  sampleToken++;
  document.querySelectorAll('.sound-card.playing').forEach((b) => b.classList.remove('playing'));
}
function release() {
  if (stream)
    stream.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
  stream = null;
  video.pause();
  video.srcObject = null;
  lastVideo = -1;
  lastFrame = null;
  origin = null;
  point = null;
  closedSince = null;
  invalidSince = null;
  holdSince = null;
  motion.reset();
}
function home(error = '') {
  generation++;
  clearSample();
  sound.clear();
  release();
  round = null;
  visualResult = null;
  view('home');
  counters();
  if (error) {
    $('error').textContent = error;
    $('error').hidden = false;
  }
}
function pause(reason, speak = true) {
  if (!['play', 'eyes', 'calibrate', 'loading'].includes(mode)) return;
  generation++;
  sound.clear();
  release();
  visualResult = null;
  view('paused', '已暂停', reason);
  if (speak && sound.ctx?.state === 'running' && sound.buffers.has('paused')) sound.say('paused');
}
function play() {
  sound.clear();
  const voiceEnd = sound.say('ready');
  const start = voiceEnd + 0.5;
  round.schedule(start);
  sound.schedule(round);
  motion.reset();
  visualResult = null;
  invalidSince = null;
  view(
    'play',
    input === 'camera' ? '闭眼跟拍' : '按键试玩',
    input === 'camera'
      ? '听口令，在低鼓声轻移一次，再回正。持续睁眼可以暂停。'
      : '听方向，在低鼓声按方向键或下方箭头。',
  );
  counters();
}
function complete() {
  const hits = round.hits,
    perfect = round.results.filter((r) => r.grade === 'perfect').length;
  if (input === 'camera' && round.score > best()) {
    try {
      localStorage.setItem(bestKey, String(round.score));
    } catch {}
    $('best').textContent = pad(Math.max(best(), round.score));
  }
  // Let the last hit or miss sound resolve before the closing announcement.
  sound.clear();
  sound.feedback(['good', 'perfect'].includes(round.results.at(-1).grade));
  sound.say('end', sound.ctx.currentTime + 0.35);
  release();
  view(
    'done',
    '本轮完成',
    '12 个目标中命中 ' +
      hits +
      ' 个，其中 ' +
      perfect +
      ' 个精准踩点。' +
      (input === 'demo' ? '本轮为按键试玩。' : ''),
  );
  message('命中率 ' + Math.round((hits / 12) * 100) + '%', perfect + ' 个精准命中');
  counters();
}
function feedback(result) {
  if (!result) return;
  counters();
  if (round.results.length === round.directions.length) {
    complete();
    return;
  }
  sound.feedback(result.grade === 'perfect' || result.grade === 'good');
  visualResult = { ...result, until: sound.audioTime() + 0.7 };
}
async function start(kind, resume = false) {
  const token = ++generation;
  clearSample();
  sound.clear();
  release();
  input = kind;
  if (!resume) round = new Round(chart(), bpm);
  view(
    'loading',
    kind === 'camera' ? '连接摄像头' : '准备声音',
    kind === 'camera' ? '请允许使用前置摄像头，并把设备放稳。' : '正在加载中文方向口令。',
  );
  try {
    const audio = sound.unlock();
    if (kind === 'demo') {
      await audio;
      if (token === generation) play();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      await audio;
      throw Error('no-camera');
    }
    const media = navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      })
      .then((s) => {
        if (token !== generation) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        video.srcObject = s;
        s.getVideoTracks()[0].onended = () => pause('摄像头连接中断。固定设备后可继续。');
        return video.play();
      });
    const [, model] = await Promise.all([audio, loadTracker(), media]);
    if (token !== generation) return;
    tracker = model;
    calibration = new Calibration();
    lastFrame = performance.now() / 1000;
    view('calibrate', '定位正中', '请坐稳，睁眼正对摄像头，保持头部居中约一秒。');
    message('正对摄像头', '保持静止，正在校准');
  } catch (e) {
    if (token !== generation) return;
    const denied = e.name === 'NotAllowedError',
      busy = e.name === 'NotReadableError',
      missing = e.name === 'NotFoundError' || e.message === 'no-camera';
    const reason = denied
      ? '摄像头权限未开启。请在浏览器中允许，或选择免摄像头试玩。'
      : busy
        ? '摄像头正被占用。关闭占用它的应用后再试。'
        : missing
          ? '未找到可用摄像头，可以选择免摄像头试玩。'
          : '未能加载声音或识别资源。请联网重试。';
    if (resume) {
      pause(reason, false);
    } else {
      home(reason);
    }
  }
}
function cameraSample(now, perf) {
  if (video.readyState < 2) return;
  const frame = video.getVideoPlaybackQuality?.().totalVideoFrames || video.currentTime;
  if (frame === lastVideo) return;
  lastVideo = frame;
  const previous = lastFrame;
  lastFrame = perf / 1000;
  const frameSize = video.videoWidth + 'x' + video.videoHeight;
  if (origin && sizeKey !== frameSize) {
    pause('摄像头画面尺寸已改变，请重新定位中心。');
    return;
  }
  let f;
  try {
    f = readFace(tracker.detectForVideo(video, perf), video.videoWidth, video.videoHeight);
  } catch {
    pause('识别已中断，点击继续重新校准。');
    return;
  }
  if (mode === 'calibrate') {
    origin = calibration.sample(f && !f.closed ? f : null, perf / 1000);
    if (origin) {
      sizeKey = frameSize;
      view('eyes', '轻轻闭眼', '保持头部在刚才的中心，轻轻闭上双眼。听完提示会自动开始。');
      message('校准完成', '轻轻闭眼，等待节拍');
      readyAfter = sound.say('close') + 0.12;
    } else
      message(!f ? '请正对摄像头' : f.closed ? '先睁眼校准' : '保持头部静止', '将脸放在画面中央');
    return;
  }
  if (previous !== null && perf / 1000 - previous > 0.2) {
    closedSince = null;
    holdSince = null;
    motion.reset();
  }
  if (!f || !f.closed) {
    closedSince = null;
    holdSince = null;
    motion.reset();
    point = null;
    invalidSince ??= now;
    if (mode === 'play' && now - invalidSince > 0.65)
      pause(f ? '已检测到睁眼。点击继续会重新校准。' : '暂时看不到脸。请回到镜头前再继续。');
    return;
  }
  invalidSince = null;
  closedSince ??= now;
  const x = (f.x - origin.x) / origin.width,
    y = (f.y - origin.y) / origin.width;
  point = { x: x / 0.16, y: y / 0.16 };
  if (mode === 'eyes') {
    if (Math.max(Math.abs(x), Math.abs(y)) > 0.053) holdSince = null;
    else holdSince ??= now;
    if (holdSince !== null && now - holdSince > 0.35 && now >= readyAfter) play();
    else if (now >= readyAfter && holdSince === null)
      message('请回到校准中心', '保持闭眼，回正后自动开始');
    return;
  }
  if (now - closedSince < 0.16) return;
  const event = motion.sample(x, y, now);
  if (event) feedback(round.strike(event.dir, event.time));
}
let display = { dir: null, phase: 0, step: -1 };
function tick() {
  if (!['calibrate', 'eyes', 'play'].includes(mode) || document.hidden) return;
  const perf = performance.now();
  if (mode === 'play' && sound.ctx.state !== 'running')
    pause('声音播放已中断，点击继续可重新听拍。', false);
  const now = sound.ctx ? sound.audioTime(perf) : 0;
  if (input === 'camera' && ['calibrate', 'eyes', 'play'].includes(mode)) {
    if (mode === 'play' && lastFrame !== null && perf / 1000 - lastFrame > 0.85)
      pause('摄像头帧已中断。请重新校准后继续。');
    else cameraSample(now, perf);
  }
  let dir = null,
    phase = 0,
    step = -1;
  if (mode === 'play') {
    // A briefly reopened eye cannot freeze the chart forever. A sustained
    // tracking loss pauses with the pending note intact.
    const fresh = lastFrame !== null && perf / 1000 - lastFrame <= 0.2;
    if (input === 'demo' || (fresh && invalidSince === null)) feedback(round.expire(now));
    if (mode === 'play') {
      const n = round.note;
      if (now >= n.cue) {
        dir = n.dir;
        phase = (now - n.at) / round.beat;
        step = Math.min(3, Math.floor((now - n.cue) / round.beat));
      }
      if (visualResult?.until > now) message(grades[visualResult.grade], '回到中间');
      else if (dir) message(ARROW[dir] + ' ' + LABEL[dir], step === 2 ? '重拍' : '听鼓点');
      else message(round.results.length ? '回到中间' : '准备', '等待下一条方向口令');
    }
  }
  display = { dir, phase, step };
}
function draw(perf) {
  requestAnimationFrame(draw);
  if (perf - lastDraw >= 33) {
    const { dir, phase, step } = mode === 'play' ? display : { dir: null, phase: 0, step: -1 };
    scope.draw({ dir, phase, point, mode }, perf / 1000);
    lastDraw = perf;
    [...$('steps').children].forEach((el, i) => el.classList.toggle('on', i === step));
  }
}
function demoStrike(dir, perf = performance.now()) {
  if (mode === 'play' && input === 'demo') feedback(round.strike(dir, sound.audioTime(perf)));
}
for (const b of document.querySelectorAll('[data-bpm]'))
  b.onclick = () => {
    bpm = Number(b.dataset.bpm);
    document
      .querySelectorAll('[data-bpm]')
      .forEach((other) => other.setAttribute('aria-pressed', String(other === b)));
    $('bpm-label').textContent = bpm + ' BPM';
    $('length').textContent = '约 ' + Math.round((48 * 60) / bpm) + ' 秒';
  };
DIRECTIONS.forEach((dir, i) => {
  const b = document.createElement('button');
  b.className = 'sound-card';
  b.setAttribute('aria-label', '试听' + LABEL[dir]);
  const bars = Array.from({ length: 19 }, (_, j) => {
    const s =
      2 + Math.abs(Math.sin(j * (i + 2) * 0.76 + 0.8) * Math.sin(((j + 1) * Math.PI) / 21)) * 16;
    return '<path d="M' + (j * 3 + 1) + ' ' + (12 - s / 2) + 'v' + s + '"/>';
  }).join('');
  b.innerHTML =
    '<span class="sound-ico">' +
    ARROW[dir] +
    '</span><span class="sound-label"><b>' +
    LABEL[dir] +
    '</b><small>' +
    dir.toUpperCase() +
    '</small></span><svg class="wave" viewBox="0 0 58 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">' +
    bars +
    '</svg>';
  b.onclick = async () => {
    clearSample();
    const id = sampleToken;
    sound.clear();
    b.classList.add('playing');
    try {
      await sound.unlock();
      if (id !== sampleToken || mode !== 'home') return;
      sound.direction(dir, sound.ctx.currentTime + 0.035);
    } catch {
      if (id === sampleToken) home('未能播放口令，请检查网络后重试。');
    }
    setTimeout(() => {
      if (id === sampleToken) b.classList.remove('playing');
    }, 1000);
  };
  $('samplers').append(b);
});
$('start').onclick = () => start('camera');
$('demo').onclick = () => start('demo');
$('action').onclick = () => {
  if (mode === 'play') pause('本轮成绩已保留。');
  else if (mode === 'paused') start(input, true);
  else if (mode === 'done') start(input);
};
$('exit').onclick = () => home();
for (const b of $('pad').children) b.onclick = () => demoStrike(b.dataset.dir);
// Hold/repeat and key-up cannot score additional notes.
document.addEventListener('keydown', (e) => {
  if ($('guide').open || mode !== 'play') return;
  if (e.key === 'Escape' && !e.repeat) {
    pause('本轮成绩已保留。');
    return;
  }
  if (arrows[e.key] && input === 'demo') {
    e.preventDefault();
    if (!e.repeat) demoStrike(arrows[e.key]);
  }
});
$('help').onclick = () => {
  if (['play', 'calibrate', 'eyes', 'loading'].includes(mode)) pause('关闭说明后可继续本轮。');
  clearSample();
  sound.clear();
  $('guide').showModal();
};
$('guide').onclick = (e) => {
  if (e.target === $('guide')) $('guide').close();
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause('页面已切到后台，本轮进度已保留。', false);
});
window.addEventListener('pagehide', () => {
  pause('本轮进度已保留。', false);
  release();
  sound.clear();
});
// Keep camera samples and note deadlines independent of compositor throttling.
setInterval(tick, 25);
requestAnimationFrame(draw);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
