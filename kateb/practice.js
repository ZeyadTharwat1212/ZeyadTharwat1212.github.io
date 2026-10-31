/* v50 ready-made practice sheets for Ms. Hanan — no photo, no AI, no cost: random exercises by grade and topic,
   written in the same exam format the reader produces, so they open in the editable preview and go to Word in her layout.
   Idea from the open-source worksheet generators (our own code). make({grade, topics, count, answers}) → exam text */
var Practice = (function () {
  'use strict';
  function R(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = a % b; a = b; b = t; } return a || 1; }
  function frac(n, d) { var g = gcd(n, d); n /= g; d /= g; if (d === 1) return String(n); if (n > d) { var w = Math.floor(n / d), r = n % d; return w + ' {' + r + '/' + d + '}'; } return '{' + n + '/' + d + '}'; }
  function neg(x) { return x < 0 ? '(−' + (-x) + ')' : String(x); }
  function sgn(x) { return x < 0 ? '−' + (-x) : String(x); }
  function dec(x, p) { return String(+x.toFixed(p)); }
  /* each generator: → {q: question without «= ____», a: answer text, v: numeric answer (for choices) or null} */
  var G = {
    add3: function () { var a = R(105, 849), b = R(100, 999 - a); return { q: a + ' + ' + b, a: String(a + b), v: a + b }; },
    sub3: function () { var a = R(300, 999), b = R(101, a - 50); return { q: a + ' − ' + b, a: String(a - b), v: a - b }; },
    mul1: function () { var a = R(2, 10), b = R(2, 10); return { q: a + ' × ' + b, a: String(a * b), v: a * b }; },
    mul21: function () { var a = R(12, 99), b = R(2, 9); return { q: a + ' × ' + b, a: String(a * b), v: a * b }; },
    divexact: function () { var b = R(2, 9), q = R(3, 12); return { q: (b * q) + ' ÷ ' + b, a: String(q), v: q }; },
    compare: function () { var a = R(100, 999), b = Math.random() < 0.2 ? a : R(100, 999); return { q: a + ' ____ ' + b, a: a > b ? '>' : a < b ? '<' : '=', v: null, blank: true }; },
    add6: function () { var a = R(10000, 499999), b = R(10000, 499999); return { q: a + ' + ' + b, a: String(a + b), v: a + b }; },
    sub6: function () { var a = R(50000, 999999), b = R(10000, a - 1000); return { q: a + ' − ' + b, a: String(a - b), v: a - b }; },
    mul22: function () { var a = R(12, 99), b = R(12, 99); return { q: a + ' × ' + b, a: String(a * b), v: a * b }; },
    div31: function () { var b = R(2, 9), q = R(21, 199); return { q: (b * q) + ' ÷ ' + b, a: String(q), v: q }; },
    round: function () { var a = R(1001, 99999), to = pick([10, 100, 1000]); return { q: 'Round ' + a + ' to the nearest ' + to, a: String(Math.round(a / to) * to), v: Math.round(a / to) * to, word: true }; },
    mul32: function () { var a = R(101, 999), b = R(11, 99); return { q: a + ' × ' + b, a: String(a * b), v: a * b }; },
    div42: function () { var b = R(11, 49), q = R(12, 99); return { q: (b * q) + ' ÷ ' + b, a: String(q), v: q }; },
    decadd: function () { var a = R(105, 9999) / 100, b = R(105, 9999) / 100, s = Math.random() < 0.5; if (!s && b > a) { var t = a; a = b; b = t; } var v = s ? a + b : a - b; return { q: dec(a, 2) + (s ? ' + ' : ' − ') + dec(b, 2), a: dec(v, 2), v: +v.toFixed(2) }; },
    fracsame: function () { var d = R(3, 12), a = R(1, d - 1), b = R(1, d - 1); return { q: '{' + a + '/' + d + '} + {' + b + '/' + d + '}', a: frac(a + b, d), v: null }; },
    fracdiff: function () { var d1 = pick([2, 3, 4, 5, 6]), d2 = pick([3, 4, 6, 8, 10]); if (d1 === d2) d2 = d1 * 2; var a = R(1, d1 - 1), b = R(1, d2 - 1), s = Math.random() < 0.6;
      var n = s ? a * d2 + b * d1 : a * d2 - b * d1; if (n <= 0) { s = true; n = a * d2 + b * d1; } return { q: '{' + a + '/' + d1 + '} ' + (s ? '+' : '−') + ' {' + b + '/' + d2 + '}', a: frac(n, d1 * d2), v: null }; },
    fracmul: function () { var a = R(1, 5), b = R(2, 9), c = R(1, 5), d = R(2, 9); if (a >= b) a = b - 1; if (c >= d) c = d - 1; return { q: '{' + a + '/' + b + '} × {' + c + '/' + d + '}', a: frac(a * c, b * d), v: null }; },
    decmul: function () { var a = R(11, 99) / 10, b = R(2, 9); return { q: dec(a, 1) + ' × ' + b, a: dec(a * b, 1), v: +(a * b).toFixed(1) }; },
    percent: function () { var p = pick([10, 20, 25, 50, 75, 5, 30, 40]), n = pick([20, 40, 60, 80, 100, 120, 200, 240, 300, 400]); return { q: p + '% of ' + n, a: String(p * n / 100), v: p * n / 100 }; },
    ratio: function () { var g = R(2, 9), a = R(1, 9), b = R(1, 9); if (gcd(a, b) > 1) b = b + 1; if (a === b) b++; var k = gcd(a, b); a /= k; b /= k; return { q: 'Simplify the ratio ' + (a * g) + ' : ' + (b * g), a: a + ' : ' + b, v: null, word: true }; },
    order: function () { var a = R(2, 9), b = R(2, 9), c = R(2, 9), d = R(1, 20); return { q: d + ' + ' + a + ' × ' + b + ' − ' + c, a: String(d + a * b - c), v: d + a * b - c }; },
    intadd: function () { var a = R(-20, 20) || 3, b = R(-20, 20) || -4, s = Math.random() < 0.5, v = s ? a + b : a - b; return { q: sgn(a) + (s ? ' + ' : ' − ') + neg(b), a: sgn(v), v: v }; },
    intmul: function () { var a = R(-12, 12) || 2, b = R(-12, 12) || -3, m = Math.random() < 0.6; if (m) return { q: neg(a) + ' × ' + neg(b), a: sgn(a * b), v: a * b }; var p = a * b; return { q: neg(p) + ' ÷ ' + neg(b), a: sgn(a), v: a }; },
    power: function () { var b = R(2, 6), e = b > 4 ? R(2, 3) : R(2, 5), n = Math.random() < 0.3; if (n) return { q: '\\((-' + b + ')^{' + e + '}\\)', a: sgn(Math.pow(-b, e)), v: Math.pow(-b, e) }; return { q: '\\(' + b + '^{' + e + '}\\)', a: String(Math.pow(b, e)), v: Math.pow(b, e) }; },
    sqrt: function () { var r = R(2, 15); return { q: '\\(\\sqrt{' + (r * r) + '}\\)', a: String(r), v: r }; },
    equation: function () { var x = R(-9, 15), a = R(2, 20), t = pick(['+', '−']); return { q: 'x ' + t + ' ' + a + ' = ' + sgn(t === '+' ? x + a : x - a) + ' ,  then x = __________', a: 'x = ' + sgn(x), v: x, blank: true }; }
  };
  var GRADES = {
    P3: { label: 'Primary 3', topics: [['add3', 'جمع 3 أرقام'], ['sub3', 'طرح 3 أرقام'], ['mul1', 'جدول الضرب'], ['divexact', 'القسمة'], ['compare', 'المقارنة (> < =)']] },
    P4: { label: 'Primary 4', topics: [['add6', 'جمع أعداد كبيرة'], ['sub6', 'طرح أعداد كبيرة'], ['mul21', 'ضرب في رقم'], ['mul22', 'ضرب رقمين × رقمين'], ['div31', 'القسمة على رقم'], ['round', 'التقريب']] },
    P5: { label: 'Primary 5', topics: [['mul32', 'الضرب'], ['div42', 'القسمة على رقمين'], ['decadd', 'جمع وطرح الكسور العشرية'], ['fracsame', 'جمع كسور متحدة المقام'], ['round', 'التقريب']] },
    P6: { label: 'Primary 6', topics: [['fracdiff', 'جمع وطرح الكسور'], ['fracmul', 'ضرب الكسور'], ['decmul', 'ضرب الكسور العشرية'], ['ratio', 'تبسيط النسبة'], ['percent', 'النسبة المئوية'], ['order', 'ترتيب العمليات']] },
    PREP1: { label: 'Prep 1', topics: [['intadd', 'جمع وطرح الأعداد الصحيحة'], ['intmul', 'ضرب وقسمة الأعداد الصحيحة'], ['power', 'القوى (الأسس)'], ['sqrt', 'الجذر التربيعي'], ['equation', 'حل معادلة بسيطة']] }
  };
  function gradeOf(txt) {
    var t = String(txt || '').toLowerCase();
    if (/prep|إعداد|اعداد/.test(t)) return 'PREP1';
    var m = t.match(/[3-6]/); return m ? 'P' + m[0] : 'P4';
  }
  function choices(v) {
    var set = {}, out = [v];
    set[v] = 1;
    var tries = 0;
    while (out.length < 4 && tries++ < 50) {
      var d = pick([1, 2, 3, 10, -1, -2, -3, -10, 100, -100]), c = Number.isInteger(v) ? v + d : +(v + d / 10).toFixed(2);
      if (Math.abs(v) < 20 && Math.abs(d) >= 10) continue;
      if (v >= 0 && c < 0 && tries < 40) continue;                                 // a non-negative answer keeps positive choices (unless nothing else is left)
      if (!set[c]) { set[c] = 1; out.push(c); }
    }
    out.sort(function () { return Math.random() - 0.5; });
    return out;
  }
  function make(o) {
    o = o || {};
    var g = GRADES[o.grade] || GRADES.P4, topics = (o.topics && o.topics.length ? o.topics : g.topics.map(function (t) { return t[0]; })).filter(function (k) { return G[k]; });
    var n = Math.max(4, Math.min(40, o.count || 12)), seen = {}, items = [];
    for (var i = 0, tries = 0; items.length < n && tries < n * 30; tries++) {
      var x = G[topics[i % topics.length]](); if (seen[x.q]) continue; seen[x.q] = 1; x.k = topics[i % topics.length]; items.push(x); i++;
    }
    var calc = items.filter(function (x) { return x.v === null || x.word || x.blank; }), num = items.filter(function (x) { return !(x.v === null || x.word || x.blank); });
    var nChoose = Math.min(num.length, Math.round(n / 3)), choose = num.slice(0, nChoose), rest = num.slice(nChoose).concat(calc);
    var L = ['GRADE: ' + g.label], qn = 0, key = [];
    if (rest.length) {
      L.push('[Q] Question (' + (++qn) + ') ' + (rest.some(function (x) { return x.blank; }) && rest.every(function (x) { return x.blank; }) ? 'Complete using (>, < or =)' : 'Complete'));
      key.push('Question (' + qn + ')');
      rest.forEach(function (x, j) { L.push('[I] **' + (j + 1) + ')** ' + (x.word || x.blank ? x.q + (x.blank ? '' : ' = __________') : x.q + ' = __________')); key.push((j + 1) + ') ' + x.a); });
    }
    if (choose.length) {
      L.push('[Q] Question (' + (++qn) + ') Choose the correct answer');
      key.push('Question (' + qn + ')');
      choose.forEach(function (x, j) {
        var cs = choices(x.v), ab = 'abcd';
        L.push('[I] **' + (j + 1) + ')** ' + x.q + ' = ……');
        L.push('[OPT] ' + cs.map(function (c, k) { return ab[k] + ') ' + sgn(c); }).join(' | '));
        key.push((j + 1) + ') ' + ab[cs.indexOf(x.v)] + ') ' + x.a);
      });
    }
    if (o.answers) { L.push('[Q] Answers'); key.forEach(function (k) { L.push(/^Question/.test(k) ? '**' + k + '**' : k); }); }
    return L.join('\n');
  }
  return { make: make, GRADES: GRADES, gradeOf: gradeOf, _G: G };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Practice;
