/* Screens: lock → start → work → done (review) or fail. One big action per screen.
   Reading: two independent reads per page; if they differ a third pass judges against the images;
   then Verify.guard marks anything the reads did not agree on, so the person checks it in the review screen. */
(function () {
  'use strict';
  var APP = window.APP || { mode: 'legal' }, EXAM = APP.mode === 'exam';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = null, pages = [], results = [], running = false;
  var MODE = EXAM ? 'exam' : 'legal', DRAFT = 'kateb.draft.' + MODE, LAST = 'kateb.lastDoc.' + MODE;
  var curDoc = null, reconvertDoc = null;                     // the document open in the review screen (Store record)

  /* KATEB15: screens form a stack so «رجوع» (and the phone's back button) returns to the previous screen with its
     state untouched; «start» is the root. */
  var SCREENS = ['lock', 'nokey', 'start', 'work', 'done', 'fail', 'files', 'trash', 'settings', 'learn'];
  var STACKED = ['start', 'done', 'files', 'trash', 'settings', 'learn'];
  var nav = [], curScreen = null, backing = false;
  function show(id, noPush) {
    if (id === 'start') nav = [];
    else if (!noPush && !backing && curScreen && curScreen !== id && STACKED.indexOf(curScreen) >= 0 && STACKED.indexOf(id) >= 0) {
      nav.push(curScreen);
      try { history.pushState({ k: id }, '', location.href); } catch (e) {}
    }
    curScreen = id;
    SCREENS.forEach(function (s) { if ($(s)) $(s).hidden = s !== id; });
    document.body.classList.toggle('wide', id === 'done');
    $('doubtBar').hidden = id !== 'done' || !marks().length;
    if ($('backBtn')) $('backBtn').hidden = ['start', 'lock', 'nokey', 'work'].indexOf(id) >= 0;
    window.scrollTo(0, 0);
  }
  function goBack() {
    if (running && curScreen === 'work') return;
    var prev = nav.pop() || 'start';
    if (prev === 'done' && !results.length) prev = 'start';
    backing = true;
    try {
      if (prev === 'start') toStart();
      else if (prev === 'files') renderFiles();
      else if (prev === 'trash') renderTrash();
      else if (prev === 'settings') renderSettings();
      else if (prev === 'learn') renderLearn();
      else show(prev, true);
    } finally { backing = false; }
  }
  /* «رجوع»: through the browser history when this screen was pushed there (so the phone's back button agrees), else directly */
  if ($('backBtn')) $('backBtn').addEventListener('click', function () {
    var st = null; try { st = history.state; } catch (e) {}
    if (nav.length && st && st.k === curScreen) history.back(); else goBack();
  });
  window.addEventListener('popstate', function () {
    if (running) { try { history.pushState({ k: curScreen }, '', location.href); } catch (e) {} return; }
    if (curScreen !== 'start') goBack();
  });

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
    var name = Engine.provider(KEY) === 'claude' ? 'Claude' : 'Gemini';
    var b = $('providerBadge'); if (b) { b.textContent = name; b.hidden = false; }
    var w = $('readerNote'); if (w) w.textContent = 'القارئ: ' + name + (name === 'Claude' ? ' (Opus 5.5 — قراءتان + مراجعة + فحص الأرقام)' : ' (المجاني — أبطأ)') + '. اترك الصفحة مفتوحة.';
    var d = loadDraft();
    $('resumeBtn').hidden = !d;
    if (d) $('resumeWhen').textContent = new Date(d.t).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
    show('start');
    homeCards();
  }
  /* the three cards under the camera: files count, learning state */
  function homeCards() {
    Store.listDocs(MODE).then(function (ds) { if ($('filesCount')) $('filesCount').textContent = ds.length ? ds.length + (ds.length === 1 ? ' ملف' : ' ملفات') : 'لا ملفات بعد'; }).catch(function () {});
    if ($('learnState')) $('learnState').textContent = learnOn() ? 'مفعّل — ' + profileLabel() : 'غير مفعّل';
    Store.getDoc(Engine.lsGet(LAST) || '').then(function (doc) {
      if (!doc || doc.deletedAt) return;
      $('resumeBtn').hidden = false; $('resumeWhen').textContent = doc.name;
    }).catch(function () {});
  }
  if ($('filesBtn')) $('filesBtn').addEventListener('click', renderFiles);
  if ($('learnBtn')) $('learnBtn').addEventListener('click', renderLearn);
  if ($('settingsBtn')) $('settingsBtn').addEventListener('click', renderSettings);

  /* ---------- pick ---------- */
  $('pickBtn').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function () { var f = Array.prototype.slice.call(this.files || []); this.value = ''; if (f.length) addFiles(f); });

  /* ---------- camera: one page per shot, cleaned, collected in a tray, read together ---------- */
  var shots = [], blur = [];
  function enhanceOn() { var c = $('enhanceChk'); return !c || c.checked; }
  function cleaned(c) { try { return enhanceOn() && typeof Scan !== 'undefined' ? Scan.clean(c) : c; } catch (e) { return c; } }
  var BLUR = 18;                                               // strongest-edge strength below this (crisp text ≈ 140, 2px blur ≈ 10): warn
  function sharp(c) { try { return typeof Scan !== 'undefined' ? Scan.sharpness(c) : 99; } catch (e) { return 99; } }
  /* photos and PDFs chosen from files: same tray, same single «تحويل» button (photos cleaned, PDF pages left as they are) */
  async function addFiles(files) {
    files.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
    try {
      for (var i = 0; i < files.length; i++) {
        var isPdf = files[i].type === 'application/pdf' || /\.pdf$/i.test(files[i].name), cs = await Engine.fileToCanvases(files[i]);
        cs.forEach(function (c) { shots.push(isPdf ? c : cleaned(c)); blur.push(isPdf ? false : sharp(c) < BLUR); });
      }
    } catch (e) { fail(e); return; }
    renderTray(); $('tray').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function renderTray() {
    var box = $('shots'); if (!box) return;
    box.innerHTML = shots.map(function (c, i) { return '<div class="shot' + (blur[i] ? ' blur' : '') + '"><img alt="صفحة ' + (i + 1) + '" src="' + Engine.scaled(c, 260).toDataURL('image/jpeg', 0.7) + '"><span class="n">' + (i + 1) + '</span>' + (blur[i] ? '<span class="warn">غير واضحة</span>' : '') + '<button class="x" type="button" data-rm="' + i + '" aria-label="حذف الصفحة">✕</button><button class="view" type="button" data-view="' + i + '" aria-label="عرض الصفحة بعد التحسين">🔍 عرض</button></div>'; }).join('');
    var nb = blur.filter(Boolean).length;
    $('trayCount').textContent = shots.length === 1 ? 'صفحة واحدة جاهزة' : shots.length + ' صفحات جاهزة';
    $('blurNote').hidden = !nb; $('blurNote').textContent = nb ? 'الصورة غير واضحة. من فضلك التقط صورة أوضح (الصفحة ' + blur.map(function (b, i) { return b ? i + 1 : null; }).filter(Boolean).join('، ') + '). يمكنك حذفها وتصويرها مرة أخرى.' : '';
    $('tray').hidden = !shots.length;
    $('goBtn').querySelector('span').textContent = '✨ تحويل إلى نص' + (shots.length > 1 ? ' (' + shots.length + ' صفحات)' : '');
  }
  if ($('camBtn')) {
    $('camBtn').addEventListener('click', function () { $('camFile').click(); });
    $('moreBtn').addEventListener('click', function () { $('camFile').click(); });
    $('camFile').addEventListener('change', async function () {
      var f = this.files && this.files[0]; this.value = ''; if (!f) return;
      try { var cs = await Engine.fileToCanvases(f); cs.forEach(function (c) { shots.push(cleaned(c)); blur.push(sharp(c) < BLUR); }); renderTray(); $('tray').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      catch (e) { fail(e); }
    });
    $('shots').addEventListener('click', function (e) {
      var v = e.target.closest('[data-view]') || e.target.closest('img');
      if (v) { var i = v.dataset.view !== undefined ? +v.dataset.view : +v.parentNode.querySelector('[data-view]').dataset.view; openScan(shots[i], i); return; }
      var b = e.target.closest('[data-rm]'); if (!b) return; shots.splice(+b.dataset.rm, 1); blur.splice(+b.dataset.rm, 1); renderTray();
    });
    if ($('clearTrayBtn')) $('clearTrayBtn').addEventListener('click', function () { if (!shots.length || window.confirm('حذف كل الصور من القائمة؟')) { shots = []; blur = []; renderTray(); } });
    $('goBtn').addEventListener('click', function () {
      if (!shots.length || running) return;
      if (blur.some(Boolean) && !window.confirm('فيه صورة غير واضحة وقد تُقرأ بأخطاء. هل تريد المتابعة؟')) return;
      startCanvases(shots.slice()); shots = []; blur = []; renderTray();
    });
  }
  function startCanvases(cs) {
    show('work'); setProgress(0, 1, 'جارٍ تجهيز الصفحات…'); setStage(0); $('waitText').hidden = true; $('thumbs').innerHTML = '';
    if ($('cancelBtn')) $('cancelBtn').hidden = false;
    pages = cs.map(function (c) { return { base: c }; });
    pages.forEach(function (p) { var im = document.createElement('img'); im.alt = ''; im.src = Engine.scaled(p.base, 200).toDataURL('image/jpeg', 0.7); $('thumbs').appendChild(im); });
    run();
  }
  $('againBtn').addEventListener('click', toStart);
  $('retryBtn').addEventListener('click', function () { if (pages.length) run(); else toStart(); });
  $('homeBtn').addEventListener('click', toStart);
  $('resumeBtn').addEventListener('click', function () {
    Store.getDoc(Engine.lsGet(LAST) || '').then(function (doc) {
      if (doc && !doc.deletedAt) { openDoc(doc); return; }
      var d = loadDraft(); if (!d) { toStart(); return; } curDoc = null; results = d.pages; finish(true);
    }).catch(function () { var d = loadDraft(); if (!d) { toStart(); return; } curDoc = null; results = d.pages; finish(true); });
  });
  function openDoc(doc) {
    curDoc = doc; results = doc.pages.map(function (p) { return { html: p.html, img: p.img, text: p.text, type: doc.type }; });
    usedModels = {}; finish(true);
  }

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
      for (var i = 0; i < files.length; i++) {
        var isPdf = files[i].type === 'application/pdf' || /\.pdf$/i.test(files[i].name), cs = await Engine.fileToCanvases(files[i]);
        cs.forEach(function (c) { pages.push({ base: isPdf ? c : cleaned(c) }); });   // photos are cleaned, PDF pages are already clean
      }
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
  async function readTwice(imgs, system) {
    var pa = Engine.generate(KEY, PROMPTS.read(imgs.bands), imgs.blobs, { onWait: onWait, signal: sig(), temperature: 0.1, effort: 'medium', best: true, system: system });
    var pb = Engine.generate(KEY, PROMPTS.read2(imgs.bands), imgs.blobs, { onWait: onWait, signal: sig(), temperature: 0.5, effort: 'medium', best: true, system: system })
      .then(function (r) { if (r.model) usedModels[r.model] = 1; return r.truncated ? null : Engine.clean(r.text); }, function (e) { if (e && (e.code === 'bad_key' || e.code === 'credit')) throw e; return null; });
    var ra = await pa, b = await pb;
    if (ra.model) usedModels[ra.model] = 1;
    return { a: Engine.clean(ra.text), b: b };
  }
  /* the pages already read of the same paper: names, case numbers and dates must agree across pages */
  function caseContext() {
    var prev = results.map(function (r) { return r.text || ''; }).filter(Boolean);
    if (!prev.length) return '';
    var t = prev.join('\n----\n'); if (t.length > 6000) t = t.slice(-6000);
    return "\n\nEARLIER PAGES OF THE SAME PAPER (already transcribed; the same people, case number, court, dates and amounts recur — an unclear name or number on this page that matches one here is read the same way):\n" + t;
  }
  var usedModels = {};
  var TYPE_LABEL = { sihha: 'دعوى صحة توقيع', reannounce: 'إعادة إعلان', announce: 'إعلان بأصل الصحيفة', warning: 'إنذار', sahifa: 'صحيفة دعوى / استئناف', inherit_announce: 'إعلان في مادة الوراثة', inherit_request: 'طلب وراثة', sale: 'عقد بيع', gift: 'عقد هبة', price: 'إقرار سعر', iqrar: 'إقرار', memo: 'مذكرة' };
  async function readPage(p, label, step) {
    step(0, 'جارٍ تجهيز ' + label + '…');
    var side = CLAUDE ? 1568 : 3072;                       // Claude reads at 1568px; bigger only slows the upload
    p.canvas = p.base;
    var bands = CLAUDE ? 5 : 3;                           // more strips = more pixels per line of handwriting
    var imgs = await Engine.pageImages(p.canvas, bands, side);
    /* a quick look at the title tells the paper type, so both full reads get the office's formulas for it */
    var type = null, bank = null;
    if (!EXAM && CLAUDE && typeof Office !== 'undefined') {
      try {
        var k = await Engine.generate(KEY, PROMPTS.kind(), [imgs.blobs[0]], { fast: true, signal: sig(), effort: 'low', maxTokens: 120 });
        type = Office.detect('[H] ' + Engine.clean(k.text).split('\n')[0]);
      } catch (e) { if (e && (e.code === 'bad_key' || e.code === 'credit')) throw e; }
    }
    if (type && typeof Bank !== 'undefined') bank = await Bank.load(type);
    var system = (bank ? PROMPTS.bankSystem(TYPE_LABEL[type] || type, Bank.promptText(bank, 400)) : '') + caseContext() + learnPrompt();
    system = system || undefined;
    step(1, 'جارٍ قراءة ' + label + ' (قراءتان معاً' + (bank ? ' بصيغ «' + (TYPE_LABEL[type] || type) + '»' : '') + ')…');
    var pair = await readTwice(imgs, system);
    var rot = rotOf(pair.a) || rotOf(pair.b);
    if (rot) { p.canvas = Engine.rotated(p.base, rot); imgs = await Engine.pageImages(p.canvas, bands, side); pair = await readTwice(imgs, system); }
    var a = stripRot(pair.a), b = pair.b ? stripRot(pair.b) : null;
    step(2, 'جارٍ مراجعة ' + label + ' مع الأصل والصيغ المعتادة…');
    if (!type && !EXAM && typeof Office !== 'undefined') {
      type = Office.detect(a);
      if (type && typeof Bank !== 'undefined') { bank = await Bank.load(type); system = ((bank ? PROMPTS.bankSystem(TYPE_LABEL[type] || type, Bank.promptText(bank, 400)) : '') + caseContext() + learnPrompt()) || undefined; }
    }
    var final = a, d = b ? Verify.disagreements(a, b) : null;
    /* the numbers pass runs beside the judge: every number, date and amount read once more on its own */
    var numbersP = Engine.generate(KEY, PROMPTS.numbers(imgs.bands), imgs.blobs, { onWait: onWait, signal: sig(), effort: 'high', best: true, maxTokens: 2048, system: system })
      .then(function (r) { if (r.model) usedModels[r.model] = 1; return Engine.clean(r.text); }, function (e) { if (e && (e.code === 'bad_key' || e.code === 'credit')) throw e; return null; });
    try {
      if (b && !d.same) {
        var rj = await Engine.generate(KEY, PROMPTS.judge(imgs.bands, a, b, d), imgs.blobs, { onWait: onWait, signal: sig(), system: system, effort: 'high', best: true });
        if (rj.model) usedModels[rj.model] = 1;
        var tj = Engine.clean(rj.text); if (tj.length > Math.min(a.length, b.length) * 0.6 && !rj.truncated) final = tj;
      } else if (!b || (bank && a.indexOf('⟦') >= 0)) {
        /* one proofreading pass: second read failed, or both agree but doubts remain and the formulas may settle them */
        var rc = await Engine.generate(KEY, PROMPTS.check(imgs.bands, a), imgs.blobs, { onWait: onWait, signal: sig(), system: system, effort: 'high', best: true });
        var tc = Engine.clean(rc.text); if (tc.length > a.length * 0.6 && !rc.truncated) final = tc;
      }
    } catch (e) { if (e && (e.code === 'bad_key' || e.code === 'credit')) throw e; }
    var learned = 0;
    if (learnOn() && learnItems.length) {
      /* this hand's own words: a doubt the model kept on a word the family already confirmed is lifted (the guard
         below still marks it when the two reads disagree); a word corrected the same way twice before is swapped */
      var lf = Learn.applyFixes(final, learnItems, profile()), ll = Learn.applyLexicon(lf.text, learnItems, profile());
      final = ll.text; learned = lf.fixed + ll.cleared;
    }
    var g = Verify.guard(final, a, b || a, !EXAM), text = g.text, snapped = 0;
    var numbers = await numbersP;
    if (numbers) { var nc = Verify.checkNumbers(text, numbers); text = nc.text; }
    if (!EXAM) {
      text = Verify.houseDigits(text);                          // the office types 10/1/2020, never ١٠/١/٢٠٢٠
      if (typeof Arabic !== 'undefined') {
        text = Arabic.check(text).text;                         // amount in words = digits; weekday = date
        var dict = typeof Bank !== 'undefined' ? await Bank.load('spelling') : null;
        if (dict) text = Arabic.spell(text, dict).text;         // the office's spelling of every word (دعوى، محكمة، الأهلية…)
      }
    }
    if (bank) { var sn = Bank.snap(text, bank); text = sn.text; snapped = sn.fixed; }
    var r = await toResult(text);
    r.img = Engine.scaled(p.canvas, 1600).toDataURL('image/jpeg', 0.8);
    r.agree = d ? Math.round(d.agreement * 100) : null;
    r.text = text; r.type = type; r.snapped = snapped; r.learned = learned;
    return r;
  }

  var runAbort = null, docCost = 0;
  function sig() { return runAbort ? runAbort.signal : undefined; }
  Engine.onUsage(function (m, rec, cost) { docCost += cost; });
  if ($('cancelBtn')) $('cancelBtn').addEventListener('click', function () {
    if (!running || !runAbort) return;
    if (!window.confirm('إلغاء القراءة والرجوع للبداية؟ الصور لن تُحفظ.')) return;
    runAbort.abort();
  });
  async function run() {
    if (running) return; running = true; show('work'); results = []; usedModels = {}; docCost = 0;
    runAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    try { learnItems = learnOn() ? await loadLearn() : []; } catch (e) { learnItems = []; }
    var n = pages.length, S = 3;
    try {
      for (var i = 0; i < n; i++) {
        var label = n > 1 ? ('صفحة ' + (i + 1) + ' من ' + n) : 'الورقة';
        results.push(await readPage(pages[i], label, function (k, text) { setProgress(i * S + k, n * S, text); setStage(k); if (k) $('waitText').hidden = true; }));
      }
      setProgress(1, 1, 'تم'); setStage('all');
      finish();
    } catch (e) {
      if ((e && e.code === 'cancelled') || (runAbort && runAbort.signal.aborted)) { running = false; reconvertDoc = null; pages = []; results = []; toStart(); return; }
      fail(e);
    }
    running = false;
  }

  /* ---------- results → review ---------- */
  function escH(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function shown(t) { return EXAM ? t : Verify.rtlDates(Verify.arabicDigits(t)); }      // the office's papers show ٠-٩ (Word: Numeral = Context), dates read from the right
  function runsHtml(runs) {
    return (runs || []).map(function (r) {
      var h = r.frac ? '<span class="frac" contenteditable="false" data-n="' + escH(r.frac[0]) + '" data-d="' + escH(r.frac[1]) + '"><span>' + escH(r.frac[0]) + '</span><span>' + escH(r.frac[1]) + '</span></span>' : escH(shown(r.text));
      if (r.u) h = '<u>' + h + '</u>'; if (r.b) h = '<b>' + h + '</b>'; if (r.hl) h = '<mark data-o="' + escH(r.text) + '">' + h + '</mark>'; return h;
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
    var ri = $('readerInfo'), ms = Object.keys(usedModels), nl = results.reduce(function (t, r) { return t + (r.learned || 0); }, 0);
    var cost = restored ? (curDoc && curDoc.cost) || 0 : docCost;
    if (ri) { ri.hidden = !ms.length && !cost; ri.textContent = (ms.length ? 'قُرئت الصفحات فعلياً بـ: ' + ms.join(' + ') : 'محفوظ على هذا الجهاز') + (nl ? ' — ' + nl + ' كلمة عُرفت من خط ' + profileLabel() : '') + (cost ? ' — تكلفة القراءة ≈ $' + cost.toFixed(2) : ''); }
    if (!restored) {
      var ps = results.map(function (r) { return { html: r.html, img: r.img, text: r.text }; });
      if (reconvertDoc) { curDoc = reconvertDoc; reconvertDoc = null; Store.addVersion(curDoc, ps, 'reread'); curDoc.pages = ps; curDoc.learned = []; }
      else curDoc = Store.newDoc(MODE, autoName(), ps, { type: results[0] && results[0].type || null });
      curDoc.cost = (curDoc.cost || 0) + docCost; curDoc.kindOk = false; curDoc.nameAuto = curDoc.name;
    }
    kindLabel();
    if ($('docName')) $('docName').value = curDoc ? curDoc.name : '';
    if ($('versionsPanel')) $('versionsPanel').hidden = true;
    if ($('learnHint')) $('learnHint').hidden = learnOn() || Engine.lsGet('kateb.learnHint') === '1';
    histReset();
    refreshDoubts();
    show('done');
    if (!restored) saveDraft(); else setSave(curDoc ? 'ok' : '');
    setupTemplate();
  }
  /* the office's own file naming: «صحة توقيع سمير رزق», «إعادة إعلان نجوى لطفى», «عقد بيع باسم مكرم» */
  var FILE_LABEL = { sihha: 'صحة توقيع', reannounce: 'إعادة إعلان', announce: 'إعلان بأصل الصحيفة', warning: 'إنذار', sahifa: 'صحيفة دعوى', inherit_announce: 'إعلان وراثة', inherit_request: 'طلب وراثة', sale: 'عقد بيع', gift: 'عقد هبة', price: 'إقرار سعر', iqrar: 'إقرار', memo: 'مذكرة' };
  function autoName(type) {
    var when = new Date().toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
    if (EXAM) return ((Engine.lsGet('exam.hGrade') || 'امتحان') + ' ' + (Engine.lsGet('exam.hTitle') || '')).trim() + ' — ' + when;
    var t = type !== undefined ? type : (results[0] && results[0].type), text = results.map(function (r) { return r.text || htmlText(r.html || ''); }).join('\n');
    var who = typeof Office !== 'undefined' ? Office.partyName(text) : '';
    return (FILE_LABEL[t] || TYPE_LABEL[t] || 'مستند') + (who ? ' ' + who : ' — ' + when);
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
    tplHint(); $('tplBox').hidden = false; kindLabel();
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
    var low = results.some(function (r) { return r.agree !== null && r.agree !== undefined && r.agree < 55; });
    $('doubtNote').textContent = (n
      ? 'راجع الكلام الأصفر (' + n + ') مع صورة الأصل: اضغط «التالي»، صحّح الكلمة لو فيها غلط، ثم اضغط «صحيح».'
      : 'لا توجد كلمات مشكوك فيها. راجع النص مع الصورة مرة قبل الحفظ.')
      + (low ? ' ⚠️ القراءتان اختلفتا كثيراً في هذه الورقة: الصورة قد تكون غير واضحة، راجع بعناية أو صوّرها مرة أخرى.' : '');
    $('doubtNote').className = n || low ? 'note' : 'note ok';
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
    var i = ms.indexOf(m); learnConfirm(m); confirmMark(m); refreshDoubts(); histCommit(); queueSave();
    ms = marks(); if (ms.length) focusMark(ms[Math.min(i, ms.length - 1)]);
  });
  $('okAllBtn').addEventListener('click', function () {
    var n = marks().length; if (!n) return;
    if (!window.confirm('هل راجعت كل الكلمات الصفراء (' + n + ') مع الأصل؟ سيتم إزالة اللون الأصفر منها كلها.')) return;
    marks().forEach(function (m) { learnConfirm(m); confirmMark(m); }); refreshDoubts(); histCommit(); queueSave();
  });
  $('pagesBox').addEventListener('click', function (e) {
    var m = e.target.closest && e.target.closest('mark'); if (m) { marks().forEach(function (x) { x.classList.toggle('cur', x === m); }); }
    var o = e.target.closest && e.target.closest('.orig'); if (o) { zoomCanvas = null; zoomName = 'الأصل ' + stamp() + '.jpg'; $('zoomImg').src = o.querySelector('img').src; $('zoom').hidden = false; if ($('zoomSave')) $('zoomSave').hidden = false; $('zoomClose').focus(); }
  });
  $('pagesBox').addEventListener('input', function () { refreshDoubts(); histQueue(); queueSave(); });
  /* the keyboard's own undo (Ctrl+Z, or the phone keyboard's undo) goes through the app's history */
  $('pagesBox').addEventListener('beforeinput', function (e) {
    if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); } else if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); }
  });
  /* on screen the paper shows ٠-٩ like the office's Word does; the file keeps 0-9 inside (walkRuns converts) */
  if (!EXAM) $('pagesBox').addEventListener('beforeinput', function (e) {
    if (e.inputType !== 'insertText' || !e.data) return;
    if (e.data === '/') {
      var sel = window.getSelection(), nd = sel && sel.anchorNode, before = nd && nd.nodeType === 3 ? nd.nodeValue.slice(0, sel.anchorOffset) : '';
      if (/[0-9٠-٩]$/.test(before)) { e.preventDefault(); document.execCommand('insertText', false, '\u200F/\u200F'); }
      return;
    }
    if (!/^[0-9۰-۹]$/.test(e.data)) return;
    e.preventDefault();
    document.execCommand('insertText', false, Verify.arabicDigits(Verify.west(e.data)));
  });
  $('zoomClose').addEventListener('click', function () { $('zoom').hidden = true; });
  /* a cleaned page from the tray, or the original photo of a reviewed page: full size, downloadable as JPG */
  var zoomCanvas = null, zoomName = '';
  function openScan(c, i) {
    zoomCanvas = c; zoomName = 'صفحة ' + (i + 1) + ' ' + stamp() + '.jpg';
    $('zoomImg').src = c.toDataURL('image/jpeg', 0.92); $('zoom').hidden = false; if ($('zoomSave')) $('zoomSave').hidden = false; $('zoomClose').focus();
  }
  if ($('zoomSave')) $('zoomSave').addEventListener('click', function () {
    var src = zoomCanvas ? zoomCanvas.toDataURL('image/jpeg', 0.92) : $('zoomImg').src; if (!src) return;
    try { var bin = atob(src.split(',')[1]), arr = new Uint8Array(bin.length); for (var k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k); Engine.download(new Blob([arr], { type: 'image/jpeg' }), zoomName || ('الأصل ' + stamp() + '.jpg')); } catch (e) {}
  });
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
      if (files.length) addFiles(files);
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
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') $('zoom').hidden = true;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && curScreen === 'done' && !$('done').hidden) {
      var k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    }
  });

  /* ---------- undo / redo: snapshots of the pages' text (typing pauses, confirmations, restores) ---------- */
  var hist = [], hi = -1, histT = null, HIST_MAX = 100;
  function snapshot() { return sheets().map(function (s) { return s.innerHTML.replace(/<mark class="cur"/g, '<mark'); }); }
  function sameSnap(a, b) { return !!a && !!b && a.length === b.length && a.every(function (x, i) { return x === b[i]; }); }
  function histBtns() { if ($('undoBtn')) { $('undoBtn').disabled = hi <= 0; $('redoBtn').disabled = hi >= hist.length - 1; } }
  function histReset() { clearTimeout(histT); histT = null; hist = [snapshot()]; hi = 0; histBtns(); }
  function histCommit() {
    clearTimeout(histT); histT = null;
    var s = snapshot(); if (sameSnap(s, hist[hi])) return;
    hist = hist.slice(0, hi + 1); hist.push(s); if (hist.length > HIST_MAX) hist.shift(); hi = hist.length - 1; histBtns();
  }
  function histQueue() { clearTimeout(histT); histT = setTimeout(histCommit, 500); }
  function histApply(s) {
    sheets().forEach(function (sh, i) { if (s[i] !== undefined && sh.innerHTML !== s[i]) sh.innerHTML = s[i]; });
    cur = -1; refreshDoubts(); histBtns(); queueSave();
  }
  function undo() { if (histT) histCommit(); if (hi <= 0) return; hi--; histApply(hist[hi]); }
  function redo() { if (histT) histCommit(); if (hi >= hist.length - 1) return; hi++; histApply(hist[hi]); }
  if ($('undoBtn')) { $('undoBtn').addEventListener('click', undo); $('redoBtn').addEventListener('click', redo); }

  /* ---------- versions, first text, read again, new file ---------- */
  var VLABEL = { first: 'النص الأول من القراءة', auto: 'حفظ تلقائي', 'export': 'قبل التصدير', reread: 'قبل إعادة التحويل', restore: 'قبل الاستعادة' };
  function renderVersions() {
    var box = $('versionsList'); if (!box || !curDoc) return;
    var vs = (curDoc.versions || []).slice().reverse();
    box.innerHTML = vs.map(function (v, i) {
      var idx = vs.length - 1 - i;
      return '<div class="vrow"><span><b>' + (VLABEL[v.label] || v.label) + '</b><small>' + new Date(v.t).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) + '</small></span><button class="btn sm" type="button" data-restore="' + idx + '">استعادة</button></div>';
    }).join('') || '<p class="small">لا توجد نسخ سابقة بعد.</p>';
  }
  function restoreVersion(idx) {
    if (!curDoc || !curDoc.versions[idx]) return;
    var v = curDoc.versions[idx];
    if (!window.confirm('استعادة «' + (VLABEL[v.label] || v.label) + '» (' + new Date(v.t).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) + ')؟ النص الحالي يبقى في «نسخ سابقة» ويمكن التراجع.')) return;
    histCommit();
    Store.addVersion(curDoc, pagesNow(), 'restore');
    var ss = sheets(); v.pages.forEach(function (p, i) { if (ss[i]) ss[i].innerHTML = p.html; });
    cur = -1; refreshDoubts(); histCommit(); queueSave(); renderVersions();
    $('savedNote').hidden = false; $('savedNote').textContent = 'تمت استعادة «' + (VLABEL[v.label] || v.label) + '».';
  }
  if ($('versionsBtn')) {
    $('versionsBtn').addEventListener('click', function () { var p = $('versionsPanel'); p.hidden = !p.hidden; if (!p.hidden) renderVersions(); });
    $('versionsList').addEventListener('click', function (e) { var b = e.target.closest('[data-restore]'); if (b) restoreVersion(+b.dataset.restore); });
    $('firstTextBtn').addEventListener('click', function () { restoreVersion(0); });
    $('reconvertBtn').addEventListener('click', async function () {
      if (running || !curDoc) return;
      var imgs = (curDoc.pages || []).map(function (p) { return p.img; }).filter(Boolean);
      if (!imgs.length) { $('savedNote').hidden = false; $('savedNote').textContent = 'صور هذا الملف غير محفوظة على هذا الجهاز، فلا يمكن إعادة قراءته. صوّر الورقة مرة أخرى.'; return; }
      if (!window.confirm('إعادة قراءة الورقة من الصور؟ النص الحالي يبقى في «نسخ سابقة».')) return;
      clearTimeout(saveT); await saveDraft(true);
      try { var cs = []; for (var i = 0; i < imgs.length; i++) cs.push(await imgToCanvas(imgs[i])); } catch (e) { fail(e); return; }
      reconvertDoc = curDoc; startCanvases(cs);
    });
  }
  function imgToCanvas(src) {
    return new Promise(function (res, rej) {
      var im = new Image(); im.onload = function () { var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); res(c); };
      im.onerror = function () { rej(new Error('image')); }; im.src = src;
    });
  }
  if ($('docName')) $('docName').addEventListener('input', function () { if (curDoc) { curDoc.name = this.value.trim() || curDoc.name; queueSave(); } });
  if ($('learnHintOff')) $('learnHintOff').addEventListener('click', function () { Engine.lsSet('kateb.learnHint', '1'); $('learnHint').hidden = true; });
  if ($('learnHintOn')) $('learnHintOn').addEventListener('click', function () { setLearnOn(true); $('learnHint').hidden = true; homeCards(); });

  /* ---------- draft: survives a refresh or a closed tab on this device ---------- */
  function queueSave() { clearTimeout(saveT); saveT = setTimeout(saveDraft, 800); setSave('saving'); }
  function pagesNow() { return sheets().map(function (s, i) { return { html: s.innerHTML.replace(/<mark class="cur"/g, '<mark'), img: results[i] && results[i].img, text: s.textContent }; }); }
  function setSave(state) {
    var el = $('saveStatus'); if (!el) return;
    el.className = 'savestat ' + state;
    el.textContent = state === 'saving' ? 'جارٍ الحفظ...' : state === 'ok' ? '✅ تم الحفظ تلقائيًا' : state === 'err' ? 'تعذر الحفظ. حاول مرة أخرى.' : '';
    el.title = state === 'err' ? 'اضغط لإعادة المحاولة' : '';
  }
  if ($('saveStatus')) $('saveStatus').addEventListener('click', function () { if (/err/.test(this.className)) saveDraft(true); });
  var saveChain = Promise.resolve();
  /* every change is written to the device: the small localStorage draft at once (survives a closed tab even
     mid-write), then the full document (with photos and versions) in the store. `force` also keeps a version. */
  function saveDraft(force) {
    clearTimeout(saveT); saveT = null;
    var ps = pagesNow(); if (!ps.length) return Promise.resolve();
    setSave('saving');
    ps.forEach(function (p, i) { if (results[i]) results[i].html = p.html; });
    try { localStorage.setItem(DRAFT, JSON.stringify({ t: Date.now(), pages: ps })); }
    catch (e) { try { localStorage.setItem(DRAFT, JSON.stringify({ t: Date.now(), pages: ps.map(function (p) { return { html: p.html }; }) })); } catch (e2) {} }
    if (!curDoc) curDoc = Store.newDoc(MODE, autoName(), ps, { type: results[0] && results[0].type || null });
    curDoc.pages = ps; curDoc.tpl = tplKey();
    if ($('docName') && $('docName').value.trim()) curDoc.name = $('docName').value.trim();
    Store.addVersion(curDoc, ps, force === true ? 'export' : 'auto', force === true ? 0 : 10 * 60 * 1000);
    var doc = curDoc;
    saveChain = saveChain.then(function () { return learnFromEdits(doc); }).catch(function () {})
      .then(function () { return Store.saveDoc(doc); })
      .then(function () { Engine.lsSet(LAST, doc.id); if (curDoc === doc) setSave('ok'); }, function () { if (curDoc === doc) setSave('err'); });
    return saveChain;
  }
  /* a tab closed or the phone switched apps while a save was pending: write now */
  function flushSave() { if (saveT && curScreen === 'done') saveDraft(); }
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushSave(); });

  /* ---------- handwriting learning (see learn.js): records on this device, per writer profile ---------- */
  var learnItems = [];
  function learnOn() { return Engine.lsGet('kateb.learn') === '1'; }
  function setLearnOn(on) { Engine.lsSet('kateb.learn', on ? '1' : '0'); }
  function profile() { return Engine.lsGet('kateb.profile.' + MODE) || (EXAM ? 'mama' : 'baba'); }
  function setProfile(p) { Engine.lsSet('kateb.profile.' + MODE, p); }
  function profileLabel() { var p = profile(); return p === 'mama' ? '👩 خط ماما' : p === 'baba' ? '👨 خط بابا' : 'خط عام'; }
  function loadLearn() { return Store.get('learn', 'items').then(function (r) { return (r && r.items) || []; }); }
  function saveLearn(items) { return Store.put('learn', { id: 'items', items: items }); }
  function learnPrompt() { return learnOn() && learnItems.length ? Learn.promptText(learnItems, profile()) : ''; }
  function htmlText(html) { var d = document.createElement('div'); d.innerHTML = html; return Array.prototype.map.call(d.querySelectorAll('p,td,div,figure'), function (p) { return p.textContent; }).join('\n') || d.textContent; }
  /* a doubtful word confirmed as read: this hand writes it so */
  function learnConfirm(m) {
    if (!learnOn() || !m || !m.dataset.o) return;
    var w = Learn.clean(m.textContent), o = Learn.clean(EXAM ? m.dataset.o : Verify.arabicDigits(m.dataset.o));
    if (w && w === o) queueLearn(function (items) { return Learn.record(items, profile(), 'word', w); });
  }
  /* words the reviewer replaced since the first reading: this hand's spelling of them */
  function learnFromEdits(doc) {
    if (!learnOn() || !doc || !doc.versions || !doc.versions[0]) return Promise.resolve();
    var first = doc.versions[0].pages.map(function (p) { return htmlText(p.html); }).join('\n'), now = doc.pages.map(function (p) { return p.text || htmlText(p.html); }).join('\n');
    var pairs = Learn.wordDiff(first, now).filter(function (p) { var k = p.from + '→' + p.to; if (doc.learned.indexOf(k) >= 0) return false; doc.learned.push(k); return true; });
    if (!pairs.length) return Promise.resolve();
    return queueLearn(function (items) { pairs.forEach(function (p) { Learn.record(items, profile(), 'fix', p.from, p.to); }); return true; });
  }
  var learnChain = Promise.resolve();
  function queueLearn(fn) {
    learnChain = learnChain.then(loadLearn).then(function (items) { if (fn(items)) { learnItems = items; return saveLearn(items); } }).catch(function () {});
    return learnChain;
  }
  function loadDraft() { try { var d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); return d && d.pages && d.pages.length ? d : null; } catch (e) { return null; } }

  /* ---------- «ملفاتي السابقة», «المحذوفات», «الإعدادات», «تحسين خط اليد» ---------- */
  function when(t) { return new Date(t).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }); }
  function docCard(d, trash) {
    var img = d.pages && d.pages[0] && d.pages[0].img, n = d.pages ? d.pages.length : 0;
    var preview = htmlText(d.pages && d.pages[0] ? d.pages[0].html : '').replace(/\s+/g, ' ').trim().slice(0, 90);
    return '<article class="doc" data-id="' + d.id + '">' +
      '<div class="dthumb">' + (img ? '<img alt="" src="' + img + '">' : '<span>📄</span>') + '</div>' +
      '<div class="dbody"><b class="dname">' + escH(d.name) + '</b>' +
      '<small>' + (trash ? 'حُذف ' + when(d.deletedAt) + ' — يُحذف نهائيًا بعد ' + Store.daysLeft(d) + ' يوم' : 'آخر تعديل ' + when(d.updated)) + ' · ' + (n === 1 ? 'صفحة واحدة' : n + ' صفحات') + '</small>' +
      '<span class="chip ' + (d.status === 'exported' ? 'ok' : '') + '">' + (d.status === 'exported' ? 'تم التصدير' : 'مسودة') + '</span>' +
      (preview ? '<p class="dprev">' + escH(preview) + '…</p>' : '') + '</div>' +
      '<div class="dacts">' + (trash
        ? '<button class="btn sm" type="button" data-act="restore">↩️ استرجاع</button><button class="btn sm danger" type="button" data-act="purge">حذف نهائي</button>'
        : '<button class="btn sm go" type="button" data-act="open">فتح</button><button class="btn sm" type="button" data-act="rename">إعادة تسمية</button><button class="btn sm danger" type="button" data-act="trash">حذف</button>') + '</div></article>';
  }
  var filesAll = [];
  function renderFiles() {
    show('files');
    Store.listDocs(MODE).then(function (ds) { filesAll = ds; drawFiles(); return Store.listTrash(MODE); }).then(function (ts) { $('trashCount').textContent = ts.length ? '(' + ts.length + ')' : ''; }).catch(function () { filesAll = []; drawFiles(); });
  }
  function drawFiles() {
    var q = ($('filesSearch').value || '').trim(), ds = q ? filesAll.filter(function (d) { return (d.name || '').indexOf(q) >= 0 || htmlText(d.pages[0] ? d.pages[0].html : '').indexOf(q) >= 0; }) : filesAll;
    $('docList').innerHTML = ds.map(function (d) { return docCard(d, false); }).join('');
    $('filesEmpty').hidden = !!ds.length; $('filesEmpty').textContent = q ? 'لا يوجد ملف بهذا الاسم.' : 'لا توجد ملفات محفوظة بعد. كل ورقة تحوّلها تُحفظ هنا تلقائيًا.';
  }
  function renderTrash() {
    show('trash');
    Store.listTrash(MODE).then(function (ds) {
      $('trashList').innerHTML = ds.map(function (d) { return docCard(d, true); }).join('');
      $('trashEmpty').hidden = !!ds.length; $('emptyTrashBtn').hidden = !ds.length;
    }).catch(function () { $('trashList').innerHTML = ''; $('trashEmpty').hidden = false; });
  }
  if ($('files')) {
    $('filesSearch').addEventListener('input', drawFiles);
    $('trashBtn').addEventListener('click', renderTrash);
    $('docList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'), card = e.target.closest('.doc'); if (!b || !card) return;
      var id = card.dataset.id, d = filesAll.filter(function (x) { return x.id === id; })[0]; if (!d) return;
      if (b.dataset.act === 'open') { Store.getDoc(id).then(function (doc) { if (doc) openDoc(doc); }); }
      else if (b.dataset.act === 'rename') { var n = window.prompt('اسم الملف الجديد:', d.name); if (n && n.trim()) Store.renameDoc(id, n.trim()).then(function () { if (curDoc && curDoc.id === id) curDoc.name = n.trim(); renderFiles(); }); }
      else if (b.dataset.act === 'trash') { if (window.confirm('نقل «' + d.name + '» إلى المحذوفات؟ يمكنك استرجاعه خلال 30 يومًا.')) Store.trashDoc(id).then(function () { if (curDoc && curDoc.id === id) { curDoc = null; results = []; } renderFiles(); }); }
    });
    $('trashList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'), card = e.target.closest('.doc'); if (!b || !card) return;
      var id = card.dataset.id, name = card.querySelector('.dname').textContent;
      if (b.dataset.act === 'restore') Store.restoreDoc(id).then(renderTrash);
      else if (b.dataset.act === 'purge') { if (window.confirm('حذف «' + name + '» نهائيًا؟ لا يمكن التراجع عن هذا.')) Store.purgeDoc(id).then(renderTrash); }
    });
    $('emptyTrashBtn').addEventListener('click', function () { if (window.confirm('حذف كل الملفات في المحذوفات نهائيًا؟ لا يمكن التراجع عن هذا.')) Store.emptyTrash(MODE).then(renderTrash); });
  }
  function renderSettings() {
    show('settings');
    $('setLearnState').textContent = learnOn() ? 'مفعّل — ' + profileLabel() : 'غير مفعّل';
    $('setEnhance').checked = enhanceOn();
    $('storageInfo').textContent = Store.which() === 'ls' ? 'هذا المتصفح لا يسمح بقاعدة بيانات محلية: تُحفظ النصوص فقط بدون صور الورق.' : '';
    Store.usage().then(function (u) { if (u && u.usage) $('storageInfo').textContent = 'المساحة المستخدمة على هذا الجهاز: ' + (u.usage / 1048576).toFixed(1) + ' MB' + (u.quota ? ' من ' + Math.round(u.quota / 1048576) + ' MB' : ''); }).catch(function () {});
    Store.listDocs(MODE).then(function (ds) { return Store.listTrash(MODE).then(function (ts) { $('setDocsInfo').textContent = ds.length + ' ملفات محفوظة، ' + ts.length + ' في المحذوفات.'; }); }).catch(function () {});
    renderUsage();
  }
  function money(x) { return '$' + (x < 0.01 && x > 0 ? x.toFixed(3) : x.toFixed(2)); }
  function tok(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + ' مليون' : n >= 1000 ? Math.round(n / 1000) + ' ألف' : String(n); }
  function renderUsage() {
    var box = $('usageBox'); if (!box) return;
    var u = Engine.usageSummary();
    if (!u.total.calls) { box.innerHTML = '<p class="small">لم تُسجَّل أي قراءة بـ Claude على هذا الجهاز بعد.</p>'; return; }
    var rows = [['اليوم', u.today], ['هذا الشهر', u.month], ['الإجمالي' + (u.first ? ' منذ ' + u.first : ''), u.total]];
    box.innerHTML = '<table class="utable"><thead><tr><th></th><th>طلبات</th><th>رموز (tokens)</th><th>التكلفة التقديرية</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1].calls + '</td><td>' + tok(r[1].tokens) + '</td><td><b>' + money(r[1].usd) + '</b></td></tr>'; }).join('') + '</tbody></table>' +
      '<p class="small">حسب الموديل: ' + Object.keys(u.models).map(function (m) { var x = u.models[m]; return m.replace('claude-', '') + ' ' + money(x.usd) + ' (' + x.calls + ' طلب)'; }).join(' · ') + '</p>' +
      '<p class="small">التكلفة محسوبة من عدد الرموز في كل رد على أسعار Anthropic المعلنة (Opus 5.5: $4 / $20 للمليون، Sonnet 5.5: $2 / $10، Haiku 5.5: $0.10 / $0.50؛ الذاكرة المؤقتة أرخص). الرقم الرسمي والرصيد المتبقي في console.anthropic.com → Usage. هذا الجهاز فقط: كل جهاز يحسب استهلاكه.</p>';
  }
  if ($('usageResetBtn')) $('usageResetBtn').addEventListener('click', function () { if (window.confirm('تصفير عداد الاستهلاك على هذا الجهاز؟')) { Engine.usageReset(); renderUsage(); } });
  if ($('settings')) {
    $('setLearnBtn').addEventListener('click', renderLearn);
    $('setEnhance').addEventListener('change', function () { if ($('enhanceChk')) $('enhanceChk').checked = this.checked; });
    $('deleteAllBtn').addEventListener('click', function () {
      if (!window.confirm('حذف كل الملفات المحفوظة على هذا الجهاز نهائيًا (بما فيها المحذوفات)؟ لا يمكن التراجع عن هذا.')) return;
      Store.listDocs(MODE).then(function (ds) { return Store.listTrash(MODE).then(function (ts) { return Promise.all(ds.concat(ts).map(function (d) { return Store.purgeDoc(d.id); })); }); })
        .then(function () { try { localStorage.removeItem(DRAFT); localStorage.removeItem(LAST); } catch (e) {} curDoc = null; results = []; renderSettings(); });
    });
    $('deleteLearnBtn').addEventListener('click', deleteLearn);
  }
  function deleteLearn() {
    if (!window.confirm('حذف كل ما تعلّمه التطبيق من تصحيحاتك (' + profileLabel() + ' وغيره)؟ القراءة ترجع كما كانت قبل التعلم.')) return;
    learnChain = learnChain.then(function () { return Store.clear('learn'); }).then(function () { learnItems = []; if (curScreen === 'learn') renderLearn(); else renderSettings(); }).catch(function () {});
  }
  function renderLearn() {
    show('learn');
    $('learnChk').checked = learnOn();
    Array.prototype.forEach.call(document.querySelectorAll('#profileSeg [data-profile]'), function (b) { b.setAttribute('aria-pressed', b.dataset.profile === profile() ? 'true' : 'false'); });
    $('learnBody').hidden = !learnOn();
    loadLearn().then(function (items) {
      learnItems = items;
      var st = Learn.stats(items, profile()), rows = Learn.top(Learn.of(items, profile()), 200);
      $('learnStats').innerHTML = st.total
        ? '<b>' + profileLabel() + ':</b> ' + st.fixes + ' تصحيح' + (st.fixes === 1 ? '' : 'ات') + ' و ' + st.words + ' كلمة مؤكدة' + (st.last ? ' — آخر تعلّم ' + when(st.last) : '') + '.<br><small>كل هذه الكلمات تُعرض على القارئ مع الصفحة التالية بنفس الخط، والمؤكدة منها لا تُظلَّل بالأصفر مرة أخرى.</small>'
        : 'لم يتعلم شيئًا بعد عن ' + profileLabel() + '. حوّل ورقة وصحّح الكلمات الصفراء أو أي كلمة خاطئة، ثم ستظهر هنا.';
      $('learnList').innerHTML = rows.map(function (r) {
        return '<div class="lrow" data-lid="' + escH(r.id) + '"><span>' + (r.kind === 'fix' ? '<s>' + escH(r.from) + '</s> ← <b>' + escH(r.to) + '</b>' : '<b>' + escH(r.from) + '</b> <small>مؤكدة</small>') + '<small> ×' + r.n + '</small></span><button class="iconbtn sm" type="button" aria-label="حذف" title="حذف هذه الكلمة">✕</button></div>';
      }).join('');
    }).catch(function () { $('learnStats').textContent = 'تعذر فتح بيانات التعلم على هذا الجهاز.'; });
  }
  if ($('learn')) {
    $('learnChk').addEventListener('change', function () { setLearnOn(this.checked); $('learnBody').hidden = !this.checked; homeCards(); });
    $('profileSeg').addEventListener('click', function (e) { var b = e.target.closest('[data-profile]'); if (!b) return; setProfile(b.dataset.profile); renderLearn(); homeCards(); });
    $('learnList').addEventListener('click', function (e) {
      var b = e.target.closest('button'), row = e.target.closest('[data-lid]'); if (!b || !row) return;
      var id = row.dataset.lid;
      queueLearn(function (items) { for (var i = items.length - 1; i >= 0; i--) if (items[i].id === id) items.splice(i, 1); return true; }).then(renderLearn);
    });
    $('deleteLearnBtn2').addEventListener('click', deleteLearn);
  }
  /* recently deleted files older than 30 days go for good; runs once per open */
  Store.purgeOld().catch(function () {});

  /* ---------- download ---------- */
  function stamp() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function examHeader() {
    var h = {}; ['hLine1', 'hLine2', 'hLine3', 'hSubject', 'hGrade', 'hTime', 'hTitle'].forEach(function (id) { h[id] = $(id) ? $(id).value : ''; });
    var out = { line1: h.hLine1, line2: h.hLine2, line3: h.hLine3, subject: h.hSubject, grade: h.hGrade, time: h.hTime, title: h.hTitle };
    var k = examKind(); if (curDoc && curDoc.kindTitle) out.title = curDoc.kindTitle;
    if (k === 'revision') out.right = ['Subject: ' + (out.subject || ''), 'Grade: ' + (out.grade || ''), 'Date: ' + (out.date || '………………')];
    else if (k === 'notes') { out.noTable = true; out.right = []; }
    else if (k === 'plain') return null;
    else out.right = ['Subject: ' + (out.subject || ''), 'Grade: ' + (out.grade || ''), 'Time: ' + (out.time || '')];
    return out;
  }
  /* ---------- «ما نوع هذه الورقة؟» asked once per document before the first Word / PDF ---------- */
  var EXAM_KINDS = [
    { key: 'exam', icon: '📝', label: 'امتحان', hint: 'رأس المدرسة كامل: المادة والصف والزمن، وعنوان الامتحان', title: function () { return Engine.lsGet('exam.hTitle') || 'First term exam'; } },
    { key: 'revision', icon: '📋', label: 'مراجعة / ورقة عمل', hint: 'رأس بالمادة والصف والتاريخ، وعنوان «Revision Sheet»', title: function () { return 'Revision Sheet'; } },
    { key: 'notes', icon: '📒', label: 'مذكرة / شرح', hint: 'عنوان فقط بدون جدول الرأس', title: function () { return 'Notes'; } },
    { key: 'plain', icon: '📄', label: 'ورقة عادية', hint: 'النص كما هو، بدون رأس ولا عنوان', title: function () { return ''; } }
  ];
  function examKind() { return (curDoc && curDoc.kind) || 'exam'; }
  function kindLabel() {
    var b = $('kindBtn'); if (!b) return;
    if (EXAM) { var k = EXAM_KINDS.filter(function (x) { return x.key === examKind(); })[0] || EXAM_KINDS[0]; b.textContent = k.icon + ' ' + k.label + ' ▾'; }
    else { var t = tplOf(tplKey()); b.textContent = '🗂️ ' + (t ? t.label : 'ملف عادي (بدون شكل المكتب)') + ' ▾'; }
  }
  var kindThen = null, kindChoice = '';
  function askKind(then) {
    kindThen = then || null;
    var list = $('kindList'), extra = $('kindExtra');
    if (EXAM) {
      kindChoice = examKind();
      list.innerHTML = EXAM_KINDS.map(function (k) { return '<button class="kind" type="button" data-kind="' + k.key + '" aria-pressed="' + (k.key === kindChoice) + '"><span class="ki">' + k.icon + '</span><span><b>' + k.label + '</b><small>' + k.hint + '</small></span></button>'; }).join('');
      extra.innerHTML = '<label class="tplrow">عنوان الورقة<input id="kindTitle" dir="ltr" autocomplete="off"></label>';
      $('kindTitle').value = (curDoc && curDoc.kindTitle) || EXAM_KINDS.filter(function (k) { return k.key === kindChoice; })[0].title();
      $('kindHint').textContent = 'اختاري نوع الورقة ليخرج الملف بالرأس والشكل المناسبين.';
    } else {
      var detected = (curDoc && curDoc.type) || Office.detect(parasText(allParas())) || '';
      kindChoice = tplKey() || '';
      var opts = [{ key: '', label: 'ملف عادي (بدون شكل المكتب)', icon: '📄' }].concat(TPLS.map(function (t) { return { key: t.key, label: t.label, icon: '📜', stamp: t.stamp }; }));
      list.innerHTML = opts.map(function (o) { return '<button class="kind" type="button" data-kind="' + o.key + '" aria-pressed="' + (o.key === kindChoice) + '"><span class="ki">' + o.icon + '</span><span><b>' + escH(o.label) + '</b>' + (o.key && o.key === detected ? '<small>المقترح من قراءة الورقة</small>' : '') + '</span></button>'; }).join('');
      extra.innerHTML = '<div class="tplrow2" id="kindLaw"><label class="tplrow">اسم المحامي في الختم<input id="kindLawName" autocomplete="off"></label><label class="tplrow">الصفة<select id="kindLawTitle"><option>المحامي</option><option>المحامية</option></select></label></div>';
      $('kindLawName').value = $('lawName').value; $('kindLawTitle').value = $('lawTitle').value;
      $('kindHint').textContent = 'اختر نوع الورقة ليخرج Word و PDF بشكل المكتب لهذا النوع: الخطوط والهوامش والختم.';
      kindExtraLegal();
    }
    $('kindDlg').hidden = false;
    var sel = list.querySelector('[aria-pressed="true"]'); if (sel) sel.focus();
  }
  function kindExtraLegal() { var t = tplOf(kindChoice); if ($('kindLaw')) $('kindLaw').hidden = !(t && t.stamp); }
  if ($('kindDlg')) {
    $('kindList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-kind]'); if (!b) return;
      kindChoice = b.dataset.kind;
      Array.prototype.forEach.call($('kindList').querySelectorAll('[data-kind]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      if (EXAM) { var k = EXAM_KINDS.filter(function (x) { return x.key === kindChoice; })[0]; if (k && $('kindTitle')) $('kindTitle').value = k.title(); } else kindExtraLegal();
    });
    $('kindCancel').addEventListener('click', function () { $('kindDlg').hidden = true; kindThen = null; });
    $('kindOk').addEventListener('click', function () {
      if (curDoc) {
        if (EXAM) { curDoc.kind = kindChoice; curDoc.kindTitle = ($('kindTitle').value || '').trim(); }
        else {
          $('tplSel').value = kindChoice; tplHint(); $('lawName').value = $('kindLawName').value; $('lawTitle').value = $('kindLawTitle').value; Engine.lsSet('kateb.lawName', $('lawName').value.trim()); Engine.lsSet('kateb.lawTitle', $('lawTitle').value);
          if (kindChoice && curDoc.name === curDoc.nameAuto) { curDoc.name = curDoc.nameAuto = autoName(kindChoice); $('docName').value = curDoc.name; }
        }
        curDoc.kindOk = true; queueSave();
      }
      kindLabel(); $('kindDlg').hidden = true;
      var fn = kindThen; kindThen = null; if (fn) fn();
    });
    $('kindDlg').addEventListener('click', function (e) { if (e.target === $('kindDlg')) $('kindCancel').click(); });
    if ($('kindBtn')) $('kindBtn').addEventListener('click', function () { askKind(null); });
    if (!EXAM) $('tplSel').addEventListener('change', kindLabel);
  }
  function withKind(fn) { if (curDoc && !curDoc.kindOk) askKind(fn); else fn(); }
  function baseName() { var n = baseName0(); if (n) return n; if (!EXAM) { var t = tplOf(tplKey()); return (t ? t.label.replace(/[\\\/:*?"<>|]/g, '-') : 'مستند') + ' ' + stamp(); } var h = examHeader() || {}; return ((h.grade || '') + ' ' + (h.title || 'Exam')).replace(/[\\\/:*?"<>|]/g, '-').trim(); }
  function leftNote() { var n = marks().length; return n ? ' ما زال فيه ' + n + ' كلمة صفراء غير مؤكدة، وستظهر بالأصفر في الملف.' : ''; }

  function nothingToExport() {
    var t = sheets().map(function (s) { return s.textContent; }).join('').replace(/\s+/g, '');
    if (t.length > 0) return false;
    $('savedNote').hidden = false; $('savedNote').textContent = 'لا يوجد نص للحفظ: لم تُقرأ أي كلمات من الصورة. صوّر الورقة مرة أخرى.';
    return true;
  }
  $('wordBtn').addEventListener('click', function () { if (nothingToExport()) return; withKind(doWord); });
  $('pdfBtn').addEventListener('click', function () { if (nothingToExport()) return; withKind(doPdf); });
  async function doWord() {
    var btn = $('wordBtn'); btn.disabled = true;
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
      exported();
    } catch (e) { $('savedNote').hidden = false; $('savedNote').textContent = 'تعذر حفظ الملف. حاول مرة أخرى.'; }
    finally { btn.disabled = false; }
  }

  /* PDF: the browser's own print engine lays out Arabic perfectly; the person picks «Save as PDF». */
  async function doPdf() {
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
    var head = h ? (h.noTable ? '' : '<table class="xhead"><tbody>' + [[h.line1, h.right[0]], [h.line2, h.right[1]], [h.line3, h.right[2]]].map(function (r) {
      return '<tr><td>' + escH(r[0] || '') + '</td><td>' + escH(r[1] || '') + '</td></tr>'; }).join('') + '</tbody></table>') + (h.title ? '<p class="xtitle">' + escH(h.title) + '</p>' : '') : '';
    root.className = 'sheet doc' + (EXAM ? ' exam' : ''); root.dir = EXAM ? 'ltr' : 'rtl';
    root.innerHTML = head + sheets().map(function (s) { return s.innerHTML; }).join('');
    Array.prototype.forEach.call(root.querySelectorAll('[contenteditable]'), function (el) { el.removeAttribute('contenteditable'); });
    printNow();
  }
  function printNow(after) {
    var title = document.title; document.title = baseName();
    setTimeout(function () {
      try { window.print(); } catch (e) {}
      document.title = title; if (after) after();
      $('savedNote').hidden = false; $('savedNote').textContent = 'في نافذة الطباعة اختر «حفظ كملف PDF» (Save as PDF).' + leftNote();
      exported();
    }, 60);
  }
  function exported() { if (curDoc) { curDoc.status = 'exported'; curDoc.exportedAt = Date.now(); } saveDraft(true); }
  function baseName0() { return curDoc && curDoc.name ? curDoc.name.replace(/[\\\/:*?"<>|]/g, '-') : ''; }

  /* legal: edited sheet → blocks (paragraphs and tables) */
  function walkRuns(node) {
    var runs = [];
    (function walk(n, f) {
      n.childNodes.forEach(function (c) {
        if (c.nodeType === 3) { if (c.nodeValue) runs.push({ text: (EXAM ? c.nodeValue : Verify.west(Verify.stripMarks(c.nodeValue))).replace(/\n/g, ' '), b: f.b, u: f.u, hl: f.hl }); return; }
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
  var APP_VER = '14';
  (function () { var v = $('appVer'); if (v) v.textContent = 'v' + APP_VER; })();
  /* self-update: the site's version file is fetched past every cache; a newer site clears the app's caches
     and reloads once (never while a page is being read or reviewed). «تحديث» in the header does the same by hand. */
  var reloading = false;
  async function hardRefresh() {
    reloading = true;
    try { if ('serviceWorker' in navigator) { var regs = await navigator.serviceWorker.getRegistrations(); for (var i = 0; i < regs.length; i++) await regs[i].unregister(); } } catch (e) {}
    try { if (window.caches) { var ks = await caches.keys(); for (var j = 0; j < ks.length; j++) await caches.delete(ks[j]); } } catch (e) {}
    location.replace(location.pathname + '?r=' + Date.now() + location.hash);
  }
  async function checkVersion() {
    if (location.protocol === 'file:') return;
    try {
      var r = await fetch('kateb/version.json?ts=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return;
      var v = String((await r.json()).v || '');
      if (!v || v === APP_VER) return;
      var tried = sessionStorage.getItem('kateb.reloadedFor');
      if (tried === v || running || !$('done').hidden) return;
      sessionStorage.setItem('kateb.reloadedFor', v);
      hardRefresh();
    } catch (e) {}
  }
  checkVersion();
  if ($('updateBtn')) $('updateBtn').addEventListener('click', function () { if (running) return; if ($('done').hidden || window.confirm('تحديث التطبيق الآن؟ المستند المفتوح محفوظ على الجهاز.')) hardRefresh(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(function (reg) { try { reg.update(); } catch (e) {} }).catch(function () {});
    /* a new version took over: reload once so the page and its scripts match (never while a page is being read) */
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloaded || reloading || running || !navigator.serviceWorker.controller) return; reloaded = true;
      if ($('done').hidden) location.reload();
    });
  }
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

  window.__test = { finish: finish, toResult: toResult, setResults: function (r) { results = r; }, show: show, sheetToParas: sheetToParas, domBlocks: domBlocks, results: function () { return results; },
    doc: function () { return curDoc; }, usage: function () { return Engine.usageSummary(); }, askKind: askKind, save: function () { return saveDraft(); }, saved: function () { return saveChain.then(function () { return learnChain; }); }, undo: undo, redo: redo, hist: function () { return { n: hist.length, i: hi }; }, nav: function () { return { cur: curScreen, stack: nav.slice() }; } };

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
    "- HOUSE STYLE OF THIS OFFICE (measured on 1,740 of its typed papers): ALL numbers and dates use Western digits 0-9, even when the hand wrote ٠-٩. Dates are day/month/year like 10/1/2020 or 7/10/2025 (never year first). Amounts like 250000 ج ( مائتان وخمسون ألف جنيه مصري لا غير ). Case references like رقم 2537 لسنة 2025. Keep the source's spelling and punctuation otherwise.\n" +
    "- Copy EVERY digit: a year has four digits (2022, not 202), an amount keeps all its zeros; read numbers from the strips digit by digit, never from memory.\n" +    "- Spelling is standard Egyptian legal Arabic as the office types it: دعوى (never دعوه or دعوة), إلى، على، بالآتي، صحة توقيع، محكمة، الأهلية القانونية، أسيوط. Final ة and ى are never written as ه or ي by mistake.\n" +
    "- Do not add, remove, summarize, translate or correct the wording.\n" +
    "- Letters are read from the ink, not from what the sentence expects: count the dots and their position for ب ت ث ن ي، ج ح خ، د ذ، ر ز، س ش، ص ض، ط ظ، ع غ، ف ق; ه vs ة and ي vs ى as written; hamza (أ إ آ ا) as written. A faint or missing dot is still a doubt: mark the word rather than resolve it from context.";
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
  var NUMBERS_PROMPT = "List EVERY number written on this page: dates, years, amounts, case numbers, article numbers, areas, phone and ID numbers, house and street numbers, item numbers. " +
    "Read them from the strips (images 2 onwards) digit by digit; a year has four digits, a date has day/month/year. One per line, in reading order, in this exact format:\n" +
    "<number exactly as written, same digit style as the page> | <the two or three words written just before it>\n" +
    "Nothing else: no commentary, no headings. If a digit is truly unreadable write ? in its place.";
  var KIND_PROMPT = "This is a photo of an Egyptian legal paper. Reply with ONLY its title line exactly as written at the top of the page (for example: دعوى صحة توقيع / إعادة إعلان في الدعوى / إعلان بأصل الصحيفة / إنذار عرض قيمة إيجارية / عقد بيع ابتدائي / عقد هبة / إقرار / مذكرة بدفاع / طلب وراثة / إعلان في مادة الوراثة / صحيفة استئناف). If there is no title, reply with the first written line. Nothing else.";
  function bankSystem(label, lines) {
    return "You know the standard wording of Egyptian «" + label + "» papers exactly as this law office writes them. STANDARD FORMULAS of this paper type (names, numbers and places are replaced by {{NAME}}, # and {{PLACE}}):\n" + lines +
      "\n\nThese papers are written from the same formulas every time: most lines on the page ARE one of these formulas with the names, numbers and places filled in. Read every line against them: when a word is hard to read but its line clearly follows a formula, read it as the formula says (same spelling as the office) and do not mark it. Never do that for names, numbers, dates, case numbers, amounts, addresses or anything that varies from paper to paper: those come from the ink only, digit by digit and letter by letter, and stay in ⟦ ⟧ when unsure.";
  }
  var PROMPTS = EXAM ? {
    bankSystem: bankSystem,
    numbers: function (b) { return stripsNote(b) + NUMBERS_PROMPT; },
    kind: function () { return KIND_PROMPT; },
    read: function (b) { return "You transcribe handwritten mathematics exam drafts written by a primary-school teacher into a clean exam.\n\n" + stripsNote(b) + "Transcribe every question and every answer choice on the page, in order.\n\n" + ROT_NOTE + EXAM_FORMAT; },
    read2: function (b) { return "You transcribe handwritten mathematics exam drafts written by a primary-school teacher into a clean exam.\n\n" + stripsNote(b) + STRIPWISE + "Transcribe every question and every answer choice on the page, in order. Check each digit twice.\n\n" + ROT_NOTE + EXAM_FORMAT; },
    check: function (b, d) { return "Proofread this transcription of the attached handwritten mathematics exam page against the images. " + stripsNote(b) + "Check every number, symbol, unit, fraction, answer choice and question, that nothing is missing or doubled, and that each [FIG] SVG matches its drawing. Remove ⟦ ⟧ from things you can now confirm; keep it on anything still uncertain. Keep exactly the same format.\n\n" + EXAM_FORMAT + "\n\nDRAFT:\n" + d + "\n\nReply with the full corrected transcription only."; },
    judge: function (b, r1, r2, d) { return "Two transcribers copied the attached handwritten mathematics exam page independently. " + stripsNote(b) + diffNote(d) + "For every disagreement look closely at the images and keep what the page really shows. Also re-check every number, fraction, unit and answer choice. Where the image still does not settle it, wrap it in ⟦ ⟧. Keep each [FIG] SVG from the reading whose drawing matches better.\n\n" + EXAM_FORMAT + "\n\nREADING 1:\n" + r1 + "\n\nREADING 2:\n" + r2 + "\n\nReply with the one correct full transcription only."; }
  } : {
    bankSystem: bankSystem,
    numbers: function (b) { return stripsNote(b) + NUMBERS_PROMPT; },
    kind: function () { return KIND_PROMPT; },
    read: function (b) { return "You are the most careful transcriber of Arabic and English documents: messy handwriting, typed pages, photocopies, legal papers for Egyptian courts (صحة توقيع، إعلانات، إنذارات، عقود بيع وهبة، إقرارات، مذكرات).\n\n" + stripsNote(b) + "Transcribe the ENTIRE page word for word, exactly as written. These papers follow fixed legal formulas: for each unclear word use the sentence's meaning, the standard phrasing of this kind of paper, and how the same letters look elsewhere on the page; if still unsure, mark it. Names, numbers, dates and amounts are never guessed from context.\n\n" + ROT_NOTE + LEGAL_FORMAT; },
    read2: function (b) { return "You are the most careful transcriber of Arabic and English documents: messy handwriting, typed pages, photocopies, legal papers for Egyptian courts.\n\n" + stripsNote(b) + STRIPWISE + "Transcribe the ENTIRE page word for word. Names of people and places, numbers, dates and case numbers must be copied letter by letter; if any letter is unsure, mark the word.\n\n" + ROT_NOTE + LEGAL_FORMAT; },
    check: function (b, d) { return "You are proofreading a transcription of the attached page against the page itself. " + stripsNote(b) + "Go through the draft line by line and word by word against the images. Fix every misread word, missing or extra word, wrong number, date, name, digit order, bold/underline, and any skipped or doubled paragraph. Remove ⟦ ⟧ from words you can now confirm; keep or add ⟦ ⟧ on anything still uncertain. Keep the same format.\n\n" + LEGAL_FORMAT + "\n\nDRAFT TRANSCRIPTION:\n" + d + "\n\nReply with the full corrected transcription only."; },
    judge: function (b, r1, r2, d) { return "Two transcribers copied the attached page independently. You decide the final text. " + stripsNote(b) + diffNote(d) + "For every disagreement look closely at the ink in the images and keep what the page really shows — not what sounds better. Also check that no paragraph is missing or doubled and that the layout tags are right. Where the image still does not settle a word, wrap it in ⟦ ⟧.\n\n" + LEGAL_FORMAT + "\n\nREADING 1:\n" + r1 + "\n\nREADING 2:\n" + r2 + "\n\nReply with the one correct full transcription only."; }
  };
})();
