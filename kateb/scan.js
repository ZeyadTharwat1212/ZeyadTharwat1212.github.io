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
  return { enhance: enhance };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Scan;
