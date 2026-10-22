/* Scan clean-up for phone photos (CamScanner-like): the page background becomes white, the ink dark and even,
   whatever the lighting. Pure canvas work, no dependencies. enhance(canvas) → canvas (grayscale). */
var Scan = (function () {
  'use strict';
  function lum(c, w, h) {
    var x = c.getContext('2d'), d = x.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
    for (var i = 0, j = 0; i < d.length; i += 4, j++) out[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return out;
  }
  /* background = the bright paper: coarse grid of local maxima (ink is darker than paper), then smoothed */
  function background(L, w, h, cell) {
    var gw = Math.ceil(w / cell), gh = Math.ceil(h / cell), g = new Float32Array(gw * gh);
    for (var gy = 0; gy < gh; gy++) for (var gx = 0; gx < gw; gx++) {
      /* 90th percentile of the cell ≈ paper brightness, robust to specks */
      var vals = [], x0 = gx * cell, y0 = gy * cell;
      for (var y = y0; y < Math.min(h, y0 + cell); y += 2) for (var x = x0; x < Math.min(w, x0 + cell); x += 2) vals.push(L[y * w + x]);
      vals.sort(function (a, b) { return a - b; });
      g[gy * gw + gx] = vals[Math.floor(vals.length * 0.9)] || 255;
    }
    /* 3×3 box blur on the grid, twice */
    for (var pass = 0; pass < 2; pass++) {
      var b = new Float32Array(g.length);
      for (gy = 0; gy < gh; gy++) for (gx = 0; gx < gw; gx++) {
        var s = 0, n = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var yy = gy + dy, xx = gx + dx; if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) { s += g[yy * gw + xx]; n++; } }
        b[gy * gw + gx] = s / n;
      }
      g = b;
    }
    return { g: g, gw: gw, gh: gh, cell: cell };
  }
  function bgAt(B, x, y) {
    var fx = Math.min(B.gw - 1, Math.max(0, x / B.cell - 0.5)), fy = Math.min(B.gh - 1, Math.max(0, y / B.cell - 0.5));
    var x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(B.gw - 1, x0 + 1), y1 = Math.min(B.gh - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    var a = B.g[y0 * B.gw + x0], b = B.g[y0 * B.gw + x1], c = B.g[y1 * B.gw + x0], d = B.g[y1 * B.gw + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }
  /* canvas → cleaned grayscale canvas. maxSide limits the work (default 2400px). */
  function enhance(src, maxSide) {
    maxSide = maxSide || 2400;
    var k = Math.min(1, maxSide / Math.max(src.width, src.height)), w = Math.round(src.width * k), h = Math.round(src.height * k);
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d'); x.drawImage(src, 0, 0, w, h);
    var L = lum(c, w, h), B = background(L, w, h, Math.max(24, Math.round(Math.min(w, h) / 24)));
    var img = x.getImageData(0, 0, w, h), d = img.data;
    /* ink/paper ratio → stretch: paper (ratio ≥ 0.92) → white, ink (ratio ≤ 0.55) → black, smooth in between */
    var lo = 0.55, hi = 0.93;
    for (var y = 0, j = 0; y < h; y++) for (var xx = 0; xx < w; xx++, j++) {
      var r = L[j] / Math.max(1, bgAt(B, xx, y)), v = (r - lo) / (hi - lo);
      v = v < 0 ? 0 : v > 1 ? 1 : v; v = Math.round(255 * Math.pow(v, 1.15));
      var i = j * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  /* sharpness: mean absolute Laplacian of the (downscaled) luminance; a blurred photo scores low */
  function sharpness(src) {
    var k = Math.min(1, 900 / Math.max(src.width, src.height)), w = Math.round(src.width * k), h = Math.round(src.height * k);
    var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(src, 0, 0, w, h);
    var L = lum(c, w, h), vals = [];
    for (var y = 1; y < h - 1; y += 2) for (var x = 1; x < w - 1; x += 2) { var i = y * w + x; vals.push(Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w])); }
    /* strength of the strongest 2% of edges (the ink outlines): independent of how much of the page is written on */
    vals.sort(function (a, b) { return b - a; });
    var top = Math.max(1, Math.floor(vals.length * 0.02)), sum = 0;
    for (var k = 0; k < top; k++) sum += vals[k];
    return sum / top;
  }
  /* deskew: try small rotations on a downscaled ink map and keep the one whose line profile is sharpest */
  function deskew(src, maxDeg) {
    maxDeg = maxDeg || 6;
    var k = Math.min(1, 700 / Math.max(src.width, src.height)), w = Math.round(src.width * k), h = Math.round(src.height * k);
    var base = document.createElement('canvas'); base.width = w; base.height = h; base.getContext('2d').drawImage(src, 0, 0, w, h);
    var L = lum(base, w, h), B = background(L, w, h, Math.max(16, Math.round(Math.min(w, h) / 20)));
    var ink = document.createElement('canvas'); ink.width = w; ink.height = h;
    var ix = ink.getContext('2d'), img = ix.createImageData(w, h), d = img.data;
    for (var y = 0, j = 0; y < h; y++) for (var x = 0; x < w; x++, j++) { var v = L[j] / Math.max(1, bgAt(B, x, y)) < 0.7 ? 255 : 0; var i = j * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    ix.putImageData(img, 0, 0);
    function score(deg) {
      var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.translate(w / 2, h / 2); x.rotate(deg * Math.PI / 180); x.drawImage(ink, -w / 2, -h / 2);
      var dd = x.getImageData(0, 0, w, h).data, rows = new Float32Array(h), mean = 0;
      for (var yy = 0; yy < h; yy++) { var r = 0; for (var xx = 0; xx < w; xx++) r += dd[(yy * w + xx) * 4]; rows[yy] = r; mean += r; }
      mean /= h; var v = 0; for (yy = 0; yy < h; yy++) v += (rows[yy] - mean) * (rows[yy] - mean);
      return v;
    }
    var best = 0, bs = score(0);
    for (var a = -maxDeg; a <= maxDeg; a += 0.5) { if (!a) continue; var sc = score(a); if (sc > bs * 1.03) { bs = sc; best = a; } }
    if (!best) return src;
    var out = document.createElement('canvas'); out.width = src.width; out.height = src.height;
    var ox = out.getContext('2d'); ox.fillStyle = '#fff'; ox.fillRect(0, 0, out.width, out.height);
    ox.translate(out.width / 2, out.height / 2); ox.rotate(best * Math.PI / 180); ox.drawImage(src, -src.width / 2, -src.height / 2);
    return out;
  }
  /* ---------- KATEB20: the paper itself — find its four corners in the photo and straighten it ----------
     Pure canvas work: the paper is the large, bright, low-saturation region around the middle of the photo
     (desk, floor and hands are darker or coloured); its convex hull gives the corners, a homography maps the
     corners to a rectangle. When nothing paper-like is found (a scan, a screenshot, a page that fills the frame)
     the photo is used as it is. */
  function small(src, maxSide) {
    var k = Math.min(1, maxSide / Math.max(src.width, src.height)), w = Math.max(8, Math.round(src.width * k)), h = Math.max(8, Math.round(src.height * k));
    var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(src, 0, 0, w, h);
    return { c: c, w: w, h: h, k: k };
  }
  function paperMask(c, w, h) {
    var d = c.getContext('2d').getImageData(0, 0, w, h).data, L = new Float32Array(w * h), S = new Float32Array(w * h), hist = new Float64Array(256);
    for (var i = 0, j = 0; i < d.length; i += 4, j++) {
      var r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      L[j] = 0.299 * r + 0.587 * g + 0.114 * b; S[j] = mx ? (mx - mn) / mx : 0; hist[Math.round(L[j])]++;
    }
    /* Otsu threshold between the dark surroundings and the bright paper */
    var total = w * h, sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = 0, thr = 128;
    for (i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; var wF = total - wB; if (!wF) break; sumB += i * hist[i]; var mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; thr = i; } }
    var m = new Uint8Array(w * h);
    for (j = 0; j < w * h; j++) m[j] = L[j] > thr && S[j] < 0.35 ? 1 : 0;
    /* close small gaps (ink, folds): dilate then erode once */
    var t = new Uint8Array(w * h), y, x, dy, dx;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var on = 0; for (dy = -1; dy <= 1 && !on; dy++) for (dx = -1; dx <= 1; dx++) { var yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w && m[yy * w + xx]) { on = 1; break; } } t[y * w + x] = on; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var all = 1; for (dy = -1; dy <= 1 && all; dy++) for (dx = -1; dx <= 1; dx++) { var y2 = y + dy, x2 = x + dx; if (y2 >= 0 && y2 < h && x2 >= 0 && x2 < w && !t[y2 * w + x2]) { all = 0; break; } } m[y * w + x] = all; }
    return { m: m, thr: thr };
  }
  /* largest 4-connected region of the mask (preferring one that covers the centre) → its pixels */
  function largestRegion(m, w, h) {
    var lab = new Int32Array(w * h), n = 0, sizes = [], hasCenter = [], stack = [];
    for (var s0 = 0; s0 < w * h; s0++) {
      if (!m[s0] || lab[s0]) continue;
      n++; var size = 0, cen = false; stack.push(s0); lab[s0] = n;
      while (stack.length) {
        var p = stack.pop(); size++;
        var px = p % w, py = (p - px) / w;
        if (Math.abs(px - w / 2) < w * 0.08 && Math.abs(py - h / 2) < h * 0.08) cen = true;
        var nb = [p - 1, p + 1, p - w, p + w];
        for (var q = 0; q < 4; q++) { var r = nb[q]; if (r < 0 || r >= w * h) continue; if ((q === 0 && px === 0) || (q === 1 && px === w - 1)) continue; if (m[r] && !lab[r]) { lab[r] = n; stack.push(r); } }
      }
      sizes[n] = size; hasCenter[n] = cen;
    }
    var bestL = 0, bestS = 0;
    for (var l = 1; l <= n; l++) { var sc = sizes[l] * (hasCenter[l] ? 1.5 : 1); if (sc > bestS) { bestS = sc; bestL = l; } }
    return { lab: lab, id: bestL, size: bestL ? sizes[bestL] : 0 };
  }
  function hull(pts) {
    pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var cross = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); };
    var lower = [], upper = [], i;
    for (i = 0; i < pts.length; i++) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop(); lower.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop(); upper.push(pts[i]); }
    lower.pop(); upper.pop(); return lower.concat(upper);
  }
  function area(q) { var a = 0; for (var i = 0; i < q.length; i++) { var p = q[i], n = q[(i + 1) % q.length]; a += p[0] * n[1] - n[0] * p[1]; } return Math.abs(a) / 2; }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function angleOk(q) {
    for (var i = 0; i < 4; i++) {
      var p = q[(i + 3) % 4], c = q[i], n = q[(i + 1) % 4], v1 = [p[0] - c[0], p[1] - c[1]], v2 = [n[0] - c[0], n[1] - c[1]];
      var cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) || 1), deg = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
      if (deg < 50 || deg > 130) return false;
    }
    return true;
  }
  /* corners of the paper in the photo (full-resolution coordinates, clockwise from top-left), or null */
  function detect(src) {
    var sm = small(src, 360), w = sm.w, h = sm.h, pm = paperMask(sm.c, w, h), reg = largestRegion(pm.m, w, h);
    if (!reg.id || reg.size < w * h * 0.18) return null;
    /* boundary pixels of the region → hull */
    var pts = [], lab = reg.lab;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var p = y * w + x; if (lab[p] !== reg.id) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || lab[p - 1] !== reg.id || lab[p + 1] !== reg.id || lab[p - w] !== reg.id || lab[p + w] !== reg.id) pts.push([x, y]);
    }
    if (pts.length < 8) return null;
    var H = hull(pts); if (H.length < 4) return null;
    /* four corners: the hull points farthest along the four diagonal directions, then refined for the largest area */
    var pick = function (f) { var b = H[0], bv = f(H[0]); for (var i = 1; i < H.length; i++) { var v = f(H[i]); if (v > bv) { bv = v; b = H[i]; } } return b; };
    var q = [pick(function (p) { return -(p[0] + p[1]); }), pick(function (p) { return p[0] - p[1]; }), pick(function (p) { return p[0] + p[1]; }), pick(function (p) { return p[1] - p[0]; })];
    for (var round = 0; round < 2; round++) for (var ci = 0; ci < 4; ci++) {
      var bestA = area(q), bestP = q[ci];
      for (var hi = 0; hi < H.length; hi++) { if (dist(H[hi], q[ci]) > Math.max(w, h) * 0.12) continue; var t = q.slice(); t[ci] = H[hi]; var a = area(t); if (a > bestA) { bestA = a; bestP = H[hi]; } }
      q[ci] = bestP;
    }
    var A = area(q), full = w * h;
    if (A < full * 0.2 || A > full * 0.985 || !angleOk(q)) return null;
    if (A > reg.size * 1.35) return null;                                  // the hull is much bigger than the region: not a paper
    var minSide = Math.min(dist(q[0], q[1]), dist(q[1], q[2]), dist(q[2], q[3]), dist(q[3], q[0]));
    if (minSide < Math.min(w, h) * 0.3) return null;
    return q.map(function (p) { return [p[0] / sm.k, p[1] / sm.k]; });
  }
  /* homography mapping the unit square (0,0)-(1,1) onto the quad; returns the 3×3 matrix as 9 numbers */
  function homography(q) {
    var A = [], b = [], i;
    var dst = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (i = 0; i < 4; i++) {
      var u = dst[i][0], v = dst[i][1], x = q[i][0], y = q[i][1];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    /* gaussian elimination */
    var n = 8, M = A.map(function (r, k) { return r.concat([b[k]]); });
    for (i = 0; i < n; i++) {
      var piv = i; for (var r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
      var t = M[i]; M[i] = M[piv]; M[piv] = t;
      if (Math.abs(M[i][i]) < 1e-12) return null;
      for (r = 0; r < n; r++) { if (r === i) continue; var f = M[r][i] / M[i][i]; for (var c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
    }
    var h = []; for (i = 0; i < n; i++) h.push(M[i][n] / M[i][i]); h.push(1);
    return h;
  }
  /* the quad of the photo straightened into a rectangle (bilinear sampling) */
  function warp(src, q, maxSide) {
    maxSide = maxSide || 2400;
    var wTop = dist(q[0], q[1]), wBot = dist(q[3], q[2]), hL = dist(q[0], q[3]), hR = dist(q[1], q[2]);
    var W = Math.round(Math.max(wTop, wBot)), Hh = Math.round(Math.max(hL, hR)), k = Math.min(1, maxSide / Math.max(W, Hh));
    W = Math.max(8, Math.round(W * k)); Hh = Math.max(8, Math.round(Hh * k));
    var H = homography(q); if (!H) return src;
    var sw = src.width, sh = src.height, sd = src.getContext('2d').getImageData(0, 0, sw, sh).data;
    var out = document.createElement('canvas'); out.width = W; out.height = Hh;
    var ox = out.getContext('2d'), img = ox.createImageData(W, Hh), od = img.data;
    for (var y = 0; y < Hh; y++) {
      var v = (y + 0.5) / Hh;
      for (var x = 0; x < W; x++) {
        var u = (x + 0.5) / W, den = H[6] * u + H[7] * v + 1;
        var sx = (H[0] * u + H[1] * v + H[2]) / den - 0.5, sy = (H[3] * u + H[4] * v + H[5]) / den - 0.5;
        var x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0, o = (y * W + x) * 4;
        if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { od[o] = od[o + 1] = od[o + 2] = 255; od[o + 3] = 255; continue; }
        var i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        for (var ch = 0; ch < 3; ch++) od[o + ch] = (sd[i00 + ch] * (1 - tx) + sd[i10 + ch] * tx) * (1 - ty) + (sd[i01 + ch] * (1 - tx) + sd[i11 + ch] * tx) * ty;
        od[o + 3] = 255;
      }
    }
    ox.putImageData(img, 0, 0);
    return out;
  }
  /* the full clean-up: straighten, then white paper / dark ink */
  function clean(src) { return enhance(deskew(src)); }
  /* photo → { canvas (the clean page), quad (corners found, or null), cropped } */
  function smart(src, quad) {
    var q = quad === undefined ? detect(src) : quad;
    var page = q ? warp(src, q) : src;
    return { canvas: clean(page), plain: deskew(page), quad: q, cropped: !!q };   // v39: plain = cropped and straightened, not enhanced (what the reader gets)
  }
  return { enhance: enhance, deskew: deskew, sharpness: sharpness, clean: clean, detect: detect, warp: warp, smart: smart, homography: homography };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Scan;
