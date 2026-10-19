/* Unit tests for the pure parts of the app: reading cross-check, markup parsers, Word builders.
   Run: cd tests && npm install && npm run unit */
const test = require('node:test');
const assert = require('node:assert');
const JSZip = require('jszip');
const { xml2js } = require('xml-js');
const Verify = require('../kateb/verify.js');
const DocxBuilder = require('../kateb/docx.js');
const ExamBuilder = require('../kateb/exam.js');

const A = '[H] **مذكرة بدفاع**\nالسيد / أحمد محمد علي\tبصفته\nفي القضية رقم 1234 لسنة ٢٠٢٤';
const B = '[H] **مذكرة بدفاع**\nالسيد / أحمد محمود علي\tبصفته\nفي القضية رقم 1284 لسنة ٢٠٢٤';

test('tokens ignore markup, tashkeel and punctuation', () => {
  assert.deepStrictEqual(Verify.tokens('[H] **مُذَكِّرة** ⟦بدفاع⟧، __نعم__'), ['مذكره', 'بدفاع', 'نعم']);   // ة→ه, hamza and ى folded
  assert.deepStrictEqual(Verify.tokens('[TABLE] الاسم | العدد || أحمد | {3/4}'), ['الاسم', 'العدد', 'احمد', '3/4']);
  assert.deepStrictEqual(Verify.tokens('[FIG] <svg><text>9</text></svg>\nok'), ['ok']);
});

test('compare finds the words two readings disagree on', () => {
  const c = Verify.compare(A, B);
  assert.strictEqual(c.same, false);
  assert.deepStrictEqual(c.onlyA, ['محمد', '1234']);
  assert.deepStrictEqual(c.onlyB, ['محمود', '1284']);
  assert.ok(Verify.compare(A, A.replace('مذكرة', 'مُذكرة')).same, 'tashkeel is not a disagreement');
});

test('guard marks invented words, disputed numbers and (strict) disputed names', () => {
  const loose = Verify.guard(A.replace('القضية', 'المحكمة'), A, B, false).text;
  assert.match(loose, /⟦المحكمة⟧/);          // in neither reading and unlike anything they saw
  assert.match(loose, /⟦1234⟧/);             // number the readings disagreed on
  assert.doesNotMatch(loose, /⟦محمد⟧/);      // name: only in strict mode
  const strict = Verify.guard(A, A, B, true).text;
  assert.match(strict, /⟦محمد⟧/);
  assert.match(strict, /^\[H\] \*\*مذكرة بدفاع\*\*/, 'markup kept intact');
  assert.strictEqual(Verify.guard(A, A, A, true).added, 0, 'agreeing readings add nothing');
});

test('guard keeps a number marked when either reader doubted it; a confirmed word is not re-marked', () => {
  const g = Verify.guard('رقم 55 لسنة', 'رقم ⟦55⟧ لسنة', 'رقم 55 لسنة', false);
  assert.strictEqual(g.text, 'رقم ⟦55⟧ لسنة');
  assert.strictEqual(Verify.guard('وأعلنته بالآتي', 'وأعلنته ⟦بالآتي⟧', 'واعلنته بالاتي', true).text, 'وأعلنته بالآتي', 'spelling variants + reader doubt on a plain word: the judge confirmed it');
  assert.strictEqual(Verify.guard('رقم ⟦55⟧ لسنة', 'رقم 55 لسنة', 'رقم 55 لسنة').text, 'رقم ⟦55⟧ لسنة', 'no double brackets');
});

test('house digits: Western digits and day/month/year, as the office types them', () => {
  assert.strictEqual(Verify.houseDigits('المؤرخ ١٠/١/٢٠٢٠ م ومبلغ ٢٥٠٠٠٠ ج'), 'المؤرخ 10/1/2020 م ومبلغ 250000 ج');
  assert.strictEqual(Verify.houseDigits('بتاريخ 2020/1/10'), 'بتاريخ 10/1/2020');
  assert.strictEqual(Verify.houseDigits('[FIG] <svg>٣</svg>'), '[FIG] <svg>٣</svg>');
});

