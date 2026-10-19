/* Accuracy harness: runs the REAL app on sample pages with a real Gemini key and scores the result.
   Usage (on the PC, internet needed):
     cd tests && npm install
     set CLAUDE_KEY=sk-ant-...     (or GEMINI_KEY=...; PowerShell: $env:CLAUDE_KEY="...")
     npm run eval                  (or: node eval/run_eval.cjs legal/contract1)
     LEARN=0 node eval/run_eval.cjs   to measure with handwriting learning off (default: as saved on the device = off)
   Scores per page:
     WER / CER   word / character error rate against the .txt (0 = perfect)
     marked      words the app highlighted yellow for review
     missed      wrong words NOT highlighted — the dangerous number; the goal is 0
     halluc      words in the output that are nowhere in the truth (invented words)
     fields      critical facts (case numbers, dates, amounts, names) found in the truth and read correctly / total
   Each page costs about 4-6 Claude calls (≈ $0.3-0.7 with fast mode). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const Verify = require('../../kateb/verify.js');
const Fields = require('../../kateb/fields.js');

const ROOT = path.resolve(__dirname, '../..');
const SAMPLES = path.join(__dirname, 'samples');
const KEY = process.env.CLAUDE_KEY || process.env.GEMINI_KEY;
if (!KEY) { console.error('Set CLAUDE_KEY (or GEMINI_KEY) first.'); process.exit(2); }
/* the critical facts of a page: how many of the truth's facts the output has (exact digits / name) */
function fieldScore(truth, out) {
  const a = Fields.extract(truth), b = Fields.extract(out), keys = f => [].concat(f.cases.map(c => 'q' + c.num + '/' + c.year), f.dates.map(d => 'd' + d.d + '/' + d.m + '/' + d.y), f.amounts.map(x => 'a' + x.value), f.names.map(n => 'n' + n.replace(/\s+/g, ' ')));
  const want = keys(a), have = new Set(keys(b));
  return { total: want.length, ok: want.filter(k => have.has(k)).length, missing: want.filter(k => !have.has(k)) };
}
function hallucinated(truth, out) {
  const t = new Set(Verify.tokens(truth)), extra = Verify.tokens(out).filter(w => !t.has(w) && !/^[0-9]+$/.test(w));
  return extra.filter((w, i, arr) => arr.indexOf(w) === i);
}

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
    await context.addInitScript(k => { try { localStorage.setItem('kateb.apikey', k); if (k.learn !== undefined) localStorage.setItem('kateb.learn', k.learn); } catch (e) {} }, Object.assign(String(KEY), { learn: process.env.LEARN }));
    const page = await context.newPage();
    const t0 = Date.now();
    try {
      await page.goto(base + '/' + (s.mode === 'exam' ? 'hanan.html' : 'kateb.html'));
      await page.waitForSelector('#start:not([hidden])');
      await page.setInputFiles('#file', s.file); await page.waitForSelector('#tray:not([hidden])'); await page.click('#goBtn');
      await page.waitForSelector('#done:not([hidden]), #fail:not([hidden])', { timeout: 15 * 60 * 1000 });
      if (await page.isVisible('#fail')) throw new Error(await page.textContent('#failMsg'));
      const out = (await page.evaluate(() => window.__test.results().map(r => r.text))).join('\n');
      const a = Verify.audit(s.truth, out), fs_ = fieldScore(s.truth, out), hal = hallucinated(s.truth, out);
      rows.push({ id: s.id, wer: Verify.wer(s.truth, out), cer: Verify.cer(s.truth, out), marked: a.marked, wrong: a.wrong, missed: a.missed.length, missedWords: a.missed, fieldsOk: fs_.ok, fieldsTotal: fs_.total, fieldsMissing: fs_.missing, halluc: hal.length, hallucWords: hal, sec: Math.round((Date.now() - t0) / 1000), output: out });
    } catch (e) { rows.push({ id: s.id, error: String(e.message || e) }); }
    const r = rows[rows.length - 1];
    console.log(r.error ? `${r.id}: ERROR ${r.error}` : `${r.id}: WER ${(r.wer * 100).toFixed(1)}%  CER ${(r.cer * 100).toFixed(1)}%  marked ${r.marked}  wrong ${r.wrong}  missed ${r.missed}${r.missed ? '  → ' + r.missedWords.slice(0, 8).join(' · ') : ''}  fields ${r.fieldsOk}/${r.fieldsTotal}${r.fieldsMissing.length ? ' (missing ' + r.fieldsMissing.slice(0, 5).join(' · ') + ')' : ''}  halluc ${r.halluc}  (${r.sec}s)`);
    await context.close();
  }
  const ok = rows.filter(r => !r.error), avg = k => ok.reduce((t, r) => t + r[k], 0) / Math.max(1, ok.length);
  const sum = k => ok.reduce((t, r) => t + r[k], 0);
  console.log(`\n${ok.length}/${rows.length} pages  ·  avg WER ${(avg('wer') * 100).toFixed(1)}%  ·  avg CER ${(avg('cer') * 100).toFixed(1)}%  ·  missed (wrong & not yellow) ${sum('missed')}  ·  fields ${sum('fieldsOk')}/${sum('fieldsTotal')}  ·  hallucinated words ${sum('halluc')}`);
  const file = path.join(__dirname, 'report-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify(rows, null, 2)); console.log('report: ' + file);
  await browser.close(); server.close();
})();
