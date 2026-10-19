/* Shared engine: unlock key, prepare images, call the reader (Claude when the key is sk-ant-…, else Gemini free tier), helpers. */
var Engine = (function () {
  'use strict';
  var API = 'https://generativelanguage.googleapis.com/v1beta', CLAUDE_API = 'https://api.anthropic.com/v1/messages';
  var CLAUDE_MODEL = 'claude-sonnet-5-5', CLAUDE_BEST = 'claude-opus-5-5', CLAUDE_FAST = 'claude-haiku-5-5';   // reads / judge / tiny checks
  function provider(key) { return /^sk-ant-/.test(String(key || '')) ? 'claude' : 'gemini'; }
  var LS_KEY = 'kateb.apikey', LS_MODEL = 'kateb.model';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* ---------- password lock: key encrypted with AES-GCM, key from PBKDF2(password) ---------- */
  function b64u(bytes) { var s = ''; bytes = new Uint8Array(bytes); for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  async function derive(password, salt) {
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function lock(apiKey, password) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, await derive(password, salt), new TextEncoder().encode(apiKey));
    var all = new Uint8Array(28 + ct.byteLength); all.set(salt, 0); all.set(iv, 16); all.set(new Uint8Array(ct), 28);
    return b64u(all);
  }
  async function unlock(blob, password) {
    var all = unb64u(blob), salt = all.slice(0, 16), iv = all.slice(16, 28), ct = all.slice(28);
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, await derive(password, salt), ct);
    return new TextDecoder().decode(pt);
  }
  function blobFromHash() { var m = (location.hash || '').match(/k=([A-Za-z0-9_-]+)/); return m ? m[1] : null; }
  function savedKey() { return lsGet(LS_KEY); }
  function saveKey(k) { lsSet(LS_KEY, k); }
  function forget() { lsDel(LS_KEY); lsDel(LS_MODEL); }

  /* ---------- Gemini ---------- */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function listModels(key) {
    var r = await fetch(API + '/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    if (!r.ok) { var e = new Error('models ' + r.status); e.status = r.status; e.body = await r.text().catch(function () { return ''; }); throw e; }
    var j = await r.json();
    return (j.models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; }).map(function (m) { return m.name.replace(/^models\//, ''); });
  }
  /* best first: newest version; pro before flash; full before lite; stable before preview/exp */
  function rank(models) {
    var bad = /(tts|image|imagen|embed|live|audio|aqa|robotics|computer|native|veo|learnlm|nano|lite|gemma|thinking-exp)/i;
    var c = models.filter(function (n) { return /^gemini-/.test(n) && !bad.test(n); });
    function ver(n) { var m = n.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; }
    function score(n) { return ver(n) * 100 + (/pro/.test(n) ? 20 : /flash/.test(n) ? 10 : 0) - (/(preview|exp)/.test(n) ? 5 : 0) - (/-\d{3,}$/.test(n) ? 1 : 0); }
    c.sort(function (a, b) { return score(b) - score(a); });
    var flashFirst = c.filter(function (n) { return /flash/.test(n); }), pros = c.filter(function (n) { return /pro/.test(n); });
    /* try the best pro first (best reading), then the best flash models as the reliable free fallback */
    var order = [];
    if (pros[0]) order.push(pros[0]);
    flashFirst.slice(0, 3).forEach(function (n) { if (order.indexOf(n) < 0) order.push(n); });
    c.forEach(function (n) { if (order.indexOf(n) < 0 && order.length < 6) order.push(n); });
    if (!order.length) order = ['gemini-2.5-flash'];
    return order;
  }
  function blobToB64(blob) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(',')[1]); }; fr.onerror = rej; fr.readAsDataURL(blob); }); }

  /* Claude Messages API straight from the browser (the key is locked in the link, like the Gemini one).
     opt.system goes in a cached system block (the formula bank), opt.effort low|medium|high, opt.fast → Haiku. */
  async function generateClaude(key, prompt, blobs, opt) {
    var content = [];
    for (var i = 0; i < (blobs || []).length; i++) content.push({ type: 'image', source: { type: 'base64', media_type: blobs[i].type || 'image/jpeg', data: await blobToB64(blobs[i]) } });
    content.push({ type: 'text', text: prompt });
    var body = { model: opt.model || (opt.fast ? CLAUDE_FAST : opt.best ? CLAUDE_BEST : CLAUDE_MODEL), max_tokens: opt.maxTokens || 8192, messages: [{ role: 'user', content: content }],
      output_config: { effort: opt.effort || 'medium' } };
    if (opt.system) body.system = [{ type: 'text', text: opt.system, cache_control: { type: 'ephemeral' } }];
    var lastErr = null;
    for (var attempt = 0; attempt < 4; attempt++) {
      var r;
      try {
        r = await fetch(CLAUDE_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body), signal: opt.signal });
      } catch (e) { if (e && e.name === 'AbortError') throw { code: 'cancelled' }; lastErr = { code: 'network' }; await sleep(2500); continue; }
      if (r.ok) {
        var j = await r.json();
        if (j.usage) recordUsage(j.model || body.model, j.usage);
        var text = (j.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
        if (j.stop_reason === 'refusal') throw { code: 'SAFETY' };
        if (!text) { lastErr = { code: j.stop_reason || 'empty' }; break; }
        return { text: text, model: j.model || body.model, truncated: j.stop_reason === 'max_tokens' };
      }
      var t = await r.text().catch(function () { return ''; });
      if (r.status === 401 || (r.status === 400 && /api key|authentication/i.test(t))) throw { code: 'bad_key' };
      if (r.status === 400 && /credit|billing|balance/i.test(t)) throw { code: 'credit' };
      if (r.status === 429) { var ra = +(r.headers.get('retry-after') || 0) || 8; if (opt.onWait) opt.onWait(ra); await sleep(ra * 1000); lastErr = { code: 'rate' }; continue; }
      if (r.status === 529 || r.status >= 500) { await sleep(3000 * (attempt + 1)); lastErr = { code: 'server' }; continue; }
      if (r.status === 404 && body.model !== CLAUDE_MODEL) { body.model = CLAUDE_MODEL; continue; }
      lastErr = { code: 'model_' + r.status }; break;
    }
    throw lastErr || { code: 'unknown' };
  }

  /* one call with model fallback + waiting on rate limits. onWait(seconds) lets the page show "please wait". */
  async function generate(key, prompt, blobs, opt) {
    opt = opt || {};
    if (provider(key) === 'claude') return generateClaude(key, prompt, blobs, opt);
    if (opt.system) prompt = opt.system + '\n\n' + prompt;
    var parts = [{ text: prompt }];
    for (var i = 0; i < (blobs || []).length; i++) parts.push({ inline_data: { mime_type: blobs[i].type || 'image/jpeg', data: await blobToB64(blobs[i]) } });
    var body = JSON.stringify({ contents: [{ role: 'user', parts: parts }], generationConfig: { temperature: opt.temperature == null ? 0.1 : opt.temperature, maxOutputTokens: opt.maxTokens || 16384 } });
    var models = opt.models || JSON.parse(lsGet(LS_MODEL) || 'null');
    if (!models) { try { models = rank(await listModels(key)); } catch (e) { if (e && (e.status === 400 || e.status === 403)) throw { code: 'bad_key' }; throw { code: e && e.status ? 'server' : 'network' }; } }
    var lastErr = null;
    for (var mi = 0; mi < models.length; mi++) {
      var model = models[mi];
      for (var attempt = 0; attempt < 4; attempt++) {
        var r;
        try { r = await fetch(API + '/models/' + model + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: body, signal: opt.signal }); }
        catch (e) { if (e && e.name === 'AbortError') throw { code: 'cancelled' }; lastErr = { code: 'network' }; await sleep(3000); continue; }
        if (r.ok) {
          var j = await r.json(), c = (j.candidates || [])[0];
          var text = c && c.content && c.content.parts ? c.content.parts.filter(function (p) { return !p.thought && p.text; }).map(function (p) { return p.text; }).join('') : '';
          if (!text) { lastErr = { code: (c && c.finishReason) || 'empty' }; break; }
          /* remember a working order so later calls start with this model */
          if (!opt.models) lsSet(LS_MODEL, JSON.stringify([model].concat(models.filter(function (m) { return m !== model; }))));
          return { text: text, model: model, truncated: c.finishReason === 'MAX_TOKENS' };
        }
        var t = await r.text().catch(function () { return ''; });
        if (r.status === 400 && /API key not valid|API_KEY_INVALID/i.test(t)) throw { code: 'bad_key' };
        if (r.status === 403 && /PERMISSION_DENIED|API_KEY/i.test(t) && !/model/i.test(t)) throw { code: 'bad_key' };
        if (r.status === 429) {
          var daily = /PerDay|per day|daily/i.test(t);
          if (daily) { lastErr = { code: 'quota_day' }; break; }        // try next model
          var m = t.match(/"retryDelay":\s*"(\d+)/), wait = m ? Math.min(65, +m[1] + 2) : 25;
          if (opt.onWait) opt.onWait(wait);
          await sleep(wait * 1000); lastErr = { code: 'rate' }; continue;
        }
        if (r.status >= 500) { await sleep(4000 * (attempt + 1)); lastErr = { code: 'server' }; continue; }
        lastErr = { code: 'model_' + r.status }; break;                 // 404/403 for this model: next model
      }
    }
    throw lastErr || { code: 'unknown' };
  }

  /* ---------- images ---------- */
  function canvasOf(src) { var c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); return c; }
  async function fileToCanvases(f) {
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise, out = [];
      for (var n = 1; n <= pdf.numPages; n++) {
        var pg = await pdf.getPage(n), v1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: Math.min(4, 3000 / Math.max(v1.width, v1.height)) });
        var c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        await pg.render({ canvasContext: x, viewport: vp }).promise; out.push(c);
      }
      return out;
    }
    if (/\.(heic|heif)$/i.test(f.name)) throw { code: 'heic' };
    var bmp;
    try { bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); }
    catch (e) { bmp = await new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { rej({ code: 'badimg' }); }; im.src = URL.createObjectURL(f); }); }
    return [canvasOf(bmp)];
  }
  function scaled(c, maxSide) {
    var k = Math.min(1, maxSide / Math.max(c.width, c.height)); if (k === 1) return c;
    var n = document.createElement('canvas'); n.width = Math.round(c.width * k); n.height = Math.round(c.height * k);
    n.getContext('2d').drawImage(c, 0, 0, n.width, n.height); return n;
  }
  function rotated(base, deg) {
    if (!deg) return base; var c = document.createElement('canvas'), s = deg % 180 !== 0;
    c.width = s ? base.height : base.width; c.height = s ? base.width : base.height;
    var x = c.getContext('2d'); x.translate(c.width / 2, c.height / 2); x.rotate(deg * Math.PI / 180); x.drawImage(base, -base.width / 2, -base.height / 2); return c;
  }
  function jpeg(c, q) { return new Promise(function (res) { c.toBlob(res, 'image/jpeg', q || 0.9); }); }
  /* whole page + overlapping strips so small handwriting stays sharp */
  async function pageImages(c, maxBands, maxSide) {
    maxSide = maxSide || 3072;
    var list = [await jpeg(scaled(c, maxSide), 0.9)], bands = c.height < c.width * 0.9 ? 2 : (maxBands || 3);
    var ov = 0.07, h = c.height / bands;
    for (var i = 0; i < bands; i++) {
      var y0 = Math.max(0, Math.round(i * h - ov * c.height)), y1 = Math.min(c.height, Math.round((i + 1) * h + ov * c.height));
      var b = document.createElement('canvas'); b.width = c.width; b.height = y1 - y0;
      b.getContext('2d').drawImage(c, 0, y0, c.width, y1 - y0, 0, 0, c.width, y1 - y0);
      list.push(await jpeg(scaled(b, maxSide), 0.9));
    }
    return { blobs: list, bands: bands };
  }
  async function detectRotation(key, c, onWait) {
    try {
      var r = await generate(key, 'By how many degrees must this photo of a document page be rotated CLOCKWISE so the writing reads upright? Reply with only one number: 0, 90, 180 or 270.', [await jpeg(scaled(c, 1200), 0.85)], { maxTokens: 512, onWait: onWait, fast: true, effort: 'low' });
      var m = r.text.match(/\b(0|90|180|270)\b/); return m ? +m[1] : 0;
    } catch (e) { if (e && (e.code === 'bad_key')) throw e; return 0; }
  }
  function clean(t) { return String(t || '').replace(/^\s*```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim(); }

  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  var ERR = {
    bad_key: 'مفتاح الذكاء الاصطناعي لا يعمل. كلّم زياد.',
    credit: 'رصيد خدمة القراءة انتهى. كلّم زياد لشحن الرصيد.',
    quota_day: 'انتهى عدد الصفحات المسموح به اليوم. جرّب مرة أخرى بكرة.',
    rate: 'الخدمة مشغولة. اضغط «حاول مرة أخرى» بعد دقيقة.',
    network: 'لا يوجد إنترنت. تأكد من الاتصال واضغط «حاول مرة أخرى».',
    server: 'الخدمة متوقفة مؤقتاً. حاول بعد قليل.',
    heic: 'نوع الصورة غير مدعوم. أرسل الصورة لنفسك على واتساب ثم اخترها من جديد.',
    badimg: 'تعذر فتح الصورة. جرّب صورة أخرى.',
    SAFETY: 'تعذرت قراءة هذه الصفحة. جرّب صورة أخرى.',
    RECITATION: 'تعذرت قراءة هذه الصفحة. جرّب صورة أخرى.'
  };
  ERR.cancelled = 'تم الإلغاء.';
  function errText(e) { return (e && ERR[e.code]) || 'حصلت مشكلة. اضغط «حاول مرة أخرى».'; }

  /* ---------- Claude usage ledger (on this device): tokens per day per model → estimated cost ----------
     Prices are Anthropic's published list prices per million tokens: [input, output, cache write, cache read].
     The real bill is on console.anthropic.com; this is an estimate from the usage field of every reply. */
  var LS_USAGE = 'kateb.usage';
  var PRICE = { 'claude-opus-5-5': [4, 20, 5, 0.2], 'claude-sonnet-5-5': [2, 10, 2.5, 0.2], 'claude-haiku-5-5': [0.1, 0.5, 0.125, 0.01] };
  function priceOf(model) { var ks = Object.keys(PRICE); for (var i = 0; i < ks.length; i++) if (String(model || '').indexOf(ks[i]) === 0) return PRICE[ks[i]]; return PRICE['claude-opus-5-5']; }
  function usd(model, u) { var p = priceOf(model); return ((u.i || 0) * p[0] + (u.o || 0) * p[1] + (u.w || 0) * p[2] + (u.r || 0) * p[3]) / 1e6; }
  function day(t) { var d = t ? new Date(t) : new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function usageLoad() { try { var u = JSON.parse(lsGet(LS_USAGE) || 'null'); return u && u.d ? u : { d: {} }; } catch (e) { return { d: {} }; } }
  var usageSinks = [];
  function recordUsage(model, usage) {
    var rec = { c: 1, i: usage.input_tokens || 0, o: usage.output_tokens || 0, w: usage.cache_creation_input_tokens || 0, r: usage.cache_read_input_tokens || 0 };
    var L = usageLoad(), k = day(), m = String(model || 'claude'), row = (L.d[k] = L.d[k] || {}), cur = (row[m] = row[m] || { c: 0, i: 0, o: 0, w: 0, r: 0 });
    Object.keys(rec).forEach(function (x) { cur[x] += rec[x]; });
    var days = Object.keys(L.d).sort(); while (days.length > 400) delete L.d[days.shift()];
    lsSet(LS_USAGE, JSON.stringify(L));
    usageSinks.forEach(function (fn) { try { fn(m, rec, usd(m, rec)); } catch (e) {} });
  }
  function onUsage(fn) { usageSinks.push(fn); }
  function sum(into, m, u) { into.calls += u.c; into.tokens += u.i + u.o + u.w + u.r; into.usd += usd(m, u); }
  function usageSummary() {
    var L = usageLoad(), today = day(), month = today.slice(0, 7);
    var out = { today: { calls: 0, tokens: 0, usd: 0 }, month: { calls: 0, tokens: 0, usd: 0 }, total: { calls: 0, tokens: 0, usd: 0 }, models: {}, days: 0, first: null };
    Object.keys(L.d).sort().forEach(function (k) {
      out.days++; if (!out.first) out.first = k;
      Object.keys(L.d[k]).forEach(function (m) {
        var u = L.d[k][m]; sum(out.total, m, u); if (k === today) sum(out.today, m, u); if (k.slice(0, 7) === month) sum(out.month, m, u);
        var mm = (out.models[m] = out.models[m] || { calls: 0, tokens: 0, usd: 0 }); sum(mm, m, u);
      });
    });
    return out;
  }
  function usageReset() { lsSet(LS_USAGE, JSON.stringify({ d: {} })); }

  return { provider: provider, lock: lock, unlock: unlock, blobFromHash: blobFromHash, savedKey: savedKey, saveKey: saveKey, forget: forget,
    listModels: listModels, rank: rank, generate: generate, fileToCanvases: fileToCanvases, scaled: scaled, rotated: rotated,
    pageImages: pageImages, detectRotation: detectRotation, clean: clean, download: download, errText: errText, lsGet: lsGet, lsSet: lsSet,
    recordUsage: recordUsage, onUsage: onUsage, usageSummary: usageSummary, usageReset: usageReset, usd: usd, priceOf: priceOf };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
