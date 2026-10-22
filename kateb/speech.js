/* Speech: recording (MediaRecorder, pause/resume, waveform), live recognition (the browser's engine, interim vs final),
   audio files → 16 kHz mono WAV chunks for the transcriber (decoded by the browser, so every format the browser
   plays is accepted), chunk merging (overlap removed, order kept) and spoken punctuation commands.
   Pure helpers also run under Node for tests (merge, commands, wav). */
var Speech = (function () {
  'use strict';
  var CHUNK_SEC = 480, OVERLAP_SEC = 3, RATE = 16000;

  /* ---------- live recognition (Chrome, Edge, Safari; not Firefox) ---------- */
  function liveSupported() { return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  function live(opt) {
    var R = window.SpeechRecognition || window.webkitSpeechRecognition; if (!R) return null;
    var rec = new R(), on = false, finals = [], restartT = null;
    rec.lang = opt.lang || 'ar-EG'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var t = e.results[i][0].transcript;
        if (e.results[i].isFinal) { finals.push(t.trim()); if (opt.onFinal) opt.onFinal(t.trim(), finals.slice()); }
        else interim += t;
      }
      if (opt.onInterim) opt.onInterim(interim.trim());
    };
    /* v33: a real failure («network» on the person's Chrome and phone: the browser could not reach its speech service,
       «not-allowed», «audio-capture», …) stops the engine and is reported — it used to restart silently forever while
       nothing was written */
    var fatal = null, got = false;
    rec.onerror = function (e) {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (/^(network|not-allowed|service-not-allowed|audio-capture|language-not-supported|bad-grammar)$/.test(e.error)) { fatal = e.error; on = false; if (opt.onFatal) opt.onFatal(e.error, got); }
      if (opt.onError) opt.onError(e.error);
    };
    var onres = rec.onresult; rec.onresult = function (e) { got = true; onres(e); };
    /* the engine stops by itself after silence: start again while the person is still recording */
    rec.onend = function () { if (on && !fatal) { clearTimeout(restartT); restartT = setTimeout(function () { try { rec.start(); } catch (e) {} }, 250); } else if (opt.onEnd) opt.onEnd(finals.slice()); };
    return {
      start: function () { on = true; try { rec.start(); } catch (e) {} },
      pause: function () { on = false; try { rec.stop(); } catch (e) {} },
      resume: function () { if (fatal) return; on = true; try { rec.start(); } catch (e) {} },
      failed: function () { return fatal; },
      stop: function () { on = false; clearTimeout(restartT); try { rec.stop(); } catch (e) {} },
      finals: function () { return finals.slice(); }
    };
  }

  /* ---------- recording ---------- */
  function recSupported() { return typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && typeof MediaRecorder !== 'undefined'); }
  function pickMime() {
    var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    for (var i = 0; i < list.length; i++) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(list[i])) return list[i];
    return '';
  }
  async function recorder(opt) {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    var mime = pickMime(), mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks = [], startT = 0, pausedAt = 0, pausedTotal = 0, timer = null;
    var ctx = null, an = null, src = null;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); src = ctx.createMediaStreamSource(stream); an = ctx.createAnalyser(); an.fftSize = 256; src.connect(an); } catch (e) { an = null; }
    /* v33 live transcription by the audio key: the raw samples are kept so the newest few seconds can be sent as a WAV */
    var pcm = [], pcmLen = 0, cutAt = 0, proc = null;
    if (opt.pcm && ctx && src) {
      try {
        proc = ctx.createScriptProcessor(4096, 1, 1);
        proc.onaudioprocess = function (ev) { if (mr.state !== 'recording') return; var d = ev.inputBuffer.getChannelData(0); pcm.push(new Float32Array(d)); pcmLen += d.length; };
        src.connect(proc); proc.connect(ctx.destination); if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      } catch (e) { proc = null; }
    }
    function pcmSince(from) {
      var out = new Float32Array(pcmLen - from), o = 0, pos = 0;
      for (var i = 0; i < pcm.length; i++) { var b = pcm[i], end = pos + b.length; if (end > from) { var st = Math.max(0, from - pos); out.set(b.subarray(st), o); o += b.length - st; } pos = end; }
      return out;
    }
    function to16k(x, rate) {
      if (rate === RATE) return x;
      var ratio = rate / RATE, n = Math.floor(x.length / ratio), y = new Float32Array(n);
      for (var i = 0; i < n; i++) { var a = Math.floor(i * ratio), b = Math.min(x.length, Math.floor((i + 1) * ratio)), s = 0; for (var k = a; k < b; k++) s += x[k]; y[i] = b > a ? s / (b - a) : x[a] || 0; }
      return y;
    }
    mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    stream.getAudioTracks().forEach(function (t) { t.onended = function () { if (opt.onLost) opt.onLost(); }; });
    function elapsed() { return (Date.now() - startT - pausedTotal) / 1000; }
    function tick() { if (opt.onTick) opt.onTick(elapsed(), level()); }
    function level() {
      if (!an) return 0; var d = new Uint8Array(an.frequencyBinCount); an.getByteTimeDomainData(d); var s = 0;
      for (var i = 0; i < d.length; i++) { var v = (d[i] - 128) / 128; s += v * v; }
      return Math.sqrt(s / d.length);
    }
    return {
      mime: mr.mimeType || mime || 'audio/webm',
      start: function () { startT = Date.now(); pausedTotal = 0; mr.start(1000); timer = setInterval(tick, 100); },
      pause: function () { if (mr.state === 'recording') { mr.pause(); pausedAt = Date.now(); } },
      resume: function () { if (mr.state === 'paused') { mr.resume(); pausedTotal += Date.now() - pausedAt; } },
      elapsed: elapsed, level: level, analyser: function () { return an; }, state: function () { return mr.state; },
      /* the samples recorded since the last cut, as a 16 kHz WAV (null when shorter than minSec) */
      pcmReady: function () { return !!proc; },
      pending: function () { return ctx ? (pcmLen - cutAt) / ctx.sampleRate : 0; },
      cut: function (minSec) {
        if (!proc || !ctx) return null;
        if ((pcmLen - cutAt) / ctx.sampleRate < (minSec || 0.8)) return null;
        var x = pcmSince(cutAt); pcm = []; pcmLen = 0; cutAt = 0;          // what was sent is not kept (memory stays small)
        var e = 0; for (var i = 0; i < x.length; i += 4) e += x[i] * x[i];
        if (Math.sqrt(e / Math.max(1, x.length / 4)) < 0.004) return null;  // only silence: nothing to send
        return wavBlob(normalise(to16k(x, ctx.sampleRate)), RATE);
      },
      stop: function () {
        return new Promise(function (res) {
          clearInterval(timer);
          var done = function () {
            stream.getTracks().forEach(function (t) { t.stop(); });
            try { if (proc) proc.disconnect(); } catch (e) {}
            try { if (ctx) ctx.close(); } catch (e) {}
            res({ blob: new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' }), seconds: elapsed() });
          };
          if (mr.state === 'inactive') return done();
          mr.onstop = done; try { mr.stop(); } catch (e) { done(); }
        });
      }
    };
  }
  /* the waveform: a column per frame of the level history, drawn on a canvas */
  function drawWave(canvas, hist, active) {
    var x = canvas.getContext('2d'), w = canvas.width, h = canvas.height; x.clearRect(0, 0, w, h);
    var n = hist.length, bw = 4, gap = 2, cols = Math.floor(w / (bw + gap)), start = Math.max(0, n - cols);
    for (var i = start; i < n; i++) { var v = Math.min(1, hist[i] * 4), bh = Math.max(3, v * (h - 6)), cx = (i - start) * (bw + gap); x.fillStyle = active ? '#DC2626' : '#94A3B8'; x.fillRect(cx, (h - bh) / 2, bw, bh); }
  }

  /* ---------- audio files → 16 kHz mono WAV chunks ---------- */
  function wavBlob(samples, rate) {
    var n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), i;
    function str(o, s) { for (var k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    for (i = 0; i < n; i++) { var s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true); }
    return new Blob([buf], { type: 'audio/wav' });
  }
  /* decode with the browser (mp3, m4a/aac, ogg/opus, webm, wav, …), mix to mono, resample to 16 kHz */
  async function decode(blob) {
    var AC = window.OfflineAudioContext || window.webkitOfflineAudioContext, ab = await blob.arrayBuffer();
    var probe = new (window.AudioContext || window.webkitAudioContext)();
    var audio;
    try { audio = await new Promise(function (res, rej) { var p = probe.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); }); }
    finally { try { probe.close(); } catch (e) {} }
    var len = Math.ceil(audio.duration * RATE), off = new AC(1, len, RATE), s = off.createBufferSource(); s.buffer = audio; s.connect(off.destination); s.start(0);
    var out = await off.startRendering();
    return { samples: out.getChannelData(0), rate: RATE, seconds: audio.duration };
  }
  /* quiet speech: normalise the peak to -1 dBFS (a gain only, nothing else is touched) */
  function normalise(samples) {
    var peak = 0; for (var i = 0; i < samples.length; i++) { var a = Math.abs(samples[i]); if (a > peak) peak = a; }
    if (peak > 0.01 && peak < 0.5) { var g = 0.89 / peak; for (i = 0; i < samples.length; i++) samples[i] *= g; }
    return samples;
  }
  /* cut points at the quietest moment near each chunk boundary, chunks overlap so no word is lost at a cut */
  function chunkPlan(seconds, samples, rate) {
    if (seconds <= CHUNK_SEC * 1.2) return [[0, seconds]];
    var cuts = [0], t = CHUNK_SEC;
    while (t < seconds - CHUNK_SEC * 0.3) {
      var best = t, bestE = Infinity;
      for (var c = t - 20; c <= t + 20; c += 0.5) {
        if (c <= cuts[cuts.length - 1] + 30 || c >= seconds) continue;
        var i0 = Math.floor(c * rate), e = 0, n = Math.min(samples.length, i0 + rate * 0.4) - i0;
        for (var i = i0; i < i0 + n; i++) e += samples[i] * samples[i];
        e /= Math.max(1, n); if (e < bestE) { bestE = e; best = c; }
      }
      cuts.push(best); t = best + CHUNK_SEC;
    }
    var out = [];
    for (var k = 0; k < cuts.length; k++) out.push([Math.max(0, cuts[k] - (k ? OVERLAP_SEC : 0)), k + 1 < cuts.length ? Math.min(seconds, cuts[k + 1] + OVERLAP_SEC) : seconds]);
    return out;
  }
  async function toChunks(blob) {
    var d = await decode(blob), samples = normalise(d.samples), plan = chunkPlan(d.seconds, samples, d.rate);
    return { seconds: d.seconds, chunks: plan.map(function (p) { return { from: p[0], to: p[1], blob: wavBlob(samples.subarray(Math.floor(p[0] * d.rate), Math.floor(p[1] * d.rate)), d.rate) }; }) };
  }

  /* ---------- merging chunk transcripts: the overlap at a cut is spoken twice, written once ---------- */
  function words(t) { return String(t || '').split(/\s+/).filter(Boolean); }
  function norm(w) { return w.replace(/[،,.؛;:!؟?"«»()\[\]⟦⟧]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي'); }
  function merge(parts) {
    var out = '';
    parts.forEach(function (p, k) {
      p = String(p || '').trim(); if (!p) return;
      if (!out) { out = p; return; }
      var a = words(out), b = words(p), max = Math.min(40, a.length, b.length), cut = 0;
      /* longest run of words that ends the first part and starts the second */
      for (var n = max; n >= 3; n--) {
        var ok = true;
        for (var i = 0; i < n; i++) if (norm(a[a.length - n + i]) !== norm(b[i])) { ok = false; break; }
        if (ok) { cut = n; break; }
      }
      out = out + '\n' + b.slice(cut).join(' ');
    });
    return out;
  }

  /* ---------- spoken punctuation commands ---------- */
  var CMD = [
    [/\s*(?:^|\s)(?:علامة\s+)?استفهام(?=\s|$)/g, '؟'], [/\s*(?:^|\s)(?:علامة\s+)?تعجب(?=\s|$)/g, '!'],
    [/\s*(?:^|\s)نقطتان(?=\s|$)/g, ':'], [/\s*(?:^|\s)نقطة(?=\s*$)/g, '.'], [/\s*(?:^|\s)فاصلة(?=\s*$)/g, '،'], [/\s*(?:^|\s)فاصلة\s+منقوطة(?=\s*$)/g, '؛']
  ];
  /* one final phrase from the engine → the phrase with its commands applied; {text, newline, paragraph, heading} */
  function command(phrase) {
    var t = ' ' + String(phrase || '').trim() + ' ', r = { text: '', newline: false, paragraph: false, heading: false };
    if (/^\s*(?:فقرة\s+جديدة|فقرة\s+جديده)\s*$/.test(t)) { r.paragraph = true; return r; }
    if (/^\s*سطر\s+جديد\s*$/.test(t)) { r.newline = true; return r; }
    if (/\s(?:فقرة\s+جديدة|فقرة\s+جديده)\s*$/.test(t)) { r.paragraph = true; t = t.replace(/\s(?:فقرة\s+جديدة|فقرة\s+جديده)\s*$/, ' '); }
    else if (/\sسطر\s+جديد\s*$/.test(t)) { r.newline = true; t = t.replace(/\sسطر\s+جديد\s*$/, ' '); }
    if (/^\s*عنوان\s+\S/.test(t)) { r.heading = true; t = t.replace(/^\s*عنوان\s+/, ' '); }
    CMD.forEach(function (c) { t = t.replace(c[0], c[1]); });
    r.text = t.replace(/\s+([،.؟!:؛])/g, '$1').trim();
    return r;
  }
  function fmtTime(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return (m + ':' + (s < 10 ? '0' : '') + s).replace(/[0-9]/g, function (c) { return '٠١٢٣٤٥٦٧٨٩'[+c]; }); }

  return { liveSupported: liveSupported, live: live, recSupported: recSupported, recorder: recorder, drawWave: drawWave, decode: decode, toChunks: toChunks, wavBlob: wavBlob, chunkPlan: chunkPlan, merge: merge, command: command, fmtTime: fmtTime, CHUNK_SEC: CHUNK_SEC, OVERLAP_SEC: OVERLAP_SEC };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Speech;
