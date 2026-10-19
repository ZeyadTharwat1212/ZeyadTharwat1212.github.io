/* Raster: the reviewed text drawn onto A4 pages with the browser's own Arabic text rendering, and those pages
   packed into a PDF file — the shareable document for phones whose browser refuses to share a .docx through the
   share sheet (Chrome's file safelist has PDF, not Office files). The Word file stays the office-exact one.
   pages(blocks, opts) → canvases; pdf(canvases) → Blob. pdfFromJpegs() is pure and runs under Node for tests. */
var Raster = (function () {
  'use strict';
  var DPI = 150, MM = DPI / 25.4, A4W = Math.round(210 * MM), A4H = Math.round(297 * MM);
  var FONT = '"Noto Naskh Arabic","Simplified Arabic","Amiri","Traditional Arabic","Times New Roman",serif';
  function pt(p) { return p * DPI / 72; }
  var RLM = '‏';
  function rtlDates(t) { return String(t).replace(/([0-9٠-٩]{1,4})\/([0-9٠-٩]{1,4})(\/([0-9٠-٩]{1,4}))?/g, function (m, a, b, c, d) { return a + RLM + '/' + RLM + b + (d ? RLM + '/' + RLM + d : ''); }); }
  function arabicDigits(t) { return String(t).replace(/[0-9]/g, function (c) { return '٠١٢٣٤٥٦٧٨٩'[+c]; }); }

  /* words of a paragraph with their style: [{t, b, u, hl}] */
  var digitsAr = false;
  function wordsOf(runs) {
    var out = [];
    (runs || []).forEach(function (r) {
      var text = r.frac ? r.frac[0] + '/' + r.frac[1] : String(r.text || '');
      if (digitsAr) text = arabicDigits(text);
      text.split(/(\s+|\t)/).forEach(function (w) { if (!w || /^\s+$/.test(w) && w !== '\t') return; out.push({ t: w === '\t' ? '   ' : w, b: !!r.b, u: !!r.u, hl: !!r.hl }); });
    });
    return out;
  }
  function font(size, bold) { return (bold ? 'bold ' : '') + size.toFixed(1) + 'px ' + FONT; }

  function pages(blocks, opts) {
    opts = opts || {};
    var rtl = opts.dir !== 'ltr', base = pt(opts.basePt || 14), lead = 1.75, out = [];
    digitsAr = !!opts.arabicDigits;                      // the office's papers show ٠-٩
    var mL = (opts.left || 20) * MM, mR = (opts.right || 20) * MM, mT = (opts.top || 20) * MM, mB = (opts.bottom || 20) * MM;
    var c, x, y, pageNo = 0;
    function newPage() {
      c = document.createElement('canvas'); c.width = A4W; c.height = A4H; x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, A4W, A4H); x.fillStyle = '#000'; x.textBaseline = 'alphabetic'; x.direction = rtl ? 'rtl' : 'ltr';
      out.push(c); y = mT; pageNo++;
      if (opts.stamp && opts.stamp.length) drawStamp();
      if (opts.side && opts.side.length) drawSide();
      if (pageNo > 1 || opts.pageNumbers) { x.font = font(pt(10), false); x.textAlign = 'center'; x.fillText(arabicDigits(String(pageNo)), A4W / 2, A4H - mB / 2); }
    }
    /* the office's stamp box in the top-left corner and the side column under it */
    var stampBox = null;
    function drawStamp() {
      var w = 52 * MM, h = 26 * MM, sx = 8 * MM, sy = mT - 6 * MM; stampBox = { x: sx, y: sy, w: w, h: h };
      x.save(); x.lineWidth = 3; x.strokeStyle = '#000'; x.fillStyle = '#fff';
      x.beginPath(); x.roundRect ? x.roundRect(sx, sy, w, h, 14) : x.rect(sx, sy, w, h); x.fill(); x.stroke();
      x.fillStyle = '#000'; x.textAlign = 'center'; var ly = sy + 7 * MM;
      opts.stamp.forEach(function (l, i) { x.font = font(pt(i === 1 ? 14 : 11), i === 1); x.fillText(l, sx + w / 2, ly); ly += pt(i === 1 ? 16 : 12) * 1.15; });
      x.restore();
    }
    function drawSide() {
      var sx = 8 * MM, w = 40 * MM, sy = (stampBox ? stampBox.y + stampBox.h : mT) + 6 * MM;
      x.save(); x.textAlign = 'center'; x.fillStyle = '#000';
      opts.side.forEach(function (l, i) { x.font = font(pt(11), i === 0); if (i === 0) { var tw = x.measureText(l).width; x.fillRect(sx + w / 2 - tw / 2, sy + 3, tw, 2); } x.fillText(l, sx + w / 2, sy); sy += pt(11) * 1.5; });
      x.beginPath(); x.moveTo(sx + w + 4 * MM, stampBox ? stampBox.y + stampBox.h + 2 * MM : mT); x.lineTo(sx + w + 4 * MM, A4H - mB); x.lineWidth = 1.5; x.strokeStyle = '#000'; x.stroke();
      x.restore();
    }
    function left(yy, lineH) {
      var l = mL + (opts.side && opts.side.length ? 36 * MM : 0);
      if (stampBox && yy - lineH < stampBox.y + stampBox.h && yy > stampBox.y) l = Math.max(l, stampBox.x + stampBox.w + 3 * MM);
      return l;
    }
    newPage();
    function ensure(h) { if (y + h > A4H - mB) newPage(); }
    /* one paragraph: wrapped lines of styled words, right-aligned (RTL) or left-aligned (LTR); centred for headings */
    function para(runs, o) {
      var size = pt(o.size || opts.basePt || 14), lineH = size * lead, words = wordsOf(runs);
      if (!words.length) { y += lineH * 0.6; return; }
      var lines = [], cur = [], curW = 0, space = size * 0.3;
      words.forEach(function (w) {
        x.font = font(size, w.b || o.bold); var ww = x.measureText(rtlDates(w.t)).width;
        var maxW = A4W - mR - left(y + (lines.length + 1) * lineH, lineH) - (o.indent || 0);
        if (cur.length && curW + space + ww > maxW) { lines.push({ ws: cur, w: curW }); cur = []; curW = 0; }
        cur.push(w); curW += (cur.length > 1 ? space : 0) + ww;
      });
      if (cur.length) lines.push({ ws: cur, w: curW });
      y += o.before || 0;
      lines.forEach(function (ln) {
        ensure(lineH); y += lineH;
        var l = left(y, lineH) + (o.indent || 0), r = A4W - mR, cx;
        if (o.align === 'C') cx = rtl ? (l + r) / 2 + ln.w / 2 : (l + r) / 2 - ln.w / 2; else if ((o.align === 'L') === rtl) cx = rtl ? l + ln.w : r - ln.w; else cx = rtl ? r : l;
        ln.ws.forEach(function (w, i) {
          x.font = font(size, w.b || o.bold); x.textAlign = rtl ? 'right' : 'left';
          var t = rtlDates(w.t), ww = x.measureText(t).width;
          if (w.hl) { x.fillStyle = '#FDE68A'; x.fillRect(rtl ? cx - ww : cx, y - size * 0.95, ww, size * 1.25); x.fillStyle = '#000'; }
          x.fillText(t, cx, y);
          if (w.u || o.u) { x.fillRect(rtl ? cx - ww : cx, y + size * 0.12, ww, Math.max(1, size * 0.06)); }
          cx += (rtl ? -1 : 1) * (ww + space);
        });
      });
      y += o.after || lineH * 0.25;
    }
    function table(rows) {
      var cols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1), size = pt(12), lineH = size * 1.6, pad = size * 0.5;
      var l = left(y, lineH), w = A4W - mR - l, cw = w / cols;
      rows.forEach(function (r) {
        /* wrap every cell, the row is as tall as its tallest cell */
        var cells = r.map(function (cell) {
          var ws = wordsOf(cell), lines = [], cur = [], cw0 = 0;
          ws.forEach(function (wd) { x.font = font(size, wd.b); var ww = x.measureText(wd.t).width; if (cur.length && cw0 + size * 0.3 + ww > cw - pad * 2) { lines.push(cur); cur = []; cw0 = 0; } cur.push(wd); cw0 += (cur.length > 1 ? size * 0.3 : 0) + ww; });
          if (cur.length) lines.push(cur); return lines;
        });
        var rh = Math.max(1, Math.max.apply(null, cells.map(function (c2) { return c2.length; }))) * lineH + pad;
        ensure(rh);
        cells.forEach(function (lines, j) {
          var cx0 = rtl ? A4W - mR - j * cw : l + j * cw, cx1 = rtl ? cx0 - cw : cx0 + cw;
          x.strokeStyle = '#000'; x.lineWidth = 1; x.strokeRect(Math.min(cx0, cx1), y, cw, rh);
          var ly = y + pad / 2;
          lines.forEach(function (ln) {
            ly += lineH; var cx = rtl ? cx0 - pad : cx0 + pad;
            ln.forEach(function (wd) { x.font = font(size, wd.b); x.textAlign = rtl ? 'right' : 'left'; var t = rtlDates(wd.t); x.fillText(t, cx, ly - lineH * 0.3); cx += (rtl ? -1 : 1) * (x.measureText(t).width + size * 0.3); });
          });
        });
        y += rh;
      });
      y += lineH * 0.5;
    }
    function image(src, w, h) {
      return new Promise(function (res) {
        var im = new Image(); im.onload = function () { var dw = Math.min(w, A4W - mL - mR), dh = dw * (h / w); ensure(dh); x.drawImage(im, rtl ? A4W - mR - dw : mL, y, dw, dh); y += dh + pt(8); res(); }; im.onerror = function () { res(); }; im.src = src;
      });
    }
    var chain = Promise.resolve();
    (blocks || []).forEach(function (b) {
      chain = chain.then(function () {
        if (b.table) { table(b.table); return; }
        if (b.k === 'table') { table(b.rows); return; }
        if (b.k === 'fig') return image(b.data, pt(b.w || 300), pt(b.h || 200));
        if (b.k === 'gap') { y += pt(14) * 3; return; }
        if (b.k === 'opt') { para([].concat.apply([], b.cells.map(function (c2, i) { return c2.concat([{ text: '      ' }]); })), { size: 12 }); return; }
        if (b.k === 'q') { para(b.runs, { bold: true, size: 15, before: pt(10) }); return; }
        if (b.k === 'item') { para(b.runs, { size: 13 }); return; }
        if (b.heading) { para(b.runs, { bold: true, size: 18, align: 'C', before: pt(6), after: pt(8) }); return; }
        if (b.sub) { para(b.runs, { bold: true, size: 15, before: pt(8) }); return; }
        if (b.list) { para(b.runs, { indent: pt(14) }); return; }
        para(b.runs, { align: b.align });
      });
    });
    return chain.then(function () { return out; });
  }

  /* ---------- PDF: one JPEG per page ---------- */
  function b64bytes(dataUrl) { var bin = atob(dataUrl.split(',')[1]), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function pdfFromJpegs(imgs) {
    var enc = function (s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
    var parts = [], offsets = [], len = 0, W = 595.28, H = 841.89;
    function push(u8) { parts.push(u8); len += u8.length; }
    function obj(n, body) { offsets[n] = len; push(enc(n + ' 0 obj\n')); if (typeof body === 'string') push(enc(body)); else push(body); push(enc('\nendobj\n')); }
    push(enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
    var n = imgs.length, kids = [];
    for (var i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>');
    imgs.forEach(function (im, i) {
      var p = 3 + i * 3, cs = p + 1, xo = p + 2, content = 'q ' + W.toFixed(2) + ' 0 0 ' + H.toFixed(2) + ' 0 0 cm /Im' + i + ' Do Q';
      obj(p, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Contents ' + cs + ' 0 R /Resources << /XObject << /Im' + i + ' ' + xo + ' 0 R >> >> >>');
      obj(cs, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
      offsets[xo] = len; push(enc(xo + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.data.length + ' >>\nstream\n')); push(im.data); push(enc('\nendstream\nendobj\n'));
    });
    var total = 3 + n * 3, xref = len, s = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (var k = 1; k < total; k++) s += String(offsets[k]).padStart(10, '0') + ' 00000 n \n';
    s += 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    push(enc(s));
    var all = new Uint8Array(len), o = 0; parts.forEach(function (u) { all.set(u, o); o += u.length; });
    return all;
  }
  function pdf(canvases) {
    var imgs = canvases.map(function (c) { return { data: b64bytes(c.toDataURL('image/jpeg', 0.88)), w: c.width, h: c.height }; });
    return new Blob([pdfFromJpegs(imgs)], { type: 'application/pdf' });
  }
  return { pages: pages, pdf: pdf, pdfFromJpegs: pdfFromJpegs, A4W: A4W, A4H: A4H };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Raster;