test('error rates', () => {
  assert.strictEqual(Verify.wer(A, A), 0);
  assert.ok(Math.abs(Verify.wer(A, B) - 2 / 13) < 1e-9);
  assert.ok(Verify.cer(A, B) > 0 && Verify.cer(A, B) < 0.05);
  assert.strictEqual(Verify.doubtRecall('رقم 55', 'رقم ⟦56⟧'), 1);
  assert.strictEqual(Verify.doubtRecall('رقم 55', 'رقم 56'), 0);
});

test('legal markup → blocks', () => {
  const p = DocxBuilder.parseMarkup('[H] عنوان\n[S] الوقائع\n[N] ١- أولاً **مهم**\n[TABLE] أ | ب || ج\n[L] التوقيع\nنص ⟦غير⟧ واضح');
  assert.strictEqual(p.length, 6);
  assert.ok(p[0].heading && p[1].sub && p[2].list);
  assert.deepStrictEqual(p[2].runs.map(r => [r.text, !!r.b]), [['١- أولاً ', false], ['مهم', true]]);
  assert.strictEqual(p[3].table.length, 2);
  assert.strictEqual(p[3].table[1][0][0].text, 'ج');
  assert.strictEqual(p[4].align, 'L');
  assert.ok(p[5].runs[1].hl);
});

async function xmlParts(zip) {
  const z = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
  const out = {};
  for (const name of Object.keys(z.files)) if (/\.(xml|rels)$/.test(name)) out[name] = await z.file(name).async('string');
  for (const [name, x] of Object.entries(out)) assert.doesNotThrow(() => xml2js(x), name + ' is well-formed XML');
  return out;
}

test('legal Word file is well-formed and keeps tables, lists, highlights', async () => {
  const paras = DocxBuilder.parseMarkup('[H] مذكرة\n[S] الطلبات\n[N] ١- رفض <الدعوى> & إلزام\n[TABLE] الاسم | الصفة || أحمد | ⟦مدعي⟧\nEnglish line');
  const parts = await xmlParts(DocxBuilder.build(JSZip, paras, { title: 'مستند' }));
  const doc = parts['word/document.xml'];
  assert.match(doc, /<w:tbl><w:tblPr><w:bidiVisual\/>/);
  assert.match(doc, /<w:ind w:left="567" w:hanging="425"\/>/);
  assert.match(doc, /&lt;الدعوى&gt; &amp; إلزام/);
  assert.match(doc, /<w:highlight w:val="yellow"\/>/);
  assert.match(parts['word/_rels/document.xml.rels'], /footer1\.xml/);
});

test('exam parse + Word file', async () => {
  const ex = ExamBuilder.parseExam('GRADE: Primary 4\n[Q] Question (1) Choose\n[I] **1)** 3 + {1/2} = __________\n[OPT] a) 1 | b) 2 | c) ⟦3⟧ | d) 4\n[TABLE] 1 | 2 || 3\n[GAP]');
  assert.strictEqual(ex.meta.grade, 'Primary 4');
  assert.deepStrictEqual(ex.blocks.map(b => b.k), ['q', 'item', 'opt', 'table', 'gap']);
  assert.deepStrictEqual(ex.blocks[1].runs.find(r => r.frac).frac, ['1', '2']);
  const parts = await xmlParts(ExamBuilder.build(JSZip, ex.blocks, { line1: 'A', line2: 'B', line3: 'C', subject: 'Math', grade: '4', time: '1h', title: 'Exam' }, {}));
  assert.match(parts['word/document.xml'], /<m:f><m:num>/);
});

