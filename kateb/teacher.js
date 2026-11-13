/* v57 Ms. Hanan's class work — everything she sees is in plain Arabic, only the maths stays in English.
   1 «تصحيح ورق الطلاب»: photograph each pupil's answered paper → the AI marks it against the exam (and its answer key)
   2 «كشف الدرجات»: classes, pupils, every test's marks, totals, Excel, print (kept in exam.classes → synced)
   3 «تحضير درس»: a lesson from the ministry book → worksheet / homework / short quiz / revision / remedial sheet
   5 messages to the parents on WhatsApp, 6 weak lessons of the class → a remedial sheet in one tap.
   Teacher.init(ctx) is called by app.js with the helpers it needs. */
var Teacher = (function () {
  'use strict';
  var C = null, $ = function (id) { return document.getElementById(id); };
  var LS_CLASSES = 'exam.classes', LS_TEACHER = 'exam.teacherName', LS_LAST = 'katebT.lastGrading';
  var AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  function ar(n) { return String(n).replace(/\d/g, function (d) { return AR_DIGITS[+d]; }); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function lsJson(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function lsPut(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function classes() { return lsJson(LS_CLASSES, []); }
  function saveClasses(cs) { lsPut(LS_CLASSES, cs); try { if (typeof Sync !== 'undefined' && Sync.soon) Sync.soon(); } catch (e) {} }
  function teacherName() { return C.Engine.lsGet(LS_TEACHER) || 'مس حنان'; }
  /* names as pupils write them: one spelling for matching (أ إ آ → ا، ة → ه، ى → ي، no tashkeel, no extra spaces) */
  function normName(s) { return String(s || '').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^؀-ۿa-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function sameName(a, b) {
    a = normName(a); b = normName(b); if (!a || !b) return false; if (a === b) return true;
    var aw = a.split(' '), bw = b.split(' '), n = Math.min(aw.length, bw.length, 2);    // first two names agree («أحمد محمد» = «احمد محمد علي»)
    for (var i = 0; i < n; i++) if (aw[i] !== bw[i]) return false;
    return n >= 2 || (n === 1 && aw.length === 1 && bw.length === 1);
  }
  function termNow() { var m = new Date().getMonth() + 1; return m >= 2 && m <= 7 ? '2' : '1'; }

  /* ================= 1 · grading ================= */
  var G = { exam: null, max: 30, kids: [], pairs: false, classId: '', busy: false, abort: null };
  async function examDocs() {
    var ds = await C.Store.listDocs(C.MODE);
    return ds.filter(function (d) { return !d.plain && d.pages && d.pages.length; }).sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
  }
  function docText(d) {
    var box = document.createElement('div'), blocks = [];
    (d.pages || []).forEach(function (p) { box.innerHTML = p.html || ''; blocks = blocks.concat(C.domBlocks(box)); });
    return C.ExamBuilder.blocksToText(blocks);
  }
  function keyMarks(text) { var m = /total\s+(\d{1,3})\s+marks/i.exec(text) || /Answer key and marks[^\n]*?(\d{1,3})/i.exec(text); return m ? +m[1] : 0; }
  async function openGrading() {
    C.show('grading');
    G.kids = []; G.exam = null; G.busy = false; paintKids(); $('gResults').hidden = true; $('gProgress').hidden = true;
    var list = await examDocs(), cur = C.curDoc();
    $('gExams').innerHTML = list.slice(0, 10).map(function (d) {
      return '<button class="pick" type="button" data-gx="' + esc(d.id) + '"><b>' + esc(d.name || 'امتحان') + '</b><small>' + esc(new Date(d.updated || Date.now()).toLocaleDateString('ar-EG')) + (d.grade ? ' · ' + esc(C.gradeAr(d.grade)) : '') + '</small></button>';
    }).join('') || '<p class="small center">مفيش امتحانات في «ملفاتي» لسه. اعملي الامتحان الأول (تصوير أو «اكتبي طلبك» أو «بنك أسئلتي») وبعدين ارجعي هنا.</p>';
    if (cur && list.some(function (d) { return d.id === cur.id; })) selectExam(cur.id, list); else if (list.length === 1) selectExam(list[0].id, list);
    paintClassPick();
    paintGo();
  }
  function selectExam(id, list) {
    var d = (list || []).filter(function (x) { return x.id === id; })[0]; if (!d) return;
    G.exam = { id: d.id, name: d.name || 'امتحان', grade: d.grade || '', text: docText(d) };
    var km = keyMarks(G.exam.text);
    $('gMax').value = km || ((d.kind === 'monthly') ? 15 : 30);
    $('gHasKey').hidden = !/answer key/i.test(G.exam.text);
    Array.prototype.forEach.call($('gExams').querySelectorAll('[data-gx]'), function (b) { b.setAttribute('aria-pressed', b.dataset.gx === id ? 'true' : 'false'); });
    paintGo();
  }
  function paintClassPick() {
    var cs = classes();
    if (G.classId && !cs.some(function (c) { return c.id === G.classId; })) G.classId = '';
    $('gClass').innerHTML = cs.map(function (c) { return '<button class="chip" type="button" data-gc="' + c.id + '" aria-pressed="' + (c.id === G.classId) + '">' + esc(c.name) + '</button>'; }).join('') +
      '<button class="chip" type="button" data-gc="new">➕ فصل جديد</button>';
  }
  function paintKids() {
    var n = G.kids.length, pupils = G.pairs ? Math.ceil(n / 2) : n;
    $('gThumbs').innerHTML = G.kids.map(function (k, i) { return '<figure class="gk"><img src="' + k.thumb + '" alt=""><figcaption>' + (G.pairs ? 'طالب ' + ar(Math.floor(i / 2) + 1) + (i % 2 ? ' (٢)' : '') : ar(i + 1)) + '</figcaption><button type="button" class="x" data-grm="' + i + '" aria-label="حذف">✕</button></figure>'; }).join('');
    $('gCount').textContent = n ? 'اتصوّر ' + ar(pupils) + ' ' + (pupils === 1 ? 'ورقة طالب' : 'ورقة طلاب') : 'لسه ما اتصوّرش ورق';
    paintGo();
  }
  function paintGo() {
    var n = G.kids.length, ok = !!G.exam && n > 0 && !G.busy;
    $('gGo').disabled = !ok;
    var pupils = G.pairs ? Math.ceil(n / 2) : n;
    $('gCost').textContent = ok ? 'التكلفة التقريبية: حوالي ' + C.money(pupils * 0.05) + ' لكل الورق' : '';
  }
  async function addPhotos(files) {
    for (var i = 0; i < files.length; i++) {
      try {
        var cs = await C.Engine.fileToCanvases(files[i]);
        for (var j = 0; j < cs.length; j++) {
          var c = cs[j], imgs = await C.Engine.pageImages(c, 2, 1568), t = C.Engine.scaled(c, 220);
          G.kids.push({ blobs: imgs.blobs, bands: imgs.bands, thumb: t.toDataURL('image/jpeg', 0.7) });
        }
      } catch (e) { C.toast('⚠️ صورة لم تُقرأ: ' + C.Engine.errText(e)); }
      paintKids();
    }
  }
  function gradeSystem(sys) {
    return sys + "\n\nYOU ARE MARKING PUPILS' ANSWERED PAPERS OF THIS EXAM" + (/answer key/i.test(G.exam.text) ? " (the teacher's answer key and marks are at the end of it — follow them)" : '') + ":\n" + G.exam.text;
  }
  function gradePrompt(max, bands, two) {
    return (two ? 'The attached images are the TWO pages of one pupil\'s answered paper (each page whole, then in strips). ' : 'Image 1 is one pupil\'s answered paper; the next images are the same paper cut into horizontal strips (read the handwriting from them). ') +
      'Mark it like a careful, fair Egyptian maths teacher.\n' +
      '- The whole paper is worth exactly ' + max + ' marks. Use the teacher\'s answer key and marks when they are given; otherwise solve every question yourself and share the ' + max + ' marks sensibly (one choose / complete item is usually 1 mark; worked problems more).\n' +
      '- Accept every correct equivalent form (0.75 = {3/4}; 6/8 is right unless the question asks for the simplest form). In a worked problem give part marks for correct steps. A blank or unreadable answer gets 0 (write "—").\n' +
      '- Read the pupil\'s NAME from the top of the paper exactly as written (Arabic or English). If there is no name, use "".\n' +
      'Reply with JSON only, no other text:\n' +
      '{"name":"…","items":[{"q":"Q1-1","lesson":"<the lesson of the ministry book this item tests, in English>","student":"<what the pupil wrote, short>","correct":"<the right answer, short>","mark":1,"max":1}],"total":0,"max":' + max + ',"note":"<ONE short sentence in simple Egyptian Arabic for the parents: what the pupil did well and what to practise at home>"}';
  }
  function parseJson(t) {
    t = String(t || ''); var a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b <= a) throw { code: 'empty' };
    var j = JSON.parse(t.slice(a, b + 1));
    var items = (j.items || []).map(function (x) { var mx = Math.max(0, +x.max || 0), mk = Math.max(0, Math.min(mx || 99, +x.mark || 0)); return { q: String(x.q || ''), lesson: String(x.lesson || '').trim(), student: String(x.student || ''), correct: String(x.correct || ''), mark: mk, max: mx }; });
    var total = items.length ? items.reduce(function (s, x) { return s + x.mark; }, 0) : +j.total || 0;
    return { name: String(j.name || '').trim(), items: items, total: Math.round(total * 2) / 2, max: +j.max || 0, note: String(j.note || '').trim() };
  }
  async function runGrading() {
    if (!G.exam || !G.kids.length || G.busy) return;
    if (!C.key()) { C.toast('هذه الخاصية تحتاج مفتاح القراءة. افتحي رابط التطبيق من زياد مرة واحدة.'); return; }
    var max = Math.max(1, parseInt($('gMax').value, 10) || 30), gk = C.gradeKey(G.exam.grade || C.Engine.lsGet('exam.hGrade')) || 'P4';
    var jobs = [];
    if (G.pairs) for (var i = 0; i < G.kids.length; i += 2) jobs.push(G.kids.slice(i, i + 2)); else G.kids.forEach(function (k) { jobs.push([k]); });
    G.busy = true; G.abort = typeof AbortController !== 'undefined' ? new AbortController() : null; G.max = max; paintGo();
    G.results = jobs.map(function (j) { return { thumb: j[0].thumb, status: 'wait', res: null, err: '' }; });
    $('gProgress').hidden = false; $('gResults').hidden = false; paintResults();
    var sys = gradeSystem(await C.askSystem(gk)), next = 0, done = 0;
    async function worker() {
      while (next < jobs.length) {
        var k = next++, j = jobs[k], r = G.results[k];
        r.status = 'busy'; paintResults();
        $('gProgress').textContent = 'جارٍ تصحيح ورقة ' + ar(done + 1) + ' من ' + ar(jobs.length) + '… اتركي الصفحة مفتوحة';
        try {
          var blobs = [], bands = j[0].bands; j.forEach(function (p) { blobs = blobs.concat(p.blobs); });
          var out = await C.Engine.generate(C.key(), gradePrompt(max, bands, j.length > 1), blobs, { best: true, effort: 'medium', maxTokens: 4000, system: sys, signal: G.abort ? G.abort.signal : undefined, onWait: function (s) { $('gProgress').textContent = 'الخدمة مزدحمة، هنستنى ' + ar(s) + ' ثانية ونكمل…'; } });
          r.res = parseJson(out.text); r.res.max = max; r.status = 'ok';
        } catch (e) {
          if (e && e.code === 'cancelled') { r.status = 'wait'; break; }
          r.status = 'err'; r.err = C.Engine.errText(e);
        }
        done++; paintResults();
      }
    }
    await Promise.all([worker(), worker()]);
    G.busy = false; paintGo(); paintResults();
    var bad = G.results.filter(function (r) { return r.status === 'err'; }).length;
    $('gProgress').textContent = bad ? '⚠️ ' + ar(bad) + ' ورقة لم تتصحح — اضغطي «حاولي تاني» جنبها.' : '✅ خلص التصحيح. راجعي الأسماء والدرجات، وبعدين «احفظي في كشف الدرجات».';
    G.jobs = jobs; saveLast();
  }
  async function retryOne(k) {
    if (G.busy || !G.jobs || !G.jobs[k]) return;
    G.busy = true; var r = G.results[k]; r.status = 'busy'; paintResults();
    try {
      var gk = C.gradeKey(G.exam.grade || C.Engine.lsGet('exam.hGrade')) || 'P4', blobs = []; G.jobs[k].forEach(function (p) { blobs = blobs.concat(p.blobs); });
      var out = await C.Engine.generate(C.key(), gradePrompt(G.max, G.jobs[k][0].bands, G.jobs[k].length > 1), blobs, { best: true, effort: 'medium', maxTokens: 4000, system: gradeSystem(await C.askSystem(gk)) });
      r.res = parseJson(out.text); r.res.max = G.max; r.status = 'ok';
    } catch (e) { r.status = 'err'; r.err = C.Engine.errText(e); }
    G.busy = false; paintResults(); saveLast();
  }
  function saveLast() { try { lsPut(LS_LAST, { exam: { id: G.exam.id, name: G.exam.name, grade: G.exam.grade }, max: G.max, at: Date.now(), results: (G.results || []).map(function (r) { return { status: r.status, res: r.res }; }) }); } catch (e) {} }
  function paintResults() {
    var rs = G.results || [];
    $('gList').innerHTML = rs.map(function (r, k) {
      if (r.status === 'wait' || r.status === 'busy') return '<div class="grow"><img src="' + r.thumb + '" alt=""><span class="gname muted">' + (r.status === 'busy' ? '⏳ بيتصحح…' : 'مستني دوره') + '</span></div>';
      if (r.status === 'err') return '<div class="grow bad"><img src="' + r.thumb + '" alt=""><span class="gname">⚠️ ' + esc(r.err) + '</span><button class="btn sm" type="button" data-gretry="' + k + '">حاولي تاني</button></div>';
      var x = r.res, pct = x.max ? Math.round(100 * x.total / x.max) : 0;
      return '<details class="grow ok"><summary><img src="' + r.thumb + '" alt=""><input class="gname" data-gname="' + k + '" value="' + esc(x.name) + '" placeholder="اسم الطالب" aria-label="اسم الطالب"><span class="gmark"><input data-gtot="' + k + '" inputmode="decimal" value="' + x.total + '" aria-label="الدرجة"> / ' + x.max + '</span><span class="gpct ' + (pct >= 85 ? 'hi' : pct < 50 ? 'lo' : '') + '">' + ar(pct) + '٪</span></summary>' +
        '<table class="gitems" dir="ltr"><thead><tr><th>Q</th><th>Pupil</th><th>Right answer</th><th>Mark</th></tr></thead><tbody>' + x.items.map(function (it, i) {
          return '<tr class="' + (it.mark >= it.max && it.max ? 'ok' : it.mark > 0 ? 'part' : 'no') + '"><td>' + esc(it.q) + '</td><td>' + esc(it.student) + '</td><td>' + esc(it.correct) + '</td><td><input data-gim="' + k + ':' + i + '" inputmode="decimal" value="' + it.mark + '"> / ' + it.max + '</td></tr>';
        }).join('') + '</tbody></table>' + (x.note ? '<p class="gnote">💬 ' + esc(x.note) + '</p>' : '') + '</details>';
    }).join('');
    var ok = rs.filter(function (r) { return r.status === 'ok'; });
    $('gSave').disabled = !ok.length || G.busy; $('gWeak').disabled = !ok.length || G.busy; $('gMsgs').disabled = !ok.length || G.busy;
    if (ok.length) {
      var avg = ok.reduce(function (s, r) { return s + r.res.total; }, 0) / ok.length;
      $('gSummary').textContent = 'متوسط الفصل ' + ar(Math.round(avg * 10) / 10) + ' من ' + ar(G.max) + ' (عدد الورق ' + ar(ok.length) + ')';
    } else $('gSummary').textContent = '';
  }
  function onResultEdit(e) {
    var t = e.target, rs = G.results || [];
    if (t.dataset.gname !== undefined) { var r = rs[+t.dataset.gname]; if (r && r.res) r.res.name = t.value; }
    else if (t.dataset.gtot !== undefined) { var r2 = rs[+t.dataset.gtot]; if (r2 && r2.res) { var v = parseFloat(t.value.replace(',', '.')); if (!isNaN(v)) r2.res.total = Math.max(0, Math.min(r2.res.max, v)); } }
    else if (t.dataset.gim !== undefined) {
      var ki = t.dataset.gim.split(':'), r3 = rs[+ki[0]], it = r3 && r3.res && r3.res.items[+ki[1]];
      if (it) { var v2 = parseFloat(t.value.replace(',', '.')); if (!isNaN(v2)) { it.mark = Math.max(0, Math.min(it.max || 99, v2)); r3.res.total = Math.round(r3.res.items.reduce(function (s, x) { return s + x.mark; }, 0) * 2) / 2; var tot = document.querySelector('[data-gtot="' + ki[0] + '"]'); if (tot) tot.value = r3.res.total; } }
    }
    saveLast();
  }
  /* the weak lessons of a set of results: share of the marks lost per lesson */
  function analyse(results) {
    var L = {};
    results.forEach(function (r) { if (!r || !r.items) return; r.items.forEach(function (it) { var k = it.lesson || 'Other'; L[k] = L[k] || { lesson: k, got: 0, max: 0, n: 0 }; L[k].got += it.mark; L[k].max += it.max; L[k].n++; }); });
    return Object.keys(L).map(function (k) { var x = L[k]; return { lesson: x.lesson, lost: x.max ? Math.round(100 * (1 - x.got / x.max)) : 0, items: x.n }; }).filter(function (x) { return x.items; }).sort(function (a, b) { return b.lost - a.lost; });
  }
  /* save the marks into the class (pupils matched by name, new names added) */
  function saveToClass() {
    var ok = (G.results || []).filter(function (r) { return r.status === 'ok'; }); if (!ok.length) return;
    var cs = classes(), cl = cs.filter(function (c) { return c.id === G.classId; })[0];
    if (!cl) {
      var nm = window.prompt('اسم الفصل (مثلاً: رابعة ١):', C.gradeAr(G.exam.grade || C.Engine.lsGet('exam.hGrade') || '') + ' ١'); if (!nm) return;
      cl = { id: uid(), name: nm.trim(), grade: G.exam.grade || C.Engine.lsGet('exam.hGrade') || '', students: [], tests: [] }; cs.push(cl); G.classId = cl.id;
    }
    var test = { id: uid(), title: G.exam.name, max: G.max, date: Date.now(), docId: G.exam.id, marks: {}, notes: {}, weak: analyse(ok.map(function (r) { return r.res; })) };
    ok.forEach(function (r, i) {
      var name = (r.res.name || '').trim() || ('طالب ' + ar(i + 1));
      var st = cl.students.filter(function (s) { return sameName(s.name, name); })[0];
      if (!st) { st = { id: uid(), name: name }; cl.students.push(st); }
      test.marks[st.id] = r.res.total; if (r.res.note) test.notes[st.id] = r.res.note;
    });
    cl.tests.push(test); saveClasses(cs);
    C.toast('✅ اتحفظت درجات ' + ar(ok.length) + ' طالب في «' + cl.name + '».');
    openMarks(cl.id);
  }

  /* ================= 2 · the marks book ================= */
  var M = { classId: '' };
  function openMarks(id) {
    C.show('marks');
    var cs = classes(); M.classId = id || M.classId || (cs[0] && cs[0].id) || '';
    paintMarks();
  }
  function curClass() { return classes().filter(function (c) { return c.id === M.classId; })[0]; }
  function paintMarks() {
    var cs = classes(), cl = curClass();
    $('mClasses').innerHTML = cs.map(function (c) { return '<button class="chip" type="button" data-mc="' + c.id + '" aria-pressed="' + (c.id === M.classId) + '">' + esc(c.name) + '</button>'; }).join('') + '<button class="chip" type="button" data-mc="new">➕ فصل جديد</button>';
    $('mEmpty').hidden = !!cl; $('mBox').hidden = !cl;
    if (!cl) return;
    var tests = cl.tests || [], studs = cl.students || [];
    var head = '<tr><th class="nm">الاسم</th>' + tests.map(function (t) { return '<th><span>' + esc(t.title) + '</span><small>من ' + ar(t.max) + '</small>' + (t.weak && t.weak.length ? '<button class="linkbtn" type="button" data-mweak="' + t.id + '">📊</button>' : '') + '</th>'; }).join('') + '<th>المجموع</th><th>٪</th></tr>';
    var maxAll = tests.reduce(function (s, t) { return s + (+t.max || 0); }, 0);
    var body = studs.map(function (s) {
      var tot = 0, has = false;
      var cells = tests.map(function (t) { var v = t.marks[s.id]; if (v != null && v !== '') { tot += +v; has = true; } return '<td><input inputmode="decimal" data-mm="' + s.id + ':' + t.id + '" value="' + (v == null ? '' : v) + '"></td>'; }).join('');
      var pct = maxAll && has ? Math.round(100 * tot / maxAll) : '';
      return '<tr><td class="nm"><input data-mn="' + s.id + '" value="' + esc(s.name) + '"></td>' + cells + '<td class="tot">' + (has ? Math.round(tot * 10) / 10 : '') + '</td><td class="pct ' + (pct === '' ? '' : pct >= 85 ? 'hi' : pct < 50 ? 'lo' : '') + '">' + (pct === '' ? '' : ar(pct) + '٪') + '</td></tr>';
    }).join('');
    var avgRow = tests.length && studs.length ? '<tr class="avg"><td class="nm">متوسط الفصل</td>' + tests.map(function (t) { var vs = studs.map(function (s) { return t.marks[s.id]; }).filter(function (v) { return v != null && v !== ''; }); return '<td>' + (vs.length ? ar(Math.round(10 * vs.reduce(function (a, b) { return a + +b; }, 0) / vs.length) / 10) : '') + '</td>'; }).join('') + '<td></td><td></td></tr>' : '';
    $('mTable').innerHTML = '<thead>' + head + '</thead><tbody>' + body + avgRow + '</tbody>';
    $('mTitle').textContent = cl.name + (cl.grade ? ' · ' + C.gradeAr(cl.grade) : '') + ' · ' + ar(studs.length) + ' طالب';
  }
  function editClass(fn) { var cs = classes(), cl = cs.filter(function (c) { return c.id === M.classId; })[0]; if (!cl) return; fn(cl, cs); saveClasses(cs); paintMarks(); }
  function newClassDlg(after) {
    $('ncName').value = ''; $('ncNames').value = ''; $('ncDlg').hidden = false; ncAfter = after || null;
    var g = C.gradeKey(C.Engine.lsGet('exam.hGrade')) || 'P4'; ncGrade = g; paintNcGrades();
    setTimeout(function () { $('ncName').focus(); }, 50);
  }
  var ncAfter = null, ncGrade = 'P4';
  function paintNcGrades() { $('ncGrades').innerHTML = ['P3', 'P4', 'P5', 'P6', 'Prep1'].map(function (k) { return '<button class="chip" type="button" data-ncg="' + k + '" aria-pressed="' + (k === ncGrade) + '">' + C.GRADE_AR[k] + '</button>'; }).join(''); }
  function makeClass() {
    var nm = ($('ncName').value || '').trim(); if (!nm) { $('ncName').focus(); return; }
    var names = ($('ncNames').value || '').split(/\n|،|,/).map(function (x) { return x.trim(); }).filter(Boolean);
    var EN = { P3: 'Primary 3', P4: 'Primary 4', P5: 'Primary 5', P6: 'Primary 6', Prep1: 'Prep 1' };
    var cl = { id: uid(), name: nm, grade: EN[ncGrade] || '', students: names.map(function (n) { return { id: uid(), name: n }; }), tests: [] };
    var cs = classes(); cs.push(cl); saveClasses(cs); $('ncDlg').hidden = true;
    if (ncAfter) { var f = ncAfter; ncAfter = null; f(cl); } else openMarks(cl.id);
  }
  /* Excel (.xlsx) built here: one sheet, right-to-left, names + marks + total + % */
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  async function excel() {
    var cl = curClass(); if (!cl || typeof JSZip === 'undefined') return;
    var tests = cl.tests || [], rows = [['الاسم'].concat(tests.map(function (t) { return t.title + ' (من ' + t.max + ')'; }), ['المجموع', 'النسبة ٪'])];
    var maxAll = tests.reduce(function (s, t) { return s + (+t.max || 0); }, 0);
    cl.students.forEach(function (s) {
      var tot = 0, has = false, r = [s.name];
      tests.forEach(function (t) { var v = t.marks[s.id]; if (v != null && v !== '') { r.push(+v); tot += +v; has = true; } else r.push(''); });
      r.push(has ? tot : ''); r.push(has && maxAll ? Math.round(100 * tot / maxAll) : ''); rows.push(r);
    });
    var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews><cols><col min="1" max="1" width="28" customWidth="1"/></cols><sheetData>' +
      rows.map(function (r, ri) { return '<row r="' + (ri + 1) + '">' + r.map(function (v, ci) { var ref = colName(ci) + (ri + 1); return v === '' ? '' : typeof v === 'number' ? '<c r="' + ref + '"><v>' + v + '</v></c>' : '<c r="' + ref + '" t="inlineStr"><is><t>' + xmlEsc(v) + '</t></is></c>'; }).join('') + '</row>'; }).join('') +
      '</sheetData></worksheet>';
    var z = new JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    z.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + xmlEsc(cl.name.slice(0, 30).replace(/[\\\/?*\[\]:]/g, '-')) + '" sheetId="1" r:id="rId1"/></sheets></workbook>');
    z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    z.file('xl/worksheets/sheet1.xml', sheet);
    C.Engine.download(await z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'كشف درجات ' + cl.name.replace(/[\\\/:*?"<>|]/g, '-') + '.xlsx');
  }
  function printMarks() {
    var cl = curClass(); if (!cl) return;
    var root = $('printRoot'); root.className = 'marksprint'; root.dir = 'rtl';
    var t = $('mTable').cloneNode(true);
    Array.prototype.forEach.call(t.querySelectorAll('input'), function (i) { var s = document.createElement('span'); s.textContent = i.value; i.replaceWith(s); });
    Array.prototype.forEach.call(t.querySelectorAll('button'), function (b) { b.remove(); });
    root.innerHTML = '<h2>كشف درجات ' + esc(cl.name) + '</h2><p>' + esc(teacherName()) + ' · ' + esc(new Date().toLocaleDateString('ar-EG')) + '</p>';
    root.appendChild(t);
    setTimeout(function () { try { window.print(); } catch (e) {} }, 60);
  }

  /* ================= 5 · messages to the parents ================= */
  function openMsgs(list, title) {
    $('msgTitle').textContent = '📤 رسائل لأولياء الأمور — ' + title;
    var tn = teacherName();
    G.msgs = list.map(function (x) { return { name: x.name, text: 'السلام عليكم ورحمة الله،\nنتيجة ' + x.name + ' في ' + title + ': ' + x.mark + ' من ' + x.max + '.' + (x.note ? '\n' + x.note : '') + '\nمع تحياتي، ' + tn }; });
    $('msgList').innerHTML = G.msgs.map(function (m, i) { return '<div class="msgrow"><span><b>' + esc(m.name) + '</b><small>' + esc(m.text.split('\n')[1] || '') + '</small></span><button class="btn sm go" type="button" data-wa="' + i + '">📤 واتساب</button></div>'; }).join('') || '<p class="small center">مفيش درجات لسه.</p>';
    $('msgDlg').hidden = false;
  }
  function msgsFromGrading() {
    var ok = (G.results || []).filter(function (r) { return r.status === 'ok'; });
    openMsgs(ok.map(function (r, i) { return { name: r.res.name || ('طالب ' + ar(i + 1)), mark: r.res.total, max: r.res.max, note: r.res.note }; }), G.exam ? G.exam.name : 'الامتحان');
  }
  function msgsFromClass(testId) {
    var cl = curClass(); if (!cl || !cl.tests.length) { C.toast('مفيش اختبارات في الفصل ده لسه.'); return; }
    var t = cl.tests.filter(function (x) { return x.id === testId; })[0] || cl.tests[cl.tests.length - 1];
    openMsgs(cl.students.filter(function (s) { return t.marks[s.id] != null && t.marks[s.id] !== ''; }).map(function (s) { return { name: s.name, mark: t.marks[s.id], max: t.max, note: (t.notes || {})[s.id] || '' }; }), t.title);
  }

  /* ================= 6 · weak lessons → remedial sheet ================= */
  function openWeak(weak, title, gradeTxt) {
    $('weakTitle').textContent = '📊 نقاط الضعف — ' + title;
    G.weakGrade = C.gradeKey(gradeTxt || (G.exam && G.exam.grade) || C.Engine.lsGet('exam.hGrade')) || 'P4';
    $('weakList').innerHTML = (weak || []).map(function (w, i) {
      return '<div class="weakrow"><div><b dir="ltr">' + esc(w.lesson) + '</b><span class="bar"><i style="width:' + Math.max(3, w.lost) + '%"></i></span><small>الفصل خسر ' + ar(w.lost) + '٪ من درجات الدرس ده</small></div>' + (w.lost >= 25 ? '<button class="btn sm" type="button" data-remedy="' + i + '">📝 ورقة علاج</button>' : '<span class="small">✅ كويس</span>') + '</div>';
    }).join('') || '<p class="small center">مفيش بيانات كفاية.</p>';
    G.weak = weak || [];
    $('weakDlg').hidden = false;
  }
  function remedy(i) {
    var w = G.weak[i]; if (!w) return; $('weakDlg').hidden = true;
    C.runAsk('ورقة علاج للطلاب اللي محتاجين مساعدة في درس «' + w.lesson + '»: شرح قصير وبسيط للقاعدة، ٣ أمثلة محلولة خطوة بخطوة، ثم ١٠ تمارين متدرجة من السهل للصعب (٤ اختر، ٤ أكمل، ٢ مسائل قصيرة) بأرقام سهلة.', G.weakGrade, true, { name: 'ورقة علاج — ' + w.lesson, lesson: w.lesson });
  }

  /* ================= 3 · lesson preparation from the ministry book ================= */
  var P = { grade: 'P4', term: '1', unit: '', lesson: '', kind: 'worksheet' };
  var PKINDS = [['worksheet', 'ورقة عمل', 'ورقة عمل على الدرس: ١٢ تمرين متدرج (٤ اختر، ٤ أكمل، ٤ أجب) من السهل للصعب.'],
    ['homework', 'واجب للبيت', 'واجب للبيت على الدرس: ٨ تمارين قصيرة تتحل في ربع ساعة، بأرقام مناسبة للسن.'],
    ['quiz', 'اختبار قصير (١٠ دقائق)', 'اختبار قصير ١٠ دقائق على الدرس من ١٠ درجات: ٥ اختر و٥ أكمل، بالدرجات جنب كل سؤال.'],
    ['revision', 'مراجعة قبل الامتحان', 'ورقة مراجعة شاملة على الدرس: القاعدة باختصار، ٢ أمثلة محلولة، ثم ١٥ تمرين متنوع (اختر، أكمل، صح وخطأ، مسائل).'],
    ['remedial', 'ورقة علاج للضعاف', 'ورقة علاج للطلاب الضعاف على الدرس: شرح بسيط جدًا للقاعدة، ٣ أمثلة محلولة خطوة بخطوة، ثم ١٠ تمارين سهلة متدرجة.']];
  async function openPlan() {
    P.grade = C.gradeKey(C.Engine.lsGet('exam.hGrade')) || P.grade; P.term = termNow(); P.lesson = ''; P.unit = '';
    $('planDlg').hidden = false; await paintPlan();
  }
  async function paintPlan() {
    var bank = await C.mathBank();
    $('plGrades').innerHTML = ['P3', 'P4', 'P5', 'P6', 'Prep1'].map(function (k) { return '<button class="chip" type="button" data-plg="' + k + '" aria-pressed="' + (k === P.grade) + '">' + C.GRADE_AR[k] + '</button>'; }).join('');
    $('plTerms').innerHTML = [['1', 'الترم الأول'], ['2', 'الترم التاني']].map(function (t) { return '<button class="chip" type="button" data-plt="' + t[0] + '" aria-pressed="' + (t[0] === P.term) + '">' + t[1] + '</button>'; }).join('');
    var G2 = bank && bank.grades && bank.grades[P.grade], units = G2 && G2.terms && G2.terms[P.term] || [];
    $('plLessons').innerHTML = units.map(function (u, ui) {
      return '<div class="plunit"><b dir="ltr">' + esc(u.unit) + '</b><div class="chips">' + (u.lessons && u.lessons.length ? u.lessons : [u.unit]).map(function (l) { return '<button class="chip" type="button" dir="ltr" data-pll="' + esc(l) + '" data-plu="' + esc(u.unit) + '" aria-pressed="' + (l === P.lesson) + '">' + esc(l) + '</button>'; }).join('') + '</div></div>';
    }).join('') || '<p class="small center">الدروس مش متاحة للصف ده. اكتبي اسم الدرس في «اكتبي طلبك».</p>';
    $('plKinds').innerHTML = PKINDS.map(function (k) { return '<button class="chip" type="button" data-plk="' + k[0] + '" aria-pressed="' + (k[0] === P.kind) + '">' + k[1] + '</button>'; }).join('');
    $('plGo').disabled = !P.lesson;
    $('plHint').textContent = P.lesson ? 'هيتعمل: ' + PKINDS.filter(function (k) { return k[0] === P.kind; })[0][1] + ' — درس «' + P.lesson + '»' : 'اختاري الدرس من القائمة.';
  }
  function runPlan() {
    if (!P.lesson) return;
    var k = PKINDS.filter(function (x) { return x[0] === P.kind; })[0];
    $('planDlg').hidden = true;
    C.runAsk(k[2] + ' الدرس: «' + P.lesson + '» من وحدة «' + P.unit + '» — منهج الوزارة للصف ' + C.GRADE_AR[P.grade] + '.', P.grade, $('plKey').checked, { name: k[1] + ' — ' + P.lesson, lesson: P.lesson });
  }

  /* ================= what's new (once) ================= */
  function whatsNew() {
    var box = $('newBox'); if (!box) return;
    if (C.Engine.lsGet('exam.seen57') === '1') { box.hidden = true; return; }
    box.hidden = false;
    $('newOk').onclick = function () { C.Engine.lsSet('exam.seen57', '1'); box.hidden = true; };
  }

  /* ================= wiring ================= */
  function init(ctx) {
    C = ctx;
    if (!$('grading')) return;
    whatsNew();
    $('tGradeBtn').addEventListener('click', openGrading);
    $('tMarksBtn').addEventListener('click', function () { openMarks(); });
    $('tPlanBtn').addEventListener('click', openPlan);
    /* grading */
    $('gExams').addEventListener('click', function (e) { var b = e.target.closest('[data-gx]'); if (!b) return; examDocs().then(function (l) { selectExam(b.dataset.gx, l); }); });
    $('gClass').addEventListener('click', function (e) {
      var b = e.target.closest('[data-gc]'); if (!b) return;
      if (b.dataset.gc === 'new') newClassDlg(function (cl) { G.classId = cl.id; C.show('grading'); paintClassPick(); });
      else { G.classId = b.dataset.gc; paintClassPick(); }
    });
    $('gCam').addEventListener('click', function () { $('gCamIn').click(); });
    $('gPick').addEventListener('click', function () { $('gFileIn').click(); });
    ['gCamIn', 'gFileIn'].forEach(function (id) { $(id).addEventListener('change', function () { var f = Array.prototype.slice.call(this.files || []); this.value = ''; if (f.length) addPhotos(f); }); });
    $('gThumbs').addEventListener('click', function (e) { var b = e.target.closest('[data-grm]'); if (!b || G.busy) return; G.kids.splice(+b.dataset.grm, 1); paintKids(); });
    $('gPairs').addEventListener('change', function () { G.pairs = this.checked; paintKids(); });
    $('gMax').addEventListener('input', paintGo);
    $('gGo').addEventListener('click', runGrading);
    $('gStop').addEventListener('click', function () { if (G.abort) G.abort.abort(); });
    $('gList').addEventListener('change', onResultEdit);
    $('gList').addEventListener('click', function (e) { var b = e.target.closest('[data-gretry]'); if (b) retryOne(+b.dataset.gretry); if (e.target.closest('input')) e.preventDefault(); });
    $('gSave').addEventListener('click', saveToClass);
    $('gWeak').addEventListener('click', function () { openWeak(analyse((G.results || []).filter(function (r) { return r.status === 'ok'; }).map(function (r) { return r.res; })), G.exam ? G.exam.name : '', G.exam && G.exam.grade); });
    $('gMsgs').addEventListener('click', msgsFromGrading);
    /* marks book */
    $('mClasses').addEventListener('click', function (e) { var b = e.target.closest('[data-mc]'); if (!b) return; if (b.dataset.mc === 'new') newClassDlg(); else { M.classId = b.dataset.mc; paintMarks(); } });
    $('mTable').addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.mm) { var p = t.dataset.mm.split(':'); editClass(function (cl) { var ts = cl.tests.filter(function (x) { return x.id === p[1]; })[0]; if (!ts) return; var v = parseFloat(String(t.value).replace(',', '.')); if (t.value === '' || isNaN(v)) delete ts.marks[p[0]]; else ts.marks[p[0]] = Math.max(0, Math.min(+ts.max || 999, v)); }); }
      else if (t.dataset.mn) editClass(function (cl) { var s = cl.students.filter(function (x) { return x.id === t.dataset.mn; })[0]; if (s) s.name = t.value.trim() || s.name; });
    });
    $('mTable').addEventListener('click', function (e) { var b = e.target.closest('[data-mweak]'); if (!b) return; var cl = curClass(), t = cl && cl.tests.filter(function (x) { return x.id === b.dataset.mweak; })[0]; if (t) openWeak(t.weak, t.title, cl.grade); });
    $('mAddStudent').addEventListener('click', function () { var n = window.prompt('اسم الطالب:'); if (n && n.trim()) editClass(function (cl) { cl.students.push({ id: uid(), name: n.trim() }); }); });
    $('mAddTest').addEventListener('click', function () {
      var t = window.prompt('اسم الاختبار (مثلاً: شهر أكتوبر):'); if (!t || !t.trim()) return;
      var mx = parseFloat(window.prompt('الدرجة النهائية للاختبار ده:', '15') || ''); if (!(mx > 0)) return;
      editClass(function (cl) { cl.tests.push({ id: uid(), title: t.trim(), max: mx, date: Date.now(), marks: {}, notes: {} }); });
    });
    $('mExcel').addEventListener('click', excel);
    $('mPrint').addEventListener('click', printMarks);
    $('mMsgs').addEventListener('click', function () { msgsFromClass(); });
    $('mRename').addEventListener('click', function () { var cl = curClass(); if (!cl) return; var n = window.prompt('اسم الفصل الجديد:', cl.name); if (n && n.trim()) editClass(function (c) { c.name = n.trim(); }); });
    $('mDelete').addEventListener('click', function () {
      var cl = curClass(); if (!cl || !window.confirm('حذف فصل «' + cl.name + '» وكل درجاته؟ مش هينفع ترجع.')) return;
      var cs = classes().filter(function (c) { return c.id !== cl.id; }); saveClasses(cs); M.classId = cs[0] ? cs[0].id : ''; paintMarks();
    });
    $('mNewFirst').addEventListener('click', function () { newClassDlg(); });
    /* new class dialog */
    $('ncGrades').addEventListener('click', function (e) { var b = e.target.closest('[data-ncg]'); if (!b) return; ncGrade = b.dataset.ncg; paintNcGrades(); });
    $('ncOk').addEventListener('click', makeClass);
    $('ncCancel').addEventListener('click', function () { $('ncDlg').hidden = true; ncAfter = null; });
    /* messages */
    $('msgList').addEventListener('click', function (e) { var b = e.target.closest('[data-wa]'); if (!b) return; var m = G.msgs[+b.dataset.wa]; if (m) { window.open('https://wa.me/?text=' + encodeURIComponent(m.text), '_blank'); b.textContent = '✅ اتبعتت'; b.classList.remove('go'); } });
    $('msgCopy').addEventListener('click', function () { var all = (G.msgs || []).map(function (m) { return m.text; }).join('\n\n———\n\n'); try { navigator.clipboard.writeText(all).then(function () { C.toast('✅ اتنسخت كل الرسائل.'); }); } catch (e) {} });
    $('msgClose').addEventListener('click', function () { $('msgDlg').hidden = true; });
    /* weak lessons */
    $('weakList').addEventListener('click', function (e) { var b = e.target.closest('[data-remedy]'); if (b) remedy(+b.dataset.remedy); });
    $('weakClose').addEventListener('click', function () { $('weakDlg').hidden = true; });
    /* lesson preparation */
    $('plGrades').addEventListener('click', function (e) { var b = e.target.closest('[data-plg]'); if (!b) return; P.grade = b.dataset.plg; P.lesson = ''; paintPlan(); });
    $('plTerms').addEventListener('click', function (e) { var b = e.target.closest('[data-plt]'); if (!b) return; P.term = b.dataset.plt; P.lesson = ''; paintPlan(); });
    $('plLessons').addEventListener('click', function (e) { var b = e.target.closest('[data-pll]'); if (!b) return; P.lesson = b.dataset.pll; P.unit = b.dataset.plu; paintPlan(); });
    $('plKinds').addEventListener('click', function (e) { var b = e.target.closest('[data-plk]'); if (!b) return; P.kind = b.dataset.plk; paintPlan(); });
    $('plGo').addEventListener('click', runPlan);
    $('plCancel').addEventListener('click', function () { $('planDlg').hidden = true; });
    /* teacher's name for the messages */
    if ($('hTeacher')) { $('hTeacher').value = teacherName(); $('hTeacher').addEventListener('change', function () { C.Engine.lsSet(LS_TEACHER, this.value.trim()); }); }
  }
  return { init: init, _normName: normName, _sameName: sameName, _parse: parseJson, _analyse: analyse };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Teacher;
