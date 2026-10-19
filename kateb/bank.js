/* Formula bank: the fixed wording of Egyptian court papers and contracts (built from the office's own files +
   published formulas by tests/tools/build_bank.py into kateb/bank/<type>.json; names/numbers are placeholders).
   Two uses: the judge prompt gets the formulas of the detected paper type, and snap() fixes doubtful words
   on the device when a line clearly is a known formula. Pure functions; also runs under Node for tests. */
var Bank = (function () {
  'use strict';
  var CACHE = {}, VER = '5';
  var TASHKEEL = /[ً-ْٰـ]/g;
  function norm(t) { return String(t || '').replace(/[\ufeff\u200b-\u200f\u202a-\u202e]/g, '').replace(TASHKEEL, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[0-9٠-٩]+([\/\-.,:][0-9٠-٩]+)*/g, '#').replace(/\s+/g, ' ').trim(); }
  /* same tokens as build_bank.py: whitespace split, tokens that normalise to nothing dropped */
  function words(t) { return String(t || '').split(/\s+/).map(norm).filter(Boolean); }
  function sameWord(x, y) { return x === y || PLACE.test(y) || lev(x, y) <= Math.max(1, Math.floor(Math.max(x.length, y.length) / 3)); }
  var PLACE = /#|\{\{/;                                   // any token holding a number or a placeholder is variable data

  async function load(type) {
    if (!type) return null;
    if (CACHE[type] !== undefined) return CACHE[type];
    try {
      var r = await fetch('kateb/bank/' + type + '.json?v=' + VER);
      CACHE[type] = r.ok ? await r.json() : null;
    } catch (e) { CACHE[type] = null; }
    return CACHE[type];
  }

  /* the formulas as text for the prompt: most frequent first, capped so the cached system block stays small */
  function promptText(bank, max) {
    if (!bank || !bank.lines) return '';
    var office = bank.lines.filter(function (l) { return l.src !== 'web'; }), web = bank.lines.filter(function (l) { return l.src === 'web'; });
    max = max || 160;
    var pick = office.slice(0, max);
    if (pick.length < max) pick = pick.concat(web.slice(0, Math.min(80, max - pick.length)));
    var out = pick.filter(function (l) { return l.src !== 'web'; }).map(function (l) { return '- ' + l.t; });
    var extra = pick.filter(function (l) { return l.src === 'web'; }).map(function (l) { return '- ' + l.t; });
    return out.join('\n') + (extra.length ? '\n\nALSO COMMON IN PUBLISHED EGYPTIAN FORMULAS (secondary; the office wording above wins when they differ):\n' + extra.join('\n') : '');
  }

  function lev(a, b) {
    var prev = [], cur = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      var t = prev; prev = cur; cur = t;
    }
    return prev[b.length];
  }
  function sim(a, b) { if (!a.length || !b.length) return 0; return 1 - lev(a, b) / Math.max(a.length, b.length); }

  /* LCS word alignment → pairs [i, j] */
  function align(a, b, eq) {
    var n = a.length, m = b.length, L = [];
    for (var i = 0; i <= n; i++) { L[i] = new Uint16Array(m + 1); }
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) L[i][j] = eq(a[i], b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var out = []; i = 0; j = 0;
    while (i < n && j < m) { if (eq(a[i], b[j])) { out.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
    return out;
  }

  /* formulas found inside a text line: each with the word pairs [text i, bank j]; a formula counts when
     ≥ minCover of its words are found in order within a span not much longer than itself */
  function hits(bank, line, minCover) {
    minCover = minCover || 0.8;
    var w = words(line.replace(/[*_⟦⟧]/g, '')); if (w.length < 3 || !bank || !bank.lines) return [];
    var out = [];
    for (var k = 0; k < bank.lines.length; k++) {
      var bl = bank.lines[k], bw = bl.w || (bl.w = words(bl.t));
      if (bw.length < 3 || bw.length > w.length * 2 + 4) continue;
      var pairs = align(w, bw, sameWord), cover = pairs.length / bw.length;
      if (cover < minCover) continue;
      var span = pairs[pairs.length - 1][0] - pairs[0][0] + 1;
      if (span > bw.length * 1.6 + 2) continue;
      out.push({ line: bl, score: cover, pairs: pairs, bw: bw, span: span });
    }
    /* the office's own wording comes first; a published formula only fills in where the office has none */
    var rank = function (h) { return h.score - (h.line.src === 'web' ? 0.1 : 0); };
    out.sort(function (a, b) { return rank(b) - rank(a) || b.pairs.length - a.pairs.length; });
    return out;
  }
  function match(bank, line) { var h = hits(bank, line, 0.6); return h.length ? h[0] : null; }

  /* Replace ⟦doubtful⟧ words that sit inside a recognised formula with the formula's word.
     Only non-placeholder bank words (never names/numbers), and only when the doubtful word already resembles
     the formula word, so a genuine variant is not overwritten. */
  function snap(text, bank, minCover) {
    var fixed = 0, kept = 0, styled = 0;
    var out = String(text || '').replace(/\r/g, '').split('\n').map(function (raw) {
      var tag = (raw.match(/^\s*\[[A-Z]+\]\s*/) || [''])[0], line = raw.slice(tag.length);
      if (!/[\u0600-\u06FF]/.test(line)) return raw;
      var hs = hits(bank, line, minCover || 0.6); if (!hs.length) { kept += (line.match(/⟦/g) || []).length; return raw; }
      /* a doubtful word is fixed only when a neighbour of it also matches the same formula */
      var map = {};
      hs.forEach(function (h) {
        var at = {}; h.pairs.forEach(function (p) { at[p[0]] = p[1]; });
        h.pairs.forEach(function (p) { if (map[p[0]] === undefined && (at[p[0] - 1] !== undefined || at[p[0] + 1] !== undefined)) map[p[0]] = { h: h, j: p[1] }; });
      });
      var toks = line.split(/(\s+)/), wi = 0;
      var res = toks.map(function (tk) {
        if (!tk || /^\s+$/.test(tk)) return tk;
        var core = tk.replace(/[*_⟦⟧]/g, ''); if (!norm(core)) return tk;
        var idx = wi++;
        if (tk.indexOf('⟦') < 0) {
          /* office spelling: inside a recognised formula a word that differs only in hamza / ة / ى takes the office's form */
          var mm = map[idx]; if (!mm) return tk;
          var ow = mm.h.line.o ? mm.h.line.o[mm.j] : null, bwx = mm.h.bw[mm.j];
          var f = function (x) { return x.replace(/ة/g, 'ه'); };     // ة/ه slips only; hamza and ى/ي stay as read
          if (ow && !PLACE.test(bwx) && norm(core) === bwx && core !== ow && f(core) === f(ow) && !/[0-9٠-٩]/.test(core)) { styled++; return tk.replace(core, ow); }
          return tk;
        }
        if (/[0-9٠-٩]/.test(core)) { kept++; return tk; }        // numbers are never settled by a formula
        var m = map[idx]; if (!m) { kept++; return tk; }
        var bw = m.h.bw[m.j]; if (PLACE.test(bw)) { kept++; return tk; }
        var orig = m.h.line.o ? m.h.line.o[m.j] : null;
        if (!orig || sim(norm(core), bw) < 0.5) { kept++; return tk; }
        fixed++;
        return tk.replace(/⟦[^⟧]*⟧/, orig);
      });
      return tag + res.join('');
    }).join('\n');
    return { text: out, fixed: fixed, kept: kept, styled: styled };
  }

  return { load: load, promptText: promptText, hits: hits, match: match, snap: snap, norm: norm, words: words };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Bank;