/* ---------- office templates (kateb/office.js + kateb/templates) ---------- */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
global.fetch = async (u) => { const f = path.join(REPO, String(u).split('?')[0]); return { ok: fs.existsSync(f), json: async () => JSON.parse(fs.readFileSync(f, 'utf8')), arrayBuffer: async () => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } }; };
global.DocxBuilder = DocxBuilder;
const Office = require('../kateb/office.js');

const SIHHA = '[H] دعوى صحة توقيع\nأنه في يوم       الموافق     /    /2026\nبناء علي طلب السيدة / **مريم سامي** - بالغة سن الرشد\nومحلها المختار مكتب الأستاذ / ألون إبراهيم باشا المحامي .\nأنا معاون تنفيذ محكمة أول أسيوط قد انتقلت وأعلنت :-\n1. السيد / **كريم عادل**\tمخاطبا مع\n[C] وأعلنته بالأتي\nبموجب عقد بيع مؤرخ في ⟦7/1/2026⟧ باع المعلن إليه .\n[C] بناء عليه\n**ولأجل العلم ،،،**';

test('detects the document type from its title and the lawyer from «مكتب الأستاذ»', () => {
  assert.strictEqual(Office.detect(SIHHA), 'sihha');
  assert.strictEqual(Office.detect('[H] إعادة إعلان في الدعوى\n[H] رقم 5'), 'reannounce');
  assert.strictEqual(Office.detect('بسم الله الرحمن الرحيم\n[H] عقد بيع ابتدائي'), 'sale');
  assert.strictEqual(Office.detect('[H] عقـــد هبـــه'), 'gift');
  assert.strictEqual(Office.detect('[H] إنـــذار بالطاعة'), 'warning');
  assert.strictEqual(Office.detect('[H] مذكـــرة'), 'memo');
  assert.strictEqual(Office.detect('نص عادي بلا عنوان'), null);
  assert.deepStrictEqual(Office.lawyerFrom(SIHHA), { name: 'ألون إبراهيم باشا', title: 'المحامي', nakd: false });
  assert.deepStrictEqual(Office.lawyerFrom('ومحله المختار مكتب الأستاذة / كاترين أسعد قديس المحامية .'), { name: 'كاترين أسعد قديس', title: 'المحامية', nakd: false });
});

test('templates hold formats and shapes, never client text', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(REPO, 'kateb/templates/templates.json'), 'utf8'));
  assert.ok(Object.keys(spec).length >= 12);
  for (const [k, t] of Object.entries(spec)) {
    assert.ok(t.roles.body || t.roles.party, k + ' has a body format');
    for (const a of t.anchors) for (const w of (a.xml.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || []).map(x => x.replace(/<[^>]+>/g, '').trim()).filter(Boolean))
      assert.match(w, /^(\{\{[A-Z_]+\}\}|مكتب|الموض|وع|الموضوع|ــــ)$/, k + ': unexpected text in a shape: ' + w);
  }
  const doc = JSON.stringify(spec);
  for (const name of ['سميح', 'روماني', 'ممدوح', 'عفاف', 'صباح', 'ميرنا', 'يسى', 'منير']) assert.ok(!doc.includes(name), 'no client name ' + name);
});

test('fills the صحة توقيع template: ornament, stamp, side box, original fonts', async () => {
  const blocks = DocxBuilder.parseMarkup(SIHHA);
  const zip = await Office.build(JSZip, blocks, 'sihha', { lawyer: Office.lawyerFrom(SIHHA) });
  const parts = await xmlParts(zip);
  const doc = parts['word/document.xml'];
  assert.ok(!doc.includes('{{') && !doc.includes('KATEB-BODY'), 'all placeholders filled');
  assert.match(doc, /Zokrofi/, 'ornament font kept');
  assert.match(doc, /ألون إبراهيم باشا/);                        // stamp + office line
  assert.match(doc, />دعوى صحة توقيع</);                          // side-box subject
  assert.match(doc, /كطلب الطالبة وتحت مسئوليتها/, 'client is female (ومحلها)');
  assert.match(doc, /Simplified Arabic/);
  assert.match(doc, /<w:highlight w:val="yellow"\/>/, 'unsure words stay yellow');
  assert.ok(+/<w:pgMar [^>]*w:left="(\d+)"/.exec(doc)[1] > 2000, 'wide court margin kept');
});

