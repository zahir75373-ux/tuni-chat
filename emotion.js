/* Emotions: parse the model's emotion tag, detect emotion from the child's Bengali words (local keywords),
   choose a RANDOM variant (never the same twice in a row) + intensity + a short Bengali voice line. */
'use strict';
var Emo = (function () {
  var LIST = ['happy', 'angry', 'sad', 'surprised', 'neutral', 'sleepy', 'laugh'];
  // visual variant ids (implemented in puppet.js). soft = allowed in "only a little sulk" mode
  var VARIANTS = {
    angry: [{ id: 'puffTurn', soft: true }, { id: 'browShake' }, { id: 'stompSteam' }, { id: 'sulkTilt', soft: true }, { id: 'redPulse' }],
    sad: [{ id: 'droop', soft: true }, { id: 'tearSparkle', soft: true }, { id: 'lipWobble', soft: true }, { id: 'sighSway', soft: true }],
    happy: [{ id: 'bounceHearts', soft: true }, { id: 'giggleShake', soft: true }, { id: 'blushTilt', soft: true }, { id: 'sparkleSpin', soft: true }],
    sleepy: [{ id: 'yawn', soft: true }],
    surprised: [{ id: 'surprise', soft: true }],
    laugh: [{ id: 'giggle', soft: true }]
  };
  var LINES = {
    angry1: ['উঁহু, আমি রাগ করেছি! সরি বললে আবার ভাব!', 'হুঁ! আমার একটু অভিমান হয়েছে! সরি বলবে?', 'আমি কিন্তু একটু রাগ করলাম! সরি বললে ভাব!', 'ইশ! এভাবে বললে আমার অভিমান হয়!', 'উঁহু! আমি একটু মুখ ফুলিয়েছি! সরি বলো তো!'],
    angry2: ['উঁহু উঁহু! আমি রাগ করেছি! সরি বললে তবেই ভাব!', 'ফুঁ! আজ আমার অনেক অভিমান! সরি বলো তো!', 'আমার গাল ফুলে গেছে, দেখো! সরি বললে ঠিক হবে!', 'হুম! আমি মুখ ঘুরিয়ে নিলাম! সরি বললে আবার ভাব!', 'আমার না রাগ আর মন খারাপ দুটোই হয়েছে! সরি বলবে?'],
    sad: ['আমার না একটু মন খারাপ হয়ে গেল। সরি বললে ভালো লাগবে।', 'ইশ, আমার কষ্ট লাগছে। একটু আদর করলে ঠিক হয়ে যাবে।', 'আমি একটু দুঃখ পেয়েছি। কিন্তু সরি বললে আবার ভাব!', 'আমার চোখে একটু জল এসেছে। আদর করলে ঠিক হবে।', 'উঁ উঁ, আমার মন খারাপ। সরি বলবে?'],
    happy: ['ওয়াও, আমি কত খুশি!', 'তুমি কত ভালো! আমিও তোমাকে ভালোবাসি!', 'হিহি, আমার খুব আনন্দ হচ্ছে!', 'আমার গাল লাল হয়ে গেল, লজ্জা লাগছে!', 'তুমি আমার সবচেয়ে ভালো বন্ধু!', 'হুররে! কী মজা!'],
    forgive: ['ঠিক আছে, ভাব হয়ে গেল! আমি আর রাগ করিনি!', 'সরি বলেছ, তাই মাফ! এসো খেলি!', 'হিহি, আর রাগ নেই! ভাব ভাব!', 'আচ্ছা আচ্ছা, মাফ করে দিলাম! তুমি লক্ষ্মী!', 'হুররে! আবার ভাব! চলো গল্প করি!']
  };
  var KW = {
    sorry: ['সরি', 'sorry', 'মাফ', 'ক্ষমা', 'আর করব না', 'আর করবো না', 'ভুল হয়ে গেছে', 'ভুল হয়ে গেল'],
    notBad: ['খারাপ না', 'খারাপ নও', 'খারাপ নয়', 'দুষ্টু না', 'দুষ্টু নও', 'দুষ্টু নয়', 'বোকা না', 'বোকা নও'],
    scold: ['ধমক', 'দুষ্টু', 'খারাপ', 'বোকা', 'গাধা', 'পচা', 'বাজে', 'চুপ কর', 'চুপ থাক', 'চুপ', 'রাগ', 'বিরক্ত', 'শয়তান', 'ধুর', 'আড়ি', 'দূর হ', 'কথা বলব না', 'কথা বলবো না', 'ভালো না', 'ভালো নয়', 'ভালো লাগে না', 'ভালোবাসি না', 'ভালো বাসি না', 'জ্বালাতন', 'যাও তো', 'ভাগ'],
    love: ['ভালোবাস', 'ভালো বাস', 'আদর', 'লক্ষ্মী', 'সোনা', 'মিষ্টি', 'সুন্দর', 'চুমু', 'জড়িয়ে', 'থ্যাঙ্ক', 'ধন্যবাদ', 'অনেক ভালো', 'খুব ভালো', 'তুমি ভালো', 'ভালো বন্ধু', 'পছন্দ', 'দারুণ', 'সেরা', 'কিউট', 'cute', 'love'],
    sad: ['মন খারাপ', 'কাঁদ', 'কান্না', 'কষ্ট', 'দুঃখ', 'দুখ'],
    sleepy: ['ঘুম পাচ্ছে', 'ঘুম পাচ্ছে', 'ঘুমাব', 'ঘুমোব', 'ঘুমাবো', 'ঘুমোবো'],
    laugh: ['হা হা', 'হাহা', 'হি হি', 'হিহি', 'হো হো'],
    intens: ['অনেক', 'খুব', 'একদম', 'ভীষণ', 'সবচেয়ে', 'সব সময়', 'সবসময়']
  };
  var recent = [];            // times of recent scolds (ms)
  var last = {}, lastLine = {};

  function norm(s) { return String(s || '').toLowerCase().replace(/[\u200c\u200d]/g, '').replace(/\s+/g, ' '); }
  function hits(t, arr) { var n = 0; arr.forEach(function (k) { if (t.indexOf(k) >= 0) n++; }); return n; }
  function rand(a) { return a[Math.floor(Math.random() * a.length)]; }

  // Child's words -> {emotion:'angry'|'sad'|'happy'|'sleepy'|'laugh'|null, level:1..3, forgive:bool, kind:'scold'|'love'|'sorry'|...}
  function analyze(text, commit) {
    var t = norm(text), now = Date.now(); recent = recent.filter(function (x) { return now - x < 180000; });
    var intens = hits(t, KW.intens) > 0, excl = (String(text).match(/!|！/g) || []).length;
    if (hits(t, KW.sorry)) { if (commit !== false) recent = []; return { emotion: 'happy', level: 1 + (intens ? 1 : 0), forgive: true, kind: 'sorry' }; }
    var tt = t; KW.notBad.forEach(function (k) { tt = tt.split(k).join(' '); });
    var notBadHit = tt !== t; var sadHit = tt.indexOf('মন খারাপ') >= 0; tt = tt.split('মন খারাপ').join(' ');
    var sc = hits(tt, KW.scold) - ((tt.indexOf('চুপ কর') >= 0 || tt.indexOf('চুপ থাক') >= 0) ? 1 : 0);   // "চুপ" substring counted twice
    if (sc > 0 && !notBadHit) {
      var score = (sc - 1) + (excl >= 2 ? 1 : 0) + (recent.length ? 1 : 0) + (intens ? 1 : 0);
      var level = 1 + Math.min(2, score); if (commit !== false) recent.push(now);
      return { emotion: 'angry', level: level, forgive: false, kind: 'scold' };
    }
    var lv = hits(tt, KW.love) + (notBadHit ? 1 : 0);
    if (lv > 0) return { emotion: 'happy', level: Math.min(3, 1 + (lv > 1 ? 1 : 0) + (intens || excl >= 2 ? 1 : 0)), forgive: false, kind: 'love' };
    if (sadHit || hits(t, KW.sad)) return { emotion: 'sad', level: 1, forgive: false, kind: 'sadword' };
    if (hits(t, KW.sleepy)) return { emotion: 'sleepy', level: 1, forgive: false, kind: 'sleepy' };
    if (hits(t, KW.laugh)) return { emotion: 'laugh', level: 1, forgive: false, kind: 'laugh' };
    return { emotion: null, level: 0, forgive: false, kind: null };
  }

  function mode() { var m = Store.get('emo'); return m === 'sulk' || m === 'none' ? m : 'full'; }

  function fresh(pool, key) { var c = pool.filter(function (x) { return x !== lastLine[key]; }); var v = rand(c.length ? c : pool); lastLine[key] = v; return v; }

  // Pick a variant (random, never same twice in a row) with intensity. Returns null when the emotion is switched off.
  function choose(emotion, level, opts) {
    opts = opts || {}; var m = opts.mode || mode(); level = level || 1;
    if (!emotion || emotion === 'neutral') return null;
    var origin = emotion;
    if (emotion === 'angry') {
      if (m === 'none') return null;
      if (m === 'full' && level >= 3 && Math.random() < 0.4) emotion = 'sad';       // very strong scold: sometimes just sad
      if (m === 'sulk') level = 1;
    }
    var vs = VARIANTS[emotion]; if (!vs) return null;
    if (emotion === 'angry') {
      if (m === 'sulk') vs = vs.filter(function (v) { return v.soft; });
      else if (level === 1) vs = vs.filter(function (v) { return v.soft || Math.random() < 0.35; });   // mild scold -> mostly small sulk
      if (!vs.length) vs = VARIANTS.angry.filter(function (v) { return v.soft; });
    }
    var cand = vs.filter(function (v) { return v.id !== last[emotion]; }); if (!cand.length) cand = vs;
    var v = rand(cand); last[emotion] = v.id;
    var I = ({ 1: 0.62, 2: 0.88, 3: 1.15 })[Math.min(3, Math.max(1, level))] + (Math.random() - 0.5) * 0.16;
    var line = null;
    if (opts.line !== false) {
      if (emotion === 'angry') line = fresh(level >= 2 ? LINES.angry2 : LINES.angry1, 'angry' + (level >= 2 ? 2 : 1));
      else if (emotion === 'sad') line = fresh(LINES.sad, 'sad');
      else if (emotion === 'happy') line = fresh(opts.forgive ? LINES.forgive : LINES.happy, opts.forgive ? 'forgive' : 'happy');
    }
    var base = emotion === 'angry' ? 3.4 : emotion === 'sad' ? 3.8 : 3.0;
    return { emotion: emotion, requested: origin, variant: v.id, soft: m === 'sulk' && emotion === 'angry', intensity: I, level: level, line: line, dur: base * (0.8 + 0.4 * I) };
  }

  // Model output -> {reply, emotion|null}.  Accepts JSON {reply,emotion}, a leading [tag], or plain text.
  function validEmo(e) { e = String(e || '').toLowerCase().trim(); return LIST.indexOf(e) >= 0 ? e : null; }
  function parse(raw) {
    var s = String(raw || '').trim(), o = null;
    var f = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (f.charAt(0) === '{') {
      try { o = JSON.parse(f); } catch (e) { o = null; }
      if (o && typeof o.reply === 'string') return { reply: o.reply.trim(), emotion: validEmo(o.emotion), mode: 'json' };
      var m = f.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (m) { var r; try { r = JSON.parse('"' + m[1] + '"'); } catch (e) { r = m[1]; } var em = f.match(/"emotion"\s*:\s*"([a-zA-Z]+)"/); return { reply: String(r).trim(), emotion: validEmo(em && em[1]), mode: 'json-partial' }; }
    }
    var t = s.match(/^\s*[\[\(<{]\s*([a-zA-Z]+)\s*[\]\)>}]\s*[:\-–]?\s*([\s\S]*)$/);
    if (t && validEmo(t[1])) return { reply: t[2].trim(), emotion: validEmo(t[1]), mode: 'tag' };
    return { reply: s, emotion: null, mode: 'plain' };
  }

  function reset() { recent = []; last = {}; lastLine = {}; }
  return { LIST: LIST, VARIANTS: VARIANTS, LINES: LINES, analyze: analyze, choose: choose, parse: parse, mode: mode, reset: reset, get last() { return last; } };
})();
