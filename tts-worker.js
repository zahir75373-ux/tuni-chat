/* Piper Bengali TTS worker: espeak-ng phonemizer (wasm) + onnxruntime-web (wasm). */
'use strict';
importScripts('vendor/ort/ort.wasm.min.js', 'vendor/piper/piper_phonemize.js');

var session = null, cfg = null;
ort.env.wasm.numThreads = 1;          // GitHub Pages cannot send COOP/COEP headers -> no threads
ort.env.wasm.simd = true;
ort.env.wasm.wasmPaths = new URL('vendor/ort/', self.location.href).href;
ort.env.logLevel = 'error';

function post(m, tr) { self.postMessage(m, tr || []); }

async function readCached(urls) {
  var buffers = [], total = 0, i;
  var cache = await caches.open('tuni-chat-model-v1');
  for (i = 0; i < urls.length; i++) {
    var abs = new URL(urls[i], self.location.href).href;
    var r = await cache.match(abs);
    if (!r) r = await fetch(abs);
    if (!r.ok) throw new Error('model part ' + urls[i] + ' ' + r.status);
    var b = await r.arrayBuffer();
    buffers.push(b); total += b.byteLength;
  }
  var out = new Uint8Array(total), off = 0;
  for (i = 0; i < buffers.length; i++) { out.set(new Uint8Array(buffers[i]), off); off += buffers[i].byteLength; buffers[i] = null; }
  return out;
}

async function init(msg) {
  var t0 = performance.now();
  cfg = await (await fetch(msg.cfgUrl)).json();
  post({ type: 'status', text: 'model-read' });
  var bytes = await readCached(msg.parts);
  post({ type: 'status', text: 'session' });
  session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  bytes = null;
  post({ type: 'ready', ms: Math.round(performance.now() - t0), sampleRate: cfg.audio.sample_rate, speakers: cfg.num_speakers });
}

function phonemize(text) {
  return new Promise(function (resolve, reject) {
    var result = null, errs = [];
    createPiperPhonemize({
      print: function (d) { try { var j = JSON.parse(d); if (j && j.phoneme_ids) result = j; } catch (e) {} },
      printErr: function (d) { errs.push(String(d)); },
      locateFile: function (u) { return 'vendor/piper/' + u; }
    }).then(function (mod) {
      try {
        mod.callMain(['-l', (cfg.espeak && cfg.espeak.voice) || 'bn', '--input', JSON.stringify([{ text: text }]), '--espeak_data', '/espeak-ng-data']);
      } catch (e) { /* emscripten ExitStatus is normal */ }
      if (result) resolve(result.phoneme_ids); else reject(new Error('phonemize failed: ' + errs.slice(-3).join(' | ')));
    }, reject);
  });
}

function peakNormalize(a, target) {
  var m = 0.01, i;
  for (i = 0; i < a.length; i++) { var v = Math.abs(a[i]); if (v > m) m = v; }
  var g = target / m;
  for (i = 0; i < a.length; i++) a[i] *= g;
  return a;
}

async function say(msg) {
  var t0 = performance.now();
  var ids = await phonemize(msg.text);
  var t1 = performance.now();
  var n = ids.length;
  var inf = cfg.inference || {};
  var feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, function (x) { return BigInt(x); }), [1, n]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(n)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale || 0.667, msg.lengthScale || inf.length_scale || 1.0, inf.noise_w || 0.8]), [3])
  };
  if (cfg.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(msg.sid || 0)]), [1]);
  var out = await session.run(feeds);
  var key = Object.keys(out)[0];
  var audio = peakNormalize(Float32Array.from(out[key].data), 0.9);
  var t2 = performance.now();
  post({ type: 'audio', id: msg.id, audio: audio, sampleRate: cfg.audio.sample_rate, phonemizeMs: Math.round(t1 - t0), inferMs: Math.round(t2 - t1), ids: n }, [audio.buffer]);
}

self.onmessage = function (e) {
  var m = e.data;
  var p = m.type === 'init' ? init(m) : m.type === 'say' ? say(m) : null;
  if (p) p.catch(function (err) { post({ type: 'error', id: m.id, where: m.type, message: String(err && err.message || err) }); });
};
