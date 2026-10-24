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
  var SCREENS = ['lock', 'nokey', 'start', 'work', 'done', 'fail', 'files', 'trash', 'settings', 'learn', 'voice', 'audioUp'];
  var STACKED = ['start', 'done', 'files', 'trash', 'settings', 'learn', 'voice', 'audioUp'];
  var nav = [], curScreen = null, backing = false;
  function show(id, noPush) {
    if (id === 'start') nav = [];
    else if (!noPush && !backing && curScreen && curScreen !== id && STACKED.indexOf(curScreen) >= 0 && STACKED.indexOf(id) >= 0) {
      nav.push(curScreen);
      try { history.pushState({ k: id }, '', location.href); } catch (e) {}
    }
    curScreen = id;
    if (id === 'files' || id === 'settings') paintSync(typeof Sync !== 'undefined' ? Sync.status() : null);
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
      else if (prev === 'voice') voiceScreen(true);
      else if (prev === 'audioUp') audioScreen(true);
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
    /* «&m=…» in the private link: the office's lawyers and judges for the memory on this device (never in the public code) */
    var mh = /[&#]m=([A-Za-z0-9_-]+)/.exec(location.hash || '');
    if (mh && typeof Memory !== 'undefined' && mh[1] !== Engine.lsGet('kateb.mblob')) { Memory.fromHash(location.hash); Engine.lsSet('kateb.mblob', mh[1]); }
    /* a link with a key this device has not unlocked yet (a new key) always asks for the password and replaces the old key */
    if (blob && blob !== Engine.lsGet('kateb.blob')) { KEY = null; show('lock'); setTimeout(function () { $('pw').focus(); }, 50); return; }
    var gb = Engine.audioBlobFromHash();
    if (gb && gb !== Engine.lsGet('kateb.gblob') && Engine.savedKey()) { KEY = Engine.savedKey(); show('lock'); setTimeout(function () { $('pw').focus(); }, 50); return; }
    /* v35 «&s=…»: the shared «ملفاتي» (sync.js) — a link with it asks for the password once on each device */
    var sb = typeof Sync !== 'undefined' ? Sync.fromHash(location.hash) : null;
    if (sb && sb !== Engine.lsGet('kateb.sblob') && Engine.savedKey()) { KEY = Engine.savedKey(); show('lock'); setTimeout(function () { $('pw').focus(); }, 50); return; }
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
    try {
      var pw = $('pw').value.trim();
      KEY = await Engine.unlock(Engine.blobFromHash(), pw); Engine.saveKey(KEY); Engine.lsSet('kateb.blob', Engine.blobFromHash()); Engine.lsSet('kateb.model', ''); CLAUDE = Engine.provider(KEY) === 'claude';
      var gb2 = Engine.audioBlobFromHash();
      if (gb2) { try { Engine.setAudioKey(await Engine.unlock(gb2, pw)); Engine.lsSet('kateb.gblob', gb2); } catch (eg) {} }
      var sb2 = typeof Sync !== 'undefined' ? Sync.fromHash(location.hash) : null;
      if (sb2) { try { Sync.setCfg(JSON.parse(await Engine.unlock(sb2, pw))); Engine.lsSet('kateb.sblob', sb2); } catch (es) {} }
      toStart();
    }
    catch (err) { $('pwErr').hidden = false; $('pw').select(); }
    finally { $('pwBtn').disabled = false; $('pwBtn').textContent = 'دخول'; }
  });
  function toStart() {
    CLAUDE = Engine.provider(KEY) === 'claude';
    var name = Engine.provider(KEY) === 'claude' ? 'Claude' : 'Gemini';
    var b = $('providerBadge'); if (b) { b.textContent = name; b.hidden = false; }
    var w = $('readerNote'); if (w) w.textContent = 'القارئ: ' + name + (name === 'Claude' ? ' (Opus 5.5' + (Engine.fastOn() ? ' ⚡ وضع السرعة' : '') + (econ() ? ' 💰 وضع التوفير' : ' 🎯 أقصى دقة') + ' — قراءتان + مراجعة + فحص الأرقام)' : ' (المجاني — أبطأ)') + '. اترك الصفحة مفتوحة.';
    var d = loadDraft();
    $('resumeBtn').hidden = !d;
    if (d) $('resumeWhen').textContent = new Date(d.t).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
    show('start');
    homeCards();
    startSync();
  }
  /* v35: «ملفاتي» shared by every device (sync.js). Files changed elsewhere appear here by themselves. */
  var syncStarted = false, syncHooked = false;
  function syncText(x) {
    if (!x || x.state === 'off') return '';
    if (x.state === 'busy') return '☁️ جارٍ مزامنة الملفات مع باقي الأجهزة…';
    if (x.state === 'err') return '⚠️ ' + x.msg;
    return '☁️ ملفاتك واحدة على كل الأجهزة — آخر مزامنة ' + new Date(x.at).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
  }
  function paintSync(x) {
    ['syncNote', 'setSyncNote'].forEach(function (id) { var el = $(id); if (!el) return; var t = syncText(x); el.textContent = t || (id === 'setSyncNote' ? 'غير مفعّلة على هذا الجهاز: افتح رابط الكاتب الجديد من زياد واكتب كلمة السر مرة واحدة.' : ''); el.hidden = !el.textContent; el.className = 'small center syncnote' + (x && x.state === 'err' ? ' warn' : ''); });
    var on = typeof Sync !== 'undefined' && Sync.on();
    if ($('syncNow')) $('syncNow').hidden = !on;
    if ($('syncSetup')) $('syncSetup').hidden = on;
  }
  function startSync() {
    if (syncStarted || typeof Sync === 'undefined') return;
    syncStarted = true;
    if (!syncHooked && Sync.onPrefs) Sync.onPrefs(function () {          // v41: settings / learning / memory from another device
      loadLearn().then(function (items) { learnItems = learnOn() ? items : []; }).catch(function () {});
      if (curScreen === 'settings') renderSettings(); homeCards(); try { paintOut(); } catch (e) {}
    });
    if (!syncHooked) { syncHooked = true; Sync.onStatus(paintSync); Sync.onPulled(function (ids) {
      homeCards();
      if (curScreen === 'files') renderFiles(); else if (curScreen === 'trash') renderTrash(); else if (curScreen === 'settings') renderSettings();
    }); }
    paintSync(Sync.status());
    Sync.autoJoin(KEY).then(function () { Sync.start(MODE); paintSync(Sync.status()); });     // v36: the other devices join by themselves
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
  if ($('filesBtn')) $('filesBtn').addEventListener('click', function () { renderFiles(); if (typeof Sync !== 'undefined') Sync.soon(0); });
  if ($('learnBtn')) $('learnBtn').addEventListener('click', renderLearn);
  if ($('settingsBtn')) $('settingsBtn').addEventListener('click', renderSettings);
  if ($('voiceBtn')) $('voiceBtn').addEventListener('click', voiceScreen);
  if ($('audioBtn')) $('audioBtn').addEventListener('click', audioScreen);

  /* ---------- pick ---------- */
  $('pickBtn').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function () { var f = Array.prototype.slice.call(this.files || []); this.value = ''; if (f.length) addFiles(f); });

  /* ---------- camera: one page per shot, cleaned, collected in a tray, read together ---------- */
  var shots = [], blur = [];
  function enhanceOn() { var c = $('enhanceChk'); return !c || c.checked; }
  /* v39: a real messy handwritten paper was read far worse from the enhanced (black/white) image — thin strokes vanish.
     The reader now gets the photo only straightened; the enhanced one is for the screen. */
  function plainOf(c) { try { return typeof Scan !== 'undefined' && Scan.deskew ? Scan.deskew(c) : c; } catch (e) { return c; } }
  function cleaned(c) { try { return enhanceOn() && typeof Scan !== 'undefined' ? Scan.clean(c) : c; } catch (e) { return c; } }
  /* a photo → { orig, clean, quad }: the paper found and straightened (Scan.smart), then white paper / dark ink;
     a PDF page or a photo with enhancement off stays as it is */
  function shotOf(c, isPdf, quad) {
    if (isPdf || !enhanceOn() || typeof Scan === 'undefined' || !Scan.smart) return { orig: c, clean: c, plain: c, quad: null };
    try { var sm = Scan.smart(c, quad); return { orig: c, clean: sm.canvas, plain: sm.plain || c, quad: sm.quad }; } catch (e) { return { orig: c, clean: cleaned(c), plain: c, quad: null }; }
  }
  var BLUR = 18;                                               // strongest-edge strength below this (crisp text ≈ 140, 2px blur ≈ 10): warn
  function sharp(c) { try { return typeof Scan !== 'undefined' ? Scan.sharpness(c) : 99; } catch (e) { return 99; } }
  /* photos and PDFs chosen from files: same tray, same single «تحويل» button (photos cleaned, PDF pages left as they are) */
  async function addFiles(files) {
    files.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
    try {
      for (var i = 0; i < files.length; i++) {
        var isPdf = files[i].type === 'application/pdf' || /\.pdf$/i.test(files[i].name), cs = await Engine.fileToCanvases(files[i]);
        cs.forEach(function (c) { shots.push(shotOf(c, isPdf)); blur.push(isPdf ? false : sharp(c) < BLUR); });
      }
    } catch (e) { fail(e); return; }
    renderTray(); $('tray').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function renderTray() {
    var box = $('shots'); if (!box) return;
    box.innerHTML = shots.map(function (sh, i) { return '<div class="shot' + (blur[i] ? ' blur' : '') + '"><img alt="صفحة ' + (i + 1) + '" src="' + Engine.scaled(sh.clean, 260).toDataURL('image/jpeg', 0.7) + '"><span class="n">' + (i + 1) + '</span>' + (sh.quad ? '<span class="cut" title="تم قص الورقة وتعديل الميل">✂️</span>' : '') + (blur[i] ? '<span class="warn">غير واضحة</span>' : '') + '<button class="x" type="button" data-rm="' + i + '" aria-label="حذف الصفحة">✕</button><button class="view" type="button" data-view="' + i + '" aria-label="عرض الصفحة بعد التحسين">🔍 عرض</button></div>'; }).join('');
    var nb = blur.filter(Boolean).length;
    $('trayCount').textContent = shots.length === 1 ? 'صفحة واحدة جاهزة' : shots.length + ' صفحات جاهزة';
    $('blurNote').hidden = !nb; $('blurNote').textContent = nb ? 'الصورة غير واضحة. من فضلك التقط صورة أوضح (الصفحة ' + blur.map(function (b, i) { return b ? i + 1 : null; }).filter(Boolean).join('، ') + '). يمكنك حذفها وتصويرها مرة أخرى.' : '';
    $('tray').hidden = !shots.length;
    $('goBtn').querySelector('span').textContent = '✨ تحويل المستند بذكاء' + (shots.length > 1 ? ' (' + shots.length + ' صفحات)' : '');
  }
  if ($('camBtn')) {
    $('camBtn').addEventListener('click', function () { $('camFile').click(); });
    $('moreBtn').addEventListener('click', function () { $('camFile').click(); });
    $('camFile').addEventListener('change', async function () {
      var f = this.files && this.files[0]; this.value = ''; if (!f) return;
      try { var cs = await Engine.fileToCanvases(f); cs.forEach(function (c) { shots.push(shotOf(c, false)); blur.push(sharp(c) < BLUR); }); renderTray(); $('tray').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      catch (e) { fail(e); }
    });
    $('shots').addEventListener('click', function (e) {
      var v = e.target.closest('[data-view]') || e.target.closest('img');
      if (v) { var i = v.dataset.view !== undefined ? +v.dataset.view : +v.parentNode.querySelector('[data-view]').dataset.view; openScan(i); return; }
      var b = e.target.closest('[data-rm]'); if (!b) return; shots.splice(+b.dataset.rm, 1); blur.splice(+b.dataset.rm, 1); renderTray();
    });
    if ($('clearTrayBtn')) $('clearTrayBtn').addEventListener('click', function () { if (!shots.length || window.confirm('حذف كل الصور من القائمة؟')) { shots = []; blur = []; renderTray(); } });
    $('goBtn').addEventListener('click', function () {
      if (!shots.length || running) return;
      if (blur.some(Boolean) && !window.confirm('فيه صورة غير واضحة وقد تُقرأ بأخطاء. هل تريد المتابعة؟')) return;
      startCanvases(shots.map(function (sh) { return { base: sh.clean, raw: sh.plain || sh.orig }; })); shots = []; blur = []; renderTray();
    });
  }
  function startCanvases(cs) {
    show('work'); setProgress(0, 1, 'جارٍ تجهيز الصفحات…'); setStage(0); $('waitText').hidden = true; $('thumbs').innerHTML = '';
    if ($('cancelBtn')) $('cancelBtn').hidden = false;
    pages = cs.map(function (c) { return c && c.base ? c : { base: c }; });
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
        cs.forEach(function (c) { pages.push(isPdf ? { base: c } : { base: cleaned(c), raw: plainOf(c) }); });   // photos are cleaned for the eye; the reader gets the plain photo (v39)
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
  var CLAUDE = Engine.provider(KEY) === 'claude', SHORT = CLAUDE && !EXAM;     // SHORT: the short judge (only the disputed places)
  /* a reply that is an apology instead of the page («I can't transcribe…») */
  function refusal(t) { var x = String(t || '').replace(/^\s*ROT:\s*\d+\s*/, '').slice(0, 400); return /\b(I can'?t|I cannot|I'm unable|I am unable|unable to (read|transcribe)|can'?t (produce|transcribe|read))\b/i.test(x); }
  function rotOf(t) { var m = /^\s*ROT:\s*(0|90|180|270)/.exec(t || ''); return m ? +m[1] : 0; }
  function stripRot(t) { return String(t || '').replace(/^\s*ROT:\s*\d+\s*\n?/, ''); }
  /* v23 legal pages: reading 1 on Opus with its images cached (the judge reuses them at 5% of the price), reading 2
     on Sonnet — a different model makes different mistakes, so where they agree the text is safe, and it costs half.
     Hanan's exams and «🎯 أقصى دقة» keep both reads on Opus. */
  async function readTwice(imgs, system, ctx) {
    var short = SHORT && econ();
    var eff = CLAUDE && !econ() ? 'high' : 'medium';       // the same effort as the judge: a different effort would miss the image cache
    var pa = Engine.generate(KEY, PROMPTS.read(imgs.bands), imgs.blobs, { onWait: onWait, signal: sig(), temperature: 0.1, effort: eff, best: true, cacheImages: SHORT, system: system, context: ctx });
    /* v31: in economy the second read is gone for legal pages — on real handwriting Sonnet gave up («.....» gaps), every gap
       became a yellow «disagreement» (39 on one page) and forced a full rewrite. One careful Opus read; its own doubts
       get the short check. «🎯 أقصى دقة» keeps two Opus reads and the judge. */
    var pb = short ? Promise.resolve(null) : Engine.generate(KEY, PROMPTS.read2(imgs.bands), imgs.blobs, { onWait: onWait, signal: sig(), temperature: 0.5, effort: econ() ? 'low' : eff, best: !short, system: system, context: ctx })
      .then(function (r) { if (r.model) usedModels[r.model] = 1; return r.truncated ? null : Engine.clean(r.text); }, function (e) { if (e && (e.code === 'bad_key' || e.code === 'credit')) throw e; return null; });
    var ra = await pa, b = await pb;
    if (ra.model) usedModels[ra.model] = 1;
    return { a: Engine.clean(ra.text), b: b };
  }
  /* the pages already read of the same paper: names, case numbers and dates must agree across pages */
  function caseContext() {
    var prev = results.filter(Boolean).map(function (r) { return r.text || ''; }).filter(Boolean);
    if (!prev.length) return '';
    var t = prev.join('\n----\n'); if (t.length > 6000) t = t.slice(-6000);
    return "\n\nEARLIER PAGES OF THE SAME PAPER (already transcribed; the same people, case number, court, dates and amounts recur — an unclear name or number on this page that matches one here is read the same way):\n" + t;
  }
  var usedModels = {}, curAdded = {}, curDict = {}, glossaryBank, memoryBank, lexiconBank;
  /* 📄 printed pages: free on-device OCR (Tesseract) + one correction call; 📖 Arabic dictionary on the device:
     words no dictionary, formula or earlier confirmation knows are marked for review — both on unless switched off */
  function ocrOn() { return Engine.lsGet('kateb.ocr') !== '0'; }
  function dictOn() { return Engine.lsGet('kateb.dict') !== '0'; }
  /* words the dictionary need not know: the office's formulas, the glossary, this hand's learned words, the names */
  function knownWord(bank, text) {
    var set = {};
    function addLines(bk) { if (bk && bk.lines) bk.lines.forEach(function (l) { (l.o || []).forEach(function (w) { var c = String(w).replace(/[^ء-ي]/g, ''); if (c) set[c] = 1; }); }); }
    addLines(bank); addLines(glossaryBank);
    if (lexiconBank && lexiconBank.seen) String(lexiconBank.seen).split(' ').forEach(function (w) { if (w) set[w] = 1; });   // every word the office types
    learnItems.forEach(function (r) { if (r.profile === profile()) { set[r.from] = 1; if (r.to) set[r.to] = 1; } });
    if (text && typeof Fields !== 'undefined') Fields.extract(text).names.forEach(function (n) { n.split(/\s+/).forEach(function (w) { var c = w.replace(/[^ء-ي]/g, ''); if (c) set[c] = 1; }); });
    return function (w) { return !!set[w]; };
  }
  /* an OCR output worth correcting rather than reading again: Tesseract's own confidence, mostly Arabic letters, and
     — when the dictionary is loaded — most of its words are real words (scribbles and photos of handwriting are not) */
  function ocrGood(o) {
    if (!Ocr.usable(o)) return false;
    if (dictOn() && typeof Dict !== 'undefined' && Dict.ready()) return Dict.share(o.text) >= 0.6;
    return o.conf >= 65;
  }
  /* economy: the extra proofreading call is kept for pages with several doubts or with words no dictionary knows */
  function skipCheck(a, bank) {
    if (!econ() || EXAM || !dictOn() || typeof Dict === 'undefined' || !Dict.ready()) return false;
    if ((a.match(/⟦/g) || []).length > 2) return false;
    var u = Dict.unknown(a, knownWord(bank, a)); return !!u && u.words.length === 0;
  }
  /* «💰 وضع التوفير» (default) or «🎯 أقصى دقة»: the same pipeline, cheaper settings — fewer strips, medium
     effort on the reads (the thinking tokens are the big variable), the numbers pass on Sonnet, shorter banks */
  function econ() { return Engine.lsGet('kateb.mode') !== 'best'; }
  function setMode(m) { Engine.lsSet('kateb.mode', m); }
  /* the common expressions of Egyptian court papers (kateb/bank/glossary.json) go with every legal page */
  async function glossaryPrompt() {
    if (EXAM || !CLAUDE || plainRun || typeof Bank === 'undefined') return '';
    if (glossaryBank === undefined) { try { glossaryBank = await Bank.load('glossary'); } catch (e) { glossaryBank = null; } }
    if (memoryBank === undefined) { try { memoryBank = await Bank.load('memory'); } catch (e) { memoryBank = null; } }
    var pub = typeof Memory !== 'undefined' ? Memory.publicPrompt(memoryBank) : '';
    return (glossaryBank ? PROMPTS.glossary(Bank.promptText(glossaryBank, econ() ? 200 : 500)) : '') + pub;
  }
  /* v41 Ms. Hanan's math references (bank/exam_math.json: the ministry curriculum, English edition, Primary 3 – Prep 1):
     her grade's vocabulary and the standard exam instructions help recognise and spell what she wrote — never add */
  var mathBank;
  function gradeKey(g) {
    g = String(g || '').toLowerCase();
    if (/prep|إعدادي|اعدادي/.test(g)) return 'Prep1';
    var m = /(\d)/.exec(g); var n = m ? +m[1] : 0;
    if (/third|three|ثالث/.test(g)) n = 3; else if (/fourth|four|رابع/.test(g)) n = 4; else if (/fifth|five|خامس/.test(g)) n = 5; else if (/sixth|six|سادس/.test(g)) n = 6;
    return n >= 3 && n <= 6 ? 'P' + n : '';
  }
  function termNow() { var m = new Date().getMonth() + 1; return m >= 9 || m === 1 ? '1' : '2'; }
  async function examSystem() {
    if (!EXAM || plainRun || typeof Bank === 'undefined') return undefined;
    if (mathBank === undefined) { try { mathBank = await Bank.load('exam_math'); } catch (e) { mathBank = null; } }
    if (!mathBank || !mathBank.grades) return undefined;
    var k = gradeKey(($('hGrade') && $('hGrade').value) || Engine.lsGet('exam.hGrade')), G = k && mathBank.grades[k];
    var t = "MATH REFERENCES (Egyptian Ministry of Education curriculum, English edition for language schools" + (mathBank.school_year ? ', ' + mathBank.school_year : '') + "):\n";
    if (G) {
      var units = (G.terms[termNow()] || []).concat(G.terms[termNow() === '1' ? '2' : '1'] || []).map(function (u) { return '- ' + u.unit + (u.lessons && u.lessons.length ? ': ' + u.lessons.slice(0, 8).join('; ') : ''); });
      t += "THIS TEACHER'S GRADE: " + G.label + ".\nUNITS AND LESSONS:\n" + units.join('\n') + "\nMATH WORDS SPELLED AS IN THE MINISTRY BOOK: " + G.vocab.join(', ') + "\nUNITS AND SYMBOLS: " + (G.units || []).join(', ') + "\n";
    } else t += "MATH WORDS (Primary 3 – Prep 1): " + Object.keys(mathBank.grades).map(function (x) { return mathBank.grades[x].vocab.slice(0, 60).join(', '); }).join(', ') + "\n";
    t += "STANDARD EXAM INSTRUCTIONS: " + (mathBank.instructions || []).join(' / ');
    return t + "\n\nTHESE REFERENCES ONLY HELP YOU RECOGNISE AND SPELL WHAT IS WRITTEN ON THE PAGE. Never add a question, instruction, choice, number or word the page does not show.";
  }
  /* v39: the formulas are back in the reading, but only to RECOGNISE written words (a real messy paper came back almost
     all dots without them); the closing rule forbids writing any formula text the page does not show */
  function recogSystem(bankTxt, cb, gloss) {
    var t = (bankTxt || '') + caseText(cb) + (gloss || '');
    return t ? t + "\n\nTHESE FORMULAS AND NAMES ONLY HELP YOU RECOGNISE WORDS THAT ARE WRITTEN ON THE PAGE. Never write a formula sentence, word or line that the page does not show, never complete a sentence from them, never fill a blank with them." : undefined;
  }
  /* v26: formula banks per case kind (bank/cases.json → bank/case_<key>.json, from published Egyptian forms): the
     kind is read from the paper's title (إلزام بصرف مستحقات تأمينية، قائمة منقولات، نفقة، طرد للغصب، ريع…) */
  var casesIndex;
  async function caseBank(title) {
    if (EXAM || !title || typeof Bank === 'undefined') return null;
    if (casesIndex === undefined) { try { casesIndex = await Bank.load('cases'); } catch (e) { casesIndex = null; } }
    if (!casesIndex || !casesIndex.kinds) return null;
    var t = String(title).replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
    for (var i = 0; i < casesIndex.kinds.length; i++) {
      var k = casesIndex.kinds[i];
      try { if (new RegExp(k.re).test(t)) { var b = await Bank.load('case_' + k.key); if (b) return b; } } catch (e) {}
    }
    return null;
  }
  function caseText(cb) { return cb && PROMPTS.caseSystem ? PROMPTS.caseSystem(cb.label, Bank.promptText(cb, econ() ? 120 : 250)) : ''; }
  var TYPE_LABEL = { sihha: 'دعوى صحة توقيع', reannounce: 'إعادة إعلان', announce: 'إعلان بأصل الصحيفة', warning: 'إنذار', sahifa: 'صحيفة دعوى / استئناف', inherit_announce: 'إعلان في مادة الوراثة', inherit_request: 'طلب وراثة', sale: 'عقد بيع', gift: 'عقد هبة', price: 'إقرار سعر', iqrar: 'إقرار', memo: 'مذكرة' };
  /* v30: which way up? (a real sideways photo was turned the wrong way, read 4 times and came out «I can't transcribe»)
     The page is turned both possible ways and a small model is asked which picture reads upright — a choice between two
     pictures is reliable, a guessed number of degrees was not. */
  function toJpeg(c) { return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.85); }); }
  async function pickUpright(base, degs) {
    var blobs = [];
    for (var i = 0; i < degs.length; i++) blobs.push(await toJpeg(Engine.scaled(Engine.rotated(base, degs[i]), 900)));
    var nums = degs.map(function (d, i) { return i + 1; }).join(degs.length > 2 ? ', ' : ' or ');
    var q = "Images " + nums + " are the same photo of a paper, turned " + degs.length + " different ways. In which one is the writing UPRIGHT — horizontal lines that read normally, not sideways and not upside down? Reply with only the number (" + nums + ").";
    for (var t = 0; t < 2; t++) {
      try {
        var r = await Engine.generate(KEY, q, blobs, { fast: t === 0, signal: sig(), effort: 'low', maxTokens: 1500 });
        var m = /\b([1-4])\b/.exec(Engine.clean(r.text)); if (m && degs[+m[1] - 1] !== undefined) return degs[+m[1] - 1];
      } catch (e) { if (e && (e.code === 'bad_key' || e.code === 'credit' || e.code === 'cancelled')) throw e; }
    }
    return null;
  }
  async function readPage(p, label, step) {
    var t0 = Date.now();
    step(0, 'جارٍ تجهيز ' + label + '…');
    var side = CLAUDE ? 1568 : 3072;                       // Claude reads at 1568px; bigger only slows the upload
    p.canvas = p.raw || p.base; p.turn = 0;
    /* a landscape photo of a portrait paper is sideways: straighten it before anything is read */
    if (CLAUDE && p.base.width > p.base.height * 1.1) {
      step(0, 'الصورة بالعرض: جارٍ تعديل اتجاه الورقة…');
      var up = await pickUpright(p.base, [0, 90, 270]);                  // a wide photo may also be upright already
      if (up) { p.canvas = Engine.rotated(p.canvas, up); p.turn = up; }
    }
    var bands = CLAUDE ? (econ() ? 4 : 5) : 3;            // more strips = more pixels per line of handwriting (and more image tokens)
    var imgs = await Engine.pageImages(p.canvas, bands, side);
    /* a quick look at the title tells the paper type, so both full reads get the office's formulas for it */
    var type = null, bank = null, printed = false, kl0 = '';
    if (!EXAM && CLAUDE && typeof Office !== 'undefined') {
      try {
        var k = await Engine.generate(KEY, PROMPTS.kind(), [imgs.blobs[0]], { fast: true, signal: sig(), effort: 'low', maxTokens: 1500 });   // v30: 120 was too few: it failed on every page
        var kl = Engine.clean(k.text).split('\n'); kl0 = kl[0]; var kr = /ROT\s*:?\s*(90|180|270)/i.exec(kl.slice(1).join(' '));
        type = Office.detect('[H] ' + kl[0]);
        printed = /PRINTED/i.test(kl.slice(1).join(' '));
        if (kr && +kr[1] === 180) { p.canvas = Engine.rotated(p.canvas, 180); p.turn = (p.turn + 180) % 360; imgs = await Engine.pageImages(p.canvas, bands, side); }   // upside down: turned before the reads
        else if (kr) { var up2 = await pickUpright(p.canvas, [90, 270]); if (up2 !== null) { p.canvas = Engine.rotated(p.canvas, up2); p.turn = (p.turn + up2) % 360; imgs = await Engine.pageImages(p.canvas, bands, side); } }
      } catch (e) { if (e && (e.code === 'bad_key' || e.code === 'credit')) throw e; }
    }
    if (plainRun) type = null;                                            // «نص فقط»: no paper type, no formulas
    if (type && typeof Bank !== 'undefined') bank = await Bank.load(type);
    var cb = plainRun ? null : await caseBank(kl0);                                         // v26: the published wording of this kind of case
    /* v38 (Zeyad: «ما تزودش صيغ من عندك»): the reading sees NO formulas — a real paper came back with sentences the
       lawyer never wrote. The formulas are now only the «⚖️ تحسين صيغة المحاماة» button: suggestions, one by one. */
    var system = EXAM ? await examSystem() : recogSystem(bank ? PROMPTS.bankSystem(TYPE_LABEL[type] || type, Bank.promptText(bank, econ() ? 250 : 400)) : '', cb, await glossaryPrompt()), ctx = (caseContext() + learnPrompt() + (!EXAM && !plainRun && typeof Memory !== 'undefined' ? Memory.privatePrompt() : '')) || undefined;
    var a = null, b = null, ocrUsed = false;
    /* v31 a printed page: ONE Sonnet read of the page and its strips. (The free on-device OCR was tried on a real paper:
       it mixed the side column into the body and put words and lines in the wrong order, and one text correction did
       not repair the order — the picture has to be read.) Typed text needs no second read or judge; its doubts get one
       short check below. ~$0.05 a page. */
    var printedRead = false;
    if (printed && CLAUDE && ocrOn()) {
      try {
        step(1, 'الورقة مطبوعة: قراءة واحدة سريعة…');
        /* v31b: Opus, light thinking — on a real typed page Sonnet put words and lines in the wrong order, Opus did not */
        var rp = await Engine.generate(KEY, PROMPTS.read(imgs.bands), imgs.blobs, { onWait: onWait, signal: sig(), temperature: 0.1, effort: 'low', best: true, cacheImages: true, system: system, context: ctx });
        if (rp.model) usedModels[rp.model] = 1;
        var tp = Engine.clean(rp.text), rr = rotOf(tp);
        if (!rp.truncated && !refusal(tp) && !rr && stripRot(tp).length > 150) { a = stripRot(tp); ocrUsed = true; printedRead = true; }
      } catch (e) { if (e && (e.code === 'bad_key' || e.code === 'credit' || e.code === 'cancelled')) throw e; }
    }
    if (!ocrUsed) {
      step(1, 'جارٍ قراءة ' + label + ' (قراءتان معاً' + (bank ? ' بصيغ «' + (TYPE_LABEL[type] || type) + '»' : '') + ')…');
      var pair = await readTwice(imgs, system, ctx);
      /* turned again only when both reads say the page is not upright (or reading 1 could not read it at all); which way
         is decided by the two-picture check, never by a model's guessed degrees */
      var ra = rotOf(pair.a), rb = pair.b ? rotOf(pair.b) : ra;
      if ((ra && ra === rb) || (refusal(pair.a) && (ra || rb))) {
        var turn = (ra || rb) === 180 ? 180 : await pickUpright(p.canvas, [90, 270]);
        if (turn) { p.canvas = Engine.rotated(p.canvas, turn); p.turn = (p.turn + turn) % 360; imgs = await Engine.pageImages(p.canvas, bands, side); pair = await readTwice(imgs, system, ctx); }
      }
      if (refusal(pair.a) && (!pair.b || refusal(pair.b))) throw { code: 'unreadable' };   // never a document made of an apology
      a = stripRot(pair.a); b = pair.b ? stripRot(pair.b) : null;
      step(2, 'جارٍ مراجعة ' + label + ' مع الأصل والصيغ المعتادة…');
    }
    if (!type && !EXAM && !plainRun && typeof Office !== 'undefined') {
      type = Office.detect(a);
      if (type && typeof Bank !== 'undefined') { bank = await Bank.load(type); }   // v39: the system stays as the read had it — a changed system missed the image cache in the check (paid twice)
    }
    var final = a, d = b ? Verify.disagreements(a, b) : null;
    /* the numbers pass runs beside the judge: every number, date and amount read once more on its own */
    var numbersP = ocrUsed ? Promise.resolve(null) : Engine.generate(KEY, PROMPTS.numbers(imgs.bands), imgs.blobs, econ() ? { onWait: onWait, signal: sig(), effort: 'low', maxTokens: 2048 } : { onWait: onWait, signal: sig(), effort: 'high', best: true, maxTokens: 2048, system: system, context: ctx })
      .then(function (r) { if (r.model) usedModels[r.model] = 1; return Engine.clean(r.text); }, function (e) { if (e && (e.code === 'bad_key' || e.code === 'credit')) throw e; return null; });
    try {
      var mk = SHORT && !ocrUsed ? Verify.marks(a, b || null) : null;
      if (ocrUsed) {
        /* a printed page read once: only its own doubts are looked at again, by the same model with the cached images */
        var mp = printedRead && a.indexOf('⟦') >= 0 ? Verify.marks(a, null) : null;
        if (mp && mp.doubts) {
          var rq = await Engine.generate(KEY, PROMPTS.decide(imgs.bands, mp.prompt, false), imgs.blobs, { onWait: onWait, signal: sig(), system: system, context: ctx, effort: 'low', best: true, cacheImages: true, maxTokens: Math.min(20000, 4096 + 60 * (mp.doubts || 0)) });
          if (rq.model) usedModels[rq.model] = 1;
          if (!rq.truncated) final = Verify.decide(mp, Engine.clean(rq.text)).text;
        }
      }
      else if (mk && (b ? (mk.disputes || (mk.doubts && (!d.same || !skipCheck(a, bank)))) : (mk.doubts && !skipCheck(a, bank))) || (mk && /⟦\s*(؟+|[.…]{3,})\s*⟧/.test(a))) {
        /* the short judge: Opus looks only at the marked places (the disputes, and reading 1's doubts) and the numbers,
           and answers in a few lines instead of rewriting the page — a fraction of the time and of the price */
        step(2, 'جارٍ حسم ' + (mk.disputes ? mk.disputes + ' موضع اختلاف' : mk.doubts + ' كلمة غير مؤكدة') + ' مع الأصل…');
        var rs = await Engine.generate(KEY, PROMPTS.decide(imgs.bands, mk.prompt, mk.disputes > 0), imgs.blobs, { onWait: onWait, signal: sig(), system: system, context: ctx, effort: econ() ? 'medium' : 'high', best: true, cacheImages: true, maxTokens: Math.min(20000, 6000 + 60 * ((mk.disputes || 0) + (mk.doubts || 0))) });   // v39: 4096 cut a real page's answer off after a third of its doubts
        if (rs.model) usedModels[rs.model] = 1;
        var rsT = Engine.clean(rs.text); if (rs.truncated) rsT = rsT.replace(/\n[^\n]*$/, '');   // v39: a cut-off answer still settles what it reached (its last, partial line is dropped)
        var ds = Verify.decide(mk, rsT);
        if (!rs.truncated || ds.answered) final = ds.text;
      }
      else if (b && !d.same) {
        var rj = await Engine.generate(KEY, PROMPTS.judge(imgs.bands, a, b, d), imgs.blobs, { onWait: onWait, signal: sig(), system: system, context: ctx, effort: econ() ? 'medium' : 'high', best: true });
        if (rj.model) usedModels[rj.model] = 1;
        var tj = Engine.clean(rj.text); if (tj.length > Math.min(a.length, b.length) * 0.6 && !rj.truncated && !refusal(tj)) final = tj;
      } else if ((!b && !SHORT) || (b && bank && a.indexOf('⟦') >= 0 && !skipCheck(a, bank))) {
        /* one proofreading pass: second read failed, or both agree but doubts remain and the formulas may settle them */
        var rc = await Engine.generate(KEY, PROMPTS.check(imgs.bands, a), imgs.blobs, { onWait: onWait, signal: sig(), system: system, context: ctx, effort: econ() ? 'medium' : 'high', best: true });
        var tc = Engine.clean(rc.text); if (tc.length > a.length * 0.6 && !rc.truncated && !refusal(tc)) final = tc;
      }
    } catch (e) { if (e && (e.code === 'bad_key' || e.code === 'credit')) throw e; }
    var learned = 0;
    if (learnOn() && learnItems.length) {
      /* this hand's own words: a doubt the model kept on a word the family already confirmed is lifted (the guard
         below still marks it when the two reads disagree); a word corrected the same way twice before is swapped */
      var lf = Learn.applyFixes(final, learnItems, profile()), ll = Learn.applyLexicon(lf.text, learnItems, profile());
      final = ll.text; learned = lf.fixed + ll.cleared;
    }
    var g = Verify.guard(final, a, b || a, !EXAM), text = g.text, snapped = 0, spellFixed = 0;
    var myAdded = {}; (g.words || []).forEach(function (w) { myAdded[w] = 1; });     // marks the reads disagreed on (shown as such)
    var numbers = await numbersP;
    if (numbers) { var nc = Verify.checkNumbers(text, numbers); text = nc.text; }
    if (!EXAM) {
      text = Verify.houseDigits(text);                          // the office types 10/1/2020, never ١٠/١/٢٠٢٠
      if (typeof Arabic !== 'undefined') {
        text = Arabic.check(text).text;                         // amount in words = digits; weekday = date
        var dict = typeof Bank !== 'undefined' ? await Bank.load('spelling') : null;
        if (dict) text = Arabic.spell(text, dict).text;         // the office's spelling of every word (دعوى، محكمة، الأهلية…)
      }
      /* v26: the automatic spelling corrector — standard spelling of ordinary and legal words (الهيئه → الهيئة،
         علي طلب → على طلب، المدعي عليه → المدعى عليه، الزام → إلزام), never names, numbers or yellow words */
      if (typeof Dict !== 'undefined' && Dict.fix) {
        if (!Dict.ready() && Dict.load) { try { await Promise.race([Dict.load(), new Promise(function (r) { setTimeout(r, 12000); })]); } catch (e) {} }   // v31: the first paper waited for nothing
        var lex = typeof Bank !== 'undefined' ? await Bank.load('lexicon') : null; lexiconBank = lex;
        var sp = Dict.fix(text, { lexicon: lex, names: typeof Fields !== 'undefined' ? Fields.extract(text).names : [] });
        text = sp.text; spellFixed = sp.changes.length;
      }
    }
    /* v38: formula snapping (Bank.snap) no longer runs here — it is offered by «⚖️ تحسين صيغة المحاماة» */
    /* the dictionary's own marks: a word nobody knows (no dictionary, no formula, never confirmed) is shown for review */
    var dictWords = [], myDict = {};
    if (!EXAM && dictOn() && typeof Dict !== 'undefined' && Dict.ready()) {
      var dm = Dict.mark(text, knownWord(bank, text)); text = dm.text; dictWords = dm.words;
      dictWords.forEach(function (w) { myDict[Verify.norm(w)] = 1; });
    }
    curAdded = myAdded; curDict = myDict;                  // v31: this page's own reasons (pages are read side by side)
    var r = await toResult(text);
    var shown = p.raw && p.base !== p.raw ? (p.turn ? Engine.rotated(p.base, p.turn) : p.base) : p.canvas;   // the screen shows the enhanced page, turned the same way
    r.img = Engine.scaled(shown, 1600).toDataURL('image/jpeg', 0.8);
    r.agree = d ? Math.round(d.agreement * 100) : null;
    r.text = text; r.type = type; r.snapped = snapped; r.spell = spellFixed; r.learned = learned; r.secs = Math.round((Date.now() - t0) / 1000); r.ocr = ocrUsed; r.dict = dictWords.length;
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
  /* v28: «ماذا تريد في ملف Word؟» — the specialist layout (office papers / school exam) or text only on a white page.
     Remembered on this device; taken at the start of each conversion. */
  var OUT_KEY = EXAM ? 'exam.out' : 'kateb.out', OKIND_KEY = 'exam.okind', plainRun = false;
  function outMode() { return Engine.lsGet(OUT_KEY) === 'plain' ? 'plain' : 'pro'; }
  function startKind() { var k = Engine.lsGet(OKIND_KEY); return /^(exam|monthly|revision|notes)$/.test(k || '') ? k : 'exam'; }
  function paintOut() {
    if (!$('outList')) return;
    var m = outMode(), k = startKind();
    Array.prototype.forEach.call($('outList').querySelectorAll('[data-out]'), function (b) { b.setAttribute('aria-pressed', b.dataset.out === m ? 'true' : 'false'); });
    if ($('outHead')) { $('outHeadRow').hidden = m === 'plain'; $('outHead').checked = headPref(k); }
    if ($('outKinds')) { $('outKinds').hidden = m === 'plain'; Array.prototype.forEach.call($('outKinds').querySelectorAll('[data-okind]'), function (b) { b.setAttribute('aria-pressed', b.dataset.okind === k ? 'true' : 'false'); }); }
  }
  if ($('outList')) {
    $('outList').addEventListener('click', function (e) { var b = e.target.closest('[data-out]'); if (!b) return; Engine.lsSet(OUT_KEY, b.dataset.out); paintOut(); });
    if ($('outKinds')) $('outKinds').addEventListener('click', function (e) { var b = e.target.closest('[data-okind]'); if (!b) return; Engine.lsSet(OKIND_KEY, b.dataset.okind); paintOut(); });
    if ($('outHead')) $('outHead').addEventListener('change', function () { Engine.lsSet('exam.head.' + startKind(), this.checked ? '1' : '0'); });
    paintOut();
  }
  function FMT() { return EXAM ? (plainRun ? EXAM_PLAIN_FORMAT : EXAM_FORMAT) : (plainRun ? PLAIN_FORMAT : LEGAL_FORMAT); }
  async function run() {
    if (running) return; running = true; plainRun = outMode() === 'plain'; show('work'); results = []; usedModels = {}; docCost = 0;
    runAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    try { learnItems = learnOn() ? await loadLearn() : []; } catch (e) { learnItems = []; }
    if (!EXAM && dictOn() && typeof Dict !== 'undefined' && !Dict.ready()) Dict.load().catch(function () {});   // 1 MB once, in the background
    var n = pages.length, S = 3;
    try {
      /* v31: two pages are read side by side (a 2-page paper took 3 minutes one after the other); Gemini's free tier and
         the exam layout keep one at a time */
      var out = new Array(n), next = 0, prog = new Array(n).fill(0), lanes = CLAUDE && !EXAM ? Math.min(2, n) : 1;
      results = out;
      var worker = async function () {
        while (next < n) {
          var i = next++, label = n > 1 ? ('صفحة ' + (i + 1) + ' من ' + n) : 'الورقة';
          out[i] = await readPage(pages[i], label, function (k, text) { prog[i] = k; setProgress(prog.reduce(function (a, b) { return a + b; }, 0), n * S, text); setStage(Math.min.apply(null, prog.filter(function (x, j) { return j < next; }))); if (k) $('waitText').hidden = true; });
          prog[i] = S;
        }
      };
      var ws = []; for (var w = 0; w < lanes; w++) ws.push(worker());
      await Promise.all(ws);
      results = out;
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
      if (r.u) h = '<u>' + h + '</u>'; if (r.b) h = '<b>' + h + '</b>'; if (r.hl) { var why = /^\s*(؟+|[.…]{2,})\s*$/.test(r.text) ? 'unreadable' : (r.alts && r.alts.length) ? 'alts' : curDict[Verify.norm(r.text)] ? 'dict' : curAdded[Verify.norm(r.text)] ? 'disagree' : 'model'; h = '<mark data-o="' + escH(r.text) + '" data-why="' + why + '"' + (r.alts && r.alts.length ? ' data-alts="' + escH(r.alts.join('|')) + '"' : '') + '>' + h + '</mark>'; } return h;
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
    var ri = $('readerInfo'), ms = Object.keys(usedModels), nl = results.reduce(function (t, r) { return t + (r.learned || 0); }, 0), ns = restored ? 0 : results.reduce(function (t, r) { return t + (r.spell || 0); }, 0);
    var cost = restored ? (curDoc && curDoc.cost) || 0 : docCost, secs = restored ? 0 : results.reduce(function (t, r) { return t + (r.secs || 0); }, 0), no = results.filter(function (r) { return r.ocr; }).length;
    if (ri) { ri.hidden = !ms.length && !cost; ri.textContent = (ms.length ? 'قُرئت الصفحات فعلياً بـ: ' + ms.join(' + ') + (CLAUDE && Engine.fastOn() ? ' ⚡' : '') : 'محفوظ على هذا الجهاز') + (secs ? ' في ' + secs + ' ثانية' : '') + (no ? ' — ' + no + ' صفحة مطبوعة قُرئت بالقارئ المجاني على الجهاز ثم صُحّحت بطلب واحد' : '') + (nl ? ' — ' + nl + ' كلمة عُرفت من خط ' + profileLabel() : '') + (ns ? ' — صُحّحت إملائياً ' + ns + ' كلمة' : '') + (cost ? ' — تكلفة القراءة ≈ $' + cost.toFixed(2) : ''); }
    if (!restored) {
      var ps = results.map(function (r) { return { html: r.html, img: r.img, text: r.text }; });
      if (reconvertDoc) { curDoc = reconvertDoc; reconvertDoc = null; Store.addVersion(curDoc, ps, 'reread'); curDoc.pages = ps; curDoc.learned = []; }
      else {
        curDoc = Store.newDoc(MODE, autoName(), ps, { type: results[0] && results[0].type || null });
        /* the choice made on the start screen: text only → a plain page, nothing to ask; Hanan's kind chosen up front */
        curDoc.plain = plainRun;
        if (EXAM) { curDoc.kind = plainRun ? 'plain' : startKind(); curDoc.head = !plainRun && headPref(curDoc.kind); var kk = EXAM_KINDS.filter(function (x) { return x.key === curDoc.kind; })[0]; if (kk && curDoc.kind !== 'exam') curDoc.kindTitle = kk.title(); }
      }
      curDoc.cost = (curDoc.cost || 0) + docCost; curDoc.kindOk = !!(curDoc.plain || (EXAM && curDoc.kind)); curDoc.nameAuto = curDoc.name;
    }
    kindLabel();
    if ($('docName')) $('docName').value = curDoc ? curDoc.name : '';
    if ($('versionsPanel')) $('versionsPanel').hidden = true;
    if ($('learnHint')) $('learnHint').hidden = learnOn() || Engine.lsGet('kateb.learnHint') === '1';
    if ($('doneNote')) $('doneNote').hidden = !!restored;
    if (!restored && pendingAudio && curDoc) { curDoc.audio = pendingAudio.blob; curDoc.source = pendingAudio.source; curDoc.transcript = pendingAudio.transcript; curDoc.seconds = pendingAudio.seconds; pendingAudio = null; }
    if ($('audioBox')) {
      var ab = curDoc && curDoc.audio;
      $('audioBox').hidden = !ab;
      if (ab) { try { if (docAudioUrl) URL.revokeObjectURL(docAudioUrl); docAudioUrl = URL.createObjectURL(ab); $('docAudio').src = docAudioUrl; } catch (e) { $('audioBox').hidden = true; } }
    }
    if ($('fixPanel')) { $('fixPanel').hidden = true; fixes = []; }
    if ($('formBtn')) $('formBtn').hidden = !!(curDoc && curDoc.plain);      // «نص فقط» papers have no legal formulas
    renderFields();
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

  /* ---------- «بيانات الورقة»: the critical facts found in the text, to be checked one by one against the photo ---------- */
  var fieldsT = null;
  function renderFieldsSoon() { clearTimeout(fieldsT); fieldsT = setTimeout(renderFields, 300); }
  function renderFields() {
    var box = $('fieldsBox'); if (!box || EXAM || typeof Fields === 'undefined') return;
    var texts = sheets().map(function (s) { return s.textContent; });
    if (!texts.join('').trim()) { box.hidden = true; return; }
    var all = texts.map(Fields.extract), warn = Fields.consistency(texts), items = [];
    var add = function (label, v, key) { if (!items.some(function (x) { return x.key === key; })) items.push({ label: label, v: v, key: key }); };
    all.forEach(function (f) {
      f.court.forEach(function (c) { add('المحكمة', c, 'c' + c); });
      f.cases.forEach(function (c) { add('رقم القضية', Verify.arabicDigits(c.num + ' لسنة ' + c.year), 'q' + c.num + c.year); });
      f.names.forEach(function (n) { add('الاسم', n, 'n' + n); });
      f.dates.forEach(function (d) { add('التاريخ', Verify.rtlDates(Verify.arabicDigits(d.d + '/' + d.m + '/' + d.y)), 'd' + d.d + d.m + d.y); });
      f.amounts.forEach(function (a) { add('المبلغ', Verify.arabicDigits(a.value) + ' جنيه', 'a' + a.value); });
    });
    if (!items.length && !warn.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<b>🔎 بيانات الورقة — تأكد منها مع الصورة</b>' +
      (items.length ? '<div class="fchips">' + items.map(function (x) { return '<button class="fchip" type="button" data-find="' + escH(x.v) + '"><small>' + x.label + '</small>' + escH(x.v) + '</button>'; }).join('') + '</div>' : '') +
      warn.map(function (w) { return '<p class="fwarn">⚠️ ' + escH(w.text) + '</p>'; }).join('');
  }
  if ($('fieldsBox')) $('fieldsBox').addEventListener('click', function (e) {
    var b = e.target.closest('[data-find]'); if (!b) return;
    var q = Verify.stripMarks(b.dataset.find).replace(/\s+/g, ' ');
    var ss = sheets();
    for (var i = 0; i < ss.length; i++) {
      var walker = document.createTreeWalker(ss[i], NodeFilter.SHOW_TEXT), n;
      while ((n = walker.nextNode())) {
        var hay = Verify.stripMarks(n.nodeValue), at = hay.indexOf(q.split(' ')[0]); if (at < 0) continue;
        var rg = document.createRange(); rg.setStart(n, Math.min(at, n.nodeValue.length)); rg.setEnd(n, Math.min(at + q.split(' ')[0].length, n.nodeValue.length));
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rg);
        (n.parentNode.closest ? n.parentNode : ss[i]).scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    }
  });

  /* ---------- «تصحيح اللغة والإملاء» (mode B): suggestions from the reader, each accepted or rejected by hand; the
     faithful transcription stays the document, and every accepted change is one undo step ---------- */
  var fixes = [];
  async function langFix() {
    var btn = $('fixBtn'), panel = $('fixPanel'); if (!btn || running) return;
    var paras = sheets().map(function (sh) { return Array.prototype.map.call(sh.querySelectorAll('p,td'), function (p) { return Verify.stripMarks(p.textContent).replace(/\s+/g, ' ').trim(); }).filter(Boolean); });
    var numbered = [], k = 0; paras.forEach(function (ps) { ps.forEach(function (t) { numbered.push((++k) + ': ' + t); }); });
    if (!numbered.length) return;
    fixPanelFor('lang');
    btn.disabled = true; btn.textContent = '✍️ جارٍ فحص اللغة…'; panel.hidden = false; $('fixList').innerHTML = '<p class="small">يراجع Claude الإملاء والنحو الآن…</p>';
    try {
      var r = await Engine.generate(KEY, PROMPTS.fix(numbered.join('\n')), [], { best: true, effort: 'high', maxTokens: 4096, onWait: onWait });
      if (r.model) usedModels[r.model] = 1;
      fixes = parseFixes(Engine.clean(r.text));
    } catch (e) { fixes = []; $('fixList').innerHTML = '<p class="err">' + escH(Engine.errText(e)) + '</p>'; btn.disabled = false; btn.textContent = '✍️ تصحيح اللغة والإملاء'; return; }
    btn.disabled = false; btn.textContent = '✍️ تصحيح اللغة والإملاء';
    renderFixes();
  }
  /* v38 «⚖️ تحسين صيغة المحاماة» (Zeyad): the lawyers' formulas are no longer used while reading — only here, on
     request, as suggestions accepted or rejected one by one, like the spelling ones. Nothing is ever added. */
  var FIX_HEAD = {
    lang: ['✍️ تصحيح اللغة والإملاء', 'النص الأصلي كما هو يبقى هو المستند. هذه اقتراحات إملائية ونحوية فقط، تقبل أو ترفض كل واحدة بنفسك، وكل تغيير يظهر بلون مميز ويمكن التراجع عنه.'],
    form: ['⚖️ تحسين صيغة المحاماة', 'مقارنة النص بصيغ المحاماة المعروفة لهذا النوع من الأوراق: كلمة اتقرت غلط داخل صيغة، أو كلمة صفراء الصيغة توضحها. لا يُضاف أي كلام جديد — كل اقتراح تقبله أو ترفضه بنفسك.']
  };
  function fixPanelFor(mode) { if ($('fixTitle')) $('fixTitle').textContent = FIX_HEAD[mode][0]; if ($('fixDesc')) $('fixDesc').textContent = FIX_HEAD[mode][1]; fixMode = mode; }
  var fixMode = 'lang';
  function markedText(el) {                      // a paragraph with its yellow words as ⟦ ⟧ (the reviewer sees what is unsure)
    var out = '';
    (function walk(n) { if (n.nodeType === 3) out += n.nodeValue; else if (n.nodeName === 'MARK') out += '⟦' + n.textContent + '⟧'; else Array.prototype.forEach.call(n.childNodes, walk); })(el);
    return out;
  }
  async function formFix() {
    var btn = $('formBtn'), panel = $('fixPanel'); if (!btn || running || typeof Bank === 'undefined') return;
    var numbered = [], k = 0;
    sheets().forEach(function (sh) { Array.prototype.forEach.call(sh.querySelectorAll('p,td'), function (p) { var t = markedText(p).replace(/\s+/g, ' ').trim(); if (t) numbered.push((++k) + ': ' + t); }); });
    if (!numbered.length) return;
    fixPanelFor('form'); panel.hidden = false;
    btn.disabled = true; btn.textContent = '⚖️ جارٍ المقارنة بالصيغ…'; $('fixList').innerHTML = '<p class="small">يقارن Claude النص بصيغ المحاماة الآن…</p>';
    try {
      var plain = numbered.slice(0, 4).join(' ');
      var type = tplKey() || (curDoc && curDoc.type) || (typeof Office !== 'undefined' ? Office.detect(numbered.join('\n')) : '') || '';
      var bank = type ? await Bank.load(type) : null, cb = await caseBank(plain);
      if (glossaryBank === undefined) { try { glossaryBank = await Bank.load('glossary'); } catch (e) { glossaryBank = null; } }
      var refs = (bank ? Bank.promptText(bank, 400) + '\n' : '') + (cb ? Bank.promptText(cb, 300) + '\n' : '') + (glossaryBank ? Bank.promptText(glossaryBank, 300) : '');
      var label = (cb && cb.label) || TYPE_LABEL[type] || 'ورقة محكمة';
      var r = await Engine.generate(KEY, PROMPTS.form(label, refs, numbered.join('\n')), [], { best: true, effort: 'medium', maxTokens: 4096, onWait: onWait });
      if (r.model) usedModels[r.model] = 1;
      fixes = parseFixes(Engine.clean(r.text));
    } catch (e) { fixes = []; $('fixList').innerHTML = '<p class="err">' + escH(Engine.errText(e)) + '</p>'; }
    btn.disabled = false; btn.textContent = '⚖️ تحسين صيغة المحاماة';
    if (fixes.length || !$('fixList').querySelector('.err')) renderFixes();
  }
  function parseFixes(t) {
    var out = [];
    String(t || '').split('\n').forEach(function (line) {
      var m = line.match(/^\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*(?:\|\s*(.*))?$/); if (!m) return;
      var from = m[2].replace(/[«»"]/g, '').trim(), to = m[3].replace(/[«»"]/g, '').trim();
      if (!from || !to || from === to || /[0-9٠-٩]/.test(from) || /[0-9٠-٩]/.test(to)) return;     // numbers are never touched here
      out.push({ line: +m[1], from: from, to: to, why: (m[4] || '').trim(), state: '' });
    });
    return out;
  }
  function renderFixes() {
    var list = $('fixList'), open = fixes.filter(function (x) { return !x.state; });
    if (!fixes.length) { list.innerHTML = '<p class="small">' + (fixMode === 'form' ? '✅ النص متوافق مع صيغ المحاماة المعروفة — لا اقتراحات.' : '✅ لم يجد Claude أخطاء إملائية أو نحوية تستحق التغيير.') + '</p>'; return; }
    list.innerHTML = '<p class="small">' + (open.length ? open.length + ' اقتراح' + (open.length === 1 ? '' : 'ات') + ' — كل اقتراح تقبله أو ترفضه بنفسك؛ الأسماء والأرقام والتواريخ لا تُمس.' : 'انتهت المراجعة.') + '</p>' +
      fixes.map(function (x, i) {
        return '<div class="fixrow' + (x.state ? ' ' + x.state : '') + '"><span><s>' + escH(x.from) + '</s> ← <b>' + escH(x.to) + '</b>' + (x.why ? '<small>' + escH(x.why) + '</small>' : '') + '</span>' +
          (x.state === 'ok' ? '<small>✓ تم</small>' : x.state === 'no' ? '<small>✗ رُفض</small>' : x.state === 'miss' ? '<small>لم يُعثر على النص (ربما عُدّل)</small>' : '<span class="fixbtns"><button class="btn sm go" type="button" data-fix="' + i + '">قبول</button><button class="btn sm" type="button" data-nofix="' + i + '">رفض</button></span>') + '</div>';
      }).join('') + (open.length > 1 ? '<button class="linkbtn" type="button" id="fixAll">قبول كل الاقتراحات</button>' : '');
  }
  function applyFix(x) {
    /* v38: the text may run across bold/underline runs and yellow marks («⟦....⟧» in a suggestion = the yellow word) */
    var needle = String(x.from).replace(/⟦([^⟧|]*)(\|[^⟧]*)?⟧/g, '$1').replace(/\s+/g, ' ').trim(); if (!needle) return false;
    var paras = []; sheets().forEach(function (s) { paras = paras.concat(Array.prototype.slice.call(s.querySelectorAll('p,td'))); });
    for (var i = 0; i < paras.length; i++) {
      var walker = document.createTreeWalker(paras[i], NodeFilter.SHOW_TEXT), n, nodes = [], all = '';
      while ((n = walker.nextNode())) { nodes.push({ n: n, at: all.length }); all += n.nodeValue; }
      var flat = all.replace(/\s/g, ' '), at = flat.indexOf(needle); if (at < 0) continue;
      var end = at + needle.length, sN, sO, eN, eO;
      nodes.forEach(function (o) { var L = o.n.nodeValue.length; if (sN === undefined && at < o.at + L) { sN = o.n; sO = at - o.at; } if (eN === undefined && end <= o.at + L) { eN = o.n; eO = end - o.at; } });
      if (!sN || !eN) continue;
      var rg = document.createRange(); rg.setStart(sN, sO); rg.setEnd(eN, eO); rg.deleteContents();
      var span = document.createElement('span'); span.className = 'fixd'; span.textContent = x.to; span.title = x.why || (fixMode === 'form' ? 'صيغة المحاماة' : 'تصحيح لغوي');
      rg.insertNode(span);
      Array.prototype.forEach.call(paras[i].querySelectorAll('mark'), function (m) { if (!m.textContent.trim()) m.remove(); });
      return true;
    }
    return false;
  }
  if ($('fixBtn')) {
    $('fixBtn').addEventListener('click', langFix);
    if ($('formBtn')) $('formBtn').addEventListener('click', formFix);
    $('fixClose').addEventListener('click', function () { $('fixPanel').hidden = true; });
    $('fixList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-fix],[data-nofix],#fixAll'); if (!b) return;
      var todo = b.id === 'fixAll' ? fixes.filter(function (x) { return !x.state; }) : b.dataset.fix !== undefined ? [fixes[+b.dataset.fix]] : [];
      if (b.dataset.nofix !== undefined) fixes[+b.dataset.nofix].state = 'no';
      todo.forEach(function (x) { x.state = applyFix(x) ? 'ok' : 'miss'; });
      if (todo.length) { refreshDoubts(); histCommit(); queueSave(); }
      renderFixes();
    });
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
    sel.value = curDoc && curDoc.plain ? '' : key || '';
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
      ? 'يوجد بعض الكلمات التي تحتاج مراجعة (' + n + '). اضغط «مراجعة الكلمات»، قارن كل كلمة بالصورة، صحّحها أو اختر القراءة الصحيحة، ثم اضغط «صحيح».'
      : 'لا توجد كلمات مشكوك فيها. راجع النص مع الصورة مرة قبل الحفظ.')
      + (low ? ' ⚠️ القراءتان اختلفتا كثيراً في هذه الورقة: الصورة قد تكون غير واضحة، راجع بعناية أو صوّرها مرة أخرى.' : '');
    $('doubtNote').className = n || low ? 'note' : 'note ok';
    if ($('reviewBtn')) $('reviewBtn').hidden = !n;
    $('doubtCount').textContent = n ? n + ' غير مؤكدة' : 'لا يوجد';
    $('doubtBar').hidden = !n || $('done').hidden;
    if (!n && $('altChips')) { $('altChips').innerHTML = ''; $('whyNote').textContent = ''; }
    renderFieldsSoon();
  }
  if ($('reviewBtn')) $('reviewBtn').addEventListener('click', nextDoubt);
  var WHY = { dict: 'ليست في القاموس العربي ولا في صيغ المكتب: قد تكون اسمًا صحيحًا أو خطأ قراءة، تأكد من الصورة', model: 'القارئ غير متأكد من هذه الكلمة', alts: 'القارئ متردد بين قراءتين — اختر الصحيحة من الصورة', disagree: 'القراءتان اختلفتا على هذه الكلمة', unreadable: 'غير مقروءة في الصورة — اكتبها بنفسك' };
  /* the pill under a focused word: why it is yellow + the readings to pick from */
  function showAlts(m) {
    var chips = $('altChips'), why = $('whyNote'); if (!chips) return;
    var curText = m.textContent.trim(), alts = (m.dataset.alts || '').split('|').map(function (x) { return x.trim(); }).filter(Boolean);
    var list = [curText].concat(alts.filter(function (a) { return a !== curText; })).map(function (a) { return EXAM ? a : Verify.arabicDigits(a); });
    chips.innerHTML = alts.length ? list.map(function (a, i) { return '<button class="chip' + (i === 0 ? ' on' : '') + '" type="button" data-alt="' + escH(a) + '">' + escH(a) + '</button>'; }).join('') : '';
    why.textContent = WHY[m.dataset.why] || WHY.model;
  }
  if ($('altChips')) $('altChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-alt]'), m = document.querySelector('#pagesBox mark.cur'); if (!b || !m) return;
    var ms = marks(), i = ms.indexOf(m);
    m.textContent = b.dataset.alt;
    learnConfirm(m); confirmMark(m); refreshDoubts(); histCommit(); queueSave();
    ms = marks(); if (ms.length) focusMark(ms[Math.min(i, ms.length - 1)]);
  });
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
    showAlts(m);
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
    var o = e.target.closest && e.target.closest('.orig'); if (o) { zoomCanvas = null; zoomShot = -1; zoomName = 'الأصل ' + stamp() + '.jpg'; $('zoomImg').src = o.querySelector('img').src; $('zoomImg').hidden = false; if ($('scanBar')) { $('scanBar').hidden = true; $('cropBox').hidden = true; } $('zoom').hidden = false; if ($('zoomSave')) $('zoomSave').hidden = false; $('zoomClose').focus(); }
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
  var zoomCanvas = null, zoomName = '', zoomShot = -1, zoomSide = 'clean';
  function openScan(i) {
    var sh = shots[i]; if (!sh) return;
    zoomShot = i; zoomSide = 'clean'; zoomName = 'صفحة ' + (i + 1) + ' ' + stamp() + '.jpg';
    showSide();
    $('zoom').hidden = false; if ($('zoomSave')) $('zoomSave').hidden = false;
    if ($('scanBar')) { $('scanBar').hidden = false; $('cropBox').hidden = true; $('zoomImg').hidden = false; }
    $('zoomClose').focus();
  }
  function showSide() {
    var sh = shots[zoomShot]; if (!sh) return;
    zoomCanvas = zoomSide === 'orig' ? sh.orig : sh.clean;
    $('zoomImg').src = zoomCanvas.toDataURL('image/jpeg', 0.92);
    if ($('sideOrig')) { $('sideOrig').setAttribute('aria-pressed', zoomSide === 'orig'); $('sideClean').setAttribute('aria-pressed', zoomSide === 'clean'); }
  }
  /* corner editor: the photo with the four corners of the paper, each one draggable; «✅ استخدام الصورة» straightens again */
  var cropQ = null, cropK = 1, cropDrag = -1;
  function openCrop() {
    var sh = shots[zoomShot]; if (!sh) return;
    var c = $('cropCanvas'), maxW = Math.min(window.innerWidth - 32, 900), maxH = window.innerHeight - 200;
    cropK = Math.min(maxW / sh.orig.width, maxH / sh.orig.height, 1);
    c.width = Math.round(sh.orig.width * cropK); c.height = Math.round(sh.orig.height * cropK);
    var q = sh.quad || [[0, 0], [sh.orig.width, 0], [sh.orig.width, sh.orig.height], [0, sh.orig.height]];
    cropQ = q.map(function (p) { return [p[0] * cropK, p[1] * cropK]; });
    $('cropBox').hidden = false; $('zoomImg').hidden = true; drawCrop();
  }
  function drawCrop() {
    var sh = shots[zoomShot], c = $('cropCanvas'), x = c.getContext('2d');
    x.drawImage(sh.orig, 0, 0, c.width, c.height);
    x.fillStyle = 'rgba(0,0,0,0.45)'; x.fillRect(0, 0, c.width, c.height);
    x.save(); x.beginPath(); x.moveTo(cropQ[0][0], cropQ[0][1]); for (var i = 1; i < 4; i++) x.lineTo(cropQ[i][0], cropQ[i][1]); x.closePath(); x.clip(); x.drawImage(sh.orig, 0, 0, c.width, c.height); x.restore();
    x.strokeStyle = '#2563EB'; x.lineWidth = 3; x.beginPath(); x.moveTo(cropQ[0][0], cropQ[0][1]); for (i = 1; i < 4; i++) x.lineTo(cropQ[i][0], cropQ[i][1]); x.closePath(); x.stroke();
    cropQ.forEach(function (p) { x.beginPath(); x.arc(p[0], p[1], 14, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill(); x.strokeStyle = '#2563EB'; x.lineWidth = 4; x.stroke(); });
  }
  function cropPoint(e) { var r = $('cropCanvas').getBoundingClientRect(), t = e.touches ? e.touches[0] : e; return [(t.clientX - r.left) * $('cropCanvas').width / r.width, (t.clientY - r.top) * $('cropCanvas').height / r.height]; }
  if ($('cropCanvas')) {
    var cc = $('cropCanvas');
    var down = function (e) { var p = cropPoint(e), best = -1, bd = 40; cropQ.forEach(function (q, i) { var d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } }); cropDrag = best; if (best >= 0) e.preventDefault(); };
    var move = function (e) { if (cropDrag < 0) return; var p = cropPoint(e); cropQ[cropDrag] = [Math.max(0, Math.min(cc.width, p[0])), Math.max(0, Math.min(cc.height, p[1]))]; drawCrop(); e.preventDefault(); };
    var up = function () { cropDrag = -1; };
    cc.addEventListener('mousedown', down); cc.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    cc.addEventListener('touchstart', down, { passive: false }); cc.addEventListener('touchmove', move, { passive: false }); cc.addEventListener('touchend', up);
    $('cropBtn').addEventListener('click', openCrop);
    $('cropCancel').addEventListener('click', function () { $('cropBox').hidden = true; $('zoomImg').hidden = false; });
    $('cropUse').addEventListener('click', function () {
      var sh = shots[zoomShot]; if (!sh) return;
      var q = cropQ.map(function (p) { return [p[0] / cropK, p[1] / cropK]; });
      var full = q.every(function (p, i) { var ref = [[0, 0], [sh.orig.width, 0], [sh.orig.width, sh.orig.height], [0, sh.orig.height]][i]; return Math.hypot(p[0] - ref[0], p[1] - ref[1]) < 3; });
      shots[zoomShot] = shotOf(sh.orig, false, full ? null : q); renderTray();
      $('cropBox').hidden = true; $('zoomImg').hidden = false; zoomSide = 'clean'; showSide();
    });
    $('cropFull').addEventListener('click', function () { var c2 = $('cropCanvas'); cropQ = [[0, 0], [c2.width, 0], [c2.width, c2.height], [0, c2.height]]; drawCrop(); });
    $('sideOrig').addEventListener('click', function () { zoomSide = 'orig'; showSide(); });
    $('sideClean').addEventListener('click', function () { zoomSide = 'clean'; showSide(); });
    $('useBtn').addEventListener('click', function () { $('zoom').hidden = true; });
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
      if (curDoc.audio) {
        if (!window.confirm('إعادة تفريغ التسجيل من جديد؟ النص الحالي يبقى في «نسخ سابقة».')) return;
        clearTimeout(saveT); await saveDraft(true); reconvertDoc = curDoc; convertAudio(curDoc.audio, { source: curDoc.source || 'audio', seconds: curDoc.seconds }); return;
      }
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
    else if (w && o) queueLearn(function (items) { return Learn.record(items, profile(), 'fix', o, w); });
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
  async function renderMathRefs() {
    var box = $('mathRefList'); if (!box || typeof Bank === 'undefined') return;
    if (mathBank === undefined) { try { mathBank = await Bank.load('exam_math'); } catch (e) { mathBank = null; } }
    if (!mathBank) { box.textContent = 'تعذر تحميل المراجع.'; return; }
    var my = gradeKey(Engine.lsGet('exam.hGrade'));
    box.innerHTML = Object.keys(mathBank.grades).map(function (k) {
      var G = mathBank.grades[k];
      var terms = ['1', '2'].map(function (t) { return '<p class="small"><b>' + (t === '1' ? 'الترم الأول' : 'الترم الثاني') + '</b></p><ul class="mref">' + (G.terms[t] || []).map(function (u) { return '<li>' + escH(u.unit) + (u.lessons && u.lessons.length ? '<small> — ' + escH(u.lessons.join('، ')) + '</small>' : '') + '</li>'; }).join('') + '</ul>'; }).join('');
      var books = (G.books || []).map(function (b) { return '<li><a href="' + escH(b.url) + '" target="_blank" rel="noopener">' + escH(b.title) + '</a>' + (b.official ? ' <small>(موقع الوزارة)</small>' : '') + '</li>'; }).join('');
      return '<details' + (k === my ? ' open' : '') + '><summary><b>' + escH(G.label) + '</b></summary>' + terms + (books ? '<p class="small"><b>📘 كتب الوزارة والتقييمات</b></p><ul class="mref">' + books + '</ul>' : '') + '</details>';
    }).join('') + '<p class="small">تُستخدم مفردات صف الامتحان وتعليمات الأسئلة لقراءة خطك بدقة وكتابة المصطلحات صح — ولا يُضاف أي سؤال أو كلمة من عندها.</p>';
  }
  function renderSettings() {
    if (EXAM) renderMathRefs();
    show('settings');
    $('setLearnState').textContent = learnOn() ? 'مفعّل — ' + profileLabel() : 'غير مفعّل';
    $('setEnhance').checked = enhanceOn();
    if ($('setFast')) $('setFast').checked = Engine.fastOn();
    if ($('setOcr')) $('setOcr').checked = ocrOn();
    if ($('setDict')) $('setDict').checked = dictOn();
    Array.prototype.forEach.call(document.querySelectorAll('input[name="mode"]'), function (r) { r.checked = r.value === (econ() ? 'econ' : 'best'); });
    audioKeyState();
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
      '<p class="small">التكلفة محسوبة من عدد الرموز في كل رد على أسعار Anthropic المعلنة (Opus 5.5: $4 / $20 للمليون، ومع ⚡ وضع السرعة $8 / $40؛ Sonnet 5.5: $2 / $10؛ Haiku 5.5: $0.10 / $0.50؛ الذاكرة المؤقتة أرخص). الرقم الرسمي والرصيد المتبقي في console.anthropic.com → Usage. هذا الجهاز فقط: كل جهاز يحسب استهلاكه.</p>';
  }
  if ($('usageResetBtn')) $('usageResetBtn').addEventListener('click', function () { if (window.confirm('تصفير عداد الاستهلاك على هذا الجهاز؟')) { Engine.usageReset(); renderUsage(); } });
  if ($('settings')) {
    $('setLearnBtn').addEventListener('click', renderLearn);
    $('setEnhance').addEventListener('change', function () { if ($('enhanceChk')) $('enhanceChk').checked = this.checked; });
    if ($('setFast')) $('setFast').addEventListener('change', function () { Engine.setFast(this.checked); });
    if ($('setOcr')) $('setOcr').addEventListener('change', function () { Engine.lsSet('kateb.ocr', this.checked ? '1' : '0'); });
    if ($('setDict')) $('setDict').addEventListener('change', function () { Engine.lsSet('kateb.dict', this.checked ? '1' : '0'); });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="mode"]'), function (r) { r.addEventListener('change', function () { if (this.checked) setMode(this.value); }); });
    if ($('audioKeySave')) {
      $('audioKeySave').addEventListener('click', async function () {
        var k = $('audioKeyIn').value.trim(); if (!k) return;
        if (Engine.provider(k) !== 'gemini') { $('audioKeyState').textContent = 'هذا ليس مفتاح Gemini (يبدأ بـ AIza).'; return; }
        this.disabled = true; this.textContent = 'جارٍ الاختبار…';
        try { await Engine.listModels(k); Engine.setAudioKey(k); $('audioKeyIn').value = ''; audioKeyState(); }
        catch (e) { $('audioKeyState').textContent = 'المفتاح لا يعمل. انسخه من جديد.'; }
        this.disabled = false; this.textContent = 'حفظ المفتاح';
      });
      $('audioKeyClear').addEventListener('click', function () { if (window.confirm('حذف مفتاح الصوت من هذا الجهاز؟')) { Engine.setAudioKey(''); audioKeyState(); } });
    }
    $('deleteAllBtn').addEventListener('click', function () {
      var everywhere = typeof Sync !== 'undefined' && Sync.on();
      if (!window.confirm(everywhere ? 'حذف كل الملفات نهائيًا من كل الأجهزة (الملفات مشتركة بين كل أجهزة الكاتب)، بما فيها المحذوفات؟ لا يمكن التراجع عن هذا.' : 'حذف كل الملفات المحفوظة على هذا الجهاز نهائيًا (بما فيها المحذوفات)؟ لا يمكن التراجع عن هذا.')) return;
      Store.listDocs(MODE).then(function (ds) { return Store.listTrash(MODE).then(function (ts) { return Promise.all(ds.concat(ts).map(function (d) { return Store.purgeDoc(d.id); })); }); })
        .then(function () { try { localStorage.removeItem(DRAFT); localStorage.removeItem(LAST); } catch (e) {} curDoc = null; results = []; renderSettings(); });
    });
    $('deleteLearnBtn').addEventListener('click', deleteLearn);
    if ($('syncNow')) $('syncNow').addEventListener('click', function () { if (typeof Sync !== 'undefined') Sync.sync(); });
    /* v36: connect once with Zeyad's GitHub token, on one device; the others pick it up by themselves */
    if ($('syncConnect')) $('syncConnect').addEventListener('click', async function () {
      var t = ($('syncTok').value || '').trim(), btn = this; if (!t || typeof Sync === 'undefined') return;
      btn.disabled = true; btn.textContent = 'جارٍ الربط…'; $('syncErr').hidden = true;
      try {
        var r = await Sync.connect(KEY, ($('syncRepo') && $('syncRepo').value.trim()) || '', t);
        $('syncTok').value = ''; syncStarted = false; startSync(); await Sync.sync();
        $('syncDone').hidden = false; $('syncDone').textContent = r.shared ? '✓ تم الربط. باقي الأجهزة (الكمبيوترات والموبايلات) تتربط وحدها أول ما تفتح الكاتب — بدون أي خطوة.' : '✓ تم الربط على هذا الجهاز. لربط باقي الأجهزة لازم الرمز يشمل مستودع الموقع كمان.';
      } catch (e) { $('syncErr').hidden = false; $('syncErr').textContent = Sync.msg(e); }
      btn.disabled = false; btn.textContent = 'ربط'; paintSync(Sync.status());
    });
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

  function audioKeyState() {
    var el = $('audioKeyState'); if (!el) return;
    var k = Engine.audioKey(KEY);
    el.textContent = k ? '✅ مفتاح الصوت موجود (' + k.slice(0, 6) + '…). الإملاء الصوتي ورفع التسجيلات يعملان.' : 'لا يوجد مفتاح صوت: الإملاء الصوتي يعمل بمحرك المتصفح فقط (أقل دقة)، ورفع التسجيلات لا يعمل.';
  }

  /* ---------- KATEB20: voice dictation and audio files → the same review screen ----------
     Recording and the live text run in the browser; the final transcript comes from Gemini (the audio key — Claude
     does not hear) chunk by chunk, then Claude lays the words out as the written paper (no word added or changed). */
  var rec = null, liveRec = null, recBlob = null, recSecs = 0, liveParts = [], liveHist = [], waveT = null, recAudioUrl = null, docAudioUrl = null, pendingAudio = null, audioSel = null;
  function voiceScreen(back) {
    var dr = null; try { dr = localStorage.getItem(LIVE_DRAFT); } catch (e) {}
    show('voice', back); if (!back) resetRec();
    $('voiceErr').hidden = true;
    if (!Speech.recSupported()) { $('voiceErr').hidden = false; $('voiceErr').textContent = 'هذا المتصفح لا يدعم التسجيل. افتح الرابط في كروم أو سفاري.'; $('recStart').disabled = true; }
    else $('recStart').disabled = false;
    $('voiceHint').textContent = 'اضغط «ابدأ التسجيل» واقرأ الورقة بصوت واضح. الكلام يُكتب أمامك أثناء الكلام؛ أوقف مؤقتًا وصحّح أي كلمة بنفسك ثم استكمل. في النهاية يُحوَّل إلى Word منسّق.';
    /* a dictation left unfinished (the page was closed): it comes back */
    if (dr && !$('liveEdit').value && !rec) { $('liveEdit').value = dr; saveLive(); $('liveBox').hidden = false; $('liveConvert').hidden = false; $('liveInterim').textContent = 'رجع آخر نص لم يُحوَّل بعد — استكمل التسجيل أو حوّله.'; }
  }
  function resetRec() {
    if (rec) { try { rec.stop(); } catch (e) {} } rec = null; if (liveRec) { try { liveRec.stop(); } catch (e) {} } liveRec = null;
    recBlob = null; recSecs = 0; liveParts = []; liveHist = []; clearInterval(waveT); waveT = null;
    if (recAudioUrl) { try { URL.revokeObjectURL(recAudioUrl); } catch (e) {} recAudioUrl = null; }
    $('recStat').className = 'recstat'; $('recState').textContent = 'جاهز للتسجيل'; $('recTime').textContent = '٠:٠٠';
    $('recStart').hidden = false; $('recPause').hidden = true; $('recResume').hidden = true; $('recStop').hidden = true;
    $('liveBox').hidden = true; $('liveEdit').value = ''; $('liveInterim').textContent = ''; liveCaret = null; saveLive(); $('recDone').hidden = true; $('recNote').textContent = '';
    $('liveConvert').hidden = true; if ($('recExact')) $('recExact').hidden = true;
    if ($('wave')) Speech.drawWave($('wave'), [], false);
  }
  /* v27: live dictation you can edit (Zeyad: «الكلام يظهر قدامه وهو بيتكلم ويقدر يوقف ويعدّل»). What the browser hears is
     written into an editable box at the cursor — at the end unless the person tapped somewhere to correct — and the
     grey line under it is what is still being heard. The box is the transcript: converting uses it as edited. */
  var liveCaret = null, LIVE_DRAFT = 'kateb.liveDraft';
  function saveLive() { try { var v = $('liveEdit').value; if (v.trim()) localStorage.setItem(LIVE_DRAFT, v); else localStorage.removeItem(LIVE_DRAFT); } catch (e) {} }
  function liveInsert(p) {
    var ta = $('liveEdit'), v = ta.value, at = liveCaret === null || liveCaret > v.length ? v.length : liveCaret, piece;
    if (p.paragraph) piece = '\n\n';
    else if (p.heading) piece = '\n' + p.text + '\n';
    else piece = (p.newline ? '\n' : '') + (p.text || '');
    if (!piece) return;
    var before = v.slice(0, at), after = v.slice(at);
    if (before && !/\s$/.test(before) && !/^\n/.test(piece)) piece = ' ' + piece;
    if (after && !/^\s/.test(after) && !/\n$/.test(piece)) piece += ' ';
    ta.value = before + piece + after;
    var end = (before + piece).length;
    if (liveCaret !== null) liveCaret = end;                      // keeps writing where the person put the cursor
    try { if (document.activeElement === ta) ta.setSelectionRange(end, end); } catch (e) {}
    if (liveCaret === null) ta.scrollTop = ta.scrollHeight;
    saveLive();
    $('liveConvert').hidden = !(rec && rec.state && rec.state() === 'paused') || !ta.value.trim();
  }
  /* the person moves the cursor or types: new speech goes there; back at the very end → follow the end again */
  ['click', 'keyup', 'input', 'select', 'touchend'].forEach(function (ev) {
    if ($('liveEdit')) $('liveEdit').addEventListener(ev, function () {
      var ta = $('liveEdit'); liveCaret = ta.selectionEnd >= ta.value.length ? null : ta.selectionEnd;
      if (ev === 'input') { saveLive(); if (!rec) $('liveConvert').hidden = !ta.value.trim(); }
    });
  });
  /* the transcript for the layout step: the box as the person left it */
  function liveText() { return $('liveEdit') ? $('liveEdit').value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : ''; }
  if ($('recStart')) {
    /* v33 live dictation that works everywhere. On the family's Chrome (PC and phone) the browser's own speech engine
       failed with «network» and the app restarted it silently forever: nothing was ever written.
       - with the free audio key (Gemini): the app writes the words itself — every short pause (or 12 s) the newest
         seconds go to the key and the text is added in order, a few seconds behind the voice;
       - without it: the browser's engine, and if it fails the person is told at once and shown the keyboard's 🎤. */
    var liveQ = Promise.resolve(), liveQuiet = 0, liveT = null, livePending = 0, liveFail = 0, liveMode = '';
    function showPending() {
      if (liveMode !== 'key' && liveMode !== 'local') return;
      var pr = liveMode === 'local' && typeof LocalASR !== 'undefined' ? LocalASR.progress() : null;
      $('liveInterim').textContent = pr && !pr.loaded && (livePending || pr.pct) ? '⏳ تجهيز الكتابة بالصوت على هذا الجهاز لأول مرة (مرة واحدة فقط)… ' + pr.pct + '٪ — كلامك محفوظ وسيُكتب بعدها'
        : livePending ? '✍️ جارٍ كتابة ما قلته…' : liveMode === 'local' ? 'تكلّم… الكلام يُكتب بعد كل وقفة قصيرة.' : '';
    }
    /* v44: the engine built into the app (Whisper on this device) — for Brave and any browser without a speech engine */
    function sendLocal(pcm) {
      if (!pcm || typeof LocalASR === 'undefined') return;
      livePending++; showPending();
      var job = LocalASR.transcribe(pcm, EXAM ? 'english' : 'arabic').then(function (t) { return t; }, function (e) { return { err: e }; });
      liveQ = liveQ.then(function () { return job; }).then(function (t) {
        livePending--;
        if (t && t.err) { liveFail++; $('liveInterim').textContent = 'تعذّر تشغيل الكتابة بالصوت على هذا الجهاز — اكتب أو استخدم ميكروفون لوحة المفاتيح 🎤.'; return; }
        if (t) { var p = $('cmdChk') && $('cmdChk').checked ? Speech.command(t) : { text: t }; if (p.text) p.text = liveFix(p.text); liveParts.push(p); liveInsert(p); }
        showPending();
      });
    }
    if (typeof LocalASR !== 'undefined') LocalASR.onProgress(function (pr) {
      if (liveMode === 'local') showPending();
      if ($('asrNote')) { $('asrNote').hidden = false; $('asrNote').textContent = pr.loaded ? '✓ الكتابة بالصوت جاهزة على هذا الجهاز — تكلّم ويُكتب كلامك بعد كل وقفة قصيرة.' : '⏳ تجهيز الكتابة بالصوت على هذا الجهاز لأول مرة (مرة واحدة فقط)… ' + (pr.pct || 0) + '٪'; }
    });
    /* v48: without an audio key and without a browser engine (Brave), the voice screen offers the free key right there */
    function paintKeyBox() { if ($('vKeyBox')) $('vKeyBox').hidden = !!Engine.audioKey(KEY) || (Speech.liveSupported() && !isBrave()); }
    if ($('voiceBtn')) $('voiceBtn').addEventListener('click', paintKeyBox);
    if ($('vKeySave')) $('vKeySave').addEventListener('click', async function () {
      var k = ($('vKeyIn').value || '').trim(), b = this; if (!k) return;
      if (Engine.provider(k) !== 'gemini') { $('vKeyMsg').textContent = 'المفتاح يبدأ بـ AIza — انسخه من جديد.'; return; }
      b.disabled = true; b.textContent = 'جارٍ التحقق…';
      try { await Engine.listModels(k); Engine.setAudioKey(k); $('vKeyIn').value = ''; $('vKeyMsg').textContent = '✓ تم — الكلام سيُكتب الآن وأنت تتكلم.'; setTimeout(paintKeyBox, 1500); if (typeof audioKeyState === 'function') try { audioKeyState(); } catch (e) {} }
      catch (e) { $('vKeyMsg').textContent = 'المفتاح لا يعمل — تأكد أنك نسخته كاملًا.'; }
      b.disabled = false; b.textContent = 'حفظ';
    });
    /* the engine is prepared as soon as the voice screen opens, so it is ready when the person starts talking */
    if ($('voiceBtn')) $('voiceBtn').addEventListener('click', function () { if (needLocal()) { if ($('asrNote')) { $('asrNote').hidden = false; $('asrNote').textContent = '⏳ تجهيز الكتابة بالصوت على هذا الجهاز…'; } LocalASR.load().catch(function () { if ($('asrNote')) $('asrNote').textContent = 'تعذّر تجهيز الكتابة بالصوت على هذا الجهاز — استخدم ميكروفون لوحة المفاتيح 🎤.'; }); } });
    function needLocal() { return !Engine.audioKey(KEY) && (!Speech.liveSupported() || isBrave()) && typeof LocalASR !== 'undefined' && LocalASR.supported(); }
    function sendSeg(aKey, wav) {
      if (!wav) return;
      livePending++; showPending();
      var job = (async function () {
        try {
          var ms = await Engine.audioModels(aKey);
          var r = await Promise.race([Engine.generate(aKey, PROMPTS.transcribe(1, 1, $('cmdChk') ? $('cmdChk').checked : true), [wav], { models: ms, temperature: 0.1, maxTokens: 2048 }),
            new Promise(function (_, rej) { setTimeout(function () { rej({ code: 'timeout' }); }, 30000); })]);   // v49: never «جارٍ كتابة» forever
          return Engine.clean(r.text).replace(/^\s*(لا يوجد كلام|لا شيء)\.?\s*$/gm, '').trim();
        } catch (e) { return { err: e }; }
      })();
      liveQ = liveQ.then(function () { return job; }).then(function (t) {
        livePending--;
        if (t && t.err) { liveFail++; liveWhy = 'key: ' + ((t.err && (t.err.code || t.err.status)) || '') + ' ' + ((t.err && t.err.body) || '').slice(0, 120); engineNote(); $('liveInterim').textContent = 'تعذّرت كتابة جزء من الكلام (' + (t.err.code === 'timeout' ? 'لا رد من جوجل' : Engine.errText(t.err)) + ') — سيُكتب كاملًا من التسجيل عند «إنهاء التسجيل».'; return; }
        if (t) { t = liveFix(t); liveParts.push({ text: t }); liveInsert({ text: t }); }
        showPending();
      });
    }
    var liveHeard = 0, liveGotResult = false, liveStartT = 0;
    var liveOnTick = null;
    function liveTick(aKey) {
      /* v49 phones: the browser engine records alone (no samples, no level); nothing back for 10 s → hand over */
      if (rec && !rec.pcmReady && liveMode === 'browser' && rec.state() === 'recording' && !liveGotResult && Date.now() - liveStartT > 10000) { liveGotResult = true; if (liveRec) { try { liveRec.stop(); } catch (e) {} liveRec = null; } liveWhy = 'محرك المتصفح لم يكتب شيئًا'; liveBrowserFailed('silent'); return; }
      if (!rec || !rec.pcmReady || !rec.pcmReady() || rec.state() !== 'recording') return;
      var pend = rec.pending(), lvl = rec.level(); liveQuiet = lvl < 0.02 ? liveQuiet + 1 : 0;
      /* v46: the browser's engine heard nothing back while the person was clearly talking (phones where it silently does
         nothing) → the built-in engine takes over; what was said so far is still in the buffer and gets written */
      if (liveMode === 'browser') {
        if (lvl > 0.025) liveHeard++;
        if (!liveGotResult && liveHeard >= 12 && Date.now() - liveStartT > 7000) { if (liveRec) { try { liveRec.stop(); } catch (e) {} liveRec = null; } liveBrowserFailed('silent'); return; }
        if (liveGotResult && pend > 25) rec.cutPcm(0);                    // the engine works: the kept samples are not needed
        return;
      }
      if (liveMode === 'stream') { if (pend > 25) rec.cutPcm(0); return; }      // Gemini Live gets the samples as they come
      if (liveMode === 'local') { if (pend >= 8 || (pend >= 1.5 && liveQuiet >= 2)) { liveQuiet = 0; sendLocal(rec.cutPcm(0.8)); } return; }   // shorter pieces: written sooner
      if (pend >= 12 || (pend >= 3 && liveQuiet >= 2)) { liveQuiet = 0; sendSeg(aKey, rec.cut(0.8)); }   // a pause between phrases (0.6 s quiet), or 12 s at most
    }
    function engineNote() {
      if (!$('asrNote')) return;
      var t = liveMode === 'stream' ? '🎙️ الكتابة: مباشرة عبر مفتاح الصوت (Gemini Live)' : liveMode === 'browser' ? '🎙️ الكتابة: محرك المتصفح (مباشر)' : liveMode === 'local' ? '🎙️ الكتابة: المحرك المدمج في البرنامج' + (typeof LocalASR !== 'undefined' && LocalASR.device() ? ' (' + LocalASR.device() + ')' : '') : liveMode === 'key' ? '🎙️ الكتابة: مفتاح الصوت' : '';
      if (liveWhy) t += ' — ⚠️ ' + liveWhy;
      if (t) { $('asrNote').hidden = false; $('asrNote').textContent = t; }
    }
    /* v46: nothing was written live but the recording has sound → the built-in engine writes the whole recording */
    async function localWholeRecording(blob) {
      if (!blob || !blob.size || typeof LocalASR === 'undefined' || !LocalASR.supported()) return false;
      var d; try { d = await Speech.decode(blob); } catch (e) { return false; }
      var S = d.samples, R = d.rate, step = 20 * R, n = Math.ceil(S.length / step), got = false;
      for (var i = 0; i < n; i++) {
        $('recState').textContent = (LocalASR.progress().loaded ? 'جارٍ كتابة التسجيل' : 'جارٍ تجهيز الكتابة بالصوت ثم كتابة التسجيل') + ' (' + (i + 1) + ' من ' + n + ')…';
        try { var t = await LocalASR.transcribe(S.subarray(i * step, Math.min(S.length, (i + 1) * step)), EXAM ? 'english' : 'arabic'); if (t) { liveInsert({ text: liveFix(t) }); got = true; } }
        catch (e) { $('voiceErr').hidden = false; $('voiceErr').textContent = 'تعذّر تشغيل الكتابة بالصوت على هذا الجهاز (' + (LocalASR.error() || (e && e.message) || 'خطأ') + ').'; return got; }
      }
      return got;
    }
    function flushLive(min) { if (!rec) return; if (liveMode === 'key') sendSeg(Engine.audioKey(KEY), rec.cut(min)); else if (liveMode === 'local' && rec.cutPcm) sendLocal(rec.cutPcm(min)); }
    /* v48 Gemini Live: the words come back while speaking (grey line), each phrase is written corrected at its pause */
    var liveStream = null, liveWhy = '';
    function startStream(aKey) {
      liveStream = GeminiLive.start(aKey, {
        lang: EXAM ? 'en' : 'ar',
        onOpen: function () { engineNote(); if (!livePending) $('liveInterim').textContent = 'تكلّم… الكلام يظهر وأنت تتكلم.'; },
        onPartial: function (t) { $('liveInterim').className = 'liveinterim'; $('liveInterim').textContent = t; },
        onTurn: function (t) { var p = $('cmdChk') && $('cmdChk').checked ? Speech.command(t) : { text: t }; if (p.text) p.text = liveFix(p.text); liveParts.push(p); $('liveInterim').textContent = ''; liveInsert(p); },
        onError: function (code, why) {
          var s0 = liveStream; liveStream = null; try { if (s0) s0.stop(); } catch (e) {}
          liveWhy = 'Gemini Live: ' + code + (why ? ' — ' + why : ''); try { console.warn(liveWhy); } catch (e) {}
          /* the key does not stream (old model list, quota): the same key in short pieces, else the built-in engine */
          liveMode = code !== 'bad_key' && code !== 'quota' ? 'key' : needLocalAny() ? 'local' : 'none';
          if (liveMode === 'local') LocalASR.load().catch(function () {});
          engineNote(); showPending();
        }
      });
    }
    function needLocalAny() { return typeof LocalASR !== 'undefined' && LocalASR.supported(); }
    async function realRecorder() {
      /* the phone's text-only recorder is swapped for a real one (samples kept) once the browser engine has let go of the mic */
      if (!rec || rec.pcmReady) return true;
      var old = rec;
      try {
        var nr = await Speech.recorder({ pcm: true, onPcm: function (x) { if (liveStream) liveStream.send(x); }, onTick: liveOnTick || function () {} });
        try { old.stop(); } catch (e) {}
        rec = nr; rec.start(); return true;
      } catch (e) { liveWhy = 'mic: ' + (e && (e.name || e.message) || ''); return false; }
    }
    async function liveBrowserFailed(code) {
      if (liveWhy === '' && code) liveWhy = 'محرك المتصفح: ' + code;
      if (liveRec) { try { liveRec.stop(); } catch (e) {} liveRec = null; }
      await realRecorder();
      /* v48: the browser's engine failed — Gemini Live streaming takes over when there is an audio key */
      var aK = Engine.audioKey(KEY);
      if (aK && typeof GeminiLive !== 'undefined' && rec) { liveMode = 'stream'; $('liveInterim').className = 'liveinterim'; $('liveInterim').textContent = 'جارٍ التحويل للكتابة عبر مفتاح الصوت…'; startStream(aK); engineNote(); return; }
      /* v44: the browser's engine failed — the built-in one takes over at once (the recording already keeps the samples) */
      if (rec && rec.pcmReady && rec.pcmReady() && typeof LocalASR !== 'undefined' && LocalASR.supported()) {
        liveMode = 'local'; LocalASR.load().catch(function () {}); clearInterval(liveT); liveT = setInterval(function () { liveTick(null); }, 300);
        $('liveInterim').className = 'liveinterim'; showPending(); engineNote(); return;
      }
      var why = code === 'network' ? 'المتصفح لم يستطع الوصول لخدمة تحويل الكلام' : code === 'not-allowed' || code === 'service-not-allowed' ? 'المتصفح منع استخدام الميكروفون للكتابة' : 'خدمة الكلام في المتصفح لا تعمل الآن';
      $('liveInterim').textContent = '⚠️ الكتابة المباشرة لا تعمل هنا (' + why + '). الحل الأسهل: اضغط داخل المربع واستخدم زر الميكروفون 🎤 في لوحة المفاتيح، أو أضف «مفتاح الصوت» المجاني من ⚙️ الإعدادات فيكتب البرنامج كلامك بنفسه.';
      $('liveInterim').className = 'liveinterim warn';
    }
    /* without an audio key and with the browser's engine, no sound file is needed (the phone's microphone is then free
       for the engine, which some phones do not share with a recording) */
    function textOnlyRec(onTick) {
      var t0 = 0, pTot = 0, pAt = 0, st = 'inactive', tm = null;
      function el() { return ((st === 'paused' ? pAt : Date.now()) - t0 - pTot) / 1000; }
      return { mime: '', state: function () { return st; }, elapsed: el, level: function () { return 0; },
        start: function () { t0 = Date.now(); st = 'recording'; tm = setInterval(function () { onTick(el(), 0); }, 200); },
        pause: function () { if (st === 'recording') { st = 'paused'; pAt = Date.now(); } },
        resume: function () { if (st === 'paused') { pTot += Date.now() - pAt; st = 'recording'; } },
        stop: function () { clearInterval(tm); var s2 = el(); st = 'inactive'; return Promise.resolve({ blob: new Blob([], { type: 'audio/webm' }), seconds: s2 }); } };
    }
    /* v43: the family's PC opens the app in Brave — it shows the speech API but has no speech service behind it («network»
       every time, nothing written). Chrome and Edge do have it (words appear while speaking). Said at once, with the link. */
    function isBrave() { try { return !!navigator.brave || /Brave/i.test(navigator.userAgent); } catch (e) { return false; } }
    var BRAVE_MSG = '⚠️ متصفح Brave لا يدعم تحويل الكلام إلى كتابة، والمحرك المدمج لا يعمل على هذا الجهاز. افتح الكاتب من Google Chrome أو Microsoft Edge (اضغط «📋 نسخ الرابط»)، أو استخدم ميكروفون لوحة المفاتيح 🎤.';
    function appLink() { var b = Engine.lsGet('kateb.blob'), g = Engine.lsGet('kateb.gblob'); return b ? location.origin + location.pathname + '#k=' + b + (g ? '&g=' + g : '') : location.origin + location.pathname; }
    if ($('braveNote')) {
      if (isBrave() && !(typeof LocalASR !== 'undefined' && LocalASR.supported())) { $('braveNote').hidden = false; }
      if ($('copyLink')) $('copyLink').addEventListener('click', function () {
        var t = appLink(), b = this;
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { b.textContent = '✓ تم النسخ — افتح Chrome أو Edge والصقه'; }, function () { window.prompt('انسخ الرابط:', t); });
      });
    }
    /* v43: what is said is corrected as it is written — دعوه → دعوى، علي طلب → على طلب، الي → إلى (names and numbers untouched) */
    var liveLex = null, liveSpell = null;
    function liveFixPrep() {
      if (EXAM || typeof Bank === 'undefined') return;
      Bank.load('lexicon').then(function (b) { liveLex = b; }).catch(function () {});
      Bank.load('spelling').then(function (b) { liveSpell = b; }).catch(function () {});
      if (typeof Dict !== 'undefined' && Dict.load && !Dict.ready()) { try { Dict.load(); } catch (e) {} }
    }
    function liveFix(t) {
      if (EXAM || !t) return t;
      try {
        if (typeof Dict !== 'undefined' && Dict.fix) t = Dict.fix(t, { lexicon: liveLex || undefined, names: typeof Fields !== 'undefined' ? Fields.extract(t).names : [] }).text;
        if (liveSpell && typeof Arabic !== 'undefined' && Arabic.spell) t = Arabic.spell(t, liveSpell).text;
      } catch (e) {}
      return t;
    }
    /* the keyboard's own microphone (Gboard / iPhone / Windows Win+H) writes straight into the box, with no key at all */
    if ($('kbMic')) $('kbMic').addEventListener('click', function () {
      $('liveBox').hidden = false; $('liveInterim').className = 'liveinterim';
      $('liveInterim').textContent = /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'اضغط زر الميكروفون 🎤 في لوحة المفاتيح وتكلّم. عند الانتهاء اضغط «تحويل النص إلى Word».' : 'على الكمبيوتر: اضغط زر ويندوز + H وتكلّم، فيُكتب الكلام في المربع. عند الانتهاء اضغط «تحويل النص إلى Word».';
      var ta = $('liveEdit'); ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
      $('liveConvert').hidden = !ta.value.trim();
    });
    $('recStart').addEventListener('click', async function () {
      $('voiceErr').hidden = true; $('liveInterim').className = 'liveinterim';
      var aKey = Engine.audioKey(KEY), onTick = function (sec, lvl) { $('recTime').textContent = Speech.fmtTime(sec); liveHist.push(lvl); if (liveHist.length > 400) liveHist.shift(); };
      /* v48 order: the browser's own engine (Chrome/Edge: free, word by word) → Gemini Live streaming with the audio key (any
         browser) → the engine built into the app. Each hands over to the next when it fails. */
      liveMode = Speech.liveSupported() && !isBrave() ? 'browser' : aKey && typeof GeminiLive !== 'undefined' ? 'stream' : aKey ? 'key' : needLocal() ? 'local' : 'none';
      if (liveMode === 'local') LocalASR.load().catch(function () {});
      liveFixPrep();
      try {
        if (liveMode === 'browser' && /Android|iPhone|iPad/i.test(navigator.userAgent)) rec = textOnlyRec(onTick);   // v49: phones cannot share the microphone with the speech engine (v46 broke this)
        else rec = await Speech.recorder({ pcm: true, onPcm: function (x) { if (liveStream) liveStream.send(x); }, onTick: onTick, onLost: function () { $('voiceErr').hidden = false; $('voiceErr').textContent = 'انقطع الميكروفون. ما سُجّل محفوظ: اضغط «إنهاء التسجيل».'; } });
      } catch (e) { $('voiceErr').hidden = false; $('voiceErr').textContent = Engine.errText({ code: 'mic' }); rec = null; return; }
      liveParts = []; liveHist = []; liveFail = 0; livePending = 0; liveQ = Promise.resolve(); $('liveConvert').hidden = true; liveHeard = 0; liveGotResult = false; liveStartT = Date.now(); liveWhy = '';
      liveOnTick = onTick;
      liveRec = liveMode !== 'browser' ? null : Speech.live({ lang: EXAM ? 'en-US' : 'ar-EG',
        onInterim: function (t) { liveGotResult = true; $('liveInterim').textContent = t; },
        onFinal: function (t) { liveGotResult = true; var p = $('cmdChk').checked ? Speech.command(t) : { text: t }; if (p.text) p.text = liveFix(p.text); liveParts.push(p); $('liveInterim').textContent = ''; liveInsert(p); },
        onFatal: function (code) { liveBrowserFailed(code); } });
      $('liveBox').hidden = false;
      $('liveInterim').textContent = liveMode === 'key' ? 'تكلّم… الكلام يُكتب بعد كل وقفة قصيرة.' : liveMode === 'local' ? '' : liveMode === 'none' && isBrave() ? BRAVE_MSG : liveMode === 'none' ? 'الكتابة المباشرة غير متاحة في هذا المتصفح: اضغط داخل المربع واستخدم ميكروفون لوحة المفاتيح 🎤، أو أضف مفتاح الصوت من الإعدادات.' : '';
      rec.start(); if (liveRec) liveRec.start();
      if (liveMode === 'stream') startStream(aKey);
      liveT = setInterval(function () { liveTick(aKey); }, 300);
      engineNote();
      if (liveMode === 'local') showPending();
      $('recStat').className = 'recstat on'; $('recState').textContent = 'جارٍ التسجيل…';
      $('recStart').hidden = true; $('recPause').hidden = false; $('recStop').hidden = false; $('recDone').hidden = true;
      waveT = setInterval(function () { Speech.drawWave($('wave'), liveHist, rec && rec.state() === 'recording'); }, 100);
    });
    $('recPause').addEventListener('click', function () {
      if (!rec) return;
      flushLive(0.5);                                                              // what was said before the pause is written now
      if (liveStream) liveStream.pause();
      rec.pause(); if (liveRec) liveRec.pause(); $('recStat').className = 'recstat paused'; $('recState').textContent = 'متوقف مؤقتًا — صحّح النص إن أردت ثم استكمل'; $('recPause').hidden = true; $('recResume').hidden = false; if (liveMode !== 'key' && liveMode !== 'local') $('liveInterim').textContent = ''; $('liveConvert').hidden = !liveText();
    });
    $('recResume').addEventListener('click', function () { if (!rec) return; rec.resume(); if (liveRec) liveRec.resume(); if (liveStream) liveStream.resume(); $('recStat').className = 'recstat on'; $('recState').textContent = 'جارٍ التسجيل…'; $('recPause').hidden = false; $('recResume').hidden = true; $('liveConvert').hidden = true; });
    $('recStop').addEventListener('click', async function () {
      if (!rec) return;
      $('recStop').disabled = true;
      if (liveRec) liveRec.stop();
      clearInterval(liveT); liveT = null;
      if (liveMode === 'key' || liveMode === 'local') { flushLive(0.5); $('recState').textContent = 'جارٍ كتابة آخر جملة…'; }
      if (liveStream) { $('recState').textContent = 'جارٍ كتابة آخر جملة…'; var ls0 = liveStream; await ls0.stop(); liveStream = null; }
      var r = await rec.stop(); rec = null; clearInterval(waveT); Speech.drawWave($('wave'), liveHist, false);
      await liveQ;                                                                   // the last words are in the box before anything else
      recBlob = r.blob; recSecs = r.seconds;
      $('recStop').disabled = false; $('recStat').className = 'recstat'; $('recState').textContent = 'انتهى التسجيل (' + Speech.fmtTime(recSecs) + ')';
      $('recPause').hidden = true; $('recResume').hidden = true; $('recStop').hidden = true; $('recStart').hidden = true;
      var aKey = Engine.audioKey(KEY);
      if (!liveText() && !aKey && recBlob.size && recSecs >= 1) await localWholeRecording(recBlob);
      $('recState').textContent = 'انتهى التسجيل (' + Speech.fmtTime(recSecs) + ')';
      var hasLive = !!liveText();
      if ((!recBlob.size && !hasLive) || recSecs < 1) { $('voiceErr').hidden = false; $('voiceErr').textContent = 'لم يُكتب ولم يُسجَّل شيء. تأكد من الميكروفون، أو تكلّم بزر الميكروفون 🎤 في لوحة المفاتيح داخل المربع.'; $('recStart').hidden = false; return; }
      if (recBlob.size) { recAudioUrl = URL.createObjectURL(recBlob); $('recAudio').src = recAudioUrl; $('recAudio').hidden = false; } else $('recAudio').hidden = true;
      $('recDone').hidden = false;
      $('recConvert').hidden = !hasLive && !aKey; if ($('recExact')) $('recExact').hidden = !(recBlob.size && aKey && (hasLive || liveFail));
      $('recNote').textContent = hasLive ? 'راجع النص في المربع وصحّح ما تريد، ثم اضغط «تحويل النص إلى Word» — يُنسَّق كما كتبته.' : aKey ? 'اضغط «تحويل» ليُفرَّغ التسجيل ثم يُنسَّق كمستند.' : 'لم يُكتب شيء ولا يوجد مفتاح صوت: اضغط داخل المربع وتكلّم بميكروفون لوحة المفاتيح 🎤، أو أضف «مفتاح الصوت» المجاني من ⚙️ الإعدادات.';
    });
    /* the edited box is the transcript (no second transcription: the person's corrections stay, and it costs less);
       without any text the recording itself is transcribed by the audio key */
    $('recConvert').addEventListener('click', function () { if (recBlob) convertAudio(recBlob, { source: 'voice', seconds: recSecs, live: liveText(), useLive: !!liveText() }); });
    if ($('recExact')) $('recExact').addEventListener('click', function () { if (recBlob) convertAudio(recBlob, { source: 'voice', seconds: recSecs, live: liveText(), useLive: false }); });
    $('liveConvert').addEventListener('click', async function () {
      if (!liveText()) return;
      if (rec) { if (liveRec) liveRec.stop(); var r = await rec.stop(); rec = null; clearInterval(waveT); recBlob = r.blob; recSecs = r.seconds; }
      convertAudio(recBlob && recBlob.size ? recBlob : null, { source: 'voice', seconds: recSecs, live: liveText(), useLive: true });
    });
    $('recAgain').addEventListener('click', function () { if (!recBlob || window.confirm('حذف هذا التسجيل والبدء من جديد؟')) resetRec(); });
  }
  function audioScreen(back) {
    show('audioUp', back); $('audioErr').hidden = true;
    var k = Engine.audioKey(KEY);
    $('audioKeyNote').hidden = !!k; $('audioKeyNote').textContent = k ? '' : Engine.errText({ code: 'no_audio_key' });
    if (!back) { audioSel = null; $('audioInfo').hidden = true; }
  }
  if ($('audioPick')) {
    $('audioPick').addEventListener('click', function () { $('audioFile').click(); });
    $('audioOther').addEventListener('click', function () { $('audioFile').click(); });
    $('audioFile').addEventListener('change', function () {
      var f = this.files && this.files[0]; this.value = ''; if (!f) return;
      audioSel = f; $('audioErr').hidden = true;
      $('audioName').textContent = f.name; $('audioMeta').textContent = (f.size / 1048576).toFixed(1) + ' MB — جارٍ قراءة المدة…';
      try { var u = URL.createObjectURL(f); $('audioPlayer').src = u; $('audioPlayer').onloadedmetadata = function () { $('audioMeta').textContent = (f.size / 1048576).toFixed(1) + ' MB — المدة ' + Speech.fmtTime($('audioPlayer').duration || 0); }; $('audioPlayer').onerror = function () { $('audioMeta').textContent = (f.size / 1048576).toFixed(1) + ' MB — المتصفح لا يشغّل هذه الصيغة؛ سنحاول تحويلها على أي حال.'; }; } catch (e) {}
      $('audioInfo').hidden = false;
    });
    $('audioConvert').addEventListener('click', function () { if (audioSel) convertAudio(audioSel, { source: 'audio', seconds: $('audioPlayer').duration || 0 }); });
  }
  var STAGE_IMG = ['تجهيز الصور', 'قراءة الخط', 'مراجعة وتدقيق'], STAGE_AUD = ['تجهيز الصوت', 'تفريغ الكلام', 'تنسيق النص'];
  function stageNames(list) { Array.prototype.forEach.call(document.querySelectorAll('.stage'), function (el, i) { el.innerHTML = '<i>' + (i + 1) + '</i>' + list[i]; }); }
  var GEMINI_AUDIO = /^audio\/(wav|x-wav|mpeg|mp3|aiff|aac|ogg|flac|opus|webm|mp4|m4a|x-m4a)/;
  async function convertAudio(blob, o) {
    if (running) return; running = true; plainRun = outMode() === 'plain'; results = []; usedModels = {}; docCost = 0;
    runAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    show('work'); stageNames(STAGE_AUD); setStage(0); setProgress(0, 3, 'جارٍ تجهيز التسجيل…'); $('waitText').hidden = true; $('thumbs').innerHTML = '';
    if ($('cancelBtn')) $('cancelBtn').hidden = false;
    var t0 = Date.now();
    try {
      var aKey = Engine.audioKey(KEY), transcript = '', seconds = o.seconds || 0;
      if (o.useLive && o.live) transcript = o.live;                 // the dictation box, as the person corrected it
      else if (aKey && blob) {
        var chunks;
        try { var cd = await Speech.toChunks(blob); chunks = cd.chunks; seconds = cd.seconds || seconds; }
        catch (e) { if (GEMINI_AUDIO.test(blob.type || '') && blob.size < 19 * 1048576) chunks = [{ from: 0, to: seconds, blob: blob }]; else throw { code: 'audio_decode' }; }
        var models = await Engine.audioModels(aKey), parts = new Array(chunks.length), done = 0;
        setStage(1); setProgress(1, 3, 'جارٍ تفريغ الكلام' + (chunks.length > 1 ? ' (' + chunks.length + ' أجزاء معًا)' : '') + '…');
        /* the parts go out together (three at a time), each keeps its place */
        var queue = chunks.map(function (c, i) { return i; });
        async function worker() {
          while (queue.length) {
            var i = queue.shift();
            var r = await Engine.generate(aKey, PROMPTS.transcribe(i + 1, chunks.length, $('cmdChk') ? $('cmdChk').checked : true), [chunks[i].blob], { models: models, temperature: 0.1, maxTokens: 16384, signal: sig(), onWait: onWait });
            if (r.model) usedModels[r.model] = 1;
            parts[i] = Engine.clean(r.text).replace(/^\s*(لا يوجد كلام|لا شيء)\.?\s*$/m, '');
            done++; setProgress(1 + done / chunks.length, 3, 'جارٍ تفريغ الكلام (' + done + ' من ' + chunks.length + ')…');
          }
        }
        await Promise.all([worker(), worker(), worker()]);
        transcript = Speech.merge(parts);
      } else if (o.live) transcript = o.live;
      else throw { code: 'no_audio_key' };
      if (!transcript.replace(/[\s⟦⟧؟.،]/g, '')) throw { code: 'empty_audio' };
      setStage(2); setProgress(2, 3, 'جارٍ تنسيق النص كمستند…');
      var text = transcript, type = null;
      if (CLAUDE) {
        type = !EXAM && !plainRun && typeof Office !== 'undefined' ? Office.detect(transcript) : null;
        var bank = type && typeof Bank !== 'undefined' ? await Bank.load(type) : null;
        var system = ((bank ? PROMPTS.bankSystem(TYPE_LABEL[type] || type, Bank.promptText(bank, 300)) : '') + (await glossaryPrompt())) || undefined;
        var rf = await Engine.generate(KEY, PROMPTS.format(transcript), [], { best: true, effort: 'high', maxTokens: 8192, system: system, signal: sig(), onWait: onWait });
        if (rf.model) usedModels[rf.model] = 1;
        var ft = Engine.clean(rf.text);
        if (ft && Verify.tokens(ft).length >= Verify.tokens(transcript).length * 0.7) text = ft;      // a shortened text is never accepted
      } else text = transcript.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).join('\n');
      if (!EXAM) { text = Verify.houseDigits(text); if (typeof Arabic !== 'undefined') { var dict = typeof Bank !== 'undefined' ? await Bank.load('spelling') : null; if (dict) text = Arabic.spell(text, dict).text; } }
      if (!type && !EXAM && !plainRun && typeof Office !== 'undefined') type = Office.detect(text);
      curAdded = {};
      var res = await toResult(text); res.text = text; res.type = type; res.secs = Math.round((Date.now() - t0) / 1000); res.agree = null;
      results = [res];
      pendingAudio = blob ? { blob: blob, source: o.source, transcript: transcript, seconds: seconds } : null;
      if (o.useLive) { try { localStorage.removeItem(LIVE_DRAFT); } catch (e) {} }
      setProgress(3, 3, 'تم'); setStage('all');
      finish();
    } catch (e) {
      if ((e && e.code === 'cancelled') || (runAbort && runAbort.signal.aborted)) { running = false; reconvertDoc = null; pendingAudio = null; toStart(); return; }
      fail(e);
    }
    running = false; stageNames(STAGE_IMG);
  }

  /* ---------- download ---------- */
  function stamp() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function examHeader() {
    var h = {}; ['hLine1', 'hLine2', 'hLine3', 'hSubject', 'hGrade', 'hTime', 'hTitle'].forEach(function (id) { h[id] = $(id) ? $(id).value : ''; });
    var out = { line1: h.hLine1, line2: h.hLine2, line3: h.hLine3, subject: h.hSubject, grade: h.hGrade, time: h.hTime, title: h.hTitle };
    var k = examKind(); if (curDoc && curDoc.kindTitle) out.title = curDoc.kindTitle;
    if (k === 'plain') return null;
    /* v29: the header (Governorate / school + Subject / Grade / Time) is a choice: on for finals by default, off for a
       monthly exam (her monthly papers have only the title) and for notes — and she can switch it for any paper */
    if (!headOn(k)) { out.noTable = true; out.right = []; return out; }
    if (k === 'revision') out.right = ['Subject: ' + (out.subject || ''), 'Grade: ' + (out.grade || ''), 'Date: ' + (out.date || '………………')];
    else out.right = ['Subject: ' + (out.subject || ''), 'Grade: ' + (out.grade || ''), 'Time: ' + (out.time || '')];
    return out;
  }
  /* v29: the two headers her finals use, one tap each (the lines stay editable) */
  var HEAD_PRESETS = {
    gov: ['Assiut Governorate', 'Directorate of Education', 'Administration of Distinguished & Governmental Language Schools'],
    badr: ['Assiut directorate of education', 'Badr governmental language school', 'Inclusive students (slow learners)']
  };
  Array.prototype.forEach.call(document.querySelectorAll('[data-hpreset]'), function (b) {
    b.addEventListener('click', function () { var L = HEAD_PRESETS[b.dataset.hpreset]; ['hLine1', 'hLine2', 'hLine3'].forEach(function (id, i) { if ($(id)) { $(id).value = L[i]; $(id).dispatchEvent(new Event('input')); } }); });
  });
  /* ---------- «ما نوع هذه الورقة؟» asked once per document before the first Word / PDF ---------- */
  var EXAM_KINDS = [
    { key: 'exam', icon: '📝', label: 'امتحان', hint: 'رأس المدرسة كامل: المادة والصف والزمن، وعنوان الامتحان', title: function () { return Engine.lsGet('exam.hTitle') || 'First term exam'; } },
    { key: 'monthly', icon: '🗓️', label: 'امتحان شهري', hint: 'عنوان «Primary 4 Monthly Exam» والأسئلة، بدون رأس', title: function () { var g = (($('hGrade') && $('hGrade').value) || Engine.lsGet('exam.hGrade') || '').trim(); return (/^\d/.test(g) ? 'Primary ' + g : g || 'Primary') + ' Monthly Exam'; } },
    { key: 'revision', icon: '📋', label: 'مراجعة / ورقة عمل', hint: 'رأس بالمادة والصف والتاريخ، وعنوان «Revision Sheet»', title: function () { return 'Revision Sheet'; } },
    { key: 'notes', icon: '📒', label: 'مذكرة / شرح', hint: 'عنوان فقط بدون جدول الرأس', title: function () { return 'Notes'; } },
    { key: 'plain', icon: '📄', label: 'ورقة عادية', hint: 'النص كما هو، بدون رأس ولا عنوان', title: function () { return ''; } }
  ];
  function examKind() { return (curDoc && curDoc.kind) || 'exam'; }
  function headPref(k) { var v = Engine.lsGet('exam.head.' + k); return v === null ? k === 'exam' || k === 'revision' : v === '1'; }   // default: finals and revision sheets have the header
  function headOn(k) { return curDoc && typeof curDoc.head === 'boolean' ? curDoc.head : headPref(k); }
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
      extra.innerHTML = FILE_ROW + '<label class="tplrow">عنوان الورقة<input id="kindTitle" dir="ltr" autocomplete="off"></label><label class="chk"><input type="checkbox" id="kindHead"> رأس الصفحة (المحافظة والمدرسة، والمادة والصف والزمن)</label>';
      $('kindHead').checked = headOn(kindChoice);
      $('kindTitle').value = (curDoc && curDoc.kindTitle) || EXAM_KINDS.filter(function (k) { return k.key === kindChoice; })[0].title();
      $('kindHint').textContent = 'اختاري نوع الورقة ليخرج الملف بالرأس والشكل المناسبين.';
    } else {
      var detected = (curDoc && curDoc.type) || Office.detect(parasText(allParas())) || '';
      kindChoice = tplKey() || '';
      var opts = [{ key: '', label: 'ملف عادي (بدون شكل المكتب)', icon: '📄' }].concat(TPLS.map(function (t) { return { key: t.key, label: t.label, icon: '📜', stamp: t.stamp }; }));
      list.innerHTML = opts.map(function (o) { return '<button class="kind" type="button" data-kind="' + o.key + '" aria-pressed="' + (o.key === kindChoice) + '"><span class="ki">' + o.icon + '</span><span><b>' + escH(o.label) + '</b>' + (o.key && o.key === detected ? '<small>المقترح من قراءة الورقة</small>' : '') + '</span></button>'; }).join('');
      extra.innerHTML = FILE_ROW + '<div class="tplrow2" id="kindLaw"><label class="tplrow">اسم المحامي في الختم<input id="kindLawName" autocomplete="off"></label><label class="tplrow">الصفة<select id="kindLawTitle"><option>المحامي</option><option>المحامية</option></select></label></div>';
      $('kindLawName').value = $('lawName').value; $('kindLawTitle').value = $('lawTitle').value;
      $('kindHint').textContent = 'اختر نوع الورقة ليخرج Word و PDF بشكل المكتب لهذا النوع: الخطوط والهوامش والختم.';
      kindExtraLegal();
    }
    /* v37: the file's own name, typed freely (a paper type that is not in the list still gets its right name) */
    $('kindFile').value = curDoc ? curDoc.name : ''; kindFileAuto = !curDoc || curDoc.name === curDoc.nameAuto;
    $('kindDlg').hidden = false;
    var sel = list.querySelector('[aria-pressed="true"]'); if (sel) sel.focus();
  }
  var FILE_ROW = '<label class="tplrow">📝 اسم الملف (اكتب أي اسم — مثلًا نوع ورقة غير موجود في القائمة)<input id="kindFile" autocomplete="off" placeholder="مثلًا: دعوى ريع — أحمد محمد"></label>', kindFileAuto = true;
  function kindExtraLegal() { var t = tplOf(kindChoice); if ($('kindLaw')) $('kindLaw').hidden = !(t && t.stamp); }
  if ($('kindDlg')) {
    $('kindExtra').addEventListener('input', function (e) { if (e.target.id === 'kindFile') kindFileAuto = false; });
    $('kindList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-kind]'); if (!b) return;
      kindChoice = b.dataset.kind;
      Array.prototype.forEach.call($('kindList').querySelectorAll('[data-kind]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      if (EXAM) { var k = EXAM_KINDS.filter(function (x) { return x.key === kindChoice; })[0]; if (k && $('kindTitle')) $('kindTitle').value = k.title(); if ($('kindHead')) { $('kindHead').checked = headPref(kindChoice); $('kindHead').disabled = kindChoice === 'plain'; } } else { kindExtraLegal(); if (kindFileAuto && kindChoice && $('kindFile')) $('kindFile').value = autoName(kindChoice); }
    });
    $('kindCancel').addEventListener('click', function () { $('kindDlg').hidden = true; kindThen = null; });
    $('kindOk').addEventListener('click', function () {
      if (curDoc) {
        if (EXAM) { curDoc.kind = kindChoice; curDoc.kindTitle = ($('kindTitle').value || '').trim(); if ($('kindHead') && kindChoice !== 'plain') { curDoc.head = $('kindHead').checked; Engine.lsSet('exam.head.' + kindChoice, curDoc.head ? '1' : '0'); } }
        else {
          $('tplSel').value = kindChoice; tplHint(); $('lawName').value = $('kindLawName').value; $('lawTitle').value = $('kindLawTitle').value; Engine.lsSet('kateb.lawName', $('lawName').value.trim()); Engine.lsSet('kateb.lawTitle', $('lawTitle').value);
          if (kindChoice && curDoc.name === curDoc.nameAuto) { curDoc.name = curDoc.nameAuto = autoName(kindChoice); $('docName').value = curDoc.name; }
        }
        var fname = ($('kindFile') && $('kindFile').value || '').replace(/\s+/g, ' ').trim();
        if (fname && fname !== curDoc.name) { curDoc.name = fname; curDoc.nameAuto = kindFileAuto ? fname : null; if ($('docName')) $('docName').value = fname; }
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
  /* «📤 مشاركة الملف»: the system share sheet (WhatsApp is one of its targets on phones) gets the actual file.
     Browsers only accept certain file types there: iOS Safari takes the .docx; Chrome's safelist has PDF but
     not Office files, so there the reviewed text is drawn onto A4 pages (Raster) and shared as a PDF. Where no
     file can be shared the Word file is downloaded and the person is told how to send it. */
  var shareFile = null, shareKey = '', shareKind = '';
  function canShareFile(f) { try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [f] })); } catch (e) { return false; } }
  function shareAvailable() { return typeof navigator !== 'undefined' && typeof navigator.share === 'function'; }
  async function buildWordBlob() {
    marks().forEach(function (m) { m.classList.remove('cur'); });
    var zip;
    if (!EXAM) { var key = tplKey(); zip = key ? await Office.build(JSZip, allParas(), key, { lawyer: lawyer() }) : DocxBuilder.build(JSZip, allParas(), { pageNumbers: true, title: 'مستند' }); }
    else { var blocks = []; sheets().forEach(function (s) { blocks = blocks.concat(domBlocks(s)); }); zip = ExamBuilder.build(JSZip, blocks, examHeader(), {}); }
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  /* the pages as pictures → PDF (office stamp and side column drawn when the chosen template has them) */
  async function buildPdfBlob() {
    marks().forEach(function (m) { m.classList.remove('cur'); });
    try { if (document.fonts && document.fonts.load) await Promise.race([document.fonts.load('16px "Noto Naskh Arabic"'), new Promise(function (r) { setTimeout(r, 1500); })]); } catch (e) {}
    var opts = { dir: EXAM ? 'ltr' : 'rtl', pageNumbers: !EXAM, arabicDigits: !EXAM };
    var blocks;
    if (!EXAM) {
      blocks = allParas();
      var t = tplOf(tplKey());
      if (t) {
        var L = lawyer(), c = Office.client(blocks), subj = blocks.filter(function (b) { return b.heading; }).slice(0, 1).map(function (b) { return b.runs.map(function (r) { return r.text; }).join(''); })[0] || t.label;
        if (t.stamp && L.name) opts.stamp = ['مكتب', L.name, (L.title || 'المحامي').replace('المحامي', 'المحــامي') + (L.nakd ? ' بالنقض' : '')];
        if (t.stamp) opts.side = ['الموضوع', subj, 'كطلب ' + c.who + ' وتحت ' + c.resp, '', 'وكيل ' + c.who, '', L.title || 'المحامي'];
        opts.left = 16; opts.right = 14; opts.top = 18;
      }
    } else { blocks = []; sheets().forEach(function (s) { blocks = blocks.concat(domBlocks(s)); }); var h = examHeader(); if (h) blocks.unshift({ k: 'q', runs: [{ text: (h.title || '') + '   ' + (h.right || []).filter(Boolean).join('   ') }] }); }
    var pages = await Raster.pages(blocks, opts);
    return Raster.pdf(pages);
  }
  async function doShare() {
    var btn = $('shareBtn'), note = $('savedNote');
    var sig = sheets().map(function (s) { return s.innerHTML; }).join('|') + '|' + tplKey() + '|' + baseName();
    note.hidden = false; note.textContent = 'جارٍ تجهيز الملف للمشاركة…'; btn.disabled = true;
    try {
      if (!shareFile || shareKey !== sig) {
        var docx = new File([await buildWordBlob()], baseName() + '.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        if (canShareFile(docx)) { shareFile = docx; shareKind = 'word'; }
        else {
          var pdf = new File([await buildPdfBlob()], baseName() + '.pdf', { type: 'application/pdf' });
          if (canShareFile(pdf)) { shareFile = pdf; shareKind = 'pdf'; } else { shareFile = docx; shareKind = 'none'; }
        }
        shareKey = sig;
      }
      btn.disabled = false;
      if (shareKind === 'none') {
        Engine.download(shareFile, shareFile.name);
        note.textContent = 'هذا المتصفح لا يشارك الملفات مباشرة. تم حفظ ملف Word في «التنزيلات»: افتح واتساب ← مرفق 📎 ← مستند ← اختره.'; exported(); return;
      }
      await navigator.share({ files: [shareFile], title: baseName() });
      note.textContent = (shareKind === 'pdf' ? 'الملف المشارَك PDF (المتصفح لا يشارك ملفات Word مباشرة؛ ملف Word بالضغط على «تحميل Word»). ' : '') + 'اختر واتساب (أو أي تطبيق) من القائمة التي ظهرت، ثم الشخص الذي تريد إرسال الملف له.';
      exported();
    } catch (e) {
      btn.disabled = false;
      if (e && e.name === 'AbortError') { note.textContent = 'أُغلقت قائمة المشاركة.'; return; }
      note.textContent = e && e.name === 'NotAllowedError' ? 'الملف جاهز — اضغط «مشاركة الملف» مرة أخرى لفتح قائمة المشاركة.' : 'تعذرت المشاركة (' + ((e && ((e.name || e.code) + (e.message ? ': ' + String(e.message).slice(0, 80) : ''))) || 'خطأ') + '). حمّل ملف Word ثم أرسله من واتساب (مرفق ← مستند).';
    }
    note.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  if ($('shareBtn')) {
    $('shareBtn').hidden = !shareAvailable();
    $('shareBtn').addEventListener('click', function () { if (nothingToExport()) return; withKind(doShare); });
  }
  $('pdfBtn').addEventListener('click', function () { if (nothingToExport()) return; withKind(doPdf); });
  async function doWord() {
    var btn = $('wordBtn'); btn.disabled = true;
    try {
      var blob, all = sheets();
      marks().forEach(function (m) { m.classList.remove('cur'); });
      if (!EXAM) {
        /* the reviewed paper teaches the memory its lawyers, judges, people and courts (what is still yellow is left out) */
        try { if (typeof Memory !== 'undefined') Memory.learn(all.map(function (sh) { var c = sh.cloneNode(true); Array.prototype.forEach.call(c.querySelectorAll('mark'), function (m) { m.textContent = '⟦' + m.textContent + '⟧'; }); return htmlText(c.innerHTML); }).join('\n')); } catch (e) {}
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
  var APP_VER = '49';
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

  window.__test = { dict: function () { return typeof Dict !== 'undefined' ? Dict : null; }, finish: finish, toResult: toResult, setResults: function (r) { results = r; }, show: show, sheetToParas: sheetToParas, domBlocks: domBlocks, results: function () { return results; },
    doc: function () { return curDoc; }, fields: renderFields, convertAudio: convertAudio, shots: function () { return shots; }, liveParts: function () { return liveParts; }, fixes: function () { return fixes; }, usage: function () { return Engine.usageSummary(); }, askKind: askKind, save: function () { return saveDraft(); }, saved: function () { return saveChain.then(function () { return learnChain; }); }, undo: undo, redo: redo, hist: function () { return { n: hist.length, i: hi }; }, nav: function () { return { cur: curScreen, stack: nav.slice() }; } };

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
    "- Wrap any word or number you are not fully sure of in ⟦ ⟧ like ⟦كلمة⟧. When you hesitate between readings, give them all inside the brackets, the most likely first, separated by |: ⟦محمود|محمد⟧ (at most three).\n" +
    "- EVERY WRITTEN WORD GETS A READING: lawyers write fast and joined-up, and the reviewer needs a text to check, not gaps. Never leave a gap and never write dots or ⟦؟⟧ for a written word: read it from its letter shapes, how this hand writes the same letters elsewhere on the page, the sentence and the legal formulas you know, and write your best reading — inside ⟦ ⟧ whenever you are not sure (⟦a|b⟧ for two readings). Every yellow word is checked against the photo.\n" +
    "- NOTHING IS ADDED: the formulas help you RECOGNISE words that are written; they never add words. Each line you write holds the words on that line of the paper, no more: never write a formula sentence, a word or a line the paper does not show, and never complete a sentence the lawyer left short or a blank he left to fill later (a blank stays blank spaces).\n" +
    "- SPELLING IS CORRECTED AUTOMATICALLY: the typed paper must have no spelling mistakes. A slip of the hand in an ordinary word is written in the office's correct spelling (hamza forms أ إ آ ء ئ ؤ، ة not ه، ى not ي at the end, a missing or doubled letter, دعوه → دعوى، الى → إلى، علي → على where it means «on»). NEVER correct names of people, families or places, numbers, dates, amounts or case numbers — those stay exactly as the ink shows. The wording itself is not changed.\n" +
    "- Leave out: words crossed out or scribbled over (if they hid a name or field, write ........ in their place), stamps, seals, signatures, page numbers, handwritten court notes in the margins.\n" +
    "- Leave out the office's LEFT MARGIN COLUMN (الموضوع / the subject / كطلب الطالب وتحت مسئوليته / وكيل الطالب / المحامي) and the lawyer's STAMP BOX at the top (مكتب … المحامي): the Word template prints them itself. The body text starts at the title or at «إنه في يوم».\n" +
    "- HOUSE STYLE OF THIS OFFICE (measured on 1,740 of its typed papers): ALL numbers and dates use Western digits 0-9, even when the hand wrote ٠-٩. Dates are day/month/year like 10/1/2020 or 7/10/2025 (never year first). Amounts like 250000 ج ( مائتان وخمسون ألف جنيه مصري لا غير ). Case references like رقم 2537 لسنة 2025. Keep the source's punctuation.\n" +
    "- Copy EVERY digit: a year has four digits (2022, not 202), an amount keeps all its zeros; read numbers from the strips digit by digit, never from memory.\n" +    "- Spelling is standard Egyptian legal Arabic as the office types it: دعوى (never دعوه or دعوة), إلى، على، بالآتي، صحة توقيع، محكمة، الأهلية القانونية، أسيوط. Final ة and ى are never written as ه or ي by mistake.\n" +
    "- Do not add, remove, summarize, translate or reword.\n" +
    "- Letters are read from the ink, not from what the sentence expects: count the dots and their position for ب ت ث ن ي، ج ح خ، د ذ، ر ز، س ش، ص ض، ط ظ، ع غ، ف ق; ه vs ة and ي vs ى as written; hamza (أ إ آ ا) as written. When a dot is faint or missing in an ordinary word, the sentence and the formulas decide which word it is; in a name or a number, give the best reading and mark it.";
  var EXAM_FORMAT =
    "OUTPUT FORMAT (plain text lines, no code fences, no commentary):\n" +
    "GRADE: <grade>   (first line, only if the paper names the grade, e.g. GRADE: Primary 4)\n" +
    "[Q] Question (1) Choose the correct answer   (one line per section heading; number sections (1), (2), (3)… in order; standard wording: 'Choose the correct answer', 'Complete each of the following', 'Match', 'Join', 'Put (✓) or (✗)', 'Answer the following questions', or the section's own wording)\n" +
    "THE EXAM IS IN ENGLISH: every heading, question, choice and word problem in correct English exactly as the teacher wrote it (fix only spelling and capitals) — never translate into Arabic; Arabic only where the teacher herself wrote Arabic.\n" +
    "[I] **1)** <question text>   (each numbered question; restart at 1 in each section; blanks as __________)\n" +
    "[OPT] a) … | b) … | c) … | d) …   (the answer choices of the question above, on one line)\n" +
    "[TABLE] cell | cell || cell | cell   (tables and bar models; || separates rows; a shorter row's last cell spans the rest)\n" +
    "[FIG] <svg …>…</svg>   (any drawing, shape, diagram, number line, clock, grid or graph: REDRAW it as clean SVG on ONE line right after its question. viewBox about 120-320 wide, black strokes stroke-width=\"2\", fill=\"none\", true straight geometry, right-angle marks as small squares, heights dashed, keep proportions and orientation, every label as <text font-family=\"Times New Roman\" font-size=\"16\"> exactly as written and inside the viewBox. No scripts, images or links.)\n" +
    "[GAP]   (after each question in sections where students write a worked answer)\n" +
    "MATH: fractions as {3/4}; mixed numbers 2 {1/3}; powers with ² ³; symbols × ÷ − = %; keep units.\n" +
    "Wrap anything not fully sure in ⟦ ⟧ like ⟦28.8⟧; two plausible readings → ⟦28.8|28.3⟧ (most likely first). Never guess a number silently.\n" +
    "Fix English spelling, capitals and small grammar slips in the wording, but NEVER change a number, unit, answer choice or the mathematics.\n" +
    "Leave out crossed-out work, ticks, scores, page numbers and anything not part of the exam.";
  /* v28 «نص فقط»: the page's words, numbers and symbols on a white page — no legal or school structure added */
  var PLAIN_FORMAT =
    "OUTPUT FORMAT (plain text, no code fences, no commentary):\n" +
    "- One paragraph per line, in reading order; join the lines that are one paragraph in the source.\n" +
    "- A centered line starts with [C]. A table: [TABLE] cell | cell || cell | cell. **bold** and __underline__ as in the source.\n" +
    "- Every word, number, date and symbol exactly as on the page; copy every digit. Wrap a word you are not sure of in ⟦ ⟧ with the best reading inside (⟦a|b⟧ for two close readings); never ⟦؟⟧, never leave a written word out.\n" +
    "- Correct spelling slips of ordinary words (hamza, ة/ه, ى/ي); never change names, numbers or dates.\n" +
    "- Leave out crossed-out words, stamps, signatures and page numbers. Do not add, remove, summarize, translate or reword; add no headings or tags the page does not have.";
  var EXAM_PLAIN_FORMAT =
    "OUTPUT FORMAT (plain text lines, no code fences, no commentary):\n" +
    "- Everything written on the page, in reading order, one line per written line or paragraph — exactly as written: do not add section headings, numbering, answer gaps or choices that are not on the page.\n" +
    "- MATH: fractions as {3/4}; mixed numbers 2 {1/3}; powers with ² ³; symbols × ÷ − = % < >; keep units.\n" +
    "- A drawing, shape, number line, clock or graph: REDRAW it as clean SVG on ONE line: [FIG] <svg …>…</svg> (viewBox about 120-320 wide, black strokes, fill=\"none\", every label as <text> exactly as written).\n" +
    "- A table: [TABLE] cell | cell || cell | cell.\n" +
    "- Wrap anything not fully sure in ⟦ ⟧ like ⟦28.8⟧ (two readings → ⟦28.8|28.3⟧). Never change a number. Leave out crossed-out work, ticks and scores.";
  function plainFormat(t) {
    return "Below is a word-for-word transcript of something dictated aloud. Write it out as plain text using the OUTPUT FORMAT: add the punctuation and paragraph breaks of written text, numbers as digits, and keep EVERY spoken word in its order — nothing added, removed, summarised or reordered; keep every ⟦ ⟧ mark.\n\n" + FMT() + "\n\nTRANSCRIPT:\n" + t + "\n\nReply with the text only.";
  }
  function plainRead(b, slow) {
    return "You are the most careful transcriber of Arabic and English pages: handwriting, typed pages, photocopies, notes, any document.\n\n" + stripsNote(b) + (slow ? STRIPWISE : '') +
      "Transcribe the ENTIRE page word for word, as plain text.\n\n" + ROT_NOTE + FMT();
  }
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
  var KIND_PROMPT = "This is a photo of an Egyptian legal paper. Reply with ONLY its title line exactly as written at the top of the page (for example: دعوى صحة توقيع / إعادة إعلان في الدعوى / إعلان بأصل الصحيفة / إنذار عرض قيمة إيجارية / عقد بيع ابتدائي / عقد هبة / إقرار / مذكرة بدفاع / طلب وراثة / إعلان في مادة الوراثة / صحيفة استئناف). If there is no title, reply with the first written line. Then on a second line write PRINTED if the body of the page is typed, printed or a photocopy of print, or HANDWRITTEN if it is written by hand. Nothing else.";
  function glossarySystem(lines) {
    return "\n\nCOMMON EXPRESSIONS OF EGYPTIAN COURT PAPERS (all types — pleadings, judgments, notices, contracts, inheritance, family): \n" + lines +
      "\nWhen a hard-to-read word sits inside one of these expressions and the visible letters fit it, read it as the expression says; when the letters do not fit, write what the ink shows and mark it.";
  }
  function transcribePrompt(i, n, cmds) {
    return "Transcribe this Arabic audio recording word for word. The speaker is Egyptian: everyday Egyptian Arabic or formal legal Arabic (court papers read aloud: إعلانات، صحة توقيع، إنذارات، عقود، مذكرات، أحكام). Write in Arabic script exactly what is said — do not summarise, translate, add, drop or rephrase anything, and never complete a sentence from what legal papers usually say. " +
      "Numbers, dates, amounts and case numbers as digits (ألفين وستة وعشرين → 2026, عشرة يناير → 10/1). " +
      (cmds ? "Spoken punctuation commands — «نقطة» «فاصلة» «علامة استفهام» alone at the end of a phrase, «سطر جديد», «فقرة جديدة», «عنوان» before a title — are written as the punctuation or the break, not as words; when such a word is part of the sentence it stays a word. " : "") +
      "One line per sentence or pause; an empty line where the speaker clearly starts a new paragraph. A word you cannot make out → ⟦؟⟧; a word you are not sure of → ⟦الكلمة⟧ (two possible hearings → ⟦الأولى|الثانية⟧). Names of people and places, dates, amounts and case numbers must come from the sound only: mark them when unsure. No commentary, no headings, no translation. If there is no speech at all reply exactly: لا يوجد كلام." +
      (n > 1 ? " (This is part " + i + " of " + n + " of the same recording; the parts overlap by a few seconds — transcribe this part fully.)" : "") +
      "\n\nCommon expressions of Egyptian court papers, for recognition only (never insert one that was not said): وحيث إن، بناء عليه، لذلك، تلتمس المحكمة، أنا المحضر سالف الذكر، قد انتقلت إلى حيث إقامة المعلن إليه، وأعلنته بالآتي، الطالب، المعلن إليه، المدعي، المدعى عليه، صحيفة الدعوى، مذكرة بدفاع، منطوق الحكم، ولهذه الأسباب، حكمت المحكمة، وكيل الطالب، المحامي، رقم الدعوى، جلسة، استئناف، نقض، ومحله المختار، بصفته، ولأجل العلم.";
  }
  var FIX_PROMPT = "You are an expert proofreader of Egyptian legal Arabic. Below is a faithful transcription of a handwritten paper, one numbered paragraph per line. List ONLY spelling and grammar corrections that keep the meaning: hamza forms (أ إ آ ا ء ئ ؤ), ة/ه, ى/ي, agreement (gender, number), a word clearly missing or repeated, punctuation. NEVER change names of people or places, dates, numbers, amounts, case numbers, article numbers, court names, or the fixed legal formulas as Egyptian lawyers write them (e.g. «وحيث إن», «بناء عليه», «لذلك», «نصمم على الطلبات»). An unusual but correct legal phrasing is not an error. Reply with one correction per line, nothing else:\n<paragraph number> | <the wrong text exactly as it appears, 1-4 words> | <the corrected text> | <reason in a few Arabic words>\nIf there is nothing to correct reply exactly: لا شيء\n\nTEXT:\n";
  function bankSystem(label, lines) {
    return "You know the standard wording of Egyptian «" + label + "» papers exactly as this law office writes them. STANDARD FORMULAS of this paper type (names, numbers and places are replaced by {{NAME}}, # and {{PLACE}}):\n" + lines +
      "\n\nThese papers are written from the same formulas every time: most lines on the page ARE one of these formulas with the names, numbers and places filled in. Read every line against them: when a word is hard to read but its line clearly follows a formula, read it as the formula says (same spelling as the office) and do not mark it. Never do that for names, numbers, dates, case numbers, amounts, addresses or anything that varies from paper to paper: those come from the ink only, digit by digit and letter by letter, and stay in ⟦ ⟧ when unsure.";
  }
  var PROMPTS = EXAM ? {
    bankSystem: bankSystem, glossary: glossarySystem, transcribe: transcribePrompt,
    format: function (t) { if (plainRun) return plainFormat(t); return "Below is a word-for-word transcript of a teacher dictating a mathematics exam. Lay it out as the exam paper using the OUTPUT FORMAT, keeping every spoken word and number (nothing added, removed, corrected or reordered; ⟦ ⟧ marks kept). Spoken numbers become digits.\n\n" + FMT() + "\n\nTRANSCRIPT:\n" + t + "\n\nReply with the formatted exam only."; },
    fix: function (t) { return FIX_PROMPT.replace('Egyptian legal Arabic', 'English and Arabic exam papers').replace(/NEVER change names[^\n]*?\. /, 'NEVER change numbers, units, answer choices or the mathematics. ') + t; },
    numbers: function (b) { return stripsNote(b) + NUMBERS_PROMPT; },
    kind: function () { return KIND_PROMPT; },
    read: function (b) { if (plainRun) return plainRead(b, false); return "You transcribe handwritten mathematics exam drafts written by a primary-school teacher into a clean exam.\n\n" + stripsNote(b) + "Transcribe every question and every answer choice on the page, in order.\n\n" + ROT_NOTE + FMT(); },
    read2: function (b) { if (plainRun) return plainRead(b, true); return "You transcribe handwritten mathematics exam drafts written by a primary-school teacher into a clean exam.\n\n" + stripsNote(b) + STRIPWISE + "Transcribe every question and every answer choice on the page, in order. Check each digit twice.\n\n" + ROT_NOTE + FMT(); },
    check: function (b, d) { return "Proofread this transcription of the attached handwritten mathematics exam page against the images. " + stripsNote(b) + "Check every number, symbol, unit, fraction, answer choice and question, that nothing is missing or doubled, and that each [FIG] SVG matches its drawing. Remove ⟦ ⟧ from things you can now confirm; keep it on anything still uncertain. Keep exactly the same format.\n\n" + FMT() + "\n\nDRAFT:\n" + d + "\n\nReply with the full corrected transcription only."; },
    judge: function (b, r1, r2, d) { return "Two transcribers copied the attached handwritten mathematics exam page independently. " + stripsNote(b) + diffNote(d) + "For every disagreement look closely at the images and keep what the page really shows. Also re-check every number, fraction, unit and answer choice. Where the image still does not settle it, wrap it in ⟦ ⟧ — with the plausible readings separated by | (⟦28.8|28.3⟧). Keep each [FIG] SVG from the reading whose drawing matches better.\n\n" + FMT() + "\n\nREADING 1:\n" + r1 + "\n\nREADING 2:\n" + r2 + "\n\nReply with the one correct full transcription only."; }
  } : {
    bankSystem: bankSystem, glossary: glossarySystem, transcribe: transcribePrompt,
    caseSystem: function (label, lines) { return "\n\nSTANDARD WORDING OF «" + label + "» CASES IN EGYPTIAN COURTS (published forms; names {{NAME}}, places {{PLACE}}, numbers #):\n" + lines + "\nA hard-to-read word inside one of these sentences is read as the formula says when the visible letters fit, in its correct spelling; names, numbers, dates and amounts always come from the ink."; },
    format: function (t) { if (plainRun) return plainFormat(t); return "Below is a word-for-word transcript of an Egyptian legal paper dictated or read aloud. Lay it out as the written paper would be, using the OUTPUT FORMAT: the document's name as [H], side headings [S], each party or numbered item as [N], centered formula lines [C], normal paragraphs otherwise. Keep EVERY spoken word in its order — nothing added, removed, corrected, summarised or reordered; keep every ⟦ ⟧ mark. Add the punctuation of a written paper. Numbers, dates (d/m/yyyy), amounts and case numbers as digits in the house style (spoken «ألفين وستة وعشرين» → 2026). Never fill in a name, number or formula that was not spoken.\n\n" + FMT() + "\n\nTRANSCRIPT:\n" + t + "\n\nReply with the formatted text only."; },
    fix: function (t) { return FIX_PROMPT + t; },
    form: function (label, refs, t) {
      return "You check a faithful transcription of an Egyptian legal paper («" + label + "») against the standard wording of Egyptian court formulas. The transcription is one numbered paragraph per line; ⟦ ⟧ marks a word the reader was unsure of and ⟦....⟧ a word it could not read.\n" +
        "Suggest a change ONLY where:\n(a) words of the transcription are clearly a misreading or misspelling of the same words of a formula below (the same sentence, a word or two read wrong), or\n(b) a ⟦ ⟧ or ⟦....⟧ mark sits inside a formula sentence and the formula shows exactly which word it is.\n" +
        "NEVER suggest adding a sentence, line or phrase that is not in the transcription. Never remove or reword the lawyer's own wording: when it differs from a formula but is correct Arabic it is NOT an error. Never change names of people or places, numbers, dates, amounts or case numbers.\n" +
        "Reply with one suggestion per line, nothing else:\n<paragraph number> | <the text exactly as in the transcription, 1-6 words, marks included like ⟦....⟧> | <the corrected text> | <reason in a few Arabic words>\nIf there is nothing to suggest reply exactly: لا شيء\n\n" +
        "TRANSCRIPTION:\n" + t + "\n\nSTANDARD FORMULAS (names {{NAME}}, places {{PLACE}}, numbers #):\n" + refs;
    },
    numbers: function (b) { return stripsNote(b) + NUMBERS_PROMPT; },
    kind: function () { return KIND_PROMPT; },
    read: function (b) { if (plainRun) return plainRead(b, false); return "You are the most careful transcriber of Arabic and English documents: messy handwriting, typed pages, photocopies, legal papers for Egyptian courts (صحة توقيع، إعلانات، إنذارات، عقود بيع وهبة، إقرارات، مذكرات).\n\n" + stripsNote(b) + "Transcribe the ENTIRE page word for word, exactly as written, working line by line through the strips. For every hard word use its letter shapes, how this hand writes the same letters elsewhere, the sentence, and the standard formulas of this kind of paper; give your best reading and mark it ⟦ ⟧ when unsure. The formulas only help you recognise what is written — never write words the page does not show. Names, numbers, dates and amounts come from the ink letter by letter and digit by digit (the earlier pages may confirm them); when unsure, the best reading in ⟦ ⟧.\n\n" + ROT_NOTE + FMT(); },
    read2: function (b) { if (plainRun) return plainRead(b, true); return "You are the most careful transcriber of Arabic and English documents: messy handwriting, typed pages, photocopies, legal papers for Egyptian courts.\n\n" + stripsNote(b) + STRIPWISE + "Transcribe the ENTIRE page word for word. Names of people and places, numbers, dates and case numbers must be copied letter by letter; if any letter is unsure, mark the word.\n\n" + ROT_NOTE + FMT(); },
    decide: function (b, marked, two) {
      return (two ? "Two transcribers copied the attached page independently. You settle the places where they differ. " : "You are proofreading a transcription of the attached page against the page itself. ") + stripsNote(b) +
        "Below is reading 1. MARKED PLACES: " + (two ? "every place where reading 2 differs is written ⟪n| reading 1 ‖ reading 2⟫ (∅ = nothing there); " : "") + "a place reading 1 was unsure of is written ⟪n| ⟦…⟧⟫.\n" +
        "For each marked place look closely at the ink of that line in the strips and write what the page really says — not what sounds better. An ordinary word whose strokes fit one reading (with the sentence and the formulas helping to recognise it) is written WITHOUT ⟦ ⟧. Otherwise give your best reading inside ⟦ ⟧ (⟦a|b⟧ for two) — never dots, never empty when something is written there. Never add words the page does not show. Ordinary words in correct spelling; names, numbers and dates exactly as the ink shows.\n" +
        "Then check EVERY number, date, amount and case number of reading 1 against the strips digit by digit (a year has four digits), and every word that is plainly misread or misspelled: for each error outside the marked places write one FIX line.\n" +
        "Reply ONLY with lines in this format, no other text:\n<n> | <final text for place n>\nFIX | <the wrong text exactly as in reading 1, 1-5 words> | <the correct text>\n\n" +
        "READING 1 (with the marked places):\n" + marked;
    },
    printed: function (t) { return "This page is PRINTED (typed), and a free OCR engine on the device has already read it. Correct that text against the attached image of the page: fix every misread, glued, split or missing word, number, date and name; drop OCR garbage and repeated lines; restore the paragraphs and the layout tags. Add nothing the page does not show; where the image is unclear, mark the word as the format says.\n\n" + FMT() + "\n\nOCR OUTPUT:\n" + t + "\n\nReply with the full corrected transcription only."; },
    check: function (b, d) { return "You are proofreading a transcription of the attached page against the page itself. " + stripsNote(b) + "Go through the draft line by line and word by word against the images. Fix every misread word, missing or extra word, wrong number, date, name, digit order, bold/underline, and any skipped or doubled paragraph; delete any word or sentence that is not on the page. Remove ⟦ ⟧ from words you can now confirm; keep or add ⟦ ⟧ on anything still uncertain (your best reading inside, never dots). Keep the same format.\n\n" + FMT() + "\n\nDRAFT TRANSCRIPTION:\n" + d + "\n\nReply with the full corrected transcription only."; },
    judge: function (b, r1, r2, d) { return "Two transcribers copied the attached page independently. You decide the final text. " + stripsNote(b) + diffNote(d) + "For every disagreement look closely at the ink in the images and keep what the page really shows — not what sounds better. Also check that no paragraph is missing or doubled and that the layout tags are right; never keep a sentence that is not on the page. Where the image still does not settle a word, wrap your best reading in ⟦ ⟧ — with the plausible readings separated by | when there are two or three, the most likely first (⟦محمود|محمد⟧).\n\n" + FMT() + "\n\nREADING 1:\n" + r1 + "\n\nREADING 2:\n" + r2 + "\n\nReply with the one correct full transcription only."; }
  };
})();
