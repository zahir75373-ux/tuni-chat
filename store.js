/* Settings (localStorage) + characters (IndexedDB) + per-character chat history. */
'use strict';
var Store = (function () {
  var DB = 'tuni-chat', VER = 1, db = null;
  var DEFAULTS = { apiKey: '', model: 'gemini-3.5-flash-lite', safety: true, rate: 1, lastChar: '' };

  function get(k) {
    try { var v = localStorage.getItem('tc_' + k); if (v === null) return DEFAULTS[k]; return JSON.parse(v); } catch (e) { return DEFAULTS[k]; }
  }
  function set(k, v) { try { localStorage.setItem('tc_' + k, JSON.stringify(v)); } catch (e) {} }

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(DB, VER);
      rq.onupgradeneeded = function () { var d = rq.result; if (!d.objectStoreNames.contains('chars')) d.createObjectStore('chars', { keyPath: 'id' }); };
      rq.onsuccess = function () { db = rq.result; res(db); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function tx(mode, fn) {
    return open().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction('chars', mode), s = t.objectStore('chars'), r = fn(s);
        t.oncomplete = function () { res(r && r.result); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  function allChars() { return tx('readonly', function (s) { return s.getAll(); }).then(function (a) { a = a || []; a.sort(function (x, y) { return (x.created || 0) - (y.created || 0); }); return a; }); }
  function getChar(id) { return tx('readonly', function (s) { return s.get(id); }); }
  function putChar(c) { if (!c.created) c.created = Date.now(); return tx('readwrite', function (s) { return s.put(c); }).then(function () { return c; }); }
  function delChar(id) { try { localStorage.removeItem('tc_hist_' + id); } catch (e) {} return tx('readwrite', function (s) { return s.delete(id); }); }
  function newId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function history(id) { try { return JSON.parse(localStorage.getItem('tc_hist_' + id) || '[]'); } catch (e) { return []; } }
  function saveHistory(id, h) { try { localStorage.setItem('tc_hist_' + id, JSON.stringify(h.slice(-20))); } catch (e) {} }
  function clearHistory(id) { try { localStorage.removeItem('tc_hist_' + id); } catch (e) {} }
  function clearAllHistory() { Object.keys(localStorage).filter(function (k) { return k.indexOf('tc_hist_') === 0; }).forEach(function (k) { localStorage.removeItem(k); }); }

  return { get: get, set: set, allChars: allChars, getChar: getChar, putChar: putChar, delChar: delChar, newId: newId,
    history: history, saveHistory: saveHistory, clearHistory: clearHistory, clearAllHistory: clearAllHistory };
})();
