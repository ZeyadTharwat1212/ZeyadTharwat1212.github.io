/* v44 speech-to-text built into the app (Zeyad: «الكلام يطلع وأنا بتكلم، أياً كان نوع البراوزر»).
   The browser's own speech engine is missing in Brave (and fails on some phones); this one runs ON THE DEVICE, free,
   no key, no server: OpenAI's Whisper (small, multilingual) through transformers.js. The model (~250 MB) is downloaded
   once per device and kept by the browser. WebGPU when the device has it (fast), WebAssembly otherwise.
   transcribe(Float32Array at 16 kHz) → text. Calls are queued one at a time. */
var LocalASR = (function () {
  'use strict';
  var LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
  var MODEL = 'onnx-community/whisper-small';
  var pipeP = null, device = '', queue = Promise.resolve(), progress = { pct: 0, loaded: false };
  var listeners = [];
  function emit() { listeners.forEach(function (f) { try { f(progress); } catch (e) {} }); }
  function supported() { return typeof WebAssembly !== 'undefined' && typeof fetch !== 'undefined'; }
  async function pickDevice() {
    try { if (navigator.gpu) { var ad = await navigator.gpu.requestAdapter(); if (ad) return { name: 'webgpu', f16: ad.features && ad.features.has('shader-f16') }; } } catch (e) {}
    return { name: 'wasm', f16: false };
  }
  function load() {
    if (pipeP) return pipeP;
    pipeP = (async function () {
      var T = await import(LIB);
      T.env.allowLocalModels = false;
      var d = /Android|iPhone|iPad/i.test(navigator.userAgent) ? { name: 'wasm', f16: false } : await pickDevice(); device = d.name;   // phones: the smaller CPU model (~250 MB)
      var files = {};
      var opts = {
        device: d.name,
        dtype: d.name === 'webgpu' ? { encoder_model: d.f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
        progress_callback: function (p) {
          if (p && p.file && p.total) { files[p.file] = { l: p.loaded || 0, t: p.total }; var l = 0, t = 0; for (var k in files) { l += files[k].l; t += files[k].t; } progress.pct = t ? Math.round(100 * l / t) : 0; emit(); }
        }
      };
      var pipe;
      try { pipe = await T.pipeline('automatic-speech-recognition', MODEL, opts); }
      catch (e) {                                                           // a GPU that refuses the model: the CPU path
        if (d.name !== 'webgpu') throw e;
        device = 'wasm'; pipe = await T.pipeline('automatic-speech-recognition', MODEL, { device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, progress_callback: opts.progress_callback });
      }
      progress.loaded = true; progress.pct = 100; emit();
      return pipe;
    })();
    pipeP.catch(function () { pipeP = null; progress.loaded = false; emit(); });
    return pipeP;
  }
  /* Whisper's well-known inventions on silence or noise (Arabic subtitles credits, «thanks for watching»…) */
  var JUNK = /(ترجمة\s*نانسي|نانسي\s*قنقر|اشترك(وا)?\s*(في|ب)\s*القناة|شكرا\s*(لكم\s*)?(على|لل)\s*المشاهدة|لا\s*تنسوا\s*الاشتراك|Thank you for watching|Subscribe|Subtitles by|\[(موسيقى|Music)\]|♪)/gi;
  function clean(t) {
    t = String(t || '').replace(JUNK, ' ').replace(/\s+/g, ' ').trim();
    if (/^[\s.،,؟?!…-]*$/.test(t)) return '';
    return t;
  }
  function transcribe(pcm16k, lang) {
    var job = queue.then(async function () {
      var pipe = await load();
      var r = await pipe(pcm16k, { language: lang || 'arabic', task: 'transcribe', chunk_length_s: 30, stride_length_s: 4 });
      return clean(r && r.text);
    });
    queue = job.catch(function () {});
    return job;
  }
  return { supported: supported, load: load, transcribe: transcribe, onProgress: function (f) { listeners.push(f); }, progress: function () { return progress; }, device: function () { return device; }, _clean: clean, MODEL: MODEL };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LocalASR;
