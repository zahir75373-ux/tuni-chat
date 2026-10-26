// Shared phone-friendly toolbar + bottom sheets for the standalone additions (v6).
// ONE small toolbar (position / group / clothing) sits just above the vendor's Undo-Redo row; tapping a tool opens ONE
// bottom sheet (only one sheet at a time), so the new buttons never pile up on the top bar (- + A- A+).
export const FONT = "13px sans-serif";
export function el(tag, css = "", text = "") { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text) e.textContent = text; return e; }
export function btn(parent, text, fn, css = "") {
  const b = el("button", "min-width:34px;height:32px;font:" + FONT + ";padding:0 8px;border-radius:8px;border:2px solid #666;background:#2a2a3a;color:#fff;touch-action:manipulation;white-space:nowrap;" + css);
  b.innerHTML = text; b.addEventListener("click", fn); parent && parent.appendChild(b); return b;
}
export const mark = (b, on) => { b.style.borderColor = on ? "#4cf" : "#666"; b.style.background = on ? "#27406a" : "#2a2a3a"; };
export function row(parent, css = "") { const r = el("div", "display:flex;align-items:center;gap:4px;margin:3px 0;flex-wrap:wrap;" + css); parent.appendChild(r); return r; }

export function install(studio) {
  if (studio.ui) return studio.ui;
  const ui = { tools: new Map(), openId: null };
  // popup placement (remembered on this phone): pos = "top" | "bottom", cx = horizontal centre in px (null = centred), min = collapsed to a small tab
  const KEY = "ps-sheet-v1";
  ui.sheetState = { pos: "bottom", cx: null, min: false };
  try { Object.assign(ui.sheetState, JSON.parse(localStorage.getItem(KEY) || "{}"), { min: false }); } catch (_) {}
  ui.saveSheet = () => { try { localStorage.setItem(KEY, JSON.stringify({ pos: ui.sheetState.pos, cx: ui.sheetState.cx })); } catch (_) {} };
  ui.layout = () => {
    const t = ui.tools.get(ui.openId); if (!t) return;
    const S = ui.sheetState, sh = t.sheet;
    sh.style.width = S.min ? "auto" : "min(96vw,560px)";
    sh.style.minWidth = S.min ? "150px" : "";
    sh.style.maxWidth = "96vw";
    t.body.style.display = S.min ? "none" : "";
    t.bMin.innerHTML = S.min ? "\u25A2" : "\u2581"; t.bMin.title = S.min ? "\u09AC\u09DC \u0995\u09B0\u09C1\u09A8" : "\u099B\u09CB\u099F \u0995\u09B0\u09C1\u09A8";
    sh.style.display = "flex"; sh.style.transform = "none";
    const w = sh.getBoundingClientRect().width;
    const cx = S.cx == null ? innerWidth / 2 : S.cx;
    sh.style.left = Math.max(2, Math.min(innerWidth - w - 2, cx - w / 2)) + "px";
    if (S.pos === "top") {
      const tb = document.getElementById("topBar"); let y = 4;
      if (tb) { const q = tb.getBoundingClientRect(); if (q.height) y = Math.round(q.bottom + 4); }
      sh.style.top = y + "px"; sh.style.bottom = "auto"; sh.style.maxHeight = Math.max(90, Math.round(innerHeight * 0.36)) + "px";
    } else { sh.style.top = "auto"; sh.style.bottom = "4px"; sh.style.maxHeight = Math.max(90, Math.round(innerHeight * 0.36)) + "px"; }
  };
  ui.setPos = (p) => { ui.sheetState.pos = p; ui.saveSheet(); ui.layout(); };
  ui.setMin = (m) => { ui.sheetState.min = !!m; ui.layout(); };
  window.addEventListener("resize", () => ui.layout());
  const bar = el("div", "position:fixed;z-index:9990;display:flex;flex-wrap:wrap;gap:5px;justify-content:center;align-content:flex-end;touch-action:manipulation;left:50%;transform:translateX(-50%);bottom:130px;width:96px");
  bar.id = "psToolbar";
  document.body.appendChild(bar);

  ui.addTool = (id, label, { title, onOpen, onClose } = {}) => {
    const b = btn(bar, label, () => ui.toggle(id), "flex:1 1 88px;height:34px;border-radius:17px;border:1px solid #888;background:rgba(30,30,40,.88);padding:0 6px;font-size:13px");
    b.id = "tool_" + id; if (title) b.title = title;
    // compact floating popup: small (max ~36% of the screen height, scrolls inside), movable top/bottom, collapsible to a small tab.
    // Only the popup's own rectangle takes touches; the 3D canvas around it keeps every gesture (nothing here is a full-screen overlay).
    const sheet = el("div", "position:fixed;z-index:9995;display:none;flex-direction:column;width:min(96vw,560px);max-height:36vh;background:rgba(18,18,28,.95);border:1px solid #888;border-radius:12px;padding:3px 8px 4px;color:#fff;font:" + FONT + ";touch-action:manipulation;box-sizing:border-box;pointer-events:auto");
    sheet.id = "sheet_" + id;
    const head = el("div", "display:flex;align-items:center;gap:5px;flex:none;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none");
    head.id = "sheetHead_" + id;
    head.appendChild(el("span", "font-size:16px;opacity:.7;flex:none", "\u283F"));             // ⠿ drag handle
    head.appendChild(el("b", "font-size:14px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", label));
    const quick = el("span", "display:inline-flex;gap:4px;flex:none"); head.appendChild(quick);
    const HB = "min-width:34px;height:26px;border-radius:13px;padding:0 6px";
    const bMove = btn(head, "\u21C5", () => ui.setPos(ui.sheetState.pos === "top" ? "bottom" : "top"), HB);   // ⇅ top <-> bottom
    bMove.title = "\u0989\u09AA\u09B0\u09C7/\u09A8\u09BF\u099A\u09C7";
    const bMin = btn(head, "\u2581", () => ui.setMin(!ui.sheetState.min), HB);                              // ▁ collapse / expand
    bMin.title = "\u099B\u09CB\u099F \u0995\u09B0\u09C1\u09A8";
    btn(head, "\u2715", () => ui.close(), HB);
    sheet.appendChild(head);
    const body = el("div", "flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;-webkit-overflow-scrolling:touch");
    sheet.appendChild(body);
    document.body.appendChild(sheet);
    // drag by the header: free left/right, on release it snaps to the top or the bottom edge; remembered
    let drag = null;
    head.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const r = sheet.getBoundingClientRect(); drag = { id: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top, moved: false };
      try { head.setPointerCapture(e.pointerId); } catch (_) {}
      head.style.cursor = "grabbing";
    });
    head.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return; drag.moved = true;
      const r = sheet.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - r.width, e.clientX - drag.ox)), y = Math.max(0, Math.min(innerHeight - r.height, e.clientY - drag.oy));
      sheet.style.transform = "none"; sheet.style.left = x + "px"; sheet.style.top = y + "px"; sheet.style.bottom = "auto";
      drag.x = x; drag.y = y; drag.w = r.width; drag.h = r.height;
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null; head.style.cursor = "grab";
      if (!d.moved) return;
      ui.sheetState.cx = d.x + d.w / 2; ui.sheetState.pos = d.y + d.h / 2 < innerHeight / 2 ? "top" : "bottom"; ui.saveSheet(); ui.layout();
    };
    head.addEventListener("pointerup", endDrag); head.addEventListener("pointercancel", endDrag);
    const t = { id, button: b, sheet, body, head, quick, bMin, onOpen, onClose };
    ui.tools.set(id, t); return t;
  };
  ui.open = (id) => {
    const t = ui.tools.get(id); if (!t) return;
    if (ui.openId && ui.openId !== id) ui.close();
    ui.openId = id; ui.sheetState.min = false; ui.layout(); bar.style.visibility = "hidden";
    try { t.onOpen && t.onOpen(); } catch (e) { console.warn(e); }
  };
  ui.close = () => {
    const t = ui.tools.get(ui.openId); if (!t) { bar.style.visibility = "visible"; return; }
    ui.openId = null; t.sheet.style.display = "none"; bar.style.visibility = "visible";
    try { t.onClose && t.onClose(); } catch (e) { console.warn(e); }
  };
  ui.toggle = (id) => (ui.openId === id ? ui.close() : ui.open(id));

  // anchor the toolbar right above the vendor Undo/Redo row, as wide as that row (portrait: narrow column -> buttons stack)
  function place() {
    // a vendor pop-up (Pose Library, save dialog ...) is open -> hide our floating buttons so nothing sits on top of it
    const mo = [...document.querySelectorAll(".vnccs-ps-modal-overlay")].some((m) => { const q = m.getBoundingClientRect(); return q.width > 40 && q.height > 40 && getComputedStyle(m).display !== "none" && getComputedStyle(m).visibility !== "hidden"; });
    const topEl = document.getElementById("topBar");
    const vis = mo ? "hidden" : "";
    if (topEl) topEl.style.visibility = vis;
    for (const t of ui.tools.values()) if (t.sheet) t.sheet.style.visibility = vis;
    if (mo) { bar.style.visibility = "hidden"; return; }
    if (!ui.openId) bar.style.visibility = "visible";
    const act = studio.container.querySelector(".vnccs-ps-actions");
    if (!act) return;
    const r = act.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const narrow = r.width < 84;                       // very narrow phone (about 360px wide): icons only, stacked
    const w = narrow ? 44 : Math.max(96, Math.min(r.width, 520));
    bar.style.width = w + "px";
    bar.style.left = (r.left + r.width / 2) + "px";
    bar.style.bottom = Math.max(4, innerHeight - r.top + 6) + "px";
    for (const t of ui.tools.values()) {
      const b = t.button; if (!b._full) b._full = b.innerHTML;
      const want = narrow ? b._full.split(" ")[0] : b._full;
      if (b.innerHTML !== want) b.innerHTML = want;
      b.style.flex = narrow ? "none" : "1 1 88px"; b.style.width = narrow ? "40px" : ""; b.style.minWidth = narrow ? "40px" : "34px";
      b.style.fontSize = narrow ? "18px" : "13px"; b.style.padding = narrow ? "0" : "0 6px";
    }
    // phone portrait: the +/-/A-/A+ bar would sit on top of the "Pose Library" button -> put it in the free column above the doll
    const top = document.getElementById("topBar");
    if (top) {
      if (!top._orig) top._orig = top.style.cssText;
      if (innerWidth < 600) {
        top.style.cssText = top._orig + ";left:" + (r.left + r.width / 2) + "px;top:46px;width:" + (narrow ? 44 : Math.max(92, r.width)) + "px;flex-wrap:wrap;justify-content:center;gap:4px" + (narrow ? ";flex-direction:column;align-items:center" : "");
        if (narrow) for (const c of top.children) { c.style.minWidth = "40px"; c.style.height = "28px"; c.style.fontSize = "14px"; c.style.padding = "0"; }
      } else if (top.style.cssText !== top._orig) top.style.cssText = top._orig;
    }
  }
  setInterval(place, 350); window.addEventListener("resize", place); place();
  ui.place = place; ui.bar = bar;
  studio.ui = ui; return ui;
}