test('fills a contract: property table in the original table format, clause prefixes', async () => {
  const text = '[H] عقد بيع ابتدائي\n[C] موقع العقار جدول حرف ( أ )\n[TABLE] المسطح | اسم الحوض | رقم القطعة | الحدود || 120 م2 | حوض 1 | 15 | البحري: شارع\nانه في يوم الأحد الموافق 7/1/2026 م بين كل من :-\nأولاً : باع الطرف الأول للطرف الثاني .\n[C] الطرف الأول البائع\tالطرف الثاني المشتري\n[C] الشهـــود';
  const zip = await Office.build(JSZip, DocxBuilder.parseMarkup(text), 'sale', {});
  const doc = (await xmlParts(zip))['word/document.xml'];
  assert.match(doc, /<w:tbl><w:tblPr>/);
  assert.match(doc, /AF_Jeddah/, 'title font of the original');
  assert.match(doc, /AGA Battouta Regular[\s\S]*أولاً :/, 'clause prefix in the original prefix font');
  assert.strictEqual((doc.match(/<w:p><w:pPr>[^]*?<\/w:pPr><\/w:p>/g) || []).length >= 6, true, 'blank lines before the witnesses');
});

test('every template builds a well-formed file', async () => {
  const spec = await Office.spec();
  for (const k of Object.keys(spec)) {
    const zip = await Office.build(JSZip, DocxBuilder.parseMarkup('[H] عنوان\nانه في يوم السبت\nنص **عريض** عادي.\n[C] بناء عليه\nولأجل العلم ،،'), k, { lawyer: { name: 'س', title: 'المحامي' } });
    const doc = (await xmlParts(zip))['word/document.xml'];
    assert.ok(!doc.includes('{{'), k);
  }
});

/* ---------- formula bank (kateb/bank.js + kateb/bank/*.json) ---------- */
const Bank = require('../kateb/bank.js');
test('bank files hold formulas with placeholders, never a client name or number', () => {
  const files = fs.readdirSync(path.join(REPO, 'kateb/bank')).filter(f => f.endsWith('.json') && f !== 'spelling.json');
  assert.ok(files.length >= 10);
  for (const f of files) {
    const b = JSON.parse(fs.readFileSync(path.join(REPO, 'kateb/bank', f), 'utf8'));
    assert.ok(b.lines.length > 5, f);
    for (const l of b.lines) {
      assert.ok(!/[0-9٠-٩]/.test(l.t), f + ': digits must be # → ' + l.t);
      assert.ok(!/(السيد|السيدة|الأستاذ|الاستاذ|الدكتور)\s*\/\s*(?!\{\{NAME\}\})\S/.test(l.t), f + ': unmasked name → ' + l.t);
      assert.strictEqual(l.o.length, Bank.words(l.t).length, f + ': original tokens align with normalised words → ' + l.t);
    }
  }
});

