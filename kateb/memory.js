/* The office's memory, given to every reading so a hard word that is a known name or place is read right:
   1. PUBLIC (kateb/bank/memory.json, built from the office's own papers): the courts, police stations, districts,
      villages, notary offices and judicial titles of the office's area. Institutions only — never a person's name.
   2. PRIVATE, on this device only (localStorage, never uploaded): the lawyers, judges and people of the papers
      already typed here. It learns from every Word file downloaded (names the reviewer left un-highlighted) and
      from «&m=» in the private link (lawyer names Zeyad adds there). It grows with every paper.
   Pure apart from localStorage; also runs under Node for tests. */
var Memory = (function () {
  'use strict';
  var LS = 'kateb.memory', MAX = 800;
  var mem = null;
  function ls() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }
  function load() {
    if (mem) return mem;
    try { var s = ls() && ls().getItem(LS); mem = s ? JSON.parse(s) : null; } catch (e) { mem = null; }
    if (!mem || typeof mem.p !== 'object') mem = { p: {} };
    return mem;
  }
  function save() { try { if (ls()) ls().setItem(LS, JSON.stringify(mem)); } catch (e) {} }
  function tidy(s) { return String(s || '').replace(/[⟦⟧*_]/g, '').replace(/[ً-ْٰـ]/g, '').replace(/\s+/g, ' ').trim(); }
  var KINDS = { lawyer: 'محامون', judge: 'قضاة ورؤساء دوائر', person: 'أشخاص سبق ذكرهم', court: 'محاكم', place: 'أماكن' };
  function add(kind, name, w) {
    var n = tidy(name); if (!KINDS[kind] || n.length < 4 || n.length > 60 || !/[ء-ي]/.test(n) || /[0-9٠-٩]/.test(n)) return false;
    var m = load(), k = kind + '|' + n, e = m.p[k] || (m.p[k] = { c: 0, t: 0 });
    e.c += w || 1; e.t = Date.now();
    var keys = Object.keys(m.p);
    if (keys.length > MAX) {                                   // forget the least used, oldest first
      keys.sort(function (a, b) { return (m.p[a].c - m.p[b].c) || (m.p[a].t - m.p[b].t); });
      keys.slice(0, keys.length - MAX).forEach(function (x) { delete m.p[x]; });
    }
    return true;
  }
  var LAWYER_RE = /(?:مكتب\s+)?ال?[أاإ]ستاذ[ةه]?\s*\/\s*([^\n\/،,.()\t]{4,45}?)\s+(?:المحامي[ةه]?|المحامى)/g;
  var JUDGE_RE = /(?:المستشار|القاضي|القاضى|رئيس المحكمة|رئيس الدائرة)\s*\/\s*([^\n\/،,.()\t]{4,45}?)(?=\s*(?:[\n،,.()\t]|رئيس|$))/g;
  /* a finished paper (text with ⟦⟧ around what is still unsure): its sure names go into the memory */
  function learn(text) {
    var t = String(text || ''), m, n = 0;
    while ((m = LAWYER_RE.exec(t))) if (m[1].indexOf('⟦') < 0 && add('lawyer', m[1], 2)) n++;
    while ((m = JUDGE_RE.exec(t))) if (m[1].indexOf('⟦') < 0 && add('judge', m[1], 2)) n++;
    if (typeof Fields !== 'undefined') {
      /* the doubtful ones are left out: Fields cleans the brackets, so find them in the raw text first */
      var unsure = {}; (t.match(/[^\n\/]*⟦[^⟧]*⟧[^\n\/،,]*/g) || []).forEach(function (s) { unsure[tidy(s)] = 1; });
      var f = Fields.extract(t);
      f.names.forEach(function (x) { var c = tidy(x); if (!Object.keys(unsure).some(function (u) { return u.indexOf(c) >= 0; }) && add('person', c)) n++; });
      f.court.forEach(function (x) { if (add('court', x)) n++; });
    }
    if (n) save();
    return n;
  }
  /* «#k=…&m=<base64url JSON {lawyers:[…], judges:[…], people:[…]}>» in the private link */
  function fromHash(hash) {
    var m = /[&#]m=([A-Za-z0-9_-]+)/.exec(hash || ''); if (!m) return 0;
    try {
      var s = m[1].replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
      var bin = atob(s), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var j = JSON.parse(new TextDecoder().decode(bytes)), n = 0;
      (j.lawyers || []).forEach(function (x) { if (add('lawyer', x, 5)) n++; });
      (j.judges || []).forEach(function (x) { if (add('judge', x, 5)) n++; });
      (j.people || []).forEach(function (x) { if (add('person', x, 3)) n++; });
      if (n) save();
      return n;
    } catch (e) { return 0; }
  }
  function list(kind, max) {
    var m = load();
    return Object.keys(m.p).filter(function (k) { return k.indexOf(kind + '|') === 0; })
      .sort(function (a, b) { return (m.p[b].c - m.p[a].c) || (m.p[b].t - m.p[a].t); })
      .slice(0, max).map(function (k) { return k.slice(kind.length + 1); });
  }
  function count() { return Object.keys(load().p).length; }
  /* the private part, for the per-page context (not cached: it changes as the office works) */
  function privatePrompt(max) {
    max = max || 120;
    var parts = [];
    [['lawyer', 30], ['judge', 20], ['court', 20], ['person', max]].forEach(function (x) { var l = list(x[0], x[1]); if (l.length) parts.push(KINDS[x[0]] + ': ' + l.join('، ')); });
    if (!parts.length) return '';
    return "\n\nOFFICE MEMORY (people and courts in papers this office has already typed; an unclear name whose visible letters fit one of these is that name, spelled the same way — still mark it ⟦ ⟧ if any letter is unsure):\n" + parts.join('\n');
  }
  /* the public part (memory.json), for the cached system block */
  function publicPrompt(pub) {
    if (!pub) return '';
    var parts = [];
    [['courts', 'المحاكم'], ['judicial', 'جهات قضائية'], ['police', 'أقسام ومراكز الشرطة'], ['places', 'أحياء وقرى ونواحٍ'], ['notary', 'الشهر العقاري والتوثيق']].forEach(function (x) { if (pub[x[0]] && pub[x[0]].length) parts.push(x[1] + ': ' + pub[x[0]].join('، ')); });
    if (!parts.length) return '';
    return "\n\nPLACES AND INSTITUTIONS OF THIS OFFICE'S AREA (" + (pub.area || '') + "), spelled as the office types them — an unclear place or court that fits one of these is that one:\n" + parts.join('\n');
  }
  function reset() { mem = { p: {} }; save(); }
  return { add: add, learn: learn, fromHash: fromHash, list: list, count: count, privatePrompt: privatePrompt, publicPrompt: publicPrompt, reset: reset, _clear: function () { mem = null; } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Memory;
