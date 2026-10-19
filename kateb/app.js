/* Screens: lock → start → work → done (review) or fail. One big action per screen.
   Reading: two independent reads per page; if they differ a third pass judges against the images;
   then Verify.guard marks anything the reads did not agree on, so the person checks it in the review screen. */
(function () {
  'use strict';
  var APP = window.APP || { mode: 'legal' }, EXAM = APP.mode === 'exam';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = null, pages = [], results = [], running = false;
  var DRAFT = 'kateb.draft.' + (EXAM ? 'exam' : 'legal');

  function show(id) {
    ['lock', 'nokey', 'start', 'work', 'done', 'fail'].forEach(function (s) { $(s).hidden = s !== id; });
    document.body.classList.toggle('wide', id === 'done');
    $('doubtBar').hidden = id !== 'done' || !marks().length;
    window.scrollTo(0, 0);
  }

  /* ---------- unlock ---------- */
  (function boot() {
    if (!window.crypto || !crypto.subtle) { $('nokeyMsg').textContent = 'افتح الرابط من متصفح كروم أو سفاري الحديث.'; $('linkForm').hidden = true; show('nokey'); return; }
    var blob = Engine.blobFromHash();
    /* a link with a key this device has not unlocked yet (a new key) always asks for the password and replaces the old key */
    if (blob && blob !== Engine.lsGet('kateb.blob')) { KEY = null; show('lock'); setTimeout(function () { $('pw').focus(); }, 50); return; }
    KEY = Engine.savedKey();
    if (KEY) { toStart(); return; }
    if (blob) { show('lock'); setTimeout(function () { $('pw').focus(); }, 50); return; }
    show('nokey');
  })();
  /* opened from the home-screen icon without a saved key (iPhone keeps a separate storage): paste the link once */
  $('linkForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var m = ($('linkIn').value || '').match(/k=([A-Za-z0-9_-]{40,})/);
    if (!m) { $('linkErr').hidden = false; return; }
    $('linkErr').hidden = true; history.replaceState(null, '', location.pathname + '#k=' + m[1]);
    show('lock'); setTimeout(function () { $('pw').focus(); }, 50);
  });
  $('lockForm').addEventListener('submit', async function (e) {
    e.preventDefault(); $('pwErr').hidden = true; $('pwBtn').disabled = true; $('pwBtn').textContent = 'جارٍ الفتح…';
    try { KEY = await Engine.unlock(Engine.blobFromHash(), $('pw').value.trim()); Engine.saveKey(KEY); Engine.lsSet('kateb.blob', Engine.blobFromHash()); Engine.lsSet('kateb.model', ''); CLAUDE = Engine.provider(KEY) === 'claude'; toStart(); }
    catch (err) { $('pwErr').hidden = false; $('pw').select(); }
    finally { $('pwBtn').disabled = false; $('pwBtn').textContent = 'دخول'; }
  });
  function toStart() {
    CLAUDE = Engine.provider(KEY) === 'claude';
    var b = $('providerBadge'); if (b) { b.textContent = Engine.provider(KEY) === 'claude' ? 'Claude' : 'Gemini'; b.hidden = false; }
    var d = loadDraft();
    $('resumeBtn').hidden = !d;
    if (d) $('resumeWhen').textContent = new Date(d.t).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
    show('start');
  }

  /* ---------- pick ---------- */
  $('pickBtn').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function () { var f = Array.prototype.slice.call(this.files || []); this.value = ''; if (f.length) start(f); });
  $('againBtn').addEventListener('click', toStart);
  $('retryBtn').addEventListener('click', function () { if (pages.length) run(); else toStart(); });
  $('homeBtn').addEventListener('click', toStart);
  $('resumeBtn').addEventListener('click', function () { var d = loadDraft(); if (!d) { toStart(); return; } results = d.pages; finish(true); });

  function setProgress(done, total, text) {
    $('stepText').textContent = text; $('barFill').style.width = Math.round(100 * done / Math.max(1, total)) + '%';
  }
  /* the three real stages of a page: prepare → read → judge (k from readPage's step callback) */
  function setStage(k) {
    Array.prototype.forEach.call(document.querySelectorAll('.stage'), function (el) {
      var i = +el.dataset.stage; el.classList.toggle('done', k > i || k === 'all'); el.classList.toggle('active', k === i);
    });
  }
  async function start(files) {
    files.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
    show('work'); setProgress(0, 1, 'جارٍ فتح الصور…'); setStage(0); $('waitText').hidden = true; $('thumbs').innerHTML = '';
    pages = [];
    try {
      for (var i = 0; i < files.length; i++) { var cs = await Engine.fileToCanvases(files[i]); cs.forEach(function (c) { pages.push({ base: c }); }); }
    } catch (e) { fail(e); return; }
    pages.forEach(function (p) { var im = document.createElement('img'); im.alt = ''; im.src = Engine.scaled(p.base, 200).toDataURL('image/jpeg', 0.7); $('thumbs').appendChild(im); });
    run();
  }
  function fail(e) { running = false; $('failMsg').textContent = Engine.errText(e); show('fail'); }

  function onWait(sec) { $('waitText').hidden = false; $('waitText').textContent = 'الخدمة مزدحمة، سننتظر ' + sec + ' ثانية ونكمل تلقائياً…'; }

  /* one page: both reads at once, rotation taken from the reads, then the judge with the formula bank of the
     detected paper type, Verify.guard marks what the reads did not agree on, Bank.snap fixes doubtful words
     that sit inside a known formula. */
  var CLAUDE = Engine.provider(KEY) === 'claude';
  function rotOf(t) { var m = /^\s*ROT:\s*(0|90|180|270)/.exec(t || ''); return m ? +m[1] : 0; }
  function stripRot(t) { return String(t || '').replace(/^\s*ROT:\s*\d+\s*\n?/, ''); }
  async function readTwice(imgs) {
    var pa = Engine.generate(KEY, PROMPTS.read(imgs.bands), imgs.blobs, { onWait: onWait, temperature: 0.1, effort: 'medium' });
    var pb = Engine.generate(KEY, PROMPTS.read2(imgs.bands), imgs.blobs, { onWait: onWait, temperature: 0.5, effort: 'medium' })
      .then(function (r) { return r.truncated ? null : Engine.clean(r.text); }, function (e) { if (e && (e.code === 'bad_key' || e.code === 'credit')) throw e; return null; });
    var ra = await pa, b = await pb;
    return { a: Engine.clean(ra.text), b: b };
  }
  /* the pages already read of the same paper: names, case numbers and dates must agree across pages */
  function caseContext() {
    var prev = results.map(function (r) { return r.text || ''; }).filter(Boolean);
    if (!prev.length) return '';
    var t = prev.join('\n----\n'); if (t.length > 6000) t = t.slice(-6000);
    return "\n\nEARLIER PAGES OF THE SAME PAPER (already transcribed; the same people, case number, court, dates and amounts recur — an unclear name or number on this page that matches one here is read the same way):\n" + t;
  }
  var TYPE_LABEL = { sihha: 'دعوى صحة توقيع', reannounce: 'إعادة إعلان', announce: 'إعلان بأصل الصحيفة', warning: 'إنذار', sahifa: 'صحيفة دعوى / استئناف', inherit_announce: 'إعلان في مادة الوراثة', inherit_request: 'طلب وراثة', sale: 'عقد بيع', gift: 'عقد هبة', price: 'إقرار سعر', iqrar: 'إقرار', memo: 'مذكرة' };
  async function readPage(p, label, step) {
    step(0, 'جارٍ تجهيز ' + label + '…');
    var side = CLAUDE ? 1568 : 3072;                       // Claude reads at 1568px; bigger only slows the upload
    p.canvas = p.base;
    var imgs = await Engine.pageImages(p.canvas, 3, side);
    step(1, 'جارٍ قراءة ' + label + ' (قراءتان معاً)…');
    var pair = await readTwice(imgs);
    var rot = rotOf(pair.a) || rotOf(pair.b);
    if (rot) { p.canvas = Engine.rotated(p.base, rot); imgs = await Engine.pageImages(p.canvas, 3, side); pair = await readTwice(imgs); }
    var a = stripRot(pair.a), b = pair.b ? stripRot(pair.b) : null;
    step(2, 'جارٍ مراجعة ' + label + ' مع الأصل والصيغ المعتادة…');
    var type = !EXAM && typeof Office !== 'undefined' ? Office.detect(a) : null;
    var bank = type && typeof Bank !== 'undefined' ? await Bank.load(type) : null;
    var system = (bank ? PROMPTS.bankSystem(TYPE_LABEL[type] || type, Bank.promptText(bank)) : '') + caseContext();
    system = system || undefined;
    var final = a, d = b ? Verify.disagreements(a, b) : null;
    try {
      if (b && !d.same) {
        var rj = await Engine.generate(KEY, PROMPTS.judge(imgs.bands, a, b, d), imgs.blobs, { onWait: onWait, system: system, effort: 'high', best: true });
        var tj = Engine.clean(rj.text); if (tj.length > Math.min(a.length, b.length) * 0.6 && !rj.truncated) final = tj;
      } else if (!b || (bank && a.indexOf('⟦') >= 0)) {
        /* one proofreading pass: second read failed, or both agree but doubts remain and the formulas may settle them */
        var rc = await Engine.generate(KEY, PROMPTS.check(imgs.bands, a), imgs.blobs, { onWait: onWait, system: system, effort: 'high', best: true });
        var tc = Engine.clean(rc.text); if (tc.length > a.length * 0.6 && !rc.truncated) final = tc;
      }
    } catch (e) { if (e && (e.code === 'bad_key' || e.code === 'credit')) throw e; }
    var g = Verify.guard(final, a, b || a, !EXAM), text = g.text, snapped = 0;
    if (bank) { var sn = Bank.snap(text, bank); text = sn.text; snapped = sn.fixed; }
    var r = await toResult(text);
    r.img = Engine.scaled(p.canvas, 1600).toDataURL('image/jpeg', 0.8);
    r.agree = d ? Math.round(d.agreement * 100) : null;
    r.text = text; r.type = type; r.snapped = snapped;
    return r;
  }

  async function run() {
    if (running) return; running = true; show('work'); results = [];
    var n = pages.length, S = 3;
    try {
      for (var i = 0; i < n; i++) {
        var label = n > 1 ? ('صفحة ' + (i + 1) + ' من ' + n) : 'الورقة';
        results.push(await readPage(pages[i], label, function (k, text) { setProgress(i * S + k, n * S, text); setStage(k); if (k) $('waitText').hidden = true; }));
      }
      setProgress(1, 1, 'تم'); setStage('all');
      finish();
    } catch (e) { fail(e); }
    running = false;
  }

  /* ---------- results → review ---------- */
  function escH(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function runsHtml(runs) {
    return (runs || []).map(function (r) {
      var h = r.frac ? '<span class="frac" contenteditable="false" data-n="' + escH(r.frac[0]) + '" data-d="' + escH(r.frac[1]) + '"><span>' + escH(r.frac[0]) + '</span><span>' + escH(r.frac[1]) + '</span></span>' : escH(r.text);
      if (r.u) h = '<u>' + h + '</u>'; if (r.b) h = '<b>' + h + '</b>'; if (r.hl) h = '<mark>' + h + '</mark>'; return h;
    }).join('');
  }
  function dirOf(t) { return /[A-Za-z]/.test(t) && !DocxBuilder.isRtlText(t) ? 'ltr' : 'rtl'; }
  function tableHtml(rows, attrs) {
    var cols = Math.max.apply(null, rows.map(function (x) { return x.length; }));
    return '<table' + (attrs || '') + '><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c, j) { var s = j === r.length - 1 ? cols - r.length + 1 : 1; return '<td' + (s > 1 ? ' colspan="' + s + '"' : '') + '>' + runsHtml(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }
  async function toResult(text) {
    if (!EXAM) return { html: DocxBuilder.parseMarkup(text).map(function (p) {
      if (p.table) return tableHtml(p.table, ' dir="' + dirOf(p.table.map(function (r) { return r.map(function (c) { return c.map(function (x) { return x.text; }).join(''); }).join(' '); }).join(' ')) + '"');
      var t = p.runs.map(function (r) { return r.text; }).join('');
      return '<p class="' + (p.heading ? 'h' : p.sub ? 'sub' : p.list ? 'li al-' + p.align : 'al-' + p.align) + '" dir="' + dirOf(t) + '">' + runsHtml(p.runs) + '</p>'; }).join('') };
    var parsed = ExamBuilder.parseExam(text);
    if (parsed.meta.grade && $('hGrade') && !results.length) { $('hGrade').value = parsed.meta.grade.replace(/^grade\s*/i, ''); Engine.lsSet('exam.hGrade', $('hGrade').value); }
    var html = '';
    for (var i = 0; i < parsed.blocks.length; i++) {
      var b = parsed.blocks[i];
      if (b.k === 'q') html += '<p data-k="q" class="q">' + runsHtml(b.runs) + '</p>';
      else if (b.k === 'item') html += '<p data-k="item" class="item">' + runsHtml(b.runs) + '</p>';
      else if (b.k === 'opt') html += '<div data-k="opt" class="opt">' + b.cells.map(function (c) { return '<span data-cell>' + runsHtml(c) + '</span>'; }).join('') + '</div>';
      else if (b.k === 'table') html += tableHtml(b.rows, ' data-k="table"');
      else if (b.k === 'gap') html += '<div data-k="gap" class="gap" contenteditable="false"></div>';
      else if (b.k === 'fig') { var f = b.svg ? await svgToPng(b.svg) : null;
        html += f ? '<figure data-k="fig" contenteditable="false" data-w="' + f.w + '" data-h="' + f.h + '" style="width:' + Math.min(f.w * 1.3, 420) + 'px"><img alt="" src="' + f.data + '"></figure>'
                  : '<p data-k="p" class="al-R"><mark>[ ارسمي الشكل هنا ]</mark></p>'; }
      else html += '<p data-k="p" class="' + (b.heading ? 'h' : 'al-' + (b.align || 'J')) + '">' + runsHtml(b.runs) + '</p>';
    }
    return { html: html };
  }

  function sheets() { return Array.prototype.slice.call(document.querySelectorAll('#pagesBox .sheet')); }
  function marks() { return Array.prototype.slice.call(document.querySelectorAll('#pagesBox .sheet mark')); }

  function finish(restored) {
    var box = $('pagesBox'), n = results.length;
    box.innerHTML = results.map(function (r, i) {
      return '<section class="pg" data-i="' + i + '">' + (n > 1 ? '<p class="pgno">صفحة ' + (i + 1) + ' من ' + n + '</p>' : '') +
        '<div class="pgrid' + (r.img ? '' : ' noimg') + '">' +
        (r.img ? '<button class="orig" type="button" aria-label="تكبير صورة الأصل"><img alt="الأصل" src="' + r.img + '"></button>' : '') +
        '<div class="sheet' + (EXAM ? ' exam' : '') + '" dir="' + (EXAM ? 'ltr' : 'rtl') + '" contenteditable="true" spellcheck="false">' + r.html + '</div></div></section>';
    }).join('');
    $('savedNote').hidden = true; cur = -1;
    $('restoredNote').hidden = !restored;
    refreshDoubts();
    show('done');
    if (!restored) saveDraft();
    setupTemplate();
  }

  /* ---------- office templates (legal page): the file comes out in the office's own layout ---------- */
  var TPL = !EXAM && typeof Office !== 'undefined' && !!$('tplBox'), TPLS = [], lawNakd = false;
  function allParas() { var out = []; sheets().forEach(function (s) { out = out.concat(sheetToParas(s)); }); return out; }
  function parasText(ps) { return ps.map(function (p) { return p.table ? '' : p.runs.map(function (r) { return r.text; }).join(''); }).join('\n'); }
  async function setupTemplate() {
    if (!TPL) return;
    try { TPLS = await Office.labels(); } catch (e) { $('tplBox').hidden = true; return; }
    var text = parasText(allParas()), key = Office.detect(text), law = Office.lawyerFrom(text), sel = $('tplSel');
    sel.innerHTML = '<option value="">عادي (بدون شكل المكتب)</option>' + TPLS.map(function (o) { return '<option value="' + o.key + '">' + escH(o.label) + '</option>'; }).join('');
    sel.value = key || '';
    $('lawName').value = law ? law.name : (Engine.lsGet('kateb.lawName') || '');
    $('lawTitle').value = law ? law.title : (Engine.lsGet('kateb.lawTitle') || 'المحامي');
    lawNakd = !!(law && law.nakd);
    tplHint(); $('tplBox').hidden = false;
  }
  function tplOf(key) { for (var i = 0; i < TPLS.length; i++) if (TPLS[i].key === key) return TPLS[i]; return null; }
  function tplHint() {
    var t = tplOf($('tplSel').value);
    $('lawName').closest('.tplrow2').hidden = !(t && t.stamp);
    $('tplHint').textContent = t ? 'سيخرج Word و PDF بنفس شكل «' + t.label + '» في أوراق المكتب: الخطوط والأحجام والهوامش' + (t.stamp ? ' والختم والزخرفة.' : '.') : 'ملف عادي بدون شكل المكتب.';
  }
  function lawyer() { return { name: $('lawName').value.trim(), title: $('lawTitle').value, nakd: lawNakd }; }
  if (TPL) {
    $('tplSel').addEventListener('change', tplHint);
    $('lawName').addEventListener('input', function () { Engine.lsSet('kateb.lawName', this.value.trim()); });
    $('lawTitle').addEventListener('change', function () { Engine.lsSet('kateb.lawTitle', this.value); });
  }
  function tplKey() { return TPL && !$('tplBox').hidden ? $('tplSel').value : ''; }

  /* ---------- review: walk the doubtful words one by one ---------- */
  var cur = -1, saveT = null;
  function refreshDoubts() {
    var n = marks().length;
    $('doubtNote').hidden = false;
    $('doubtNote').className = n ? 'note' : 'note ok';
    $('doubtNote').textContent = n
      ? 'راجع الكلام الأصفر (' + n + ') مع صورة الأصل: اضغط «التالي»، صحّح الكلمة لو فيها غلط، ثم اضغط «صحيح».'
      : 'تمت مراجعة كل الكلمات غير الواضحة. الملف جاهز.';
    $('doubtCount').textContent = n ? n + ' غير مؤكدة' : 'لا يوجد';
    $('doubtBar').hidden = !n || $('done').hidden;
  }
  function focusMark(m) {
    marks().forEach(function (x) { x.classList.remove('cur'); });
    if (!m) return;
    m.classList.add('cur');
    m.scrollIntoView({ block: 'center', behavior: 'smooth' });
    /* bring the same height of the original into view (the page photo and the text run top to bottom together) */
    var pg = m.closest('.pg'), orig = pg && pg.querySelector('.orig'), sheet = m.closest('.sheet');
    if (orig && sheet && orig.scrollHeight > orig.clientHeight) {
      var k = (m.offsetTop - sheet.offsetTop) / Math.max(1, sheet.scrollHeight);
      orig.scrollTop = Math.max(0, k * orig.scrollHeight - orig.clientHeight / 2);
    }
    var sel = window.getSelection(), rg = document.createRange(); rg.selectNodeContents(m); sel.removeAllRanges(); sel.addRange(rg);
  }
  function nextDoubt() { var ms = marks(); if (!ms.length) return; var c = ms.indexOf(document.querySelector('#pagesBox mark.cur')); cur = (c + 1) % ms.length; focusMark(ms[cur]); }
  function confirmMark(m) {
    var p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); p.normalize();
  }
  $('nextDoubt').addEventListener('click', nextDoubt);
  $('okDoubt').addEventListener('click', function () {
    var ms = marks(), m = document.querySelector('#pagesBox mark.cur') || ms[0]; if (!m) return;
    var i = ms.indexOf(m); confirmMark(m); refreshDoubts(); queueSave();
    ms = marks(); if (ms.length) focusMark(ms[Math.min(i, ms.length - 1)]);
  });
  $('okAllBtn').addEventListener('click', function () {
    var n = marks().length; if (!n) return;
    if (!window.confirm('هل راجعت كل الكلمات الصفراء (' + n + ') مع الأصل؟ سيتم إزالة اللون الأصفر منها كلها.')) return;
    marks().forEach(confirmMark); refreshDoubts(); queueSave();
  });
  $('pagesBox').addEventListener('click', function (e) {
    var m = e.target.closest && e.target.closest('mark'); if (m) { marks().forEach(function (x) { x.classList.toggle('cur', x === m); }); }
    var o = e.target.closest && e.target.closest('.orig'); if (o) { $('zoomImg').src = o.querySelector('img').src; $('zoom').hidden = false; $('zoomClose').focus(); }
  });
  $('pagesBox').addEventListener('input', function () { refreshDoubts(); queueSave(); });
  $('zoomClose').addEventListener('click', function () { $('zoom').hidden = true; });
  var zoomW = 100;
  function setZoom(w) { zoomW = Math.max(60, Math.min(400, w)); $('zoom').style.setProperty('--zw', zoomW + '%'); }
  if ($('zoomIn')) { $('zoomIn').addEventListener('click', function () { setZoom(zoomW * 1.25); }); $('zoomOut').addEventListener('click', function () { setZoom(zoomW / 1.25); }); }

  /* ---------- review view: side by side / text / original ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('.seg [data-view]'), function (b) {
    b.addEventListener('click', function () {
      $('pagesBox').dataset.view = b.dataset.view;
      Array.prototype.forEach.call(document.querySelectorAll('.seg [data-view]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      try { localStorage.setItem('kateb.view', b.dataset.view); } catch (e) {}
    });
  });
  (function () { var v = Engine.lsGet('kateb.view'), b = v && document.querySelector('.seg [data-view="' + v + '"]'); if (b) b.click(); })();

  /* ---------- drag & drop onto the start screen ---------- */
  (function () {
    var dz = $('dropZone'); if (!dz) return;
    var over = 0;
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
    dz.addEventListener('drop', function (e) {
      var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []).filter(function (f) { return /^image\//.test(f.type) || /\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(f.name); });
      if (files.length) start(files);
    });
    dz.addEventListener('click', function (e) { if (e.target === dz || e.target.closest('.ico,h3,.hint,.chips')) $('file').click(); });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) { e.preventDefault(); });
  })();

  /* ---------- light / dark ---------- */
  (function () {
    var b = $('themeBtn'); if (!b) return;
    b.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme') || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('kateb.theme', next); } catch (e) {}
      var m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = next === 'dark' ? '#0B1020' : m.dataset.light || m.content;
    });
  })();
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('zoom').hidden = true; });

  /* ---------- draft: survives a refresh or a closed tab on this device ---------- */
  function queueSave() { clearTimeout(saveT); saveT = setTimeout(saveDraft, 800); }
  function saveDraft() {
    var ps = sheets().map(function (s, i) { return { html: s.innerHTML.replace(/<mark class="cur">/g, '<mark>'), img: results[i] && results[i].img }; });
    if (!ps.length) return;
    try { localStorage.setItem(DRAFT, JSON.stringify({ t: Date.now(), pages: ps })); }
    catch (e) { try { localStorage.setItem(DRAFT, JSON.stringify({ t: Date.now(), pages: ps.map(function (p) { return { html: p.html }; }) })); } catch (e2) {} }
    ps.forEach(function (p, i) { if (results[i]) results[i].html = p.html; });
  }
  function loadDraft() { try { var d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); return d && d.pages && d.pages.length ? d : null; } catch (e) { return null; } }

  /* ---------- download ---------- */
  function stamp() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function examHeader() {
    var h = {}; ['hLine1', 'hLine2', 'hLine3', 'hSubject', 'hGrade', 'hTime', 'hTitle'].forEach(function (id) { h[id] = $(id) ? $(id).value : ''; });
    return { line1: h.hLine1, line2: h.hLine2, line3: h.hLine3, subject: h.hSubject, grade: h.hGrade, time: h.hTime, title: h.hTitle };
  }
  function baseName() { if (!EXAM) { var t = tplOf(tplKey()); return (t ? t.label.replace(/[\\\/:*?"<>|]/g, '-') : 'مستند') + ' ' + stamp(); } var h = examHeader(); return ((h.grade || '') + ' ' + (h.title || 'Exam')).replace(/[\\\/:*?"<>|]/g, '-').trim(); }
  function leftNote() { var n = marks().length; return n ? ' ما زال فيه ' + n + ' كلمة صفراء غير مؤكدة، وستظهر بالأصفر في الملف.' : ''; }

  $('wordBtn').addEventListener('click', async function () {
    var btn = this; btn.disabled = true;
    try {
      var blob, all = sheets();
      marks().forEach(function (m) { m.classList.remove('cur'); });
      if (!EXAM) {
        var paras = allParas(), key = tplKey();
        var zip = key ? await Office.build(JSZip, paras, key, { lawyer: lawyer() }) : DocxBuilder.build(JSZip, paras, { pageNumbers: true, title: 'مستند' });
        blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      } else {
        var blocks = []; all.forEach(function (s) { blocks = blocks.concat(domBlocks(s)); });
        blob = await ExamBuilder.build(JSZip, blocks, examHeader(), {}).generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      }
      Engine.download(blob, baseName() + '.docx');
      $('savedNote').hidden = false; $('savedNote').textContent = 'تم حفظ ملف Word في «التنزيلات».' + leftNote();
    } catch (e) { $('savedNote').hidden = false; $('savedNote').textContent = 'تعذر حفظ الملف. حاول مرة أخرى.'; }
    finally { btn.disabled = false; }
  });

  /* PDF: the browser's own print engine lays out Arabic perfectly; the person picks «Save as PDF». */
  $('pdfBtn').addEventListener('click', async function () {
    var root = $('printRoot'), h = EXAM ? examHeader() : null, key = tplKey();
    if (key) {
      try {
        marks().forEach(function (m) { m.classList.remove('cur'); });
        var ph = await Office.printHtml(allParas(), key, { lawyer: lawyer() });
        root.className = 'office'; root.dir = 'rtl'; root.innerHTML = ph.html;
        var st = $('tplPage') || document.head.appendChild(Object.assign(document.createElement('style'), { id: 'tplPage' }));
        st.textContent = ph.pageCss;
        printNow();
        return;
      } catch (e) { /* fall back to the plain layout below */ }
    }
    if ($('tplPage')) $('tplPage').textContent = '';
    marks().forEach(function (m) { m.classList.remove('cur'); });
    var head = h ? '<table class="xhead"><tbody>' + [[h.line1, 'Subject: ' + (h.subject || '')], [h.line2, 'Grade: ' + (h.grade || '')], [h.line3, 'Time: ' + (h.time || '')]].map(function (r) {
      return '<tr><td>' + escH(r[0] || '') + '</td><td>' + escH(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>' + (h.title ? '<p class="xtitle">' + escH(h.title) + '</p>' : '') : '';
    root.className = 'sheet doc' + (EXAM ? ' exam' : ''); root.dir = EXAM ? 'ltr' : 'rtl';
    root.innerHTML = head + sheets().map(function (s) { return s.innerHTML; }).join('');
    Array.prototype.forEach.call(root.querySelectorAll('[contenteditable]'), function (el) { el.removeAttribute('contenteditable'); });
    printNow();
  });
  function printNow(after) {
    var title = document.title; document.title = baseName();
    setTimeout(function () {
      try { window.print(); } catch (e) {}
      document.title = title; if (after) after();
      $('savedNote').hidden = false; $('savedNote').textContent = 'في نافذة الطباعة اختر «حفظ كملف PDF» (Save as PDF).' + leftNote();
    }, 60);
  }

  /* legal: edited sheet → blocks (paragraphs and tables) */
  function walkRuns(node) {
    var runs = [];
    (function walk(n, f) {
      n.childNodes.forEach(function (c) {
        if (c.nodeType === 3) { if (c.nodeValue) runs.push({ text: c.nodeValue.replace(/\n/g, ' '), b: f.b, u: f.u, hl: f.hl }); return; }
        if (c.nodeType !== 1 || c.tagName === 'BR') return;
        if (c.classList.contains('frac')) { runs.push({ frac: [c.dataset.n, c.dataset.d], text: c.dataset.n + '/' + c.dataset.d, b: f.b, u: f.u, hl: f.hl }); return; }
        var g = { b: f.b || c.tagName === 'B' || c.tagName === 'STRONG', u: f.u || c.tagName === 'U', hl: f.hl || c.tagName === 'MARK' };
        walk(c, g);
      });
    })(node, { b: false, u: false, hl: false });
    return runs;
  }
  function sheetToParas(root) {
    var out = [];
    (function each(parent) {
      Array.prototype.forEach.call(parent.children, function (b) {
        if (b.tagName === 'TABLE') { out.push({ table: Array.prototype.map.call(b.querySelectorAll('tr'), function (tr) { return Array.prototype.map.call(tr.children, walkRuns); }) }); return; }
        if (b.querySelector('p,div,table')) { each(b); return; }   // the editor sometimes wraps lines in an extra div
        var runs = walkRuns(b); if (!runs.map(function (r) { return r.text; }).join('').trim()) return;
        var c = b.className || '', al = 'J', h = false, sub = /\bsub\b/.test(c), li = /\bli\b/.test(c);
        if (/\bh\b/.test(c)) { al = 'C'; h = true; } else if (sub) al = 'R'; else { var m = c.match(/al-([CRLJ])/); if (m) al = m[1]; }
        out.push({ align: al, heading: h, sub: sub, list: li, runs: runs });
      });
    })(root);
    return out;
  }
  /* exam: edited sheet → blocks */
  function domBlocks(root) {
    var out = [];
    Array.prototype.forEach.call(root.children, function (el) {
      var k = el.dataset.k || (el.tagName === 'TABLE' ? 'table' : 'p');
      if (k === 'gap') { out.push({ k: 'gap', n: 3 }); return; }
      if (k === 'fig') { var im = el.querySelector('img'); if (im) out.push({ k: 'fig', data: im.src, w: +el.dataset.w || 300, h: +el.dataset.h || 200 }); return; }
      if (k === 'opt') { var cells = Array.prototype.map.call(el.querySelectorAll('[data-cell]'), walkRuns).filter(function (c) { return c.length; }); if (cells.length) out.push({ k: 'opt', cells: cells }); return; }
      if (k === 'table') { out.push({ k: 'table', rows: Array.prototype.map.call(el.querySelectorAll('tr'), function (tr) { return Array.prototype.map.call(tr.children, walkRuns); }) }); return; }
      var runs = walkRuns(el); if (!runs.map(function (r) { return r.text; }).join('').trim()) return;
      if (k === 'q' || k === 'item') { out.push({ k: k, runs: runs }); return; }
      var c = el.className || '', al = 'J', h = false; if (/\bh\b/.test(c)) { al = 'C'; h = true; } else { var m = c.match(/al-([CRLJ])/); if (m) al = m[1]; }
      out.push({ k: 'p', align: al, heading: h, runs: runs });
    });
    return out;
  }
  /* exam: clean SVG redraw → crisp PNG */
  function svgToPng(svg) {
    return new Promise(function (res) {
      try {
        svg = String(svg).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '').replace(/(href|xlink:href)="(?!#)[^"]*"/gi, '');
        if (!/^<svg[\s>]/i.test(svg.trim())) return res(null);
        if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        var vb = svg.match(/viewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/i);
        var w = vb ? +vb[3] : 240, h = vb ? +vb[4] : 160; if (!(w > 0 && h > 0)) return res(null);
        svg = svg.replace(/<svg([^>]*)>/i, function (m, at) { return '<svg' + at.replace(/\s(width|height)="[^"]*"/gi, '') + ' width="' + w + '" height="' + h + '">'; });
        var img = new Image();
        img.onload = function () { var k = 3, c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
          var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
          try { res({ data: c.toDataURL('image/png'), w: w, h: h }); } catch (e) { res(null); } };
        img.onerror = function () { res(null); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      } catch (e) { res(null); }
    });
  }
  /* ---------- installable app: home-screen icon, opens full screen ---------- */
  var installEvt = null;
  function standalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(function () {});
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; if (!standalone()) $('installBtn').hidden = false; });
  window.addEventListener('appinstalled', function () { installEvt = null; $('installBtn').hidden = true; });
  $('installBtn').addEventListener('click', async function () {
    if (!installEvt) return;
    installEvt.prompt();
    try { await installEvt.userChoice; } catch (e) {}
    installEvt = null; $('installBtn').hidden = true;
  });
  /* iPhone / iPad Safari has no install prompt: show the two taps instead */
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream && !standalone()) $('iosHint').hidden = false;

  window.__test = { finish: finish, toResult: toResult, setResults: function (r) { results = r; }, show: show, sheetToParas: sheetToParas, domBlocks: domBlocks, results: function () { return results; } };

  /* ---------- exam header fields (remembered on this device) ---------- */
  if (EXAM) ['hLine1', 'hLine2', 'hLine3', 'hSubject', 'hGrade', 'hTime', 'hTitle'].forEach(function (id) {
    var v = Engine.lsGet('exam.' + id); if (v !== null) $(id).value = v;
    $(id).addEventListener('input', function () { Engine.lsSet('exam.' + id, $(id).value); });
  });

  /* ---------- prompts ---------- */
  var LEGAL_FORMAT =
    "OUTPUT FORMAT (plain text, no code fences, no commentary):\n" +
    "- One paragraph per line, in reading order. Join lines that are one paragraph in the source into a single line.\n" +
    "- Start a line with [H] for a centered bold title, [S] for a bold side heading (e.g. «الوقائع», «الطلبات», «أولاً: …»), [C] for centered text, [L] for a block on the left side (e.g. a signature block in an Arabic paper), [R] for a short line on the right. Normal paragraphs get no tag.\n" +
    "- Numbered or bulleted items: one item per line starting with [N] followed by the item's own number or mark exactly as written (e.g. [N] ١- …, [N] (أ) …, [N] - …).\n" +
    "- Court papers and contracts: the document's name is [H] (e.g. [H] دعوى صحة توقيع, [H] إعادة إعلان في الدعوى, [H] عقد بيع ابتدائي) and a case-number line right under it is [H] too; centered phrases such as «وأعلنته بالآتي», «بناء عليه», «الموضوع», «لذلك», «موقع العقار …» are [C]; every person served or every party is its own line starting with its number (1. / 1- ) and with the name in **bold**; contract clauses start with their ordinal as written («أولاً :», «بند تمهيدي :»); the property table «موقع العقار» is a [TABLE]; keep «ولأجل العلم ،،» as its own line. Do not write decorative marks.\n" +
    "- A table or a ruled list in columns: one line [TABLE] cell | cell | cell || cell | cell | cell (| between cells, || between rows, first row = the header as written).\n" +
    "- **text** = bold, __text__ = underlined, as in the source. Use a TAB between two items on one line far apart (e.g. a name and the word بصفته).\n" +
    "- Wrap any word or number you are not fully sure of in ⟦ ⟧ like ⟦كلمة⟧; truly unreadable → ⟦؟⟧. Never silently guess names, numbers, dates or case numbers: mark them.\n" +
    "- Leave out: words crossed out or scribbled over (if they hid a name or field, write ........ in their place), stamps, seals, signatures, page numbers, handwritten court notes in the margins.\n" +
    "- Keep the source's spelling, punctuation and digit style (١٢٣ stays ١٢٣, 123 stays 123). Write each date or number with its digits in the order a typist would type them so it looks identical to the paper.\n" +
    "- Do not add, remove, summarize, translate or correct the wording.";
  var EXAM_FORMAT =
    "OUTPUT FORMAT (plain text lines, no code fences, no commentary):\n" +
    "GRADE: <grade>   (first line, only if the paper names the grade, e.g. GRADE: Primary 4)\n" +
    "[Q] Question (1) Choose the correct answer   (one line per section heading; number sections (1), (2), (3)… in order; standard wording: 'Choose the correct answer', 'Complete each of the following', 'Answer the following questions', or the section's own wording)\n" +
    "[I] **1)** <question text>   (each numbered question; restart at 1 in each section; blanks as __________)\n" +
    "[OPT] a) … | b) … | c) … | d) …   (the answer choices of the question above, on one line)\n" +
    "[TABLE] cell | cell || cell | cell   (tables and bar models; || separates rows; a shorter row's last cell spans the rest)\n" +
    "[FIG] <svg …>…</svg>   (any drawing, shape, diagram, number line, clock, grid or graph: REDRAW it as clean SVG on ONE line right after its question. viewBox about 120-320 wide, black strokes stroke-width=\"2\", fill=\"none\", true straight geometry, right-angle marks as small squares, heights dashed, keep proportions and orientation, every label as <text font-family=\"Times New Roman\" font-size=\"16\"> exactly as written and inside the viewBox. No scripts, images or links.)\n" +
    "[GAP]   (after each question in sections where students write a worked answer)\n" +
    "MATH: fractions as {3/4}; mixed numbers 2 {1/3}; powers with ² ³; symbols × ÷ − = %; keep units.\n" +
    "Wrap anything not fully sure in ⟦ ⟧ like ⟦28.8⟧. Never guess a number silently.\n" +
    "Fix English spelling, capitals and small grammar slips in the wording, but NEVER change a number, unit, answer choice or the mathematics.\n" +
    "Leave out crossed-out work, ticks, scores, page numbers and anything not part of the exam.";
  var ROT_NOTE = "FIRST LINE of your reply: ROT: 0 if the page reads upright, else ROT: 90 / 180 / 270 = degrees it must be turned clockwise to read upright (then still transcribe as well as you can). After that line, the transcription.\n";
  function stripsNote(bands) {
    return "Image 1 is the whole page. Images 2 to " + (bands + 1) + " are the same page cut into overlapping horizontal strips, top to bottom, at higher resolution: read the words from the strips and use image 1 for layout. Text in an overlap appears twice — write it once.\n\n";
  }
  var STRIPWISE = "Work strip by strip: read every line of image 2 slowly, letter shapes first, then image 3, and so on; then use image 1 to put the lines in order and rebuild the layout. Do not rely on what a sentence usually says: write what the ink shows.\n\n";
  function diffNote(d) {
    return "The two readings disagree on these words (reading 1 → " + (d.a.join(' · ') || '—') + ") (reading 2 → " + (d.b.join(' · ') || '—') + ").\n";
  }
  function bankSystem(label, lines) {
    return "You know the standard wording of Egyptian «" + label + "» papers exactly as this law office writes them. STANDARD FORMULAS of this paper type (names, numbers and places are replaced by {{NAME}}, # and {{PLACE}}):\n" + lines +
      "\n\nWhen a word is hard to read but its line clearly follows one of these formulas, read it as the formula says and do not mark it. Never do that for names, numbers, dates, case numbers, amounts, addresses or anything that varies from paper to paper: those come from the ink only, and stay in ⟦ ⟧ when unsure.";
  }
  var PROMPTS = EXAM ? {
    bankSystem: bankSystem,
    read: function (b) { return "You transcribe handwritten mathematics exam drafts written by a primary-school teacher into a clean exam.\n\n" + stripsNote(b) + "Transcribe every question and every answer choice on the page, in order.\n\n" + ROT_NOTE + EXAM_FORMAT; },
    read2: function (b) { return "You transcribe handwritten mathematics exam drafts written by a primary-school teacher into a clean exam.\n\n" + stripsNote(b) + STRIPWISE + "Transcribe every question and every answer choice on the page, in order. Check each digit twice.\n\n" + ROT_NOTE + EXAM_FORMAT; },
    check: function (b, d) { return "Proofread this transcription of the attached handwritten mathematics exam page against the images. " + stripsNote(b) + "Check every number, symbol, unit, fraction, answer choice and question, that nothing is missing or doubled, and that each [FIG] SVG matches its drawing. Remove ⟦ ⟧ from things you can now confirm; keep it on anything still uncertain. Keep exactly the same format.\n\n" + EXAM_FORMAT + "\n\nDRAFT:\n" + d + "\n\nReply with the full corrected transcription only."; },
    judge: function (b, r1, r2, d) { return "Two transcribers copied the attached handwritten mathematics exam page independently. " + stripsNote(b) + diffNote(d) + "For every disagreement look closely at the images and keep what the page really shows. Also re-check every number, fraction, unit and answer choice. Where the image still does not settle it, wrap it in ⟦ ⟧. Keep each [FIG] SVG from the reading whose drawing matches better.\n\n" + EXAM_FORMAT + "\n\nREADING 1:\n" + r1 + "\n\nREADING 2:\n" + r2 + "\n\nReply with the one correct full transcription only."; }
  } : {
    bankSystem: bankSystem,
    read: function (b) { return "You are the most careful transcriber of Arabic and English documents: messy handwriting, typed pages, photocopies, legal papers for Egyptian courts (صحة توقيع، إعلانات، إنذارات، عقود بيع وهبة، إقرارات، مذكرات).\n\n" + stripsNote(b) + "Transcribe the ENTIRE page word for word, exactly as written. These papers follow fixed legal formulas: for each unclear word use the sentence's meaning, the standard phrasing of this kind of paper, and how the same letters look elsewhere on the page; if still unsure, mark it. Names, numbers, dates and amounts are never guessed from context.\n\n" + ROT_NOTE + LEGAL_FORMAT; },
    read2: function (b) { return "You are the most careful transcriber of Arabic and English documents: messy handwriting, typed pages, photocopies, legal papers for Egyptian courts.\n\n" + stripsNote(b) + STRIPWISE + "Transcribe the ENTIRE page word for word. Names of people and places, numbers, dates and case numbers must be copied letter by letter; if any letter is unsure, mark the word.\n\n" + ROT_NOTE + LEGAL_FORMAT; },
    check: function (b, d) { return "You are proofreading a transcription of the attached page against the page itself. " + stripsNote(b) + "Go through the draft line by line and word by word against the images. Fix every misread word, missing or extra word, wrong number, date, name, digit order, bold/underline, and any skipped or doubled paragraph. Remove ⟦ ⟧ from words you can now confirm; keep or add ⟦ ⟧ on anything still uncertain. Keep the same format.\n\n" + LEGAL_FORMAT + "\n\nDRAFT TRANSCRIPTION:\n" + d + "\n\nReply with the full corrected transcription only."; },
    judge: function (b, r1, r2, d) { return "Two transcribers copied the attached page independently. You decide the final text. " + stripsNote(b) + diffNote(d) + "For every disagreement look closely at the ink in the images and keep what the page really shows — not what sounds better. Also check that no paragraph is missing or doubled and that the layout tags are right. Where the image still does not settle a word, wrap it in ⟦ ⟧.\n\n" + LEGAL_FORMAT + "\n\nREADING 1:\n" + r1 + "\n\nREADING 2:\n" + r2 + "\n\nReply with the one correct full transcription only."; }
  };
})();
