/*
 * public/js/engine.js — 数据驱动的全双工演示引擎。
 * 读取 script.json 的 timeline,按 step 类型驱动手机舞台(living edge / overlay / 卡片 / 任务卡 / 来电 / 转写 …),
 * 语音走 WebAudio(双通道可同时发声),打断时模型音轨 0.7s 全音量重叠后淡出让位。
 * 时序规则与 shared/schedule.js 保持一致,便于导出的 JSON 与演示对齐。
 */
import { normalizeScript, T, clockToMs, msToClock, typedDurationMs, estimateDurationMs } from '/shared/script.js';

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SPHERE = (cls = '') => `<span class="sphere ${cls}"><i></i><i></i><i></i><i></i><i></i></span>`;
const EXPAND_ICON = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#F2F4F5" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7.2 1.5H10.5V4.8M10.5 1.5L6.9 5.1M4.8 10.5H1.5V7.2M1.5 10.5L5.1 6.9"/></svg>`;
const COLLAPSE_ICON = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#F2F4F5" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.2 4.8H7.2V1.8M7.2 4.8L10.8 1.2M1.8 7.2H4.8V10.2M4.8 7.2L1.2 10.8"/></svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* 静态打包(tools/build-static.mjs)时图标以 data URI 挂在 window.__ASSETS__.icons 上 */
const icon = (name) => (window.__ASSETS__?.icons?.[name || 'sparkles']) || `/assets/icons/${name || 'sparkles'}.png`;

export class DemoEngine {
  constructor(opts = {}) {
    this.onLog = opts.onLog || (() => {});
    this.onStep = opts.onStep || (() => {});
    this.onHint = opts.onHint || (() => {});
    this.onStory = opts.onStory || (() => {});
    this.onState = opts.onState || (() => {});
    this.ctx = null;
    this.buffers = {};      // clip → AudioBuffer
    this.fx = {};           // ding/ring/buzz/amb
    this.active = new Map();  // speaker → playback state
    this.playing = false;
    this.script = null;
    this.caseId = null;
    this.t0 = null;
    this.storyBase = null; this.storyAnchor = 0;
    this.ambWanted = 0; this.ambState = null; this.ambStopTimer = null;
    this.micReady = false; this.micAnalyser = null; this.micEnabled = true;
    this.interrupt = null;   // { armed, fired, resolve, source }
    this.pills = new Map();
    this.cards = new Map();
    this.timers = new Set();
    this.aborted = false;
    this.skipScene = false;
    this.buzz = null; this.sceneSrc = null;
    this.callTimer = null; this.recTimer = null; this.pillTimers = [];
    this.transcriptBlock = null;
    this.confirmResolve = null;
    this.installControls();
    setInterval(() => this.ambTick(), 200);
  }

  /* ---------------- 加载 ---------------- */
  async load(caseId, script, manifest) {
    this.reset();
    this.caseId = caseId;
    this.script = normalizeScript(script);
    this.manifest = manifest || { clips: {} };
    this.buffers = {};
    this.missing = [];
    this.renderIdle();
  }