test('snap fixes a doubtful word inside a known formula, leaves names and numbers alone', () => {
  const bank = { lines: [
    { t: 'أنا معاون تنفيذ محكمة أول أسيوط قد انتقلت إلي {{PLACE}} وأعلنت :-', n: 50, o: 'أنا معاون تنفيذ محكمة أول أسيوط قد انتقلت إلي {{PLACE}} وأعلنت :-'.split(/\s+/) },
    { t: 'بموجب عقد بيع مؤرخ في # باع المعلن إليه إلي الطالب ما هو عبارة عن', n: 40, o: 'بموجب عقد بيع مؤرخ في # باع المعلن إليه إلي الطالب ما هو عبارة عن'.split(/\s+/) },
    { t: 'السيد / {{NAME}} مخاطبا مع', n: 60, o: 'السيد / {{NAME}} مخاطبا مع'.split(/\s+/) },
  ] };
  let r = Bank.snap('أنا ⟦معاوز⟧ تنفيذ محكمة أول أسيوط قد ⟦انتقلـت⟧ إلي شارع النميس وأعلنت :-', bank);
  assert.strictEqual(r.text, 'أنا معاون تنفيذ محكمة أول أسيوط قد انتقلت إلي شارع النميس وأعلنت :-');
  assert.strictEqual(r.fixed, 2);
  r = Bank.snap('بموجب عقد بيع مؤرخ في ⟦7/1/2026⟧ باع ⟦المعلن⟧ إليه إلي الطالب ما هو عبارة عن', bank);
  assert.match(r.text, /⟦7\/1\/2026⟧/, 'a number stays doubtful');
  assert.doesNotMatch(r.text, /⟦المعلن⟧/);
  r = Bank.snap('[N] 1. السيد / ⟦كريم عادل⟧ مخاطبا مع', bank);
  assert.match(r.text, /⟦كريم عادل⟧/, 'a name stays doubtful');
  r = Bank.snap('كلام حر لا يشبه أي صيغة ⟦غامض⟧ هنا أبداً', bank);
  assert.match(r.text, /⟦غامض⟧/, 'no formula → untouched');
  assert.strictEqual(Bank.snap('نص بلا شك', bank).text, 'نص بلا شك');
});

test('the real sihha bank recognises its own formulas', async () => {
  const b = JSON.parse(fs.readFileSync(path.join(REPO, 'kateb/bank/sihha.json'), 'utf8'));
  const m = Bank.match(b, 'ولما كان المادة 45 اثبات تنص علي :');
  assert.ok(m && m.score >= 0.75, 'match ' + (m && m.score));
  const r = Bank.snap('ولما كان ⟦المادة⟧ 45 اثبات ⟦تنض⟧ علي :', b);
  assert.strictEqual(r.text, 'ولما كان المادة 45 اثبات تنص علي :');
  assert.ok(Bank.promptText(b, 20).split('\n').length === 20);
});

/* ---------- Arabic helpers (kateb/arabic.js) ---------- */
const Arabic = require('../kateb/arabic.js');
test('amounts in words (تفقيط) like the office writes them', () => {
  assert.strictEqual(Arabic.words(250000), 'مائتان وخمسون ألف');
  assert.strictEqual(Arabic.words(1050000), 'مليون وخمسون ألف');
  assert.strictEqual(Arabic.words(6300), 'ستة آلاف وثلاثمائة');
  assert.strictEqual(Arabic.words(3500000), 'ثلاثة ملايين وخمسمائة ألف');
  assert.strictEqual(Arabic.amount(100000), 'مائة ألف جنيه مصري لا غير');
  assert.ok(Arabic.sameAmount(250000, 'مئتان و خمسون الف جنيه'), 'spelling and case endings tolerated');
  assert.ok(Arabic.sameAmount(1050000, 'مليون وخمسين ألف جنيه مصري لا غير'));
  assert.ok(!Arabic.sameAmount(250000, 'مائتان وخمسة وخمسون ألف جنيه'));
});
test('check flags a contradicting amount or weekday and leaves a consistent paper alone', () => {
  const ok = 'انه في يوم الأحد الموافق 7/9/2025 م\nوقدره 250000 ج ( مائتان وخمسون ألف جنيه مصري لا غير )';
  assert.strictEqual(Arabic.check(ok).text, ok);
  const bad = Arabic.check('انه في يوم الاثنين الموافق 7/9/2025 م\nوقدره 250000ج ( مائتان وخمسة وخمسون ألف جنيه مصري لا غير )');
  assert.match(bad.text, /⟦الاثنين⟧ الموافق ⟦7\/9\/2025⟧/);
  assert.match(bad.text, /⟦250000⟧ ج \( ⟦مائتان وخمسة وخمسون ألف جنيه مصري لا غير⟧ \)/);
  assert.deepStrictEqual(bad.notes.map(n => n.kind).sort(), ['amount', 'weekday']);
});
test('snap applies the office spelling inside a recognised formula', () => {
  const bank = { lines: [{ t: 'بالغ سن الرشد كامل الأهلية القانونية مقيم {{PLACE}}', n: 50, o: 'بالغ سن الرشد كامل الأهلية القانونية مقيم {{PLACE}}'.split(/\s+/) }] };
  const r = Bank.snap('بالغ سن الرشد كامل الأهليه القانونيه مقيم أسيوط', bank);
  assert.strictEqual(r.text, 'بالغ سن الرشد كامل الأهلية القانونية مقيم أسيوط', 'ة/ه slips take the office form');
  assert.strictEqual(r.styled, 2);
  assert.strictEqual(Bank.snap('بالغ سن الرشد كامل الاهلية القانونية مقيم أسيوط', bank).styled, 0, 'a hamza habit is not touched');
});

