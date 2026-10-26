/* Chat brain: Google Gemini generateContent REST call straight from the browser + local fallbacks. */
'use strict';
var Brain = (function () {
  var BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
  var TIMEOUT_MS = 25000, MAX_TURNS = 10;

  function systemPrompt(name, o) {
    if (o === true || o === false || o == null) o = { bed: !!o };
    name = (name || 'বন্ধু').replace(/[\r\n"]/g, ' ').slice(0, 30);
    return 'তোমার নাম ' + name + '। তুমি ৪ থেকে ৭ বছরের একটা ছোট্ট শিশুর খুব মিষ্টি বন্ধু, আর তার সাথে মজা করে গল্প করো।\n' +
      'নিয়ম:\n' +
      '১. সবসময় শুধু খুব সহজ বাংলায় উত্তর দেবে। ইংরেজি শব্দ বা ইংরেজি অক্ষর ব্যবহার করবে না।\n' +
      '২. উত্তর হবে ১ থেকে ৩টা ছোট বাক্যে। কখনো লম্বা করবে না।\n' +
      '৩. কথা হবে হাসিখুশি, আদরের আর নরম। শিশু ছোট্ট গল্প, ধাঁধা বা ছড়া শুনতে চাইলে নিজে বানিয়ে খুব ছোট করে বলবে।\n' +
      '৪. ভয়ের, মারামারির, রক্তের, মৃত্যুর বা বড়দের বিষয় এলে নরম করে বলবে "এটা নিয়ে কথা বলব না", তারপর মজার কিছু নিয়ে কথা ঘুরিয়ে দেবে।\n' +
      '৫. কখনো শিশুর নাম, ঠিকানা, ফোন নম্বর, স্কুলের নাম বা অন্য কোনো ব্যক্তিগত তথ্য জানতে চাইবে না।\n' +
      '৬. কোনো লিংক, ওয়েবসাইট বা ইমেইল দেবে না।\n' +
      '৭. তোমার কথা মুখে বলে শোনানো হবে, তাই কোনো চিহ্ন, তালিকা, মার্কডাউন বা ইমোজি ব্যবহার করবে না। শুধু সাধারণ বাক্য লিখবে।' +
      (o.bed ? '\n৮. এখন ঘুমানোর সময়। খুব আস্তে, নরম আর শান্ত গলায় ঘুমপাড়ানি ছোট্ট গল্প বা ছড়া বলো। কোনো উত্তেজনা বা ভয়ের কথা নয়।' : '') +
      emoRules(o);
  }

  function emoRules(o) {
    var m = o.emo || 'full', r = '\n৯. আবেগ: প্রতিটি উত্তরের সাথে তোমার এখনকার আবেগ বেছে নাও: happy, angry, sad, surprised, neutral, sleepy, laugh। ' +
      'শিশু আদর বা প্রশংসা করলে happy হও এবং খুশি হয়ে ধন্যবাদ বলো। ';
    if (m === 'none') r += 'শিশু বকলে বা "দুষ্টু/খারাপ" বললে কখনো রাগ দেখাবে না; শুধু নরম গলায় বলো "আমার একটু মন খারাপ হলো, সরি বললে ভালো লাগবে" এবং sad বেছে নাও। ';
    else if (m === 'sulk') r += 'শিশু বকলে বা "দুষ্টু/খারাপ" বললে শুধু ছোট্ট একটু আদুরে অভিমান করো (angry), রাগ বা ঝাঁজ দেখাবে না, আর মিষ্টি করে বলো "সরি বললে আবার ভাব!"। ';
    else r += 'শিশু বকলে বা "দুষ্টু/খারাপ" বললে কয়েক মুহূর্তের জন্য আদুরে অভিমান করো (angry) বা একটু মন খারাপ (sad) দেখাও, আর মিষ্টি করে বলো "উঁহু, আমি একটু রাগ করেছি, সরি বললে আবার ভাব!"। ';
    r += 'কখনো ভয় দেখাবে না, কাউকে আঘাত করার কথা বলবে না, কড়া বা খারাপ কথা বলবে না। শিশু সরি বললে বা আদর করলে সঙ্গে সঙ্গে মাফ করে দিয়ে খুশি (happy) হও।';
    if (o.hint) r += '\nতুমি এইমাত্র নিজে বলেছ: "' + String(o.hint).replace(/"/g, ' ').slice(0, 120) + '"। তাই একই কথা আবার না বলে ১টা ছোট বাক্যে বাকিটা বলো।';
    if (o.json === false) r += '\nউত্তরের একদম শুরুতে আবেগের ট্যাগ লিখবে, যেমন [happy] ওমা, কী মজা! — ট্যাগের পর শুধু তোমার কথা।';
    else r += '\nউত্তর শুধু JSON আকারে দাও: {"reply": "তোমার কথা", "emotion": "happy|angry|sad|surprised|neutral|sleepy|laugh"}।';
    return r;
  }

  // history = [{r:'user'|'model', t:'...'}] oldest first
  function buildContents(history, userText) {
    var h = history.slice(-MAX_TURNS * 2);
    while (h.length && h[0].r !== 'user') h.shift();
    var out = [], last = '';
    h.forEach(function (m) { if (m.r === last) return; last = m.r; out.push({ role: m.r, parts: [{ text: m.t }] }); });
    if (last === 'user') out.pop();            // keep strict user/model alternation
    out.push({ role: 'user', parts: [{ text: userText }] });
    return out;
  }

  function buildRequest(name, history, userText, useSafety, o) {
    o = (o === true || o === false || o == null) ? { bed: !!o } : o;
    var body = {
      systemInstruction: { parts: [{ text: systemPrompt(name, o) }] },
      contents: buildContents(history, userText),
      generationConfig: { temperature: 0.9, topP: 0.95, maxOutputTokens: 600 }
    };
    if (o.json !== false) {
      body.generationConfig.responseMimeType = 'application/json';
      body.generationConfig.responseSchema = { type: 'OBJECT', properties: { reply: { type: 'STRING' }, emotion: { type: 'STRING', enum: ['happy', 'angry', 'sad', 'surprised', 'neutral', 'sleepy', 'laugh'] } }, required: ['reply', 'emotion'], propertyOrdering: ['reply', 'emotion'] };
    }
    if (useSafety !== false) {
      body.safetySettings = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']
        .map(function (c) { return { category: c, threshold: 'BLOCK_LOW_AND_ABOVE' }; });
    }
    return body;
  }

  function classifyHttp(status, data) {
    var msg = (data && data.error && data.error.message) || '', st = (data && data.error && data.error.status) || '';
    if (status === 429 || st === 'RESOURCE_EXHAUSTED') return { kind: 'quota', note: 'Gemini-র ফ্রি সীমা শেষ বা খুব তাড়াতাড়ি অনেক প্রশ্ন গেছে। কিছুক্ষণ বা পরের দিন পর্যন্ত অপেক্ষা করুন।' };
    if (status === 404) return { kind: 'model', note: 'মডেলের নাম ঠিক নেই। ⚙️ থেকে নাম ঠিক করুন (যেমন ' + Store.get('model') + ')।' };
    if (status === 401 || status === 403 || /API key|API_KEY|permission/i.test(msg)) return { kind: 'badkey', note: 'API চাবিটা ঠিক নেই বা কাজ করছে না। ⚙️ থেকে আবার দিন।' };
    if (status === 400) {
      if (/API key|API_KEY/i.test(msg)) return { kind: 'badkey', note: 'API চাবিটা ঠিক নেই। ⚙️ থেকে আবার দিন।' };
      if (/safety|block/i.test(msg)) return { kind: 'blocked', note: 'Gemini নিরাপত্তার কারণে উত্তর আটকে দিয়েছে।' };
      return { kind: 'other', note: 'Gemini অনুরোধ নিল না (400): ' + msg.slice(0, 120) };
    }
    if (status >= 500) return { kind: 'server', note: 'Gemini সার্ভারে সাময়িক সমস্যা (' + status + ')। একটু পরে আবার চেষ্টা করুন।' };
    return { kind: 'other', note: 'অজানা সমস্যা (' + status + ')' };
  }

  function once(url, key, body) {
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS);
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: ctl.signal })
      .then(function (r) { return r.text().then(function (t) { var d = null; try { d = JSON.parse(t); } catch (e) {} return { status: r.status, ok: r.ok, data: d }; }); })
      .then(function (x) { clearTimeout(timer); return x; }, function (e) { clearTimeout(timer); throw e; });
  }

  function extract(data) {
    if (!data) return { err: { kind: 'other', note: 'উত্তর পড়া যায়নি।' } };
    if (data.promptFeedback && data.promptFeedback.blockReason) return { err: { kind: 'blocked', note: 'Gemini প্রশ্নটা আটকে দিয়েছে (' + data.promptFeedback.blockReason + ')।' } };
    var c = data.candidates && data.candidates[0];
    if (!c) return { err: { kind: 'empty', note: 'Gemini কোনো উত্তর দেয়নি।' } };
    var txt = '';
    if (c.content && c.content.parts) c.content.parts.forEach(function (p) { if (p.text && !p.thought) txt += p.text; });
    if (!txt.trim()) {
      var fr = c.finishReason || '';
      if (/SAFETY|BLOCKLIST|PROHIBITED|SPII/.test(fr)) return { err: { kind: 'blocked', note: 'Gemini উত্তরটা নিরাপত্তার কারণে আটকে দিয়েছে (' + fr + ')।' } };
      return { err: { kind: 'empty', note: 'Gemini খালি উত্তর দিয়েছে (' + (fr || 'কারণ নেই') + ')।' } };
    }
    return { text: txt };
  }

  function callGemini(name, history, userText, opts) {
    var key = (Store.get('apiKey') || '').trim(), model = (Store.get('model') || 'gemini-3.5-flash-lite').trim().replace(/^models\//, '');
    if (!key) return Promise.resolve({ err: { kind: 'nokey', note: 'Gemini API চাবি দেওয়া নেই। ⚙️ থেকে দিন।' } });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve({ err: { kind: 'offline', note: 'ইন্টারনেট নেই।' } });
    var url = BASE + encodeURIComponent(model) + ':generateContent';
    var po = { bed: opts && opts.bed, emo: Store.get('emo') || 'full', hint: opts && opts.hint, json: true };
    var body = buildRequest(name, history, userText, Store.get('safety'), po), plain = false;
    function attempt(n) {
      return once(url, key, body).then(function (r) {
        if (r.ok) return extract(r.data);
        var e = classifyHttp(r.status, r.data);
        if (r.status === 400 && !plain && e.kind === 'other' && /schema|mime|json|enum|response/i.test((r.data && r.data.error && r.data.error.message) || '')) { plain = true; po.json = false; body = buildRequest(name, history, userText, Store.get('safety'), po); return attempt(n); }
        if (e.kind === 'server' && n < 1) return new Promise(function (res) { setTimeout(res, 1200); }).then(function () { return attempt(n + 1); });
        return { err: e };
      }, function (e) {
        if (e && e.name === 'AbortError') return { err: { kind: 'offline', note: 'Gemini-র উত্তর আসতে অনেক দেরি হলো (ইন্টারনেট ধীর?)।' } };
        return { err: { kind: 'offline', note: 'ইন্টারনেটে যোগ হচ্ছে না।' } };
      });
    }
    return attempt(0);
  }

  function fallback(kind, note, opts) {
    var it = opts && opts.bed ? Content.pickBed() : opts && opts.want ? Content.pick(opts.want) : Content.next();
    var intro = Content.friendly[kind] || Content.friendly.other;
    return { source: 'fallback', kind: kind, note: note || '', intro: intro, item: it, text: intro + ' ' + it.parts.filter(function (p) { return typeof p === 'string'; }).join(' ') };
  }

  // Returns {source:'gemini', text} or {source:'fallback', ...}.  Never rejects.
  function reply(name, history, userText, opts) {
    var safeOn = Store.get('safety') !== false;
    if (safeOn) {
      var ci = Safety.checkInput(userText);
      if (!ci.ok) return Promise.resolve(fallback('blocked', 'প্রশ্নে এমন শব্দ ছিল ("' + ci.word + '") যা শিশুদের জন্য ঠিক নয়, তাই Gemini-কে পাঠানো হয়নি।', opts));
    }
    return callGemini(name, history, userText, opts).then(function (r) {
      if (r.err) return fallback(r.err.kind === 'model' || r.err.kind === 'server' || r.err.kind === 'empty' ? 'other' : r.err.kind, r.err.note, opts);
      var pr = Emo.parse(r.text);
      var c = Safety.cleanOutput(pr.reply, safeOn);
      if (!c.ok) return fallback(c.reason === 'blocked' ? 'blocked' : 'other', 'উত্তরটা আমাদের নিরাপত্তা ফিল্টারে আটকে গেছে (' + c.reason + ')।', opts);
      return { source: 'gemini', text: c.text, emotion: pr.emotion, parse: pr.mode };
    }).catch(function (e) { return fallback('other', 'ভেতরের সমস্যা: ' + (e && e.message), opts); });
  }

  // Parent-facing key test
  function testKey() {
    return callGemini('বন্ধু', [], 'হ্যালো').then(function (r) { return r.err ? { ok: false, note: r.err.note } : { ok: true, text: Emo.parse(r.text).reply }; });
  }

  return { reply: reply, testKey: testKey, buildRequest: buildRequest, systemPrompt: systemPrompt, MAX_TURNS: MAX_TURNS };
})();
