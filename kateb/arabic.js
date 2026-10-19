/* Arabic helpers for Egyptian legal papers: amounts in words (تفقيط), weekday of a date, text normalisation.
   Pure functions, no dependencies; also run under Node for tests. */
var Arabic = (function () {
  'use strict';
  var ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  var TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  var HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
  function under1000(n) {
    var parts = [], h = Math.floor(n / 100), r = n % 100;
    if (h) parts.push(HUNDREDS[h]);
    if (r < 20) { if (r) parts.push(ONES[r]); }
    else { var o = r % 10, t = Math.floor(r / 10); parts.push(o ? ONES[o] + ' و' + TENS[t] : TENS[t]); }
    return parts.join(' و');
  }
  /* scale words: [singular, dual, plural (3-10), accusative singular (11+)] */
  var SCALES = [null, ['ألف', 'ألفان', 'آلاف', 'ألف'], ['مليون', 'مليونان', 'ملايين', 'مليون'], ['مليار', 'ملياران', 'مليارات', 'مليار']];
  function scaleWord(n, k) {
    var s = SCALES[k], r = n % 100;
    if (n === 1) return s[0];
    if (n === 2) return s[1];
    if (r >= 3 && r <= 10) return under1000(n) + ' ' + s[2];
    return under1000(n) + ' ' + s[3];
  }
  /* 250000 → «مائتان وخمسون ألف», 1050000 → «مليون وخمسون ألف», 6300 → «ستة آلاف وثلاثمائة» */
  function words(n) {
    n = Math.floor(Math.abs(+n || 0));
    if (!n) return 'صفر';
    var groups = [], k = 0, out = [];
    while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
    for (k = groups.length - 1; k >= 0; k--) {
      var g = groups[k]; if (!g) continue;
      out.push(k ? scaleWord(g, k) : under1000(g));
    }
    return out.join(' و');
  }
  /* the office's full amount phrase */
  function amount(n, currency) { return words(n) + ' ' + (currency || 'جنيه مصري') + ' لا غير'; }

  var TASHKEEL = /[ً-ْٰـ]/g;
  function norm(t) {
    return String(t || '').replace(TASHKEEL, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .replace(/مئه/g, 'مائه').replace(/مئت/g, 'مائت').replace(/(^|\s)و\s+/g, '$1و').replace(/\s+/g, ' ').trim();
  }
  /* words of an amount as a comparable token list: «جنيه مصري لا غير», «فقط», brackets dropped */
  /* case endings are not differences: خمسين = خمسون, ألفين = ألفان, مائتين = مائتان, اثنين = اثنان */
  function inflect(w) {
    return w.replace(/^(و?)(عشر|ثلاث|اربع|خمس|ست|سبع|ثمان|تسع)ين$/, '$1$2ون').replace(/^(و?)(الف|مليون|مليار|مائت)ين$/, '$1$2ان').replace(/^(و?)اثنين$/, '$1اثنان').replace(/^(و?)اثني عشر$/, '$1اثنا عشر');
  }
  function amountTokens(t) {
    return norm(t).replace(/[()«»"]/g, ' ').split(' ').filter(function (w) { return w && !/^(جنيه|جنيها|جنيهات|مصري|مصريا|لا|غير|فقط|ج|م)$/.test(w); }).map(inflect);
  }
  function sameAmount(n, text) {
    var a = amountTokens(words(n)), b = amountTokens(text);
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  function dayName(d, m, y) { var dt = new Date(y, m - 1, d); if (isNaN(dt) || dt.getDate() !== d) return null; return DAYS[dt.getDay()]; }
  function dayIndex(name) { var n = norm(name); for (var i = 0; i < DAYS.length; i++) if (norm(DAYS[i]) === n) return i; return -1; }

  var W = /[0-9]/.source;
  function west(t) { return String(t || '').replace(/[٠-٩]/g, function (c) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)); }); }

  /* Checks on a transcription (0-9 digits, markup lines). Returns {text, notes:[…]} with ⟦ ⟧ added where
     the paper contradicts itself: amount words ≠ digits, weekday ≠ date. */
  function check(text) {
    var notes = [], out = String(text || '').split('\n').map(function (line) {
      if (/^\s*\[FIG/.test(line)) return line;
      var l = line;
      /* amounts: «250000 ج ( مائتان وخمسون ألف جنيه مصري لا غير )» — digits then words within brackets or after «فقط» */
      l = l.replace(/(⟦?)(\d[\d.,]*)(⟧?)\s*(ج|جنيه|جنيها|جنية)(?![\u0600-\u06FF])([^()\n]{0,20})\(\s*([^()]{3,160}?)\s*\)/g, function (m, o1, digits, c1, cur, mid, inside) {
        var n = +digits.replace(/[.,]/g, ''); if (!n || !/(الف|ألف|مائة|مئة|مليون|عشر|ون|ان|ة)/.test(inside)) return m;
        if (sameAmount(n, inside)) return m;
        notes.push({ kind: 'amount', digits: digits, words: inside, expected: amount(n) });
        return '⟦' + digits + '⟧ ' + cur + mid + '( ⟦' + inside + '⟧ )';
      });
      /* weekday: «يوم الأحد الموافق 7/9/2025» */
      l = l.replace(/(يوم\s+)(⟦?)(ال[أاإ]حد|ال[اإ]ثنين|الثلاثاء|ال[أا]ربعاء|الخميس|الجمع[ةه]|السبت)(⟧?)(\s+الموافق\s+)(⟦?)(\d{1,2})\/(\d{1,2})\/(\d{4})(⟧?)/g, function (m, p1, o1, day, c1, p2, o2, d, mo, y, c2) {
        var real = dayName(+d, +mo, +y); if (!real || dayIndex(day) === dayIndex(real)) return m;
        notes.push({ kind: 'weekday', day: day, date: d + '/' + mo + '/' + y, expected: real });
        return p1 + '⟦' + day + '⟧' + p2 + '⟦' + d + '/' + mo + '/' + y + '⟧';
      });
      return l;
    }).join('\n');
    return { text: out, notes: notes };
  }

  /* spelling pass: every word whose folded form is in the office dictionary takes the office's majority spelling
     (hamza / ة / ى only — never another word). Numbers, markup and figure lines are untouched. */
  function spell(text, dict) {
    var words = dict && dict.words; if (!words) return { text: text, fixed: 0 };
    var fixed = 0;
    var out = String(text || '').split('\n').map(function (line) {
      if (/^\s*\[FIG/.test(line)) return line;
      return line.replace(/[\u0621-\u064A]{2,}/g, function (w) {
        var k = norm(w), best = words[k];
        if (!best || best === w) return w;
        /* only ة/ه slips and the دعوى family: hamza and ى/ي habits of the hand are left as written */
        var fold = function (x) { return x.replace(/ة/g, 'ه'); };
        if (fold(best) !== fold(w) && !/^(ال)?دعو[يه]$/.test(k)) return w;
        fixed++; return best;
      });
    }).join('\n');
    return { text: out, fixed: fixed };
  }

  return { words: words, amount: amount, spell: spell, sameAmount: sameAmount, dayName: dayName, check: check, norm: norm, west: west };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Arabic;