test('office spelling dictionary fixes دعوه → دعوى and ه/ة slips, never a different word', () => {
  const dict = JSON.parse(fs.readFileSync(path.join(REPO, 'kateb/bank/spelling.json'), 'utf8'));
  assert.ok(Object.keys(dict.words).length > 20);
  assert.strictEqual(dict.words['دعوه'], 'دعوى'); assert.strictEqual(dict.words['الدعوي'], 'الدعوى');
  const r = Arabic.spell('دعوه صحه توقيع\nأقام الطالب الدعوه رقم 12 لسنة 2025 محكمه أول أسيوط', dict);
  assert.match(r.text, /^دعوى صحة توقيع/);
  assert.match(r.text, /الدعوى رقم 12 لسنة 2025 محكمة/);
  assert.ok(r.fixed >= 3);
  assert.strictEqual(Arabic.spell('[FIG] <svg>دعوه</svg>', dict).text, '[FIG] <svg>دعوه</svg>');
});

/* ---------- KATEB15: learning + store ---------- */
const Learn = require('../kateb/learn.js');
const Store = require('../kateb/store.js');

test('learn: wordDiff finds one-for-one replaced Arabic words and ignores numbers, markup and moved text', () => {
  const first = '[H] مذكرة بدفاع\nالسيد / ⟦احمد⟧ محمد علي\nرقم ١٢٣٤ لسنة ٢٠٢٤\nدعوه صحة توقيع';
  const now = 'مذكرة بدفاع\nالسيد / أحمد محمود علي\nرقم ١٢٣٥ لسنة ٢٠٢٤\nدعوى صحة توقيع';
  assert.deepStrictEqual(Learn.wordDiff(first, now), [{ from: 'احمد', to: 'أحمد' }, { from: 'محمد', to: 'محمود' }, { from: 'دعوه', to: 'دعوى' }]);
  assert.deepStrictEqual(Learn.wordDiff('أ ب ج', 'أ ب ج'), []);
  assert.deepStrictEqual(Learn.wordDiff('الاسم هنا', 'الاسم'), [], 'a deleted word is not a correction');
  assert.deepStrictEqual(Learn.wordDiff('x y', 'z w'), [], 'latin words are not learned');
});

