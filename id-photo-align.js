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

   Blue background + enhancement (added)
   -------------------------------------
   After framing, the person is cut out from the original background and placed on
   a clean studio-blue background, and the photo is enhanced (auto contrast/levels,
   gentle brightness correction, slight colour boost, light sharpening).
   Person cut-out tiers:
     1. MediaPipe Selfie Segmenter (lazy CDN load)  — works with any background
     2. Built-in background finder (flood-fill from the photo edges) — works offline
        for plain/uniform backgrounds; it refuses to touch busy backgrounds
        (the photo is still enhanced, just without the background swap)
   Configure / disable via  IdPhotoAlign.options  (see below).

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
    var MP_SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
    var MP_MODEL  = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

    // Feature switches / look. Change at runtime, e.g. IdPhotoAlign.options.blueBackground = false;
    var options = {
        blueBackground: true,            // replace the photo background with blue
        enhance: true,                   // auto-enhance the photo
        backgroundTop: '#2f80d9',        // studio-blue gradient (light centre-top …)
        backgroundBottom: '#1650a8',     // … to deeper blue at the edges
        useMediaPipe: 'auto'             // 'auto' = only on capable desktops; true = always; false = never
    };

    var cache = new Map();          // src -> aligned dataURL (successful results only)
    var inflight = new Map();       // src -> Promise (de-duplicates simultaneous requests)
    var pending = new Set();        // in-flight promises (for ready())
    var nativeDetector = null, nativeTried = false;
    var mpDetectorPromise = null, mpVisionPromise = null, mpSegmenterPromise = null;

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
    function getVision() {
        if (options.useMediaPipe === false || (options.useMediaPipe === 'auto' && IS_SMALL_DEVICE)) return Promise.resolve(null); // phones: skip the heavy download, use built-in methods
        if (mpVisionPromise) return mpVisionPromise;
        mpVisionPromise = (async function () {
            var work = (async function () {
                var vision = await import(MP_BUNDLE);
                var fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
                return { vision: vision, fileset: fileset };
            })();
            var timeout = new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, 6000); });
            return Promise.race([work, timeout]);
        })().catch(function () { return null; }); // offline / blocked → fall through to built-in methods
        return mpVisionPromise;
    }

    function getMediaPipe() {
        if (mpDetectorPromise) return mpDetectorPromise;
        mpDetectorPromise = getVision().then(function (v) {
            if (!v) return null;
            return v.vision.FaceDetector.createFromOptions(v.fileset, {
                baseOptions: { modelAssetPath: MP_MODEL, delegate: 'CPU' },
                runningMode: 'IMAGE',
                minDetectionConfidence: 0.5
            });
        }).catch(function () { return null; });
        return mpDetectorPromise;
    }

    function getSegmenter() {
        if (mpSegmenterPromise) return mpSegmenterPromise;
        mpSegmenterPromise = getVision().then(function (v) {
            if (!v) return null;
            return v.vision.ImageSegmenter.createFromOptions(v.fileset, {
                baseOptions: { modelAssetPath: MP_SEG_MODEL, delegate: 'CPU' },
                runningMode: 'IMAGE',
                outputConfidenceMasks: true,
                outputCategoryMask: false
            });
        }).catch(function () { return null; });
        return mpSegmenterPromise;
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
            if (area > w * h * 0.45) continue;                  // a skin-coloured wall/background, not a face
            if (minX === 0 && maxX === w - 1) continue;         // spans the full width → background
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

    // Tier 1: MediaPipe selfie segmentation → Float32Array alpha (1 = person)
    async function alphaFromSegmenter(canvas) {
        var seg = await getSegmenter();
        if (!seg) return null;
        try {
            var W = canvas.width, H = canvas.height;
            var res = seg.segment(canvas);
            var masks = res.confidenceMasks || [];
            if (!masks.length) return null;
            var m = masks[0];
            var arr = Float32Array.from(m.getAsFloat32Array());
            var mw = m.width, mh = m.height;
            masks.forEach(function (mk) { try { mk.close(); } catch (e) {} });
            if (mw !== W || mh !== H) return null;

            // The mask may be "person" or "background" depending on model build — detect which,
            // by checking the photo border (should be background) vs. the lower-centre (person).
            var bSum = 0, bN = 0, cSum = 0, cN = 0, x, y, bw = Math.round(W * 0.04);
            for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
                var v = arr[y * W + x];
                if (x < bw || x >= W - bw || y < bw) { bSum += v; bN++; }
                else if (x > W * 0.35 && x < W * 0.65 && y > H * 0.4 && y < H * 0.75) { cSum += v; cN++; }
            }
            if (bSum / bN > cSum / cN) for (var i = 0; i < arr.length; i++) arr[i] = 1 - arr[i];

            var frac = 0; for (i = 0; i < arr.length; i++) if (arr[i] > 0.5) frac++;
            frac /= arr.length;
            if (frac < 0.12 || frac > 0.92) return null; // implausible cut-out → don't trust it

            for (i = 0; i < arr.length; i++) arr[i] = smoothstep(0.3, 0.7, arr[i]);
            return boxBlur(arr, W, H, 1);
        } catch (e) { return null; }
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
        if (dev > 30) return null;                     // busy / multi-colour background → don't guess

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
        if (frac < 0.08 || frac > 0.85) return null;

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
        var W = img.width, H = img.height, c = document.createElement('canvas'); c.width = W; c.height = H;
        var cx = c.getContext('2d');
        var g = cx.createRadialGradient(W / 2, H * 0.38, W * 0.08, W / 2, H * 0.5, Math.max(W, H) * 0.85);
        g.addColorStop(0, options.backgroundTop); g.addColorStop(1, options.backgroundBottom);
        cx.fillStyle = g; cx.fillRect(0, 0, W, H);
        var bg = cx.getImageData(0, 0, W, H).data, d = img.data;
        for (var i = 0, p = 0; i < alpha.length; i++, p += 4) {
            var a = alpha[i];
            d[p]     = d[p]     * a + bg[p]     * (1 - a);
            d[p + 1] = d[p + 1] * a + bg[p + 1] * (1 - a);
            d[p + 2] = d[p + 2] * a + bg[p + 2] * (1 - a);
            d[p + 3] = 255;
        }
    }

    // Enhance + (optionally) swap the background, in place on the framed canvas.
    async function postProcess(canvas, faceCenter) {
        if (!options.enhance && !options.blueBackground) return;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        var W = canvas.width, H = canvas.height, alpha = null;
        try {
            if (options.blueBackground) {
                alpha = await alphaFromSegmenter(canvas);
                if (!alpha) alpha = alphaFromFloodFill(ctx.getImageData(0, 0, W, H).data, W, H, faceCenter);
            }
            var img = ctx.getImageData(0, 0, W, H);
            if (options.enhance) enhanceImage(img, alpha);
            if (alpha) compositeOnBlue(img, alpha);
            ctx.putImageData(img, 0, 0);
        } catch (e) { /* tainted canvas etc. → keep the plain framed photo */ }
    }

    /* ---------- main: align one image ---------- */
    async function doFrame(src) {
        var loaded = await loadImage(src), img = loaded.img;
        var iw = img.naturalWidth, ih = img.naturalHeight;
        if (!iw || !ih) return { url: src, ok: false };
        if (loaded.tainted) return { url: src, ok: false };   // cross-origin without CORS: can't read pixels → show as-is, retry later

        var work = makeWorkCanvas(img, 640), face = null;
        await yieldToUI();
        var f = await detectNative(work.canvas);
        if (!f) f = await detectMediaPipe(work.canvas);
        if (!f) f = detectSkin(work.canvas);
        if (f) face = { x: f.x / work.k, y: f.y / work.k, w: f.w / work.k, h: f.h / work.k };
        await yieldToUI();

        var crop = computeCrop(iw, ih, face);
        var canvas = document.createElement('canvas');
        canvas.width = OUT_W; canvas.height = OUT_H;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, OUT_W, OUT_H);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, OUT_W, OUT_H);
        var faceCenter = face
            ? { x: (face.x + face.w / 2 - crop.x) * OUT_W / crop.w, y: (face.y + face.h / 2 - crop.y) * OUT_H / crop.h }
            : { x: OUT_W / 2, y: OUT_H * FACE_CENTER_Y };
        await postProcess(canvas, faceCenter);
        try { return { url: canvas.toDataURL('image/jpeg', 0.9), ok: true }; } catch (e) { return { url: src, ok: false }; }
    }

    // Only SUCCESSFUL results are remembered. A failed/unprocessed photo is never cached,
    // so the next attempt (automatic retry or re-opening the cards) tries again from scratch.
    function frameEx(src) {
        if (!src) return Promise.resolve({ url: src, ok: false });
        if (cache.has(src)) return Promise.resolve({ url: cache.get(src), ok: true });
        if (inflight.has(src)) return inflight.get(src);
        var p = doFrame(src).catch(function () { return { url: src, ok: false }; }).then(function (r) {
            inflight.delete(src);
            if (r.ok) cache.set(src, r.url);
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
    function loadPhoto(im, priority) {
        if (im._idPhotoPromise) return im._idPhotoPromise;
        var raw = im.getAttribute('data-photo-src') || im.getAttribute('src');
        if (!raw) return Promise.resolve();
        if (priority) im._force = true;
        var p = enqueue(function () {
            if (!im._want && !im._force) { im._skipped = true; return; }    // no longer on screen
            return frameEx(raw).then(function (r) {
                if (!im.isConnected) return;
                im._ok = r.ok;
                return new Promise(function (res) {
                    var t = setTimeout(res, 8000);
                    im.onload = function () { clearTimeout(t); res(); };
                    im.onerror = function () { clearTimeout(t); if (r.url !== raw) im.src = raw; res(); };
                    if (r.ok) im.dataset.aligned = '1';
                    // Failed processing: don't flash the raw photo yet — only show it on the final attempt.
                    if (r.ok || (im._tries || 0) >= 2) im.src = r.url || raw;
                    else res();
                });
            });
        }, true).then(function () {
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
    function ensure(el, timeoutMs) {
        if (!el) return Promise.resolve();
        var imgs = el.querySelectorAll('.idc-card-photo img, .sidc-card-photo img');
        var all = Promise.all(Array.prototype.map.call(imgs, function (im) { return loadPhoto(im, true); }));
        var cap = new Promise(function (r) { setTimeout(r, timeoutMs || 40000); });
        return Promise.race([all, cap]);
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

    global.IdPhotoAlign = { scrollParent: scrollParent, options: options, frame: frame, applyToCards: applyToCards, ensure: ensure, loadPhoto: loadPhoto, ready: ready, _detectSkin: detectSkin, _flood: alphaFromFloodFill, _computeCrop: computeCrop };
})(window);
