/* On-device storage for the app: documents (pages, images, versions), the recently-deleted list and the
   handwriting-learning records. IndexedDB (big images fit); when it is unavailable (old browser, private window
   that blocks it) a localStorage fallback keeps everything except the page photos. Nothing here ever leaves the
   device. Promise API; also loads under Node for tests (with a memory backend). */
var Store = (function () {
  'use strict';
  var DB = 'kateb', VER = 1, STORES = ['docs', 'learn'], dbP = null, mem = null, backend = 'idb';
  var LS = 'kateb.store.';
  var TRASH_DAYS = 30, MAX_VERSIONS = 20;

  function hasIDB() { try { return typeof indexedDB !== 'undefined' && !!indexedDB; } catch (e) { return false; } }
  function open() {
    if (dbP) return dbP;
    if (!hasIDB()) { backend = 'ls'; return (dbP = Promise.resolve(null)); }
    dbP = new Promise(function (res) {
      var req;
      try { req = indexedDB.open(DB, VER); } catch (e) { backend = 'ls'; return res(null); }
      req.onupgradeneeded = function () {
        var db = req.result;
        STORES.forEach(function (s) { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { backend = 'ls'; res(null); };
      req.onblocked = function () { backend = 'ls'; res(null); };
    });
    return dbP;
  }
  /* localStorage / memory fallback: one JSON blob per store, images dropped so it fits */
  function lsLoad(store) {
    if (mem && mem[store]) return mem[store];
    mem = mem || {};
    try { mem[store] = JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem(LS + store)) || '{}') || {}; } catch (e) { mem[store] = {}; }
    return mem[store];
  }
  function lsFlush(store) {
    var m = lsLoad(store), slim = {};
    Object.keys(m).forEach(function (k) { var d = m[k]; if (d && d.pages) d = Object.assign({}, d, { pages: d.pages.map(function (p) { return Object.assign({}, p, { img: undefined }); }) }); slim[k] = d; });
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(LS + store, JSON.stringify(slim)); return true; } catch (e) { return false; }
  }
  function tx(store, mode, fn) {
    return open().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (res, rej) {
        var t, s;
        try { t = db.transaction(store, mode); s = t.objectStore(store); } catch (e) { return rej(e); }
        var out = fn(s);
        t.oncomplete = function () { res(typeof IDBRequest !== 'undefined' && out instanceof IDBRequest ? out.result : out); };
        t.onerror = function () { rej(t.error || new Error('store')); };
        t.onabort = function () { rej(t.error || new Error('store')); };
      });
    });
  }
  function put(store, obj) {
    return tx(store, 'readwrite', function (s) {
      if (!s) { lsLoad(store)[obj.id] = obj; if (!lsFlush(store)) throw new Error('quota'); return obj; }
      s.put(obj); return obj;
    });
  }
  function get(store, id) {
    return tx(store, 'readonly', function (s) {
      if (!s) return lsLoad(store)[id] || null;
      return s.get(id);
    }).then(function (r) { return r || null; });
  }
  function del(store, id) {
    return tx(store, 'readwrite', function (s) {
      if (!s) { delete lsLoad(store)[id]; lsFlush(store); return true; }
      s.delete(id); return true;
    });
  }
  function all(store) {
    return tx(store, 'readonly', function (s) {
      if (!s) { var m = lsLoad(store); return Object.keys(m).map(function (k) { return m[k]; }); }
      return s.getAll();
    }).then(function (r) { return r || []; });
  }
  function clear(store) {
    return tx(store, 'readwrite', function (s) {
      if (!s) { mem[store] = {}; lsFlush(store); return true; }
      s.clear(); return true;
    });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* ---------- documents ---------- */
  function newDoc(mode, name, pages, extra) {
    var t = Date.now();
    return Object.assign({ id: uid(), mode: mode, name: name, created: t, updated: t, pages: pages, status: 'draft', deletedAt: null,
      versions: [{ t: t, label: 'first', pages: pages.map(function (p) { return { html: p.html }; }) }], learned: [] }, extra || {});
  }
  function saveDoc(doc) { doc.updated = Date.now(); return put('docs', doc); }
  function listDocs(mode) {
    return all('docs').then(function (ds) {
      return ds.filter(function (d) { return d.mode === mode && !d.deletedAt; }).sort(function (a, b) { return b.updated - a.updated; });
    });
  }
  function listTrash(mode) {
    return all('docs').then(function (ds) {
      return ds.filter(function (d) { return d.mode === mode && d.deletedAt; }).sort(function (a, b) { return b.deletedAt - a.deletedAt; });
    });
  }
  function getDoc(id) { return get('docs', id); }
  function renameDoc(id, name) { return getDoc(id).then(function (d) { if (!d) return null; d.name = name; return saveDoc(d); }); }
  function trashDoc(id) { return getDoc(id).then(function (d) { if (!d) return null; d.deletedAt = Date.now(); return put('docs', d); }); }
  function restoreDoc(id) { return getDoc(id).then(function (d) { if (!d) return null; d.deletedAt = null; return put('docs', d); }); }
  function purgeDoc(id) { return del('docs', id); }
  function emptyTrash(mode) { return listTrash(mode).then(function (ds) { return Promise.all(ds.map(function (d) { return purgeDoc(d.id); })); }); }
  /* recently deleted documents older than 30 days are removed for good (run on each open) */
  function purgeOld(now) {
    now = now || Date.now();
    return all('docs').then(function (ds) {
      var old = ds.filter(function (d) { return d.deletedAt && now - d.deletedAt > TRASH_DAYS * 864e5; });
      return Promise.all(old.map(function (d) { return purgeDoc(d.id); })).then(function () { return old.length; });
    });
  }
  function daysLeft(doc, now) { return Math.max(0, Math.ceil((doc.deletedAt + TRASH_DAYS * 864e5 - (now || Date.now())) / 864e5)); }
  /* a version is kept when the text changed and the last one is older than `minGap` ms (or forced, e.g. before an export) */
  function addVersion(doc, pages, label, minGap, now) {
    now = now || Date.now();
    var vs = doc.versions || (doc.versions = []), last = vs[vs.length - 1];
    var same = last && JSON.stringify(last.pages) === JSON.stringify(pages.map(function (p) { return { html: p.html }; }));
    if (same) { if (label && label !== 'auto' && last.label === 'auto') { last.label = label; last.t = now; } return false; }
    if (minGap && last && now - last.t < minGap && last.label === 'auto') { last.t = now; last.pages = pages.map(function (p) { return { html: p.html }; }); return true; }
    vs.push({ t: now, label: label || 'auto', pages: pages.map(function (p) { return { html: p.html }; }) });
    while (vs.length > MAX_VERSIONS) vs.splice(1, 1);        // the first text is always kept
    return true;
  }
  function usage() {
    try { if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) return navigator.storage.estimate(); } catch (e) {}
    return Promise.resolve(null);
  }
  function which() { return backend; }
  function _reset() { dbP = null; mem = null; backend = 'idb'; }

  return { open: open, put: put, get: get, del: del, all: all, clear: clear, uid: uid,
    newDoc: newDoc, saveDoc: saveDoc, listDocs: listDocs, listTrash: listTrash, getDoc: getDoc, renameDoc: renameDoc, trashDoc: trashDoc, restoreDoc: restoreDoc,
    purgeDoc: purgeDoc, emptyTrash: emptyTrash, purgeOld: purgeOld, daysLeft: daysLeft, addVersion: addVersion, usage: usage, which: which, _reset: _reset,
    TRASH_DAYS: TRASH_DAYS, MAX_VERSIONS: MAX_VERSIONS };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Store;
