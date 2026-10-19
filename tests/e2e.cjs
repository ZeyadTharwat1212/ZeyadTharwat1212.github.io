/* End-to-end check of kateb.html (legal) and hanan.html (exam) in Chromium with a fake Gemini.
   Covers: two reads + judge, doubt marks, review bar (next / confirm), Word download, PDF print, draft restore.
   Run: cd tests && npm install && npm run e2e      (SHOTS=dir saves screenshots and the PDF there) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const JSZip = require('jszip');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOTS || '';
const JSZIP_SRC = fs.readFileSync(require.resolve('jszip/dist/jszip.min.js'), 'utf8');

const LEGAL = {
  A: '[H] **مذكرة بدفاع**\n[S] الوقائع\nالسيد / أحمد محمد علي\tبصفته\nفي القضية رقم 1234 لسنة ٢٠٢٤ ⟦مدني⟧ كلي\n[N] ١- رفض الدعوى\n[TABLE] الاسم | الصفة || أحمد | مدعي\n[L] **المحامي**',
  B: '[H] **مذكرة بدفاع**\n[S] الوقائع\nالسيد / أحمد محمود علي\tبصفته\nفي القضية رقم 1284 لسنة ٢٠٢٤ مدني كلي\n[N] ١- رفض الدعوى\n[TABLE] الاسم | الصفة || أحمد | مدعي\n[L] **المحامي**',
  J: '[H] **مذكرة بدفاع**\n[S] الوقائع\nالسيد / أحمد محمد علي\tبصفته\nفي القضية رقم 1234 لسنة ٢٠٢٤ مدني كلي\n[N] ١- رفض الدعوى\n[TABLE] الاسم | الصفة || أحمد | مدعي\n[L] **المحامي**'
};
const EXAM = {
  A: 'GRADE: Primary 4\n[Q] Question (1) Choose the correct answer\n[I] **1)** 3 + {1/2} = __________\n[OPT] a) 3 | b) 3.5 | c) 4 | d) 5\n[FIG] <svg viewBox="0 0 120 80"><rect x="10" y="10" width="100" height="60" stroke="black" fill="none" stroke-width="2"/></svg>',
  B: 'GRADE: Primary 4\n[Q] Question (1) Choose the correct answer\n[I] **1)** 3 + {1/2} = __________\n[OPT] a) 3 | b) 3.5 | c) 4 | d) 5\n[FIG] <svg viewBox="0 0 120 80"><rect x="10" y="10" width="100" height="60" stroke="black" fill="none" stroke-width="2"/></svg>'
};

function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

async function fakeWorld(context, answers, calls) {
  await context.route(/cdnjs\.cloudflare\.com\/.*jszip/, r => r.fulfill({ contentType: 'text/javascript', body: JSZIP_SRC }));
  await context.route(/cdnjs\.cloudflare\.com\/.*pdf/, r => r.fulfill({ contentType: 'text/javascript', body: 'window.pdfjsLib={};' }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  await context.route(/api\.anthropic\.com\/v1\/messages/, async r => {
    const body = JSON.parse(r.request().postData()), prompt = body.messages[0].content.filter(c => c.type === 'text').map(c => c.text).join('');
    const kind = /ONLY its title line/.test(prompt) ? 'kind' : /List EVERY number/.test(prompt) ? 'numbers' : /Two transcribers/.test(prompt) ? 'judge' : /Proofread|proofreading/.test(prompt) ? 'check' : /Work strip by strip/.test(prompt) ? 'read2' : 'read';
    calls.push(kind); calls.claude = calls.claude || []; calls.claude.push({ kind, model: body.model, system: (body.system || []).map(s => s.text).join(''), images: body.messages[0].content.filter(c => c.type === 'image').length, effort: body.output_config && body.output_config.effort });
    const text = { read: answers.A, read2: answers.B, judge: answers.J || answers.A, check: answers.A, numbers: answers.N || '', kind: answers.K || (answers.A.split('\n')[0].replace(/^\[H\]\s*/, '')) }[kind];
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: (kind === 'read' && answers.ROT ? 'ROT: ' + answers.ROT + '\n' : '') + text }] }) });
  });
  await context.route(/generativelanguage\.googleapis\.com/, async r => {
    const url = r.request().url();
    if (/\/models\?/.test(url)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
    const prompt = JSON.parse(r.request().postData()).contents[0].parts[0].text;
    let kind = /CLOCKWISE/.test(prompt) ? 'rot' : /List EVERY number/.test(prompt) ? 'numbers' : /Two transcribers/.test(prompt) ? 'judge' : /Proofread|proofreading/.test(prompt) ? 'check' : /Work strip by strip/.test(prompt) ? 'read2' : 'read';
    calls.push(kind);
    const text = { rot: '0', read: answers.A, read2: answers.B, judge: answers.J || answers.A, check: answers.A, numbers: answers.N || '' }[kind];
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }) });
  });
}