  async ensureAudio() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.fxReady) {
      await Promise.all(['ding', 'ring', 'buzz', 'amb_loop'].map(async n => {
        try { const r = await fetch(`/assets/fx/${n}.wav`); this.fx[n] = await this.ctx.decodeAudioData(await r.arrayBuffer()); } catch { /* optional */ }
      }));
      this.fxReady = true;
    }
    if (!this.buffersReady) {
      const clips = Object.entries(this.manifest.clips || {});
      this.missing = [];
      await Promise.all(clips.map(async ([k, v]) => {
        if (!v.file) return;
        try {
          const r = await fetch(`/cases/${this.caseId}/audio/${v.file}`);
          if (!r.ok) throw new Error(r.status);
          this.buffers[k] = await this.ctx.decodeAudioData(await r.arrayBuffer());
        } catch (e) { this.missing.push(k); }
      }));
      for (const st of this.script.timeline) if (st.type === 'say' && st.clip && !this.buffers[st.clip] && !this.missing.includes(st.clip)) this.missing.push(st.clip);
      this.buffersReady = true;
    }
  }

  /* ---------------- 控件 ---------------- */
  installControls() {
    $('#ovExpand').addEventListener('click', () => {
      const full = $('#overlay').classList.toggle('full');
      $('#ovExpand').innerHTML = full ? COLLAPSE_ICON : EXPAND_ICON;
    });
    $('#screen').addEventListener('click', () => this.fireInterrupt('manual'));
    $('#csAccept').addEventListener('click', () => this.resolveConfirm?.('user'));
    $('#spEdge').addEventListener('click', () => { if (!this.playing) this.play(); });
    (function keepBottom() {
      const box = $('#ovLines'); let pinned = true;
      box.addEventListener('scroll', () => { pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 40; });
      new MutationObserver(() => { if (pinned) box.scrollTop = box.scrollHeight; }).observe(box, { childList: true, subtree: true, characterData: true });
    })();
  }

  renderIdle() {
    const d = new Date();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const ms = clockToMs(this.script?.scene?.clock);
    if (ms != null) this.paintClock(ms); else $('#lockClock').textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    $('#lockDate').textContent = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
    $('#ovBrand').textContent = this.script?.brand || 'Step Intelligence';
    this.onStory(ms);
  }
  paintClock(ms) {
    const h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60;
    $('#lockClock').textContent = `${h}:${String(m).padStart(2, '0')}`;
  }

  /* ---------------- story clock ---------------- */
  setStory(clock) {
    const ms = clockToMs(clock);
    if (ms == null) return;
    this.storyBase = ms; this.storyAnchor = performance.now();
    this.paintClock(ms); this.onStory(ms);
  }
  storyNow() { return this.storyBase == null ? null : this.storyBase + (performance.now() - this.storyAnchor); }
  storyTick() {
    if (!this.playing) return;
    const s = this.storyNow();
    if (s != null) { this.paintClock(s); this.onStory(s); }
    this.raf = requestAnimationFrame(() => this.storyTick());
  }

  /* ---------------- 日志 ---------------- */
  log(label, detail = '', opts = {}) {
    const t = this.t0 ? ((performance.now() - this.t0) / 1000).toFixed(1) : '0.0';
    this.onLog({ t, story: this.storyNow(), label, detail, ...opts });
  }
  logTracks(st) {
    for (const lg of st.log || []) this.onLog({ t: this.t0 ? ((performance.now() - this.t0) / 1000).toFixed(1) : '0.0', story: this.storyNow(), track: lg.track, sub: lg.sub, fields: lg.fields, text: lg.text, star: st.star });
    if (st.screen) this.onLog({ t: this.t0 ? ((performance.now() - this.t0) / 1000).toFixed(1) : '0.0', story: this.storyNow(), track: '自定义', sub: '屏幕', text: st.screen });
  }

  /* ---------------- 音频 ---------------- */
  playClip(clip, speaker, { volume = 1 } = {}) {
    const buf = this.buffers[clip];
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const gain = ctx.createGain(); gain.gain.value = volume;
    const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    src.connect(gain); gain.connect(analyser); analyser.connect(ctx.destination);
    const state = { src, gain, analyser, speaker, startedAt: ctx.currentTime, duration: buf.duration, cut: false, real: true };
    this.active.set(speaker, state);
    const promise = new Promise(res => {
      src.onended = () => { if (this.active.get(speaker) === state) this.active.delete(speaker); res(state.cut ? 'cut' : 'end'); };
      src.start();
    });
    return { state, promise };
  }
  /* 无音频:模拟一段"播放",供打字上屏与打断逻辑共用 */
  fakeClip(text, speaker, ms) {
    const state = { speaker, startedAt: this.ctx.currentTime, duration: ms / 1000, cut: false, real: false };
    this.active.set(speaker, state);
    const promise = new Promise(res => {
      const tm = setTimeout(() => { if (this.active.get(speaker) === state) this.active.delete(speaker); res(state.cut ? 'cut' : 'end'); }, ms);
      state.stop = () => { clearTimeout(tm); if (this.active.get(speaker) === state) this.active.delete(speaker); res('cut'); };
      this.timers.add(tm);
    });
    return { state, promise };
  }
  duckAndStop(state) {
    if (!state || state.cut) return;
    state.cut = true;
    if (!state.real) { setTimeout(() => state.stop?.(), T.cutHold); return; }
    const t = this.ctx.currentTime, g = state.gain.gain;
    g.setValueAtTime(g.value, t);
    g.setValueAtTime(g.value, t + T.cutHold / 1000);
    g.linearRampToValueAtTime(0.12, t + 1.25);
    g.linearRampToValueAtTime(0.0, t + T.cutFade / 1000);
    try { state.src.stop(t + T.cutFade / 1000 + 0.05); } catch { /* already stopped */ }
  }
  playFx(name, vol = 0.5) {
    const buf = this.fx[name]; if (!buf || !this.ctx) return Promise.resolve();
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const gain = this.ctx.createGain(); gain.gain.value = vol;
    src.connect(gain); gain.connect(this.ctx.destination);
    return new Promise(res => { src.onended = res; src.start(); });
  }
  startAmbient() {
    if (!this.fx.amb_loop || !this.ctx) return;
    const src = this.ctx.createBufferSource(); src.buffer = this.fx.amb_loop; src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime); gain.gain.linearRampToValueAtTime(0.22, this.ctx.currentTime + 0.8);
    src.connect(gain); gain.connect(this.ctx.destination); src.start();
    this.ambState = { src, gain };
  }
  stopAmbient() {
    clearTimeout(this.ambStopTimer); this.ambStopTimer = null; this.ambWanted = 0;
    if (!this.ambState) return;
    const t = this.ctx.currentTime, g = this.ambState.gain.gain;
    g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + 1.0);
    try { this.ambState.src.stop(t + 1.1); } catch { /* noop */ }
    this.ambState = null;
  }
  assistantSpeaking() { for (const [sp, st] of this.active) if (this.script?.speakers?.[sp]?.role === 'assistant' && !st.cut) return true; return false; }
  ambTick() {
    if (!this.ctx) return;
    const speaking = this.assistantSpeaking();
    if (this.ambWanted > 0 && !speaking && this.playing) {
      clearTimeout(this.ambStopTimer); this.ambStopTimer = null;
      if (!this.ambState) this.startAmbient();
    } else if (this.ambState && (speaking || this.ambWanted === 0 || !this.playing) && !this.ambStopTimer) {
      this.ambStopTimer = setTimeout(() => { const g = this.ambState; this.ambState = null; this.ambStopTimer = null; if (g) { const t = this.ctx.currentTime; g.gain.gain.setValueAtTime(g.gain.gain.value, t); g.gain.gain.linearRampToValueAtTime(0, t + 1); try { g.src.stop(t + 1.1); } catch { /* noop */ } } }, 250);
    }
  }
  acquireAmb() { this.ambWanted++; this.ambTick(); }
  releaseAmb() { this.ambWanted = Math.max(0, this.ambWanted - 1); }
  startBuzz() { if (!this.fx.ring) return; const src = this.ctx.createBufferSource(); src.buffer = this.fx.ring; src.loop = true; const g = this.ctx.createGain(); g.gain.value = 0.55; src.connect(g); g.connect(this.ctx.destination); src.start(); this.buzz = { src }; }
  stopBuzz() { if (this.buzz) { try { this.buzz.src.stop(); } catch { /* noop */ } this.buzz = null; } }
  playScene(clip) {
    const buf = this.buffers[clip]; if (!buf) return Promise.resolve();
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const gain = this.ctx.createGain(); gain.gain.value = 0.9;
    const t = this.ctx.currentTime, d = buf.duration;
    gain.gain.setValueAtTime(0.9, t + Math.max(0, d - 1.3)); gain.gain.linearRampToValueAtTime(0, t + d);
    src.connect(gain); gain.connect(this.ctx.destination);
    this.sceneSrc = src;
    return new Promise(res => { src.onended = () => { this.sceneSrc = null; res(); }; src.start(); });
  }

  /* ---------------- 麦克风 VAD ---------------- */
  async initMic() {
    if (this.micReady || !this.micEnabled || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const src = this.ctx.createMediaStreamSource(stream);
      this.micAnalyser = this.ctx.createAnalyser(); this.micAnalyser.fftSize = 512;
      src.connect(this.micAnalyser); this.micReady = true;
    } catch { this.micReady = false; }
  }
  levelOf(analyser) {
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(data);
    let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / data.length);
  }
  startVAD() {
    if (!this.micReady || !this.micEnabled) return () => {};
    let above = 0, stopped = false;
    const iv = setInterval(() => {
      if (stopped) return;
      above = this.levelOf(this.micAnalyser) > 0.055 ? above + 1 : 0;
      if (above >= 3) { clearInterval(iv); this.fireInterrupt('voice'); }
    }, 60);
    return () => { stopped = true; clearInterval(iv); };
  }
  fireInterrupt(source) {
    const it = this.interrupt;
    if (!it || !it.armed || it.fired) return;
    it.fired = true; it.armed = false; it.source = source;
    it.resolve(source);
  }

  /* ---------------- overlay 行 ---------------- */
  addOvLine(label, cls = '') {
    document.querySelectorAll('.ov-line').forEach(l => l.classList.add('past'));
    const el = document.createElement('div');
    el.className = 'ov-line' + (cls ? ' ' + cls : '');
    el.innerHTML = `<span class="sp">${esc(label)}</span><span class="tx"></span>`;
    $('#ovLines').appendChild(el);
    const cap = $('#overlay').classList.contains('full') ? 6 : 2;
    const lines = document.querySelectorAll('.ov-line');
    if (lines.length > cap) lines[0].remove();
    return el;
  }
  streamWith(el, text, state) {
    const tx = el.querySelector('.tx');
    let raf, frozen = false;
    const ctx = this.ctx;
    const prog = () => Math.min(1, (ctx.currentTime - state.startedAt) / (state.duration * 0.94));
    const tick = () => {
      if (frozen) return;
      const p = prog(); const n = Math.ceil(p * text.length);
      tx.innerHTML = `${esc(text.slice(0, Math.max(0, n - 5)))}<span class="hot">${esc(text.slice(Math.max(0, n - 5), n))}</span>`;
      if (p < 1) raf = requestAnimationFrame(tick); else tx.textContent = text;
    };
    raf = requestAnimationFrame(tick);
    return {
      cut: () => { frozen = true; cancelAnimationFrame(raf); const n = Math.max(1, Math.ceil(prog() * text.length)); tx.innerHTML = esc(text.slice(0, n)) + ' ——<span class="yield-note">已让声</span>'; el.classList.add('cut', 'past'); },
      done: () => { frozen = true; cancelAnimationFrame(raf); tx.textContent = text; },
    };
  }
  /* 逐字上屏;返回的 promise 带 cancel(),被打断时停在当前字并标"已让声" */
  typeInto(el, text, ms) {
    const tx = el.querySelector('.tx');
    let iv, resolve, n = 0;
    const p = new Promise(res => {
      resolve = res;
      const start = performance.now();
      iv = setInterval(() => {
        if (this.aborted) { clearInterval(iv); return res(); }
        const pr = Math.min(1, (performance.now() - start) / ms); n = Math.ceil(pr * text.length);
        tx.innerHTML = esc(text.slice(0, Math.max(0, n - 4))) + `<span class="hot">${esc(text.slice(Math.max(0, n - 4), n))}</span>`;
        if (pr >= 1) { clearInterval(iv); tx.textContent = text; res(); }
      }, 40);
      this.timers.add(iv);
    });
    p.cancel = () => { clearInterval(iv); tx.innerHTML = esc(text.slice(0, Math.max(1, n))) + ' ——<span class="yield-note">已让声</span>'; resolve(); };
    return p;
  }

  /* ---------------- 播放主流程 ---------------- */
  async play({ skipScene = this.skipScene } = {}) {
    if (this.playing || !this.script) return;
    this.playing = true; this.aborted = false;
    this.onState('loading'); this.onHint('加载语音…');
    try { await this.ensureAudio(); } catch (e) { this.log('音频加载失败', String(e), { cut: true }); this.playing = false; this.onState('idle'); return; }
    await this.initMic();
    if (this.missing.length) this.log('缺少语音', `${this.missing.length} 条台词没有音频,按语速上屏演示 · ${this.missing.slice(0, 6).join(' ')}${this.missing.length > 6 ? '…' : ''}`, { track: '引擎' });
    this.t0 = performance.now();
    this.onState('playing');
    if (this.script.scene?.clock) this.setStory(this.script.scene.clock);
    this.storyTick();
    const amb = this.script.scene?.ambience ? this.script.scene.ambience.replace(/\.[^.]+$/, '') : null;
    if (amb && this.buffers[amb] && !skipScene) {
      this.onHint('场景带入中…');
      this.log('场景引入', `${this.script.scene.title || ''} · 环境音带入`, { track: '引擎' });
      await this.playScene(amb);
    } else if (this.script.scene?.title) {
      this.log('场景', `${this.script.scene.title}${this.script.scene.desc ? ' · ' + this.script.scene.desc : ''}`, { track: '引擎' });
    }
    this.onHint('会话进行中');
    try { await this.runTimeline(); } catch (e) { if (!this.aborted) { console.error(e); this.log('引擎错误', String(e.message || e), { cut: true }); } }
    if (!this.aborted) { this.onHint('演示结束 · 重置后可重播'); this.onState('done'); }
    this.playing = false;
  }

  async runTimeline() {
    const tl = this.script.timeline;
    let pending = [];
    const consumed = new Set();
    this.lastSpeaker = null;
    this.anchorTime = performance.now();
    const join = async () => { if (pending.length) { const p = pending; pending = []; await Promise.all(p); } };
    const launchAnchored = (i) => {
      /* 紧跟在这一步之后、anchor = prev_start 的步骤:与之并发 */
      for (let j = i + 1; j < tl.length; j++) {
        const st = tl[j];
        if (st.anchor !== 'prev_start') { if (st.type === 'say' || st.type === 'system' || st.type === 'skip') break; else continue; }
        consumed.add(j);
        const p = (async () => { const d = Math.max(0, st.delay_ms || 0); if (d) await this.wait(d); await this.runStep(st, { anchored: true }); })();
        if (!st.silent) pending.push(p);
      }
    };
    for (let i = 0; i < tl.length; i++) {
      if (this.aborted) return;
      const st = tl[i];
      if (consumed.has(i)) continue;
      if (st.clock) this.setStory(st.clock);
      this.onStep(st);
      if (st.type === 'say') {
        const nextBarge = this.findBarge(i);
        if (st.barge_in || st.backchannel) {
          /* 打断:等到插入时刻(自动 / 人声 / 点击),压下对方再开口;附和:同一时刻叠上去,对方继续说 */
          const target = this.currentTarget(st);
          if (target) {
            await target.interruptP;
            if (st.barge_in) {
              this.duckAndStop(target.state); target.stream?.cut?.();
              const how = { voice: '检测到人声', auto: '自动演示', manual: '点击屏幕', natural: '对方已说完' }[target.interruptSource] || target.interruptSource;
              this.log('打断 · barge-in', `${how} · 双声重叠,${this.nameOf(target.speaker)} 立即 fade out 让位${st.soft ? ' · 软插话' : ''}`, { cut: true, track: '引擎' });
            } else {
              this.log('重叠 · 附和', `${this.nameOf(st.speaker)} 叠在 ${this.nameOf(target.speaker)} 上 · 对方继续说,不停顿`, { track: '引擎' });
            }
          }
          this.pendingTarget = null;
        } else {
          if (!st.parallel) await join();
          const gap = st.gap_ms != null ? st.gap_ms : (this.lastSpeaker == null ? 0 : (this.lastSpeaker !== st.speaker ? T.firstPacket : T.sameSpeakerGap));
          if (gap) await this.wait(gap);
          if (st.delay_ms) await this.wait(st.delay_ms);
        }
        this.logTracks(st);
        const r = this.startSay(st, { interruptible: !!nextBarge, bargeAt: nextBarge ? this.bargeAt(nextBarge, st) : null, vad: !!nextBarge && !nextBarge.backchannel });
        this.lastSpeaker = st.speaker;
        launchAnchored(i);
        if (nextBarge) { this.pendingTarget = r; pending.push(r.promise); }
        else if (st.parallel || st.backchannel) pending.push(r.promise);
        else await r.promise;
        continue;
      }
      if (st.type === 'join') { await join(); continue; }
      if (st.type === 'section') { this.logTracks(st); await this.runStep(st); continue; }
      if (st.type === 'system' || st.type === 'skip') {
        if (!st.parallel) await join();
        this.logTracks(st);
        await this.runStep(st);
        launchAnchored(i);
        continue;
      }
      this.logTracks(st);
      if (st.parallel) { const p = this.runStep(st); if (!st.silent) pending.push(p); }
      else await this.runStep(st);
    }
    await join();
    this.log('演示结束', '时间轴走完', { track: '引擎' });
  }

  findBarge(i) {
    const tl = this.script.timeline;
    for (let j = i + 1; j < tl.length; j++) {
      const st = tl[j];
      if (st.type === 'say') return (st.barge_in || st.backchannel) && st.speaker !== tl[i].speaker ? st : null;
      if ((st.type === 'system' && !st.parallel) || st.type === 'skip' || st.type === 'join') return null;
    }
    return null;
  }
  bargeAt(barge, target) {
    const dur = this.sayDuration(target);
    if (barge.at_ms != null) return barge.at_ms;
    if (barge.at_ratio != null) return Math.round(dur * barge.at_ratio);
    return Math.round(dur * 0.6);
  }
  currentTarget(st) {
    const t = this.pendingTarget;
    if (t && t.speaker !== st.speaker) return t;
    return null;
  }
  sayDuration(st) {
    if (st.duration_ms) return st.duration_ms;
    if (st.typed) return typedDurationMs(st.text);
    const b = this.buffers[st.clip];
    return b ? Math.round(b.duration * 1000) : estimateDurationMs(st.text);
  }
  nameOf(speaker) { return this.script.speakers?.[speaker]?.name || speaker; }

  /* 开口:返回 { promise, state, stream, speaker, interruptP, interruptSource } */
  ensureOverlay() {
    if (!this.sessionOn) return;
    const ov = $('#overlay');
    if (!ov.classList.contains('drop')) { ov.classList.add('drop'); $('#lockscreen').classList.add('dimmed'); if ($('#callScreen').classList.contains('show')) ov.classList.add('over-call'); }
  }
  startSay(st, { interruptible = false, bargeAt = null, vad = true } = {}) {
    const sp = this.script.speakers[st.speaker] || {};
    const role = sp.role;
    const name = sp.name || st.speaker;
    const labelBase = st.label || (role === 'user' ? (name === '你' ? '你' : name) : role === 'assistant' ? (this.script.brand_short || 'step') : name);
    const label = st.typed ? `${labelBase} · 打字` : st.whisper ? `${labelBase} · 低语` : labelBase;
    const volume = st.volume != null ? st.volume : (st.whisper ? 0.6 : 1);
    const tag = role === 'user' ? (st.no_bubble ? '用户自语' : '用户开口') : role === 'assistant' ? (st.nature ? `模型 · ${st.nature.split(/[（(:：]/)[0]}` : '模型应答') : `${name} 开口`;
    this.log(tag, `"${st.text}"${st.direction ? ' · ' + st.direction : ''}`, { track: '引擎', star: st.star });
    let el, res = {};
    if (st.no_bubble) {
      el = document.createElement('div'); el.innerHTML = '<span class="tx"></span>';   /* 不上屏:自言自语 / 旁人闲聊 */
    } else if (st.transcript) {
      this.ensureOverlay();
      el = this.mtRow(name);
    } else {
      if (!st.typed || role === 'assistant') this.ensureOverlay();
      el = this.addOvLine(label, (st.typed ? 'typed ' : '') + (st.whisper ? 'whisper ' : '') + (st.alert ? 'alert' : ''));
    }
    const buf = st.clip ? this.buffers[st.clip] : null;
    if (st.typed || !buf) {
      const ms = st.duration_ms || (st.typed ? typedDurationMs(st.text) : estimateDurationMs(st.text));
      const fake = this.fakeClip(st.text, st.speaker, ms);
      const typing = this.typeInto(el, st.text, ms);
      res = { speaker: st.speaker, state: fake.state, stream: { cut: () => { typing.cancel(); el.classList.add('cut', 'past'); }, done: () => {} }, promise: Promise.all([fake.promise, typing]).then(() => (fake.state.cut ? 'cut' : 'end')) };
    } else {
      const { state, promise } = this.playClip(st.clip, st.speaker, { volume });
      const stream = this.streamWith(el, st.text, state);
      res = { speaker: st.speaker, state, stream, promise: promise.then(r => { if (r !== 'cut') stream.done(); return r; }) };
    }
    if (st.tags) res.promise.then(() => this.mtTags(el, st.tags));
    if (st.transcript) res.promise.then(() => el.classList.add('past'));
    /* 可被打断:武装中断,自动在 bargeAt 触发 */
    res.interruptSource = null;
    if (interruptible) {
      const it = { armed: true, fired: false, resolve: null };
      it.promise = new Promise(r => { it.resolve = r; });
      this.interrupt = it;
      const stopVAD = vad ? this.startVAD() : () => {};
      const auto = setTimeout(() => this.fireInterrupt('auto'), Math.max(200, bargeAt ?? 0));
      this.timers.add(auto);
      res.interruptP = Promise.race([it.promise, res.promise.then(() => 'natural')]).then(src => { clearTimeout(auto); stopVAD(); it.armed = false; if (this.interrupt === it) this.interrupt = null; res.interruptSource = src === 'natural' ? 'natural' : it.source; return src; });
      this.onHint(this.micReady && this.micEnabled ? '模型说话中 · 开口即可打断' : '模型说话中 · 点屏幕可打断');
    } else {
      res.interruptP = res.promise;
    }
    return res;
  }

  wait(ms) {
    return new Promise(res => { const t = setTimeout(res, ms); this.timers.add(t); });
  }

  /* ---------------- 各类 step ---------------- */
  async runStep(st, { anchored = false } = {}) {
    if (this.aborted) return;
    switch (st.type) {
      case 'section': {
        if (st.title) this.log(`§ ${st.short || st.title}`, st.desc || '', { track: '引擎', section: true });
        return;
      }
      case 'edge': return this.edge(st);
      case 'tool': return this.tool(st);
      case 'memory': return this.memory(st);
      case 'backend': return this.backend(st);
      case 'agent': return this.agent(st);
      case 'world': return this.world(st);
      case 'card': return this.card(st);
      case 'pill': return this.pill(st);
      case 'call': return this.call(st);
      case 'hardware': return this.hardware(st);
      case 'overlay': return this.overlay(st);
      case 'rec': return this.rec(st);
      case 'banner': return this.banner(st);
      case 'transcript': return this.transcript(st);
      case 'article': return this.article(st);
      case 'wait': if (st.label) this.log(st.label, '', { track: '引擎' }); return this.wait(st.ms || 0);
      case 'skip': {
        const from = this.storyNow();
        this.toast(`画面跳过 ${from != null ? msToClock(from, false) : ''} → ${st.to || ''}`);
        this.log(st.label || '画面跳过', st.to ? `→ ${st.to}` : '', { track: '引擎' });
        await this.wait(st.hold_ms ?? T.skipHold);
        if (st.to) this.setStory(st.to);
        return;
      }
      case 'system': {
        this.log('系统', st.text || '', { track: '引擎', star: st.star });
        if (st.clock_end) {
          const a = clockToMs(st.clock), b = clockToMs(st.clock_end);
          if (a != null && b != null && b - a > 15000) this.toast(`画面跳过 ${msToClock(a, false)} → ${msToClock(b, false)}`);
        }
        if (st.parallel) return;
        await this.wait(st.hold_ms ?? T.skipHold);
        if (st.clock_end) this.setStory(st.clock_end);
        return;
      }
      case 'fx': return this.playFx(st.name || 'ding', st.vol ?? 0.5);
      case 'log': this.log(st.label || '', st.detail || '', { cut: !!st.cut, track: '引擎' }); return;
      case 'end': this.log(st.label || '结束', '', { track: '引擎' }); return;
      default: return;
    }
  }

  /* living edge */
  async edge(st) {
    const edge = $('#spEdge'), ring = $('#touchRing');
    const a = st.action || 'touch';
    if (a === 'touch') {
      edge.classList.remove('rec', 'alert'); edge.classList.add('flash'); ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go');
      const fxP = this.playFx('ding', 0.55);
      this.log('建连音效', '嘚嘚 ~1s · 掩盖 WebRTC 建连延迟的产品巧思', { track: '引擎' });
      await Promise.all([fxP, this.wait(1000)]);
      edge.classList.remove('flash'); edge.classList.add('on');
      this.sessionOn = true;
      $('#lockscreen').classList.add('dimmed');
      $('#overlay').classList.add('drop');
      if ($('#callScreen').classList.contains('show')) $('#overlay').classList.add('over-call');
      this.log('会话开始', '触碰 living edge · 双工链路建立,双通道在线', { track: '引擎' });
      await this.wait(700);
      return;
    }
    if (a === 'double') {
      for (let i = 0; i < 2; i++) { ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go'); edge.classList.add('flash'); await this.wait(230); edge.classList.remove('flash'); await this.wait(190); }
      this.log('双击唤起', '连摸两下 living edge · 进入悄悄话模式', { track: '引擎' });
      edge.classList.add('rec'); this.sessionOn = true;
      $('#lockscreen').classList.add('dimmed'); $('#overlay').classList.add('drop');
      await this.wait(500);
      return;
    }
    if (a === 'flash' || a === 'listen') { ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go'); edge.classList.add('flash'); await this.wait(T.edgeFlash); edge.classList.remove('flash'); return; }
    if (a === 'gflash') { edge.classList.add('gflash'); await this.wait(T.edgeFlash); edge.classList.remove('gflash'); edge.classList.add('rec'); return; }
    if (a === 'on') { edge.classList.add('on'); return; }
    if (a === 'off' || a === 'clear') { edge.classList.remove('on', 'flash', 'alert', 'rec', 'gflash'); return; }
    if (a === 'alert') { edge.classList.add('alert'); return; }
    if (a === 'rec') { edge.classList.remove('on'); edge.classList.add('rec'); return; }
  }

  /* tool / memory / backend → agent 卡片 + 日志 */
  async tool(st) {
    const args = typeof st.args === 'string' ? st.args : (st.args ? JSON.stringify(st.args) : '');
    const resStr = st.result == null ? (st.status === 'pending' ? '进行中' : '') : (typeof st.result === 'string' ? st.result : JSON.stringify(st.result));
    this.log('工具调用', `${st.name}(${args})${resStr ? ' → ' + resStr : ''}${st.elapsed_ms != null ? ` · ${(st.elapsed_ms / 1000).toFixed(1)}s` : ''}`, { track: '引擎' });
    if (st.ui === false || st.silent) { await this.wait(st.elapsed_ms || 0); return; }
    const ui = st.ui || {};
    const ms = ui.ms ?? Math.min(Math.max(st.elapsed_ms ?? 1600, 900), 9000);
    const block = this.agentContainer(st);
    await this.agentStep(block, ui.icon || 'sparkles', ui.doing || `正在${st.task_type || '处理'}…`, ui.done || resStr || '完成', ms);
  }
  async memory(st) {
    this.log('Memory 检索', `${st.kind || 'memory_call_fast'} · ${st.query || ''}${st.result ? ' → ' + st.result : ''}${st.consume ? ' · ' + st.consume : ''}`, { track: '引擎' });
    if (st.ui && st.ui !== true) { const block = this.agentContainer(st); await this.agentStep(block, st.ui.icon || 'shield', st.ui.doing || '正在翻记忆…', st.ui.done || st.result || '命中', st.ui.ms ?? st.elapsed_ms ?? 1200); }
    else await this.wait(st.elapsed_ms || 0);
  }
  async backend(st) {
    this.log('后台任务 handoff', `${st.query || ''}${st.result ? ' → ' + st.result : ''}`, { track: '引擎' });
    const ui = st.ui || {};
    if (st.silent) return this.wait(st.elapsed_ms || 0);
    const block = this.agentContainer(st);
    await this.agentStep(block, ui.icon || 'sparkles', ui.doing || `后台处理:${(st.query || '').slice(0, 18)}…`, ui.done || st.result || '完成', ui.ms ?? Math.min(st.elapsed_ms ?? 4000, 9000));
  }
  agentContainer(st) {
    this.ensureOverlay();
    if (st.block === 'new' || !this.agentBlock || !this.agentBlock.isConnected || st.block === false) {
      const block = document.createElement('div'); block.className = 'agent-block'; $('#ovLines').appendChild(block); this.agentBlock = block;
    }
    return this.agentBlock;
  }
  async agentThink(block, text) {
    const el = document.createElement('div'); el.className = 'ag-think'; el.innerHTML = `${SPHERE('spin')}<span class="tt"></span>`; block.appendChild(el);
    const tt = el.querySelector('.tt');
    for (let i = 1; i <= text.length; i++) { if (this.aborted) return; tt.textContent = text.slice(0, i); await this.wait(T.thinkTypeMs); }
    el.querySelector('.sphere').classList.remove('spin');
  }
  async agentStep(block, ic, doing, doneText, ms) {
    const needAmb = ms >= T.ambThreshold;
    if (needAmb) this.acquireAmb();
    try {
      const el = document.createElement('div'); el.className = 'ag-step';
      el.innerHTML = `<img src="${icon(ic)}" alt=""><span class="st"></span>${SPHERE('spin')}`;
      block.appendChild(el);
      const stEl = el.querySelector('.st');
      for (let i = 1; i <= doing.length; i++) { if (this.aborted) return; stEl.textContent = doing.slice(0, i); await this.wait(T.agentTypeMs); }
      await this.wait(ms);
      el.querySelector('.sphere')?.remove(); stEl.textContent = doneText; el.classList.add('done');
      await this.wait(T.agentSettle);
    } finally { if (needAmb) this.releaseAmb(); }
  }
  async agent(st) {
    let body, fold = null, ticker = null;
    if (st.fold !== false && !st.inline && (st.steps || []).length > 1) {
      fold = document.createElement('div'); fold.className = 'agent-fold';
      fold.innerHTML = `<div class="af-head">${SPHERE('xl spin')}<div class="af-label">${esc(st.ticker || '正在规划…')}</div><svg class="af-chev" width="11" height="7" viewBox="0 0 11 7" fill="none"><path d="M1 1.5 L5.5 5.5 L10 1.5" stroke="#A6AFB2" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="af-body"></div>`;
      $('#ovLines').appendChild(fold);
      body = fold.querySelector('.af-body'); ticker = fold.querySelector('.af-label');
      fold.querySelector('.af-head').addEventListener('click', () => fold.classList.toggle('open'));
      if (st.open) fold.classList.add('open');
      this.log('开始执行', 'CoT 与工具调用启动', { track: '引擎' });
    } else {
      body = this.agentContainer({ block: 'new' });
    }
    if (st.think) await this.agentThink(body, st.think);
    for (const sub of st.steps || []) {
      if (this.aborted) return;
      if (ticker) ticker.textContent = sub.doing || '';
      if (sub.tool) this.log('工具调用', `${sub.tool}(${sub.args || ''})${sub.result ? ' → ' + sub.result : ''}`, { track: '引擎' });
      await this.agentStep(body, sub.icon || 'sparkles', sub.doing || '', sub.done || sub.doing || '', sub.ms ?? 2400);
    }
    if (fold) { if (ticker) ticker.textContent = st.done || '已完成,等你确认'; fold.querySelector('.sphere')?.classList.remove('spin'); }
    if (st.done_log) this.log(st.done_log, '', { track: '引擎' });
  }
  world(st) {
    const parts = [st.scene_state, st.signal_source, st.disturb_worth].filter(Boolean).join(' · ');
    this.log('世界信号', parts || st.text || st.note || '', { track: '引擎' });
    if (st.badge) this.lockBadge(st.badge);
  }

  /* 卡片 */
  async card(st) {
    if (st.delay_ms && !st.anchor) await this.wait(st.delay_ms);
    this.ensureOverlay();
    if (st.update && this.cards.get(st.update)) { this.patchCard(this.cards.get(st.update), st); this.log('卡片更新', st.title || st.sub || '', { track: '引擎' }); return; }
    const el = document.createElement('div');
    const style = st.style || 'card';
    if (style === 'quote') {
      el.className = 'quote-card';
      el.innerHTML = `<div class="q-l"><div class="q-n">${esc(st.title)}</div><div class="q-c">${esc(st.sub || '')}</div></div><div class="q-r"><div class="q-p">${esc(st.price ?? st.eta?.n ?? '')}</div><div class="q-d ${st.up === false || st.down ? 'down' : 'up'}">${esc(st.change || st.chg || '')}</div></div>`;
    } else if (style === 'shot') {
      el.className = 'shot-card';
      el.innerHTML = `<img src="${icon(st.icon || 'screenshot')}" alt=""><div><div class="sc-t">${esc(st.title)}</div><div class="sc-s">${esc(st.sub || '')}</div></div>`;
    } else if (style === 'note') {
      el.className = 'shot-card';
      el.innerHTML = `<img src="${icon(st.icon || 'doc')}" alt=""><div><div class="sc-t">${esc(st.title)}</div>${st.sub ? `<div class="sc-s">${esc(st.sub)}</div>` : ''}</div>`;
    } else {
      el.className = 'ride-card' + (style === 'alert' ? ' alertcard' : '');
      el.innerHTML = this.cardInner(st);
    }
    $('#ovLines').appendChild(el);
    if (st.id) this.cards.set(st.id, el);
    if (st.timer) this.cardTimer(el, st.timer);
    this.log(st.log_label || '卡片落地', [st.title, st.sub].filter(Boolean).join(' · '), { track: '引擎', cut: style === 'alert' });
    if (st.button && st.await !== false) {
      const btn = el.querySelector('.rc-btn');
      const how = await new Promise(res => {
        this.confirmResolve = res;
        btn?.addEventListener('click', e => { e.stopPropagation(); res('user'); });
        const t = setTimeout(() => res('auto'), st.button.wait_ms ?? T.cardWait); this.timers.add(t);
      });
      this.confirmResolve = null;
      if (btn) { btn.textContent = st.button.done_label || st.button.done || '已确认'; btn.classList.add('booked'); btn.disabled = true; }
      if (st.button.done_title) { const t = el.querySelector('.rc-title'); if (t) t.textContent = st.button.done_title; }
      this.log('用户确认', (how === 'user' ? `点按 ${st.button.label}` : '自动演示确认') + (st.button.done_log ? ' · ' + st.button.done_log : ''), { track: '引擎' });
    }
  }
  cardInner(st) {
    const eta = st.eta ? `<div class="rc-eta">${esc(st.eta.n ?? st.eta)}<span>${esc(st.eta.unit || '')}</span></div>` : '';
    const rows = (st.rows || []).map(r => `<div class="al-r ${esc(r.cls || '')}"><span>${esc(r.k)}</span><b${r.color ? ` style="color:${esc(r.color)}"` : ''}>${esc(r.v)}</b></div>`).join('');
    const sections = (st.sections || []).map(sec => `<div class="mn-sec"><div class="mn-h">${esc(sec.h)}</div>${(sec.items || []).map((it, i) => `<div class="mn-item">${it.k !== undefined ? `<span class="k">${esc(it.k)}</span>` : `<span class="k">${String(i + 1).padStart(2, '0')}</span>`}<span>${esc(it.text || it.t || it)}</span>${it.own ? `<span class="own">${esc(it.own)}</span>` : ''}</div>`).join('')}</div>`).join('');
    const meta = st.meta ? `<div class="rc-meta">${(Array.isArray(st.meta) ? st.meta : [st.meta]).map(m => `<span>${esc(m)}</span>`).join('')}</div>` : '';
    const say = st.say ? `<div class="al-say">${st.say_prefix !== undefined ? esc(st.say_prefix) : '可以直接说 → '}<b>${esc(st.say)}</b></div>` : '';
    const btn = st.button ? `<button class="rc-btn">${esc(st.button.label || '确认')}</button>` : '';
    return `<div class="rc-row"><div class="rc-glyph"><img src="${icon(st.icon)}" alt=""></div><div><div class="rc-title">${esc(st.title || '')}</div>${st.sub ? `<div class="rc-sub">${esc(st.sub)}</div>` : ''}</div>${eta}</div>${rows ? `<div class="al-rows">${rows}</div>` : ''}${sections}${meta}${say}${btn}`;
  }
  patchCard(el, st) {
    if (st.title) { const t = el.querySelector('.rc-title, .q-n, .sc-t'); if (t) t.textContent = st.title; }
    if (st.sub) { const s = el.querySelector('.rc-sub, .q-c, .sc-s'); if (s) s.textContent = st.sub; }
    if (st.meta) { let m = el.querySelector('.rc-meta'); if (!m) { m = document.createElement('div'); m.className = 'rc-meta'; el.appendChild(m); } m.innerHTML = (Array.isArray(st.meta) ? st.meta : [st.meta]).map(x => `<span>${esc(x)}</span>`).join(''); }
    if (st.rows) { let r = el.querySelector('.al-rows'); if (!r) { r = document.createElement('div'); r.className = 'al-rows'; el.appendChild(r); } r.innerHTML = st.rows.map(x => `<div class="al-r ${esc(x.cls || '')}"><span>${esc(x.k)}</span><b>${esc(x.v)}</b></div>`).join(''); }
    if (st.eta) { let e = el.querySelector('.rc-eta'); if (!e) { e = document.createElement('div'); e.className = 'rc-eta'; el.querySelector('.rc-row')?.appendChild(e); } e.innerHTML = `${esc(st.eta.n ?? st.eta)}<span>${esc(st.eta.unit || '')}</span>`; }
    if (st.button) { const b = el.querySelector('.rc-btn'); if (b) { b.textContent = st.button.label; if (st.button.done) { b.classList.add('booked'); b.disabled = true; } } }
    if (st.timer !== undefined) this.cardTimer(el, st.timer);
  }
  /* 卡片上的倒计时(成语接龙 30s):timer = { from, unit } 开始,false 停止 */
  cardTimer(el, cfg) {
    this.cardTimers = this.cardTimers || new Map();
    const old = this.cardTimers.get(el); if (old) { clearInterval(old); this.cardTimers.delete(el); }
    if (!cfg) return;
    let n = cfg.from ?? 30; const unit = cfg.unit ?? 's';
    let e = el.querySelector('.rc-eta'); if (!e) { e = document.createElement('div'); e.className = 'rc-eta'; el.querySelector('.rc-row')?.appendChild(e); }
    const fmt = (v) => cfg.format === 'mm:ss' ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` : String(v);
    const paint = () => { e.innerHTML = `${fmt(Math.max(0, n))}<span>${esc(unit)}</span>`; };
    paint();
    const iv = setInterval(() => { n--; paint(); if (n <= 0) clearInterval(iv); }, cfg.step_ms || 1000);
    this.cardTimers.set(el, iv); this.timers.add(iv);
  }

  /* 任务卡(灵动岛式) */
  pill(st) {
    if (st.action === 'hide') { const id = st.id || 'default'; const el = this.pills.get(id); if (el) { el.classList.remove('show'); } return; }
    const id = st.id || 'default';
    let el = this.pills.get(id);
    if (!el) { el = document.createElement('div'); el.className = 'task-pill'; $('#pills').appendChild(el); this.pills.set(id, el); }
    el.className = 'task-pill' + (st.theme === 'green' ? ' green' : '');
    const stops = (st.stops || []).map((s, i) => `<span class="${i === (st.cur ?? 1) ? 'cur' : ''}">${esc(s)}</span>`).join('');
    el.innerHTML = `<div class="tp-top"><img src="${icon(st.icon)}" alt=""><span class="tp-name">${esc(st.name || '')}</span><span class="tp-now">${esc(st.now || '')}</span></div>${st.progress ? `<div class="tp-line"><i class="fill"></i><span class="tp-stop s1"></span><span class="tp-cur"></span><span class="tp-stop s3"></span></div>` : ''}${stops ? `<div class="tp-stops">${stops}</div>` : ''}`;
    const offset = [...this.pills.values()].filter(p => p !== el && p.classList.contains('show')).length;
    el.style.bottom = (92 + offset * 96) + 'px';
    el.style.setProperty('--prog', '18%');
    requestAnimationFrame(() => el.classList.add('show'));
    this.log(st.log_label || '任务落地', `${st.name || ''} · ${st.now || ''}${st.stops ? ' · ' + st.stops.join(' → ') : ''}`, { track: '引擎' });
    if (st.progress) {
      const cfg = typeof st.progress === 'object' ? st.progress : {};
      let p = cfg.from ?? 18; const to = cfg.to ?? 46, step = cfg.step ?? 1.4, iv = cfg.interval ?? 900;
      const tm = setInterval(() => { p = Math.min(to, p + step); el.style.setProperty('--prog', p + '%'); if (p >= to) clearInterval(tm); }, iv);
      this.pillTimers.push(tm);
    }
    if (st.countdown) {
      const now = el.querySelector('.tp-now');
      const c = st.countdown; const steps = c.steps ?? 5; const ms = c.step_ms ?? 1000;
      return (async () => {
        for (let i = steps; i >= 1; i--) { if (this.aborted) return; now.textContent = c.format ? c.format.replace('{n}', i) : `${i}:00`; await this.wait(ms); }
        now.textContent = c.end || 'now'; await this.wait(400);
      })();
    }
  }
  lockBadge(text, ic = 'shield') {
    const box = $('#lockBadge'); const el = document.createElement('div'); el.className = 'lb';
    el.innerHTML = `<img src="${icon(ic)}" alt=""><span>${esc(text)}</span>`; box.appendChild(el);
  }

  /* 来电 */
  async call(st) {
    const a = st.action || 'ring';
    const cs = $('#callScreen');
    if (a === 'ring') {
      $('#csName').textContent = st.name || '老妈';
      $('#csSub').textContent = st.sub || 'mobile · incoming call…';
      const dock = $('#csDock'); dock.innerHTML = '';
      if (st.assist) {
        const as = typeof st.assist === 'object' ? st.assist : {};
        dock.innerHTML = `<div class="assist-pill" id="assistPill">${SPHERE('spin')}<span class="ap-t">${esc(as.title || '通话助攻')}</span><span class="ap-s">${esc(as.sub || '已开启 · 点按关闭')}</span></div>`;
        dock.querySelector('#assistPill').addEventListener('click', function () { const off = this.classList.toggle('off'); this.querySelector('.ap-s').textContent = off ? '已关闭 · 点按开启' : '已开启 · 点按关闭'; this.querySelector('.sphere').classList.toggle('spin', !off); });
      }
      for (const p of this.pills.values()) p.classList.remove('show');
      cs.classList.add('show');
      this.startBuzz();
      this.log(st.log_label || '来电', `${st.name || ''} · iOS 来电界面接管 · 铃声响起${st.assist ? ' · 电话助攻自动挂载' : ''}`, { track: '引擎' });
      const how = await new Promise(res => { this.resolveConfirm = res; const t = setTimeout(() => res('auto'), st.wait_ms ?? T.callRing); this.timers.add(t); });
      this.resolveConfirm = null;
      this.stopBuzz();
      if (st.then === 'end' || st.answer === false) { cs.classList.remove('show', 'connected'); this.log('铃声结束', st.detail || '接起来就能走', { track: '引擎' }); return; }
      cs.classList.add('connected');
      let sec = 0; $('#csSub').textContent = '00:00';
      clearInterval(this.callTimer);
      this.callTimer = setInterval(() => { sec++; $('#csSub').textContent = '00:' + String(sec).padStart(2, '0'); }, 1000);
      this.log('接听', how === 'user' ? '用户点按接听' : '自动演示接听', { track: '引擎' });
      return;
    }
    if (a === 'connect') { this.stopBuzz(); cs.classList.add('show', 'connected'); let sec = 0; clearInterval(this.callTimer); this.callTimer = setInterval(() => { sec++; $('#csSub').textContent = '00:' + String(sec).padStart(2, '0'); }, 1000); return; }
    if (a === 'end') {
      this.stopBuzz(); clearInterval(this.callTimer); this.callTimer = null;
      cs.classList.remove('show', 'connected'); $('#csSub').textContent = 'mobile · incoming call…'; $('#csDock').innerHTML = '';
      $('#overlay').classList.remove('over-call'); $('#spEdge').classList.remove('alert');
      this.log(st.label || '通话结束', st.detail || '', { track: '引擎' });
    }
  }

  async hardware(st) {
    const f = st.feedback || 'none';
    if (f === 'vibrate') { $('#phone').classList.add('shake'); this.playFx('buzz', 0.35); this.log('硬件反馈', '手机微震' + (st.latency ? ' · ' + st.latency : ''), { track: '引擎', cut: true }); setTimeout(() => $('#phone').classList.remove('shake'), 900); return; }
    if (f === 'flash') { const e = $('#spEdge'); e.classList.add('flash'); this.log('硬件反馈', '边缘炫光一闪' + (st.latency ? ' · ' + st.latency : ''), { track: '引擎' }); await this.wait(T.edgeFlash); e.classList.remove('flash'); return; }
    if (f === 'alert') { $('#spEdge').classList.add('alert'); $('#phone').classList.add('shake'); this.playFx('buzz', 0.35); this.log('关键事件识别', 'living edge 红闪 + 手机微震', { track: '引擎', cut: true }); setTimeout(() => $('#phone').classList.remove('shake'), 900); return; }
    if (f === 'badge') { this.lockBadge(st.text || '', st.icon); this.log('硬件反馈', `锁屏角标 · ${st.text || ''}`, { track: '引擎' }); return; }
    if (f === 'none') { this.log('硬件反馈', '无 · 零反馈(显式标注)', { track: '引擎' }); return; }
  }

  async overlay(st) {
    const ov = $('#overlay');
    const a = st.action || 'drop';
    if (a === 'drop') { ov.classList.add('drop'); $('#lockscreen').classList.add('dimmed'); if ($('#callScreen').classList.contains('show')) ov.classList.add('over-call'); await this.wait(T.overlayDrop); return; }
    if (a === 'collapse') {
      await this.wait(1100);
      ov.classList.remove('drop', 'full', 'over-call'); $('#ovExpand').innerHTML = EXPAND_ICON; $('#lockscreen').classList.remove('dimmed');
      if (st.edge_off !== false && st.keep_edge !== true) { /* 会话继续但面板收起:保留 living edge */ }
      if (st.end_session || st.edge_off) { $('#spEdge').classList.remove('on', 'rec'); this.sessionOn = false; }
      this.log(st.label || 'overlay 收起', st.detail || '面板收起,任务转入通知区', { track: '引擎' });
      await this.wait(450);
      if (st.clear) $('#ovLines').innerHTML = '';
      return;
    }
    if (a === 'full') { ov.classList.add('full'); $('#ovExpand').innerHTML = COLLAPSE_ICON; return; }
    if (a === 'clear') { $('#ovLines').innerHTML = ''; this.agentBlock = null; this.transcriptBlock = null; return; }
    if (a === 'over-call') { ov.classList.add('over-call', 'drop'); return; }
    if (a === 'hide') { ov.classList.remove('drop', 'full'); $('#lockscreen').classList.remove('dimmed'); if (st.end_session) { $('#spEdge').classList.remove('on', 'rec'); } await this.wait(500); return; }
  }

  rec(st) {
    if ((st.action || 'start') === 'start') {
      let s = st.from_sec ?? 0;
      $('#ovRec').classList.add('on'); $('#ovSilent').style.display = '';
      const paint = () => { $('#ovRecTime').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
      paint(); clearInterval(this.recTimer); this.recTimer = setInterval(() => { s++; paint(); }, 1000);
      this.log('开始转写', 'REC 计时接管 · 转写留在下拉面板内', { track: '引擎' });
    } else {
      clearInterval(this.recTimer); this.recTimer = null;
      $('#ovRec').classList.remove('on'); $('#ovSilent').style.display = 'none';
      this.log('结束记录', 'REC 停止', { track: '引擎' });
    }
  }
  banner(st) {
    const b = document.createElement('div'); b.className = 'quiet-banner';
    b.innerHTML = `<img src="${icon(st.icon || 'ear')}" alt=""><span class="qb-t">${esc(st.title || '')}</span><span class="qb-s">${esc(st.sub || '')}</span>`;
    $('#ovLines').appendChild(b);
    this.log(st.title || '模式', st.sub || '', { track: '引擎' });
    return this.wait(T.bannerHold);
  }
  /* 转写 */
  mtRow(name) {
    if (!this.transcriptBlock || !this.transcriptBlock.isConnected) { const b = document.createElement('div'); b.className = 'mt-block'; $('#ovLines').appendChild(b); this.transcriptBlock = b; }
    document.querySelectorAll('.mt-row').forEach(r => r.classList.add('past'));
    const row = document.createElement('div'); row.className = 'mt-row';
    row.innerHTML = `<span class="who">${esc(name)}</span><div class="bd"><span class="tx"></span></div>`;
    this.transcriptBlock.appendChild(row);
    return row;
  }
  mtTags(row, tags) {
    const box = document.createElement('div'); box.className = 'mt-tags';
    box.innerHTML = tags.map(t => `<span class="mt-tag ${esc(t.k || '')}">${esc(t.t || t)}</span>`).join('');
    (row.querySelector('.bd') || row).appendChild(box);
    this.log('静默标注', tags.map(t => t.t || t).join(' · '), { track: '引擎' });
  }
  transcript(st) {
    if (st.action === 'split') { const el = document.createElement('div'); el.className = 'mt-split'; el.textContent = st.text || '两人同时开口 · 双路分离'; (this.transcriptBlock?.isConnected ? this.transcriptBlock : $('#ovLines')).appendChild(el); this.log('双声重叠', st.text || '两路并行识别,各自成句,不丢字', { track: '引擎', cut: true }); return; }
    if (st.action === 'open') { const b = document.createElement('div'); b.className = 'mt-block'; $('#ovLines').appendChild(b); this.transcriptBlock = b; return; }
  }
  article(st) {
    const el = $('#article');
    if ((st.action || 'show') === 'show') {
      const body = (st.body || []).map(b => b.h2 ? `<div class="art-h2">${esc(b.h2)}</div>` : `<p class="art-p">${esc(b.p || b).replace(b.em ? esc(b.em) : ' ', b.em ? `<em>${esc(b.em)}</em>` : '')}</p>`).join('');
      el.innerHTML = `<div class="art-src"><i></i>${esc(st.source || '')}</div><div class="art-h1">${esc(st.title || '')}</div><div class="art-meta">${esc(st.meta || '')}</div><div>${body}</div>`;
      el.classList.add('show');
      this.log('阅读中', st.source ? `${st.source} · ${st.title || ''}` : st.title || '', { track: '引擎' });
      return this.wait(st.hold_ms || 0);
    }
    el.classList.remove('show');
  }
  toast(text) {
    const t = $('#stageToast'); t.textContent = text; t.classList.add('show');
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------------- 重置 ---------------- */
  reset() {
    this.aborted = true; this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); } this.timers.clear();
    for (const t of this.pillTimers) clearInterval(t); this.pillTimers = [];
    for (const [, st] of this.active) { st.cut = true; try { st.src?.stop(); } catch { /* noop */ } st.stop?.(); }
    this.active.clear();
    if (this.ambState) { try { this.ambState.src.stop(); } catch { /* noop */ } this.ambState = null; }
    this.ambWanted = 0; clearTimeout(this.ambStopTimer); this.ambStopTimer = null;
    if (this.sceneSrc) { try { this.sceneSrc.stop(); } catch { /* noop */ } this.sceneSrc = null; }
    this.stopBuzz(); clearInterval(this.callTimer); this.callTimer = null; clearInterval(this.recTimer); this.recTimer = null;
    this.interrupt = null; this.pendingTarget = null; this.resolveConfirm = null; this.confirmResolve = null;
    this.buffersReady = false; this.t0 = null; this.storyBase = null;
    this.pills.clear(); this.cards.clear(); this.agentBlock = null; this.transcriptBlock = null; this.sessionOn = false;
    if (!document.body) return;
    $('#pills').innerHTML = ''; $('#ovLines').innerHTML = ''; $('#lockBadge').innerHTML = '';
    $('#overlay').classList.remove('drop', 'full', 'over-call'); $('#ovExpand').innerHTML = EXPAND_ICON;
    $('#lockscreen').classList.remove('dimmed');
    $('#spEdge').classList.remove('on', 'flash', 'alert', 'rec', 'gflash'); $('#touchRing').classList.remove('go');
    $('#callScreen').classList.remove('show', 'connected'); $('#csSub').textContent = 'mobile · incoming call…'; $('#csDock').innerHTML = '';
    $('#article').classList.remove('show'); $('#ovRec').classList.remove('on'); $('#ovRecTime').textContent = '00:00'; $('#ovSilent').style.display = 'none';
    $('#phone').classList.remove('shake'); $('#stageToast').classList.remove('show');
    this.onHint('点按 living edge 开始'); this.onState('idle');
    if (this.script) this.renderIdle();
  }
}
