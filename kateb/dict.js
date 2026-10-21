/* On-device Arabic word check over the AyaSpell hunspell dictionary (kateb/dict/ar.aff.txt + ar.dic.txt, built by
   tests/tools/build_dict.py from the LibreOffice copy of hunspell-ar; GPL/LGPL/MPL, Taha Zerrouki & Mohamed Kebdani).
   What it is for: a free, independent signal on the reader's output. A word that is in no dictionary, in none of the
   office's formulas and never confirmed by the family is marked for review (reason «dict»), and in the economy mode
   the extra proofreading call is skipped when the page has no such word. It never changes a word by itself.
   A small hunspell: exact word, or stem + suffix (+ a second suffix through the first one's continuation class),
   with an optional prefix when both affixes allow the cross product. Tashkeel and tatweel are ignored, like
   hunspell's IGNORE. Pure functions over the loaded tables; also runs under Node for tests. */
var Dict = (function () {
  'use strict';
  var IGNORE = /[ًٌٍَُِّْـٰ]/g, ARABIC = /^[ء-ي]+$/;
  var words = null, sets = [''], pfx = [], pfxEmpty = [], sfxEmpty = [], sfxByLast = {}, pfxByFirst = {}, contFlags = {};
  var loading = null, failed = false;

  function has(s, flag) { return s.indexOf(' ' + flag + ' ') >= 0; }
  function cond(c, suffix) { if (c === '.') return null; try { return new RegExp(suffix ? c + '$' : '^' + c); } catch (e) { return null; } }
  function parseAff(text) {
    sets = ['']; pfx = []; pfxEmpty = []; sfxEmpty = []; sfxByLast = {}; pfxByFirst = {}; contFlags = {};
    var all = [];
    text.split('\n').forEach(function (l) {
      if (!l || l.charAt(0) === '#') return;
      var p = l.split(' ');
      if (p[0] === 'AF') { sets.push(' ' + (p[1].match(/../g) || []).join(' ') + ' '); return; }
      if (p[0] !== 'PFX' && p[0] !== 'SFX') return;
      var add = p[4], cont = 0, i = add.indexOf('/');
      if (i >= 0) { cont = +add.slice(i + 1); add = add.slice(0, i); }
      var r = { flag: p[1], cross: p[2] === 'Y', strip: p[3] === '0' ? '' : p[3], add: add === '0' ? '' : add, cont: cont, re: cond(p[5] || '.', p[0] === 'SFX') };
      if (p[0] === 'PFX') { if (!r.add) pfxEmpty.push(r); else { var f = r.add.charAt(0); (pfxByFirst[f] = pfxByFirst[f] || []).push(r); } pfx.push(r); }
      else { all.push(r); if (!r.add) sfxEmpty.push(r); else { var c = r.add.charAt(r.add.length - 1); (sfxByLast[c] = sfxByLast[c] || []).push(r); } }
    });
    all.forEach(function (r) { if (r.cont) sets[r.cont].trim().split(' ').forEach(function (f) { contFlags[f] = 1; }); });
  }
  async function parseDic(text, yielding) {
    var map = new Map(), i = 0, n = text.length, k = 0;
    while (i < n) {
      var j = text.indexOf('\n', i); if (j < 0) j = n;
      var line = text.slice(i, j); i = j + 1;
      if (!line || line.charAt(0) === '#') continue;
      var s = line.indexOf('/');
      if (s < 0) map.set(line, 0); else map.set(line.slice(0, s), +line.slice(s + 1));
      if (yielding && (++k & 32767) === 0) await new Promise(function (r) { setTimeout(r, 0); });
    }
    words = map;
  }
  function flagsOf(stem) { var v = words.get(stem); return v === undefined ? null : sets[v]; }
  function endsWith(w, s) { return s ? w.length > s.length && w.slice(-s.length) === s : true; }
  function viaSuffix(w, p) {
    var list = (sfxByLast[w.charAt(w.length - 1)] || []).concat(sfxEmpty);
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!endsWith(w, s.add) || (p && !s.cross)) continue;
      var stem = w.slice(0, w.length - s.add.length) + s.strip;
      if (!stem || (s.re && !s.re.test(stem))) continue;
      var f = flagsOf(stem);
      if (f !== null && has(f, s.flag) && (!p || has(f, p.flag) || (s.cont && has(sets[s.cont], p.flag)))) return true;
      if (!contFlags[s.flag]) continue;
      /* second suffix: the stem found so far is itself stem2 + s2.add, and s2 lets s follow it */
      var l2 = (sfxByLast[stem.charAt(stem.length - 1)] || []).concat(sfxEmpty);
      for (var j = 0; j < l2.length; j++) {
        var s2 = l2[j];
        if (!s2.cont || !has(sets[s2.cont], s.flag) || !endsWith(stem, s2.add) || (p && !s2.cross)) continue;
        var stem2 = stem.slice(0, stem.length - s2.add.length) + s2.strip;
        if (!stem2 || (s2.re && !s2.re.test(stem2))) continue;
        var f2 = flagsOf(stem2);
        if (f2 === null || !has(f2, s2.flag)) continue;
        if (!p || has(f2, p.flag) || has(sets[s2.cont], p.flag) || (s.cont && has(sets[s.cont], p.flag))) return true;
      }
    }
    return false;
  }
  function lookup(w) {
    if (words.has(w)) return true;
    if (viaSuffix(w, null)) return true;
    var list = (pfxByFirst[w.charAt(0)] || []).concat(pfxEmpty);
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (w.length <= p.add.length || w.slice(0, p.add.length) !== p.add) continue;
      var rest = p.strip + w.slice(p.add.length);
      if (p.re && !p.re.test(rest)) continue;
      var f = flagsOf(rest);
      if (f !== null && has(f, p.flag)) return true;
      if (p.cross && viaSuffix(rest, p)) return true;
    }
    return false;
  }
  /* spelling variants the office and the hand use freely: ى/ي and ة/ه at the end, the hamza on the first alif */
  function variants(w) {
    var out = [w], last = w.charAt(w.length - 1), first = w.charAt(0), body = w.slice(1);
    if (last === 'ي') out.push(w.slice(0, -1) + 'ى'); else if (last === 'ى') out.push(w.slice(0, -1) + 'ي');
    else if (last === 'ه') out.push(w.slice(0, -1) + 'ة'); else if (last === 'ة') out.push(w.slice(0, -1) + 'ه');
    if (first === 'ا') out.push('أ' + body, 'إ' + body); else if (first === 'أ' || first === 'إ' || first === 'آ') out.push('ا' + body);
    /* the same hamza after a one-letter or ال prefix: الاعلان → الإعلان, وابن → وإبن, بالاجماع → بالإجماع */
    var m = /^(?:[وف]?(?:ال|لل|بال|كال|فال)|[وفبكل])ا/.exec(w);
    if (m) { var i = m[0].length - 1, pre = w.slice(0, i), post = w.slice(i + 1); out.push(pre + 'أ' + post, pre + 'إ' + post); }
    return out;
  }
  function correct(word) {
    if (!words) return true;
    var w = String(word || '').replace(IGNORE, '');
    if (!w || !ARABIC.test(w)) return true;                 // only plain Arabic words are judged
    var vs = variants(w);
    for (var i = 0; i < vs.length; i++) if (lookup(vs[i])) return true;
    return false;
  }
  /* the Arabic words of a text (markup, numbers and Latin skipped) that the dictionary and the caller's known set
     both reject; words already inside ⟦ ⟧ are not counted (they are marked already) */
  function unknown(text, known) {
    if (!words) return null;
    var out = [], seen = {}, total = 0;
    String(text || '').split(/(⟦[^⟧]*⟧)/).forEach(function (part, i) {
      if (i % 2) return;
      (part.replace(/^\s*\[[A-Z]+\]/gm, '').match(/[ء-ي]{2,}/g) || []).forEach(function (w) {
        total++;
        var c = w.replace(IGNORE, ''); if (c.length < 3 || seen[c]) return;
        if (correct(c) || (known && known(c))) return;
        seen[c] = 1; out.push(c);
      });
    });
    return { words: out, total: total };
  }
  /* wrap the unknown words in ⟦ ⟧ (outside existing marks only); nothing when too many are unknown — then the page
     is not in the dictionary's language and marking would only flood the reviewer */
  function mark(text, known, maxShare) {
    var u = unknown(text, known);
    if (!u || !u.words.length || u.words.length > Math.max(3, (maxShare || 0.15) * u.total)) return { text: text, words: [], skipped: !!(u && u.words.length) };
    var set = {}; u.words.forEach(function (w) { set[w] = 1; });
    var out = String(text).split(/(⟦[^⟧]*⟧)/).map(function (part, i) {
      if (i % 2) return part;
      return part.replace(/([ء-ي]{3,})/g, function (m, w) { return set[w.replace(IGNORE, '')] ? '⟦' + w + '⟧' : w; });
    }).join('');
    return { text: out, words: u.words, skipped: false };
  }
  /* share of the Arabic words (3+ letters) of a text that the dictionary knows: OCR garbage scores near 0 */
  function share(text) {
    if (!words) return null;
    var ws = String(text || '').match(/[ء-ي]{3,}/g) || [], ok = 0;
    ws.forEach(function (w) { if (correct(w)) ok++; });
    return ws.length ? ok / ws.length : 0;
  }
  function loadText(aff, dic) { parseAff(aff); return parseDic(dic, false); }
  function load(base) {
    if (loading) return loading;
    if (typeof fetch === 'undefined') return Promise.reject(new Error('no fetch'));
    base = base || 'kateb/dict/';
    loading = Promise.all([fetch(base + 'ar.aff.txt').then(function (r) { if (!r.ok) throw new Error('aff ' + r.status); return r.text(); }),
                          fetch(base + 'ar.dic.txt').then(function (r) { if (!r.ok) throw new Error('dic ' + r.status); return r.text(); })])
      .then(function (t) { parseAff(t[0]); return parseDic(t[1], true); })
      .catch(function (e) { failed = true; loading = null; throw e; });
    return loading;
  }
  function ready() { return !!words; }
  function size() { return words ? words.size : 0; }
  return { load: load, loadText: loadText, ready: ready, failed: function () { return failed; }, size: size, correct: correct, unknown: unknown, mark: mark, share: share, variants: variants };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Dict;
