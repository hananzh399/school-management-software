/* ==========================================================================
   id-photo-align.js  —  ID-card photo auto-alignment (shared: students + staff)

   What it does
   ------------
   1. FRAMING   Finds the face (MediaPipe BlazeFace, with eye positions) and re-crops the
                photo so the head is centred, the eyes sit at the classic ID-photo height,
                there is a little head-room, and a slightly tilted head is levelled.
   2. BLUE BG   Cuts the person out with MediaPipe Selfie Segmentation, edge-refines the
                cut-out with a guided filter (so hair/shoulder edges are smooth, not rough),
                and places the person on a clean studio-blue background.
   3. ENHANCE   Auto contrast / brightness / colour / light sharpening.

   Everything is baked into a plain pre-cropped image, so it looks identical on screen,
   in PNG download and in print (html2canvas ignores CSS object-position).

   MediaPipe files (JS + WASM + models, ~12 MB total, cached by the browser after the first
   time) are loaded from jsDelivr. To host them yourself instead, copy the two npm packages
   @mediapipe/face_detection and @mediapipe/selfie_segmentation into a folder on your server
   and set, before the cards are generated:
       IdPhotoAlign.options.mediapipeFaceUrl = '/vendor/face_detection/';
       IdPhotoAlign.options.mediapipeSegUrl  = '/vendor/selfie_segmentation/';

   If MediaPipe cannot load (offline / blocked), built-in fallbacks are used:
   skin-tone face finder + a strict edge-flood background finder that only swaps the
   background when it is very sure (otherwise the photo keeps its own background — it will
   never produce a rough cut-out).

   Public API
   ----------
     IdPhotoAlign.frame(src)              -> Promise<dataURL>
     IdPhotoAlign.applyToCards(rootEl)    -> lazily processes all card photos under rootEl
     IdPhotoAlign.ensure(el, timeoutMs)   -> Promise: photos inside el are ready
     IdPhotoAlign.options                 -> settings (see below)
   ========================================================================== */
