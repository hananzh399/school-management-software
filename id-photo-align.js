/* ==========================================================================
   id-photo-align.js  —  ID-card photo auto-alignment (shared: students + staff)

   What it does
   ------------
   Takes any uploaded portrait (full-body, off-centre, wide, face too small…)
   and re-frames it to the ID-card photo box so the FACE is centred, properly
   sized (head + a little shoulder) and never cut off. The result is a plain
   pre-cropped image, so it looks identical on screen, in PNG download, and in
   print (html2canvas does not honour `object-position`, so CSS alone can't do it).

   Face detection tiers (first one that works is used):
     1. Native browser FaceDetector API          (Chrome/Edge/Android, if enabled)
     2. MediaPipe Face Detector (lazy CDN load)  (accurate, works in all modern browsers online)
     3. Built-in skin-tone blob finder           (offline fallback, no libraries)
     4. Portrait heuristic (face assumed in upper-middle of the photo)

   Public API
   ----------
     IdPhotoAlign.frame(src)              -> Promise<dataURL>   aligned image
     IdPhotoAlign.applyToCards(rootEl)    -> Promise            aligns every photo inside
                                             .idc-card-photo / .sidc-card-photo under rootEl
     IdPhotoAlign.ready()                 -> Promise            resolves when all pending work is done
   ========================================================================== */
