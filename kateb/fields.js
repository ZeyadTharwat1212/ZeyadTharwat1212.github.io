/* Critical fields of an Egyptian court paper, found in the transcription on the device: court, case numbers
   (رقم … لسنة …), dates, amounts, party names. The review screen lists them so they are checked against the
   photo one by one, and consistency() warns when the same kind of fact appears in two different forms
   (a case number that differs between pages, a name written two ways) — without ever merging them.
   Pure functions; also runs under Node for tests. */
var Fields = (function () {
  'use strict';
  var AD = '٠١٢٣٤٥٦٧٨٩';
  function west(s) { return String(s || '').replace(/[٠-٩]/g, function (c) { return String(AD.indexOf(c)); }).replace(/[۰-۹]/g, function (c) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)); }); }
  function clean(t) { return String(t || '').replace(/[⟦⟧*_]/g, '').replace(/‏/g, '').replace(/^\s*\[[A-Z]+\]\s*/gm, '').replace(/[ \t]+/g, ' '); }
  function uniq(list, key) { var seen = {}, out = []; list.forEach(function (x) { var k = key(x); if (!seen[k]) { seen[k] = 1; out.push(x); } }); return out; }
  var NAME_STOP = '(?=\\s+(?:بصفت|والمقيم|المقيم|ومحل|بالغ|وشهرت|المولود|ويمثل|الموطن|وجنسيت|ومهنت|ويعلن|مخاطب|رقم قومي|بطاقة|-|–|—|،|,|\\(|\\)|\\/|\\t)|\\s+(?:و|السيد|السيدة|الأستاذ|الأستاذة)(?=\\s|$)|\\s*[\\n،,.:;()\\/\\t]|\\s*$)';
  var NAME_RE = new RegExp('(?:السيد|السيدة|الأستاذ|الأستاذة|الدكتور|الدكتورة|الحاج|الحاجة|المهندس|المهندسة|المرحوم|المرحومة)\\s*\\/\\s*([^\\n\\/،,()\\t]{3,60}?)' + NAME_STOP, 'g');
  var CASE_RE = /(?:رقم|برقم|القضية|الدعوى|الاستئناف|الطعن|الجنحة|الجناية)\s*(?:رقم)?\s*[:：]?\s*([0-9٠-٩۰-۹]{1,7})\s*لسنة\s*([0-9٠-٩۰-۹]{2,4})/g;
  var DATE_RE = /(?:^|[^0-9٠-٩۰-۹\/])([0-9٠-٩۰-۹]{1,2})\s*\/\s*([0-9٠-٩۰-۹]{1,2})\s*\/\s*([0-9٠-٩۰-۹]{2,4})(?![0-9٠-٩۰-۹\/])/g;
  var AMOUNT_RE = /([0-9٠-٩۰-۹][0-9٠-٩۰-۹.,]{2,})\s*(?:ج\.?\s*م\.?|جنيهاً|جنيها|جنيه|جم)/g;
  var COURT_RE = /محكمة\s+([^\n،,.:;()]{3,50}?)(?=[\n،,.:;()]|\s+(?:رقم|في|قد|بتاريخ|الدائرة|أمام|و|التي|الذي|بجلسة|جلسة)(?=\s|$)|\s*$)/g;
  function extract(text) {
    var t = clean(text), m, out = { court: [], cases: [], dates: [], amounts: [], names: [] };
    while ((m = COURT_RE.exec(t))) out.court.push(('محكمة ' + m[1]).replace(/\s+/g, ' ').trim());
    while ((m = CASE_RE.exec(t))) out.cases.push({ num: west(m[1]), year: west(m[2]), raw: m[0].replace(/\s+/g, ' ').trim() });
    while ((m = DATE_RE.exec(t))) out.dates.push({ d: west(m[1]), m: west(m[2]), y: west(m[3]), raw: (m[1] + '/' + m[2] + '/' + m[3]) });
    while ((m = AMOUNT_RE.exec(t))) out.amounts.push({ value: west(m[1]).replace(/[.,]/g, ''), raw: m[0].replace(/\s+/g, ' ').trim() });
    while ((m = NAME_RE.exec(t))) { var n = m[1].replace(/\s+/g, ' ').trim().replace(/[\-–—:،,.؛]+$/, '').trim(); if (/[؀-ۿ]/.test(n)) out.names.push(n); }
    out.court = uniq(out.court, function (x) { return x; });
    out.cases = uniq(out.cases, function (x) { return x.num + '/' + x.year; });
    out.dates = uniq(out.dates, function (x) { return x.d + '/' + x.m + '/' + x.y; });
    out.amounts = uniq(out.amounts, function (x) { return x.value; });
    out.names = uniq(out.names, function (x) { return x; });
    return out;
  }
  function lev(a, b) {
    var prev = [], cur = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) { cur[0] = i; for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); var x = prev; prev = cur; cur = x; }
    return prev[b.length];
  }
  function fold(s) { return String(s).replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' '); }
  /* warnings over all pages of one paper: facts that appear in two close but different forms */
  function consistency(texts) {
    var all = texts.map(extract), warn = [];
    var cases = uniq([].concat.apply([], all.map(function (f) { return f.cases; })), function (c) { return c.num + '/' + c.year; });
    for (var i = 0; i < cases.length; i++) for (var j = i + 1; j < cases.length; j++) {
      var a = cases[i], b = cases[j];
      if (a.year === b.year && a.num !== b.num && lev(a.num, b.num) <= 1) warn.push({ kind: 'case', text: 'رقم القضية مكتوب بصورتين: ' + a.num + ' لسنة ' + a.year + ' و ' + b.num + ' لسنة ' + b.year + ' — تأكد من الصورة أيهما الصحيح.' });
      else if (a.num === b.num && a.year !== b.year) warn.push({ kind: 'case', text: 'سنة القضية مكتوبة بصورتين: ' + a.num + ' لسنة ' + a.year + ' و لسنة ' + b.year + ' — تأكد من الصورة.' });
    }
    var names = uniq([].concat.apply([], all.map(function (f) { return f.names; })), function (n) { return n; });
    for (i = 0; i < names.length; i++) for (j = i + 1; j < names.length; j++) {
      var x = fold(names[i]), y = fold(names[j]); if (x === y) continue;
      var d = lev(x, y);
      if (d <= 2 && Math.min(x.length, y.length) >= 6) warn.push({ kind: 'name', text: 'اسم مكتوب بصورتين قريبتين: «' + names[i] + '» و «' + names[j] + '» — قد يكونان شخصين مختلفين أو خطأ قراءة، راجع الصورة.' });
    }
    var dates = uniq([].concat.apply([], all.map(function (f) { return f.dates; })), function (x) { return x.d + '/' + x.m + '/' + x.y; });
    dates.forEach(function (dt) {
      var d = +dt.d, mo = +dt.m, y = +dt.y;
      if (d < 1 || d > 31 || mo < 1 || mo > 12 || (dt.y.length === 4 && (y < 1950 || y > 2100)) || dt.y.length === 3) warn.push({ kind: 'date', text: 'تاريخ غير معتاد: ' + dt.raw + ' — تأكد من الأرقام في الصورة.' });
    });
    return warn;
  }
  return { extract: extract, consistency: consistency, west: west, clean: clean };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Fields;
