/* Accuracy harness: runs the REAL app on sample pages with a real Gemini key and scores the result.
   Usage (on the PC, internet needed):
     cd tests && npm install
     set GEMINI_KEY=...            (PowerShell: $env:GEMINI_KEY="...")
     npm run eval                  (or: node eval/run_eval.cjs legal/contract1)
   Scores per page:
     WER / CER   word / character error rate against the .txt (0 = perfect)
     marked      words the app highlighted yellow for review
     missed      wrong words NOT highlighted — the dangerous number; the goal is 0
   Free-tier note: each page costs 3–4 Gemini calls. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const Verify = require('../../kateb/verify.js');

const ROOT = path.resolve(__dirname, '../..');
const SAMPLES = path.join(__dirname, 'samples');
const KEY = process.env.GEMINI_KEY;
if (!KEY) { console.error('Set GEMINI_KEY first.'); process.exit(2); }

function list() {
  const only = process.argv[2];
  const out = [];
  for (const mode of ['legal', 'exam']) {
    const dir = path.join(SAMPLES, mode); if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^(.*)\.(jpe?g|png|pdf)$/i); if (!m) continue;
      const truth = path.join(dir, m[1] + '.txt'); if (!fs.existsSync(truth)) { console.warn('no .txt for ' + f); continue; }
      const id = mode + '/' + m[1]; if (only && id !== only) continue;
      out.push({ id, mode, file: path.join(dir, f), truth: fs.readFileSync(truth, 'utf8') });
    }
  }
  return out;
}
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

(async () => {
  const samples = list();
  if (!samples.length) { console.error('No samples. See eval/samples/README.md'); process.exit(2); }
  const server = await serve(), base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const rows = [];
  for (const s of samples) {
    const context = await browser.newContext();
    await context.addInitScript(k => { try { localStorage.setItem('kateb.apikey', k); } catch (e) {} }, KEY);
    const page = await context.newPage();
    const t0 = Date.now();
    try {
      await page.goto(base + '/' + (s.mode === 'exam' ? 'hanan.html' : 'kateb.html'));
      await page.waitForSelector('#start:not([hidden])');
      await page.setInputFiles('#file', s.file); await page.waitForSelector('#tray:not([hidden])'); await page.click('#goBtn');
      await page.waitForSelector('#done:not([hidden]), #fail:not([hidden])', { timeout: 15 * 60 * 1000 });
      if (await page.isVisible('#fail')) throw new Error(await page.textContent('#failMsg'));
      const out = (await page.evaluate(() => window.__test.results().map(r => r.text))).join('\n');
      const a = Verify.audit(s.truth, out);
      rows.push({ id: s.id, wer: Verify.wer(s.truth, out), cer: Verify.cer(s.truth, out), marked: a.marked, wrong: a.wrong, missed: a.missed.length, missedWords: a.missed, sec: Math.round((Date.now() - t0) / 1000), output: out });
    } catch (e) { rows.push({ id: s.id, error: String(e.message || e) }); }
    const r = rows[rows.length - 1];
    console.log(r.error ? `${r.id}: ERROR ${r.error}` : `${r.id}: WER ${(r.wer * 100).toFixed(1)}%  CER ${(r.cer * 100).toFixed(1)}%  marked ${r.marked}  wrong ${r.wrong}  missed ${r.missed}${r.missed ? '  → ' + r.missedWords.slice(0, 8).join(' · ') : ''}  (${r.sec}s)`);
    await context.close();
  }
  const ok = rows.filter(r => !r.error), avg = k => ok.reduce((t, r) => t + r[k], 0) / Math.max(1, ok.length);
  console.log(`\n${ok.length}/${rows.length} pages  ·  avg WER ${(avg('wer') * 100).toFixed(1)}%  ·  avg CER ${(avg('cer') * 100).toFixed(1)}%  ·  missed (wrong & not yellow) ${ok.reduce((t, r) => t + r.missed, 0)}`);
  const file = path.join(__dirname, 'report-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify(rows, null, 2)); console.log('report: ' + file);
  await browser.close(); server.close();
})();
