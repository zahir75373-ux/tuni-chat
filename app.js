/* Tuni-Chat main app: screens, characters, chat flow, extras. */
'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var BN = '০১২৩৪৫৬৭৮৯';
  function bn(n) { return String(n).replace(/\d/g, function (d) { return BN[d]; }); }
  function unbn(s) { return String(s).replace(/[০-৯]/g, function (d) { return BN.indexOf(d); }); }
  function rand(a) { return a[Math.floor(Math.random() * a.length)]; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var SCREENS = ['home', 'chat', 'editor', 'settings'];
  var cur = null, state = 'idle', turn = 0, bed = false, screen = 'home';
  var puppet, edPuppet, charCache = {}, thumbUrls = [], lastReactAudio = 0, noteTimer = 0, tapSkip = false;
  var PACK_SIZE_TEXT = '১১০ MB';

  var PHRASES = {
    tap: ['ওমা!', 'উফ!', 'আরে!'],
    giggle: ['হিহিহি!', 'সুড়সুড়ি!', 'হি হি, টোকা দিলে কেন?'],
    dizzy: ['আরে দাঁড়াও! আমার মাথা ঘুরছে!', 'হিহিহি! আরে আরে আরে!'],
    tickle: ['সুড়সুড়ি! হিহিহি!', 'হা হা হা! সুড়সুড়ি লাগছে!'],
    stretch: ['উইইই! কী মজা!', 'ওয়াও! লম্বা হয়ে গেলাম!']
  };
  var QUICK = {
    story: { t: 'আমাকে একটা ছোট্ট মজার গল্প বলো।', want: 'গল্প' },
    riddle: { t: 'আমাকে একটা সহজ ধাঁধা বলো।', want: 'ধাঁধা' },
    rhyme: { t: 'আমাকে একটা মজার ছড়া শোনাও।', want: 'ছড়া' },
    song: { t: 'আমাকে একটা ছড়ার মতো সুর করে গান শোনাও।', want: 'ছড়া' }
  };

  // ---------- helpers ----------
  function toast(msg, ms) { var t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, ms || 2800); }
  function showOverlay(node) { var c = $('ovCard'); c.innerHTML = ''; if (typeof node === 'string') c.innerHTML = node; else c.appendChild(node); $('overlay').hidden = false; return c; }
  function hideOverlay() { $('overlay').hidden = true; $('ovCard').innerHTML = ''; }
  function ask(msg, yes, no) {
    return new Promise(function (res) {
      var c = showOverlay('<div>' + msg + '</div><button class="big danger" id="ovYes"></button><button class="big" id="ovNo"></button>');
      $('ovYes').textContent = yes || 'হ্যাঁ'; $('ovNo').textContent = no || 'না';
      $('ovYes').onclick = function () { hideOverlay(); res(true); }; $('ovNo').onclick = function () { hideOverlay(); res(false); };
    });
  }
  function setStatus(s) { state = s; var m = { idle: 'ধরে রেখে বলো 🎤', listening: 'শুনছি…', thinking: 'ভাবছি…', speaking: 'বলছি…', react: 'হিহি…' }; $('status').textContent = m[s] || ''; if (puppet) puppet.state = s === 'react' ? 'idle' : s; $('btnMic').classList.toggle('rec', s === 'listening'); }
  function setCaption(t, cls) { $('caption').textContent = t || ''; $('caption').scrollTop = 0; }
  function parentNote(t) { var n = $('parentNote'); clearTimeout(noteTimer); if (!t) { n.hidden = true; return; } n.textContent = '👨‍👩‍👧 অভিভাবকের জন্য: ' + t; n.hidden = false; noteTimer = setTimeout(function () { n.hidden = true; }, 14000); }

  // ---------- navigation ----------
  function show(name) {
    if (name === 'chat' && !cur) name = 'home';
    var leaving = screen; screen = name;
    SCREENS.forEach(function (s) { $(s).hidden = s !== name; });
    if (leaving === 'chat' && name !== 'chat') { leaveChat(); }
    if (leaving === 'editor' && name !== 'editor') { edPuppet.stop(); Tts.stop(); }
    if (name === 'home') renderHome();
    if (name === 'settings') renderSettings();
    if (name === 'chat') enterChat();
    if (name === 'editor') { edPuppet.start(); edPuppet.resize(); }
  }
  function go(name) { history.pushState({ s: name }, ''); show(name); }
  function back() { if (history.state && history.state.s && history.state.s !== 'home') history.back(); else show('home'); }
  window.addEventListener('popstate', function (e) { show((e.state && e.state.s) || 'home'); });

  // ---------- characters ----------
  function toonThumb(id) { toonThumb.c = toonThumb.c || {}; if (!toonThumb.c[id]) toonThumb.c[id] = Cartoons.make(id).canvas.toDataURL('image/jpeg', 0.8); return toonThumb.c[id]; }
  function thumbOf(c) { if (c.kind === 'cartoon') return toonThumb(c.cartoon); var u = URL.createObjectURL(c.blob); thumbUrls.push(u); return u; }
  function loadChar(c) {
    if (charCache[c.id]) return Promise.resolve(charCache[c.id]);
    if (c.kind === 'cartoon') {
      var d = Cartoons.make(c.cartoon); var r = { canvas: d.canvas, mouth: c.mouth || d.mouth, eyes: d.eyes, skin: d.skin }; charCache[c.id] = r; return Promise.resolve(r);
    }
    return bitmapOf(c.blob).then(function (bmp) {
      var cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; cv.getContext('2d').drawImage(bmp, 0, 0);
      var r = { canvas: cv, mouth: c.mouth, eyes: c.eyes || [], skin: null }; charCache[c.id] = r; return r;
    });
  }
  function bitmapOf(blob) {
    if (window.createImageBitmap) return createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(blob); });
    return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = URL.createObjectURL(blob); });
  }
  function downsize(file) {
    return bitmapOf(file).then(function (bmp) {
      var s = Math.min(1, 1024 / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
      return new Promise(function (res) { cv.toBlob(function (b) { res({ canvas: cv, blob: b }); }, 'image/jpeg', 0.86); });
    });
  }
  function seed() {
    return Store.allChars().then(function (a) {
      if (a.length || Store.get('seeded')) return;
      var defs = [['bear', 'ভালু', 9, 'calm'], ['cat', 'মিনি', 15, 'sway'], ['bunny', 'তুলতুল', 3, 'bounce']];
      return defs.reduce(function (p, d, i) {
        return p.then(function () { var t = Cartoons.make(d[0]); return Store.putChar({ id: Store.newId(), name: d[1], kind: 'cartoon', cartoon: d[0], mouth: t.mouth, voice: d[2], fx: 'normal', motion: d[3], created: Date.now() + i }); });
      }, Promise.resolve()).then(function () { Store.set('seeded', true); });
    });
  }

  // ---------- home ----------
  function renderHome() {
    thumbUrls.forEach(function (u) { URL.revokeObjectURL(u); }); thumbUrls = [];
    var b = $('banners'); b.innerHTML = '';
    function banner(html, btn, fn) { var d = document.createElement('div'); d.className = 'banner'; d.innerHTML = html; if (btn) { var x = document.createElement('button'); x.className = 'big alt'; x.textContent = btn; x.onclick = fn; d.appendChild(x); } b.appendChild(d); }
    if (overLimit()) banner('🌙 আজকের খেলার সময় শেষ। কাল আবার খেলা হবে!');
    if (!Store.get('apiKey')) banner('👨‍👩‍👧 অভিভাবকের জন্য: চ্যাটে উত্তর পেতে ⚙️ থেকে Gemini চাবি দিন। চাবি না দিলে বন্ধুরা শুধু ছড়া-গল্প শোনাবে।');
    if (!Tts.isPackReady()) banner('🔊 ভালো বাংলা কণ্ঠের জন্য একবার ডাউনলোড করুন (প্রায় ' + PACK_SIZE_TEXT + ', ওয়াইফাইয়ে ভালো)।', '⬇️ ভয়েস ডাউনলোড', startDownload);
    Store.allChars().then(function (chars) {
      var g = $('grid'); g.innerHTML = '';
      chars.forEach(function (c) {
        var t = document.createElement('button'); t.className = 'tile'; t.dataset.id = c.id;
        var im = document.createElement('img'); im.alt = ''; im.src = thumbOf(c); var sp = document.createElement('span'); sp.textContent = c.name;
        t.appendChild(im); t.appendChild(sp); g.appendChild(t);
        var timer = 0, fired = false;
        t.addEventListener('pointerdown', function () { fired = false; timer = setTimeout(function () { fired = true; openEditor(c.id); }, 700); });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { t.addEventListener(ev, function () { clearTimeout(timer); }); });
        t.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        t.addEventListener('click', function () { if (fired) { fired = false; return; } openChat(c.id); });
      });
      var n = document.createElement('button'); n.className = 'tile new'; n.id = 'tileNew'; n.innerHTML = '<div class="plus">＋</div><span>নতুন বন্ধু</span>';
      n.onclick = function () { openEditor(null); }; g.appendChild(n);
    });
  }

  // ---------- usage timer ----------
  function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function usedSec() { try { var u = JSON.parse(localStorage.getItem('tc_used') || 'null'); return u && u.d === today() ? u.s : 0; } catch (e) { return 0; } }
  function setUsed(s) { localStorage.setItem('tc_used', JSON.stringify({ d: today(), s: Math.max(0, s) })); }
  function limitMin() { return parseInt(Store.get('limit') || 0, 10) || 0; }
  function overLimit() { var l = limitMin(); return l > 0 && usedSec() >= l * 60; }
  function timeUp() {
    if (screen === 'chat') { Tts.stop(); Stt.abort(); turn++; setStatus('idle'); }
    var c = showOverlay('<div class="moon">🌙</div><div><b>আজকের খেলা শেষ!</b><br>কাল আবার দেখা হবে। টা-টা!</div><button class="big ok" id="tuOk">ঠিক আছে</button><button class="big" id="tuParent" style="background:#888">👨‍👩‍👧 অভিভাবক</button>');
    $('tuOk').onclick = function () { hideOverlay(); show('home'); history.replaceState({ s: 'home' }, ''); };
    $('tuParent').onclick = parentGate;
  }
  function parentGate() {
    var a = 11 + Math.floor(Math.random() * 28), b = 11 + Math.floor(Math.random() * 28);
    showOverlay('<div>অভিভাবকের জন্য: এই যোগটা করুন</div><div style="font-size:30px;font-weight:700">' + bn(a) + ' + ' + bn(b) + ' = ?</div><input id="gateIn" type="text" inputmode="numeric" autocomplete="off"><button class="big ok" id="gateOk">খুলুন (আরও ১৫ মিনিট)</button><button class="big" id="gateNo" style="background:#888">বাতিল</button>');
    $('gateOk').onclick = function () {
      if (parseInt(unbn($('gateIn').value), 10) === a + b) { setUsed(Math.max(0, limitMin() * 60 - 900)); hideOverlay(); toast('আরও ১৫ মিনিট খেলা যাবে'); if (screen === 'home') renderHome(); }
      else { $('gateIn').value = ''; $('gateIn').placeholder = 'ভুল, আবার চেষ্টা'; }
    };
    $('gateNo').onclick = timeUp;
  }
  setInterval(function () {
    if (screen === 'chat' && !document.hidden && limitMin() > 0) { setUsed(usedSec() + 5); if (overLimit() && $('overlay').hidden) timeUp(); }
  }, 5000);

  // ---------- pack download ----------
  function startDownload() {
    var c = showOverlay('<div><b>ভয়েস ডাউনলোড হচ্ছে</b><br><small id="dlTxt">শুরু হচ্ছে…</small></div><div class="bar2"><i id="dlBar"></i></div><div class="note">অ্যাপ খোলা রাখুন। ওয়াইফাই ভালো।</div><button class="big" id="dlLater" style="background:#888">বন্ধ করুন</button>');
    var abort = false; $('dlLater').onclick = function () { abort = true; hideOverlay(); };
    downloadPack(function (done, total) {
      var p = total ? done / total : 0; var bar = $('dlBar'), tx = $('dlTxt'); if (!bar) return;
      bar.style.width = Math.round(p * 100) + '%'; tx.textContent = bn(Math.round(done / 1048576)) + ' / ' + bn(Math.round(total / 1048576)) + ' MB (' + bn(Math.round(p * 100)) + '%)';
    }, function () { return abort; }).then(function () {
      if (abort) return; hideOverlay(); toast('✅ ভয়েস তৈরি! এখন ইন্টারনেট ছাড়াও কথা বলবে।'); Tts.startWorker().catch(function () {}); if (screen === 'home') renderHome(); if (screen === 'settings') renderSettings();
    }, function (e) {
      if (abort) return;
      showOverlay('<div>😟 ডাউনলোড শেষ হলো না।<br><small>' + (e && e.message || '') + '</small><br>ইন্টারনেট ঠিক থাকলে আবার চেষ্টা করুন। যতটুকু নামানো হয়েছে তা জমা আছে।</div><button class="big ok" id="dlRetry">আবার চেষ্টা</button><button class="big" id="dlX" style="background:#888">পরে</button>');
      $('dlRetry').onclick = startDownload; $('dlX').onclick = hideOverlay;
    });
  }
  function downloadPack(onProgress, aborted) {
    var cache;
    return fetch('pack.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('pack.json'); return r.json(); }).then(function (info) {
      return caches.open('tuni-chat-model-v1').then(function (c) {
        cache = c; var total = info.total, done = 0, files = info.files;
        onProgress(0, total);
        return files.reduce(function (p, f) {
          return p.then(function () {
            if (aborted()) throw new Error('বন্ধ করা হয়েছে');
            var url = new URL(f.url, location.href).href;
            return cache.match(url).then(function (hit) {
              if (hit) { done += f.size; onProgress(done, total); return; }
              return fetch(url).then(function (r) {
                if (!r.ok) throw new Error('ফাইল পাওয়া যায়নি: ' + f.url);
                var rd = r.body.getReader(), chunks = [];
                function pump() { return rd.read().then(function (x) { if (x.done) return; chunks.push(x.value); done += x.value.length; onProgress(Math.min(done, total), total); if (aborted()) { rd.cancel(); throw new Error('বন্ধ করা হয়েছে'); } return pump(); }); }
                return pump().then(function () { return cache.put(url, new Response(new Blob(chunks), { headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream' } })); });
              });
            });
          });
        }, Promise.resolve());
      }).then(function () { try { localStorage.setItem('tc_pack', '1'); } catch (e) {} });
    });
  }
  function verifyPack() {
    if (!Tts.isPackReady() || !window.caches) return Promise.resolve();
    return caches.open('tuni-chat-model-v1').then(function (c) { return c.match(new URL('model/bn.onnx.part3', location.href).href); }).then(function (h) { if (!h) localStorage.removeItem('tc_pack'); }).catch(function () {});
  }

  // ---------- chat ----------
  function enterChat() {
    $('chatName').textContent = cur.name; setCaption(''); parentNote(''); setStatus('idle'); bed = false; $('chat').classList.remove('bed'); $('btnBed').classList.remove('on'); $('textrow').hidden = true;
    puppet.reactionsOn = Store.get('react') !== false; puppet.motion = cur.motion || 'calm';
    loadChar(cur).then(function (ch) {
      puppet.setCharacter(ch); puppet.resize(); updateInsets(); puppet.start();
    });
    if (Tts.isPackReady()) Tts.startWorker().catch(function () {}); else toast('ভালো কণ্ঠের জন্য হোম পেজ থেকে ভয়েস ডাউনলোড করুন', 4000);
  }
  function updateInsets() { var bt = $('chat').querySelector('.bottom'); puppet.setInsets(70, bt ? bt.offsetHeight : 300); }
  function leaveChat() { Tts.stop(); Stt.abort(); turn++; puppet.stop(); setStatus('idle'); bed = false; $('chat').classList.remove('bed'); }
  function openChat(id) {
    if (overLimit()) { timeUp(); return; }
    Store.getChar(id).then(function (c) { if (!c) return; cur = c; Store.set('lastChar', id); go('chat'); });
  }
  function speakOpts(extra) { var o = { sid: cur.voice, fx: cur.fx || 'normal', bed: bed, rate: parseFloat(Store.get('rate')) || 1 }; for (var k in extra) o[k] = extra[k]; return o; }

  function estSec(t) { return Math.min(9, 1.2 + String(t || '').length * 0.07); }
  function handleText(text, opts) {
    opts = opts || {}; text = (text || '').trim(); if (!text || !cur) return Promise.resolve();
    var my = ++turn; Tts.stop(); Tts.unlock(); parentNote('');
    setCaption('🗣 ' + text); setStatus('thinking');
    // instant, local reaction to the child's words (face reacts while Gemini thinks)
    var an = Emo.analyze(text), plan = null, lineP = Promise.resolve();
    if (an.emotion) {
      plan = Emo.choose(an.emotion, an.level, { forgive: an.forgive, line: an.emotion === 'angry' || an.emotion === 'sad' || an.emotion === 'happy' });
      if (plan) {
        puppet.playEmotion(plan, plan.line ? estSec(plan.line) + 1.5 : 0);
        if (plan.line) { setStatus('speaking'); setCaption(plan.line); lineP = Tts.speak(plan.line, speakOpts({ onStart: function () { browserTip(); } })).catch(function () { }); }
      }
    }
    var hist = Store.history(cur.id).slice(-Brain.MAX_TURNS * 2);
    var brainP = Brain.reply(cur.name, hist, text, { bed: bed, want: opts.want, hint: plan && plan.line });
    return Promise.all([brainP, lineP]).then(function (res) {
      var r = res[0]; if (my !== turn) return;
      if (r.source === 'gemini') { var h = Store.history(cur.id); h.push({ r: 'user', t: text }, { r: 'model', t: r.text }); Store.saveHistory(cur.id, h); }
      parentNote(r.source === 'fallback' ? r.note : '');
      if (r.source === 'fallback' && plan && plan.line) { setStatus('idle'); return; }     // offline: the emotional line was the answer
      if (r.source === 'gemini') {
        var me = r.emotion && r.emotion !== 'neutral' ? r.emotion : null;
        if (me && (!plan || (me !== plan.requested && me !== plan.emotion))) { var p2 = Emo.choose(me, an.level || 1, { line: false }); if (p2) puppet.playEmotion(p2, estSec(r.text)); }
        else if (plan) puppet.extendEmotion(estSec(r.text));
      }
      setCaption(r.text); setStatus('speaking');
      var parts = r.source === 'gemini' ? [r.text] : [r.intro].concat(r.item.parts);
      if (/হি\s?হি|হা\s?হা|হো\s?হো/.test(r.text)) { puppet.burst('heart', 3); puppet.burst('spark', 5); }
      return Tts.speak(parts, speakOpts({ onStart: function () { browserTip(); } })).then(function () { if (my === turn) setStatus('idle'); });
    }).catch(function () { if (my === turn) setStatus('idle'); });
  }

  var tipShown = false;
  function browserTip() {
    if (Tts.engine !== 'browser' || tipShown) return; tipShown = true;
    parentNote(Tts.isPackReady() ? 'ভালো কণ্ঠ চালু করা যায়নি, তাই ফোনের সাধারণ কণ্ঠ ব্যবহার হচ্ছে।' : 'ভালো বাংলা কণ্ঠ এখনো ডাউনলোড হয়নি, তাই ফোনের সাধারণ কণ্ঠ বাজছে (ফোনে বাংলা কণ্ঠ না থাকলে শব্দ নাও আসতে পারে)। হোম পেজ থেকে ⬇️ ভয়েস ডাউনলোড করুন।');
  }
  // mic (hold to talk)
  function micDown(e) {
    e.preventDefault(); if (!cur || !overlayClosed()) return; Tts.unlock(); Tts.stop(); turn++; var my = turn; parentNote('');
    try { $('btnMic').setPointerCapture(e.pointerId); } catch (x) { }
    setStatus('listening'); setCaption('শুনছি… বলো!');
    var ok = Stt.start({
      onInterim: function (t) { if (my === turn) setCaption('🗣 ' + t); },
      onError: function (code, msg) { if (my === turn) { parentNote(msg); } },
      onEnd: function (t, err) {
        if (my !== turn) return;
        if (t) { handleText(t); return; }
        if (err) { setStatus('idle'); setCaption('আবার চেষ্টা করো, না হলে ⌨️ চেপে লেখো।'); return; }
        setCaption(Content.friendly.nospeech); setStatus('speaking'); var m2 = ++turn;
        Tts.speak(Content.friendly.nospeech, speakOpts({})).then(function () { if (m2 === turn) setStatus('idle'); });
      }
    });
    if (!ok) setStatus('idle');
  }
  function micUp() { if (state === 'listening') Stt.stop(); }
  function overlayClosed() { return $('overlay').hidden; }

  function stopSpeaking() { turn++; Tts.stop(); Stt.abort(); setStatus('idle'); }

  // poke reactions: audio only when idle (never cut off a real reply)
  function onPoke(kind) {
    if (Store.get('react') === false) return;
    if (state !== 'idle' && state !== 'react') return;
    var now = Date.now(); if (now - lastReactAudio < 1300) return; lastReactAudio = now;
    var ph = rand(PHRASES[kind] || PHRASES.tap); var my = ++turn;
    Tts.unlock(); setStatus('react'); setCaption(ph);
    Tts.speak(ph, speakOpts({})).then(function () { if (my === turn && state === 'react') { setStatus('idle'); } });
  }

  function toggleBed() {
    bed = !bed; $('chat').classList.toggle('bed', bed); $('btnBed').classList.toggle('on', bed);
    puppet.motion = bed ? 'calm' : (cur.motion || 'calm');
    if (bed) { toast('🌙 ঘুমপাড়ানি চালু: আস্তে আস্তে বলবে', 2500); handleText('আমাকে একটা ঘুমপাড়ানি ছোট্ট গল্প বা ছড়া শোনাও।', { want: 'ছড়া' }); }
    else { toast('ঘুমপাড়ানি বন্ধ', 1500); }
  }

  // ---------- editor ----------
  var ed = null;
  function defaultMouth() { return { x: 0.5, y: 0.68, w: 0.2, chin: 0.85 }; }
  function openEditor(id) {
    var p = id ? Store.getChar(id) : Promise.resolve(null);
    p.then(function (c) {
      var t = Cartoons.make('bear');
      ed = c ? { id: c.id, created: c.created, kind: c.kind, cartoon: c.cartoon, blob: c.blob, mouth: Object.assign({}, c.mouth), eyes: c.eyes || [], name: c.name, voice: c.voice, fx: c.fx || 'normal', motion: c.motion || 'calm' }
        : { id: null, kind: 'cartoon', cartoon: 'bear', blob: null, mouth: Object.assign({}, t.mouth), eyes: t.eyes, name: '', voice: 9, fx: 'normal', motion: 'calm' };
      $('edTitle').textContent = c ? 'বন্ধুকে বদলাও' : 'নতুন বন্ধু'; $('edName').value = ed.name; $('edDel').hidden = !c; $('edToons').hidden = true; $('edMsg').textContent = '';
      go('editor'); edRefreshAll();
      var pr = c ? loadChar(c) : Promise.resolve({ canvas: t.canvas, mouth: t.mouth, eyes: t.eyes, skin: t.skin });
      pr.then(function (ch) { ed.canvas = ch.canvas; ed.skin = ch.skin; edShow(ch.mouth, ch.eyes, ch.skin); });
    });
  }
  function edShow(mouth, eyes, skin) {
    ed.mouth = { x: mouth.x, y: mouth.y, w: mouth.w, chin: mouth.chin }; ed.eyes = eyes || [];
    edPuppet.setCharacter({ canvas: ed.canvas, mouth: ed.mouth, eyes: ed.eyes, skin: skin || null }); edPuppet.editMarker = true; edPuppet.motion = ed.motion; edPuppet.resize();
    edSyncSliders();
  }
  function edSyncSliders() { $('edW').value = Math.round(ed.mouth.w * 100); $('edJ').value = Math.round(((ed.mouth.chin - ed.mouth.y) / Math.max(0.01, ed.mouth.w)) * 10); }
  function edApplyMouth() { edPuppet.setMouth(ed.mouth); }
  function edRefreshAll() {
    var v = $('edVoices'); v.innerHTML = '';
    Tts.VOICES.forEach(function (x) {
      var d = document.createElement('div'); d.className = 'voice' + (ed.voice === x.sid ? ' on' : ''); d.dataset.sid = x.sid;
      var s = document.createElement('button'); s.className = 'sel'; s.innerHTML = x.name + '<small>' + x.hint + '</small>'; s.onclick = function () { ed.voice = x.sid; edRefreshAll(); };
      var p = document.createElement('button'); p.className = 'play'; p.textContent = '▶ শুনি'; p.onclick = function () { ed.voice = x.sid; edRefreshAll(); edSpeak(x.sid); };
      d.appendChild(s); d.appendChild(p); v.appendChild(d);
    });
    var f = $('edFx'); f.innerHTML = '';
    Tts.FX.forEach(function (x) { var b = document.createElement('button'); b.className = 'chip' + (ed.fx === x.id ? ' on' : ''); b.textContent = x.icon + ' ' + x.name; b.onclick = function () { ed.fx = x.id; edRefreshAll(); edSpeak(ed.voice); }; f.appendChild(b); });
    var m = $('edMotions'); m.innerHTML = '';
    Puppet.MOTIONS.forEach(function (x) { var b = document.createElement('button'); b.className = 'chip' + (ed.motion === x.id ? ' on' : ''); b.textContent = x.icon + ' ' + x.name; b.onclick = function () { ed.motion = x.id; edPuppet.motion = x.id; edRefreshAll(); edTestMotion(); }; m.appendChild(b); });
    var pn = $('edPackNote'); pn.hidden = Tts.isPackReady(); pn.textContent = 'এখন ফোনের সাধারণ কণ্ঠ বাজছে। ভালো ১৬টি কণ্ঠ পেতে হোম পেজ থেকে ভয়েস ডাউনলোড করুন।';
  }
  function edSpeak(sid) {
    Tts.unlock(); var nm = ($('edName').value || '').trim(); edPuppet.state = 'speaking';
    var tx = nm ? 'হ্যালো! আমি ' + nm + '। চলো গল্প করি!' : 'হ্যালো! আমি তোমার নতুন বন্ধু। চলো গল্প করি!';
    Tts.speak(tx, { sid: sid, fx: ed.fx, rate: 1 }).then(function () { edPuppet.state = 'idle'; });
  }
  function edTestMotion() {
    var t0 = performance.now(); edPuppet.levelFn = function () { var t = (performance.now() - t0) / 1000; if (t > 2.6) { edPuppet.levelFn = Tts.level; edPuppet.state = 'idle'; return 0; } return 0.45 + 0.4 * Math.sin(t * 11) * Math.sin(t * 3.1); };
    edPuppet.state = 'speaking';
  }
  function edPick(file) {
    if (!file) return; $('edMsg').textContent = 'ছবি তৈরি হচ্ছে…';
    downsize(file).then(function (r) {
      ed.kind = 'photo'; ed.cartoon = null; ed.blob = r.blob; ed.canvas = r.canvas; ed.eyes = []; ed.skin = null;
      edShow(defaultMouth(), [], null); $('edMsg').textContent = 'মুখ খুঁজছি…'; return edAuto(true);
    }).catch(function () { $('edMsg').textContent = 'ছবিটা খোলা গেল না। অন্য ছবি দিন।'; });
  }
  function edAuto(first) {
    if (ed.kind === 'cartoon') { var t = Cartoons.make(ed.cartoon); ed.canvas = t.canvas; edShow(t.mouth, t.eyes, t.skin); $('edMsg').textContent = 'কার্টুনের মুখ ঠিক করা আছে।'; return Promise.resolve(); }
    return Face.find(ed.canvas).then(function (r) {
      if (r) { edShow(r.mouth, r.eyes, null); $('edMsg').textContent = '✅ মুখ পেয়েছি! ঠিক না হলে লাল দাগের জায়গায় আঙুল ছুঁয়ে দেখান।'; }
      else { $('edMsg').textContent = '😕 ছবিতে মুখ খুঁজে পাইনি। ছবিতে মুখের ওপর আঙুল ছুঁয়ে জায়গা দেখান, আর নিচের স্লাইডার ঠিক করুন।'; }
    }, function () { $('edMsg').textContent = 'মুখ নিজে খোঁজা গেল না (প্রথমবার অ্যাপ ডাউনলোড লাগে)। ছবিতে মুখের ওপর আঙুল ছুঁয়ে জায়গা দেখান।'; });
  }
  function edSave() {
    var name = $('edName').value.trim(); if (!name) { $('edName').focus(); toast('আগে বন্ধুর একটা নাম লিখুন'); return; }
    if (ed.kind === 'photo' && !ed.blob) { toast('একটা ছবি দিন'); return; }
    var rec = { id: ed.id || Store.newId(), created: ed.created, name: name, kind: ed.kind, cartoon: ed.cartoon, blob: ed.kind === 'photo' ? ed.blob : null, mouth: ed.mouth, eyes: ed.kind === 'photo' ? ed.eyes : null, voice: ed.voice, fx: ed.fx, motion: ed.motion };
    Store.putChar(rec).then(function () {
      delete charCache[rec.id]; if (cur && cur.id === rec.id) cur = rec; toast('✅ সেভ হয়েছে');
      if (history.state && history.state.s === 'editor') history.back(); else show('home');
    }, function () { toast('সেভ করা গেল না (জায়গা কম?)'); });
  }
  function edDelete() {
    ask('সত্যিই <b>' + (ed.name || 'এই বন্ধুকে') + '</b>-কে মুছে ফেলবেন?', '🗑️ হ্যাঁ, মুছুন', 'না').then(function (y) {
      if (!y) return; Store.delChar(ed.id).then(function () { delete charCache[ed.id]; if (cur && cur.id === ed.id) cur = null; toast('মুছে ফেলা হয়েছে'); if (history.state && history.state.s === 'editor') history.back(); else show('home'); });
    });
  }

  // ---------- settings ----------
  function renderSettings() {
    $('stKey').value = Store.get('apiKey') || ''; $('stModel').value = Store.get('model'); $('stSafety').checked = Store.get('safety') !== false; $('stReact').checked = Store.get('react') !== false;
    $('stRate').value = String(Store.get('rate') || 1); $('stEmo').value = Store.get('emo') || 'full'; $('stLimit').value = String(limitMin()); $('stResult').textContent = '';
    $('stUsed').textContent = limitMin() ? 'আজ খেলেছে: ' + bn(Math.floor(usedSec() / 60)) + ' মিনিট / সীমা ' + bn(limitMin()) + ' মিনিট' : 'আজ খেলেছে: ' + bn(Math.floor(usedSec() / 60)) + ' মিনিট';
    var ready = Tts.isPackReady(); $('stPack').textContent = ready ? '✅ ভয়েস ডাউনলোড করা আছে — ইন্টারনেট ছাড়াই কথা বলবে।' : 'ভয়েস এখনো ডাউনলোড হয়নি (প্রায় ' + PACK_SIZE_TEXT + '). ডাউনলোড না করলে ফোনের সাধারণ কণ্ঠ (সীমিত) বাজবে।'; $('stDl').hidden = ready;
    Store.allChars().then(function (chars) {
      var box = $('stChars'); box.innerHTML = '';
      chars.forEach(function (c) {
        var r = document.createElement('div'); r.className = 'charrow'; var b = document.createElement('b'); b.textContent = c.name; r.appendChild(b);
        var e = document.createElement('button'); e.textContent = '✏️ বদলাও'; e.onclick = function () { openEditor(c.id); };
        var h = document.createElement('button'); h.textContent = '🧹 ইতিহাস'; h.title = 'ইতিহাস মুছুন'; h.onclick = function () { Store.clearHistory(c.id); toast(c.name + '-এর ইতিহাস মুছে গেছে'); };
        r.appendChild(e); r.appendChild(h); box.appendChild(r);
      });
    });
  }
  function stSave() { Store.set('apiKey', $('stKey').value.trim()); Store.set('model', $('stModel').value.trim() || 'gemini-3.5-flash-lite'); Store.set('safety', $('stSafety').checked); Store.set('react', $('stReact').checked); Store.set('rate', parseFloat($('stRate').value)); Store.set('emo', $('stEmo').value); Store.set('limit', parseInt($('stLimit').value, 10)); toast('✅ সেভ হয়েছে'); renderSettings(); }

  // ---------- wiring ----------
  function wire() {
    $('btnSettings').onclick = function () { go('settings'); };
    $('stBack').onclick = function () { stSave(); back(); };
    $('stSave').onclick = stSave;
    $('stShow').onclick = function () { var k = $('stKey'); k.type = k.type === 'password' ? 'text' : 'password'; };
    ['stSafety', 'stReact', 'stEmo', 'stRate', 'stLimit'].forEach(function (id) { $(id).addEventListener('change', stSave); });
    $('stTest').onclick = function () { stSave(); $('stResult').textContent = 'পরীক্ষা হচ্ছে…'; Brain.testKey().then(function (r) { $('stResult').textContent = r.ok ? '✅ ঠিক আছে! উত্তর: ' + r.text : '❌ ' + r.note; }); };
    $('stDl').onclick = startDownload;
    $('stClearAll').onclick = function () { ask('সব বন্ধুর কথার ইতিহাস মুছে ফেলবেন?', 'হ্যাঁ, মুছুন', 'না').then(function (y) { if (y) { Store.clearAllHistory(); toast('সব ইতিহাস মুছে গেছে'); } }); };

    $('btnBack').onclick = back; $('btnEdit').onclick = function () { if (cur) openEditor(cur.id); };
    $('btnStop').onclick = stopSpeaking;
    $('btnKbd').onclick = function () { var r = $('textrow'); r.hidden = !r.hidden; updateInsets(); if (!r.hidden) $('txt').focus(); };
    function sendTxt() { var t = $('txt').value; $('txt').value = ''; $('txt').blur(); handleText(t); }
    $('btnSend').onclick = sendTxt; $('txt').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendTxt(); });
    $('quick').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.id === 'btnBed') { toggleBed(); return; }
      var q = QUICK[b.dataset.q]; if (q) handleText(q.t, { want: q.want });
    });
    var mic = $('btnMic'); mic.addEventListener('pointerdown', micDown); ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) { mic.addEventListener(ev, micUp); }); mic.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    $('edBack').onclick = back; $('edSave').onclick = edSave; $('edDel').onclick = edDelete;
    $('edCam').onclick = function () { $('fileCam').click(); }; $('edGal').onclick = function () { $('fileGal').click(); };
    $('fileCam').onchange = function () { edPick(this.files[0]); this.value = ''; }; $('fileGal').onchange = function () { edPick(this.files[0]); this.value = ''; };
    $('edToon').onclick = function () {
      var b = $('edToons'); b.hidden = false; b.innerHTML = '';
      Cartoons.list().forEach(function (x) { var c = document.createElement('button'); c.className = 'chip' + (ed.kind === 'cartoon' && ed.cartoon === x.id ? ' on' : ''); c.textContent = x.icon + ' ' + x.name; c.onclick = function () { ed.kind = 'cartoon'; ed.cartoon = x.id; ed.blob = null; var t = Cartoons.make(x.id); ed.canvas = t.canvas; edShow(t.mouth, t.eyes, t.skin); $('edMsg').textContent = ''; $('edToon').click(); }; b.appendChild(c); });
    };
    $('edAuto').onclick = function () { $('edMsg').textContent = 'মুখ খুঁজছি…'; edAuto(); };
    $('edTest').onclick = edTestMotion;
    $('edW').oninput = function () { var w = $('edW').value / 100, r = $('edJ').value / 10; ed.mouth.w = w; ed.mouth.chin = Math.min(0.99, ed.mouth.y + w * r); edApplyMouth(); };
    $('edJ').oninput = function () { var r = $('edJ').value / 10; ed.mouth.chin = Math.min(0.99, ed.mouth.y + ed.mouth.w * r); edApplyMouth(); };
    var edcv = $('edCv'), dragging = false;
    function edMove(e) { var n = edPuppet.eventToNorm(e), r = $('edJ').value / 10; ed.mouth.x = n.x; ed.mouth.y = n.y; ed.mouth.chin = Math.min(0.99, n.y + ed.mouth.w * r); edApplyMouth(); }
    edcv.addEventListener('pointerdown', function (e) { dragging = true; try { edcv.setPointerCapture(e.pointerId); } catch (x) { } edMove(e); });
    edcv.addEventListener('pointermove', function (e) { if (dragging) edMove(e); });
    edcv.addEventListener('pointerup', function () { dragging = false; }); edcv.addEventListener('pointercancel', function () { dragging = false; });

    window.addEventListener('resize', function () { if (screen === 'chat') { puppet.resize(); updateInsets(); } if (screen === 'editor') edPuppet.resize(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && screen === 'chat') { Tts.stop(); Stt.abort(); turn++; setStatus('idle'); } });
  }

  // ---------- boot ----------
  function boot() {
    puppet = new Puppet($('cv')); puppet.levelFn = Tts.level; puppet.onReact = onPoke;
    edPuppet = new Puppet($('edCv')); edPuppet.levelFn = Tts.level; edPuppet.reactionsOn = false;
    wire();
    history.replaceState({ s: 'home' }, '');
    verifyPack().then(seed).then(function () { show('home'); });
    if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(function () { }); }
    window.TC = { get state() { return state; }, get cur() { return cur; }, get bed() { return bed; }, puppet: puppet, edPuppet: edPuppet, handleText: handleText, openChat: openChat, go: go, show: show, usedSec: usedSec, setUsed: setUsed, timeUp: timeUp, downloadPack: downloadPack, get screen() { return screen; }, onPoke: onPoke, get turn() { return turn; } };
  }
  boot();
})();
