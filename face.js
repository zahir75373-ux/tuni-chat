/* Auto-find the mouth (and eyes) with MediaPipe Face Landmarker, all files self-hosted. */
'use strict';
var Face = (function () {
  var landmarker = null, loading = null;

  function load() {
    if (landmarker) return Promise.resolve(landmarker);
    if (loading) return loading;
    loading = import('./vendor/mediapipe/vision_bundle.mjs').then(function (mp) {
      return mp.FilesetResolver.forVisionTasks('vendor/mediapipe/wasm').then(function (fs) {
        return mp.FaceLandmarker.createFromOptions(fs, {
          baseOptions: { modelAssetPath: 'vendor/mediapipe/face_landmarker.task', delegate: 'CPU' },
          runningMode: 'IMAGE', numFaces: 1, minFaceDetectionConfidence: 0.3, minFacePresenceConfidence: 0.3
        });
      });
    }).then(function (l) { landmarker = l; return l; }, function (e) { loading = null; throw e; });
    return loading;
  }

  // canvas -> {mouth:{x,y,w,chin}, eyes:[{x,y,w,h}] } (all 0..1 of the image) or null
  function find(canvas) {
    return load().then(function (l) {
      var res = l.detect(canvas);
      var lm = res && res.faceLandmarks && res.faceLandmarks[0];
      if (!lm) return null;
      var W = canvas.width, H = canvas.height;
      function P(i) { return { x: lm[i].x * W, y: lm[i].y * H }; }
      var a = P(61), b = P(291), u = P(13), d = P(14), chin = P(152);
      var mw = Math.hypot(b.x - a.x, b.y - a.y);
      var out = { mouth: { x: ((a.x + b.x) / 2) / W, y: ((u.y + d.y) / 2) / H, w: mw / W, chin: chin.y / H }, eyes: [] };
      [[33, 133, 159, 145], [362, 263, 386, 374]].forEach(function (e) {
        var c1 = P(e[0]), c2 = P(e[1]), t = P(e[2]), bt = P(e[3]);
        out.eyes.push({ x: ((c1.x + c2.x) / 2) / W, y: ((t.y + bt.y) / 2) / H, w: Math.hypot(c2.x - c1.x, c2.y - c1.y) / W, h: Math.max(Math.abs(bt.y - t.y), mw * 0.18) / H });
      });
      return out;
    });
  }
  return { load: load, find: find };
})();