test('learn: records merge per profile, prompt block lists them, lexicon unmarks confirmed words, fixes swap repeated corrections', () => {
  const items = [];
  Learn.record(items, 'baba', 'fix', 'محمد', 'محمود', 1); Learn.record(items, 'baba', 'fix', 'محمد', 'محمود', 2);
  Learn.record(items, 'baba', 'word', 'الأهلية', '', 3); Learn.record(items, 'mama', 'word', 'الكسر', '', 4);
  assert.strictEqual(Learn.record(items, 'baba', 'fix', '1234', '1235'), null, 'numbers are never learned');
  assert.strictEqual(items.length, 3); assert.strictEqual(items[0].n, 2);
  assert.deepStrictEqual(Learn.stats(items, 'baba'), { fixes: 1, words: 1, total: 2, last: 3 });
  const p = Learn.promptText(items, 'baba');
  assert.match(p, /«محمد» → «محمود»/); assert.match(p, /الأهلية/); assert.doesNotMatch(p, /الكسر/, 'another profile\'s words stay out');
  assert.strictEqual(Learn.promptText(items, 'general'), '');
  assert.deepStrictEqual(Learn.applyFixes('السيد ⟦محمد⟧ و ⟦علي⟧', items, 'baba'), { text: 'السيد ⟦محمود⟧ و ⟦علي⟧', fixed: 1 });
  Learn.record(items, 'baba', 'word', 'الأهلية', '', 5);
  assert.deepStrictEqual(Learn.applyLexicon('المحكمة ⟦الأهلية⟧ ⟦الكسر⟧ ⟦١٢٣⟧', items, 'baba'), { text: 'المحكمة الأهلية ⟦الكسر⟧ ⟦١٢٣⟧', cleared: 1 });
  assert.strictEqual(Learn.applyLexicon('⟦محمود⟧', items, 'baba').cleared, 1, 'a correction applied twice is a known word');
});

test('store: documents, trash with 30-day purge, versions capped with the first kept (memory backend)', async () => {
  Store._reset();
  const d = Store.newDoc('legal', 'ورقة', [{ html: '<p>أ</p>', img: 'data:x' }]);
  await Store.saveDoc(d);
  assert.strictEqual(Store.which(), 'ls');
  assert.strictEqual((await Store.listDocs('legal')).length, 1); assert.strictEqual((await Store.listDocs('exam')).length, 0);
  await Store.renameDoc(d.id, 'عقد'); assert.strictEqual((await Store.getDoc(d.id)).name, 'عقد');
  await Store.trashDoc(d.id);
  assert.strictEqual((await Store.listDocs('legal')).length, 0); assert.strictEqual((await Store.listTrash('legal')).length, 1);
  await Store.restoreDoc(d.id); assert.strictEqual((await Store.listDocs('legal')).length, 1);
  await Store.trashDoc(d.id);
  assert.strictEqual(await Store.purgeOld(Date.now() + 29 * 864e5), 0, 'kept for 30 days');
  assert.strictEqual(await Store.purgeOld(Date.now() + 31 * 864e5), 1, 'gone after 30 days');
  assert.strictEqual(await Store.getDoc(d.id), null);
  const v = Store.newDoc('legal', 'x', [{ html: '<p>0</p>' }]);
  assert.strictEqual(Store.addVersion(v, [{ html: '<p>0</p>' }], 'auto'), false, 'unchanged text adds nothing');
  for (let i = 1; i <= 30; i++) Store.addVersion(v, [{ html: '<p>' + i + '</p>' }], 'auto', 0, i * 1000);
  assert.strictEqual(v.versions.length, Store.MAX_VERSIONS);
  assert.strictEqual(v.versions[0].label, 'first'); assert.strictEqual(v.versions[0].pages[0].html, '<p>0</p>');
  assert.strictEqual(v.versions[v.versions.length - 1].pages[0].html, '<p>30</p>');
  const w = Store.newDoc('legal', 'y', [{ html: '<p>0</p>' }]);
  Store.addVersion(w, [{ html: '<p>1</p>' }], 'auto', 60000, 1000); Store.addVersion(w, [{ html: '<p>2</p>' }], 'auto', 60000, 2000);
  assert.strictEqual(w.versions.length, 2, 'within the gap the last auto version is updated, not added');
  assert.strictEqual(w.versions[1].pages[0].html, '<p>2</p>');
});