(function (global) {
    'use strict';

    // Output canvas — same aspect as the card photo box (80 x 90 => 8:9), 4x for print sharpness.
    var OUT_W = 320, OUT_H = 360;
    var ASPECT = OUT_W / OUT_H;

    // Framing targets (fractions of the output frame).
    var HEAD_TO_FRAME = 0.58;   // whole head (hair→chin) ≈ 58% of frame height
    var EYE_Y = 0.40;           // eye line sits 40% down from the top (classic ID-photo proportion)

    // Feature switches / look. Change at runtime, e.g. IdPhotoAlign.options.blueBackground = false;
    var options = {
        blueBackground: false,           // OFF: photos keep their own background (set true to swap to blue again)
        enhance: true,                   // auto-enhance the photo
        backgroundTop: '#2f80d9',        // studio-blue gradient (lighter centre-top …)
        backgroundBottom: '#1650a8',     // … to deeper blue at the edges
        useMediaPipe: 'auto',            // 'auto' = when the device can (WebGL, not data-saver/2G/3G); true / false to force
        levelTilt: true,                 // straighten slightly tilted heads
        mediapipeFaceUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4.1646425229/',
        mediapipeSegUrl:  'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/'
    };

    var cache = new Map();          // src -> aligned dataURL (successful results only)
    var inflight = new Map();       // src -> Promise (de-duplicates simultaneous requests)
    var nativeDetector = null, nativeTried = false;
    var lastInfo = {};              // debug: what the last photo used

    /* ---------- image loading (timeout + retries + CORS fallback) ---------- */
    var IS_SMALL_DEVICE = (function () {
        try {
            var c = navigator.connection || {};
            return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '') || c.saveData === true ||
                   (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
                   (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
        } catch (e) { return true; }
    })();

    function loadOnce(src, cors, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var img = new Image(), done = false;
            var timer = setTimeout(function () { if (!done) { done = true; img.src = ''; reject(new Error('timeout')); } }, timeoutMs);
            if (cors) img.crossOrigin = 'anonymous';
            img.decoding = 'async';
            img.onload = function () {
                if (done) return;
                var fin = function () { if (done) return; done = true; clearTimeout(timer); resolve(img); };
                if (img.decode) img.decode().then(fin, fin); else fin();   // decode big photos off the UI thread
            };
            img.onerror = function () { if (done) return; done = true; clearTimeout(timer); reject(new Error('image load failed')); };
            img.src = src;
        });
    }

    function bust(url, n) { return url + (url.indexOf('?') >= 0 ? '&' : '?') + '_cb=' + Date.now() + n; }

    async function loadImage(src) {
        var isData = /^data:|^blob:/i.test(src), lastErr;
        for (var attempt = 0; attempt < 3; attempt++) {
            try {
                // Retries use a fresh URL: a copy of the photo cached earlier WITHOUT CORS headers
                // (e.g. by a normal <img> elsewhere on the site) would otherwise make every retry fail.
                var url = (isData || attempt === 0) ? src : bust(src, attempt);
                return { img: await loadOnce(url, !isData, 20000), tainted: false };
            }
            catch (e) { lastErr = e; await sleep(300 * (attempt + 1)); }
        }
        // Last resort: load WITHOUT CORS just so the photo is at least shown (can't be processed then).
        if (!isData) { try { return { img: await loadOnce(src, false, 20000), tainted: true }; } catch (e) { lastErr = e; } }
        throw lastErr || new Error('image load failed');
    }

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function yieldToUI() { return new Promise(function (r) { setTimeout(r, 0); }); }

    // Big phone photos (12MP+) are slow/memory-hungry: make a ≤640px working copy for detection.
    function makeWorkCanvas(img, maxSide) {
        var iw = img.naturalWidth, ih = img.naturalHeight, k = Math.min(1, maxSide / Math.max(iw, ih));
        var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(iw * k)); c.height = Math.max(1, Math.round(ih * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        return { canvas: c, k: k };
    }

    /* ---------- MediaPipe loader (face detection + selfie segmentation) ---------- */
    var MP_DEVICE_OK = (function () {
        try {
            var c = navigator.connection || {};
            if (c.saveData) return false;
            if (/^(slow-2g|2g|3g)$/.test(c.effectiveType || '')) return false;
            var cv = document.createElement('canvas');
            return !!(cv.getContext('webgl2') || cv.getContext('webgl'));
        } catch (e) { return false; }
    })();

    function mpWanted() {
        if (options.useMediaPipe === false) return false;
        if (options.useMediaPipe === true) return true;
        return MP_DEVICE_OK;
    }

    var mp = { fd: null, seg: null, promise: null, failedAt: 0, ready: false };
    var scriptPromises = {};
    var mpChain = Promise.resolve();   // MediaPipe solutions must be used one call at a time

    function withTimeout(p, ms, label) {
        return new Promise(function (res, rej) {
            var t = setTimeout(function () { rej(new Error(label + ' timeout')); }, ms);
            p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
        });
    }

    function loadScript(url) {
        if (scriptPromises[url]) return scriptPromises[url];
        scriptPromises[url] = new Promise(function (res, rej) {
            var s = document.createElement('script');
            s.src = url; s.async = true; s.crossOrigin = 'anonymous';
            s.onload = function () { res(); };
            s.onerror = function () { delete scriptPromises[url]; rej(new Error('script failed: ' + url)); };
            document.head.appendChild(s);
        });
        return scriptPromises[url];
    }

    // Wrap a MediaPipe "solution" into a simple  run(image) -> Promise<results>
    async function makeSolution(baseUrl, scriptName, ctorName, opts) {
        await withTimeout(loadScript(baseUrl + scriptName), 30000, 'script');
        var Ctor = global[ctorName];
        if (!Ctor) throw new Error(ctorName + ' missing');
        var sol = new Ctor({ locateFile: function (f) { return baseUrl + f; } });
        sol.setOptions(opts);
        var waiter = null;
        sol.onResults(function (r) { if (waiter) { var w = waiter; waiter = null; w(r); } });
        await withTimeout(sol.initialize(), 40000, 'init');
        return {
            run: function (image) {
                var job = mpChain.then(function () {
                    return withTimeout(new Promise(function (res, rej) {
                        waiter = res;
                        sol.send({ image: image }).catch(rej);
                    }), 20000, 'detect');
                });
                mpChain = job.catch(function () {});
                return job;
            }
        };
    }

    // Resolves true when face detection is ready (segmentation is loaded too if blue background is on).
    function ensureMP() {
        if (!mpWanted()) return Promise.resolve(false);
        if (mp.ready && (mp.seg || !options.blueBackground)) return Promise.resolve(true);
        if (mp.promise) return mp.promise;
        if (mp.failedAt && Date.now() - mp.failedAt < 60000) return Promise.resolve(false); // cool-down after a failure
        mp.promise = (async function () {
            for (var attempt = 0; attempt < 2; attempt++) {
                try {
                    if (!mp.fd) mp.fd = await makeSolution(options.mediapipeFaceUrl, 'face_detection.js', 'FaceDetection',
                        { model: 'short', minDetectionConfidence: 0.5, selfieMode: false });
                    if (options.blueBackground && !mp.seg) {
                        try {
                            mp.seg = await makeSolution(options.mediapipeSegUrl, 'selfie_segmentation.js', 'SelfieSegmentation',
                                { modelSelection: 0, selfieMode: false });
                        } catch (e) { mp.seg = null; if (attempt === 1) break; throw e; }
                    }
                    mp.ready = true; mp.failedAt = 0; mp.promise = null;
                    return true;
                } catch (e) { await sleep(2500); }
            }
            mp.ready = !!mp.fd;                     // face detection alone is still useful
            if (!mp.ready) mp.failedAt = Date.now();
            mp.promise = null;
            return mp.ready;
        })();
        return mp.promise;
    }

    /* ---------- face detection ---------- */
    function pickBest(faces, iw, ih) {
        if (!faces || !faces.length) return null;
        var best = null, bs = -1;
        faces.forEach(function (f) {
            var cx = f.x + f.w / 2, cy = f.y + f.h / 2;
            var dist = Math.hypot(cx / iw - 0.5, cy / ih - 0.45);
            var score = f.w * f.h * (1 - Math.min(0.8, dist));
            if (score > bs) { bs = score; best = f; }
        });
        return best;
    }

    // Run the face detector on a region of the source image (sx,sy,sw,sh) and return the best face
    // in SOURCE-image coordinates.
    async function detectMPRegion(img, sx, sy, sw, sh, maxSide) {
        if (!mp.fd) return null;
        try {
            var k = Math.min(1, maxSide / Math.max(sw, sh)), w = Math.max(8, Math.round(sw * k)), h = Math.max(8, Math.round(sh * k));
            var c = document.createElement('canvas'); c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
            var res = await mp.fd.run(c), fx = sw / w, fy = sh / h;
            var faces = (res.detections || []).map(function (d) {
                var b = d.boundingBox, bw = b.width * w, bh = b.height * h;
                var f = { x: sx + (b.xCenter * w - bw / 2) * fx, y: sy + (b.yCenter * h - bh / 2) * fy, w: bw * fx, h: bh * fy,
                          k: 1.85, eye: null, tilt: 0 };
                var lm = d.landmarks;
                if (lm && lm.length >= 2) {
                    var a = { x: sx + lm[0].x * w * fx, y: sy + lm[0].y * h * fy }, e = { x: sx + lm[1].x * w * fx, y: sy + lm[1].y * h * fy };
                    var L = a.x < e.x ? a : e, R = a.x < e.x ? e : a;
                    f.eye = { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2 };
                    f.tilt = Math.atan2(R.y - L.y, R.x - L.x) * 180 / Math.PI;
                }
                return f;
            });
            return pickBest(faces, img.naturalWidth, img.naturalHeight);
        } catch (e) { return null; }
    }

    // Whole photo first; if the face is small (person far from the camera) search zoomed-in tiles.
    async function detectMP(img) {
        var iw = img.naturalWidth, ih = img.naturalHeight;
        var f = await detectMPRegion(img, 0, 0, iw, ih, 640);
        if (f) return f;
        var levels = [0.62, 0.4];
        for (var li = 0; li < levels.length; li++) {
            var ts = Math.min(iw, ih) * levels[li], stepX = Math.max(1, (iw - ts) / 2), stepY = Math.max(1, (ih - ts) / 2), found = [];
            for (var gy = 0; gy < 3; gy++) for (var gx = 0; gx < 3; gx++) {
                if (iw <= ts && gx > 0) continue; if (ih <= ts && gy > 0) continue;
                var sx = Math.min(iw - ts, gx * stepX), sy = Math.min(ih - ts, gy * stepY);
                var t = await detectMPRegion(img, Math.max(0, sx), Math.max(0, sy), Math.min(ts, iw), Math.min(ts, ih), 512);
                if (t) found.push(t);
                await yieldToUI();
            }
            if (found.length) return pickBest(found, iw, ih);
        }
        return null;
    }

    async function detectNative(work) {
        if (!('FaceDetector' in global)) return null;
        try {
            if (!nativeTried) { nativeTried = true; nativeDetector = new global.FaceDetector({ fastMode: false, maxDetectedFaces: 5 }); }
            if (!nativeDetector) return null;
            var faces = await nativeDetector.detect(work);
            return pickBest(faces.map(function (f) {
                var b = f.boundingBox; return { x: b.x, y: b.y, w: b.width, h: b.height, k: 1.6, eye: null, tilt: 0 };
            }), work.width, work.height);
        } catch (e) { nativeDetector = null; return null; }
    }

    /* ---------- tier 3: skin-tone blob finder (no libraries) ---------- */
    function detectSkin(img) {
        var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
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
            if (area > w * h * 0.85) continue;                  // practically the whole frame = skin-coloured wall, not a face
            if (minX === 0 && maxX === w - 1 && area > w * h * 0.45) continue; // full-width and big → background
            var cx = (minX + maxX) / 2 / w, cy = (minY + maxY) / 2 / h;
            var centrality = 1 - Math.min(1, Math.abs(cx - 0.5) * 1.6);
            var upper = cy < 0.5 ? 1.6 : (cy < 0.72 ? 1 : 0.35); // faces sit in the upper half; necks/hands/arms lower down
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
    // Returns the source rectangle (aspect 8:9) to draw into the card photo.
    function computeCrop(iw, ih, face) {
        var cw, ch, cx, cy;
        if (face) {
            var headH = face.h * face.k;                       // estimated hair→chin height
            ch = headH / HEAD_TO_FRAME; cw = ch * ASPECT;
            var maxH = Math.min(ih, iw / ASPECT);
            if (ch > maxH) { ch = maxH; cw = ch * ASPECT; }    // can't zoom out past the photo itself
            var minH = Math.min(maxH, headH * 1.3);            // never so tight that hair/chin are cut
            if (ch < minH) { ch = minH; cw = ch * ASPECT; }
            var ax = face.eye ? face.eye.x : face.x + face.w / 2;
            var ay = face.eye ? face.eye.y : face.y + face.h * 0.42;
            cx = ax - cw / 2;
            cy = ay - ch * EYE_Y;
            var headTop = ay - headH * 0.5;                    // eyes are ~halfway down the head
            if (cy > headTop - ch * 0.04) cy = headTop - ch * 0.04; // always leave a little head-room
        } else {
            // No face found: portrait photo → fill the frame, biased to the top where faces are.
            ch = Math.min(ih, iw / ASPECT); cw = ch * ASPECT;
            cx = (iw - cw) / 2;
            cy = (ih - ch) * (ih > iw * 1.15 ? 0.12 : 0.3);
        }
        cx = Math.max(0, Math.min(iw - cw, cx));
        cy = Math.max(0, Math.min(ih - ch, cy));
        return { x: cx, y: cy, w: cw, h: ch };
    }

    /* ---------- person cut-out ---------- */
    function smoothstep(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

    function boxBlur(src, w, h, r) {   // separable box blur on a Float32Array
        var tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 2 * r + 1, x, y, i, acc;
        for (y = 0; y < h; y++) {
            acc = 0;
            for (x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
            for (x = 0; x < w; x++) {
                tmp[y * w + x] = acc / k;
                acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
            }
        }
        for (x = 0; x < w; x++) {
            acc = 0;
            for (y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
            for (y = 0; y < h; y++) {
                out[y * w + x] = acc / k;
                acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
            }
        }
        return out;
    }

    // Person mask from MediaPipe Selfie Segmentation → Float32Array (1 = person), same size as the canvas.
    async function alphaFromSegmenter(canvas) {
        if (!mp.seg) return null;
        try {
            var res = await mp.seg.run(canvas), m = res.segmentationMask;
            if (!m) return null;
            var W = canvas.width, H = canvas.height;
            var c = document.createElement('canvas'); c.width = W; c.height = H;
            var x = c.getContext('2d', { willReadFrequently: true });
            x.drawImage(m, 0, 0, W, H);
            var d = x.getImageData(0, 0, W, H).data, arr = new Float32Array(W * H), i;
            for (i = 0; i < arr.length; i++) arr[i] = d[i * 4] / 255;      // red channel = person confidence

            // Orientation guard: the photo border should be background, the lower-centre the person.
            var bS = 0, bN = 0, cS = 0, cN = 0, px, py, bw = Math.round(W * 0.04);
            for (py = 0; py < H; py++) for (px = 0; px < W; px++) {
                var v = arr[py * W + px];
                if (px < bw || px >= W - bw || py < bw) { bS += v; bN++; }
                else if (px > W * 0.35 && px < W * 0.65 && py > H * 0.4 && py < H * 0.75) { cS += v; cN++; }
            }
            if (bS / bN > cS / cN) for (i = 0; i < arr.length; i++) arr[i] = 1 - arr[i];
            return arr;
        } catch (e) { return null; }
    }

    // Edge-aware refinement (guided filter): snaps the soft 256px mask to the real hair/shoulder edges
    // of the photo, so the outline is smooth and clean instead of blocky.
    function refineAlpha(p, img, W, H) {
        var d = img.data, n = W * H, I = new Float32Array(n), i;
        for (i = 0; i < n; i++) I[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
        var R = 6, EPS = 0.004;
        var mI = boxBlur(I, W, H, R), mP = boxBlur(p, W, H, R);
        var II = new Float32Array(n), IP = new Float32Array(n);
        for (i = 0; i < n; i++) { II[i] = I[i] * I[i]; IP[i] = I[i] * p[i]; }
        var cII = boxBlur(II, W, H, R), cIP = boxBlur(IP, W, H, R);
        var a = new Float32Array(n), b = new Float32Array(n);
        for (i = 0; i < n; i++) {
            var varI = cII[i] - mI[i] * mI[i], cov = cIP[i] - mI[i] * mP[i];
            a[i] = cov / (varI + EPS); b[i] = mP[i] - a[i] * mI[i];
        }
        var mA = boxBlur(a, W, H, R), mB = boxBlur(b, W, H, R), q = new Float32Array(n);
        for (i = 0; i < n; i++) {
            var v = mA[i] * I[i] + mB[i];
            q[i] = smoothstep(0.52, 0.70, Math.max(0, Math.min(1, v)));   // crisp but anti-aliased edge, tiny shrink = no old-background halo
        }
        return q;
    }

    // Reject cut-outs that look wrong (so we keep the original background instead of a rough result).
    function alphaLooksRight(alpha, W, H, fc) {
        var n = W * H, s = 0, i, x, y;
        for (i = 0; i < n; i++) if (alpha[i] > 0.5) s++;
        var frac = s / n;
        if (frac < 0.15 || frac > 0.88) return false;
        var fx = Math.round(fc.x), fy = Math.round(fc.y), fs = 0, fn = 0;
        for (y = fy - 10; y <= fy + 10; y++) for (x = fx - 10; x <= fx + 10; x++)
            if (x >= 0 && y >= 0 && x < W && y < H) { fs += alpha[y * W + x]; fn++; }
        if (!fn || fs / fn < 0.85) return false;                       // the face itself must be inside the person
        var tl = 0, tr = 0, k = 10;
        for (y = 0; y < k; y++) for (x = 0; x < k; x++) { tl += alpha[y * W + x]; tr += alpha[y * W + (W - 1 - x)]; }
        if (tl / (k * k) > 0.6 && tr / (k * k) > 0.6) return false;    // both top corners "person" ⇒ mask is wrong
        return true;
    }

    // Tier 2: built-in background finder — flood-fill from the photo edges over a uniform background.
    function alphaFromFloodFill(d, W, H, fc) {
        var ring = 4, rs = [], gs = [], bs = [], x, y, p;
        function pushPx(px, py) { p = (py * W + px) * 4; rs.push(d[p]); gs.push(d[p + 1]); bs.push(d[p + 2]); }
        // Reference background = top edge + upper 60% of the side edges only
        // (the bottom of a portrait is clothing, not background).
        for (x = 0; x < W; x += 2) { for (y = 0; y < ring; y++) pushPx(x, y); }
        for (y = 0; y < H * 0.6; y += 2) { for (x = 0; x < ring; x++) { pushPx(x, y); pushPx(W - 1 - x, y); } }
        function med(a) { var c = a.slice().sort(function (m, n) { return m - n; }); return c[c.length >> 1]; }
        var R = med(rs), G = med(gs), B = med(bs);
        var dev = 0; for (var i = 0; i < rs.length; i++) dev += Math.abs(rs[i] - R) + Math.abs(gs[i] - G) + Math.abs(bs[i] - B);
        dev /= rs.length * 3;
        if (dev > 10) return null;                     // anything but a plain, uniform background → don't guess (no rough cut-outs)

        var T_SEED = 48 * 48, T_GLOBAL = 78 * 78, T_STEP = 15 * 15;
        function distRef(px) { var a = d[px] - R, b = d[px + 1] - G, c = d[px + 2] - B; return a * a + b * b + c * c; }
        function distPx(a, b) { var q = d[a] - d[b], w = d[a + 1] - d[b + 1], e = d[a + 2] - d[b + 2]; return q * q + w * w + e * e; }

        var bg = new Uint8Array(W * H), queue = new Int32Array(W * H), qh = 0, qt = 0;
        function trySeed(px, py) { var id = py * W + px; if (!bg[id] && distRef(id * 4) < T_SEED) { bg[id] = 1; queue[qt++] = id; } }
        for (x = 0; x < W; x++) { trySeed(x, 0); trySeed(x, H - 1); }
        for (y = 0; y < H; y++) { trySeed(0, y); trySeed(W - 1, y); }
        while (qh < qt) {
            var id = queue[qh++], cx = id % W, cy = (id / W) | 0, nb = [];
            if (cx > 0) nb.push(id - 1); if (cx < W - 1) nb.push(id + 1);
            if (cy > 0) nb.push(id - W); if (cy < H - 1) nb.push(id + W);
            for (var k = 0; k < nb.length; k++) {
                var n = nb[k];
                if (bg[n]) continue;
                if (distRef(n * 4) < T_GLOBAL && distPx(n * 4, id * 4) < T_STEP) { bg[n] = 1; queue[qt++] = n; }
            }
        }
        var frac = qt / (W * H);
        if (frac < 0.2 || frac > 0.7) return null;       // background should be roughly 20–70% of a portrait

        // Face must never be classified as background.
        var fx = Math.round(fc.x), fy = Math.round(fc.y);
        for (y = fy - 8; y <= fy + 8; y++) for (x = fx - 8; x <= fx + 8; x++)
            if (x >= 0 && y >= 0 && x < W && y < H && bg[y * W + x]) return null;

        // Keep only the person region connected to the face (drops stray specks/shadows).
        var person = new Uint8Array(W * H), sid = Math.min(H - 1, Math.max(0, fy)) * W + Math.min(W - 1, Math.max(0, fx));
        qh = 0; qt = 0; person[sid] = 1; queue[qt++] = sid;
        while (qh < qt) {
            var pid = queue[qh++], px = pid % W, py = (pid / W) | 0, nn = [];
            if (px > 0) nn.push(pid - 1); if (px < W - 1) nn.push(pid + 1);
            if (py > 0) nn.push(pid - W); if (py < H - 1) nn.push(pid + W);
            for (var j = 0; j < nn.length; j++) if (!bg[nn[j]] && !person[nn[j]]) { person[nn[j]] = 1; queue[qt++] = nn[j]; }
        }
        // 1px erosion (kills the old-background halo), then feather.
        var a = new Float32Array(W * H);
        for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
            var q = y * W + x;
            a[q] = (person[q] && person[q - 1] && person[q + 1] && person[q - W] && person[q + W]) ? 1 : 0;
        }
        a = boxBlur(a, W, H, 2);
        for (var m = 0; m < a.length; m++) a[m] = smoothstep(0.25, 0.75, a[m]);
        // Shoulders/body must reach the bottom edge, otherwise the fill leaked into the person → don't trust it.
        var bottom = 0, bn = 0;
        for (x = Math.round(W * 0.25); x < W * 0.75; x++) { bottom += a[(H - 3) * W + x]; bn++; }
        if (bottom / bn < 0.7) return null;
        return a;
    }

    /* ---------- enhancement ---------- */
    function enhanceImage(img, alpha) {
        var d = img.data, W = img.width, H = img.height, n = W * H, i, p;
        var hist = new Uint32Array(256), cnt = 0;
        for (i = 0, p = 0; i < n; i++, p += 4) {
            if (alpha && alpha[i] < 0.5) continue;
            hist[(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) | 0]++; cnt++;
        }
        if (!cnt) return;
        var lo = 0, hi = 255, acc = 0;
        for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= cnt * 0.01) { lo = i; break; } }
        acc = 0;
        for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= cnt * 0.01) { hi = i; break; } }
        var doStretch = (hi - lo) > 40;

        // Mean brightness after stretch → gentle gamma toward a well-exposed face.
        var sum = 0;
        for (i = 0; i < 256; i++) {
            var t = doStretch ? Math.max(0, Math.min(1, (i - lo) / (hi - lo))) : i / 255;
            sum += hist[i] * (0.4 * (i / 255) + 0.6 * t);
        }
        var mean = Math.max(0.05, Math.min(0.95, sum / cnt));
        var gamma = Math.log(0.5) / Math.log(mean);
        gamma = 1 + (gamma - 1) * 0.5;
        gamma = Math.max(0.78, Math.min(1.22, gamma));

        var lut = new Uint8ClampedArray(256);
        for (i = 0; i < 256; i++) {
            var tt = doStretch ? Math.max(0, Math.min(1, (i - lo) / (hi - lo))) : i / 255;
            var v = 0.4 * (i / 255) + 0.6 * tt;
            lut[i] = 255 * Math.pow(v, gamma);
        }
        var SAT = 1.12;
        for (p = 0; p < d.length; p += 4) {
            var r = lut[d[p]], g = lut[d[p + 1]], b = lut[d[p + 2]];
            var gray = 0.299 * r + 0.587 * g + 0.114 * b;
            d[p]     = gray + (r - gray) * SAT;
            d[p + 1] = gray + (g - gray) * SAT;
            d[p + 2] = gray + (b - gray) * SAT;
        }
        // Light unsharp mask (4-neighbour) so eyes/hair look crisp.
        var src = new Uint8ClampedArray(d), AMT = 0.55, x, y, c;
        for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
            p = (y * W + x) * 4;
            for (c = 0; c < 3; c++) {
                var avg = (src[p + c - 4] + src[p + c + 4] + src[p + c - W * 4] + src[p + c + W * 4]) / 4;
                d[p + c] = src[p + c] + AMT * (src[p + c] - avg);
            }
        }
    }

    /* ---------- blue studio background ---------- */
    function hexToRgb(h) { var m = /^#?([0-9a-f]{6})$/i.exec(h) || [0, '2f80d9']; var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }

    function compositeOnBlue(img, alpha) {
        var W = img.width, H = img.height, n = W * H, d = img.data, i, p;

        // Remove the old background's colour from the soft edge pixels (kills the light "halo" around hair/shoulders):
        // edge pixels take the colour of the solid person pixels right next to them.
        var hard = new Float32Array(n), cr = new Float32Array(n), cg = new Float32Array(n), cb = new Float32Array(n);
        for (i = 0, p = 0; i < n; i++, p += 4) if (alpha[i] > 0.92) { hard[i] = 1; cr[i] = d[p]; cg[i] = d[p + 1]; cb[i] = d[p + 2]; }
        var bh = boxBlur(hard, W, H, 3), br = boxBlur(cr, W, H, 3), bg2 = boxBlur(cg, W, H, 3), bb = boxBlur(cb, W, H, 3);
        for (i = 0, p = 0; i < n; i++, p += 4) {
            var a0 = alpha[i];
            if (a0 > 0.01 && a0 < 0.97 && bh[i] > 0.03) {
                d[p] = br[i] / bh[i]; d[p + 1] = bg2[i] / bh[i]; d[p + 2] = bb[i] / bh[i];
            }
        }

        var c = document.createElement('canvas'); c.width = W; c.height = H;
        var cx = c.getContext('2d');
        var g = cx.createRadialGradient(W / 2, H * 0.38, W * 0.08, W / 2, H * 0.5, Math.max(W, H) * 0.85);
        g.addColorStop(0, options.backgroundTop); g.addColorStop(1, options.backgroundBottom);
        cx.fillStyle = g; cx.fillRect(0, 0, W, H);
        var bg = cx.getImageData(0, 0, W, H).data;
        for (i = 0, p = 0; i < n; i++, p += 4) {
            var a = alpha[i];
            d[p]     = d[p]     * a + bg[p]     * (1 - a);
            d[p + 1] = d[p + 1] * a + bg[p + 1] * (1 - a);
            d[p + 2] = d[p + 2] * a + bg[p + 2] * (1 - a);
            d[p + 3] = 255;
        }
    }

    // Enhance + (optionally) swap the background, in place on the framed canvas.
    // fc = face/eye position inside the canvas. Returns what was done (for debugging).
    async function postProcess(canvas, fc) {
        var info = { bg: 'none' };
        if (!options.enhance && !options.blueBackground) return info;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        var W = canvas.width, H = canvas.height, alpha = null;
        try {
            var img = ctx.getImageData(0, 0, W, H);
            if (options.blueBackground) {
                var raw = await alphaFromSegmenter(canvas);
                if (raw) {
                    var refined = refineAlpha(raw, img, W, H);
                    if (alphaLooksRight(refined, W, H, fc)) { alpha = refined; info.bg = 'mediapipe'; }
                }
                if (!alpha) {                                   // built-in fallback — only when very sure
                    var fl = alphaFromFloodFill(img.data, W, H, fc);
                    if (fl && alphaLooksRight(fl, W, H, fc)) { alpha = fl; info.bg = 'flood'; }
                }
            }
            if (options.enhance) enhanceImage(img, alpha);
            if (alpha) compositeOnBlue(img, alpha);
            ctx.putImageData(img, 0, 0);
        } catch (e) { /* tainted canvas etc. → keep the plain framed photo */ }
        return info;
    }

    /* ---------- main: align one image ---------- */
    async function doFrame(src) {
        var loaded;
        try { loaded = await loadImage(src); }
        catch (e) { return { url: src, ok: false, loadFailed: true }; }     // file missing / unreachable after all retries
        var img = loaded.img;
        var iw = img.naturalWidth, ih = img.naturalHeight;
        if (!iw || !ih) return { url: src, ok: false };
        if (loaded.tainted) return { url: src, ok: false };   // cross-origin without CORS: can't read pixels → show as-is, retry later

        // Waits for the models the first time (cards show blue meanwhile) — but not forever: after 25s this photo
        // is done with the built-in methods (and re-done with MediaPipe next time, since that result isn't cached).
        var usedMP = await Promise.race([ensureMP(), sleep(25000).then(function () { return false; })]);
        var face = null, how = 'none';
        await yieldToUI();
        if (usedMP) { face = await detectMP(img); if (face) how = 'mediapipe'; }
        if (!face) {
            var work = makeWorkCanvas(img, 512), f = await detectNative(work.canvas), k = work.k;
            if (f) how = 'native';
            if (!f) {
                var sk = detectSkin(work.canvas), WW = work.canvas.width, WH = work.canvas.height;
                var plausible = sk && (sk.w * sk.h) / (WW * WH) >= 0.01 && (sk.w * sk.h) / (WW * WH) <= 0.35 &&
                                (sk.y + sk.h / 2) < WH * 0.55 && sk.h / sk.w >= 0.8 && sk.h / sk.w <= 1.6;
                if (plausible) { f = { x: sk.x, y: sk.y, w: sk.w, h: sk.h, k: 1.3, eye: null, tilt: 0 }; how = 'skin'; }
            }
            if (f) face = { x: f.x / k, y: f.y / k, w: f.w / k, h: f.h / k, k: f.k, tilt: 0, eye: null };
        }
        await yieldToUI();

        var crop = computeCrop(iw, ih, face);
        var canvas = document.createElement('canvas');
        canvas.width = OUT_W; canvas.height = OUT_H;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, OUT_W, OUT_H);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

        var s = OUT_W / crop.w;
        var ax = face ? (face.eye ? face.eye.x : face.x + face.w / 2) : crop.x + crop.w / 2;
        var ay = face ? (face.eye ? face.eye.y : face.y + face.h * 0.42) : crop.y + crop.h * EYE_Y;
        var fc = { x: (ax - crop.x) * s, y: (ay - crop.y) * s };
        var tilt = face && face.eye ? face.tilt : 0;
        if (options.levelTilt && options.blueBackground && mp.seg && Math.abs(tilt) >= 3 && Math.abs(tilt) <= 15) {
            // Level a slightly tilted head: rotate about the eyes (empty corners become background → blue).
            ctx.save();
            ctx.translate(fc.x, fc.y); ctx.rotate(-tilt * Math.PI / 180); ctx.scale(s, s); ctx.translate(-ax, -ay);
            ctx.drawImage(img, 0, 0);
            ctx.restore();
        } else {
            ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, OUT_W, OUT_H);
        }
        var info = await postProcess(canvas, fc);
        lastInfo = { face: how, bg: info.bg, tilt: Math.round(tilt) };
        var url;
        try { url = canvas.toDataURL('image/jpeg', 0.92); } catch (e) { return { url: src, ok: false }; }
        // Only remember results made with the full pipeline (so a temporary MediaPipe failure is retried next time).
        return { url: url, ok: true, full: usedMP || !mpWanted() };
    }

    // Only SUCCESSFUL, full-quality results are remembered. A failed/unprocessed photo is never cached,
    // so the next attempt (automatic retry or re-opening the cards) tries again from scratch.
    function frameEx(src) {
        if (!src) return Promise.resolve({ url: src, ok: false });
        if (cache.has(src)) return Promise.resolve({ url: cache.get(src), ok: true });
        if (inflight.has(src)) return inflight.get(src);
        var p = doFrame(src).catch(function () { return { url: src, ok: false }; }).then(function (r) {
            inflight.delete(src);
            if (r.ok && r.full) cache.set(src, r.url);
            return r;
        });
        inflight.set(src, p);
        return p;
    }
    function frame(src) { return frameEx(src).then(function (r) { return r.url; }); }

    /* ---------- job queue: few at a time, never blocks scrolling ---------- */
    var MAX_PARALLEL = IS_SMALL_DEVICE ? 2 : 4, running = 0, waiting = [];
    function enqueue(job, priority) {
        return new Promise(function (resolve) {
            var item = { job: job, resolve: resolve };
            if (priority) waiting.unshift(item); else waiting.push(item);
            pump();
        });
    }
    function pump() {
        while (running < MAX_PARALLEL && waiting.length) {
            var it = waiting.shift(); running++;
            (function (item) {
                Promise.resolve().then(item.job).catch(function () {}).then(function () {
                    running--; item.resolve(); setTimeout(pump, 16); // small gap = UI stays responsive
                });
            })(it);
        }
    }

    function showFallback(im) { // never leave an empty box: show the original photo if processing fails
        var raw = im.getAttribute('data-photo-src');
        if (raw && !im.getAttribute('src')) im.src = raw;
    }

    // Load ONE card photo: fetch (with retries) → align/blue-bg/enhance → show. Idempotent.
    // If the card is scrolled out of view before its turn comes, the job is dropped (and
    // re-requested when it scrolls back). If processing fails, it is retried automatically
    // a few times (the original photo is only shown as a last resort).
    // A photo that cannot be loaded at all (deleted file, 404…) must look like "no photo uploaded":
    // swap the broken <img> for the same profile icon the cards use when there is no photo.
    function replaceWithIcon(im) {
        try {
            if (!im.parentNode) return;
            var icon = document.createElement('i');
            icon.className = 'fas fa-user';
            im.parentNode.replaceChild(icon, im);
        } catch (e) {}
    }

    function loadPhoto(im, priority) {
        if (im._idPhotoPromise) return im._idPhotoPromise;
        var raw = im.getAttribute('data-photo-src') || im.getAttribute('src');
        if (!raw) return Promise.resolve();
        if (priority) im._force = true;
        var p = enqueue(function () {
            if (!im._want && !im._force) { im._skipped = true; return; }    // no longer on screen
            return frameEx(raw).then(function (r) {
                if (!im.isConnected) return;
                if (r.loadFailed) { im._broken = true; replaceWithIcon(im); return; }
                im._ok = r.ok;
                return new Promise(function (res) {
                    var t = setTimeout(res, 8000);
                    im.onload = function () { clearTimeout(t); res(); };
                    im.onerror = function () {
                        clearTimeout(t);
                        if (r.url !== raw && im.getAttribute('src') !== raw) im.src = raw;   // processed copy failed → try the original
                        else { im._broken = true; replaceWithIcon(im); }                     // original is broken too → profile icon
                        res();
                    };
                    if (r.ok) im.dataset.aligned = '1';
                    // Failed processing: don't flash the raw photo yet — only show it on the final attempt.
                    if (r.ok || (im._tries || 0) >= 2) im.src = r.url || raw;
                    else res();
                });
            });
        }, true).then(function () {
            if (im._broken) return;
            if (im._skipped) { im._skipped = false; im._idPhotoPromise = null; return; }
            if (im._ok === false && (im._tries || 0) < 2 && im.isConnected) {   // self-heal: try again shortly
                im._tries = (im._tries || 0) + 1;
                im._idPhotoPromise = null;
                return sleep(1200 * im._tries).then(function () { return loadPhoto(im, true); });
            }
            showFallback(im);
        });
        im._idPhotoPromise = p;
        return p;
    }

    // Prepare the photos inside a card / pair element. `wait` = resolve only when done (with a time cap).
    // Used right before a card is captured for download/print. Photos that are already on the card
    // are used immediately (no waiting); only photos still being prepared are waited for — and only
    // for a short time, so a slow network can never make the download look frozen.
    function ensure(el, timeoutMs) {
        if (!el) return Promise.resolve();
        var imgs = Array.prototype.slice.call(el.querySelectorAll('.idc-card-photo img, .sidc-card-photo img'));
        var need = imgs.filter(function (im) { return !(im.getAttribute('src') && im.complete && im.naturalWidth > 0); });
        if (!need.length) return Promise.resolve();
        var all = Promise.all(need.map(function (im) { return loadPhoto(im, true); }));
        var cap = new Promise(function (r) { setTimeout(r, timeoutMs || 10000); });
        return Promise.race([all, cap]).then(function () {
            need.forEach(function (im) { if (im.isConnected && !im.getAttribute('src')) showFallback(im); });   // never capture an empty box
        });
    }

    function scrollParent(el) {
        for (var n = el && el.parentElement; n && n !== document.body; n = n.parentElement) {
            var oy = getComputedStyle(n).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
        }
        return null; // page itself scrolls
    }

    // Lazy: photos start loading only when their card is near the viewport.
    function applyToCards(root) {
        root = root || document;
        var imgs = root.querySelectorAll('.idc-card-photo img, .sidc-card-photo img');
        if (!('IntersectionObserver' in global)) {                 // very old browsers: just go through the queue
            Array.prototype.forEach.call(imgs, function (im) { loadPhoto(im, true); });
            return Promise.resolve();
        }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                var im = e.target;
                if (im.dataset.aligned === '1' && im.getAttribute('src')) { io.unobserve(im); return; }
                im._want = e.isIntersecting;
                if (e.isIntersecting) loadPhoto(im);
            });
        }, { root: scrollParent(imgs[0]), rootMargin: '300px 0px' });
        Array.prototype.forEach.call(imgs, function (im) { if (!im._idPhotoPromise) io.observe(im); else if (im.dataset.aligned !== '1') io.observe(im); });
        return Promise.resolve();
    }

    function ready() { return Promise.resolve(); } // kept for compatibility; capture uses ensure(card)

    global.IdPhotoAlign = { scrollParent: scrollParent, options: options, frame: frame, applyToCards: applyToCards, ensure: ensure, loadPhoto: loadPhoto, ready: ready,
        _detectSkin: detectSkin, _flood: alphaFromFloodFill, _computeCrop: computeCrop, _info: function () { return lastInfo; } };
})(window);
