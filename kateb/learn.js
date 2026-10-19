/* Handwriting learning, on the device, from the family's own corrections.
   What it really does (nothing is simulated):
   1. record(): when a reviewed page differs from the first reading, the replaced words become «fix» records
      (misread → correct) and a doubtful word confirmed as read becomes a «word» record, per writer profile.
   2. promptText(): the records go into the reader's system prompt for the next pages of the same profile, so the
      model knows how this hand writes the words and names it misread before.
   3. applyLexicon()/applyFixes(): on the device, a doubtful word that this hand already confirmed is unmarked, and a
      doubtful word that was corrected the same way before is swapped to the correction (still marked for review).
   Pure functions over a plain array of records; Store keeps the array. Also runs under Node for tests. */
var Learn = (function () {
  'use strict';
  var TASHKEEL = /[ً-ْٰـ]/g, PUNCT = /^[\s،,.:;!?()«»"'\-–—\[\]{}*_⟦⟧]+|[\s،,.:;!?()«»"'\-–—\[\]{}*_⟦⟧]+$/g;
  var ARABIC = /^[ء-ي٠-٩]+$/;
  var MAX_FIX = 60, MAX_WORD = 150, LIMIT = 2000;

  function clean(w) { return String(w || '').replace(TASHKEEL, '').replace(PUNCT, ''); }
  function tokens(text) { return String(text || '').replace(/\r/g, '').split(/\s+/).map(clean).filter(Boolean); }
  function lcs(a, b) {
    var n = a.length, m = b.length, L = [], i, j;
    for (i = 0; i <= n; i++) L[i] = new Uint16Array(m + 1);
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var pairs = []; i = 0; j = 0;
    while (i < n && j < m) { if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
    return pairs;
  }
  function learnable(w) { return w.length >= 2 && ARABIC.test(w) && !/^[٠-٩]+$/.test(w); }
  /* words replaced one-for-one between the first reading and the reviewed text */
  function wordDiff(before, after) {
    var a = tokens(before), b = tokens(after), pairs = lcs(a, b), out = [], pi = -1, pj = -1;
    pairs.push([a.length, b.length]);
    pairs.forEach(function (p) {
      var ga = p[0] - pi - 1, gb = p[1] - pj - 1;
      if (ga === gb && ga >= 1 && ga <= 3) for (var k = 1; k <= ga; k++) {
        var f = a[pi + k], t = b[pj + k];
        if (f !== t && learnable(f) && learnable(t)) out.push({ from: f, to: t });
      }
      pi = p[0]; pj = p[1];
    });
    return out;
  }
  function key(profile, kind, from, to) { return profile + '|' + kind + '|' + from + '|' + (to || ''); }
  /* merge one observation into the records (returns the record touched, or null) */
  function record(items, profile, kind, from, to, now) {
    from = clean(from); to = clean(to || '');
    if (!learnable(from) || (kind === 'fix' && (!learnable(to) || from === to))) return null;
    var id = key(profile, kind, from, to), r = null;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) { r = items[i]; break; }
    if (!r) { r = { id: id, profile: profile, kind: kind, from: from, to: kind === 'fix' ? to : '', n: 0, last: 0 }; items.push(r); }
    r.n++; r.last = now || Date.now();
    if (items.length > LIMIT) { items.sort(function (x, y) { return y.n - x.n || y.last - x.last; }); items.length = LIMIT; }
    return r;
  }
  function of(items, profile, kind) { return items.filter(function (r) { return r.profile === profile && (!kind || r.kind === kind); }); }
  function top(list, max) { return list.slice().sort(function (x, y) { return y.n - x.n || y.last - x.last; }).slice(0, max); }
  function label(profile) { return profile === 'mama' ? 'ماما' : profile === 'baba' ? 'بابا' : 'عام'; }
  /* the block added to the reader's system prompt */
  function promptText(items, profile) {
    var fixes = top(of(items, profile, 'fix'), MAX_FIX), words = top(of(items, profile, 'word'), MAX_WORD);
    if (!fixes.length && !words.length) return '';
    var s = "\n\nTHIS WRITER'S HAND (learned on the family's device from their own corrections of earlier pages; writer profile «" + label(profile) + "»):";
    if (fixes.length) s += "\n- Words of this hand that were misread before → how the writer actually spells them (when the ink looks like the left form, read the right one): " + fixes.map(function (r) { return '«' + r.from + '» → «' + r.to + '»'; }).join('، ');
    if (words.length) s += "\n- Words and names this writer uses that were confirmed correct before (read them as written when the ink matches; do not mark them as doubtful): " + words.map(function (r) { return r.to || r.from; }).join('، ');
    return s;
  }
  /* on the device: a doubtful word already confirmed in this hand is unmarked (both reads must have produced it) */
  function applyLexicon(text, items, profile, minN) {
    var lex = {}; of(items, profile).forEach(function (r) { if (r.n >= (minN || 2)) lex[r.kind === 'fix' ? r.to : r.from] = 1; });
    var cleared = 0;
    var out = String(text || '').replace(/⟦([^⟧]*)⟧/g, function (m, w) { var first = w.split('|')[0], c = clean(first); if (c && lex[c] && !/[0-9٠-٩]/.test(c)) { cleared++; return first; } return m; });
    return { text: out, cleared: cleared };
  }
  /* on the device: a doubtful word corrected the same way twice before becomes the correction, still marked */
  function applyFixes(text, items, profile, minN) {
    var fix = {}; of(items, profile, 'fix').forEach(function (r) { if (r.n >= (minN || 2)) fix[r.from] = r.to; });
    var fixed = 0;
    var out = String(text || '').replace(/⟦([^⟧]*)⟧/g, function (m, w) { var c = clean(w.split('|')[0]); if (c && fix[c]) { fixed++; return '⟦' + fix[c] + '⟧'; } return m; });
    return { text: out, fixed: fixed };
  }
  function stats(items, profile) {
    var f = of(items, profile, 'fix'), w = of(items, profile, 'word'), last = 0;
    items.forEach(function (r) { if (r.profile === profile && r.last > last) last = r.last; });
    return { fixes: f.length, words: w.length, total: f.length + w.length, last: last };
  }
  return { clean: clean, tokens: tokens, wordDiff: wordDiff, record: record, of: of, top: top, label: label, promptText: promptText, applyLexicon: applyLexicon, applyFixes: applyFixes, stats: stats, PROFILES: ['mama', 'baba', 'general'] };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Learn;