async function pagePhoto(browser) {
  const p = await browser.newPage({ viewport: { width: 600, height: 800 } });
  await p.setContent('<body style="margin:0;background:#fff;font:28px serif;padding:40px">مذكرة بدفاع<br>السيد / أحمد محمد علي<br>رقم 1234 لسنة ٢٠٢٤</body>');
  const png = await p.screenshot(); await p.close(); return png;
}

async function runMode(browser, base, file, answers, check, key, drive) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
  const calls = [];
  await fakeWorld(context, answers, calls);
  await context.addInitScript(k => { try { localStorage.setItem('kateb.apikey', k); } catch (e) {} window.__printed = 0; window.print = () => { window.__printed++; }; }, key || 'test-key');
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(base + '/' + file);
  await page.waitForSelector('#start:not([hidden])');
  if (drive) { await drive(page); assert.deepStrictEqual(errors, [], 'no page errors'); await context.close(); return; }
  await page.setInputFiles('#file', { name: 'page1.png', mimeType: 'image/png', buffer: await pagePhoto(browser) });
  await page.waitForSelector('#tray:not([hidden])'); await page.click('#goBtn');
  await page.waitForSelector('#done:not([hidden])', { timeout: 20000 });
  assert.deepStrictEqual(errors, [], 'no page errors');
  await check(page, calls, context);
  await context.close();
}

