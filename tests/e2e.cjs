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
  await context.route(/generativelanguage\.googleapis\.com/, async r => {
    const url = r.request().url();
    if (/\/models\?/.test(url)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
    const prompt = JSON.parse(r.request().postData()).contents[0].parts[0].text;
    let kind = /CLOCKWISE/.test(prompt) ? 'rot' : /Two transcribers/.test(prompt) ? 'judge' : /Proofread|proofreading/.test(prompt) ? 'check' : /Work strip by strip/.test(prompt) ? 'read2' : 'read';
    calls.push(kind);
    const text = { rot: '0', read: answers.A, read2: answers.B, judge: answers.J || answers.A, check: answers.A }[kind];
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }) });
  });
}

async function pagePhoto(browser) {
  const p = await browser.newPage({ viewport: { width: 600, height: 800 } });
  await p.setContent('<body style="margin:0;background:#fff;font:28px serif;padding:40px">مذكرة بدفاع<br>السيد / أحمد محمد علي<br>رقم 1234 لسنة ٢٠٢٤</body>');
  const png = await p.screenshot(); await p.close(); return png;
}

async function runMode(browser, base, file, answers, check) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const calls = [];
  await fakeWorld(context, answers, calls);
  await context.addInitScript(() => { try { localStorage.setItem('kateb.apikey', 'test-key'); } catch (e) {} window.__printed = 0; window.print = () => { window.__printed++; }; });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/' + file);
  await page.waitForSelector('#start:not([hidden])');
  await page.setInputFiles('#file', { name: 'page1.png', mimeType: 'image/png', buffer: await pagePhoto(browser) });
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
    assert.deepStrictEqual(calls, ['rot', 'read', 'read2', 'judge']);
    assert.strictEqual(await page.locator('.pg .orig img').count(), 1, 'original photo beside the text');
    const marked = await page.locator('#pagesBox mark').allTextContents();
    assert.deepStrictEqual(marked.sort(), ['1234', 'محمد', 'مدني'].sort(), 'disputed name + number + reader-1 doubt are marked');
    assert.strictEqual(await page.locator('#pagesBox table td').count(), 4);
    assert.strictEqual(await page.locator('#pagesBox p.sub').count(), 1);
    assert.strictEqual(await page.locator('#pagesBox p.li').count(), 1);
    assert.ok(await page.locator('#doubtBar').isVisible());
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'legal-review.png'), fullPage: true });
    await page.click('#nextDoubt');
    assert.strictEqual(await page.locator('#pagesBox mark.cur').count(), 1);
    await page.click('#okDoubt');
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 2, 'confirm removes one mark');
    assert.match(await page.textContent('#doubtCount'), /2/);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
    /* headless Chromium reports Arabic download names as "download"; real browsers keep «مستند 2026-…docx» */
    assert.match(dl.suggestedFilename(), /\.docx$|^download$/);
    const zip = await JSZip.loadAsync(fs.readFileSync(await dl.path()));
    const doc = await zip.file('word/document.xml').async('string');
    for (const w of ['مذكرة بدفاع', 'أحمد محمد علي', '<w:tbl>', '<w:highlight w:val="yellow"/>']) assert.ok(doc.includes(w), 'Word has ' + w);
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'legal.docx'), fs.readFileSync(await dl.path()));
    await page.click('#pdfBtn'); await page.waitForFunction(() => window.__printed === 1);
    assert.ok((await page.innerHTML('#printRoot')).includes('مذكرة بدفاع'));
    if (SHOTS) { await page.emulateMedia({ media: 'print' }); await page.pdf({ path: path.join(SHOTS, 'legal.pdf'), format: 'A4', preferCSSPageSize: true }); await page.emulateMedia({ media: 'screen' }); }
    await page.waitForTimeout(900);                      // draft is saved 0.8 s after the last edit
    await page.reload(); await page.waitForSelector('#resumeBtn:not([hidden])');
    await page.click('#resumeBtn'); await page.waitForSelector('#done:not([hidden])');
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 2, 'draft keeps the reviewed state');
    assert.strictEqual(await page.locator('.pg .orig img').count(), 1, 'draft keeps the photo');
  }));

  await step('legal: readings agree → no judge call, nothing extra marked', () => runMode(browser, base, 'kateb.html', { A: LEGAL.J, B: LEGAL.J }, async (page, calls) => {
    assert.deepStrictEqual(calls, ['rot', 'read', 'read2']);
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 0);
    assert.ok(await page.locator('#doubtBar').isHidden());
    assert.match(await page.textContent('#doubtNote'), /جاهز/);
  }));

  await step('exam: figure, fraction, options → Word with header + PDF', () => runMode(browser, base, 'hanan.html', EXAM, async (page, calls) => {
    assert.deepStrictEqual(calls, ['rot', 'read', 'read2']);
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
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const calls = []; await fakeWorld(context, LEGAL, calls);
    await context.addInitScript(() => { try { localStorage.setItem('kateb.apikey', 'k'); } catch (e) {} });
    const page = await context.newPage(); await page.goto(base + '/kateb.html');
    await page.setInputFiles('#file', { name: 'p.png', mimeType: 'image/png', buffer: await pagePhoto(browser) });
    await page.waitForSelector('#done:not([hidden])', { timeout: 20000 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'overflow ' + over + 'px');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-review.png'), fullPage: true });
    await context.close();
  });

  await browser.close(); server.close();
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
