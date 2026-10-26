/* Built-in cartoon faces drawn in code. Each returns {canvas, mouth, eyes, skin} (coords normalized 0..1). */
'use strict';
var Cartoons = (function () {
  var S = 1024;
  function mk() { var c = document.createElement('canvas'); c.width = c.height = S; return c; }
  function circle(g, x, y, r, f, st, lw) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); if (f) { g.fillStyle = f; g.fill(); } if (st) { g.lineWidth = lw || 8; g.strokeStyle = st; g.stroke(); } }
  function ell(g, x, y, rx, ry, f, st, lw) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); if (f) { g.fillStyle = f; g.fill(); } if (st) { g.lineWidth = lw || 8; g.strokeStyle = st; g.stroke(); } }
  function eyes(g, y, dx, r) {
    [-1, 1].forEach(function (s) { circle(g, 512 + s * dx, y, r, '#fff', '#2b1d14', 6); circle(g, 512 + s * dx + 4, y + 4, r * 0.55, '#2b1d14'); circle(g, 512 + s * dx + 14, y - 6, r * 0.18, '#fff'); });
  }
  function smile(g, y, w) { g.beginPath(); g.moveTo(512 - w, y); g.quadraticCurveTo(512, y + w * 0.5, 512 + w, y); g.lineWidth = 9; g.strokeStyle = '#4a2a1a'; g.lineCap = 'round'; g.stroke(); }
  function bg(g, c1, c2) { var gr = g.createRadialGradient(512, 400, 80, 512, 512, 760); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, S, S); }

  var defs = {
    bear: { name: 'ভাল্লুক', icon: '🐻', draw: function () {
      var c = mk(), g = c.getContext('2d'); bg(g, '#ffe8b0', '#f4b860');
      circle(g, 290, 250, 105, '#9a6234'); circle(g, 734, 250, 105, '#9a6234'); circle(g, 290, 250, 55, '#e9b98a'); circle(g, 734, 250, 55, '#e9b98a');
      circle(g, 512, 520, 360, '#b97a43', '#8a5530', 10);
      eyes(g, 440, 150, 52);
      ell(g, 512, 640, 190, 150, '#f0cfa3');
      ell(g, 512, 575, 52, 36, '#3a2418');
      g.beginPath(); g.moveTo(512, 610); g.lineTo(512, 665); g.lineWidth = 8; g.strokeStyle = '#4a2a1a'; g.stroke();
      smile(g, 665, 90);
      ell(g, 330, 560, 48, 28, 'rgba(240,120,120,.35)'); ell(g, 694, 560, 48, 28, 'rgba(240,120,120,.35)');
      return { canvas: c, mouth: { x: 0.5, y: 665 / S, w: 180 / S, chin: 850 / S }, eyes: [{ x: 362 / S, y: 440 / S, w: 104 / S, h: 104 / S }, { x: 662 / S, y: 440 / S, w: 104 / S, h: 104 / S }], skin: '#b97a43' };
    } },
    cat: { name: 'বিড়াল', icon: '🐱', draw: function () {
      var c = mk(), g = c.getContext('2d'); bg(g, '#d6f0ff', '#8fc6ee');
      [-1, 1].forEach(function (s) { g.beginPath(); g.moveTo(512 + s * 330, 330); g.lineTo(512 + s * 290, 100); g.lineTo(512 + s * 120, 235); g.closePath(); g.fillStyle = '#f2a65a'; g.fill(); g.beginPath(); g.moveTo(512 + s * 290, 290); g.lineTo(512 + s * 270, 175); g.lineTo(512 + s * 175, 245); g.closePath(); g.fillStyle = '#ffc9c9'; g.fill(); });
      ell(g, 512, 540, 360, 330, '#f2a65a', '#c97d34', 10);
      g.strokeStyle = '#c97d34'; g.lineWidth = 14; g.lineCap = 'round';
      [[512, 250, 512, 330], [450, 262, 458, 325], [574, 262, 566, 325]].forEach(function (l) { g.beginPath(); g.moveTo(l[0], l[1]); g.lineTo(l[2], l[3]); g.stroke(); });
      [-1, 1].forEach(function (s) { ell(g, 512 + s * 150, 470, 56, 66, '#fff', '#2b1d14', 6); ell(g, 512 + s * 150, 475, 22, 52, '#2b1d14'); circle(g, 512 + s * 150 + 10, 450, 9, '#fff'); });
      ell(g, 512, 590, 38, 26, '#e27b8b');
      g.strokeStyle = '#6b3a1a'; g.lineWidth = 8; g.beginPath(); g.moveTo(512, 616); g.lineTo(512, 660); g.stroke();
      g.beginPath(); g.moveTo(420, 668); g.quadraticCurveTo(470, 700, 512, 660); g.quadraticCurveTo(554, 700, 604, 668); g.stroke();
      g.strokeStyle = '#6b3a1a'; g.lineWidth = 5; [[-1, -14], [-1, 14], [1, -14], [1, 14]].forEach(function (p) { g.beginPath(); g.moveTo(512 + p[0] * 150, 610 + p[1] * 0.4); g.lineTo(512 + p[0] * 330, 590 + p[1] * 3); g.stroke(); });
      return { canvas: c, mouth: { x: 0.5, y: 666 / S, w: 170 / S, chin: 860 / S }, eyes: [{ x: 362 / S, y: 470 / S, w: 112 / S, h: 132 / S }, { x: 662 / S, y: 470 / S, w: 112 / S, h: 132 / S }], skin: '#f2a65a' };
    } },
    bunny: { name: 'খরগোশ', icon: '🐰', draw: function () {
      var c = mk(), g = c.getContext('2d'); bg(g, '#e9ffd6', '#a7dd8b');
      [-1, 1].forEach(function (s) { ell(g, 512 + s * 130, 190, 70, 210, '#f6f1ee', '#cbbcb4', 8); ell(g, 512 + s * 130, 200, 34, 160, '#f7b6c5'); });
      circle(g, 512, 600, 330, '#f6f1ee', '#cbbcb4', 10);
      eyes(g, 540, 130, 46);
      ell(g, 512, 640, 42, 30, '#f09ab0');
      g.beginPath(); g.moveTo(512, 668); g.lineTo(512, 715); g.lineWidth = 7; g.strokeStyle = '#8a5a62'; g.stroke();
      smile(g, 715, 70);
      ell(g, 330, 660, 46, 26, 'rgba(240,120,150,.35)'); ell(g, 694, 660, 46, 26, 'rgba(240,120,150,.35)');
      return { canvas: c, mouth: { x: 0.5, y: 715 / S, w: 140 / S, chin: 900 / S }, eyes: [{ x: 382 / S, y: 540 / S, w: 92 / S, h: 92 / S }, { x: 642 / S, y: 540 / S, w: 92 / S, h: 92 / S }], skin: '#f6f1ee' };
    } }
  };
  function make(id) { var d = defs[id] || defs.bear; return d.draw(); }
  function list() { return Object.keys(defs).map(function (k) { return { id: k, name: defs[k].name, icon: defs[k].icon }; }); }
  return { make: make, list: list };
})();