(async () => {
  const server = await serve(), base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  let failed = 0;
  async function step(name, fn) { try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); } }

  await step('legal: two reads differ → judge → guarded marks → review → Word + PDF + draft', () => runMode(browser, base, 'kateb.html', LEGAL, async (page, calls) => {
    assert.deepStrictEqual(calls.sort(), ['judge', 'numbers', 'read', 'read2'], 'both reads + one judge + the numbers pass, no separate rotation call');
    assert.strictEqual(await page.locator('.pg .orig img').count(), 1, 'original photo beside the text');
    const marked = await page.locator('#pagesBox mark').allTextContents();
    assert.deepStrictEqual(marked.sort(), ['١٢٣٤', 'محمد'].sort(), 'disputed name + number are marked (shown with Arabic digits); a word the judge confirmed is not');
    assert.strictEqual(await page.locator('#pagesBox table td').count(), 4);
    assert.strictEqual(await page.locator('#pagesBox p.sub').count(), 1);
    assert.strictEqual(await page.locator('#pagesBox p.li').count(), 1);
    assert.ok(await page.locator('#doubtBar').isVisible());
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'legal-review.png'), fullPage: true });
    /* house style in the editor: digits are Western; an Arabic-Indic keystroke is converted */
    await page.evaluate(() => { const p = document.querySelector('#pagesBox .sheet p.sub'); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); p.focus(); });
    await page.keyboard.type(' 5٧');
    assert.match(await page.textContent('#pagesBox .sheet p.sub'), /٥٧$/, 'the screen shows ٠-٩ like the office Word display');
    assert.ok(!/[0-9]/.test(await page.textContent('#pagesBox .sheet')), 'no Western digits on screen');
    await page.keyboard.press('Shift+Home'); await page.keyboard.press('End');
    await page.click('#nextDoubt');
    assert.strictEqual(await page.locator('#pagesBox mark.cur').count(), 1);
    await page.click('#okDoubt');
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 1, 'confirm removes one mark');
    assert.match(await page.textContent('#doubtCount'), /1/);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
    /* headless Chromium reports Arabic download names as "download"; real browsers keep «مستند 2026-…docx» */
    assert.match(dl.suggestedFilename(), /\.docx$|^download$/);
    const zip = await JSZip.loadAsync(fs.readFileSync(await dl.path()));
    const doc = await zip.file('word/document.xml').async('string');
    for (const w of ['مذكرة بدفاع', 'أحمد محمد علي', '<w:tbl>', '<w:highlight w:val="yellow"/>', '1234', '57']) assert.ok(doc.includes(w), 'Word has ' + w);
    assert.ok(!/[٠-٩]/.test(doc), 'the Word file stores Western digits like the office files');
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'legal.docx'), fs.readFileSync(await dl.path()));
    await page.click('#pdfBtn'); await page.waitForFunction(() => window.__printed === 1);
    assert.ok((await page.innerHTML('#printRoot')).includes('مذكرة بدفاع'));
    if (SHOTS) { await page.emulateMedia({ media: 'print' }); await page.pdf({ path: path.join(SHOTS, 'legal.pdf'), format: 'A4', preferCSSPageSize: true }); await page.emulateMedia({ media: 'screen' }); }
    await page.waitForTimeout(900);                      // draft is saved 0.8 s after the last edit
    await page.reload(); await page.waitForSelector('#resumeBtn:not([hidden])');
    await page.click('#resumeBtn'); await page.waitForSelector('#done:not([hidden])');
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 1, 'draft keeps the reviewed state');
    assert.strictEqual(await page.locator('.pg .orig img').count(), 1, 'draft keeps the photo');
  }));

  await step('legal: readings agree → no judge call, nothing extra marked', () => runMode(browser, base, 'kateb.html', { A: LEGAL.J, B: LEGAL.J }, async (page, calls) => {
    assert.deepStrictEqual(calls.sort(), ['numbers', 'read', 'read2']);
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 0);
    assert.ok(await page.locator('#doubtBar').isHidden());
    assert.match(await page.textContent('#doubtNote'), /لا توجد كلمات مشكوك/);
  }));

  await step('exam: figure, fraction, options → Word with header + PDF', () => runMode(browser, base, 'hanan.html', EXAM, async (page, calls) => {
    assert.deepStrictEqual(calls.sort(), ['numbers', 'read', 'read2']);
    assert.strictEqual(await page.locator('#pagesBox figure img').count(), 1);
    assert.strictEqual(await page.locator('#pagesBox .frac').count(), 1);
    assert.strictEqual(await page.locator('#pagesBox .opt [data-cell]').count(), 4);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
    const zip = await JSZip.loadAsync(fs.readFileSync(await dl.path()));
    assert.ok(zip.file('word/media/image1.png'), 'figure embedded');
    assert.ok((await zip.file('word/document.xml').async('string')).includes('Primary 4'));
    await page.click('#pdfBtn'); await page.waitForFunction(() => window.__printed === 1);
    assert.ok((await page.innerHTML('#printRoot')).includes('xhead'));
    if (SHOTS) { await page.screenshot({ path: path.join(SHOTS, 'exam-review.png'), fullPage: true }); await page.emulateMedia({ media: 'print' }); await page.pdf({ path: path.join(SHOTS, 'exam.pdf'), format: 'A4', preferCSSPageSize: true }); }
  }));

  await step('phone width: review screen has no sideways scroll', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const calls = []; await fakeWorld(context, LEGAL, calls);
    await context.addInitScript(() => { try { localStorage.setItem('kateb.apikey', 'k'); } catch (e) {} });
    const page = await context.newPage(); await page.goto(base + '/kateb.html');
    await page.setInputFiles('#file', { name: 'p.png', mimeType: 'image/png', buffer: await pagePhoto(browser) });
    await page.waitForSelector('#tray:not([hidden])'); await page.click('#goBtn');
    await page.waitForSelector('#done:not([hidden])', { timeout: 20000 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'overflow ' + over + 'px');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-review.png'), fullPage: true });
    await context.close();
  });

  const SIHHA_READ = '[H] دعوى صحة توقيع\nأنه في يوم       الموافق     /    /2026\nبناء علي طلب السيد / **مينا سامي** - بالغ سن الرشد\nومحله المختار مكتب الأستاذ / ألون إبراهيم باشا المحامي .\nأنا معاون تنفيذ محكمة أول أسيوط قد انتقلت وأعلنت :-\n1. السيد / **كريم عادل**\tمخاطبا مع\n[C] وأعلنته بالأتي\nبموجب عقد بيع مؤرخ في 7/1/2026 باع المعلن إليه .\n[C] بناء عليه\n**ولأجل العلم ،،،**';
  await step('office template: auto-detected, lawyer prefilled, Word in the office layout, PDF with the margin column', () => runMode(browser, base, 'kateb.html', { A: SIHHA_READ, B: SIHHA_READ }, async (page) => {
    await page.waitForSelector('#tplBox:not([hidden])');
    assert.strictEqual(await page.inputValue('#tplSel'), 'sihha', 'template detected from the title');
    assert.strictEqual(await page.inputValue('#lawName'), 'ألون إبراهيم باشا');
    assert.strictEqual(await page.inputValue('#lawTitle'), 'المحامي');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
    const zip = await JSZip.loadAsync(fs.readFileSync(await dl.path()));
    const doc = await zip.file('word/document.xml').async('string');
    assert.ok(doc.includes('Zokrofi') && doc.includes('>دعوى صحة توقيع<') && doc.includes('ألون إبراهيم باشا') && !doc.includes('{{'), 'office Word file');
    assert.ok(zip.file('word/media/image2.jpeg'), 'stamp texture kept');
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'office-sihha.docx'), fs.readFileSync(await dl.path()));
    await page.click('#pdfBtn'); await page.waitForFunction(() => window.__printed === 1);
    const pr = await page.innerHTML('#printRoot');
    assert.ok((pr.match(/class="oshape"/g) || []).length >= 3 && pr.includes('كطلب الطالب وتحت مسئوليته') && pr.includes('ألون إبراهيم باشا'), 'PDF shapes: stamp, rule, side box');
    if (SHOTS) { await page.screenshot({ path: path.join(SHOTS, 'office-review.png'), fullPage: true }); await page.emulateMedia({ media: 'print' }); await page.pdf({ path: path.join(SHOTS, 'office-sihha.pdf'), format: 'A4', preferCSSPageSize: true }); await page.emulateMedia({ media: 'screen' }); }
    await page.selectOption('#tplSel', ''); 
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
    const doc2 = await (await JSZip.loadAsync(fs.readFileSync(await dl2.path()))).file('word/document.xml').async('string');
    assert.ok(!doc2.includes('Zokrofi'), 'plain layout when no template is chosen');
  }));

  const SIHHA_B = SIHHA_READ.replace('مينا سامي', 'مينا سامح').replace('باع المعلن', 'باع ⟦المعلز⟧');
  await step('Claude: two parallel Sonnet reads, Opus judge with the صحة توقيع formula bank, rotation from the read, snap fixes a formula word', () => runMode(browser, base, 'kateb.html', { A: SIHHA_READ, B: SIHHA_B, J: SIHHA_B, ROT: 0 }, async (page, calls) => {
    assert.deepStrictEqual(calls.slice().sort(), ['judge', 'kind', 'numbers', 'read', 'read2']);
    const c = calls.claude, reads = c.filter(x => x.kind === 'read' || x.kind === 'read2'), judge = c.find(x => x.kind === 'judge'), nums = c.find(x => x.kind === 'numbers'), kindCall = c.find(x => x.kind === 'kind');
    assert.ok(kindCall.model === 'claude-haiku-5-5' && kindCall.images === 1, 'type detection: one small Haiku call');
    assert.ok(reads.every(x => x.model === 'claude-opus-5-5' && x.images === 6 && x.effort === 'medium'), 'reads on Opus with the whole page + 5 strips');
    assert.ok(reads.every(x => x.system.includes('STANDARD FORMULAS') && x.system.includes('دعوى صحة توقيع')), 'both reads get the sihha bank');
    assert.ok(nums.model === 'claude-opus-5-5' && nums.effort === 'high', 'numbers pass on Opus');
    assert.match(await page.textContent('#readerInfo'), /claude-opus-5-5/, 'review screen shows the real model used');
    assert.strictEqual(judge.model, 'claude-opus-5-5');
    assert.ok(judge.system.includes('STANDARD FORMULAS') && judge.system.includes('دعوى صحة توقيع'), 'judge gets the sihha bank');
    assert.ok(judge.effort === 'high');
    const txt = await page.textContent('#pagesBox .sheet');
    assert.ok(txt.includes('باع المعلن إليه'), 'snap restored the formula word: ' + txt);
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 1, 'only the disputed name stays yellow');
  }, 'sk-ant-test'));
  await step('Claude: the numbers pass completes a truncated year and flags a number it did not see', () => runMode(browser, base, 'kateb.html', { A: SIHHA_READ.replace('7/1/2026', '7/1/202'), B: SIHHA_READ.replace('7/1/2026', '7/1/202'), N: '2026 | الموافق\n7/1/2026 | بيع مؤرخ في' }, async (page) => {
    const txt = await page.textContent('#pagesBox .sheet');
    assert.ok(txt.includes('٧/١/٢٠٢٦'), 'year completed from the numbers pass (shown with Arabic digits): ' + txt);
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 1, 'the completed number is yellow for the eye');
  }, 'sk-ant-test'));
  await step('Claude: a sideways page is rotated from the ROT line and read again', () => runMode(browser, base, 'kateb.html', { A: SIHHA_READ, B: SIHHA_READ, ROT: 90 }, async (page, calls) => {
    assert.ok(calls.filter(k => k === 'read').length >= 2, 'read again after rotating');
    assert.ok(!(await page.textContent('#pagesBox .sheet')).includes('ROT:'));
  }, 'sk-ant-test'));

  await step('camera tray: two shots cleaned to white pages, removed/kept, read together as two pages', () => runMode(browser, base, 'kateb.html', { A: SIHHA_READ, B: SIHHA_READ }, async (page, calls) => {}, 'sk-ant-test', async (page) => {
    const dark = await (async () => { const p = await browser.newPage({ viewport: { width: 500, height: 700 } }); await p.setContent('<body style="margin:0;background:#8a8070;font:34px serif;padding:40px;color:#222">دعوى صحة توقيع<br>بناء علي طلب السيد</body>'); const b = await p.screenshot(); await p.close(); return b; })();
    for (let i = 0; i < 3; i++) await page.setInputFiles('#camFile', { name: 'shot' + i + '.png', mimeType: 'image/png', buffer: dark });
    await page.waitForFunction(() => document.querySelectorAll('#shots .shot').length === 3, null, { timeout: 30000 });   // each shot is straightened and cleaned first
    await page.click('#shots [data-rm="1"]');
    assert.strictEqual(await page.locator('#shots .shot').count(), 2);
    assert.match(await page.textContent('#goBtn'), /2/);
    /* the cleaned shot: mostly white paper, some dark ink (the raw photo was a dull grey) */
    const stats = await page.evaluate(() => { const img = document.querySelector('#shots img'); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let white = 0, dark = 0, n = 0; for (let i = 0; i < d.length; i += 4) { n++; if (d[i] > 230) white++; if (d[i] < 60) dark++; } return { white: white / n, dark: dark / n }; });
    assert.ok(stats.white > 0.6 && stats.dark > 0.005, 'cleaned to white paper with dark ink: ' + JSON.stringify(stats));
    await page.click('#goBtn');
    await page.waitForSelector('#done:not([hidden])', { timeout: 20000 });
    assert.strictEqual(await page.locator('#pagesBox .pg').count(), 2, 'two pages read together');
  }));

  await step('self-update: a newer version.json reloads the app once (caches cleared); the same version never reloads', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));
    await context.route(/cdnjs/, r => r.fulfill({ contentType: 'text/javascript', body: 'window.pdfjsLib={};' }));
    let served = 0; await context.route(/version\.json/, r => { served++; r.fulfill({ contentType: 'application/json', body: JSON.stringify({ v: served === 1 ? '999' : '999' }) }); });
    await context.addInitScript(() => { try { localStorage.setItem('kateb.apikey', 'sk-ant-test'); } catch (e) {} });
    const page = await context.newPage();
    await page.goto(base + '/kateb.html'); await page.waitForURL(/\?r=\d+/, { timeout: 10000 });
    await page.waitForSelector('#start:not([hidden])');
    assert.ok(served >= 2, 'version checked again after the reload');
    assert.strictEqual(await page.evaluate(() => sessionStorage.getItem('kateb.reloadedFor')), '999', 'reloaded once for 999, not in a loop');
    await page.waitForTimeout(800); assert.match(page.url(), /\?r=\d+/);
    await context.close();
  });

  await step('installable app: manifest, icons, offline shell; paste-link unlock', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const calls = []; await fakeWorld(context, LEGAL, calls);
    const page = await context.newPage();
    for (const f of ['kateb', 'hanan']) {
      const m = await (await page.request.get(base + '/' + f + '.webmanifest')).json();
      assert.strictEqual(m.start_url, f + '.html'); assert.strictEqual(m.display, 'standalone');
      for (const ic of m.icons) assert.strictEqual((await page.request.get(base + '/' + ic.src)).status(), 200, ic.src);
    }
    await page.goto(base + '/kateb.html');
    assert.strictEqual(await page.getAttribute('link[rel=manifest]', 'href'), 'kateb.webmanifest');
    await page.waitForSelector('#nokey:not([hidden])');
    await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true), null, { timeout: 10000 });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForTimeout(1200); await page.waitForSelector('#nokey:not([hidden])');   // the app reloads itself once when the worker takes over
    /* paste-link unlock (home-screen app without a saved key) */
    const blob = await page.evaluate(() => Engine.lock('test-key', 'pass123'));
    await page.fill('#linkIn', 'https://example.com/x'); await page.click('#linkForm button');
    assert.ok(await page.isVisible('#linkErr'));
    await page.fill('#linkIn', base + '/kateb.html#k=' + blob); await page.click('#linkForm button');
    await page.waitForSelector('#lock:not([hidden])');
    await page.fill('#pw', 'pass123'); await page.click('#pwBtn');
    await page.waitForSelector('#start:not([hidden])');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('kateb.apikey')), 'test-key');
    assert.strictEqual((await page.textContent('#providerBadge')).trim(), 'Gemini');
    /* a new link (another key) on the same device asks for the password again and replaces the key */
    const blob2 = await page.evaluate(() => Engine.lock('sk-ant-new', 'pass456'));
    await page.goto('about:blank'); await page.goto(base + '/kateb.html#k=' + blob2); await page.waitForSelector('#lock:not([hidden])');
    await page.fill('#pw', 'pass456'); await page.click('#pwBtn'); await page.waitForSelector('#start:not([hidden])');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('kateb.apikey')), 'sk-ant-new');
    assert.strictEqual((await page.textContent('#providerBadge')).trim(), 'Claude');
    await page.goto('about:blank'); await page.goto(base + '/kateb.html#k=' + blob2); await page.waitForSelector('#start:not([hidden])', { timeout: 5000 });   // same link again: no password
    /* offline: the app still opens from the cache */
    await context.setOffline(true);
    await page.reload(); await page.waitForSelector('#start:not([hidden])', { timeout: 10000 });
    await context.setOffline(false);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'start-phone.png') });
    await context.close();
  });

  await browser.close(); server.close();
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
