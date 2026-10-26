/* Voice out: Piper Bengali (worker, wasm) -> WebAudio (AnalyserNode drives the mouth). Fallback: browser speechSynthesis. */
'use strict';
var Tts = (function () {
  var VOICES = [
    { sid: 9, name: 'কণ্ঠ ১', hint: 'ভারী' },
    { sid: 0, name: 'কণ্ঠ ২', hint: 'মাঝারি' },
    { sid: 3, name: 'কণ্ঠ ৩', hint: 'নরম' },
    { sid: 11, name: 'কণ্ঠ ৪', hint: 'চড়া' },
    { sid: 12, name: 'কণ্ঠ ৫', hint: 'খুব চড়া' },
    { sid: 15, name: 'কণ্ঠ ৬', hint: 'মিষ্টি' }
  ];
  var FX = [
    { id: 'normal', name: 'স্বাভাবিক', icon: '🙂', rate: 1.0 },
    { id: 'bird', name: 'ছোট্ট পাখি', icon: '🐤', rate: 1.28 },
    { id: 'giant', name: 'দৈত্য', icon: '👹', rate: 0.78 },
    { id: 'robot', name: 'রোবট', icon: '🤖', rate: 1.0, ring: 55 }
  ];
  var BASE_LEN = 1.08;

  var worker = null, workerState = 'none', workerWait = [], ctx = null, analyser = null, abuf = null;
  var token = 0, speaking = false, curSrc = null, curSeg = null, engine = 'none';
  var cache = new Map(), pending = {}, nextId = 1, lastError = '', initInfo = null;
  var fakeT0 = 0, levelLog = [], debug = false, bnVoice = null;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function unlock() {
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        ctx = new AC();
        analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.2;
        analyser.connect(ctx.destination); abuf = new Float32Array(analyser.fftSize);
      }
      if (ctx.state !== 'running') ctx.resume();
      var b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
    } catch (e) {}
  }

  // ---- Piper worker ----
  function packParts() { return ['model/bn.onnx.part0', 'model/bn.onnx.part1', 'model/bn.onnx.part2', 'model/bn.onnx.part3']; }

  function startWorker() {
    if (workerState === 'loading' || workerState === 'ready') return waitReady();
    workerState = 'loading'; lastError = '';
    return new Promise(function (resolve) {
      workerWait.push(resolve);
      try { worker = new Worker('tts-worker.js'); } catch (e) { fail('worker: ' + e.message); return; }
      worker.onerror = function (e) { fail('worker error: ' + (e.message || 'load')); };
      worker.onmessage = function (e) {
        var m = e.data;
        if (m.type === 'ready') { workerState = 'ready'; engine = 'piper'; initInfo = m; flush(true); }
        else if (m.type === 'audio') { var p = pending[m.id]; if (p) { delete pending[m.id]; p.resolve(m); } }
        else if (m.type === 'error') {
          if (m.where === 'init') fail(m.message);
          else { var q = pending[m.id]; if (q) { delete pending[m.id]; q.reject(new Error(m.message)); } }
        }
      };
      worker.postMessage({ type: 'init', cfgUrl: 'model/bn.onnx.json', parts: packParts() });
    });
  }
  function flush(ok) { var w = workerWait; workerWait = []; w.forEach(function (f) { f(ok); }); }
  function fail(msg) { workerState = 'failed'; lastError = msg; engine = 'browser'; try { worker && worker.terminate(); } catch (e) {} worker = null; flush(false); }
  function waitReady() { if (workerState === 'ready') return Promise.resolve(true); if (workerState === 'failed') return Promise.resolve(false); return new Promise(function (r) { workerWait.push(r); }); }

  function synth(text, sid, lenScale) {
    var key = sid + '|' + lenScale + '|' + text;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: function (m) { var r = { audio: m.audio, sr: m.sampleRate, inferMs: m.inferMs, phonemizeMs: m.phonemizeMs }; cache.set(key, r); if (cache.size > 40) cache.delete(cache.keys().next().value); resolve(r); }, reject: reject };
      worker.postMessage({ type: 'say', id: id, text: text, sid: sid, lengthScale: lenScale });
    });
  }

  function envelope(audio, sr) {
    var step = Math.max(1, Math.round(sr * 0.02)), n = Math.floor(audio.length / step), env = new Float32Array(n);
    for (var i = 0; i < n; i++) { var s = 0; for (var k = i * step; k < (i + 1) * step; k++) s += audio[k] * audio[k]; env[i] = Math.sqrt(s / step); }
    return env;
  }

  function playBuffer(r, o, tk) {
    return new Promise(function (resolve) {
      if (!ctx) { resolve(); return; }
      var fx = FX.filter(function (f) { return f.id === (o.fx || 'normal'); })[0] || FX[0];
      var buf = ctx.createBuffer(1, r.audio.length, r.sr); buf.copyToChannel(r.audio, 0);
      var src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = fx.rate * (o.bed ? 0.96 : 1);
      var gain = ctx.createGain(); gain.gain.value = o.bed ? 0.55 : 1;
      var node = src;
      if (fx.ring) { var rg = ctx.createGain(); rg.gain.value = 0; var osc = ctx.createOscillator(); osc.frequency.value = fx.ring; osc.type = 'sine'; osc.connect(rg.gain); osc.start(); src.connect(rg); node = rg; src.onended = function () { try { osc.stop(); } catch (e) {} }; }
      node.connect(gain); gain.connect(analyser);
      var t0 = ctx.currentTime + 0.03;
      curSeg = { env: r.env || (r.env = envelope(r.audio, r.sr)), t0: t0, rate: src.playbackRate.value, silentFor: 0 };
      curSrc = src;
      var done = false; function fin() { if (done) return; done = true; if (curSrc === src) { curSrc = null; curSeg = null; } resolve(); }
      src.onended = (function (prev) { return function () { try { prev && prev(); } catch (e) {} fin(); }; })(src.onended);
      src.start(t0);
    });
  }

  function normalize(parts) {
    var out = [];
    (Array.isArray(parts) ? parts : [parts]).forEach(function (p) {
      if (p && typeof p === 'object' && p.pause) { out.push({ pause: p.pause }); return; }
      String(p).replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').split(/(?<=[।?!])\s+|\n+/).forEach(function (s) {
        s = s.replace(/\s+/g, ' ').trim(); if (/[\p{L}\p{N}]/u.test(s)) out.push({ text: s });
      });
    });
    return out;
  }

  // parts: string | array of string|{pause:ms}.  opts: {sid, fx, bed, rate, onStart}
  function speak(parts, o) {
    o = o || {}; var tk = ++token; stopAudio(); speaking = true; fakeT0 = performance.now();
    var segs = normalize(parts);
    return (workerState === 'ready' ? Promise.resolve(true) : (isPackReady() ? startWorker() : Promise.resolve(false))).then(function (ok) {
      if (tk !== token) return;
      if (ok) return piperLoop(segs, o, tk); else return browserLoop(segs, o, tk);
    }).catch(function (e) {
      lastError = String(e && e.message || e);
      if (tk === token) return browserLoop(segs, o, tk);
    }).then(function () { if (tk === token) speaking = false; });
  }

  function piperLoop(segs, o, tk) {
    var len = BASE_LEN * (o.rate || 1) * (o.bed ? 1.3 : 1), sid = o.sid || 0, started = false;
    function get(i) { return segs[i] && segs[i].text ? synth(segs[i].text, sid, len) : null; }
    var next = get(0), i = 0;
    function step() {
      if (tk !== token || i >= segs.length) return Promise.resolve();
      var s = segs[i];
      if (s.pause) { i++; next = get(i); return sleep(s.pause).then(step); }
      return next.then(function (r) {
        if (tk !== token) return;
        if (!started) { started = true; o.onStart && o.onStart(); }
        i++; next = get(i);
        if (next) next.catch(function () {});
        return playBuffer(r, o, tk).then(function () { return sleep(o.bed ? 500 : 220); }).then(step);
      });
    }
    return step();
  }

  // ---- browser speechSynthesis fallback ----
  function pickBn() {
    if (!window.speechSynthesis) return null;
    var vs = speechSynthesis.getVoices() || [];
    bnVoice = vs.filter(function (v) { return /^bn/i.test(v.lang); })[0] || null;
    return bnVoice;
  }
  function browserLoop(segs, o, tk) {
    engine = 'browser';
    if (!window.speechSynthesis) { return sleep(Math.min(6000, 600 * segs.length)); }
    pickBn();
    var i = 0, started = false;
    function step() {
      if (tk !== token || i >= segs.length) return Promise.resolve();
      var s = segs[i++];
      if (s.pause) return sleep(s.pause).then(step);
      return new Promise(function (res) {
        var u = new SpeechSynthesisUtterance(s.text); u.lang = 'bn-BD'; if (bnVoice) u.voice = bnVoice;
        u.rate = (o.bed ? 0.75 : 0.95) / (o.rate || 1); u.pitch = o.fx === 'bird' ? 1.6 : o.fx === 'giant' ? 0.5 : 1.1; u.volume = o.bed ? 0.6 : 1;
        var guard = setTimeout(res, 15000 + s.text.length * 250);
        u.onstart = function () { if (!started) { started = true; o.onStart && o.onStart(); } };
        u.onend = u.onerror = function () { clearTimeout(guard); res(); };
        try { speechSynthesis.speak(u); } catch (e) { clearTimeout(guard); res(); }
      }).then(step);
    }
    return step();
  }

  function stopAudio() {
    try { if (curSrc) { curSrc.onended = null; curSrc.stop(); } } catch (e) {}
    curSrc = null; curSeg = null;
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) {}
  }
  function stop() { token++; stopAudio(); speaking = false; }

  // Mouth loudness 0..1
  function level() {
    var v = 0;
    if (!speaking) return 0;
    if (engine === 'piper' && ctx && curSeg) {
      analyser.getFloatTimeDomainData(abuf);
      var s = 0, i; for (i = 0; i < abuf.length; i++) s += abuf[i] * abuf[i];
      var rms = Math.sqrt(s / abuf.length);
      var el = ctx.currentTime - curSeg.t0;
      if (rms > 0.0005) curSeg.silentFor = 0;
      else if (el > 0.4) curSeg.silentFor = el;
      if (curSeg.silentFor > 0.35 && curSeg.env) {                // analyser silent although playing -> use PCM envelope
        var idx = Math.floor(el * curSeg.rate / 0.02); rms = (idx >= 0 && idx < curSeg.env.length) ? curSeg.env[idx] : 0;
      }
      v = Math.min(1, Math.pow(rms / 0.26, 0.9));
    } else if (engine === 'browser') {
      var t = (performance.now() - fakeT0) / 1000;
      v = 0.35 + 0.45 * Math.abs(Math.sin(t * 9.0)) * (0.6 + 0.4 * Math.sin(t * 2.3));
    }
    if (debug) levelLog.push({ t: Math.round(performance.now()), v: +v.toFixed(3), e: engine });
    return v;
  }

  function isPackReady() { try { return localStorage.getItem('tc_pack') === '1'; } catch (e) { return false; } }

  return {
    VOICES: VOICES, FX: FX, unlock: unlock, speak: speak, stop: stop, level: level, startWorker: startWorker,
    isPackReady: isPackReady,
    get speaking() { return speaking; }, get engine() { return engine; }, get state() { return workerState; }, get lastError() { return lastError; }, get info() { return initInfo; },
    get levelLog() { return levelLog; }, set debug(v) { debug = v; if (v) levelLog.length = 0; },
    get ctx() { return ctx; }, hasBnVoice: function () { return !!pickBn(); }, hasSpeechSynthesis: function () { return !!window.speechSynthesis; }
  };
})();
