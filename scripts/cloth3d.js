// "3D clothing guide strokes" (v6) for the standalone Pose Studio (does NOT modify vnccs_pose_studio.js / core.js).
//
// The user draws coloured lines / filled shapes ON the 3D viewport. Every stroke point is converted to a 3D point that is
// SKIN-BOUND to the doll: stored as (bind-space position, up to 4 bone indices + weights). At render time the point is
// re-evaluated with the doll's current bone matrices:   P = Mw * bindMatrixInverse * (sum_k w_k * bone_k.matrixWorld * boneInverse_k) * v
// i.e. exactly the formula three.js skinning uses. Hence a stroke follows
//   - the whole-doll transform (position / zoom / rotation, so also the group tools), AND
//   - bone poses (if the pose is changed afterwards the stroke deforms with the skin).
// Points on the body use the hit triangle's barycentric skin weights; points off the body (flowing pallu) are placed on a camera-facing
// plane through the last hit (or the pelvis) and bound rigidly to the nearest bone.
// Rendering: camera-facing ribbons (+ triangulated, semi-transparent fills), rebuilt in a renderer.render() hook so that BOTH the editing
// camera and viewer.capture()'s capture camera see correct strokes. Strokes live in their own Group -> never hit by the vendor's raycasts.
const PALETTE = ["#ff2020", "#2060ff", "#20c040", "#ffd400", "#ff60c0", "#ffffff", "#101010"];
const OLD_WIDTHS = { thin: 0.005, mid: 0.011, thick: 0.02 };      // v5 prototype names (still readable from old files)
const DEF_W = 0.011;                                                 // pen width = fraction of the doll's rest height
let UID = 1;

