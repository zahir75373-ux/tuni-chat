/* Voice in: Web Speech API (Chrome Android, online), Bengali bn-BD, hold-to-talk. */
'use strict';
var Stt = (function () {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var rec = null, text = '', active = false, cb = null, gotError = null;

  function errorText(code) {
    switch (code) {
      case 'not-allowed': case 'service-not-allowed': return 'মাইক চালু নেই। ক্রোমের ঠিকানার পাশের 🔒 চিহ্নে চেপে "মাইক্রোফোন" অনুমতি দিন (Allow), তারপর আবার চেষ্টা করুন।';
      case 'no-speech': return 'কিছু শুনতে পাইনি। মাইক বোতাম ধরে রেখে একটু জোরে বলুন।';
      case 'audio-capture': return 'মাইক পাওয়া যাচ্ছে না। অন্য কোনো অ্যাপ মাইক ব্যবহার করছে কিনা দেখুন।';
      case 'network': return 'কথা বোঝার জন্য ইন্টারনেট লাগে। ইন্টারনেট ঠিক আছে কিনা দেখুন।';
      case 'language-not-supported': return 'এই ফোনে বাংলা কথা বোঝার সুবিধা নেই। নিচের লেখার ঘর ব্যবহার করুন।';
      case 'aborted': return '';
      default: return 'কথা বুঝতে সমস্যা হলো (' + code + ')। লেখার ঘর ব্যবহার করতে পারেন।';
    }
  }

  function start(callbacks) {
    cb = callbacks || {}; text = ''; gotError = null;
    if (!SR) { cb.onError && cb.onError('unsupported', 'এই ব্রাউজারে মাইক দিয়ে কথা বোঝা যায় না। ফোনে Google Chrome ব্যবহার করুন, অথবা নিচের লেখার ঘরে লিখুন।'); return false; }
    try {
      rec = new SR(); rec.lang = 'bn-BD'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      rec.onstart = function () { active = true; cb.onStart && cb.onStart(); };
      rec.onresult = function (e) {
        var t = '', fin = false;
        for (var i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) fin = true; }
        text = t; cb.onInterim && cb.onInterim(t, fin);
      };
      rec.onerror = function (e) { gotError = e.error; var m = errorText(e.error); if (m) cb.onError && cb.onError(e.error, m); };
      rec.onend = function () { active = false; var t = text.trim(); cb.onEnd && cb.onEnd(t, gotError); };
      rec.start();
      return true;
    } catch (e) { cb.onError && cb.onError('start', 'মাইক চালু করা গেল না। আবার চেষ্টা করুন।'); return false; }
  }
  function stop() { try { rec && rec.stop(); } catch (e) {} }
  function abort() { try { rec && rec.abort(); } catch (e) {} }
  return { supported: !!SR, start: start, stop: stop, abort: abort, errorText: errorText, get active() { return active; } };
})();
