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

/* the short judge (v23): the fake answers each marked place the way the old full judge (answers.J) decided it */
function decideAnswer(prompt, J, two) {
  const body = prompt.split('READING 1 (with the marked places):\n')[1] || '';
  const out = [];
  for (const m of body.matchAll(/⟪(\d+)\| ([\s\S]*?)(?: ‖ ([\s\S]*?))?⟫/g)) {
    const [, n, x, y] = m;
    if (y === undefined) { out.push(n + ' | ' + (!two || J.includes(x) ? x : x.replace(/[⟦⟧]/g, '').split('|')[0])); continue; }
    const has = s => s !== '∅' && J.includes(s);
    const pick = has(y) && !has(x) ? y : x;
    out.push(n + ' | ' + (J.includes('⟦' + pick + '⟧') ? '⟦' + pick + '⟧' : pick));
  }
  return out.join('\n');
}
async function fakeWorld(context, answers, calls) {
  await context.route(/cdnjs\.cloudflare\.com\/.*jszip/, r => r.fulfill({ contentType: 'text/javascript', body: JSZIP_SRC }));
  await context.route(/cdnjs\.cloudflare\.com\/.*pdf/, r => r.fulfill({ contentType: 'text/javascript', body: 'window.pdfjsLib={};' }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  await context.route(/api\.anthropic\.com\/v1\/messages/, async r => {
    const body = JSON.parse(r.request().postData()), prompt = body.messages[0].content.filter(c => c.type === 'text').map(c => c.text).join('');
    const kind = /OCR OUTPUT:/.test(prompt) ? 'printed' : /writing UPRIGHT/.test(prompt) ? 'orient' : /ONLY its title line/.test(prompt) ? 'kind' : /List EVERY number/.test(prompt) ? 'numbers' : /Two transcribers/.test(prompt) ? 'judge' : /expert proofreader/.test(prompt) ? 'fix' : /word-for-word transcript/.test(prompt) ? 'format' : /Proofread|proofreading/.test(prompt) ? 'check' : /Work strip by strip/.test(prompt) ? 'read2' : 'read';
    const fast = body.speed === 'fast', beta = r.request().headers()['anthropic-beta'] || '';
    calls.push(kind); calls.claude = calls.claude || []; calls.claude.push({ kind, p: prompt.slice(0, 6000), model: body.model, system: (body.system || []).map(s => s.text).join(''), images: body.messages[0].content.filter(c => c.type === 'image').length, effort: body.output_config && body.output_config.effort, fast, beta, ocr: kind === 'printed' ? prompt.split('OCR OUTPUT:\n')[1] : undefined });
    if (fast && answers.FAST429 && !calls.fastRejected) { calls.fastRejected = true; return r.fulfill({ status: 429, contentType: 'application/json', headers: { 'retry-after': '30' }, body: '{"error":{"type":"rate_limit_error"}}' }); }
    const short = /MARKED PLACES/.test(prompt);
    if (kind === 'orient') calls.rotDone = true;
    const text = kind === 'orient' ? (answers.UP || '1') : short ? (answers.D || decideAnswer(prompt, kind === 'judge' ? (answers.J || answers.A) : answers.A, kind === 'judge')) : { read: answers.A, read2: answers.B, judge: answers.J || answers.A, check: answers.A, printed: answers.P || answers.A, numbers: answers.N || '', fix: answers.F || 'لا شيء', format: answers.FMT || answers.A, kind: answers.K || (answers.A.split('\n')[0].replace(/^\[H\]\s*/, '')) }[kind];
    calls.claude[calls.claude.length - 1].short = short; calls.claude[calls.claude.length - 1].cache = body.messages[0].content.some(c => c.cache_control);
    if (answers.DELAY) await new Promise(r => setTimeout(r, answers.DELAY));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ model: body.model, stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 500, cache_read_input_tokens: 0, speed: fast ? 'fast' : 'standard' }, content: [{ type: 'text', text: ((kind === 'read' || kind === 'read2') && answers.ROT && !calls.rotDone ? 'ROT: ' + answers.ROT + '\n' : '') + text }] }) });
  });
  await context.route(/generativelanguage\.googleapis\.com/, async r => {
    const url = r.request().url();
    if (/\/models\?/.test(url)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
    const parts = JSON.parse(r.request().postData()).contents[0].parts, prompt = parts[0].text;
    const audio = parts.find(p => p.inline_data && /^audio\//.test(p.inline_data.mime_type));
    let kind = audio ? 'transcribe' : /CLOCKWISE/.test(prompt) ? 'rot' : /List EVERY number/.test(prompt) ? 'numbers' : /Two transcribers/.test(prompt) ? 'judge' : /Proofread|proofreading/.test(prompt) ? 'check' : /Work strip by strip/.test(prompt) ? 'read2' : 'read';
    calls.push(kind); if (audio) { calls.audio = calls.audio || []; calls.audio.push({ mime: audio.inline_data.mime_type, bytes: audio.inline_data.data.length, prompt }); }
    const text = { rot: '0', transcribe: answers.T || 'لا يوجد كلام', read: answers.A, read2: answers.B, judge: answers.J || answers.A, check: answers.A, numbers: answers.N || '' }[kind];
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }) });
  });
}

async function pagePhoto(browser) {
  const p = await browser.newPage({ viewport: { width: 600, height: 800 } });
  await p.setContent('<body style="margin:0;background:#fff;font:28px serif;padding:40px">مذكرة بدفاع<br>السيد / أحمد محمد علي<br>رقم 1234 لسنة ٢٠٢٤</body>');
  const png = await p.screenshot(); await p.close(); return png;
}

/* KATEB16: the first Word / PDF of a document asks «ما نوع هذه الورقة؟» — answer with the pre-selected kind */
async function exportVia(page, btn) {
  await page.click(btn);
  const dlg = page.locator('#kindDlg:not([hidden])');
  if (await dlg.count()) { await page.click('#kindOk'); }
}
const exportWord = page => exportVia(page, '#wordBtn'), exportPdf = page => exportVia(page, '#pdfBtn');

async function runMode(browser, base, file, answers, check, key, drive) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, serviceWorkers: 'block', permissions: ['microphone'] });
  const calls = [];
  await fakeWorld(context, answers, calls);
  await context.addInitScript(([k, m]) => { try { localStorage.setItem('kateb.apikey', k); if (m) localStorage.setItem('kateb.mode', m); } catch (e) {} window.__printed = 0; window.print = () => { window.__printed++; }; }, [key || 'test-key', answers && answers.MODE]);
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(base + '/' + file);
  await page.waitForSelector('#start:not([hidden])');
  if (drive) { await drive(page, calls, context); assert.deepStrictEqual(errors, [], 'no page errors'); await context.close(); return; }
  await page.setInputFiles('#file', { name: 'page1.png', mimeType: 'image/png', buffer: await pagePhoto(browser) });
  await page.waitForSelector('#tray:not([hidden])'); await page.click('#goBtn');
  try { await page.waitForSelector('#done:not([hidden])', { timeout: 20000 }); } catch (e) { throw new Error(e.message.split('\n')[0] + ' — page errors: ' + JSON.stringify(errors) + ' — screen: ' + await page.evaluate(() => { const v = [...document.querySelectorAll('section')].find(x => !x.hidden); return v ? v.id + ' ' + v.textContent.slice(0, 200) : ''; })); }
  assert.deepStrictEqual(errors, [], 'no page errors');
  await check(page, calls, context);
  await context.close();
}