(function (global) {
    'use strict';

    // Output canvas — same aspect as the card photo box (80 x 90 => 8:9), 4x for print sharpness.
    var OUT_W = 320, OUT_H = 360;
    var ASPECT = OUT_W / OUT_H;

    // Framing targets (fractions of the output frame).
    var HEAD_TO_FRAME = 0.60;   // head (hair→chin) ≈ 60% of frame height
    var FACE_BOX_TO_HEAD = 1.40;// detector "face box" is tighter than the whole head
    var FACE_CENTER_Y = 0.42;   // face centre sits 42% down from the top

    var MP_VERSION = '0.10.14';
    var MP_BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VERSION + '/vision_bundle.mjs';
    var MP_WASM   = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VERSION + '/wasm';
    var MP_MODEL  = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

    var cache = new Map();          // src -> Promise<dataURL>
    var pending = new Set();        // in-flight promises (for ready())
    var nativeDetector = null, nativeTried = false;
    var mpDetectorPromise = null;

    /* ---------- image loading ---------- */
    function loadImage(src) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            if (!/^data:|^blob:/i.test(src)) img.crossOrigin = 'anonymous';
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('image load failed')); };
            img.src = src;
        });
    }

    /* ---------- tier 1: native FaceDetector ---------- */
    async function detectNative(img) {
        if (!('FaceDetector' in global)) return null;
        try {
            if (!nativeTried) { nativeTried = true; nativeDetector = new global.FaceDetector({ fastMode: false, maxDetectedFaces: 5 }); }
            if (!nativeDetector) return null;
            var faces = await nativeDetector.detect(img);
            return pickLargest(faces.map(function (f) {
                var b = f.boundingBox; return { x: b.x, y: b.y, w: b.width, h: b.height };
            }));
        } catch (e) { nativeDetector = null; return null; }
    }

    /* ---------- tier 2: MediaPipe (lazy, optional) ---------- */
    function getMediaPipe() {
        if (mpDetectorPromise) return mpDetectorPromise;
        mpDetectorPromise = (async function () {
            var work = (async function () {
                var vision = await import(MP_BUNDLE);
                var fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
                return vision.FaceDetector.createFromOptions(fileset, {
                    baseOptions: { modelAssetPath: MP_MODEL, delegate: 'CPU' },
                    runningMode: 'IMAGE',
                    minDetectionConfidence: 0.5
                });
            })();
            var timeout = new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, 12000); });
            return Promise.race([work, timeout]);
        })().catch(function () { return null; }); // offline / blocked → fall through to tier 3
        return mpDetectorPromise;
    }

    async function detectMediaPipe(img) {
        var det = await getMediaPipe();
        if (!det) return null;
        try {
            var res = det.detect(img);
            var boxes = (res.detections || []).map(function (d) {
                var b = d.boundingBox; return { x: b.originX, y: b.originY, w: b.width, h: b.height };
            });
            return pickLargest(boxes);
        } catch (e) { return null; }
    }

    /* ---------- tier 3: skin-tone blob finder (no libraries) ---------- */
    function detectSkin(img) {
        var iw = img.naturalWidth, ih = img.naturalHeight;
        var scale = 96 / Math.max(iw, ih);
        var w = Math.max(8, Math.round(iw * scale)), h = Math.max(8, Math.round(ih * scale));
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        var data;
        try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { return null; } // tainted canvas

        var mask = new Uint8Array(w * h);
        for (var i = 0, p = 0; i < mask.length; i++, p += 4) {
            var r = data[p], g = data[p + 1], b = data[p + 2];
            var Y  = 0.299 * r + 0.587 * g + 0.114 * b;
            var Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
            var Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
            // Wide skin range (covers light → dark skin), plus an RGB sanity check.
            if (Y > 40 && Cb >= 77 && Cb <= 130 && Cr >= 132 && Cr <= 175 && r > g && r > b * 0.9) mask[i] = 1;
        }

        // Connected components (4-neighbour), pick the best by area × centrality × upper-position.
        var seen = new Uint8Array(w * h), best = null, bestScore = 0, stack = [];
        for (var s = 0; s < mask.length; s++) {
            if (!mask[s] || seen[s]) continue;
            var minX = w, maxX = 0, minY = h, maxY = 0, area = 0;
            stack.length = 0; stack.push(s); seen[s] = 1;
            while (stack.length) {
                var idx = stack.pop(), x = idx % w, y = (idx / w) | 0;
                area++;
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                if (x > 0     && mask[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; stack.push(idx - 1); }
                if (x < w - 1 && mask[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; stack.push(idx + 1); }
                if (y > 0     && mask[idx - w] && !seen[idx - w]) { seen[idx - w] = 1; stack.push(idx - w); }
                if (y < h - 1 && mask[idx + w] && !seen[idx + w]) { seen[idx + w] = 1; stack.push(idx + w); }
            }
            if (area < w * h * 0.012) continue;
            var cx = (minX + maxX) / 2 / w, cy = (minY + maxY) / 2 / h;
            var centrality = 1 - Math.min(1, Math.abs(cx - 0.5) * 1.6);
            var upper = cy < 0.72 ? 1 : 0.45; // faces are in the upper part; legs/hands lower down
            var score = area * (0.4 + centrality) * upper;
            if (score > bestScore) { bestScore = score; best = { minX: minX, maxX: maxX, minY: minY, maxY: maxY, area: area }; }
        }
        if (!best) return null;

        var bw = best.maxX - best.minX + 1, bh = best.maxY - best.minY + 1;
        // Blob likely includes neck/chest: a face is roughly as tall as it is wide (×1.25).
        if (bh > bw * 1.3) bh = bw * 1.25;
        // Blob wider than tall by a lot ⇒ arms/shoulders merged in; trim to a face-like width, centred on the densest column.
        var faceW = bw;
        if (bw > bh * 1.15) faceW = bh * 0.85;
        var boxCx = (best.minX + best.maxX) / 2;

        return { x: (boxCx - faceW / 2) / scale, y: best.minY / scale, w: faceW / scale, h: bh / scale };
    }

    function pickLargest(boxes) {
        if (!boxes || !boxes.length) return null;
        return boxes.reduce(function (a, b) { return (b.w * b.h > a.w * a.h) ? b : a; });
    }

    /* ---------- crop maths ---------- */
    function computeCrop(iw, ih, face) {
        var cw, ch, cx, cy;
        if (face) {
            ch = (face.h * FACE_BOX_TO_HEAD) / HEAD_TO_FRAME;
            cw = ch * ASPECT;
            // Never wider/taller than the source photo.
            var maxH = Math.min(ih, iw / ASPECT);
            if (ch > maxH) { ch = maxH; cw = ch * ASPECT; }
            // Never so tight that the face gets cropped: keep at least 1.6× face height.
            var minH = Math.min(maxH, face.h * 1.6);
            if (ch < minH) { ch = minH; cw = ch * ASPECT; }
            var fcx = face.x + face.w / 2, fcy = face.y + face.h / 2;
            cx = fcx - cw / 2;
            cy = fcy - ch * FACE_CENTER_Y;
        } else {
            // Heuristic: typical ID/portrait photo — face in the upper-middle. Fill the frame, bias to the top.
            ch = Math.min(ih, iw / ASPECT);
            cw = ch * ASPECT;
            cx = (iw - cw) / 2;
            cy = (ih - ch) * (ih > iw * 1.15 ? 0.12 : 0.3);
        }
        cx = Math.max(0, Math.min(iw - cw, cx));
        cy = Math.max(0, Math.min(ih - ch, cy));
        return { x: cx, y: cy, w: cw, h: ch };
    }

    /* ---------- main: align one image ---------- */
    async function doFrame(src) {
        var img = await loadImage(src);
        var iw = img.naturalWidth, ih = img.naturalHeight;
        if (!iw || !ih) return src;

        var face = await detectNative(img);
        if (!face) face = await detectMediaPipe(img);
        if (!face) face = detectSkin(img);

        var crop = computeCrop(iw, ih, face);
        var canvas = document.createElement('canvas');
        canvas.width = OUT_W; canvas.height = OUT_H;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, OUT_W, OUT_H);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, OUT_W, OUT_H);
        try { return canvas.toDataURL('image/jpeg', 0.92); } catch (e) { return src; }
    }

    function frame(src) {
        if (!src) return Promise.resolve(src);
        if (cache.has(src)) return cache.get(src);
        var p = doFrame(src).catch(function () { return src; }); // any failure → keep original photo
        cache.set(src, p);
        return p;
    }

    /* ---------- apply to rendered ID cards ---------- */
    function applyToCards(root) {
        root = root || document;
        var imgs = root.querySelectorAll('.idc-card-photo img, .sidc-card-photo img');
        var jobs = Array.prototype.map.call(imgs, function (im) {
            if (im.dataset.aligned === '1') return Promise.resolve();
            var src = im.getAttribute('src');
            if (!src) return Promise.resolve();
            return frame(src).then(function (out) {
                if (!im.isConnected) return;
                im.dataset.aligned = '1';
                if (out && out !== src) {
                    return new Promise(function (res) {
                        im.onload = im.onerror = function () { res(); };
                        im.src = out;
                    });
                }
            });
        });
        var all = Promise.all(jobs);
        pending.add(all);
        all.then(function () { pending.delete(all); }, function () { pending.delete(all); });
        return all;
    }

    function ready() {
        return Promise.all(Array.from(pending)).then(function () {});
    }

    global.IdPhotoAlign = { frame: frame, applyToCards: applyToCards, ready: ready, _detectSkin: detectSkin, _computeCrop: computeCrop };
})(window);
