/* Cross-check of two independent readings of the same page. Pure functions (also run under Node for tests).
   - compare(a, b): word-level agreement between two transcriptions (markup ignored).
   - guard(final, a, b, strict): marks ⟦…⟧ on words of the final text that neither reading saw, and on numbers the readings
     disagreed on (strict: on every word they disagreed on — names matter as much as numbers in legal papers).
   - cer / wer: error rates for the accuracy harness (tests/eval). */
var Verify = (function () {
  'use strict';
  var TASHKEEL = /[ً-ْٰـ]/g;
  var EDGE = /^[\s.,،؛;:!?؟"'«»“”‘’()\[\]{}<>\-–—…*_=+|\/\\]+|[\s.,،؛;:!?؟"'«»“”‘’()\[\]{}<>\-–—…*_=+|\/\\]+$/g;
  /* markup pieces that are never words: line tags, bold/underline, doubt brackets, cell bars, blank lines */
  var TAGS = 'H|C|R|L|J|S|N|Q|I|OPT|TABLE|GAP';
  var PIECE = new RegExp('(^\\s*\\[(?:' + TAGS + ')\\]|\\*\\*|__|⟦|⟧|\\|\\||\\||_{3,}|\\{[^{}/]{1,20}/[^{}/]{1,20}\\}|\\s+)');
  var MARKUP = new RegExp('^(?:\\s*\\[(?:' + TAGS + ')\\]|\\*\\*|__|\\|\\||\\||_{3,}|\\s+)$');

  /* spelling variants that are not disagreements: hamza forms, ة/ه, ى/ي, tatweel, case */
  function norm(w) {
    var s = String(w || '').replace(TASHKEEL, '').replace(EDGE, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
    return s.toLowerCase();
  }
  function lev2(a, b) {
    var prev = [], cur = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      var t = prev; prev = cur; cur = t;
    }
    return prev[b.length];
  }
  function similar(a, b) { if (!a || !b) return 0; return 1 - lev2(a, b) / Math.max(a.length, b.length); }
  /* tokens that follow a person marker are a name: «السيد / فلان الفلاني», «بناء على طلب / …» */
  var NAME_MARK = /^(السيد|السيده|الاستاذ|الاستاذه|الدكتور|الدكتوره|المرحوم|المرحومه|الطالب|الطالبه|المدعي|المدعيه|المتهم|المتهمه|الموكل|الموكله|ورثه|مورث|مورثه|نجل|كريمه|زوج|زوجه)$/;
  function hasDigit(s) { return /[0-9٠-٩۰-۹]/.test(s); }

  /* one line → [{t: text, word: bool, doubt: bool, core}] */
  function segments(line) {
    var out = [], doubt = false;
    line.split(PIECE).forEach(function (p) {
      if (!p) return;
      if (p === '⟦') { doubt = true; out.push({ t: p }); return; }
      if (p === '⟧') { doubt = false; out.push({ t: p }); return; }
      var frac = /^\{([^{}\/]+)\/([^{}\/]+)\}$/.exec(p);
      if (frac) { out.push({ t: p, word: true, doubt: doubt, core: norm(frac[1]) + '/' + norm(frac[2]) }); return; }
      if (MARKUP.test(p)) { out.push({ t: p }); return; }
      var core = norm(p);
      out.push(core ? { t: p, word: true, doubt: doubt, core: core } : { t: p });
    });
    return out;
  }
  function isFig(line) { return /^\s*\[FIG/.test(line); }
  function tokens(text) {
    var out = [];
    String(text || '').replace(/\r/g, '').split('\n').forEach(function (line) {
      if (isFig(line)) return;
      segments(line).forEach(function (s) { if (s.word) out.push(s.core); });
    });
    return out;
  }

  /* longest common subsequence alignment → unmatched words on each side */
  function align(a, b) {
    var n = a.length, m = b.length;
    if (n * m > 4e6) { /* very long pages: compare as bags of words */
      var cnt = {}; a.forEach(function (w) { cnt[w] = (cnt[w] || 0) + 1; });
      var onlyB = []; b.forEach(function (w) { if (cnt[w]) cnt[w]--; else onlyB.push(w); });
      var onlyA = []; Object.keys(cnt).forEach(function (w) { for (var i = 0; i < cnt[w]; i++) onlyA.push(w); });
      return { match: n - onlyA.length, onlyA: onlyA, onlyB: onlyB };
    }
    var L = new Array(n + 1);
    for (var i = 0; i <= n; i++) L[i] = new Uint16Array(m + 1);
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var oa = [], ob = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) oa.push(a[i++]);
      else ob.push(b[j++]);
    }
    while (i < n) oa.push(a[i++]);
    while (j < m) ob.push(b[j++]);
    return { match: L[0][0], onlyA: oa, onlyB: ob };
  }

  function compare(a, b) {
    var ta = tokens(a), tb = tokens(b), r = align(ta, tb);
    var total = Math.max(ta.length, tb.length, 1);
    return { same: !r.onlyA.length && !r.onlyB.length, agreement: r.match / total, onlyA: r.onlyA, onlyB: r.onlyB, words: total };
  }
  /* readable list of disagreements for the judge prompt */
  function disagreements(a, b, max) {
    var r = compare(a, b), uniq = function (x) { return x.filter(function (w, i) { return x.indexOf(w) === i; }); };
    return { a: uniq(r.onlyA).slice(0, max || 80), b: uniq(r.onlyB).slice(0, max || 80), same: r.same, agreement: r.agreement };
  }

  /* Mark ⟦…⟧ in the final text:
       - a word that is new (neither read has it, nor anything close to it)
       - a number the reads disagreed on, or a number either read doubted
       - in a name (after «السيد /» etc.): any word the reads disagreed on (strict mode)
     Spelling-only differences and words the judge confirmed are not marked: the judge saw the ink. */
  function guard(final, a, b, strict) {
    var ta = tokens(a), tb = tokens(b), seen = {}, diff = {}, doubtedNum = {}, added = 0;
    var r = align(ta, tb);
    ta.concat(tb).forEach(function (w) { seen[w] = 1; });
    r.onlyA.concat(r.onlyB).forEach(function (w) { diff[w] = 1; });
    [a, b].forEach(function (t) { String(t || '').split('\n').forEach(function (l) { if (!isFig(l)) segments(l).forEach(function (s) { if (s.word && s.doubt && hasDigit(s.core)) doubtedNum[s.core] = 1; }); }); });
    var all = Object.keys(seen);
    function close(w) { for (var i = 0; i < all.length; i++) if (similar(w, all[i]) >= 0.75) return true; return false; }
    var text = String(final || '').replace(/\r/g, '').split('\n').map(function (line) {
      if (isFig(line)) return line;
      var segs = segments(line), nameLeft = 0, prevCore = '';
      return segs.map(function (s) {
        if (!s.word) { if (s.t.indexOf('/') >= 0 && NAME_MARK.test(prevCore)) nameLeft = 4; return s.t; }
        var core = s.core, inName = nameLeft > 0; if (nameLeft > 0) nameLeft--;
        if (NAME_MARK.test(core) && !inName) { prevCore = core; return s.t; }
        if (/^\/$/.test(core)) { prevCore = core; return s.t; }
        prevCore = core;
        if (s.doubt) return s.t;
        var mark = false;
        if (hasDigit(core)) mark = !!(diff[core] || doubtedNum[core] || !seen[core]);
        else if (!seen[core]) mark = !close(core);
        else if (strict && inName && diff[core]) mark = true;
        if (mark) { added++; return '⟦' + s.t + '⟧'; }
        return s.t;
      }).join('');
    }).join('\n');
    return { text: text, added: added };
  }

  /* numbers pass: «<number> | <words before>» lines from a dedicated read of the strips.
     A number in the text that the pass did not see is marked; a truncated one (prefix of a pass number) is
     completed with the pass's digits and marked for the eye. Numbers the pass saw exactly are left alone. */
  var AR_DIG = '٠١٢٣٤٥٦٧٨٩', FA_DIG = '۰۱۲۳۴۵۶۷۸۹';
  function west(t) { return String(t || '').replace(/[٠-٩]/g, function (c) { return String(AR_DIG.indexOf(c)); }).replace(/[۰-۹]/g, function (c) { return String(FA_DIG.indexOf(c)); }); }
  function digitsOnly(t) { return west(t).replace(/[^0-9]/g, ''); }
  function sameScript(sample, digits) { return /[٠-٩]/.test(sample) ? digits.replace(/[0-9]/g, function (c) { return AR_DIG[+c]; }) : digits; }
  function checkNumbers(text, list) {
    var seen = String(list || '').split('\n').map(function (l) { return west(l.split('|')[0]).trim(); }).filter(function (x) { return /[0-9]/.test(x) && x.indexOf('?') < 0; });
    var exact = {}; seen.forEach(function (n) { exact[n.replace(/\s+/g, '')] = 1; exact[digitsOnly(n)] = 1; });
    var changed = 0, marked = 0;
    var out = String(text || '').replace(/\r/g, '').split('\n').map(function (line) {
      if (isFig(line)) return line;
      return segments(line).map(function (s) {
        if (!s.word || !hasDigit(s.t) || s.doubt) return s.t;
        var core = s.t.replace(/[*_⟦⟧]/g, ''), w = west(core).replace(/[^0-9\/.,:\-]/g, ''), d = digitsOnly(core);
        if (!d) return s.t;
        if (/^[(]?[0-9٠-٩]{1,2}[).\-–:]$/.test(core)) return s.t;       // item numbering «1.» «٢-» is not data
        if (exact[w] || exact[d]) return s.t;
        /* truncated: a pass number starts with this one and has 1–2 more digits (٢٠٢ → ٢٠٢٢) */
        var longer = seen.filter(function (n) { var nd = digitsOnly(n); return nd !== d && nd.indexOf(d) === 0 && nd.length - d.length <= 2 && (n.replace(/\s+/g, '').indexOf(w) === 0); });
        if (longer.length === 1) {
          var fixed = sameScript(core, longer[0].replace(/\s+/g, ''));
          changed++; return s.t.replace(core, '⟦' + fixed + '⟧');
        }
        marked++; return '⟦' + s.t + '⟧';
      }).join('');
    }).join('\n');
    return { text: out, changed: changed, marked: marked };
  }

  function stripMarkup(text) {
    return String(text || '').replace(/\r/g, '').split('\n').filter(function (l) { return !isFig(l); }).map(function (line) {
      return segments(line).filter(function (s) { return s.word; }).map(function (s) { return s.t.replace(/[⟦⟧]/g, ''); }).join(' ');
    }).join('\n');
  }
  function lev(a, b) {
    var prev = new Array(b.length + 1), cur = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      var t = prev; prev = cur; cur = t;
    }
    return prev[b.length];
  }
  function cer(ref, hyp) { var r = Array.from(tokens(ref).join(' ')), h = Array.from(tokens(hyp).join(' ')); return r.length ? lev(r, h) / r.length : (h.length ? 1 : 0); }
  function wer(ref, hyp) { var r = tokens(ref), h = tokens(hyp); return r.length ? lev(r, h) / r.length : (h.length ? 1 : 0); }
  /* of the words the reading got wrong, how many did it mark as doubtful? missed = wrong and NOT marked (the dangerous ones) */
  function audit(ref, hypMarked) {
    var refSet = {}; tokens(ref).forEach(function (w) { refSet[w] = 1; });
    var wrong = 0, caught = 0, marked = 0, missed = [];
    String(hypMarked || '').split('\n').forEach(function (line) {
      if (isFig(line)) return;
      segments(line).forEach(function (s) {
        if (!s.word) return;
        if (s.doubt) marked++;
        if (!refSet[s.core]) { wrong++; if (s.doubt) caught++; else missed.push(s.core); }
      });
    });
    return { wrong: wrong, caught: caught, marked: marked, missed: missed };
  }
  function doubtRecall(ref, hypMarked) { var a = audit(ref, hypMarked); return a.wrong ? a.caught / a.wrong : 1; }

  return { norm: norm, tokens: tokens, compare: compare, disagreements: disagreements, guard: guard, stripMarkup: stripMarkup, cer: cer, wer: wer, audit: audit, doubtRecall: doubtRecall, checkNumbers: checkNumbers };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Verify;
