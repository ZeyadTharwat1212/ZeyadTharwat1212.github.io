/* Free on-device OCR for PRINTED pages: Tesseract (kateb/vendor/tesseract, Apache-2.0) with its Arabic model.
   Loaded on first use (about 5 MB once, then kept by the browser) and run in a Web Worker. The app then asks Claude
   for ONE correction of the OCR text against one image of the page instead of four reads with six images each.
   Never used for handwriting: Tesseract's Arabic model is trained on print, and the kind call says which it is. */
var Ocr = (function () {
  'use strict';
  var BASE = 'kateb/vendor/tesseract/', worker = null, loading = null, failed = false;
  function abs(p) { return new URL(BASE + p, location.href).href; }
  function supported() { return typeof Worker !== 'undefined' && typeof WebAssembly === 'object' && typeof document !== 'undefined'; }
  function script() {
    return new Promise(function (res, rej) {
      if (window.Tesseract) return res();
      var s = document.createElement('script'); s.src = abs('tesseract.min.js');
      s.onload = function () { res(); }; s.onerror = function () { rej(new Error('tesseract script')); };
      document.head.appendChild(s);
    });
  }
  var STATUS = { 'loading tesseract core': 'جارٍ تحميل القارئ المجاني…', 'initializing tesseract': 'جارٍ تجهيز القارئ المجاني…', 'loading language traineddata': 'جارٍ تحميل اللغة العربية…', 'initializing api': 'جارٍ تجهيز القارئ المجاني…', 'recognizing text': 'جارٍ القراءة على الجهاز…' };
  var progressCb = null;
  function get() {
    if (worker) return Promise.resolve(worker);
    if (!loading) loading = (async function () {
      await script();
      var w = await window.Tesseract.createWorker('ara', 1, {
        workerPath: abs('worker.min.js'), corePath: abs('tesseract-core-simd-lstm.wasm.js'), langPath: abs('').replace(/\/$/, ''), gzip: true,
        logger: function (m) { if (progressCb && m && m.status) progressCb(STATUS[m.status] || null, typeof m.progress === 'number' ? m.progress : null); }
      });
      await w.setParameters({ preserve_interword_spaces: '1' });
      worker = w; return w;
    })().catch(function (e) { failed = true; loading = null; throw e; });
    return loading;
  }
  function arabicRatio(t) { var ar = (String(t).match(/[ء-ي]/g) || []).length, all = (String(t).match(/\S/g) || []).length; return all ? ar / all : 0; }
  /* text of the page, confidence 0–100, share of Arabic letters */
  async function read(canvas, opt) {
    opt = opt || {}; progressCb = opt.onProgress || null;
    var w = await get();
    if (opt.signal && opt.signal.aborted) throw { code: 'cancelled' };
    var blob = await new Promise(function (r) { canvas.toBlob(r, 'image/png'); });
    var r = await w.recognize(blob);
    if (opt.signal && opt.signal.aborted) throw { code: 'cancelled' };
    var text = String(r.data.text || '').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return { text: text, conf: Math.round(r.data.confidence || 0), arabic: arabicRatio(text) };
  }
  /* good enough to be corrected rather than read again: enough text, mostly Arabic letters, not a guess */
  function usable(o) { return !!o && o.text.length >= 40 && o.arabic >= 0.5 && o.conf >= 50; }
  return { supported: supported, read: read, usable: usable, arabicRatio: arabicRatio, loaded: function () { return !!worker; }, failed: function () { return failed; } };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Ocr;