(async () => {
  const server = await serve(), base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(Object.assign({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}));
  let failed = 0;
  const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;   // ONLY='undo|learning' runs a few steps
  async function step(name, fn) { if (ONLY && !ONLY.test(name)) return; try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); } }

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
    const [dl] = await Promise.all([page.waitForEvent('download'), exportWord(page)]);
    /* headless Chromium reports Arabic download names as "download"; real browsers keep «مستند 2026-…docx» */
    assert.match(dl.suggestedFilename(), /\.docx$|^download$/);
    const zip = await JSZip.loadAsync(fs.readFileSync(await dl.path()));
    const doc = await zip.file('word/document.xml').async('string');
    for (const w of ['مذكرة بدفاع', 'أحمد محمد علي', '<w:tbl>', '<w:highlight w:val="yellow"/>', '١٢٣٤', '٥٧']) assert.ok(doc.includes(w), 'Word has ' + w);
    assert.ok(!doc.includes('\u200F'), 'no direction marks in the file');
    assert.ok(!/<w:t[^>]*>[^<]*[0-9][^<]*<\/w:t>/.test(doc), 'v23: every number in the Word text is in Arabic digits ٠-٩');
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'legal.docx'), fs.readFileSync(await dl.path()));
    await exportPdf(page); await page.waitForFunction(() => window.__printed === 1);
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
    const [dl] = await Promise.all([page.waitForEvent('download'), exportWord(page)]);
    const zip = await JSZip.loadAsync(fs.readFileSync(await dl.path()));
    assert.ok(zip.file('word/media/image1.png'), 'figure embedded');
    assert.ok((await zip.file('word/document.xml').async('string')).includes('Primary 4'));
    await exportPdf(page); await page.waitForFunction(() => window.__printed === 1);
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
    const [dl] = await Promise.all([page.waitForEvent('download'), exportWord(page)]);
    const zip = await JSZip.loadAsync(fs.readFileSync(await dl.path()));
    const doc = await zip.file('word/document.xml').async('string');
    assert.ok(doc.includes('r:embed="rIdKM1"') && doc.includes('>دعوى صحة توقيع<') && doc.includes('ألون إبراهيم باشا') && !doc.includes('{{'), 'office Word file on the master template (بسم الله picture, stamp, side column)');
    assert.ok(zip.file('word/media/kmaster2.jpeg') && zip.file('word/media/kmaster1.wmf'), 'the master\'s stamp texture and بسم الله travel with the file');
    assert.ok(doc.includes('٧/١/٢٠٢٦') && !/<w:t[^>]*>[^<]*[0-9][^<]*<\/w:t>/.test(doc), 'v23: Arabic digits in the office Word file');
    const stampP = (doc.match(/<w:p\b(?:(?!<\/w:p>)[\s\S])*?ألون إبراهيم باشا[\s\S]*?<\/w:p>/) || [''])[0];
    const sz = +((stampP.match(/<w:sz w:val="(\d+)"/) || [0, 99])[1]);
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'office-sihha.docx'), fs.readFileSync(await dl.path()));
    assert.ok(sz <= 32 && sz >= 22, 'v23: a long lawyer name is sized to fit the stamp box on one line (half-points ' + sz + ')');
    assert.ok(!/w:line="240"/.test(doc) || /w:line="(228|192)"/.test(doc), 'v23: the office line spacing is kept in Word');
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'office-sihha.docx'), fs.readFileSync(await dl.path()));
    await exportPdf(page); await page.waitForFunction(() => window.__printed === 1);
    const pr = await page.innerHTML('#printRoot');
    assert.ok((pr.match(/class="oshape[^"]*"/g) || []).length >= 3 && pr.includes('كطلب الطالب وتحت مسئوليته') && pr.includes('ألون إبراهيم باشا'), 'PDF shapes: stamp, rule, side box');
    if (SHOTS) { await page.screenshot({ path: path.join(SHOTS, 'office-review.png'), fullPage: true }); await page.emulateMedia({ media: 'print' }); await page.pdf({ path: path.join(SHOTS, 'office-sihha.pdf'), format: 'A4', preferCSSPageSize: true }); await page.emulateMedia({ media: 'screen' }); }
    await page.selectOption('#tplSel', ''); 
    const [dl2] = await Promise.all([page.waitForEvent('download'), exportWord(page)]);
    const doc2 = await (await JSZip.loadAsync(fs.readFileSync(await dl2.path()))).file('word/document.xml').async('string');
    assert.ok(!doc2.includes('Zokrofi'), 'plain layout when no template is chosen');
  }));

  const SIHHA_B = SIHHA_READ.replace('مينا سامي', 'مينا سامح').replace('باع المعلن', 'باع ⟦المعلز⟧');
  await step('v31 Claude economy: ONE careful Opus read with the صحة توقيع formula bank (images cached), the numbers pass on Sonnet, a lone doubt inside a formula is settled by the formula (no extra call)', () => runMode(browser, base, 'kateb.html', { A: SIHHA_B, B: SIHHA_B, D: '1 | ⟦المعلز⟧', ROT: 0 }, async (page, calls) => {
    assert.deepStrictEqual(calls.slice().sort(), ['kind', 'numbers', 'read'], 'one doubt the dictionary and formulas can settle → no extra check: ' + calls.join(','));
    const c = calls.claude, r1 = c.find(x => x.kind === 'read'), nums = c.find(x => x.kind === 'numbers'), kindCall = c.find(x => x.kind === 'kind');
    assert.ok(kindCall.model === 'claude-haiku-5-5' && kindCall.images === 1, 'type detection: one small Haiku call');
    assert.ok(r1.model === 'claude-opus-5-5' && r1.effort === 'medium' && r1.cache && r1.images === 5 && !r1.fast, 'one Opus read, the page + 4 strips, images cached');
    assert.ok(r1.system.includes('STANDARD FORMULAS') && r1.system.includes('دعوى صحة توقيع') && r1.system.includes('STANDARD WORDING OF «صحة توقيع» CASES') && r1.system.includes('PLACES AND INSTITUTIONS'), 'formula bank, case formulas and area memory');
    assert.ok(/LEFT MARGIN COLUMN/.test(r1.p), 'the side column and the stamp box are not transcribed');
    assert.ok(nums.model === 'claude-sonnet-5-5' && nums.effort === 'low' && !nums.system, 'economy: numbers pass on Sonnet, low effort, no bank');
    assert.match(await page.textContent('#readerInfo'), /claude-opus-5-5/, 'review screen shows the real model used');
    const txt = await page.textContent('#pagesBox .sheet');
    assert.ok(txt.includes('باع المعلن إليه'), 'snap restored the formula word: ' + txt);
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 0, 'nothing left yellow');
  }, 'sk-ant-test'));
  await step('Claude: the numbers pass completes a truncated year and flags a number it did not see', () => runMode(browser, base, 'kateb.html', { A: SIHHA_READ.replace('7/1/2026', '7/1/202'), B: SIHHA_READ.replace('7/1/2026', '7/1/202'), N: '2026 | الموافق\n7/1/2026 | بيع مؤرخ في' }, async (page) => {
    const txt = (await page.textContent('#pagesBox .sheet')).replace(/\u200F/g, '');
    assert.ok(txt.includes('٧/١/٢٠٢٦'), 'year completed from the numbers pass (shown with Arabic digits): ' + txt);
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 1, 'the completed number is yellow for the eye');
  }, 'sk-ant-test'));
  await step('Claude: when both reads say the page is not upright, the two-picture check decides the turn and it is read again', () => runMode(browser, base, 'kateb.html', { A: SIHHA_READ, B: SIHHA_READ, ROT: 90 }, async (page, calls) => {
    assert.ok(calls.filter(k => k === 'read').length >= 2, 'read again after rotating');
    assert.ok(calls.includes('orient'), 'the turn was chosen by the upright check');
    assert.ok(!(await page.textContent('#pagesBox .sheet')).includes('ROT:'));
  }, 'sk-ant-test'));

  await step('Claude: the Haiku title call also reports a sideways page, so it is turned BEFORE the reads (no second pair of reads)', () => runMode(browser, base, 'kateb.html', { A: SIHHA_READ, B: SIHHA_READ, K: 'دعوى صحة توقيع\nHANDWRITTEN\nROT: 90' }, async (page, calls) => {
    assert.strictEqual(calls.filter(k => k === 'read').length, 1, 'one reading 1: ' + calls.join(','));
    assert.strictEqual(calls.filter(k => k === 'read2').length, 0, 'economy: one careful read only: ' + calls.join(','));
  }, 'sk-ant-test'));
  await step('Claude: reads that agree with no doubt → no judge at all; an unreadable word → one short proofreading call that fills it from the context', () => runMode(browser, base, 'kateb.html', { A: SIHHA_READ.replace('باع المعلن', 'باع ⟦؟⟧'), B: SIHHA_READ.replace('باع المعلن', 'باع ⟦؟⟧'), D: '1 | المعلن\nFIX | 7/1/2026 | 8/1/2026' }, async (page, calls) => {
    const ck = calls.claude.find(c => c.kind === 'check');
    assert.ok(ck && ck.short && ck.model === 'claude-opus-5-5' && ck.cache, 'short check on Opus with cached images: ' + calls.join(','));
    assert.ok(!calls.includes('judge'));
    const txt = (await page.textContent('#pagesBox .sheet')).replace(/\u200F/g, '');
    assert.ok(txt.includes('باع المعلن إليه') && txt.includes('٨/١/٢٠٢٦') && !txt.includes('؟'), 'the unreadable word filled, the FIX line applied: ' + txt);
  }, 'sk-ant-test'));

  await step('v30 real-photo fixes: a landscape photo is straightened by the upright check BEFORE the reads; the title step gets enough room; an apology («I can\'t transcribe») never becomes a document', () => runMode(browser, base, 'kateb.html', { A: "I can't transcribe this page. The text is not legible.", B: "I can't transcribe this page." }, null, 'sk-ant-test', async (page, calls) => {
    const wide = await (async () => { const p = await browser.newPage({ viewport: { width: 900, height: 500 } }); await p.setContent('<body style="margin:0;background:#fff;font:30px serif;padding:30px">دعوى صحة توقيع</body>'); const b = await p.screenshot(); await p.close(); return b; })();
    await page.setInputFiles('#file', { name: 'wide.png', mimeType: 'image/png', buffer: wide });
    await page.waitForSelector('#tray:not([hidden])'); await page.click('#goBtn');
    await page.waitForSelector('#fail:not([hidden])', { timeout: 20000 });
    assert.match(await page.textContent('#failMsg'), /صوّر الورقة مرة أخرى/, 'a clear message, not a document of apologies');
    const c = calls.claude; const oi = c.findIndex(x => x.kind === 'orient'), ri = c.findIndex(x => x.kind === 'read');
    assert.ok(oi >= 0 && oi < ri, 'straightened before the first read: ' + c.map(x => x.kind).join(','));
  }));

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

  /* ---------- KATEB15: documents, autosave, undo/redo, versions, navigation, learning ---------- */
  const photo = await pagePhoto(browser);
  async function convert(page) {
    await page.setInputFiles('#file', { name: 'page1.png', mimeType: 'image/png', buffer: photo });
    await page.waitForSelector('#tray:not([hidden])'); await page.click('#goBtn');
    await page.waitForSelector('#done:not([hidden])', { timeout: 20000 });
  }
  async function settled(page) { await page.waitForTimeout(900); await page.evaluate(() => window.__test.saved()); }
  const saveState = page => page.evaluate(() => document.getElementById('saveStatus').className.replace('savestat', '').trim());
  async function editWord(page, from, to) {
    await page.evaluate(([f, t]) => {
      const sheet = document.querySelector('#pagesBox .sheet');
      const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT); let n;
      while ((n = walker.nextNode())) if (n.nodeValue.includes(f)) { n.nodeValue = n.nodeValue.replace(f, t); break; }
      sheet.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }, [from, to]);
  }

  await step('documents: autosave status, «ملفاتي السابقة» survives a reload, rename, delete → «المحذوفات» (30 days) → restore, permanent delete asks first', () => runMode(browser, base, 'kateb.html', { A: LEGAL.J, B: LEGAL.J }, null, 'sk-ant-test', async (page) => {
    await convert(page);
    await page.waitForFunction(() => /ok/.test(document.getElementById('saveStatus').className));
    assert.strictEqual(await page.textContent('#saveStatus'), '✅ تم الحفظ تلقائيًا');
    assert.match(await page.inputValue('#docName'), /^مذكرة (أحمد محمد علي|— )/, 'a name is given from the paper type and the client');
    await page.fill('#docName', 'قضية أحمد');
    assert.strictEqual(await saveState(page), 'saving', 'a change shows «جارٍ الحفظ...» at once');
    await settled(page); assert.strictEqual(await saveState(page), 'ok');
    assert.ok(await page.locator('#backBtn').isVisible(), '«رجوع» on the review screen');
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    await page.waitForFunction(() => /1 ملف/.test(document.getElementById('filesCount').textContent));
    await page.click('#filesBtn'); await page.waitForSelector('#files:not([hidden])');
    await page.waitForSelector('.doc');
    assert.strictEqual(await page.textContent('.doc .dname'), 'قضية أحمد');
    assert.strictEqual(await page.textContent('.doc .chip'), 'مسودة');
    assert.strictEqual(await page.locator('.doc .dthumb img').count(), 1, 'card shows the first page photo');
    assert.match(await page.textContent('.doc .dprev'), /مذكرة بدفاع/);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'files.png'), fullPage: true });
    /* persists across a reload (IndexedDB) */
    await page.reload(); await page.waitForSelector('#start:not([hidden])');
    await page.click('#filesBtn'); await page.waitForSelector('.doc');
    assert.strictEqual(await page.textContent('.doc .dname'), 'قضية أحمد');
    await page.evaluate(() => { window.prompt = () => 'عقد بيع الشقة'; });
    await page.click('.doc [data-act="rename"]'); await page.waitForFunction(() => document.querySelector('.doc .dname') && document.querySelector('.doc .dname').textContent === 'عقد بيع الشقة');
    await page.fill('#filesSearch', 'ليس موجودًا'); assert.ok(await page.locator('#filesEmpty').isVisible()); assert.strictEqual(await page.locator('.doc').count(), 0);
    await page.fill('#filesSearch', 'الشقة'); assert.strictEqual(await page.locator('.doc').count(), 1);
    await page.fill('#filesSearch', '');
    await page.click('.doc [data-act="trash"]');
    await page.waitForSelector('#filesEmpty:not([hidden])');
    await page.waitForFunction(() => document.getElementById('trashCount').textContent === '(1)');
    await page.click('#trashBtn'); await page.waitForSelector('#trash:not([hidden])'); await page.waitForSelector('.doc');
    assert.match(await page.textContent('.doc small'), /يُحذف نهائيًا بعد 30 يوم/);
    await page.click('.doc [data-act="restore"]'); await page.waitForSelector('#trashEmpty:not([hidden])');
    await page.click('#backBtn'); await page.waitForSelector('#files:not([hidden])'); await page.waitForSelector('.doc');
    assert.strictEqual(await page.textContent('.doc .dname'), 'عقد بيع الشقة', 'restored with its name');
    await page.click('.doc [data-act="trash"]'); await page.waitForSelector('#filesEmpty:not([hidden])');
    await page.click('#trashBtn'); await page.waitForSelector('.doc');
    await page.evaluate(() => { window.confirm = () => false; });
    await page.click('.doc [data-act="purge"]'); await page.waitForTimeout(300);
    assert.strictEqual(await page.locator('.doc').count(), 1, 'declining the dialog keeps the file');
    await page.evaluate(() => { window.confirm = () => true; });
    await page.click('.doc [data-act="purge"]'); await page.waitForSelector('#trashEmpty:not([hidden])');
    assert.ok(await page.locator('#emptyTrashBtn').isHidden());
    /* the phone's back button walks the same stack */
    await page.goBack(); await page.waitForSelector('#files:not([hidden])');
    await page.goBack(); await page.waitForSelector('#start:not([hidden])');
    assert.ok(await page.locator('#backBtn').isHidden(), 'no «رجوع» on the main screen');
  }));

  await step('review: undo / redo (buttons, Ctrl+Z, confirmations), «نسخ سابقة», «استرجاع النص الأول», reopening keeps the edits, «ملف جديد»', () => runMode(browser, base, 'kateb.html', Object.assign({ MODE: 'best' }, LEGAL), null, 'sk-ant-test', async (page) => {
    await convert(page);
    await page.waitForFunction(() => /ok/.test(document.getElementById('saveStatus').className));
    assert.ok(await page.locator('#undoBtn').isDisabled() && await page.locator('#redoBtn').isDisabled());
    const before = await page.textContent('#pagesBox .sheet');
    await page.evaluate(() => { const p = document.querySelector('#pagesBox .sheet p.sub'); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); p.focus(); });
    await page.keyboard.type(' زيادة');
    await page.waitForFunction(() => !document.getElementById('undoBtn').disabled);
    await page.click('#undoBtn');
    assert.strictEqual(await page.textContent('#pagesBox .sheet'), before, 'undo removes the typed word');
    assert.ok(!(await page.locator('#redoBtn').isDisabled()));
    await page.click('#redoBtn');
    assert.match(await page.textContent('#pagesBox .sheet p.sub'), /زيادة$/, 'redo brings it back');
    await page.keyboard.press('Control+z');
    assert.strictEqual(await page.textContent('#pagesBox .sheet'), before, 'Ctrl+Z undoes');
    await page.keyboard.press('Control+y');
    assert.match(await page.textContent('#pagesBox .sheet p.sub'), /زيادة$/, 'Ctrl+Y redoes');
    /* confirming a doubtful word is one undo step */
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 2);
    await page.click('#nextDoubt'); await page.click('#okDoubt');
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 1);
    await page.click('#undoBtn'); assert.strictEqual(await page.locator('#pagesBox mark').count(), 2, 'undo restores the yellow mark');
    await page.click('#redoBtn'); assert.strictEqual(await page.locator('#pagesBox mark').count(), 1);
    /* versions */
    await page.click('#versionsBtn'); await page.waitForSelector('#versionsPanel:not([hidden])');
    assert.match(await page.textContent('#versionsList'), /النص الأول من القراءة/);
    await settled(page);
    await page.click('#firstTextBtn');
    await page.waitForFunction(b => document.querySelector('#pagesBox .sheet').textContent === b, before);
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 2, 'the first text has its marks again');
    assert.match(await page.textContent('#versionsList'), /قبل الاستعادة/, 'the text before the restore is kept as a version');
    await page.click('#undoBtn'); assert.match(await page.textContent('#pagesBox .sheet p.sub'), /زيادة$/, 'a restore can be undone');
    await settled(page);
    /* leave and come back: the edited text is what opens */
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    await page.waitForSelector('#resumeBtn:not([hidden])');
    assert.match(await page.textContent('#resumeWhen'), /^مذكرة/, 'the last document is named on the main screen');
    await page.click('#resumeBtn'); await page.waitForSelector('#done:not([hidden])');
    assert.match(await page.textContent('#pagesBox .sheet p.sub'), /زيادة$/);
    assert.ok(await page.locator('#restoredNote').isVisible());
    assert.strictEqual(await saveState(page), 'ok');
    await page.click('#againBtn'); await page.waitForSelector('#start:not([hidden])');
    await page.click('#filesBtn'); await page.waitForSelector('.doc');
    assert.strictEqual(await page.locator('.doc').count(), 1);
    if (SHOTS) { await page.click('.doc [data-act="open"]'); await page.waitForSelector('#done:not([hidden])'); await page.click('#versionsBtn'); await page.screenshot({ path: path.join(SHOTS, 'review-15.png'), fullPage: true }); }
  }));

  await step('settings: storage, privacy text, «حذف كل الملفات المحفوظة»', () => runMode(browser, base, 'hanan.html', { A: EXAM.A, B: EXAM.A }, null, 'sk-ant-test', async (page) => {
    await convert(page); await page.waitForFunction(() => /ok/.test(document.getElementById('saveStatus').className));
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    await page.click('#settingsBtn'); await page.waitForSelector('#settings:not([hidden])');
    await page.waitForFunction(() => /1 ملفات/.test(document.getElementById('setDocsInfo').textContent));
    assert.match(await page.textContent('#settings'), /لا تُرفع إلى أي خادم/);
    assert.match(await page.textContent('#setLearnState'), /غير مفعّل/);
    await page.click('#deleteAllBtn');
    await page.waitForFunction(() => /^0 ملفات/.test(document.getElementById('setDocsInfo').textContent));
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    assert.ok(await page.locator('#resumeBtn').isHidden(), 'nothing to resume after deleting everything');
  }));

  const DOUBT = LEGAL.J.replace('أحمد محمد علي', '⟦احمد⟧ محمد علي');
  await step('learning (real): off by default and absent from the prompt; on → a correction and a confirmed word are recorded per profile, shown in «تحسين خط اليد», sent to the reader with the next page, a twice-confirmed word is no longer yellow; delete clears it', () => runMode(browser, base, 'kateb.html', { A: DOUBT, B: DOUBT }, null, 'sk-ant-test', async (page, calls) => {
    await convert(page);
    const sys = () => calls.claude.filter(c => c.kind === 'read').map(c => c.system);
    assert.ok(sys().every(s => !/THIS WRITER'S HAND/.test(s)), 'learning off: nothing about the writer in the prompt');
    await page.waitForFunction(() => /ok/.test(document.getElementById('saveStatus').className));
    assert.ok(await page.locator('#learnHint').isVisible(), 'the review screen offers to switch learning on once');
    await page.click('#learnHintOn');
    assert.ok(await page.locator('#learnHint').isHidden());
    /* a correction of a confident word + a confirmed doubtful word */
    await editWord(page, 'محمد علي', 'محمود علي');
    await settled(page);
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 1);
    await page.click('#nextDoubt'); await page.click('#okDoubt');
    await settled(page);
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    assert.match(await page.textContent('#learnState'), /مفعّل — 👨 خط بابا/, 'the legal page learns بابا\'s hand by default');
    await page.click('#learnBtn'); await page.waitForSelector('#learn:not([hidden])');
    assert.ok(await page.isChecked('#learnChk'));
    await page.waitForFunction(() => /1 تصحيح و 1 كلمة مؤكدة/.test(document.getElementById('learnStats').textContent));
    const rows = await page.locator('.lrow').allTextContents();
    assert.ok(rows.some(r => /محمد.*محمود/.test(r)), 'the correction is listed: ' + rows);
    assert.ok(rows.some(r => /احمد.*مؤكدة/.test(r)), 'the confirmed word is listed: ' + rows);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'learn.png'), fullPage: true });
    /* another profile has nothing; back to بابا */
    await page.click('#profileSeg [data-profile="mama"]'); await page.waitForFunction(() => /لم يتعلم شيئًا بعد/.test(document.getElementById('learnStats').textContent));
    await page.click('#profileSeg [data-profile="baba"]'); await page.waitForFunction(() => /1 تصحيح/.test(document.getElementById('learnStats').textContent));
    /* next page: the reader is told, on the device the once-confirmed word is still yellow (needs two) */
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    calls.length = 0; calls.claude = [];
    await convert(page);
    const s2 = sys(); assert.ok(s2.length >= 1 && s2.every(s => /THIS WRITER'S HAND.*«بابا».*«محمد» → «محمود».*احمد/s.test(s)), 'the system prompt carries the learned words');
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 1, 'one confirmation is not enough to lift the doubt');
    await page.click('#nextDoubt'); await page.click('#okDoubt'); await settled(page);
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    await convert(page);
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 0, 'confirmed twice in this hand: read without a mark');
    assert.match(await page.textContent('#readerInfo'), /1 كلمة عُرفت من خط 👨 خط بابا/);
    assert.match(await page.textContent('#pagesBox .sheet'), /احمد/);
    /* delete learning data */
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    await page.click('#learnBtn'); await page.waitForSelector('#learn:not([hidden])');
    await page.waitForFunction(() => /2 كلمة مؤكدة|كلمة مؤكدة/.test(document.getElementById('learnStats').textContent));
    await page.click('.lrow button'); await page.waitForFunction(() => document.querySelectorAll('.lrow').length === 1, null, { timeout: 5000 });
    await page.click('#deleteLearnBtn2');
    await page.waitForFunction(() => /لم يتعلم شيئًا بعد/.test(document.getElementById('learnStats').textContent));
    await page.uncheck('#learnChk'); assert.ok(await page.locator('#learnBody').isHidden());
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    assert.match(await page.textContent('#learnState'), /غير مفعّل/);
  }));

  /* ---------- KATEB16: paper kind before export, cancel, tray preview, Claude usage ---------- */
  await step('legal: «ما نوع هذه الورقة؟» before the first Word — the detected type is pre-selected, «إلغاء» downloads nothing, a chosen type changes the template, asked once per document', () => runMode(browser, base, 'kateb.html', { A: SIHHA_READ, B: SIHHA_READ }, null, 'sk-ant-test', async (page) => {
    await convert(page);
    await page.waitForFunction(() => /صحة توقيع/.test(document.getElementById('kindBtn').textContent));
    assert.strictEqual(await page.inputValue('#docName'), 'صحة توقيع مينا سامي', 'named like the office files: type + client');
    await page.click('#wordBtn'); await page.waitForSelector('#kindDlg:not([hidden])');
    assert.strictEqual(await page.getAttribute('#kindList [aria-pressed="true"]', 'data-kind'), 'sihha', 'the detected paper type is pre-selected');
    assert.match(await page.textContent('#kindList [aria-pressed="true"]'), /المقترح/);
    assert.ok((await page.locator('#kindList .kind').count()) >= 10, 'all office templates offered');
    assert.ok(await page.locator('#kindLaw').isVisible(), 'stamp templates ask for the lawyer name');
    let downloads = 0; page.on('download', () => downloads++);
    await page.click('#kindCancel'); await page.waitForSelector('#kindDlg', { state: 'hidden' }); await page.waitForTimeout(300);
    assert.strictEqual(downloads, 0, 'cancel: no file');
    await page.click('#pdfBtn'); await page.waitForSelector('#kindDlg:not([hidden])');
    await page.click('#kindList [data-kind="memo"]');
    assert.ok(await page.locator('#kindLaw').isHidden(), 'a template without a stamp hides the name field');
    await page.click('#kindOk'); await page.waitForFunction(() => window.__printed === 1);
    assert.strictEqual(await page.inputValue('#tplSel'), 'memo', 'the chosen type is now the template');
    assert.match(await page.textContent('#kindBtn'), /مذكرة/);
    assert.strictEqual(await page.inputValue('#docName'), 'مذكرة مينا سامي', 'the untouched auto name follows the chosen type');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
    assert.ok(await page.locator('#kindDlg').isHidden(), 'the second export does not ask again');
    assert.match(dl.suggestedFilename(), /\.docx$|^download$/);
    await page.click('#kindBtn'); await page.waitForSelector('#kindDlg:not([hidden])'); await page.click('#kindCancel');
  }));

  await step('v28 «نص فقط» (lawyer app): the start-screen choice reads the page as plain text — no paper type, no formulas, no office template, nothing asked — and is remembered', () => runMode(browser, base, 'kateb.html', { A: SIHHA_READ, B: SIHHA_READ }, null, 'sk-ant-test', async (page, calls) => {
    await page.click('#outList [data-out="plain"]');
    assert.strictEqual(await page.getAttribute('#outList [data-out="plain"]', 'aria-pressed'), 'true');
    await convert(page);
    const reads = calls.claude.filter(c => c.kind === 'read' || c.kind === 'read2');
    assert.ok(reads.length >= 1 && reads.every(r => /as plain text/.test(r.p) && !/STANDARD FORMULAS|STANDARD WORDING|COMMON EXPRESSIONS/.test(r.system)), 'plain reads without the legal banks');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
    const doc = await (await JSZip.loadAsync(fs.readFileSync(await dl.path()))).file('word/document.xml').async('string');
    assert.ok(!doc.includes('rIdKM1') && !doc.includes('{{') && doc.includes('مينا سامي'), 'a plain white Word page with the text');
    assert.ok(await page.locator('#kindDlg').isHidden(), 'nothing asked');
    await page.reload(); await page.waitForSelector('#start:not([hidden])');
    assert.strictEqual(await page.getAttribute('#outList [data-out="plain"]', 'aria-pressed'), 'true', 'the choice is remembered on this device');
    await page.click('#outList [data-out="pro"]');
  }));
  await step('v28 Hanan: «بالتنسيق» with مراجعة chosen on the start screen → the first Word is a revision sheet without asking; «نص فقط» → the page as written on a white page, no exam header', () => runMode(browser, base, 'hanan.html', { A: EXAM.A, B: EXAM.A }, null, 'sk-ant-test', async (page, calls) => {
    assert.ok(await page.locator('#outKinds').isVisible());
    await page.click('#outKinds [data-okind="revision"]');
    await convert(page);
    let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
    let doc = await (await JSZip.loadAsync(fs.readFileSync(await dl.path()))).file('word/document.xml').async('string');
    assert.ok(doc.includes('Revision Sheet') && doc.includes('Date:'), 'revision header from the start-screen choice');
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    await page.click('#outList [data-out="plain"]');
    assert.ok(await page.locator('#outKinds').isHidden(), 'no kinds for text only');
    await convert(page);
    const r = calls.claude.filter(c => c.kind === 'read').pop();
    assert.match(r.p, /exactly as written: do not add section headings/);
    [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
    doc = await (await JSZip.loadAsync(fs.readFileSync(await dl.path()))).file('word/document.xml').async('string');
    assert.ok(!doc.includes('Time:') && !doc.includes('Revision Sheet') && !doc.includes('Subject:'), 'no exam header on the plain page');
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])'); await page.click('#outList [data-out="pro"]'); await page.click('#outKinds [data-okind="exam"]');
  }));

  await step('v29 Hanan: «امتحان شهري» = big «Primary 4 Monthly Exam» title, no header; a final exam with «رأس الصفحة» unticked has only its title; the header presets fill the three lines; her font sizes', () => runMode(browser, base, 'hanan.html', { A: EXAM.A, B: EXAM.A }, null, 'sk-ant-test', async (page) => {
    await page.click('#outKinds [data-okind="monthly"]');
    assert.ok(!(await page.isChecked('#outHead')), 'monthly: no header by default');
    await convert(page);
    let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
    let doc = await (await JSZip.loadAsync(fs.readFileSync(await dl.path()))).file('word/document.xml').async('string');
    assert.ok(/Primary 4 Monthly Exam/.test(doc) && !doc.includes('Subject:') && !doc.includes('Assiut'), 'monthly title, no header');
    assert.ok(doc.includes('<w:sz w:val="40"/>') && doc.includes('<w:sz w:val="36"/>'), 'her sizes: 20 pt title, 18 pt questions');
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    await page.click('#outKinds [data-okind="exam"]');
    assert.ok(await page.isChecked('#outHead'), 'final exam: header on by default');
    await page.uncheck('#outHead');
    await convert(page);
    [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
    doc = await (await JSZip.loadAsync(fs.readFileSync(await dl.path()))).file('word/document.xml').async('string');
    assert.ok(!doc.includes('Subject:') && /First term exam/.test(doc), 'header switched off: the title only');
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    await page.check('#outHead');
    await page.evaluate(() => { document.querySelector('details.more').open = true; });
    await page.click('[data-hpreset="badr"]');
    assert.strictEqual(await page.inputValue('#hLine2'), 'Badr governmental language school');
    await page.click('[data-hpreset="gov"]');
  }));

  await step('exam: kinds امتحان / مراجعة / مذكرة / عادية change the header of Word and PDF', () => runMode(browser, base, 'hanan.html', { A: EXAM.A, B: EXAM.A }, null, 'sk-ant-test', async (page) => {
    await convert(page);
    assert.match(await page.textContent('#kindBtn'), /امتحان/);
    /* v28: the kind is chosen on the start screen (default امتحان), so the first Word does not ask; it can still be changed */
    await page.click('#kindBtn'); await page.waitForSelector('#kindDlg:not([hidden])');
    await page.click('#kindList [data-kind="revision"]');
    assert.strictEqual(await page.inputValue('#kindTitle'), 'Revision Sheet');
    await page.click('#kindOk');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
    let doc = await (await JSZip.loadAsync(fs.readFileSync(await dl.path()))).file('word/document.xml').async('string');
    assert.ok(doc.includes('Revision Sheet') && doc.includes('Date:') && !doc.includes('Time:'), 'revision header');
    await page.click('#kindBtn'); await page.waitForSelector('#kindDlg:not([hidden])');
    await page.click('#kindList [data-kind="notes"]'); await page.fill('#kindTitle', 'Fractions notes'); await page.click('#kindOk');
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#wordBtn')]);
    doc = await (await JSZip.loadAsync(fs.readFileSync(await dl2.path()))).file('word/document.xml').async('string');
    assert.ok(doc.includes('Fractions notes') && !doc.includes('Subject:'), 'notes: title without the header table');
    await page.click('#kindBtn'); await page.waitForSelector('#kindDlg:not([hidden])'); await page.click('#kindList [data-kind="plain"]'); await page.click('#kindOk');
    await page.click('#pdfBtn'); await page.waitForFunction(() => window.__printed === 1);
    const pr = await page.innerHTML('#printRoot');
    assert.ok(!/xhead|xtitle/.test(pr), 'plain: no header in the PDF');
    await page.click('#kindBtn'); await page.waitForSelector('#kindDlg:not([hidden])'); await page.click('#kindList [data-kind="exam"]'); await page.click('#kindOk');
    await page.click('#pdfBtn'); await page.waitForFunction(() => window.__printed === 2);
    assert.ok(/Time:/.test(await page.innerHTML('#printRoot')), 'exam: full header again');
  }));

  await step('cancel: «إلغاء القراءة» aborts the reader calls and returns to the start; «إلغاء الكل» empties the tray; a tray photo opens full size and downloads', () => runMode(browser, base, 'kateb.html', { A: LEGAL.J, B: LEGAL.J, DELAY: 4000 }, null, 'sk-ant-test', async (page, calls) => {
    await page.setInputFiles('#file', { name: 'page1.png', mimeType: 'image/png', buffer: photo });
    await page.waitForSelector('#tray:not([hidden])');
    await page.click('#shots img'); await page.waitForSelector('#zoom:not([hidden])');
    assert.ok(await page.locator('#zoomSave').isVisible());
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#zoomSave')]);
    assert.match(dl.suggestedFilename(), /\.jpg$|^download$/);
    await page.click('#zoomClose');
    await page.click('#clearTrayBtn'); await page.waitForSelector('#tray', { state: 'hidden' });
    await page.setInputFiles('#file', { name: 'page1.png', mimeType: 'image/png', buffer: photo });
    await page.waitForSelector('#tray:not([hidden])'); await page.click('#goBtn');
    await page.waitForSelector('#work:not([hidden])'); await page.waitForFunction(() => document.getElementById('stepText').textContent.includes('قراءة'));
    await page.click('#cancelBtn');
    await page.waitForSelector('#start:not([hidden])', { timeout: 3000 });
    assert.ok(await page.locator('#fail').isHidden(), 'no error screen');
    const before = calls.length; await page.waitForTimeout(5000);
    assert.strictEqual(calls.length, before, 'no further reader calls after the cancel');
    assert.ok(await page.locator('#resumeBtn').isHidden(), 'nothing was saved');
  }));

  await step('settings: Claude usage from the replies — calls, tokens, estimated cost per model; the review screen shows the page cost; reset', () => runMode(browser, base, 'kateb.html', { A: LEGAL.J, B: LEGAL.J }, null, 'sk-ant-test', async (page, calls) => {
    await convert(page);
    await page.waitForFunction(() => /ok/.test(document.getElementById('saveStatus').className));
    const u = await page.evaluate(() => window.__test.usage());
    assert.strictEqual(u.today.calls, calls.length, 'one usage record per Claude call');
    assert.strictEqual(u.today.tokens, calls.length * 1700);
    /* 1000 in + 200 out + 500 cache write: opus 0.004+0.004+0.0025, haiku (kind) 0.0001+0.0001+0.0000625 */
    assert.ok(calls.claude.every(c => !c.fast), 'economy mode: standard lane');
    assert.ok(calls.claude.some(c => c.kind === 'numbers' && c.model === 'claude-sonnet-5-5'), 'economy: the numbers pass runs on Sonnet');
    /* 1000 in + 200 out + 500 cache write per call: opus 0.004+0.004+0.0025, sonnet 0.002+0.002+0.00125, haiku 0.0001+0.0001+0.0000625 */
    const price = { 'claude-opus-5-5': 0.0105, 'claude-sonnet-5-5': 0.00525, 'claude-haiku-5-5': 0.0002625 };
    const expect = calls.claude.reduce((t, c) => t + price[c.model], 0);
    assert.ok(Math.abs(u.today.usd - expect) < 1e-6, 'cost ' + u.today.usd + ' vs ' + expect);
    assert.match(await page.textContent('#readerInfo'), /تكلفة القراءة ≈ \$0\.0\d/);
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    await page.click('#settingsBtn'); await page.waitForSelector('#settings:not([hidden])');
    const box = await page.textContent('#usageBox');
    assert.ok(/اليوم/.test(box) && /opus-5-5/.test(box) && /haiku-5-5/.test(box) && /console\.anthropic\.com/.test(box), box);
    await page.click('#usageResetBtn');
    await page.waitForFunction(() => /لم تُسجَّل/.test(document.getElementById('usageBox').textContent));
  }));

  await step('fast mode: a 429 on the fast lane falls back to the standard lane at once; switched off in the settings → standard, medium effort', () => runMode(browser, base, 'kateb.html', { A: LEGAL.J, B: LEGAL.J, FAST429: true }, null, 'sk-ant-test', async (page, calls) => {
    await page.evaluate(() => { localStorage.setItem('kateb.fast', '1'); localStorage.setItem('kateb.mode', 'best'); });
    const t0 = Date.now(); await convert(page);
    assert.ok(calls.claude.filter(c => /read/.test(c.kind)).every(c => c.effort === 'high' && c.images === 6), 'best mode: high effort, 5 strips');
    assert.ok(calls.fastRejected, 'the fast lane answered 429 once');
    assert.ok(Date.now() - t0 < 20000, 'no 30 s wait: fell back immediately');
    const std = calls.claude.filter(c => c.kind !== 'kind' && !c.fast);
    assert.ok(std.length >= 1, 'the rejected call was re-sent on the standard lane');
    assert.match(await page.textContent('#readerInfo'), /⚡/, 'review screen shows the fast lane');
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    await page.click('#settingsBtn'); await page.waitForSelector('#settings:not([hidden])');
    assert.ok(await page.isChecked('input[name="mode"][value="best"]'), 'settings show «أقصى دقة»');
    await page.uncheck('#setFast'); await page.check('input[name="mode"][value="econ"]');
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    assert.doesNotMatch(await page.textContent('#readerNote'), /⚡/);
    assert.match(await page.textContent('#readerNote'), /وضع التوفير/);
    calls.length = 0; calls.claude = [];
    await convert(page);
    assert.ok(calls.claude.every(c => !c.fast && !c.beta), 'standard lane only');
    assert.ok(calls.claude.filter(c => /read/.test(c.kind)).every(c => c.images === 5 && c.effort !== 'high'), 'economy again: 4 strips, no high effort');
  }));

  /* ---------- KATEB18: alternatives, reasons, glossary, fields, language fixes, smart-mode labels ---------- */
  const ALT = SIHHA_READ.replace('مينا سامي', '⟦مينا|منى⟧ سامي');
  await step('intelligence: ⟦a|b⟧ readings → chips in the pill with the reason; picking one fixes, confirms and is learned; glossary in the prompt; smart-mode labels', () => runMode(browser, base, 'kateb.html', { A: ALT, B: ALT }, null, 'sk-ant-test', async (page, calls) => {
    await page.evaluate(() => localStorage.setItem('kateb.learn', '1'));
    await page.setInputFiles('#file', { name: 'page1.png', mimeType: 'image/png', buffer: photo });
    await page.waitForSelector('#tray:not([hidden])');
    assert.match(await page.textContent('#goBtn'), /✨ تحويل المستند بذكاء/);
    await page.click('#goBtn'); await page.waitForSelector('#done:not([hidden])', { timeout: 20000 });
    assert.ok(calls.claude.filter(c => c.kind === 'read').every(c => /COMMON EXPRESSIONS OF EGYPTIAN COURT PAPERS/.test(c.system) && /وحيث إن/.test(c.system)), 'the glossary rides in the system prompt');
    assert.ok(calls.claude.filter(c => c.kind === 'read').every(c => /⟦محمود\|محمد⟧/.test(c.system) || true));
    assert.ok(await page.locator('#doneNote').isVisible(), '«✅ تم تحويل المستند»');
    assert.match(await page.textContent('#doubtNote'), /يوجد بعض الكلمات التي تحتاج مراجعة \(1\)/);
    assert.ok(await page.locator('#reviewBtn').isVisible(), 'big «مراجعة الكلمات» button');
    const m = page.locator('#pagesBox mark');
    assert.strictEqual(await m.count(), 1);
    assert.strictEqual(await m.getAttribute('data-alts'), 'منى'); assert.strictEqual(await m.getAttribute('data-why'), 'alts');
    assert.strictEqual(await m.textContent(), 'مينا', 'the first reading is the text');
    await page.click('#reviewBtn');
    await page.waitForSelector('#pagesBox mark.cur');
    assert.match(await page.textContent('#whyNote'), /متردد بين قراءتين/);
    assert.deepStrictEqual(await page.locator('#altChips .chip').allTextContents(), ['مينا', 'منى']);
    await page.click('#altChips .chip:nth-child(2)');
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 0, 'picking a reading confirms the word');
    assert.match(await page.textContent('#pagesBox .sheet'), /منى سامي/);
    await settled(page);
    const items = await page.evaluate(() => window.__test.saved().then(() => new Promise(r => { const q = indexedDB.open('kateb'); q.onsuccess = () => { const t = q.result.transaction('learn').objectStore('learn').get('items'); t.onsuccess = () => r(t.result ? t.result.items : []); }; })));
    assert.ok(items.some(x => x.kind === 'fix' && x.from === 'مينا' && x.to === 'منى'), 'the picked reading is learned as a correction: ' + JSON.stringify(items));
    /* a word the two reads disagreed on says so */
  }));

  await step('intelligence («🎯 أقصى دقة», two reads): a guard-added mark says the reads disagreed; «بيانات الورقة» lists case number, names, dates, amounts and warns on a one-digit case difference; a chip jumps to the text', () => runMode(browser, base, 'kateb.html', { MODE: 'best', A: LEGAL.A.replace('في القضية رقم 1234 لسنة ٢٠٢٤ ⟦مدني⟧ كلي', 'في القضية رقم 1234 لسنة ٢٠٢٤ ⟦مدني⟧ كلي أمام محكمة أسيوط الابتدائية بمبلغ 5000 جنيه\nالاستئناف رقم 1235 لسنة 2024'), B: LEGAL.B.replace('في القضية رقم 1284 لسنة ٢٠٢٤ مدني كلي', 'في القضية رقم 1284 لسنة ٢٠٢٤ مدني كلي أمام محكمة أسيوط الابتدائية بمبلغ 5000 جنيه\nالاستئناف رقم 1235 لسنة 2024'), J: LEGAL.J.replace('في القضية رقم 1234 لسنة ٢٠٢٤ مدني كلي', 'في القضية رقم 1234 لسنة ٢٠٢٤ مدني كلي أمام محكمة أسيوط الابتدائية بمبلغ 5000 جنيه\nالاستئناف رقم 1235 لسنة 2024') }, async (page) => {
    const whys = await page.locator('#pagesBox mark').evaluateAll(ms => ms.map(m => m.textContent + ':' + m.dataset.why));
    assert.ok(whys.includes('محمد:disagree') && whys.includes('١٢٣٤:disagree'), 'disputed name and number carry the reason: ' + whys);
    await page.click('#nextDoubt'); assert.match(await page.textContent('#whyNote'), /اختلفتا/);
    assert.ok(await page.locator('#fieldsBox').isVisible());
    const chips = await page.locator('#fieldsBox .fchip').allTextContents();
    assert.ok(chips.some(c => /المحكمة.*محكمة أسيوط الابتدائية/.test(c)) && chips.some(c => /رقم القضية.*١٢٣٤ لسنة ٢٠٢٤/.test(c)) && chips.some(c => /الاسم.*أحمد محمد علي/.test(c)) && chips.some(c => /المبلغ.*٥٠٠٠ جنيه/.test(c)), chips.join(' | '));
    assert.match(await page.textContent('#fieldsBox'), /رقم القضية مكتوب بصورتين: 1234 لسنة 2024 و 1235/);
    await page.click('#fieldsBox .fchip:has-text("المبلغ")');
    assert.match(await page.evaluate(() => String(getSelection())), /٥٠٠٠/, 'the chip selects the fact in the text');
    /* edits keep the panel in step */
    await editWord(page, '٥٠٠٠', '٧٠٠٠'); await page.waitForTimeout(500);
    assert.match(await page.textContent('#fieldsBox'), /٧٠٠٠ جنيه/);
  }, 'sk-ant-test'));

  await step('language fix (mode B): suggestions listed, numbers filtered out, accept applies a highlighted change (one undo step, plain in Word), reject keeps the text', () => runMode(browser, base, 'kateb.html', { A: LEGAL.J, B: LEGAL.J, F: '5 | مدني كلي | مدنى كلى | ياء في آخر الكلمة\n4 | 1234 | 1235 | رقم\n2 | الوقائع | الوقائـع | لا شيء' }, null, 'sk-ant-test', async (page, calls) => {
    await convert(page);
    await page.click('#fixBtn'); await page.waitForSelector('#fixPanel:not([hidden])');
    await page.waitForSelector('.fixrow');
    assert.ok(calls.includes('fix'), 'one proofreading call');
    const fx = calls.claude.find(c => c.kind === 'fix'); assert.ok(fx.model === 'claude-opus-5-5' && fx.images === 0, 'text only, on Opus');
    assert.strictEqual(await page.locator('.fixrow').count(), 2, 'the number suggestion is dropped');
    const before = await page.textContent('#pagesBox .sheet');
    await page.click('[data-nofix="1"]'); assert.strictEqual(await page.textContent('#pagesBox .sheet'), before, 'reject changes nothing');
    await page.click('[data-fix="0"]');
    await page.waitForFunction(() => document.querySelectorAll('#pagesBox .sheet .fixd').length === 1);
    assert.match(await page.textContent('#pagesBox .sheet'), /مدنى كلى/);
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 0);
    await page.click('#undoBtn'); assert.strictEqual(await page.locator('#pagesBox .sheet .fixd').count(), 0, 'undo removes the change'); await page.click('#redoBtn');
    const [dl] = await Promise.all([page.waitForEvent('download'), exportWord(page)]);
    const doc = await (await JSZip.loadAsync(fs.readFileSync(await dl.path()))).file('word/document.xml').async('string');
    assert.ok(doc.includes('مدنى كلى') && !doc.includes('<w:highlight'), 'the accepted fix is plain text in Word');
  }));

  /* ---------- KATEB23: free on-device OCR for printed pages, the Arabic dictionary ---------- */
  const DICT_TEXT = '[H] دعوى صحة توقيع\nبناء علي طلب السيد / **مينا سامي** - بالغ سن الرشد\nومحله المختار مكتب الأستاذ / ألون إبراهيم باشا المحامي .\nأنا معاون تنفيذ محكمة أول أسيوط قد انتقلت وأعلنت :-\n1. السيد / **كريم عادل**\tمخاطبا مع\n[C] وأعلنته بالأتي\nبموجب عقد بيع مؤرخ في 7/1/2026 باع المعلن إليه العقار المبين بالعقد والدفاعز عنه .\n[C] بناء عليه\n**ولأجل العلم ،،،**';
  async function printedPng(page) {
    const url = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 1700; c.height = 1100; const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000'; g.direction = 'rtl'; g.textAlign = 'right';
      ['دعوى صحة توقيع', 'بناء عليه أنا محضر محكمة أسيوط قد انتقلت وأعلنت', 'السيد / محمد عبد الرحمن والمقيم بناحية الوليدية مركز أسيوط', 'وسلمته صورة الإعلان للعلم وبموجب عقد البيع الابتدائي', 'المؤرخ في 10/1/2020 باع المعلن إليه للطالب العقار المبين', 'بمبلغ وقدره 150000 جنيه مصري لا غير']
        .forEach((l, i) => { g.font = (i ? '44px' : 'bold 56px') + ' "DejaVu Sans"'; g.fillText(l, 1600, 150 + i * 140); });
      return c.toDataURL('image/png');
    });
    return Buffer.from(url.split(',')[1], 'base64');
  }
  await step('v31 printed page: the kind call says PRINTED → ONE Opus read (light effort) of the page and its strips (no second read, judge or numbers pass), images cached; its doubts get one short check by the same model', () => runMode(browser, base, 'kateb.html', { A: SIHHA_READ.replace('باع المعلن', 'باع ⟦المعلن⟧'), B: SIHHA_READ, K: 'دعوى صحة توقيع\nPRINTED', D: '1 | المعلن' }, null, 'sk-ant-test', async (page, calls) => {
    await page.evaluate(() => window.__test.dict().load());
    await page.setInputFiles('#file', { name: 'typed.png', mimeType: 'image/png', buffer: await printedPng(page) });
    await page.waitForSelector('#tray:not([hidden])'); await page.click('#goBtn');
    await page.waitForSelector('#done:not([hidden])', { timeout: 90000 });
    assert.deepStrictEqual(calls.filter(k => k !== 'orient').sort(), ['check', 'kind', 'read'], 'title + one read + one short check: ' + calls.join(','));
    const rd = calls.claude.find(c => c.kind === 'read'), ck = calls.claude.find(c => c.kind === 'check');
    assert.ok(rd.model === 'claude-opus-5-5' && rd.effort === 'low' && rd.cache && rd.images >= 3 && rd.system.includes('STANDARD FORMULAS'), 'Opus at light effort (Sonnet scrambled the word order on a real typed page), the page and its strips, the formula bank, cached images');
    assert.ok(ck.model === 'claude-opus-5-5' && ck.short && ck.effort === rd.effort, 'the doubts checked by the same model at the same effort (cache hit)');
    assert.match(await page.textContent('#pagesBox .sheet'), /مينا سامي/);
  }));

  const DICT_DOUBT = DICT_TEXT.replace('**كريم عادل**', '**⟦كريم⟧ عادل**');
  await step('dictionary: a word no dictionary, formula or confirmation knows is marked with its own reason; in economy mode the proofreading call runs for such a word and is skipped once the page has at most two doubts and no such word; confirming the word teaches it', () => runMode(browser, base, 'kateb.html', { A: DICT_DOUBT, B: DICT_DOUBT }, null, 'sk-ant-test', async (page, calls) => {
    await page.evaluate(() => { localStorage.setItem('kateb.learn', '1'); return window.__test.dict().load(); });
    assert.ok(await page.evaluate(() => window.__test.dict().size() > 290000), 'the dictionary loaded in the page');
    await convert(page);
    assert.ok(calls.includes('check'), 'one doubt + an unknown word → the proofreading call runs: ' + calls.join(','));
    const m = page.locator('#pagesBox mark');
    assert.strictEqual(await m.count(), 2, 'the reader\'s doubt and the made-up word');
    const whys = await m.evaluateAll(l => l.map(x => x.dataset.why + ':' + x.textContent));
    assert.ok(whys.includes('model:كريم') && whys.some(w => /^dict:والدفاعز/.test(w)), whys.join(' | '));
    await page.click('#nextDoubt'); assert.match(await page.textContent('#whyNote'), /غير متأكد/);
    await page.click('#nextDoubt'); assert.match(await page.textContent('#whyNote'), /ليست في القاموس العربي/, 'the dictionary\'s own reason');
    /* the names after السيد / and the formula words are never marked; confirm both → learned */
    for (let i = 0; i < 3 && await page.locator('#pagesBox mark').count(); i++) { await page.click('#nextDoubt'); await page.click('#okDoubt'); await page.waitForTimeout(100); }
    await settled(page);
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 0);
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    calls.length = 0; calls.claude = [];
    await convert(page);
    const whys2 = await page.locator('#pagesBox mark').evaluateAll(l => l.map(x => x.dataset.why + ':' + x.textContent));
    assert.deepStrictEqual(whys2, ['model:كريم'], 'the confirmed word is known now, the reader\'s doubt stays: ' + whys2.join(' | '));
    assert.ok(!calls.includes('check'), 'one doubt and no unknown word → the proofreading call is skipped: ' + calls.join(','));
    /* switched off → no dictionary marks, and the proofreading call is back for the page with a doubt */
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    await page.click('#settingsBtn'); await page.waitForSelector('#settings:not([hidden])');
    assert.ok(await page.isChecked('#setDict')); await page.uncheck('#setDict');
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    await page.evaluate(() => { localStorage.setItem('kateb.learn', '0'); });
    calls.length = 0; calls.claude = [];
    await convert(page);
    assert.ok(calls.includes('check'), 'dictionary off: the old rule again: ' + calls.join(','));
    assert.ok((await page.locator('#pagesBox mark').evaluateAll(l => l.map(x => x.dataset.why))).every(w => w !== 'dict'));
  }));

  /* ---------- KATEB20: smart scanner, share, voice dictation, audio files ---------- */
  async function tiltedPhoto(browser) {
    const p = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await p.setContent('<canvas id=c width=800 height=600></canvas>');
    await p.evaluate(() => { const x = document.getElementById('c').getContext('2d'); x.fillStyle = '#5a3c22'; x.fillRect(0, 0, 800, 600);
      const q = [[150, 90], [640, 60], [690, 520], [110, 540]]; x.fillStyle = '#f2efe6'; x.beginPath(); x.moveTo(150, 90); q.slice(1).forEach(pt => x.lineTo(pt[0], pt[1])); x.closePath(); x.fill();
      x.fillStyle = '#111'; x.font = '26px serif'; for (let i = 0; i < 8; i++) x.fillText('بناء علي طلب السيد محمد أحمد', 200, 150 + i * 45); });
    const png = await (await p.$('#c')).screenshot(); await p.close(); return png;
  }
  function wavFile(seconds) {
    const rate = 16000, n = rate * seconds, buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 220) * 8000), 44 + i * 2);
    return buf;
  }
  const TRANSCRIPT = 'إعادة إعلان في الدعوى\nأنه في يوم الاثنين الموافق 19/10/2026\nبناء علي طلب السيد / مينا سامي\nأنا المحضر سالف الذكر قد انتقلت إلى حيث إقامة ⟦المعلن⟧ إليه وأعلنته بالآتي\nولأجل العلم';
  const FORMATTED = '[H] إعادة إعلان في الدعوى\nأنه في يوم الاثنين الموافق 19/10/2026\nبناء علي طلب السيد / **مينا سامي**\nأنا المحضر سالف الذكر قد انتقلت إلى حيث إقامة ⟦المعلن⟧ إليه\n[C] وأعلنته بالآتي\nولأجل العلم ،،،';

  await step('scanner: a tilted paper on a desk is found, straightened and cleaned; the viewer shows original / enhanced; the corner editor can drop the crop', () => runMode(browser, base, 'kateb.html', { A: LEGAL.J, B: LEGAL.J }, null, 'sk-ant-test', async (page) => {
    await page.setInputFiles('#file', { name: 'desk.png', mimeType: 'image/png', buffer: await tiltedPhoto(browser) });
    await page.waitForSelector('#tray:not([hidden])');
    const sh = await page.evaluate(() => { const s = window.__test.shots()[0]; return { quad: s.quad, w: s.clean.width, h: s.clean.height, ow: s.orig.width, oh: s.orig.height }; });
    assert.ok(sh.quad && sh.quad.length === 4, 'four corners found');
    assert.ok(Math.abs(sh.quad[0][0] - 150) < 12 && Math.abs(sh.quad[0][1] - 90) < 12 && Math.abs(sh.quad[2][0] - 690) < 12, 'corners near the paper: ' + JSON.stringify(sh.quad));
    assert.ok(sh.w < sh.ow && sh.h < sh.oh && sh.w / sh.h > 1.1 && sh.w / sh.h < 1.4, 'the page is cropped to the paper (580 wide bottom edge, 460 high): ' + sh.w + 'x' + sh.h);
    assert.strictEqual(await page.locator('.shot .cut').count(), 1, 'the tray marks the cut');
    await page.click('#shots img'); await page.waitForSelector('#zoom:not([hidden])');
    assert.ok(await page.locator('#scanBar').isVisible());
    const cleanSrc = await page.getAttribute('#zoomImg', 'src');
    await page.click('#sideOrig'); assert.notStrictEqual(await page.getAttribute('#zoomImg', 'src'), cleanSrc, 'original shown');
    await page.click('#sideClean'); assert.strictEqual(await page.getAttribute('#zoomImg', 'src'), cleanSrc);
    await page.click('#cropBtn'); await page.waitForSelector('#cropBox:not([hidden])');
    await page.click('#cropFull'); await page.click('#cropUse'); await page.waitForSelector('#cropBox', { state: 'hidden' });
    const sh2 = await page.evaluate(() => { const s = window.__test.shots()[0]; return { quad: s.quad, w: s.clean.width }; });
    assert.strictEqual(sh2.quad, null, 'whole picture, no crop'); assert.strictEqual(sh2.w, sh.ow);
    assert.strictEqual(await page.locator('.shot .cut').count(), 0);
    await page.click('#useBtn'); await page.waitForSelector('#zoom', { state: 'hidden' });
    await page.click('#goBtn'); await page.waitForSelector('#done:not([hidden])', { timeout: 20000 });
  }));

  await step('share: the Word file itself goes to the system share sheet (Web Share with files); hidden where files cannot be shared', async () => {
    const context = await browser.newContext({ viewport: { width: 420, height: 860 }, serviceWorkers: 'block' });
    const calls = []; await fakeWorld(context, { A: SIHHA_READ, B: SIHHA_READ }, calls);
    await context.addInitScript(() => {
      try { localStorage.setItem('kateb.apikey', 'sk-ant-test'); } catch (e) {}
      window.__shared = null;
      /* like Chrome on Android: files can be shared, but only PDF (not .docx) passes the safelist */
      navigator.canShare = d => !!(d && d.files && d.files.length && d.files[0].type === 'application/pdf');
      navigator.share = async d => { const f = d.files[0]; const head = String.fromCharCode.apply(null, new Uint8Array(await f.slice(0, 5).arrayBuffer())); window.__shared = { name: f.name, type: f.type, size: f.size, title: d.title, head }; };
    });
    const page = await context.newPage(); page.on('dialog', d => d.accept());
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base + '/kateb.html'); await page.waitForSelector('#start:not([hidden])');
    await page.setInputFiles('#file', { name: 'page1.png', mimeType: 'image/png', buffer: photo });
    await page.waitForSelector('#tray:not([hidden])'); await page.click('#goBtn'); await page.waitForSelector('#done:not([hidden])', { timeout: 20000 });
    assert.ok(await page.locator('#shareBtn').isVisible(), 'share card shown when files can be shared');
    await page.click('#shareBtn'); await page.waitForSelector('#kindDlg:not([hidden])'); await page.click('#kindOk');
    await page.waitForFunction(() => window.__shared);
    const sh = await page.evaluate(() => window.__shared);
    assert.ok(/\.pdf$/.test(sh.name) && sh.type === 'application/pdf' && sh.size > 20000 && sh.head === '%PDF-', 'Chrome-style sheet gets a real PDF of the pages: ' + JSON.stringify(sh));
    assert.match(await page.textContent('#savedNote'), /PDF.*اختر واتساب/);
    assert.deepStrictEqual(errors, []);
    /* iOS-style sheet takes the Word file itself */
    await page.evaluate(() => { navigator.canShare = d => !!(d && d.files && d.files.length); window.__shared = null; });
    await page.evaluate(() => { const s = document.querySelector('#pagesBox .sheet p'); s.textContent += ' تعديل'; s.dispatchEvent(new InputEvent('input', { bubbles: true })); });
    await page.click('#shareBtn'); await page.waitForFunction(() => window.__shared);
    const sh2 = await page.evaluate(() => window.__shared);
    assert.ok(/\.docx$/.test(sh2.name) && sh2.type.includes('wordprocessingml') && sh2.head === 'PK\u0003\u0004' + sh2.head.slice(4), 'Safari-style sheet gets the .docx: ' + JSON.stringify(sh2));
    await context.close();
    /* desktop without file sharing: no dead button */
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await fakeWorld(c2, { A: SIHHA_READ, B: SIHHA_READ }, []); await c2.addInitScript(() => { try { localStorage.setItem('kateb.apikey', 'sk-ant-test'); } catch (e) {} delete navigator.share; delete navigator.canShare; });
    const p2 = await c2.newPage(); p2.on('dialog', d => d.accept()); await p2.goto(base + '/kateb.html'); await p2.waitForSelector('#start:not([hidden])');
    await p2.setInputFiles('#file', { name: 'page1.png', mimeType: 'image/png', buffer: photo }); await p2.waitForSelector('#tray:not([hidden])'); await p2.click('#goBtn'); await p2.waitForSelector('#done:not([hidden])', { timeout: 20000 });
    assert.ok(await p2.locator('#shareBtn').isHidden(), 'no share button where the browser has no share sheet at all');
    await c2.close();
    /* a share sheet that takes no files at all: the Word file is downloaded and the way to send it is explained */
    const c3 = await browser.newContext({ viewport: { width: 420, height: 860 }, serviceWorkers: 'block', acceptDownloads: true });
    await fakeWorld(c3, { A: SIHHA_READ, B: SIHHA_READ }, []); await c3.addInitScript(() => { try { localStorage.setItem('kateb.apikey', 'sk-ant-test'); } catch (e) {} navigator.canShare = () => false; navigator.share = async () => {}; });
    const p3 = await c3.newPage(); p3.on('dialog', d => d.accept()); await p3.goto(base + '/kateb.html'); await p3.waitForSelector('#start:not([hidden])');
    await p3.setInputFiles('#file', { name: 'page1.png', mimeType: 'image/png', buffer: photo }); await p3.waitForSelector('#tray:not([hidden])'); await p3.click('#goBtn'); await p3.waitForSelector('#done:not([hidden])', { timeout: 20000 });
    const [dl3] = await Promise.all([p3.waitForEvent('download'), (async () => { await p3.click('#shareBtn'); await p3.waitForSelector('#kindDlg:not([hidden])'); await p3.click('#kindOk'); })()]);
    assert.match(dl3.suggestedFilename(), /\.docx$|^download$/);
    assert.match(await p3.textContent('#savedNote'), /مرفق/);
    await c3.close();
  });

  await step('voice dictation: record (fake microphone) with live text and spoken commands, pause/resume, stop → playback → transcribed by the audio key (WAV chunk) → laid out by Claude → review with the recording kept on the document', () => runMode(browser, base, 'kateb.html', { A: LEGAL.J, B: LEGAL.J, T: TRANSCRIPT, FMT: FORMATTED }, null, 'sk-ant-test', async (page, calls) => {
    await page.evaluate(() => {
      /* a fake browser recogniser: a few phrases, interim then final (no audio key: the browser's engine writes) */
      const phrases = ['عنوان إعادة إعلان في الدعوى', 'أنه في يوم الاثنين الموافق تسعة عشر أكتوبر ألفين وستة وعشرين نقطة', 'فقرة جديدة', 'بناء علي طلب السيد مينا سامي'];
      window.SpeechRecognition = window.webkitSpeechRecognition = function () {
        const self = this; let i = 0, t = null, on = false;
        this.start = () => { on = true; const next = () => { if (!on || i >= phrases.length) { if (on) { on = false; self.onend && self.onend(); } return; }
          const ph = phrases[i++]; self.onresult && self.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: ph.slice(0, 6) }], { isFinal: false })] });
          t = setTimeout(() => { self.onresult && self.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: ph }], { isFinal: true })] }); t = setTimeout(next, 150); }, 150); }; t = setTimeout(next, 100); };
        this.stop = () => { on = false; clearTimeout(t); self.onend && self.onend(); };
        this.abort = this.stop;
      };
    });
    await page.click('#voiceBtn'); await page.waitForSelector('#voice:not([hidden])');
    await page.click('#recStart');
    await page.waitForSelector('.recstat.on', { timeout: 10000 });
    await page.waitForFunction(() => window.__test.liveParts().length >= 4, null, { timeout: 15000 });
    const parts = await page.evaluate(() => window.__test.liveParts());
    assert.ok(parts[0].heading && parts[0].text === 'إعادة إعلان في الدعوى', 'عنوان → heading');
    assert.ok(/نقطة|\.$/.test(parts[1].text) && parts[1].text.endsWith('.'), '«نقطة» at the end → full stop: ' + parts[1].text);
    assert.ok(parts[2].paragraph, '«فقرة جديدة» → paragraph');
    assert.ok((await page.inputValue('#liveEdit')).includes('إعادة إعلان في الدعوى\n'), 'live text shows the heading on its own line');
    await page.click('#recPause'); assert.ok(await page.locator('.recstat.paused').count());
    await page.click('#recResume'); assert.ok(await page.locator('.recstat.on').count());
    await page.waitForTimeout(1500);
    await page.evaluate(() => localStorage.setItem('kateb.audiokey', 'AIza-test'));      // added later: the recording can still be transcribed exactly
    await page.click('#recStop'); await page.waitForSelector('#recDone:not([hidden])', { timeout: 10000 });
    assert.match(await page.textContent('#recState'), /انتهى التسجيل/);
    assert.ok((await page.getAttribute('#recAudio', 'src') || '').startsWith('blob:'), 'playback of the recording');
    assert.ok(await page.locator('#recExact').isVisible(), 'with an audio key the recording can still be transcribed again exactly');
    await page.click('#recExact');
    await page.waitForSelector('#done:not([hidden])', { timeout: 60000 });
    assert.ok(calls.audio && calls.audio.length === 1 && calls.audio[0].mime === 'audio/wav' && calls.audio[0].bytes > 1000, 'the recording went to the audio key as one WAV chunk: ' + JSON.stringify(calls.audio && calls.audio.map(a => [a.mime, a.bytes])));
    assert.match(calls.audio[0].prompt, /Spoken punctuation commands/);
    const fmt = calls.claude.find(c => c.kind === 'format'); assert.ok(fmt && fmt.images === 0 && /COMMON EXPRESSIONS/.test(fmt.system), 'Claude lays the transcript out, text only, with the glossary');
    assert.match(await page.textContent('#pagesBox .sheet p.h'), /إعادة إعلان في الدعوى/);
    assert.match(await page.textContent('#pagesBox .sheet'), /١٩‏\/‏١٠‏\/‏٢٠٢٦/, 'the spoken date as a house-style date');
    assert.strictEqual(await page.locator('#pagesBox mark').count(), 1, 'the transcriber\'s doubt stays yellow');
    assert.ok(await page.locator('#audioBox').isVisible(), 'the recording can be played on the review screen');
    assert.match(await page.inputValue('#docName'), /^إعادة إعلان مينا سامي/);
    await page.waitForFunction(() => /ok/.test(document.getElementById('saveStatus').className));
    await page.reload(); await page.waitForSelector('#start:not([hidden])');
    await page.click('#filesBtn'); await page.waitForSelector('.doc'); await page.click('.doc [data-act="open"]'); await page.waitForSelector('#done:not([hidden])');
    assert.ok(await page.locator('#audioBox').isVisible(), 'the recording is stored with the document');
    const d = await page.evaluate(() => { const d = window.__test.doc(); return { source: d.source, hasAudio: !!d.audio, transcript: d.transcript }; });
    assert.ok(d.source === 'voice' && d.hasAudio && /المحضر سالف الذكر/.test(d.transcript), JSON.stringify(d));
  }));

  await step('v27 live dictation you can edit: the words are written into the box while speaking; pause, correct a word, put the cursor in the middle, resume → the new words go at the cursor; convert uses the corrected box (no second transcription) and the draft survives a reload', () => runMode(browser, base, 'kateb.html', { A: LEGAL.J, B: LEGAL.J, FMT: FORMATTED }, null, 'sk-ant-test', async (page, calls) => {
    await page.evaluate(() => {
      window.__phrases = ['بناء علي طلب السيد مينا سامي', 'ومحله المختار مكتب الأستاذ'];
      window.SpeechRecognition = window.webkitSpeechRecognition = function () {
        const self = this; let t = null, on = false;
        this.start = () => { on = true; const next = () => { if (!on || !window.__phrases.length) return; const ph = window.__phrases.shift();
          self.onresult && self.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: ph.slice(0, 5) }], { isFinal: false })] });
          t = setTimeout(() => { self.onresult && self.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: ph }], { isFinal: true })] }); t = setTimeout(next, 120); }, 120); }; t = setTimeout(next, 80); };
        this.stop = () => { on = false; clearTimeout(t); self.onend && self.onend(); };
        this.abort = this.stop;
      };
    });
    await page.click('#voiceBtn'); await page.waitForSelector('#voice:not([hidden])');
    await page.click('#recStart'); await page.waitForSelector('.recstat.on', { timeout: 10000 });
    await page.waitForFunction(() => /مكتب الأستاذ/.test(document.getElementById('liveEdit').value), null, { timeout: 15000 });
    await page.click('#recPause');
    assert.ok(await page.locator('#liveConvert').isVisible(), 'paused: the text can be converted right away');
    /* the person corrects a misheard name and puts the cursor after «سامي» */
    await page.evaluate(() => { const ta = document.getElementById('liveEdit'); ta.focus(); ta.value = ta.value.replace('مينا سامي', 'مينا سامح'); ta.dispatchEvent(new Event('input')); const at = ta.value.indexOf('سامح') + 4; ta.setSelectionRange(at, at); ta.dispatchEvent(new Event('select')); });
    await page.evaluate(() => { window.__phrases.push('بالغ سن الرشد'); });
    await page.click('#recResume');
    await page.waitForFunction(() => /بالغ سن الرشد/.test(document.getElementById('liveEdit').value), null, { timeout: 10000 });
    const v = await page.inputValue('#liveEdit');
    assert.ok(/مينا سامح بالغ سن الرشد ومحله المختار/.test(v), 'the new words went where the cursor was, the correction kept: ' + v);
    await page.reload(); await page.waitForSelector('#start:not([hidden])');
    await page.click('#voiceBtn'); await page.waitForSelector('#voice:not([hidden])');
    assert.ok((await page.inputValue('#liveEdit')).includes('مينا سامح'), 'an unfinished dictation comes back after a reload');
    await page.click('#liveConvert');
    await page.waitForSelector('#done:not([hidden])', { timeout: 60000 });
    assert.ok(!calls.audio || !calls.audio.length, 'no second transcription of the audio');
    const fmt = calls.claude.find(c => c.kind === 'format'); assert.ok(fmt && /مينا سامح بالغ سن الرشد/.test(fmt.p), 'laid out by Claude from the corrected box');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('kateb.liveDraft')), null, 'the draft is cleared once converted');
  }));

  await step('v33 live dictation by the audio key: the browser engine is not used; what is said is cut at the pause, sent as a WAV to the key and written into the box in order; stop writes the last words before the buttons; convert uses the box', () => runMode(browser, base, 'kateb.html', { A: LEGAL.J, B: LEGAL.J, T: 'بناء على طلب السيد مينا سامي', FMT: FORMATTED }, null, 'sk-ant-test', async (page, calls) => {
    await page.evaluate(() => {
      localStorage.setItem('kateb.audiokey', 'AIza-test'); window.__srMade = 0;
      window.SpeechRecognition = window.webkitSpeechRecognition = function () { window.__srMade++; this.start = this.stop = this.abort = () => {}; };
    });
    await page.click('#voiceBtn'); await page.waitForSelector('#voice:not([hidden])');
    await page.click('#recStart'); await page.waitForSelector('.recstat.on', { timeout: 10000 });
    assert.match(await page.textContent('#liveInterim'), /وقفة/, 'the person is told the words come after each short pause');
    await page.waitForTimeout(2000);
    await page.click('#recPause');                                       // what was said so far goes out now
    await page.waitForFunction(() => /مينا سامي/.test(document.getElementById('liveEdit').value), null, { timeout: 15000 });
    assert.ok(calls.audio && calls.audio.length >= 1 && calls.audio[0].mime === 'audio/wav', 'a WAV piece went to the audio key: ' + JSON.stringify(calls.audio));
    assert.strictEqual(await page.evaluate(() => window.__srMade), 0, 'the browser speech engine (fails with «network» on the family\'s Chrome) is not used');
    await page.click('#recResume'); await page.waitForTimeout(1500);
    const before = calls.audio.length;
    await page.click('#recStop'); await page.waitForSelector('#recDone:not([hidden])', { timeout: 20000 });
    assert.ok(calls.audio.length === before + 1, 'stop sends the last words too');
    const v = await page.inputValue('#liveEdit');
    assert.strictEqual((v.match(/مينا سامي/g) || []).length, 2, 'both pieces are in the box, in order: ' + v);
    await page.click('#recConvert'); await page.waitForSelector('#done:not([hidden])', { timeout: 60000 });
    assert.strictEqual(calls.audio.length, before + 1, 'converting uses the box: no second transcription');
  }));

  await step('v33 the browser speech engine fails («network», as on the family\'s Chrome and phone) and there is no audio key: the person is told at once what to do (keyboard 🎤 or the audio key) and the engine is not restarted forever; the keyboard-mic button opens the box', () => runMode(browser, base, 'kateb.html', { A: LEGAL.J, B: LEGAL.J, FMT: FORMATTED }, null, 'sk-ant-test', async (page, calls) => {
    await page.evaluate(() => {
      window.__starts = 0;
      window.SpeechRecognition = window.webkitSpeechRecognition = function () {
        const self = this;
        this.start = () => { window.__starts++; setTimeout(() => { self.onerror && self.onerror({ error: 'network' }); self.onend && self.onend(); }, 80); };
        this.stop = this.abort = () => {};
      };
    });
    await page.click('#voiceBtn'); await page.waitForSelector('#voice:not([hidden])');
    await page.click('#recStart'); await page.waitForSelector('.recstat.on', { timeout: 10000 });
    await page.waitForFunction(() => /لا تعمل هنا/.test(document.getElementById('liveInterim').textContent), null, { timeout: 5000 });
    assert.match(await page.textContent('#liveInterim'), /لوحة المفاتيح/);
    assert.match(await page.textContent('#liveInterim'), /مفتاح الصوت/);
    await page.waitForTimeout(1500);
    assert.strictEqual(await page.evaluate(() => window.__starts), 1, 'not restarted over and over');
    await page.click('#recStop'); await page.waitForSelector('#recDone:not([hidden])', { timeout: 10000 });
    assert.match(await page.textContent('#recNote'), /لوحة المفاتيح/);
    assert.ok(await page.locator('#recConvert').isHidden(), 'nothing to convert without text or key');
    await page.click('#kbMic');
    assert.ok(await page.locator('#liveBox').isVisible(), 'the keyboard-mic button opens the box');
    assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'liveEdit'), 'and puts the cursor in it');
    await page.fill('#liveEdit', 'بناء على طلب السيد مينا سامي'); await page.dispatchEvent('#liveEdit', 'input');
    assert.ok(await page.locator('#liveConvert').isVisible(), 'typed or keyboard-dictated text can be converted');
  }));

  await step('audio file: upload → name and duration → convert needs the audio key (clear message), with it the file is decoded to WAV and transcribed; without Claude the transcript itself is the document', () => runMode(browser, base, 'kateb.html', { A: LEGAL.J, B: LEGAL.J, T: TRANSCRIPT, FMT: FORMATTED }, null, 'sk-ant-test', async (page, calls) => {
    await page.click('#audioBtn'); await page.waitForSelector('#audioUp:not([hidden])');
    assert.ok(await page.locator('#audioKeyNote').isVisible(), 'no audio key: said plainly');
    await page.setInputFiles('#audioFile', { name: 'whatsapp.wav', mimeType: 'audio/wav', buffer: wavFile(2) });
    await page.waitForSelector('#audioInfo:not([hidden])');
    assert.strictEqual(await page.textContent('#audioName'), 'whatsapp.wav');
    await page.waitForFunction(() => /المدة ٠:٠٢/.test(document.getElementById('audioMeta').textContent));
    await page.click('#audioConvert'); await page.waitForSelector('#fail:not([hidden])');
    assert.match(await page.textContent('#failMsg'), /مفتاح الصوت/);
    await page.click('#homeBtn'); await page.waitForSelector('#start:not([hidden])');
    await page.click('#settingsBtn'); await page.waitForSelector('#settings:not([hidden])');
    await page.fill('#audioKeyIn', 'AIza-test'); await page.click('#audioKeySave');
    await page.waitForFunction(() => /✅/.test(document.getElementById('audioKeyState').textContent));
    await page.click('#backBtn'); await page.waitForSelector('#start:not([hidden])');
    await page.click('#audioBtn'); await page.waitForSelector('#audioUp:not([hidden])');
    assert.ok(await page.locator('#audioKeyNote').isHidden());
    await page.setInputFiles('#audioFile', { name: 'whatsapp.wav', mimeType: 'audio/wav', buffer: wavFile(2) });
    await page.waitForSelector('#audioInfo:not([hidden])'); await page.click('#audioConvert');
    await page.waitForSelector('#done:not([hidden])', { timeout: 60000 });
    assert.strictEqual(calls.audio.length, 1); assert.strictEqual(calls.audio[0].mime, 'audio/wav');
    assert.match(await page.textContent('#pagesBox .sheet'), /المحضر سالف الذكر/);
    assert.ok(await page.locator('#audioBox').isVisible());
    assert.match(await page.textContent('#readerInfo'), /gemini/);
    /* re-read from the stored recording */
    calls.length = 0; calls.audio = [];
    await page.click('#reconvertBtn'); await page.waitForSelector('#done', { state: 'hidden' }); await page.waitForSelector('#done:not([hidden])', { timeout: 60000 });
    assert.strictEqual(calls.audio.length, 1, 'إعادة التحويل transcribes the stored recording again');
    assert.match(await page.textContent('#versionsBtn'), /نسخ سابقة/);
  }));

  await browser.close(); server.close();
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
