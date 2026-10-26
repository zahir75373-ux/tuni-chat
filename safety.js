/* Local second safety layer: Bengali/English blocklist, output cleaning, length cap. */
'use strict';
var Safety = (function () {
  // Words that start with these stems (whole token) are blocked. Short words need an exact match.
  var STEMS = ['খুন', 'হত্যা', 'রক্ত', 'আত্মহত্যা', 'ধর্ষণ', 'যৌন', 'সেক্স', 'নগ্ন', 'উলঙ্গ', 'পর্ন', 'অশ্লীল', 'বন্দুক', 'বোমা', 'ছুরি', 'মৃত্যু', 'লাশ', 'ভূত', 'প্রেত', 'পিশাচ', 'মদ্যপ', 'ড্রাগ', 'গাঁজা', 'সিগারেট', 'জুয়া', 'ধূমপান',
    'হারামজাদা', 'শুয়োর', 'চুদ', 'মাগি', 'বেশ্যা', 'হারামি', 'কুত্তার', 'বাস্টার্ড',
    'sex', 'porn', 'kill', 'murder', 'suicide', 'gun', 'drug', 'fuck', 'shit', 'bitch', 'nude', 'naked', 'blood'];
  var EXACT = ['মদ', 'গুলি', 'মারো', 'মার', 'শালা', 'কুত্তা', 'বোকাচোদা', 'গালি'];
  var SPLIT = /[\s,।?!.\-"'“”‘’()\[\]:;…/\\|]+/;

  function hit(text) {
    var toks = String(text || '').toLowerCase().split(SPLIT), i, j;
    for (i = 0; i < toks.length; i++) {
      var t = toks[i]; if (!t) continue;
      if (EXACT.indexOf(t) >= 0) return t;
      for (j = 0; j < STEMS.length; j++) if (t.indexOf(STEMS[j]) === 0) return STEMS[j];
    }
    return null;
  }

  function checkInput(text) { var h = hit(text); return { ok: !h, word: h }; }

  function stripEmoji(s) {
    return s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}]/gu, '');
  }

  // Text -> text that is safe to show and speak. Returns {ok, text, reason}
  function cleanOutput(raw, enabled) {
    var s = String(raw == null ? '' : raw);
    s = s.replace(/https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/gi, ' ');   // no links / emails
    s = s.replace(/[*_`#>~\[\]{}|\\]/g, ' ');                       // markdown
    s = stripEmoji(s).replace(/\s+/g, ' ').trim();
    if (!s) return { ok: false, reason: 'empty' };
    var letters = s.replace(/[^\p{L}]/gu, ''), latin = letters.replace(/[^A-Za-z]/g, '');
    if (letters.length && latin.length / letters.length > 0.3) return { ok: false, reason: 'notbengali' };
    if (enabled !== false) { var h = hit(s); if (h) return { ok: false, reason: 'blocked', word: h }; }
    if (/\d{6,}/.test(s.replace(/[০-৯]/g, function (c) { return String(c.charCodeAt(0) - 2534); }))) return { ok: false, reason: 'number' };
    return { ok: true, text: cap(s) };
  }

  // Max 3 sentences and ~260 characters.
  function cap(s) {
    var parts = s.match(/[^।?!.]+[।?!.]*/g) || [s];
    var out = '', n = 0;
    for (var i = 0; i < parts.length && n < 3; i++) {
      var p = parts[i].trim(); if (!p) continue;
      if ((out + ' ' + p).trim().length > 260 && n > 0) break;
      out = (out + ' ' + p).trim(); n++;
    }
    if (out.length > 280) { out = out.slice(0, 280); var k = Math.max(out.lastIndexOf(' '), out.lastIndexOf(',')); if (k > 100) out = out.slice(0, k); }
    if (!/[।?!.]$/.test(out)) out += '।';
    return out;
  }

  return { checkInput: checkInput, cleanOutput: cleanOutput, hit: hit, cap: cap };
})();