import { el, btn, mark, row } from "./ui_bar.js";
export function install(studio) {
  const v = studio.viewer, T = v.THREE;
  const api = { strokes: [], onChange: null, state: { on: false, tool: "draw", color: PALETTE[0], mode: "line", width: DEF_W, eraser: 16, selected: null, xray: false, show: true, inCapture: true } };
  const group = new T.Group(); group.name = "cloth3d-strokes"; group.renderOrder = 50;
  v.scene.add(group);
  const noRay = () => {};

  // ---------- per-frame skin evaluation helpers -----------------------------------------------------------------------
  const charCache = new Map();                                       // cid -> {mesh, M, B(idx), scale}, rebuilt every frame
  function entryMesh(cid) {
    if (String(cid) === String(studio.activeCharacterId)) return v.skinnedMesh || null;
    return v.passiveCharacters?.get(String(cid))?.mesh || null;
  }
  function charCtx(cid, fresh) {
    let c = fresh ? null : charCache.get(cid);
    if (c) return c;
    const mesh = entryMesh(cid);
    if (!mesh || !mesh.skeleton) return null;
    mesh.updateMatrixWorld(true);
    const bones = mesh.skeleton.bones, inv = mesh.skeleton.boneInverses;
    const M = new T.Matrix4().multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
    const cache = [];
    c = { mesh, bones, M, scale: mesh.matrixWorld.getMaxScaleOnAxis(),
      B(i) { return cache[i] || (cache[i] = new T.Matrix4().multiplyMatrices(bones[i].matrixWorld, inv[i])); } };
    charCache.set(cid, c);
    return c;
  }
  const _t = new T.Vector3();
  function worldPt(c, p, out) {
    out.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      if (!(p.w[k] > 0)) continue;
      _t.copy(p.v).applyMatrix4(c.B(p.idx[k]));
      out.addScaledVector(_t, p.w[k]);
    }
    return out.applyMatrix4(c.M);
  }
  function restHeight(mesh) {
    const g = mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox.max.y - g.boundingBox.min.y;
  }

  // ---------- 2D screen point -> skin-bound 3D point ------------------------------------------------------------------
  const ray = new T.Raycaster();
  function ndc(clientX, clientY) {
    const r = v.canvas.getBoundingClientRect();
    return new T.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }
  function bindFromHit(c, hit) {
    const mesh = c.mesh, g = mesh.geometry, f = hit.face;
    const a = new T.Vector3(), b = new T.Vector3(), cc = new T.Vector3();
    mesh.getVertexPosition(f.a, a); mesh.getVertexPosition(f.b, b); mesh.getVertexPosition(f.c, cc);
    const bary = new T.Vector3();
    T.Triangle.getBarycoord(mesh.worldToLocal(hit.point.clone()), a, b, cc, bary);
    if (!isFinite(bary.x + bary.y + bary.z)) bary.set(1 / 3, 1 / 3, 1 / 3);
    const verts = [f.a, f.b, f.c], bw = [bary.x, bary.y, bary.z];
    const pos = g.attributes.position, nor = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const rest = new T.Vector3(), n = new T.Vector3(), acc = new Map();
    verts.forEach((vi, j) => {
      rest.x += pos.getX(vi) * bw[j]; rest.y += pos.getY(vi) * bw[j]; rest.z += pos.getZ(vi) * bw[j];
      if (nor) { n.x += nor.getX(vi) * bw[j]; n.y += nor.getY(vi) * bw[j]; n.z += nor.getZ(vi) * bw[j]; }
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(vi, k) * bw[j];
        if (w > 0) { const bi = si.getComponent(vi, k); acc.set(bi, (acc.get(bi) || 0) + w); }
      }
    });
    if (n.lengthSq() > 0) n.normalize();
    rest.addScaledVector(n, restHeight(mesh) * 0.012);                  // lift slightly off the skin (avoids z-fighting)
    const top = [...acc.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4);
    const tot = top.reduce((s, e) => s + e[1], 0) || 1;
    const idx = [0, 0, 0, 0], w = [0, 0, 0, 0];
    top.forEach((e, k) => { idx[k] = e[0]; w[k] = e[1] / tot; });
    return { v: rest.applyMatrix4(mesh.bindMatrix), idx, w };
  }
  function nearestBone(c, P) {
    let best = 0, bd = Infinity;
    const p = new T.Vector3(), q = new T.Vector3(), seg = new T.Line3(), cl = new T.Vector3();
    c.bones.forEach((bn, i) => {
      bn.getWorldPosition(p);
      let d = p.distanceTo(P);
      for (const ch of bn.children) if (ch.isBone) { ch.getWorldPosition(q); seg.set(p, q); seg.closestPointToPoint(P, true, cl); d = Math.min(d, cl.distanceTo(P)); }
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  function bindFromWorld(c, P) {                                         // rigid bind to the nearest bone
    const i = nearestBone(c, P);
    const m = new T.Matrix4().multiplyMatrices(c.M, c.B(i)).invert();
    return { v: P.clone().applyMatrix4(m), idx: [i, 0, 0, 0], w: [1, 0, 0, 0] };
  }
  // anchor = {point: Vector3|null}; returns skin-bound point
  function pointFromScreen(cid, clientX, clientY, anchor) {
    const c = charCtx(cid, true); if (!c) return null;
    c.mesh.skeleton.update();
    ray.setFromCamera(ndc(clientX, clientY), v.camera);
    const hit = ray.intersectObject(c.mesh, false)[0];
    if (hit && hit.face) {
      anchor.point = hit.point.clone();
      return { p: bindFromHit(c, hit), hit: true };
    }
    let A = anchor.point;
    if (!A) { const pel = c.bones.find((b) => b.name === "pelvis") || c.bones[0]; A = pel.getWorldPosition(new T.Vector3()); anchor.point = A.clone(); }
    const dir = v.camera.getWorldDirection(new T.Vector3());
    const plane = new T.Plane().setFromNormalAndCoplanarPoint(dir.clone().negate(), A);
    const P = ray.ray.intersectPlane(plane, new T.Vector3());
    if (!P) return null;
    return { p: bindFromWorld(c, P), hit: false };
  }

  // ---------- stroke objects (three.js) -------------------------------------------------------------------------------
  const matCache = new Map();
  function material(color, kind, extra = {}) {
    const key = [color, kind, api.state.xray].join("|");
    let m = matCache.get(key);
    if (!m) {
      m = new T.MeshBasicMaterial({ color, side: T.DoubleSide, transparent: kind === "fill" || kind === "sel", opacity: kind === "fill" ? 0.5 : kind === "sel" ? 0.85 : 1,
        depthTest: kind === "sel" ? false : !api.state.xray, depthWrite: kind === "line", polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      matCache.set(key, m);
    }
    return m;
  }
  const wOf = (s) => (typeof s.width === "number" ? s.width : OLD_WIDTHS[s.width] || DEF_W);
  const keyOf = (s) => [api.state.xray, api.state.selected === s.id].join("|");
  function ensureObjs(s) {
    if (s.objs && s.objsKey === keyOf(s)) return;
    disposeObjs(s);
    s.objsKey = keyOf(s); s.objs = {};
    const mk = (kind, color, order) => { const g = new T.BufferGeometry(); const m = new T.Mesh(g, material(color, kind)); m.raycast = noRay; m.frustumCulled = false; m.renderOrder = order; group.add(m); return m; };
    if (api.state.selected === s.id) s.objs.sel = mk("sel", "#ffffff", 49);
    s.objs.line = mk("line", s.color, 51);
    if (s.mode === "fill") s.objs.fill = mk("fill", s.color, 50);
  }
  function disposeObjs(s) {
    if (!s.objs) return;
    for (const o of Object.values(s.objs)) { group.remove(o); o.geometry.dispose(); }
    s.objs = null;
  }
  const _P = [], _s = new T.Vector3(), _d = new T.Vector3(), _cd = new T.Vector3();
  function ribbon(n, half, closed, camera) {
    const segs = closed ? n : n - 1;
    const pos = new Float32Array(n * 2 * 3), idx = [];
    camera.getWorldPosition(_cd);
    let lastSide = new T.Vector3(1, 0, 0);
    for (let i = 0; i < n; i++) {
      const a = _P[closed ? (i + n - 1) % n : Math.max(0, i - 1)], b = _P[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      _d.subVectors(b, a);
      _s.subVectors(_P[i], _cd);
      const side = new T.Vector3().crossVectors(_d, _s);
      if (side.lengthSq() < 1e-12) side.copy(lastSide); else side.normalize();
      lastSide = side;
      pos.set([_P[i].x + side.x * half, _P[i].y + side.y * half, _P[i].z + side.z * half,
               _P[i].x - side.x * half, _P[i].y - side.y * half, _P[i].z - side.z * half], i * 6);
    }
    for (let i = 0; i < segs; i++) { const j = (i + 1) % n; idx.push(i * 2, i * 2 + 1, j * 2, i * 2 + 1, j * 2 + 1, j * 2); }
    return { pos, idx };
  }
  const setGeo = (o, positions, index) => {
    const g = o.geometry; g.setAttribute("position", new T.BufferAttribute(positions, 3)); g.setIndex(index); g.computeBoundingSphere();
  };
  function updateStroke(s, camera) {
    const c = charCtx(s.cid); const vis = !!c && c.mesh.visible && s.tab === studio.activeTab;
    ensureObjs(s);
    for (const o of Object.values(s.objs)) o.visible = vis;
    if (!vis || !s.pts.length) return;
    const n = s.pts.length;
    while (_P.length < n) _P.push(new T.Vector3());
    for (let i = 0; i < n; i++) worldPt(c, s.pts[i], _P[i]);
    s.world = _P.slice(0, n).map((p) => p.clone());                     // exposed for tests
    const half = restHeight(c.mesh) * wOf(s) * c.scale * 0.5;
    const closed = s.mode === "fill" && n > 2;
    const rb = ribbon(n, half, closed, camera);
    setGeo(s.objs.line, rb.pos, rb.idx);
    if (s.objs.sel) { const rs = ribbon(n, half * 1.7 + restHeight(c.mesh) * c.scale * 0.0025, closed, camera); setGeo(s.objs.sel, rs.pos, rs.idx); }
    if (s.objs.fill && s.tri && s.tri.length) {
      const fp = new Float32Array(n * 3); for (let i = 0; i < n; i++) _P[i].toArray(fp, i * 3);
      setGeo(s.objs.fill, fp, s.tri);
    } else if (s.objs.fill) s.objs.fill.visible = false;
  }
  const rr = v.renderer, origRender = rr.render.bind(rr);
  rr.render = (scene, camera) => {
    if (scene === v.scene && api.strokes.length) {
      charCache.clear();
      group.visible = api.state.show && !v._cloth3dHide;
      if (group.visible) for (const s of api.strokes) updateStroke(s, camera);
    }
    return origRender(scene, camera);
  };
  const origCapture = v.capture.bind(v);
  v.capture = (...a) => { v._cloth3dHide = !api.state.inCapture; try { return origCapture(...a); } finally { v._cloth3dHide = false; } };
  const changed = () => { try { api.onChange && api.onChange(); } catch (e) { console.warn(e); } };
  const refresh = () => { v.requestRender(); renderList(); changed(); };

  // ---------- undo history (snapshots of the stroke list; point arrays are never mutated, so sharing them is safe) ----
  const hist = [];
  const snap = () => api.strokes.filter((s) => s !== draft).map((s) => ({ id: s.id, cid: s.cid, tab: s.tab, color: s.color, mode: s.mode, width: s.width, tri: s.tri, pts: s.pts }));
  const pushHist = () => { hist.push(snap()); if (hist.length > 40) hist.shift(); };
  function setStrokes(list) {
    api.strokes.forEach(disposeObjs);
    api.strokes.length = 0; list.forEach((s) => api.strokes.push({ ...s }));
    if (!api.strokes.some((s) => s.id === api.state.selected)) api.state.selected = null;
  }
  api.undo = () => { const h = hist.pop(); if (!h) return false; setStrokes(h); refresh(); sync(); return true; };
  api.canUndo = () => hist.length > 0;

  // ---------- drawing -------------------------------------------------------------------------------------------------
  let draft = null, activePointer = null, lastXY = null;
  const cid = () => studio.activeCharacterId;
  function startStroke(x, y) {
    const anchor = { point: null };
    const r = pointFromScreen(cid(), x, y, anchor); if (!r) return false;
    pushHist();
    const selW = null;
    draft = { id: UID++, cid: cid(), tab: studio.activeTab, color: api.state.color, mode: api.state.mode, width: api.state.width, pts: [r.p], screen: [[x, y]], anchor, tri: [] };
    api.strokes.push(draft); lastXY = [x, y]; v.requestRender(); return true;
  }
  function addPoint(x, y, force) {
    if (!draft) return;
    const d = Math.hypot(x - lastXY[0], y - lastXY[1]);
    if (!force && d < 4) return;
    // fast finger: fill the gap with intermediate points (every ~5px) so the eraser can cut precisely later
    const steps = Math.min(12, Math.max(1, Math.round(d / 5)));
    for (let k = 1; k <= steps; k++) {
      const px = lastXY[0] + (x - lastXY[0]) * k / steps, py = lastXY[1] + (y - lastXY[1]) * k / steps;
      const r = pointFromScreen(draft.cid, px, py, draft.anchor); if (!r) continue;
      draft.pts.push(r.p); draft.screen.push([px, py]);
    }
    lastXY = [x, y]; v.requestRender();
  }
  function finishStroke() {
    const s = draft; if (!s) return null;
    if (s.pts.length < (s.mode === "fill" ? 3 : 2)) { draft = null; removeStroke(s.id, true); hist.pop(); return null; }
    if (s.mode === "fill") {
      const contour = s.screen.map((p) => new T.Vector2(p[0], p[1]));
      let tris = [];
      try { tris = T.ShapeUtils.triangulateShape(contour, []).flat(); } catch (e) { tris = []; }
      if (!tris.length) for (let i = 1; i < s.pts.length - 1; i++) tris.push(0, i, i + 1);   // fan fallback
      s.tri = tris;
    }
    delete s.screen; delete s.anchor;
    draft = null;
    refresh(); sync(); return s;
  }
  function cancelStroke() { if (draft) { const id = draft.id; draft = null; removeStroke(id, true); hist.pop(); } }
  function removeStroke(id, quiet) {
    const i = api.strokes.findIndex((s) => s.id === id); if (i < 0) return;
    disposeObjs(api.strokes[i]); api.strokes.splice(i, 1);
    if (api.state.selected === id) api.state.selected = null;
    if (!quiet) refresh(); else v.requestRender();
  }
  api.clear = (id = cid()) => { if (!api.strokes.some((s) => s.cid === id)) return; pushHist(); api.strokes.filter((s) => s.cid === id).forEach((s) => removeStroke(s.id, true)); refresh(); sync(); };
  api.remove = (id) => { pushHist(); removeStroke(id); sync(); };
  api.setWidth = (id, w) => { const s = api.strokes.find((q) => q.id === id); if (!s) return false; pushHist(); s.width = w; v.requestRender(); changed(); return true; };
  // programmatic drawing (used by tests, identical code path as pointer input)
  api.drawPath = (pts, opts = {}) => {
    Object.assign(api.state, opts);
    if (!startStroke(pts[0][0], pts[0][1])) return null;
    for (let i = 1; i < pts.length; i++) addPoint(pts[i][0], pts[i][1], true);
    return finishStroke();
  };

  // ---------- partial eraser ------------------------------------------------------------------------------------------
  // Works in SCREEN space on the skin-bound points: points under the brush are dropped; a line is cut there into pieces, the
  // surviving pieces keep their skin-bound points (so they stay attached to the doll). Filled shapes touched by the brush are removed whole.
  const _w = new T.Vector3();
  function projectStroke(s, c, rect) {
    const out = [];
    for (let i = 0; i < s.pts.length; i++) {
      worldPt(c, s.pts[i], _w); _w.project(v.camera);
      out.push([rect.left + ((_w.x + 1) / 2) * rect.width, rect.top + ((1 - _w.y) / 2) * rect.height, _w.z]);
    }
    return out;
  }
  function segDist(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    let t = L > 0 ? ((px - a[0]) * dx + (py - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  }
  function polyTouched(P, x, y, r) {
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      if (segDist(x, y, P[j], P[i]) < r) return true;
      if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) inside = !inside;
    }
    return inside;
  }
  function eraseAt(x, y, r, gest) {
    const rect = v.canvas.getBoundingClientRect(), ctxs = new Map();
    const next = []; let any = false;
    for (const s of api.strokes) {
      if (s === draft || s.tab !== studio.activeTab || !s.pts.length) { next.push(s); continue; }
      let c = ctxs.get(s.cid); if (c === undefined) { c = charCtx(s.cid, true); if (c) c.mesh.skeleton.update(); ctxs.set(s.cid, c || null); }
      if (!c || !c.mesh.visible) { next.push(s); continue; }
      const P = projectStroke(s, c, rect);
      if (s.mode === "fill") { if (polyTouched(P, x, y, r)) { any = true; continue; } next.push(s); continue; }
      const n = P.length, alive = P.map((p) => Math.hypot(p[0] - x, p[1] - y) >= r);
      const cut = new Array(n).fill(false);
      for (let i = 0; i < n - 1; i++) if (alive[i] && alive[i + 1] && segDist(x, y, P[i], P[i + 1]) < r) cut[i] = true;
      if (alive.every(Boolean) && !cut.some(Boolean)) { next.push(s); continue; }
      any = true;
      let a = -1;
      const flush = (b) => { if (a >= 0 && b - a + 1 >= 2) next.push({ id: UID++, cid: s.cid, tab: s.tab, color: s.color, mode: "line", width: s.width, tri: [], pts: s.pts.slice(a, b + 1) }); a = -1; };
      for (let i = 0; i < n; i++) {
        if (!alive[i]) { flush(i - 1); continue; }
        if (a < 0) a = i;
        if (cut[i]) flush(i);
      }
      flush(n - 1);
    }
    if (!any) return false;
    if (!gest.pushed) { pushHist(); gest.pushed = true; }
    api.strokes.forEach(disposeObjs);
    api.strokes.length = 0; next.forEach((s) => api.strokes.push(s));
    if (!api.strokes.some((s) => s.id === api.state.selected)) api.state.selected = null;
    gest.changed = true; v.requestRender(); return true;
  }
  api.eraseAt = (x, y, r = api.state.eraser) => eraseAt(x, y, r, { pushed: false });   // for tests; one history step per call
  let eraseG = null;

  const cv = v.canvas;
  const ringEl = el("div", "position:fixed;border:2px solid #fff;box-shadow:0 0 0 1px #000;border-radius:50%;pointer-events:none;z-index:9996;display:none;box-sizing:border-box");
  document.body.appendChild(ringEl);
  const ring = (x, y) => { const d = api.state.eraser * 2; ringEl.style.width = d + "px"; ringEl.style.height = d + "px"; ringEl.style.left = (x - d / 2) + "px"; ringEl.style.top = (y - d / 2) + "px"; ringEl.style.display = api.state.on && api.state.tool === "erase" ? "block" : "none"; };
  const swallow = (e) => { e.stopImmediatePropagation(); e.preventDefault(); };
  const drawing = () => api.state.on && api.state.tool !== "nav";
  const pointers = new Set();
  // Two fingers while pen/eraser is active = move the CAMERA (pinch = zoom, both fingers sliding = pan). The vendor's own
  // handlers never see these touches (we swallow them so a stroke is not drawn by accident), so the camera is moved here.
  const tpos = new Map(); let gLast = null;
  const gesture = () => {
    const [a, b] = [...tpos.values()]; if (!a || !b) { gLast = null; return; }
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d = Math.hypot(a.x - b.x, a.y - b.y);
    if (gLast && d > 0 && gLast.d > 0) {
      const cam = v.camera, tg = v.orbit.target, h = cv.getBoundingClientRect().height || 1;
      const dist = cam.position.distanceTo(tg), k = (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) / h;
      const right = new T.Vector3().setFromMatrixColumn(cam.matrix, 0), up = new T.Vector3().setFromMatrixColumn(cam.matrix, 1);
      const pan = right.multiplyScalar(-(mid.x - gLast.x) * k).add(up.multiplyScalar((mid.y - gLast.y) * k));
      cam.position.add(pan); tg.add(pan);
      cam.position.sub(tg).multiplyScalar(Math.min(1.25, Math.max(0.8, gLast.d / d))).add(tg);
      v.orbit.update(); v.requestRender();
    }
    gLast = { x: mid.x, y: mid.y, d };
  };
  cv.addEventListener("pointerdown", (e) => {
    if (!drawing()) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;         // middle/right mouse keep pan/rotate
    pointers.add(e.pointerId);
    if (e.pointerType === "touch") { tpos.set(e.pointerId, { x: e.clientX, y: e.clientY }); gLast = null; }
    if (pointers.size > 1) { cancelStroke(); eraseG = null; ringEl.style.display = "none"; swallow(e); if (tpos.size === 2) gesture(); return; }   // 2nd finger: drop the stroke, move the camera instead
    swallow(e);
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    activePointer = e.pointerId;
    if (api.state.tool === "erase") { eraseG = { pushed: false, changed: false }; ring(e.clientX, e.clientY); eraseAt(e.clientX, e.clientY, api.state.eraser, eraseG); }
    else startStroke(e.clientX, e.clientY);
  }, true);
  cv.addEventListener("pointermove", (e) => {
    if (tpos.has(e.pointerId)) { tpos.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (tpos.size === 2) { swallow(e); gesture(); return; } }
    if (api.state.on && api.state.tool === "erase" && (e.pointerType === "mouse" || pointers.has(e.pointerId))) ring(e.clientX, e.clientY);
    if (!drawing() && !draft && !eraseG) return;
    if (e.pointerType === "mouse" && !draft && !eraseG && e.buttons === 0) return;
    if (draft || eraseG || pointers.has(e.pointerId)) swallow(e);
    if (e.pointerId === activePointer) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ce of evs.length ? evs : [e]) {
        if (draft) addPoint(ce.clientX, ce.clientY);
        else if (eraseG) eraseAt(ce.clientX, ce.clientY, api.state.eraser, eraseG);
      }
    }
  }, true);
  const up = (cancel) => (e) => {
    tpos.delete(e.pointerId); gLast = null;
    if (!pointers.has(e.pointerId) && !draft && !eraseG) return;
    swallow(e); pointers.delete(e.pointerId);
    if (e.pointerId === activePointer) {
      activePointer = null;
      if (eraseG) { const g = eraseG; eraseG = null; ringEl.style.display = "none"; if (g.changed) { refresh(); sync(); } }
      else if (cancel) cancelStroke(); else { addPoint(e.clientX, e.clientY, false); finishStroke(); }
    }
  };
  cv.addEventListener("pointerup", up(false), true);
  cv.addEventListener("pointercancel", up(true), true);

  // ---------- persistence ---------------------------------------------------------------------------------------------
  const r5 = (n) => Math.round(n * 1e4) / 1e4;
  api.serialize = (id) => api.strokes.filter((s) => s.cid === id && s.pts.length && s !== draft).map((s) => ({
    tab: s.tab, color: s.color, mode: s.mode, width: r5(wOf(s)), tri: s.tri || [],
    pts: s.pts.map((p) => [r5(p.v.x), r5(p.v.y), r5(p.v.z), ...p.idx.flatMap((ix, k) => [ix, r5(p.w[k])])]),
  }));
  api.restore = (id, arr) => {
    api.strokes.filter((s) => s.cid === id).forEach((s) => removeStroke(s.id, true));
    for (const d of arr || []) {
      api.strokes.push({ id: UID++, cid: id, tab: d.tab || 0, color: d.color, mode: d.mode, width: typeof d.width === "number" ? d.width : (OLD_WIDTHS[d.width] || DEF_W), tri: d.tri || [],
        pts: d.pts.map((q) => ({ v: new T.Vector3(q[0], q[1], q[2]), idx: [q[3], q[5], q[7], q[9]], w: [q[4], q[6], q[8], q[10]] })) });
    }
    refresh();
  };
  api.clearAll = () => { api.strokes.slice().forEach((s) => removeStroke(s.id, true)); hist.length = 0; refresh(); sync(); };   // scene load: also forgets undo history

  // ---------- bottom sheet (Bengali) ----------------------------------------------------------------------------------
  const ui = studio.ui;
  const tool = ui.addTool("cloth", "\u270F\uFE0F \u09AA\u09CB\u09B6\u09BE\u0995", { title: "\u09AA\u09CB\u09B6\u09BE\u0995\u09C7\u09B0 \u09B0\u09C7\u0996\u09BE \u0986\u0981\u0995\u09BE",
    onOpen: () => { api.state.on = true; if (api.state.tool === "nav") api.state.tool = "draw"; sync(); }, onClose: () => { api.state.on = false; cancelStroke(); eraseG = null; ringEl.style.display = "none"; sync(); } });
  const panel = tool.body;
  const quickBtn = btn(tool.quick, "\u270B", () => { api.state.tool = api.state.tool === "nav" ? "draw" : "nav"; sync(); }, "min-width:34px;height:26px;border-radius:13px;padding:0 6px");   // quick pen <-> turn-the-view switch (works while collapsed)
  const r1 = row(panel), r2 = row(panel), r3 = row(panel), r4 = row(panel), r5b = row(panel);
  const drawBtn = btn(r1, "\u270F\uFE0F \u0986\u0981\u0995\u09C1\u09A8", () => { api.state.tool = "draw"; sync(); });
  const eraseBtn = btn(r1, "\u{1F9FD} \u09B0\u09BE\u09AC\u09BE\u09B0", () => { api.state.tool = "erase"; sync(); });
  const navBtn = btn(r1, "\u270B \u0998\u09C1\u09B0\u09BF\u09DF\u09C7 \u09A6\u09C7\u0996\u09C1\u09A8", () => { api.state.tool = "nav"; sync(); });
  const lineBtn = btn(r1, "\u2571 \u09B2\u09BE\u0987\u09A8", () => { api.state.mode = "line"; api.state.tool = "draw"; sync(); });
  const fillBtn = btn(r1, "\u25A0 \u09AD\u09B0\u09BE\u099F", () => { api.state.mode = "fill"; api.state.tool = "draw"; sync(); });
  const swatches = PALETTE.map((c) => btn(r2, "", () => { api.state.color = c; if (api.state.tool !== "draw") api.state.tool = "draw"; sync(); }, `background:${c};min-width:34px;height:30px`));
  // width slider (pen) / brush size slider (eraser); with a stroke selected below, the width slider edits THAT stroke
  const wLab = el("span", "flex:none;width:96px;font-size:12px");
  const wSl = el("input", "flex:1;min-width:100px;height:30px"); wSl.type = "range"; wSl.min = 2; wSl.max = 40; wSl.step = 0.5;
  const wVal = el("span", "flex:none;width:30px;text-align:right;opacity:.85");
  r3.append(wLab, wSl, wVal);
  let wGest = false;
  const slBegin = () => { wGest = false; };
  wSl.addEventListener("pointerdown", slBegin); wSl.addEventListener("touchstart", slBegin, { passive: true });
  wSl.addEventListener("input", () => {
    const val = parseFloat(wSl.value);
    if (api.state.tool === "erase") { api.state.eraser = val; wVal.textContent = String(val); return; }
    const sel = api.strokes.find((s) => s.id === api.state.selected);
    if (sel) { if (!wGest) { pushHist(); wGest = true; } sel.width = val / 1000; v.requestRender(); changed(); }
    else api.state.width = val / 1000;
    wVal.textContent = String(val);
  });
  wSl.addEventListener("change", () => { wGest = false; });
  btn(r4, "\u21B6 \u0986\u0997\u09C7\u09B0\u099F\u09BE", () => api.undo());
  btn(r4, "\u{1F5D1} \u09B8\u09AC \u09AE\u09C1\u099B\u09C1\u09A8", () => api.clear());
  const xrayBtn = btn(r4, "\u{1F441} \u09AA\u09BF\u099B\u09A8\u09C7\u0993 \u09A6\u09C7\u0996\u09BE", () => { api.state.xray = !api.state.xray; sync(); v.requestRender(); });
  const showBtn = btn(r4, "\u09B0\u09C7\u0996\u09BE \u09A6\u09C7\u0996\u09BE\u09A8", () => { api.state.show = !api.state.show; sync(); v.requestRender(); });
  const capBtn = btn(r4, "\u099B\u09AC\u09BF\u09A4\u09C7 \u09A8\u09BF\u09A8", () => { api.state.inCapture = !api.state.inCapture; sync(); });
  btn(r4, "\u25C0", () => cycle(-1));
  const dollSel = el("span", "opacity:.9"); r4.appendChild(dollSel);
  btn(r4, "\u25B6", () => cycle(1));
  const listBox = r5b;
  function cycle(d) {
    const ids = studio.characters.map((c) => c.id); const i = ids.indexOf(studio.activeCharacterId);
    studio.selectCharacter(ids[(i + d + ids.length) % ids.length]); setTimeout(sync, 400);
  }
  function renderList() {
    listBox.innerHTML = "";
    const mine = api.strokes.filter((s) => s.cid === cid() && s !== draft);
    listBox.style.display = mine.length ? "flex" : "none";
    listBox.appendChild(el("span", "font-size:12px", "\u09B0\u09C7\u0996\u09BE (\u099B\u09C1\u0981\u09DF\u09C7 \u09AC\u09C7\u099B\u09C7 \u09AE\u09CB\u099F\u09BE-\u09B8\u09B0\u09C1 \u09AC\u09A6\u09B2\u09BE\u09A8):"));
    mine.forEach((s, i) => {
      const sel = api.state.selected === s.id;
      const g = el("span", "display:inline-flex");
      const b1 = btn(g, `<span style="display:inline-block;width:11px;height:11px;background:${s.color};border:1px solid #fff;margin-right:3px"></span>${s.mode === "fill" ? "\u25A0" : "\u2571"}${i + 1}`, () => { api.state.selected = sel ? null : s.id; sync(); v.requestRender(); }, "height:28px;min-width:20px;font-size:12px;border-radius:8px 0 0 8px;padding:0 6px");
      mark(b1, sel);
      btn(g, "\u2715", () => api.remove(s.id), "height:28px;min-width:20px;font-size:12px;border-radius:0 8px 8px 0;padding:0 6px;border-left:0");
      listBox.appendChild(g);
    });
  }
  function sync() {
    const s = api.state;
    mark(drawBtn, s.tool === "draw"); mark(eraseBtn, s.tool === "erase"); mark(navBtn, s.tool === "nav");
    mark(lineBtn, s.mode === "line"); mark(fillBtn, s.mode === "fill");
    swatches.forEach((b, i) => { b.style.borderColor = PALETTE[i] === s.color ? "#4cf" : "#666"; b.style.borderWidth = PALETTE[i] === s.color ? "3px" : "2px"; });
    quickBtn.innerHTML = s.tool === "nav" ? "\u270F\uFE0F" : "\u270B"; mark(quickBtn, s.tool === "nav");
    mark(xrayBtn, s.xray); mark(showBtn, s.show); mark(capBtn, s.inCapture);
    const sel = api.strokes.find((q) => q.id === s.selected);
    if (s.tool === "erase") { wLab.textContent = "\u09B0\u09BE\u09AC\u09BE\u09B0\u09C7\u09B0 \u09B8\u09BE\u0987\u099C"; wLab.style.color = "#fff"; wSl.min = 6; wSl.max = 60; wSl.step = 1; wSl.value = s.eraser; wVal.textContent = String(s.eraser); }
    else {
      wSl.min = 2; wSl.max = 40; wSl.step = 0.5;
      const w = sel ? wOf(sel) : s.width; wSl.value = w * 1000; wVal.textContent = String(Math.round(w * 1000 * 2) / 2);
      wLab.textContent = sel ? "\u09AE\u09CB\u099F\u09BE (\u09AC\u09BE\u099B\u09BE \u09B0\u09C7\u0996\u09BE)" : "\u09AE\u09CB\u099F\u09BE (\u09A8\u09A4\u09C1\u09A8 \u09B0\u09C7\u0996\u09BE)"; wLab.style.color = sel ? "#fc6" : "#fff";
    }
    const ch = studio.getActiveCharacter?.(); dollSel.textContent = "\u09AA\u09C1\u09A4\u09C1\u09B2: " + (ch?.name || ch?.id || "?");
    cv.style.cursor = s.on && s.tool === "draw" ? "crosshair" : "";
    if (s.tool !== "erase") ringEl.style.display = "none";
    renderList();
  }
  sync();
  studio.cloth3d = api; window.__cloth3d = api;
  return api;
}
