/* «ملفاتي» shared by every device of the app (Zeyad: «الملفات تبقى موحدة للكاتب في أي جهاز»).
   No server: the files live in Zeyad's own PRIVATE GitHub repository, reached from the browser with a token that
   setup.html locks with the family's password into the link («&s=…»). Every file is encrypted on the device
   (AES-GCM, 256-bit key derived from the password) before it leaves it: GitHub only ever holds unreadable bytes.
     docs/<mode>/<id>.json  the document (text, versions, name, dates, trash state) without its pictures
     blobs/<hash>           each page photo / recording once (the hash is keyed, so it reveals nothing)
   Each device keeps its own full copy (IndexedDB, as before) and syncs in the background: on opening, every minute
   while open, and a few seconds after any change. A file changed on two devices keeps the newer one; the other
   text is kept in its versions. A file removed for good on one device is removed everywhere. */
var Sync = (function () {
  'use strict';
  var API = 'https://api.github.com', LS_CFG = 'kateb.sync', LS_STATE = 'kateb.sync.state.', LS_DEL = 'kateb.sync.del.';
  var MODE = 'legal', keyP = null, keyRaw = null, running = null, again = false, timer = null, soonT = null;
  var st = { state: 'off', at: 0, msg: '' }, listeners = [], pulledL = [];

  /* ---------- small helpers ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function jget(k, d) { try { return JSON.parse(lsGet(k) || '') || d; } catch (e) { return d; } }
  function cfg() { var c = jget(LS_CFG, null); return c && c.r && c.t && c.k ? c : null; }
  function setCfg(c) { lsSet(LS_CFG, JSON.stringify(c)); keyP = null; }
  function b64(bytes) { var s = '', CH = 0x8000; for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); }
  function unb64(s) { var bin = atob(String(s).replace(/\s+/g, '')), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function b64u(bytes) { return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return unb64(s); }
  var enc8 = new TextEncoder(), dec8 = new TextDecoder();

  /* ---------- the files key: PBKDF2(password, the repository's salt) — the same on every device ---------- */
  async function deriveRaw(password, saltB64) {
    var base = await crypto.subtle.importKey('raw', enc8.encode(password), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64u(saltB64), iterations: 310000, hash: 'SHA-256' }, base, 256);
    return b64u(new Uint8Array(bits));
  }
  function key() {
    var c = cfg(); if (!c) return Promise.reject({ code: 'sync_off' });
    if (!keyP) { keyRaw = unb64u(c.k); keyP = crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
    return keyP;
  }
  async function seal(bytes, k) {
    var iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k || await key(), bytes));
    var all = new Uint8Array(12 + ct.length); all.set(iv, 0); all.set(ct, 12); return all;
  }
  async function open(all, k) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, k || await key(), all.subarray(12))); }
  async function hashOf(bytes) {
    await key(); var x = new Uint8Array(keyRaw.length + bytes.length); x.set(keyRaw, 0); x.set(bytes, keyRaw.length);
    var h = new Uint8Array(await crypto.subtle.digest('SHA-256', x)), s = '';
    for (var i = 0; i < 16; i++) s += (h[i] < 16 ? '0' : '') + h[i].toString(16);
    return s;
  }

  /* ---------- GitHub ---------- */
  async function gh(method, path, body, c) {
    c = c || cfg();
    var h = { Authorization: 'Bearer ' + c.t, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (body) h['Content-Type'] = 'application/json';
    var r;
    try { r = await fetch(API + '/repos/' + c.r + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }); }
    catch (e) { throw { code: 'sync_net' }; }
    if (r.status === 401 || (r.status === 403 && !/rate limit/i.test(await r.clone().text().catch(function () { return ''; })))) throw { code: 'sync_auth', status: r.status };
    if (r.status === 403 || r.status === 429) throw { code: 'sync_rate', status: r.status };
    if (r.status === 404) return null;
    if (r.status === 409 && /git\/trees/.test(path)) return { tree: [] };          // a new, empty repository
    if (r.status === 409 || r.status === 422) throw { code: 'sync_conflict', status: r.status };
    if (!r.ok) throw { code: 'sync_http', status: r.status };
    return r.status === 204 ? {} : r.json();
  }
  function pathOf(id) { return 'docs/' + MODE + '/' + id + '.json'; }
  async function tree() {
    var t = await gh('GET', '/git/trees/HEAD?recursive=1'), docs = {}, blobs = {}, prefs = null;
    if (!t) t = { tree: [] };
    var re = new RegExp('^docs/' + MODE + '/([A-Za-z0-9_-]+)\\.json$');
    (t.tree || []).forEach(function (e) {
      if (e.type !== 'blob') return;
      var m = re.exec(e.path); if (m) docs[m[1]] = e.sha;
      var b = /^blobs\/([0-9a-f]{32})$/.exec(e.path); if (b) blobs[b[1]] = e.sha;
      if (e.path === 'prefs/' + MODE + '.json') prefs = e.sha;
    });
    return { docs: docs, blobs: blobs, prefs: prefs };
  }
  async function readFile(sha) { var j = await gh('GET', '/git/blobs/' + sha); if (!j) throw { code: 'sync_missing' }; return open(unb64(j.content)); }
  async function writeFile(path, bytes, sha) {
    var body = { message: 'kateb', content: b64(await seal(bytes)) }; if (sha) body.sha = sha;
    var j = await gh('PUT', '/contents/' + path, body);
    return j && j.content && j.content.sha;
  }
  async function removeFile(path, sha) { try { await gh('DELETE', '/contents/' + path, { message: 'kateb', sha: sha }); } catch (e) { if (e.code !== 'sync_conflict') throw e; } }

  /* ---------- a document without its pictures, and back ---------- */
  function isBig(v) { return (typeof Blob !== 'undefined' && v instanceof Blob) || (typeof v === 'string' && v.length > 1500 && /^data:[\w\/+.-]+;base64,/.test(v)); }
  async function bytesOf(v) {
    if (typeof v === 'string') { var i = v.indexOf(','); return { mime: v.slice(5, v.indexOf(';')), bytes: unb64(v.slice(i + 1)), kind: 'url' }; }
    return { mime: v.type || 'application/octet-stream', bytes: new Uint8Array(await v.arrayBuffer()), kind: 'blob' };
  }
  function packBlob(mime, bytes) { var head = enc8.encode(mime + '\n'), all = new Uint8Array(head.length + bytes.length); all.set(head, 0); all.set(bytes, head.length); return all; }
  function unpackBlob(all) { var n = all.indexOf(10); return { mime: dec8.decode(all.subarray(0, n)), bytes: all.subarray(n + 1) }; }
  async function pack(doc) {
    var blobs = {};
    async function out(v) { var b = await bytesOf(v), h = await hashOf(b.bytes); blobs[h] = packBlob(b.mime, b.bytes); return { $ref: h, kind: b.kind, mime: b.mime }; }
    var d = {}, ks = Object.keys(doc);
    for (var i = 0; i < ks.length; i++) { var k = ks[i], v = doc[k]; d[k] = isBig(v) ? await out(v) : v; }
    if (Array.isArray(doc.pages)) {
      d.pages = [];
      for (var p = 0; p < doc.pages.length; p++) {
        var pg = doc.pages[p], q = {}, pk = Object.keys(pg || {});
        for (var j = 0; j < pk.length; j++) q[pk[j]] = isBig(pg[pk[j]]) ? await out(pg[pk[j]]) : pg[pk[j]];
        d.pages.push(q);
      }
    }
    return { json: enc8.encode(JSON.stringify(d)), blobs: blobs };
  }
  async function unpack(bytes, getBlob) {
    var d = JSON.parse(dec8.decode(bytes));
    async function back(v) {
      if (!v || typeof v !== 'object' || !v.$ref) return v;
      var b = await getBlob(v.$ref); if (!b) return undefined;
      return v.kind === 'blob' ? new Blob([b.bytes], { type: b.mime }) : 'data:' + b.mime + ';base64,' + b64(b.bytes);
    }
    var ks = Object.keys(d);
    for (var i = 0; i < ks.length; i++) d[ks[i]] = await back(d[ks[i]]);
    if (Array.isArray(d.pages)) for (var p = 0; p < d.pages.length; p++) { var pg = d.pages[p]; for (var k in pg) pg[k] = await back(pg[k]); }
    return d;
  }

  /* ---------- the two versions of one file ---------- */
  function sameText(a, b) { return JSON.stringify((a.pages || []).map(function (p) { return p.html; })) === JSON.stringify((b.pages || []).map(function (p) { return p.html; })); }
  function merge(l, r) {
    var win = (r.updated || 0) > (l.updated || 0) ? r : l, lose = win === r ? l : r, seen = {}, vs = [];
    (l.versions || []).concat(r.versions || []).forEach(function (v) { var k = v.t + '|' + JSON.stringify(v.pages); if (!seen[k]) { seen[k] = 1; vs.push(v); } });
    if (!sameText(win, lose)) vs.push({ t: lose.updated || Date.now(), label: 'other-device', pages: (lose.pages || []).map(function (p) { return { html: p.html }; }) });
    vs.sort(function (a, b) { return a.t - b.t; });
    var max = (typeof Store !== 'undefined' && Store.MAX_VERSIONS) || 20;
    while (vs.length > max) vs.splice(1, 1);
    return Object.assign({}, win, { versions: vs, updated: Math.max(l.updated || 0, r.updated || 0) });
  }

  /* ---------- one round ---------- */
  function state() { return jget(LS_STATE + MODE, {}); }
  function saveState(s) { lsSet(LS_STATE + MODE, JSON.stringify(s)); }
  function dels() { return jget(LS_DEL + MODE, {}); }
  function saveDels(d) { lsSet(LS_DEL + MODE, JSON.stringify(d)); }
  function setStatus(s, msg) { st = { state: s, at: s === 'ok' ? Date.now() : st.at, msg: msg || '' }; listeners.forEach(function (f) { try { f(st); } catch (e) {} }); }

  async function round() {
    var tr = await tree(), S = state(), D = dels(), pulled = [], cache = {};
    /* removed for good here: removed there too */
    for (var id in D) { if (tr.docs[id]) await removeFile(pathOf(id), tr.docs[id]); delete tr.docs[id]; delete D[id]; delete S[id]; saveDels(D); saveState(S); }
    var locals = (await Store.all('docs')).filter(function (d) { return d.mode === MODE; }), L = {};
    locals.forEach(function (d) { L[d.id] = d; });
    async function getBlob(h) {
      if (cache[h]) return cache[h];
      if (!tr.blobs[h]) return null;
      return (cache[h] = unpackBlob(await readFile(tr.blobs[h])));
    }
    async function localBlobs(d) {                     // pictures this device already has are not downloaded again
      if (!d) return;
      var vals = Object.keys(d).map(function (k) { return d[k]; });
      (d.pages || []).forEach(function (p) { Object.keys(p || {}).forEach(function (k) { vals.push(p[k]); }); });
      for (var i = 0; i < vals.length; i++) if (isBig(vals[i])) { var b = await bytesOf(vals[i]); cache[await hashOf(b.bytes)] = { mime: b.mime, bytes: b.bytes }; }
    }
    async function pull(id) { await localBlobs(L[id]); return unpack(await readFile(tr.docs[id]), getBlob); }
    async function push(d, sha) {
      var pk = await pack(d);
      for (var h in pk.blobs) if (!tr.blobs[h]) { tr.blobs[h] = await writeFile('blobs/' + h, pk.blobs[h], null) || 'x'; }
      var ns = await writeFile(pathOf(d.id), pk.json, sha);
      tr.docs[d.id] = ns; S[d.id] = { sha: ns, at: d.updated }; saveState(S);
    }
    async function keep(d, sha) { await Store.put('docs', d); S[d.id] = { sha: sha, at: d.updated }; saveState(S); pulled.push(d.id); }
    var ids = Object.keys(tr.docs);
    for (var i = 0; i < ids.length; i++) {
      var k = ids[i], rs = tr.docs[k], l = L[k], s = S[k];
      try {
        if (!l) await keep(await pull(k), rs);                                     // new from another device
        else if (s && s.sha === rs) { if (l.updated !== s.at) await push(l, rs); } // changed here only
        else {
          var r = await pull(k);
          if (s && l.updated === s.at) await keep(r, rs);                          // changed there only
          else {                                                                   // changed on both (or first meeting)
            var m = merge(l, r);
            if (m.updated === r.updated && sameText(m, r) && (m.versions || []).length === (r.versions || []).length && m.name === r.name && m.deletedAt === r.deletedAt) await keep(r, rs);
            else { await Store.put('docs', m); await push(m, rs); pulled.push(k); }
          }
        }
      } catch (e) { if (e.code === 'sync_conflict') again = true; else throw e; }
    }
    for (var j = 0; j < locals.length; j++) {
      var d = locals[j]; if (tr.docs[d.id] || ids.indexOf(d.id) >= 0) continue;
      try {
        if (S[d.id] && d.updated === S[d.id].at) { await Store.del('docs', d.id); delete S[d.id]; saveState(S); pulled.push(d.id); }   // removed for good on another device
        else await push(d, null);                                                  // new here (or this device's files, first time)
      } catch (e) { if (e.code === 'sync_conflict') again = true; else throw e; }
    }
    try { await prefsRound(tr); } catch (e) { if (e.code === 'sync_conflict') again = true; else if (e.code === 'sync_auth' || e.code === 'sync_net') throw e; }
    return pulled;
  }
  /* ---------- v41: one app on every device — settings, the handwriting learning and the office memory travel too ----------
     prefs/<mode>.json (encrypted like the files): {s: {key: {v, t}}, learn: [records], memory: {key: {c, t}}}.
     A setting changed here (its value differs from what was last synced) is sent; one changed elsewhere is taken. */
  var PREF_KEYS = ['kateb.mode', 'kateb.ocr', 'kateb.dict', 'kateb.learn', 'kateb.fast', 'kateb.out', 'kateb.lawName', 'kateb.lawTitle', 'kateb.audiokey', 'kateb.enhance'];
  var PREF_PREFIX = ['kateb.profile.', 'exam.'];
  var prefsHooks = [];
  function prefKeys() {
    var out = PREF_KEYS.slice();
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (PREF_PREFIX.some(function (p) { return k.indexOf(p) === 0; }) && out.indexOf(k) < 0) out.push(k); } } catch (e) {}
    return out;
  }
  function mergeLearn(a, b) {
    var m = {}; (a || []).concat(b || []).forEach(function (r) { if (!r || !r.id) return; var o = m[r.id]; if (!o) m[r.id] = Object.assign({}, r); else { o.n = Math.max(o.n || 0, r.n || 0); o.last = Math.max(o.last || 0, r.last || 0); } });
    return Object.keys(m).map(function (k) { return m[k]; });
  }
  function mergeMem(a, b) {
    var m = {}; [a || {}, b || {}].forEach(function (x) { Object.keys(x).forEach(function (k) { var o = m[k], r = x[k]; if (!o) m[k] = { c: r.c || 0, t: r.t || 0 }; else { o.c = Math.max(o.c, r.c || 0); o.t = Math.max(o.t, r.t || 0); } }); });
    return m;
  }
  async function prefsRound(tr) {
    var path = 'prefs/' + MODE + '.json', snapK = 'kateb.sync.prefsnap.' + MODE, snap = jget(snapK, {}), now = Date.now();
    var remote = tr.prefs ? JSON.parse(dec8.decode(await readFile(tr.prefs))) : { s: {}, learn: [], memory: {} };
    remote.s = remote.s || {};
    var keys = prefKeys(); Object.keys(remote.s).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    var push = !tr.prefs, applied = false;
    keys.forEach(function (k) {
      var lv = lsGet(k), sv = snap[k] === undefined ? null : snap[k], r = remote.s[k], rv = r ? r.v : null;
      var localChanged = lv !== sv, remoteChanged = r && rv !== sv;
      if (localChanged && (!remoteChanged || (r.t || 0) < now - 1)) { if (lv !== rv) { remote.s[k] = { v: lv, t: now }; push = true; } }
      else if (remoteChanged && lv !== rv) { try { if (rv === null) localStorage.removeItem(k); else localStorage.setItem(k, rv); } catch (e) {} applied = true; }
      snap[k] = (remote.s[k] ? remote.s[k].v : lv);
    });
    /* the handwriting learning (records) and the office memory (lawyers, judges, people): merged, never lost */
    var L = null; try { L = await Store.get('learn', 'items'); } catch (e) {}
    var lItems = (L && L.items) || [], ml = mergeLearn(lItems, remote.learn);
    if (ml.length !== (remote.learn || []).length || JSON.stringify(ml) !== JSON.stringify(remote.learn || [])) { remote.learn = ml; push = true; }
    if (ml.length !== lItems.length || JSON.stringify(ml) !== JSON.stringify(lItems)) { await Store.put('learn', { id: 'items', items: ml }); applied = true; }
    var memLocal = jget('kateb.memory', { p: {} }), mm = mergeMem(memLocal.p, remote.memory);
    if (JSON.stringify(mm) !== JSON.stringify(remote.memory || {})) { remote.memory = mm; push = true; }
    if (JSON.stringify(mm) !== JSON.stringify(memLocal.p || {})) { lsSet('kateb.memory', JSON.stringify({ p: mm })); if (typeof Memory !== 'undefined' && Memory._clear) Memory._clear(); applied = true; }
    if (push) tr.prefs = await writeFile(path, enc8.encode(JSON.stringify(remote)), tr.prefs || null);
    lsSet(snapK, JSON.stringify(snap));
    if (applied) prefsHooks.forEach(function (f) { try { f(); } catch (e) {} });
  }

  var MSG = {
    sync_net: 'لا يوجد إنترنت الآن — الملفات محفوظة على هذا الجهاز وتُرفع تلقائيًا عند عودة الإنترنت.',
    sync_auth: 'رمز المزامنة لم يعد يعمل (انتهى أو حُذف). زياد يعمل رابطًا جديدًا من صفحة التجهيز.',
    sync_rate: 'GitHub طلب الانتظار قليلًا — تُستكمل المزامنة بعد دقائق.',
    sync_http: 'تعذرت المزامنة الآن — تُعاد المحاولة تلقائيًا.',
    sync_norepo: 'المستودع kateb-files غير موجود أو الرمز لا يصل إليه.',
    sync_public: 'المستودع عام (Public) — لازم يكون خاص (Private).',
    sync_readonly: 'الرمز بدون صلاحية الكتابة (Contents: Read and write).',
    sync_otherkey: 'الملفات المشتركة اتعملت بمفتاح قراءة مختلف عن مفتاح هذا الجهاز.'
  };
  function sync() {
    if (!cfg() || typeof Store === 'undefined') return Promise.resolve([]);
    if (running) return running.then(function () { return sync(); });   // a change made during a round gets its own round
    setStatus('busy');
    running = round().then(function (pulled) {
      running = null; setStatus('ok');
      if (pulled.length) pulledL.forEach(function (f) { try { f(pulled); } catch (e) {} });
      if (again) { again = false; soon(1500); }
      return pulled;
    }, function (e) {
      running = null; setStatus('err', MSG[e && e.code] || MSG.sync_http);
      return [];
    });
    return running;
  }
  function soon(ms) { clearTimeout(soonT); soonT = setTimeout(sync, ms == null ? 3000 : ms); }
  var started = false;
  function start(mode) {
    MODE = mode || MODE;
    if (!cfg()) { setStatus('off'); return; }
    if (started) { sync(); return; }
    started = true;
    if (typeof Store !== 'undefined') {
      Store.hooks.change = function () { soon(); };
      Store.hooks.purge = function (id) { var S = state(); if (S[id]) { var D = dels(); D[id] = S[id].sha; saveDels(D); } soon(); };
    }
    sync();
    clearInterval(timer);
    timer = setInterval(function () { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') sync(); }, 60000);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') soon(300); });
    if (typeof window !== 'undefined') window.addEventListener('online', function () { soon(300); });
  }
  /* «&s=…» in a link (older setup): the repository, the token and the files key, locked with the family's password */
  function fromHash(hash) { var m = /[&#]s=([A-Za-z0-9_-]+)/.exec(hash || ''); return m ? m[1] : null; }

  /* ---------- v36: connect once, on ONE device — every other device joins by itself ----------
     The device that has the token checks the private repository, takes (or makes) the files key — kept in the
     repository wrapped with the app's own reading key — and publishes «kateb/sync.bin» on the site: the repository,
     token and files key, encrypted with that reading key (AES-GCM, PBKDF2). Every device of the family already holds
     the reading key (it is how they read papers), so each one opens sync.bin by itself; to anyone else it is noise. */
  function siteRepo() {
    var h = typeof location !== 'undefined' ? location.hostname : '';
    var m = /^([A-Za-z0-9-]+)\.github\.io$/.exec(h); return m ? m[1] + '/' + m[1] + '.github.io' : 'ZeyadTharwat1212/ZeyadTharwat1212.github.io';
  }
  async function connect(mainKey, repo, token) {
    var c = { r: repo || 'ZeyadTharwat1212/kateb-files', t: token, k: '' };
    var info = await gh('GET', '', null, c);
    if (!info) throw { code: 'sync_norepo' };
    if (!info.private) throw { code: 'sync_public' };
    if (info.permissions && !info.permissions.push) throw { code: 'sync_readonly' };
    var f = await gh('GET', '/contents/kateb-sync.json', null, c), meta = f && f.content ? JSON.parse(dec8.decode(unb64(f.content))) : null;
    if (meta && meta.kw) { try { c.k = await Engine.unlock(meta.kw, mainKey); } catch (e) { throw { code: 'sync_otherkey' }; } }
    else {
      c.k = b64u(crypto.getRandomValues(new Uint8Array(32)));
      var body = { message: 'kateb: shared files set up (everything here is encrypted)', content: b64(enc8.encode(JSON.stringify({ v: 2, kw: await Engine.lock(c.k, mainKey) }))) };
      if (f && f.sha) body.sha = f.sha;
      await gh('PUT', '/contents/kateb-sync.json', body, c);
    }
    var bundle = await Engine.lock(JSON.stringify(c), mainKey), shared = true;
    try {                                                               // for the other devices: kateb/sync.bin on the site
      var sc = { r: siteRepo(), t: token }, old = await gh('GET', '/contents/kateb/sync.bin', null, sc);
      var put = { message: 'kateb: shared files link (encrypted)', content: b64(enc8.encode(bundle)) }; if (old && old.sha) put.sha = old.sha;
      await gh('PUT', '/contents/kateb/sync.bin', put, sc);
    } catch (e) { shared = false; }
    setCfg(c); lsSet('kateb.sbin', bundle);
    return { shared: shared };
  }
  /* every device, on opening: a new or changed sync.bin is taken in (a renewed token reaches all devices the same way) */
  async function autoJoin(mainKey) {
    if (!mainKey || typeof fetch === 'undefined') return false;
    try {
      var r = await fetch('kateb/sync.bin?x=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return false;
      var b = (await r.text()).trim(); if (!/^[A-Za-z0-9_-]{40,}$/.test(b) || (b === lsGet('kateb.sbin') && cfg())) return false;
      var c = JSON.parse(await Engine.unlock(b, mainKey)); if (!c.r || !c.t || !c.k) return false;
      setCfg(c); lsSet('kateb.sbin', b); return true;
    } catch (e) { return false; }
  }

  return { start: start, sync: sync, soon: soon, cfg: cfg, setCfg: setCfg, fromHash: fromHash, connect: connect, autoJoin: autoJoin, msg: function (e) { return MSG[e && e.code] || MSG.sync_http; }, status: function () { return st; },
    onStatus: function (f) { listeners.push(f); }, onPulled: function (f) { pulledL.push(f); }, on: function () { return !!cfg(); },
    off: function () { try { localStorage.removeItem(LS_CFG); } catch (e) {} keyP = null; clearInterval(timer); setStatus('off'); },
    _merge: merge, _pack: pack, _unpack: unpack, onPrefs: function (f) { prefsHooks.push(f); }, _mergeLearn: mergeLearn, _mergeMem: mergeMem };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Sync;
