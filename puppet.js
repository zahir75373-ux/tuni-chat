/* Talking photo: 2D canvas puppet (no AI). Mouth/jaw driven by audio loudness, motion styles, blink, touch reactions with spring warp. */
'use strict';
var Puppet = (function () {
  var MOTIONS = [
    { id: 'calm', name: 'শান্ত নাড়ানো', icon: '😌' },
    { id: 'sway', name: 'মাথা দোলানো', icon: '🥰' },
    { id: 'bounce', name: 'হাসিখুশি লাফানো', icon: '🤩' },
    { id: 'wiggle', name: 'দুষ্টু ঝাঁকুনি', icon: '😜' },
    { id: 'nod', name: 'হ্যাঁ হ্যাঁ নাড়ানো', icon: '🙂' },
    { id: 'still', name: 'স্থির', icon: '😶' }
  ];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

  function drawStar(g, x, y, r, rot, col) {
    g.save(); g.translate(x, y); g.rotate(rot); g.beginPath();
    for (var i = 0; i < 10; i++) { var a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    g.closePath(); g.fillStyle = col || '#ffd43b'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#f08c00'; g.stroke(); g.restore();
  }
  function drawHeart(g, x, y, r, col) {
    g.save(); g.translate(x, y); g.beginPath();
    g.moveTo(0, r * 0.35); g.bezierCurveTo(-r * 1.2, -r * 0.5, -r * 0.4, -r * 1.2, 0, -r * 0.4);
    g.bezierCurveTo(r * 0.4, -r * 1.2, r * 1.2, -r * 0.5, 0, r * 0.35); g.closePath();
    g.fillStyle = col || '#ff6b8b'; g.fill(); g.restore();
  }
  function drawSpark(g, x, y, r, a) {
    g.save(); g.translate(x, y); g.globalAlpha = a; g.beginPath();
    for (var i = 0; i < 8; i++) { var an = i * Math.PI / 4, rr = i % 2 ? r * 0.25 : r; g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); }
    g.closePath(); g.fillStyle = '#fff6b0'; g.fill(); g.restore();
  }

  function P(canvas) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    this.src = null; this.face = null; this.bg = null; this.mp = null; this.eyes = []; this.skin = '#d9a07a';
    this.W = 0; this.H = 0; this.dpr = 1; this.insets = { top: 0, bottom: 0 }; this.fit = { s: 1, ox: 0, oy: 0 };
    this.motion = 'calm'; this.state = 'idle'; this.levelFn = function () { return 0; };
    this.open = 0; this.t = 0; this.last = 0; this.running = false; this.frames = 0;
    this.nextBlink = 1.5; this.blinkT = -1; this.tiltTarget = 0; this.tilt = 0; this.nextTilt = 4; this.speakMix = 0; this.lean = 0;
    // spring warp
    this.warp = { cx: 0, cy: 0, ox: 0, oy: 0, vx: 0, vy: 0, tx: 0, ty: 0, s: 0, vs: 0, ts: 0, active: false, R: 200 };
    this.react = null; this.particles = []; this.shakeT = 0; this.reactionsOn = true; this.editMarker = false;
    this.onReact = null; this.pt = null; this.taps = []; this.emo = null; this._acc = { steam: 0, heart: 0, spark: 0 }; this._tmp = null; this.emoLog = [];
    this.stats = { maxOpen: 0, reactions: 0 };
    var self = this; this._loop = function (ts) { self.frame(ts); };
    this._bind();
  }
  P.MOTIONS = MOTIONS;

  P.prototype.setCharacter = function (ch) {
    this.src = ch.canvas; var Sw = this.Sw = ch.canvas.width, Sh = this.Sh = ch.canvas.height;
    var m = ch.mouth; this.mp = { x: m.x * Sw, y: m.y * Sh, w: Math.max(12, m.w * Sw), chin: m.chin * Sh };
    this.mp.chin = Math.max(this.mp.chin, this.mp.y + this.mp.w * 0.6);
    this.eyes = (ch.eyes || []).map(function (e) { return { x: e.x * Sw, y: e.y * Sh, w: e.w * Sw, h: e.h * Sh }; });
    this.skin = ch.skin || this._sampleSkin();
    this.face = mkCanvas(Sw, Sh); this._prepJaw(); this.warp.R = 0.26 * Math.min(Sw, Sh);
    this.warp.ox = this.warp.oy = this.warp.s = 0; this.particles = []; this.react = null; this.emo = null; this._lipCol = null;
    this._layout(); this._buildBg();
  };
  P.prototype.setMouth = function (m) {
    if (!this.src) return; var Sw = this.Sw, Sh = this.Sh;
    this.mp = { x: m.x * Sw, y: m.y * Sh, w: Math.max(12, m.w * Sw), chin: m.chin * Sh };
    this.mp.chin = Math.max(this.mp.chin, this.mp.y + this.mp.w * 0.6); this._prepJaw(); this._lipCol = null;
  };
  P.prototype.setEyes = function (eyes) { var Sw = this.Sw, Sh = this.Sh; this.eyes = (eyes || []).map(function (e) { return { x: e.x * Sw, y: e.y * Sh, w: e.w * Sw, h: e.h * Sh }; }); this.skin = this._sampleSkin(); };
  P.prototype.getMouth = function () { var m = this.mp; return { x: m.x / this.Sw, y: m.y / this.Sh, w: m.w / this.Sw, chin: m.chin / this.Sh }; };

  P.prototype._sampleSkin = function () {
    try {
      var e = this.eyes[0], x, y; if (e) { x = e.x; y = e.y - e.h * 1.8; } else { x = this.mp.x; y = this.mp.y - this.mp.w * 0.9; }
      x = clamp(Math.round(x) - 3, 0, this.Sw - 6); y = clamp(Math.round(y) - 3, 0, this.Sh - 6);
      var d = this.src.getContext('2d').getImageData(x, y, 6, 6).data, r = 0, g = 0, b = 0, n = d.length / 4;
      for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      return 'rgb(' + Math.round(r / n) + ',' + Math.round(g / n) + ',' + Math.round(b / n) + ')';
    } catch (e) { return '#d9a07a'; }
  };

  P.prototype._prepJaw = function () {
    var mp = this.mp, Sw = this.Sw, Sh = this.Sh;
    var sx = Math.max(0, mp.x - mp.w * 0.9), ex = Math.min(Sw, mp.x + mp.w * 0.9);
    var sy = Math.max(0, mp.y - mp.w * 0.05), ey = Math.min(Sh, mp.chin + mp.w * 0.2);
    var w = Math.max(4, Math.round(ex - sx)), h = Math.max(4, Math.round(ey - sy));
    var patch = mkCanvas(w, h), pg = patch.getContext('2d');
    pg.drawImage(this.src, sx, sy, w, h, 0, 0, w, h);
    var mask = mkCanvas(w, h), mg = mask.getContext('2d');
    mg.fillStyle = '#fff'; mg.fillRect(0, 0, w, h); mg.globalCompositeOperation = 'destination-out';
    function grad(x0, y0, x1, y1, rx, ry, rw, rh) { var gr = mg.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)'); mg.fillStyle = gr; mg.fillRect(rx, ry, rw, rh); }
    var fw = w * 0.24; grad(fw, 0, 0, 0, 0, 0, fw, h); grad(w - fw, 0, w, 0, w - fw, 0, fw, h);
    var fb = h * 0.35; grad(0, h - fb, 0, h, 0, h - fb, w, fb);
    var ft = h * 0.08; grad(0, ft, 0, 0, 0, 0, w, ft);
    pg.globalCompositeOperation = 'destination-in'; pg.drawImage(mask, 0, 0);
    this.jaw = { c: patch, x: sx, y: sy };
  };

  // ---- layout ----
  P.prototype.resize = function () {
    var r = this.cv.getBoundingClientRect(); var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === this.W && h === this.H && dpr === this.dpr) return;
    this.W = w; this.H = h; this.dpr = dpr; this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this._layout(); this._buildBg();
  };
  P.prototype._layout = function () {
    if (!this.src || !this.W) return;
    var W = this.W, H = this.H, top = this.insets.top, availH = Math.max(50, H - top - this.insets.bottom);
    var cover = Math.max(W / this.Sw, H / this.Sh), contain = Math.min(W / this.Sw, availH / this.Sh);
    var s = Math.min(cover, contain * (this.insets.bottom || this.insets.top ? 1.35 : 1));
    var ox = (W - this.Sw * s) / 2, oy = top + (availH - this.Sh * s) / 2;
    if (this.Sw * s > W) { var mx = this.mp.x * s; ox = clamp(ox, W * 0.5 - mx - W * 0.2, W * 0.5 - mx + W * 0.2); ox = clamp(ox, W - this.Sw * s, 0); }
    this.fit = { s: s, ox: ox, oy: oy };
  };
  P.prototype.setInsets = function (top, bottom) { this.insets = { top: top, bottom: bottom }; this._layout(); this._buildBg(); };
  P.prototype._buildBg = function () {
    if (!this.src || !this.W) return;
    var bg = mkCanvas(this.W, this.H), g = bg.getContext('2d'), s = Math.max(this.W / this.Sw, this.H / this.Sh) * 1.1;
    try { g.filter = 'blur(14px)'; } catch (e) {}
    g.drawImage(this.src, (this.W - this.Sw * s) / 2, (this.H - this.Sh * s) / 2, this.Sw * s, this.Sh * s);
    g.filter = 'none'; g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, 0, this.W, this.H);
    this.bg = bg;
  };

  // ---- reactions ----
  P.prototype.playReaction = function (kind, x, y) {
    if (!this.reactionsOn) return;
    var t = this.t; this.stats.reactions++;
    if (x != null) { this.warp.cx = x; this.warp.cy = y; }
    var R = { kind: kind, t0: t, dur: 1.0, mouth: 'O', wide: 1.3 };
    if (kind === 'surprise') { R.dur = 0.95; this.warp.vs += 5; }
    else if (kind === 'giggle') { R.dur = 1.1; R.mouth = 'laugh'; R.wide = 1; this.warp.vs += 3.5; this._hearts(2); }
    else if (kind === 'dizzy') { R.dur = 2.2; R.mouth = 'laugh'; R.wide = 1; this.warp.vs += 3; }
    else if (kind === 'tickle') { R.dur = 99; R.mouth = 'laugh'; R.wide = 1; this.tickling = true; }
    else if (kind === 'stretch') { R.dur = 1.0; this._sparks(5); }
    this.react = R;
  };
  P.prototype.endReaction = function (kind) { if (this.react && this.react.kind === kind) { this.react.dur = (this.t - this.react.t0) + 0.35; } this.tickling = false; };
  P.prototype._hearts = function (n) {
    for (var i = 0; i < n; i++) this.particles.push({ type: 'heart', x: this._sx(this.mp.x) + (Math.random() - 0.5) * 120, y: this._sy(this.mp.y) - 60 - Math.random() * 50, vx: (Math.random() - 0.5) * 30, vy: -50 - Math.random() * 30, life: 0, max: 1.6, r: 11 + Math.random() * 7 });
  };
  P.prototype._sparks = function (n) {
    for (var i = 0; i < n; i++) this.particles.push({ type: 'spark', x: this._sx(this.mp.x) + (Math.random() - 0.5) * 220, y: this._sy(this.mp.y) - 40 - Math.random() * 160, vx: 0, vy: -10, life: 0, max: 1.0 + Math.random() * 0.5, r: 10 + Math.random() * 8 });
  };
  P.prototype.burst = function (kind, n) { if (kind === 'heart') this._hearts(n || 4); else this._sparks(n || 6); };
  P.prototype._sx = function (ix) { return this.fit.ox + ix * this.fit.s; };
  P.prototype._sy = function (iy) { return this.fit.oy + iy * this.fit.s; };


  // ---- emotions (variants chosen by Emo.choose; each variant is a different animated pose) ----
  var VAR = {
    // angry / sulky
    puffTurn: function (t, I, p, d) { p.puff = 0.95 * I; p.sx = 1 - 0.07 * I; p.dx = 0.02 * I * d; p.rot = 0.06 * I * d; p.squint = 0.3 * I; p.brow = 0.35 * I; p.smile = -0.6 * I; },
    browShake: function (t, I, p, d) { var sh = Math.max(0, 1 - t / 1.6); p.brow = 1 * I; p.puff = 0.3 * I; p.tint = 0.3 * I; p.dx = Math.sin(t * 19) * 0.012 * I * sh; p.rot = Math.sin(t * 17) * 0.04 * I * sh; p.smile = -0.7 * I; p.squint = 0.2; },
    stompSteam: function (t, I, p, d) { var s = Math.abs(Math.sin(t * 6.2)); p.dy = -s * 0.03 * I; p.sy = 1 - 0.03 * (1 - s) * I; p.sx = 1 + 0.02 * (1 - s) * I; p.puff = 0.5 * I; p.brow = 0.85 * I; p.tint = 0.28 * I; p.steam = 7 * I; p.smile = -0.6 * I; },
    sulkTilt: function (t, I, p, d) { p.rot = 0.11 * I * d; p.dx = 0.015 * I * d; p.squint = 0.5 * I; p.brow = 0.3 * I; p.smile = -0.5 * I; p.puff = 0.35 * I; p.sx = 1 - 0.03 * I; },
    redPulse: function (t, I, p, d) { p.tint = (0.5 + 0.5 * Math.sin(t * 5.2)) * 0.95 * I; p.puff = 0.6 * I; p.brow = 0.7 * I; p.rot = Math.sin(t * 13) * 0.015 * I; p.steam = 3 * I; p.smile = -0.5 * I; },
    // sad (cute, not distressing)
    droop: function (t, I, p, d) { p.dy = 0.035 * I; p.rot = 0.04 * I * d * Math.sin(t * 0.9); p.squint = 0.3 * I; p.brow = -0.8 * I; p.smile = -0.7 * I; p.sy = 1 - 0.015 * I; },
    tearSparkle: function (t, I, p, d) { p.tear = I; p.spark = 1; p.brow = -0.6 * I; p.smile = -0.4 * I; p.rot = 0.02 * Math.sin(t * 1.3) * I; p.dy = 0.01 * I; },
    lipWobble: function (t, I, p, d) { p.wob = I; p.smile = -0.6 * I; p.brow = -0.5 * I; p.squint = 0.15 * I; p.dy = 0.008 * I; },
    sighSway: function (t, I, p, d) { p.rot = 0.05 * Math.sin(t * 1.6) * I; p.dy = 0.016 * I * (1 + Math.sin(t * 1.6)); p.smile = -0.4 * I; p.brow = -0.4 * I; p.squint = 0.35 * I; p.sy = 1 + 0.012 * Math.sin(t * 2.4) * I; p.sigh = t < 0.6 ? 1 : 0; },
    // happy
    bounceHearts: function (t, I, p, d) { p.dy = -Math.abs(Math.sin(t * 6)) * 0.03 * I; p.heart = 2.5 * I; p.smile = 0.9 * I; p.blush = 0.5 * I; },
    giggleShake: function (t, I, p, d) { p.rot = Math.sin(t * 26) * 0.03 * I; p.dy = Math.sin(t * 30) * 0.008 * I; p.squint = 0.6 * I; p.smile = I; p.blush = 0.3 * I; p.heart = 0.8 * I; },
    blushTilt: function (t, I, p, d) { p.blush = 0.95 * I; p.rot = (0.07 + 0.015 * Math.sin(t * 2)) * I * d; p.smile = 0.8 * I; p.squint = 0.35 * I; p.heart = 1 * I; },
    sparkleSpin: function (t, I, p, d) { p.rot = 0.22 * Math.sin(t * 7) * Math.exp(-t * 1.1) * I; p.spark2 = 5 * I; p.smile = I; p.eyeScale = 1 + 0.15 * I; p.dy = -0.01 * I * Math.abs(Math.sin(t * 3)); },
    yawn: function (t, I, p, d) { p.squint = 0.65; p.rot = 0.04 * Math.sin(t * 1.2) * d; p.dy = 0.012; p.smile = 0.2; }
  };
  P.EMO_VARIANTS = Object.keys(VAR);
  // plan = result of Emo.choose()  {emotion, variant, intensity, soft, dur}; extra = min seconds to keep it up
  P.prototype.playEmotion = function (plan, extra) {
    if (!plan) return null;
    if (plan.variant === 'surprise') { this.playReaction('surprise'); return plan.variant; }
    if (plan.variant === 'giggle') { this.playReaction('giggle'); return plan.variant; }
    if (!VAR[plan.variant]) return null;
    var dir = Math.random() < 0.5 ? -1 : 1;
    this.emo = { name: plan.emotion, variant: plan.variant, I: plan.intensity || 0.8, soft: !!plan.soft, t0: this.t, dur: Math.max(plan.dur || 3, extra || 0), dir: dir };
    this.stats.emotions = (this.stats.emotions || 0) + 1; this.emoLog.push(plan.variant);
    return plan.variant;
  };
  P.prototype.extendEmotion = function (sec) { if (this.emo) this.emo.dur = Math.max(this.emo.dur, (this.t - this.emo.t0) + sec); };
  P.prototype.clearEmotion = function () { this.emo = null; };
  P.prototype._emoPose = function (et) {
    var E = this.emo, env = Math.min(1, et / 0.3) * Math.min(1, Math.max(0, (E.dur - et) / 0.7));
    var p = { rot: 0, dx: 0, dy: 0, sx: 1, sy: 1, puff: 0, brow: 0, blush: 0, tint: 0, squint: 0, eyeScale: 1, smile: 0, wob: 0, tear: 0, spark: 0, steam: 0, heart: 0, spark2: 0, sigh: 0, env: env };
    var I = E.I * env; VAR[E.variant](et, I, p, E.dir);
    if (E.soft) { p.brow = 0; p.tint = 0; p.steam = 0; }
    return p;
  };
  P.prototype._steam = function (n, sigh) {
    var cx = this._sx(this.mp.x), hw, y;
    if (sigh) { this.particles.push({ type: 'steam', x: cx + 5, y: this._sy(this.mp.y + this.mp.w * 0.3), vx: 10, vy: -25, life: 0, max: 1.2, r: 7 }); return; }
    if (this.eyes.length > 1) { hw = Math.abs(this.eyes[1].x - this.eyes[0].x) * 0.95 * this.fit.s; y = this._sy((this.eyes[0].y + this.eyes[1].y) / 2 - this.mp.w * 0.3); }
    else { hw = this.mp.w * 1.8 * this.fit.s; y = this._sy(this.mp.y - this.mp.w * 1.6); }
    for (var i = 0; i < n; i++) { var s = Math.random() < 0.5 ? -1 : 1; this.particles.push({ type: 'steam', x: cx + s * hw + (Math.random() - 0.5) * 14, y: y + (Math.random() - 0.5) * 10, vx: s * (14 + Math.random() * 14), vy: -55 - Math.random() * 30, life: 0, max: 0.9 + Math.random() * 0.4, r: 8 + Math.random() * 5 }); }
  };

  // ---- pointer gestures ----
  P.prototype._toImg = function (e) {
    var r = this.cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    return { x: (px - this.fit.ox) / this.fit.s, y: (py - this.fit.oy) / this.fit.s, px: px, py: py };
  };
  P.prototype._bind = function () {
    var self = this, cv = this.cv; cv.style.touchAction = 'none';
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('pointerdown', function (e) {
      if (!self.src || self.editMarker || !self.reactionsOn) return;
      var p = self._toImg(e); if (p.x < 0 || p.y < 0 || p.x > self.Sw || p.y > self.Sh) return;
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      self.pt = { id: e.pointerId, x0: p.x, y0: p.y, px0: p.px, py0: p.py, t0: performance.now(), mode: 'down', moved: false };
      self.warp.cx = p.x; self.warp.cy = p.y;
      if (self.reactionsOn) { self.warp.ts = 0.16; }
      self.pt.timer = setTimeout(function () { if (self.pt && self.pt.mode === 'down' && !self.pt.moved) { self.pt.mode = 'hold'; self.playReaction('tickle', self.warp.cx, self.warp.cy); self.onReact && self.onReact('tickle'); } }, 600);
    });
    cv.addEventListener('pointermove', function (e) {
      var pt = self.pt; if (!pt || e.pointerId !== pt.id) return;
      var p = self._toImg(e), dx = p.px - pt.px0, dy = p.py - pt.py0;
      if (!pt.moved && Math.hypot(dx, dy) > 14) { pt.moved = true; clearTimeout(pt.timer); if (pt.mode === 'hold') { self.endReaction('tickle'); } pt.mode = 'drag'; self.warp.ts = 0; }
      if (pt.mode === 'drag') {
        var lim = 0.22 * Math.min(self.Sw, self.Sh), k = 0.9 / self.fit.s;
        var ox = (dx) * k, oy = (dy) * k, m = Math.hypot(ox, oy); if (m > lim) { ox *= lim / m; oy *= lim / m; }
        self.warp.tx = ox; self.warp.ty = oy; pt.maxD = Math.max(pt.maxD || 0, Math.hypot(dx, dy));
      }
    });
    function up(e) {
      var pt = self.pt; if (!pt || e.pointerId !== pt.id) return; clearTimeout(pt.timer); self.pt = null; self.warp.ts = 0;
      if (pt.mode === 'drag') { self.warp.tx = 0; self.warp.ty = 0; if ((pt.maxD || 0) > 40) { self.playReaction('stretch'); self.onReact && self.onReact('stretch'); } }
      else if (pt.mode === 'hold') { self.endReaction('tickle'); self.warp.vs += 3; }
      else {
        var now = performance.now(); self.taps = self.taps.filter(function (t) { return now - t < 1300; }); self.taps.push(now);
        if (self.taps.length >= 3) { self.taps = []; self.playReaction('dizzy', self.warp.cx, self.warp.cy); self.onReact && self.onReact('dizzy'); }
        else { var k = Math.random() < 0.65 ? 'surprise' : 'giggle'; self.playReaction(k, self.warp.cx, self.warp.cy); self.onReact && self.onReact(k === 'surprise' ? 'tap' : 'giggle'); }
      }
    }
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  };

  // ---- animation ----
  P.prototype.start = function () { if (this.running) return; this.running = true; this.last = 0; requestAnimationFrame(this._loop); };
  P.prototype.stop = function () { this.running = false; };

  P.prototype._springs = function (dt) {
    var w = this.warp, k = 190, c = 8.5;
    var ax = k * (w.tx - w.ox) - c * w.vx, ay = k * (w.ty - w.oy) - c * w.vy, as = 230 * (w.ts - w.s) - c * 1.1 * w.vs;
    w.vx += ax * dt; w.vy += ay * dt; w.vs += as * dt; w.ox += w.vx * dt; w.oy += w.vy * dt; w.s += w.vs * dt;
    if (this.tickling) { w.ox += (Math.random() - 0.5) * 5; w.oy += (Math.random() - 0.5) * 5; }
    w.active = Math.abs(w.ox) + Math.abs(w.oy) > 0.4 || Math.abs(w.s) > 0.004 || Math.abs(w.vx) + Math.abs(w.vy) > 1 || Math.abs(w.vs) > 0.05;
  };

  P.prototype.frame = function (ts) {
    if (!this.running) return; requestAnimationFrame(this._loop);
    if (!this.src) return;
    if (this.cv.getBoundingClientRect().width !== this.W) this.resize();
    if (!this.W || !this.cv.getBoundingClientRect().width) { return; }
    var dt = this.last ? Math.min(0.05, (ts - this.last) / 1000) : 0.016; this.last = ts; this.t += dt; var t = this.t;
    this._springs(dt);
    // loudness -> mouth
    var lv = this.levelFn() || 0; this.open += (lv - this.open) * (lv > this.open ? 0.55 : 0.22);
    if (this.open > this.stats.maxOpen) this.stats.maxOpen = this.open;
    var talking = this.state === 'speaking' || lv > 0.02; this.speakMix += ((talking ? 1 : 0) - this.speakMix) * 0.12;
    this.lean += ((this.state === 'listening' ? 1 : 0) - this.lean) * 0.1;
    // alive: blink + tilt
    if (t > this.nextBlink && this.blinkT < 0) { this.blinkT = t; this.nextBlink = t + 2.4 + Math.random() * 3.2; }
    var blink = 0; if (this.blinkT >= 0) { var bt = (t - this.blinkT) / 0.2; if (bt >= 1) this.blinkT = -1; else blink = Math.sin(bt * Math.PI); }
    if (t > this.nextTilt) { this.tiltTarget = (Math.random() - 0.5) * 0.07; this.nextTilt = t + 3 + Math.random() * 4; if (Math.random() < 0.4) this.tiltTarget = 0; }
    this.tilt += (this.tiltTarget - this.tilt) * 0.03;
    // reaction pose
    var R = this.react, rp = null;
    if (R) { var rt = t - R.t0; if (rt > R.dur) { this.react = null; R = null; } else { var fade = clamp((R.dur - rt) / 0.25, 0, 1), ease = Math.min(1, rt / 0.08); rp = { rt: rt, k: fade * ease }; } }
    var mouthD = this.open * this.mp.w * 0.45 * 1, rxF = 1, eyeScale = 1;
    if (R && rp) {
      if (R.mouth === 'O') { mouthD = Math.max(mouthD, this.mp.w * 0.5 * rp.k); rxF = 1 - (1 - 0.5) * rp.k; eyeScale = 1 + 0.38 * rp.k; }
      else if (R.mouth === 'laugh') { mouthD = Math.max(mouthD, this.mp.w * (0.3 + 0.17 * Math.sin(rp.rt * 24)) * rp.k); rxF = 1.12; blink = Math.max(blink, 0.65 * rp.k); }
      if (R.kind === 'stretch') eyeScale = 1 + 0.38 * rp.k;
    }
    // motion
    var sp = this.speakMix, u = Math.min(this.Sw, this.Sh), dx = 0, dy = 0, rot = this.tilt, sc = 1 + 0.006 * Math.sin(t * 1.9) + 0.03 * this.lean, sy = 1;
    switch (this.motion) {
      case 'calm': dy = u * 0.006 * Math.sin(t * 3.1) * sp; rot += 0.012 * Math.sin(t * 1.3) * sp; break;
      case 'sway': rot += 0.05 * Math.sin(t * 2.2) * sp; dx = u * 0.01 * Math.sin(t * 2.2) * sp; break;
      case 'bounce': dy = -Math.abs(Math.sin(t * 5.2)) * u * 0.028 * sp; sy = 1 - 0.015 * Math.abs(Math.cos(t * 5.2)) * sp; rot += 0.015 * Math.sin(t * 2.6) * sp; break;
      case 'wiggle': rot += 0.035 * Math.sin(t * 9) * sp; dx = u * 0.006 * Math.sin(t * 11) * sp; break;
      case 'nod': dy = u * 0.015 * Math.sin(t * 4.6) * sp; rot += 0.01 * Math.sin(t * 4.6 + 1) * sp; break;
    }
    if (this.state === 'thinking') rot += 0.035 * Math.sin(t * 1.1);
    if (R && rp) {
      if (R.kind === 'dizzy') { rot += 0.09 * Math.sin(rp.rt * 7) * rp.k; dx += u * 0.015 * Math.sin(rp.rt * 5) * rp.k; }
      if (R.kind === 'tickle') { rot += 0.03 * Math.sin(rp.rt * 32) * rp.k; dx += u * 0.006 * Math.sin(rp.rt * 41) * rp.k; if (Math.floor(rp.rt * 3) !== Math.floor((rp.rt - dt) * 3)) this._hearts(1); }
      if (R.kind === 'surprise') { rot += 0.04 * Math.sin(rp.rt * 20) * rp.k; dy -= u * 0.012 * rp.k; }
      if (R.kind === 'giggle') { dy += u * 0.008 * Math.sin(rp.rt * 26) * rp.k; }
    }
    // emotion pose (variant animation) layered on top
    var EP = null;
    if (this.emo) { var et = t - this.emo.t0; if (et > this.emo.dur) this.emo = null; else EP = this._emoPose(et); }
    if (EP) {
      rot += EP.rot; dx += EP.dx * u; dy += EP.dy * u; sy *= EP.sy; blink = Math.max(blink, EP.squint); eyeScale = Math.max(eyeScale, EP.eyeScale);
      var a = this._acc; a.steam += EP.steam * dt; a.heart += EP.heart * dt; a.spark += EP.spark2 * dt;
      while (a.steam >= 1) { a.steam -= 1; this._steam(1); }
      while (a.heart >= 1) { a.heart -= 1; this._hearts(1); }
      while (a.spark >= 1) { a.spark -= 1; this._sparks(1); }
      if (EP.sigh && !this._sighed) { this._sighed = true; this._steam(1, true); } if (!EP.sigh) this._sighed = false;
    }
    // ---- draw face (image space) ----
    var fg = this.face.getContext('2d'); fg.clearRect(0, 0, this.Sw, this.Sh); fg.drawImage(this.src, 0, 0);
    if (EP && EP.puff > 0.02) this._puff(fg, EP.puff);
    this._eyes(fg, blink, eyeScale);
    if (EP) { if (Math.abs(EP.brow) > 0.03) this._brows(fg, EP.brow); if (EP.blush > 0.03) this._blush(fg, EP.blush); if (EP.tint > 0.02) this._tint(fg, EP.tint); if (EP.tear > 0.03) this._tears(fg, EP.tear, EP.spark, t); }
    this._mouth(fg, mouthD, rxF);
    if (EP && mouthD < this.mp.w * 0.1 && (Math.abs(EP.smile) > 0.12 || EP.wob > 0.05)) this._curve(fg, EP.smile, EP.wob, t, 1 - mouthD / (this.mp.w * 0.1));
    // ---- to screen ----
    var g = this.g, d = this.dpr, f = this.fit;
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, this.W, this.H);
    if (this.bg) g.drawImage(this.bg, 0, 0, this.W, this.H); else { g.fillStyle = '#222'; g.fillRect(0, 0, this.W, this.H); }
    var pxs = this._sx(this.mp.x), pys = this._sy(this.mp.y + this.mp.w);
    g.save(); g.translate(pxs + dx * f.s, pys + dy * f.s); g.rotate(rot); g.scale(sc * (EP ? EP.sx : 1), sc * sy); g.translate(-pxs, -pys);
    g.translate(f.ox, f.oy); g.scale(f.s, f.s);
    if (this.warp.active) this._drawWarped(g); else g.drawImage(this.face, 0, 0);
    g.restore();
    this._particles(g, dt, R && rp ? R : null, rp);
    if (this.editMarker) this._marker(g);
    this.frames++;
  };

  P.prototype._eyes = function (g, blink, scale) {
    var eyes = this.eyes; if (!eyes.length) return;
    for (var i = 0; i < eyes.length; i++) {
      var e = eyes[i];
      if (scale > 1.02) {
        var rx = e.w * 0.72, ry = Math.max(e.h, e.w * 0.3) * 0.95;
        g.save(); g.beginPath(); g.ellipse(e.x, e.y, rx, ry, 0, 0, Math.PI * 2); g.clip();
        g.translate(e.x, e.y); g.scale(scale, scale); g.translate(-e.x, -e.y); g.drawImage(this.src, 0, 0); g.restore();
      }
      if (blink > 0.05) {
        var ryE = Math.max(e.h, e.w * 0.3) * 0.75, rx2 = e.w * 0.62;
        g.save(); g.fillStyle = this.skin;
        if (blink < 0.9) {            // eyelid coming down from the top
          var lid = e.y - e.h * 0.5 + e.h * blink * 1.05;
          g.beginPath(); g.ellipse(e.x, e.y, rx2, ryE, 0, 0, Math.PI * 2); g.clip();
          g.fillRect(e.x - rx2, e.y - ryE, rx2 * 2, lid - (e.y - ryE));
          g.strokeStyle = 'rgba(40,25,20,.5)'; g.lineWidth = Math.max(2, e.w * 0.04); g.beginPath(); g.moveTo(e.x - e.w * 0.46, lid); g.lineTo(e.x + e.w * 0.46, lid); g.stroke();
        } else {
          var ry2 = ryE * Math.min(1, blink * 1.15);
          var gr = g.createRadialGradient(e.x, e.y, ry2 * 0.2, e.x, e.y, Math.max(rx2, ry2));
          gr.addColorStop(0, this.skin); gr.addColorStop(0.93, this.skin); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.beginPath(); g.ellipse(e.x, e.y, rx2, ry2, 0, 0, Math.PI * 2); g.fill();
          g.strokeStyle = 'rgba(40,25,20,.55)'; g.lineWidth = Math.max(2, e.w * 0.05); g.lineCap = 'round'; g.beginPath(); g.moveTo(e.x - e.w * 0.4, e.y + e.h * 0.1); g.quadraticCurveTo(e.x, e.y + e.h * 0.4, e.x + e.w * 0.4, e.y + e.h * 0.1); g.stroke();
        }
        g.restore();
      }
    }
  };

  P.prototype._mouth = function (g, d, rxF) {
    var mp = this.mp; if (d < 1.2) return;
    g.drawImage(this.jaw.c, this.jaw.x, this.jaw.y + d);
    var cx = mp.x, cy = mp.y + d * 0.5, rx = mp.w * 0.5 * rxF * (0.8 + 0.2 * Math.min(1, d / (mp.w * 0.4))), ry = d * 0.5 + mp.w * 0.03;
    var gr = g.createRadialGradient(cx, cy, 1, cx, cy, Math.max(rx, ry));
    gr.addColorStop(0, '#4a1219'); gr.addColorStop(1, '#1d0508');
    g.save(); g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
    if (d > mp.w * 0.2) { g.clip(); g.beginPath(); g.ellipse(cx, cy + ry * 0.55, rx * 0.55, ry * 0.45, 0, 0, Math.PI * 2); g.fillStyle = '#c4495b'; g.fill(); }
    g.restore();
    g.save(); g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.lineWidth = mp.w * 0.035; g.strokeStyle = 'rgba(90,35,35,.45)'; g.stroke(); g.restore();
  };


  P.prototype._cheekPts = function () {
    var mp = this.mp, e = this.eyes;
    if (e.length > 1) { var a = e[0].x < e[1].x ? e[0] : e[1], b = a === e[0] ? e[1] : e[0], f = 0.55; return [{ x: a.x, y: a.y + (mp.y - a.y) * f }, { x: b.x, y: b.y + (mp.y - b.y) * f }]; }
    return [{ x: mp.x - mp.w * 1.0, y: mp.y - mp.w * 0.45 }, { x: mp.x + mp.w * 1.0, y: mp.y - mp.w * 0.45 }];
  };
  P.prototype._puff = function (g, k) {
    var mp = this.mp, r = mp.w * 0.5, s = Math.ceil(r * 2) + 2;
    if (!this._tmp || this._tmp.width < s) this._tmp = mkCanvas(s, s);
    var tc = this._tmp, tg = tc.getContext('2d'), sc = 1 + 0.2 * k, pts = [{ x: mp.x - mp.w * 0.95, y: mp.y - mp.w * 0.05 }, { x: mp.x + mp.w * 0.95, y: mp.y - mp.w * 0.05 }];
    pts.forEach(function (c) {
      tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, tc.width, tc.height);
      tg.translate(r + 1, r + 1); tg.scale(sc, sc); tg.translate(-c.x, -c.y); tg.drawImage(this.src, 0, 0); tg.setTransform(1, 0, 0, 1, 0, 0);
      tg.globalCompositeOperation = 'destination-in'; var gr = tg.createRadialGradient(r + 1, r + 1, r * 0.35, r + 1, r + 1, r); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); tg.fillStyle = gr; tg.fillRect(0, 0, tc.width, tc.height);
      g.drawImage(tc, 0, 0, tc.width, tc.height, c.x - r - 1, c.y - r - 1, tc.width, tc.height);
    }, this);
  };
  P.prototype._brows = function (g, k) {
    var e = this.eyes; if (e.length < 2) return; var cx = (e[0].x + e[1].x) / 2;
    g.save(); g.lineCap = 'round'; g.strokeStyle = 'rgba(48,28,18,' + Math.min(1, Math.abs(k) * 1.4) + ')';
    e.forEach(function (ey) {
      var s = ey.x < cx ? -1 : 1, hw = ey.w * 0.62, base = ey.y - ey.h * 0.85 - ey.w * 0.3, ik = Math.abs(k);
      var inX = ey.x - s * hw, outX = ey.x + s * hw, inY, outY;
      if (k > 0) { inY = base + ey.w * 0.3 * ik; outY = base - ey.w * 0.08 * ik; } else { inY = base - ey.w * 0.3 * ik; outY = base + ey.w * 0.1 * ik; }
      g.lineWidth = Math.max(4, ey.w * 0.17); g.beginPath(); g.moveTo(inX, inY); g.quadraticCurveTo(ey.x, (inY + outY) / 2 - ey.w * 0.08, outX, outY); g.stroke();
    });
    g.restore();
  };
  P.prototype._blush = function (g, k) {
    this._cheekPts().forEach(function (c) { var r = this.mp.w * 0.42, gr = g.createRadialGradient(c.x, c.y, 1, c.x, c.y, r); gr.addColorStop(0, 'rgba(255,80,110,' + (0.55 * k) + ')'); gr.addColorStop(1, 'rgba(255,80,110,0)'); g.fillStyle = gr; g.beginPath(); g.arc(c.x, c.y, r, 0, Math.PI * 2); g.fill(); }, this);
  };
  P.prototype._tint = function (g, k) {
    var e = this.eyes, mp = this.mp, cx = mp.x, cy = mp.y - mp.w * 0.9, R = mp.w * 2.6;
    if (e.length > 1) { cx = (e[0].x + e[1].x) / 2; cy = ((e[0].y + e[1].y) / 2 + mp.y) / 2; R = Math.abs(e[1].x - e[0].x) * 1.5 + mp.w; }
    var gr = g.createRadialGradient(cx, cy, R * 0.15, cx, cy, R); gr.addColorStop(0, 'rgba(255,40,30,' + (0.42 * k) + ')'); gr.addColorStop(1, 'rgba(255,40,30,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  };
  P.prototype._tears = function (g, k, spark, t) {
    this.eyes.forEach(function (e, i) {
      g.save(); var r = e.w * 0.5;
      var wg = g.createRadialGradient(e.x, e.y + e.h * 0.25, 1, e.x, e.y + e.h * 0.25, r); wg.addColorStop(0, 'rgba(170,220,255,' + (0.38 * k) + ')'); wg.addColorStop(1, 'rgba(170,220,255,0)'); g.fillStyle = wg; g.beginPath(); g.ellipse(e.x, e.y + e.h * 0.25, r, r * 0.6, 0, 0, Math.PI * 2); g.fill();
      var ph = ((t * 0.32 + i * 0.4) % 1), y = e.y + e.h * 0.55 + ph * e.h * 1.1, rr = e.w * 0.085 * k * (1 - ph * 0.4), x = e.x + (i ? 1 : -1) * e.w * 0.12;
      g.globalAlpha = Math.min(1, k) * (1 - ph * ph); g.fillStyle = 'rgba(160,215,255,.9)'; g.beginPath(); g.moveTo(x, y - rr * 1.8); g.quadraticCurveTo(x + rr * 1.2, y, x, y + rr); g.quadraticCurveTo(x - rr * 1.2, y, x, y - rr * 1.8); g.fill();
      g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(x - rr * 0.3, y - rr * 0.1, rr * 0.28, 0, Math.PI * 2); g.fill();
      if (spark) { g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 8 + i * 2); var sx = e.x - e.w * 0.18, sy = e.y - e.h * 0.2, sr = e.w * 0.14; g.fillStyle = '#fff'; g.beginPath(); for (var j = 0; j < 8; j++) { var an = j * Math.PI / 4, q = j % 2 ? sr * 0.28 : sr; g.lineTo(sx + Math.cos(an) * q, sy + Math.sin(an) * q); } g.closePath(); g.fill(); }
      g.restore();
    });
  };
  // expression mouth curve (smile / frown / wobbling lip) – drawn only when the mouth is (nearly) closed
  P.prototype._curve = function (g, smile, wob, t, vis) {
    var mp = this.mp, x = mp.x, y = mp.y + mp.w * 0.04, hw = mp.w * 0.5, a = Math.min(1, Math.max(Math.abs(smile) * 1.8, wob) * vis);
    if (!this._lipCol) this._lipCol = this._sampleBelow();
    g.save(); g.lineCap = 'round';
    g.globalAlpha = 0.95 * a; g.strokeStyle = this._lipCol; g.lineWidth = mp.w * 0.2; try { g.filter = 'blur(' + Math.max(3, mp.w * 0.16) + 'px)'; } catch (e) { } g.beginPath(); g.moveTo(x - hw * 0.95, y); g.lineTo(x + hw * 0.95, y); g.stroke(); g.filter = 'none';
    var w = wob * Math.sin(t * 22) * mp.w * 0.05, c = -smile * mp.w * 0.38, end = -smile * mp.w * 0.12;   // smile>0: corners up, belly down
    g.globalAlpha = 0.9 * a; g.strokeStyle = 'rgba(80,28,30,1)'; g.lineWidth = Math.max(3, mp.w * 0.055);
    g.beginPath(); g.moveTo(x - hw, y + end + w); g.quadraticCurveTo(x, y - c + w * 0.5 + (wob ? -mp.w * 0.07 : 0), x + hw, y + end - w); g.stroke();
    g.restore();
  };
  P.prototype._sampleBelow = function () {
    try { var mp = this.mp, d = this.src.getContext('2d').getImageData(Math.max(0, Math.round(mp.x) - 3), Math.min(this.Sh - 6, Math.round(mp.y + mp.w * 0.3)), 6, 6).data, r = 0, g = 0, b = 0, n = d.length / 4; for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } return 'rgb(' + Math.round(r / n) + ',' + Math.round(g / n) + ',' + Math.round(b / n) + ')'; } catch (e) { return this.skin; }
  };

  P.prototype._drawWarped = function (g) {
    var w = this.warp, N = 22, cw = this.Sw / N, ch = this.Sh / N, R2 = w.R * w.R, face = this.face;
    function D(x, y) {
      var ddx = x - w.cx, ddy = y - w.cy, q = Math.exp(-(ddx * ddx + ddy * ddy) / R2);
      return [x + (w.ox + (-ddx) * w.s * 1.0) * q, y + (w.oy + (-ddy) * w.s * 1.0) * q];
    }
    g.drawImage(face, 0, 0);
    var pts = [], i, j;
    for (j = 0; j <= N; j++) { pts[j] = []; for (i = 0; i <= N; i++) pts[j][i] = D(i * cw, j * ch); }
    var m = 1.2;
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
      var a = pts[j][i], b = pts[j][i + 1], c = pts[j + 1][i];
      g.save(); g.transform((b[0] - a[0]) / cw, (b[1] - a[1]) / cw, (c[0] - a[0]) / ch, (c[1] - a[1]) / ch, a[0], a[1]);   // per-cell affine (keeps shear: no staircase)
      var sx = Math.max(0, i * cw - m), sy = Math.max(0, j * ch - m), ex = Math.min(this.Sw, (i + 1) * cw + m), ey = Math.min(this.Sh, (j + 1) * ch + m);
      g.drawImage(face, sx, sy, ex - sx, ey - sy, sx - i * cw, sy - j * ch, ex - sx, ey - sy); g.restore();
    }
  };

  P.prototype._particles = function (g, dt, R, rp) {
    var i, p;
    for (i = this.particles.length - 1; i >= 0; i--) {
      p = this.particles[i]; p.life += dt; if (p.life > p.max) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; var a = 1 - p.life / p.max;
      g.save(); g.globalAlpha = Math.min(1, a * 1.6);
      if (p.type === 'heart') drawHeart(g, p.x, p.y, p.r); else if (p.type === 'steam') { var rr = p.r * (1 + 1.6 * p.life / p.max), sg = g.createRadialGradient(p.x, p.y, 1, p.x, p.y, rr); sg.addColorStop(0, 'rgba(255,255,255,.85)'); sg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = sg; g.beginPath(); g.arc(p.x, p.y, rr, 0, Math.PI * 2); g.fill(); } else drawSpark(g, p.x, p.y, p.r, 1);
      g.restore();
    }
    if (R && R.kind === 'dizzy' && rp) {
      var hx = this._sx(this.mp.x), ey = this.eyes.length ? this.eyes[0].y : this.mp.y - this.mp.w * 2.4;
      var hy = this._sy(ey - (this.mp.y - ey) * 1.5);
      for (i = 0; i < 4; i++) { var an = rp.rt * 5 + i * Math.PI / 2; g.save(); g.globalAlpha = rp.k; drawStar(g, hx + Math.cos(an) * this.mp.w * this.fit.s * 0.9, hy + Math.sin(an) * this.mp.w * this.fit.s * 0.22, 12 + 3 * Math.sin(an * 2), an, '#ffd43b'); g.restore(); }
    }
  };

  P.prototype._marker = function (g) {
    var mp = this.mp, f = this.fit, x = this._sx(mp.x), y = this._sy(mp.y), rx = mp.w * f.s * 0.5, ry = mp.w * f.s * 0.2;
    g.save(); g.setLineDash([6, 4]); g.lineWidth = 3; g.strokeStyle = '#ff2d55'; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]); g.beginPath(); g.moveTo(x - 10, y); g.lineTo(x + 10, y); g.moveTo(x, y - 10); g.lineTo(x, y + 10); g.stroke();
    g.setLineDash([3, 5]); g.strokeStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.moveTo(x - rx, this._sy(mp.chin)); g.lineTo(x + rx, this._sy(mp.chin)); g.stroke(); g.restore();
  };

  // map a pointer event to normalized image coords (editor tap)
  P.prototype.eventToNorm = function (e) { var p = this._toImg(e); return { x: clamp(p.x / this.Sw, 0, 1), y: clamp(p.y / this.Sh, 0, 1) }; };

  return P;
})();
