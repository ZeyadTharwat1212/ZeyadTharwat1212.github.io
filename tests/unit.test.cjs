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
  assert.ok(/r:embed="rIdKM1"/.test(doc) && /w10:wrap type="square"/.test(doc), 'the master template: its بسم الله picture and the page-1 side column');
  assert.ok(!/Zokrofi/.test(doc), 'the old text ornament is not doubled with the master\'s بسم الله');
  const rels = parts['word/_rels/document.xml.rels'] || await zip.file('word/_rels/document.xml.rels').async('string');
  assert.ok(/Id="rIdKM1"[^>]*media\/kmaster1\.wmf/.test(rels) && zip.file('word/media/kmaster2.jpeg'), 'the master\'s pictures travel with the file');
  assert.match(doc, /ألون إبراهيم باشا/);                        // stamp + office line
  assert.match(doc, />دعوى صحة توقيع</);                          // side-box subject
  assert.match(doc, /كطلب الطالبة وتحت مسئوليتها/, 'client is female (ومحلها)');
  assert.match(doc, /Simplified Arabic/);
  assert.match(doc, /<w:highlight w:val="yellow"\/>/, 'unsure words stay yellow');
  assert.ok(+/<w:pgMar [^>]*w:left="(\d+)"/.exec(doc)[1] === 2268 && +/<w:pgMar [^>]*w:right="(\d+)"/.exec(doc)[1] === 707, 'the master template\'s margins');
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
  const files = fs.readdirSync(path.join(REPO, 'kateb/bank')).filter(f => f.endsWith('.json') && !['spelling.json', 'memory.json', 'lexicon.json', 'cases.json'].includes(f));
  assert.ok(files.length >= 10);
  for (const f of files) {
    const b = JSON.parse(fs.readFileSync(path.join(REPO, 'kateb/bank', f), 'utf8'));
    assert.ok(b.lines.length > 5, f);
    for (const l of b.lines) {
      if (!/^case_/.test(f)) assert.ok(!/[0-9٠-٩]/.test(l.t), f + ': digits must be # → ' + l.t);   // published case forms keep their law and article numbers
      assert.ok(!/(السيد|السيدة|الأستاذ|الاستاذ|الدكتور)\s*\/\s*(?!\{\{NAME\}\}|(?:وكيل|رئيس|مدير|وزير|النائب|المحامي العام|قاضي|المستشار|محافظ|مأمور|ممثل|الممثل)\s)\S/.test(l.t), f + ': unmasked name → ' + l.t);   // an office title after «/» is not a name
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

test('engine: Claude usage ledger → estimated cost per model', () => {
  global.localStorage = { _: {}, getItem(k) { return this._[k] === undefined ? null : this._[k]; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; } };
  const Engine = require('../kateb/engine.js');
  Engine.usageReset();
  Engine.recordUsage('claude-opus-5-5', { input_tokens: 1000000, output_tokens: 100000, cache_creation_input_tokens: 200000, cache_read_input_tokens: 1000000 });
  Engine.recordUsage('claude-haiku-5-5', { input_tokens: 1000000, output_tokens: 0 });
  const u = Engine.usageSummary();
  assert.strictEqual(u.today.calls, 2);
  assert.ok(Math.abs(u.models['claude-opus-5-5'].usd - (4 + 2 + 1 + 0.2)) < 1e-9, 'opus: 4 in + 2 out + 1 cache write + 0.2 cache read');
  assert.ok(Math.abs(u.models['claude-haiku-5-5'].usd - 0.1) < 1e-9);
  assert.ok(Math.abs(u.total.usd - 7.3) < 1e-9);
  assert.strictEqual(u.total.tokens, 3300000);
  assert.deepStrictEqual(Engine.priceOf('claude-sonnet-5-5-20260101'), [2, 10, 2.5, 0.1], 'dated model ids match by prefix');
  Engine.usageReset(); assert.strictEqual(Engine.usageSummary().total.calls, 0);
});

test('dates read from the right on screen (marks around the slashes), none of it reaches the file', () => {
  const shown = Verify.rtlDates(Verify.arabicDigits('مؤرخ 10/11/2020 رقم 2537/2025 و 5 كيلو'));
  assert.strictEqual(shown, 'مؤرخ ١٠‏/‏١١‏/‏٢٠٢٠ رقم ٢٥٣٧‏/‏٢٠٢٥ و ٥ كيلو');
  assert.strictEqual(Verify.west(Verify.stripMarks(shown)), 'مؤرخ 10/11/2020 رقم 2537/2025 و 5 كيلو');
});

test('office: the client name for the file name, like the office names its files', () => {
  const Office = require('../kateb/office.js');
  assert.strictEqual(Office.partyName('[H] دعوى صحة توقيع\nبناء علي طلب السيد / مينا سامي - بالغ سن الرشد\nومحله المختار مكتب الأستاذ / ألون إبراهيم باشا المحامي'), 'مينا سامي');
  assert.strictEqual(Office.partyName('بناء على طلب السيدة / نجوى لطفى محمد والمقيمة أسيوط'), 'نجوى لطفى محمد');
  assert.strictEqual(Office.partyName('[H] عقد بيع ابتدائي\nالطرف الأول : السيد / باسم مكرم فهيم ، المقيم أسيوط (بائع)'), 'باسم مكرم فهيم');
  assert.strictEqual(Office.partyName('بناء على طلب ورثة المرحوم / ⟦جرجس⟧ نعيم بصفتهم'), 'جرجس نعيم');
  assert.strictEqual(Office.partyName('[H] مذكرة بدفاع\nالسيد / أحمد محمد علي\tبصفته'), 'أحمد محمد علي');
  assert.strictEqual(Office.partyName('لا اسم هنا'), '');
});

test('engine: fast-mode usage is priced at twice the list price; the switch defaults to off (2× price)', () => {
  const Engine = require('../kateb/engine.js');
  assert.deepStrictEqual(Engine.priceOf('claude-opus-5-5 ⚡'), [8, 40, 10, 0.4]);
  assert.deepStrictEqual(Engine.priceOf('claude-opus-5-5'), [4, 20, 5, 0.2]);
  assert.strictEqual(Engine.fastOn(), false); Engine.setFast(true); assert.strictEqual(Engine.fastOn(), true); Engine.setFast(false);
});

/* ---------- KATEB18: alternatives, fields, glossary ---------- */
test('alternatives ⟦first|second⟧: only the first reading is a word; the guard keeps them; docx runs carry alts', () => {
  assert.deepStrictEqual(Verify.tokens('السيد ⟦محمود|محمد⟧ علي'), ['السيد', 'محمود', 'علي']);
  const g = Verify.guard('السيد ⟦محمود|محمد⟧ علي كلمة', 'السيد محمود علي', 'السيد محمد علي', true);
  assert.strictEqual(g.text, 'السيد ⟦محمود|محمد⟧ علي ⟦كلمة⟧');
  assert.deepStrictEqual(g.words, ['كلمه'], 'the guard says which words it added (normalised)');
  const runs = DocxBuilder.parseMarkup('السيد ⟦محمود|محمد⟧ علي')[0].runs;
  assert.deepStrictEqual(runs[1], { text: 'محمود', b: false, u: false, hl: true, alts: ['محمد'] });
  const Learn = require('../kateb/learn.js'), items = [];
  Learn.record(items, 'baba', 'word', 'محمود'); Learn.record(items, 'baba', 'word', 'محمود');
  assert.strictEqual(Learn.applyLexicon('⟦محمود|محمد⟧', items, 'baba').text, 'محمود', 'a confirmed first reading drops the doubt and the alternatives');
  const Bank = require('../kateb/bank.js');
  assert.strictEqual(Bank.snap('بناء علي ⟦طلب|طلبه⟧ السيد', { lines: [{ t: 'بناء علي طلب السيد', n: 5, o: ['بناء', 'علي', 'طلب', 'السيد'] }] }).text, 'بناء علي طلب السيد');
});

test('fields: court, case number, dates, amounts, names; consistency warnings never merge', () => {
  const Fields = require('../kateb/fields.js');
  const t = '[H] دعوى صحة توقيع\nفي القضية رقم ١٢٣٤ لسنة ٢٠٢٦ مدني كلي أمام محكمة أسيوط الابتدائية\nبناء علي طلب السيد / مينا سامي - بالغ سن الرشد\nبموجب عقد بيع مؤرخ في ٧/١/٢٠٢٦ بمبلغ وقدره 250000 جنيه مصري لا غير\nالسيد / كريم عادل\tمخاطبا مع';
  const f = Fields.extract(t);
  assert.deepStrictEqual(f.court, ['محكمة أسيوط الابتدائية']);
  assert.deepStrictEqual(f.cases.map(c => c.num + '/' + c.year), ['1234/2026']);
  assert.deepStrictEqual(f.dates.map(d => d.d + '/' + d.m + '/' + d.y), ['7/1/2026']);
  assert.deepStrictEqual(f.amounts.map(a => a.value), ['250000']);
  assert.deepStrictEqual(f.names, ['مينا سامي', 'كريم عادل']);
  const w = Fields.consistency([t, t.replace('١٢٣٤', '١٢٣٥').replace('مينا سامي', 'مينا سامى')]);
  assert.strictEqual(w.length, 1, 'ى/ي is not two names; a one-digit case difference is a warning');
  assert.match(w[0].text, /1234 لسنة 2026 و 1235/);
  assert.match(Fields.consistency(['السيد / كريم عادل محمود و السيد / كريم عادل محمد'])[0].text, /اسم مكتوب بصورتين/);
  assert.match(Fields.consistency(['مؤرخ في 7/13/2026'])[0].text, /تاريخ غير معتاد/);
  assert.deepStrictEqual(Fields.consistency([t]), []);
});

test('glossary: the common court expressions are a bank the prompt can carry', () => {
  const g = JSON.parse(fs.readFileSync(path.join(__dirname, '../kateb/bank/glossary.json'), 'utf8'));
  assert.ok(g.lines.length > 300);
  for (const p of ['وحيث إن', 'بناء عليه', 'تلتمس المحكمة', 'منطوق الحكم', 'المدعى عليه', 'صحيفة الدعوى', 'محضر جلسة', 'قضت المحكمة']) assert.ok(g.lines.some(l => l.t === p), p);
  const Bank = require('../kateb/bank.js');
  const txt = Bank.promptText(g, 500);
  assert.ok(txt.includes('- وحيث إن') && txt.length < 20000);
});

/* ---------- KATEB20: speech helpers ---------- */
test('speech: chunk transcripts merge without the overlap, in order; commands turn into punctuation only when clearly meant', () => {
  const Speech = require('../kateb/speech.js');
  const a = 'بناء عليه أنا المحضر سالف الذكر قد انتقلت إلى حيث إقامة المعلن إليه', b = 'إلى حيث إقامة المعلن إليه وأعلنته بالآتي';
  assert.strictEqual(Speech.merge([a, b]), a + '\n' + 'وأعلنته بالآتي');
  assert.strictEqual(Speech.merge(['كلام أول', 'كلام ثان مختلف تماما']), 'كلام أول\nكلام ثان مختلف تماما', 'no overlap → nothing removed');
  assert.strictEqual(Speech.merge(['', 'x', '']), 'x');
  assert.deepStrictEqual(Speech.command('وأعلنته بالآتي نقطة'), { text: 'وأعلنته بالآتي.', newline: false, paragraph: false, heading: false });
  assert.deepStrictEqual(Speech.command('بناء عليه فاصلة'), { text: 'بناء عليه،', newline: false, paragraph: false, heading: false });
  assert.deepStrictEqual(Speech.command('فقرة جديدة'), { text: '', newline: false, paragraph: true, heading: false });
  assert.deepStrictEqual(Speech.command('قد انتقلت سطر جديد'), { text: 'قد انتقلت', newline: true, paragraph: false, heading: false });
  assert.deepStrictEqual(Speech.command('عنوان دعوى صحة توقيع'), { text: 'دعوى صحة توقيع', newline: false, paragraph: false, heading: true });
  assert.strictEqual(Speech.command('وصلنا إلى نقطة الشرطة').text, 'وصلنا إلى نقطة الشرطة', '«نقطة» in the middle of a sentence is a word');
  assert.strictEqual(Speech.command('هل حضر علامة استفهام').text, 'هل حضر؟');
  const plan = Speech.chunkPlan(1000, new Float32Array(1000 * 100), 100);
  assert.ok(plan.length >= 2 && plan[0][0] === 0 && plan[plan.length - 1][1] === 1000, 'long audio is split');
  for (let i = 1; i < plan.length; i++) assert.ok(plan[i][0] < plan[i - 1][1], 'chunks overlap');
  assert.deepStrictEqual(Speech.chunkPlan(120, new Float32Array(10), 100), [[0, 120]], 'short audio stays whole');
  assert.strictEqual(Speech.fmtTime(65), '١:٠٥');
});

test('raster: a PDF of JPEG pages has a valid structure (header, pages, xref, trailer)', () => {
  const Raster = require('../kateb/raster.js');
  const fake = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);
  const pdf = Buffer.from(Raster.pdfFromJpegs([{ data: fake, w: 1240, h: 1754 }, { data: fake, w: 1240, h: 1754 }]));
  const txt = pdf.toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4'));
  assert.ok(txt.includes('/Type /Pages /Kids [3 0 R 6 0 R] /Count 2'));
  assert.ok(txt.includes('/Filter /DCTDecode /Length 4'));
  const xref = +txt.match(/startxref\n(\d+)/)[1];
  assert.strictEqual(txt.slice(xref, xref + 4), 'xref');
  assert.ok(txt.includes('0 9\n0000000000 65535 f'), 'nine entries: the free one, catalog, pages, 2 × (page, content, image)');
  const off = +txt.match(/\n(\d{10}) 00000 n \n/)[1]; assert.strictEqual(txt.slice(off, off + 7), '1 0 obj');
  assert.ok(txt.trimEnd().endsWith('%%EOF'));
});

test('Dict: the AyaSpell dictionary on the device — legal words pass, misspellings fail, spelling variants tolerated, marks outside existing doubts, flood guard', async () => {
  const Dict = require('../kateb/dict.js');
  await Dict.loadText(fs.readFileSync(path.join(__dirname, '..', 'kateb', 'dict', 'ar.aff.txt'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', 'kateb', 'dict', 'ar.dic.txt'), 'utf8'));
  assert.ok(Dict.size() > 290000);
  const good = 'المحكمة وبموجب بالمصروفات للمدعى المستأنف أتعاب المحاماة الابتدائية بناحية وأعلنته وسلمته فلهذه حضورياً جنيهاً صحيفة إنذار إيجارية انتقلت مخاطباً وحيث الطاعن إعلام وراثة انحصر إرثه زوجته وأولاده القصر نلتمس شكلاً ندفع الاختصاص التقادم صداق منقولات تطليق حضانة محمد أحمد مصطفى فاطمة'.split(' ');
  assert.deepStrictEqual(good.filter(w => !Dict.correct(w)), [], 'every legal word is known');
  const bad = 'المحكمةخ وبموحب بالمصروفاط للمدغى المستأنق أطعاب الكاءن حضوريانص والدفاعز'.split(' ');
  assert.deepStrictEqual(bad.filter(w => Dict.correct(w)), [], 'every misspelling is caught');
  assert.ok(Dict.correct('الاعلان') && Dict.correct('علي') && Dict.correct('المدعي') && Dict.correct('محكمه'), 'ى/ي, ة/ه and the dropped hamza are tolerated');
  assert.ok(Dict.correct('10/1/2020') && Dict.correct('Ahmed') && Dict.correct(''), 'only plain Arabic words are judged');
  const m = Dict.mark('[H] دعوى صحة توقيع\nالسيد / محمد عبد الرحمن والمقيم بناحية ⟦الوليدية⟧ مركز أسيوط وسلمته صورة الاعلان للعلم **المحكمةخ** والدفاعز', w => w === 'أسيوط');
  assert.deepStrictEqual(m.words, ['المحكمةخ', 'والدفاعز']);
  assert.ok(m.text.includes('⟦الوليدية⟧') && m.text.includes('**⟦المحكمةخ⟧**') && m.text.includes('⟦والدفاعز⟧') && !m.text.includes('⟦أسيوط⟧'), m.text);
  const flood = Dict.mark('كلمة غير معروفة: خزعبل قرطبل مرقبل زبرجل طرمبل', null);
  assert.ok(flood.skipped && flood.text.indexOf('⟦') < 0, 'too many unknown words → nothing marked');
  assert.strictEqual(Dict.unknown('بناء عليه نلتمس الحكم', null).words.length, 0);
});

test('privacy: no person\'s name in the public bank or templates (same rule as tests/tools/privacy.py)', () => {
  const fs = require('fs'), path = require('path');
  const { hasName } = require('./privacy.cjs');
  const root = path.join(__dirname, '..', 'kateb');
  const leaks = [];
  for (const f of fs.readdirSync(path.join(root, 'bank')).filter(f => f.endsWith('.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(root, 'bank', f), 'utf8'));
    for (const l of d.lines || []) if (hasName(l.t || '')) leaks.push(f + ': ' + (l.t || '').slice(0, 40));
    if (f === 'memory.json') for (const k of Object.keys(d)) for (const x of [].concat(d[k])) if (hasName(x)) leaks.push(f + ': ' + x);
  }
  const tj = fs.readFileSync(path.join(root, 'templates', 'templates.json'), 'utf8');
  for (const m of tj.matchAll(/"([^"]{6,})"/g)) if (hasName(m[1])) leaks.push('templates.json: ' + m[1].slice(0, 40));
  assert.deepStrictEqual(leaks, [], 'names would be published');
  assert.ok(hasName('القبلي / فلان علان') && hasName('السيد / محمد احمد') && !hasName('ومحله المختار مكتب الأستاذ / {{NAME}}'), 'rule sanity');
});

/* ---------- v23: the short judge and the office memory ---------- */
test('short judge: only the disputed places and reading 1 doubts are marked, the answers are put back', () => {
  const a = '[H] **دعوى صحة توقيع**\nالسيد / ⟦محمد|محمود⟧ علي حسن\tبصفته\nبيع مؤرخ في 7/1/2026 بمبلغ 5000 جنيه\nوهذا ⟦نص⟧ ثابت | خلية';
  const b = '[H] **دعوى صحة توقيع**\nالسيد / محمود علي حسين\tبصفته\nبيع مؤرخ في 7/1/2025 بمبلغ 5000 جنيه مصري\nوهذا نص ثابت | خلية';
  const m = Verify.marks(a, b);
  assert.strictEqual(m.disputes, 4); assert.strictEqual(m.doubts, 1);
  assert.ok(m.prompt.includes('⟪1| محمد ‖ محمود⟫') && m.prompt.includes('⟪3| 7/1/2026 ‖ 7/1/2025⟫') && m.prompt.includes('جنيه ⟪4| ∅ ‖ مصري⟫') && m.prompt.includes('⟪5| ⟦نص⟧⟫'), m.prompt);
  const d = Verify.decide(m, '1 | محمود\n2 | حسن\n3 | 7/1/2026\n4 | ∅\n5 | نص\nFIX | 5000 جنيه | 5000 جنيه مصري');
  assert.strictEqual(d.text, '[H] **دعوى صحة توقيع**\nالسيد / محمود علي حسن\tبصفته\nبيع مؤرخ في 7/1/2026 بمبلغ 5000 جنيه مصري\nوهذا نص ثابت | خلية');
  const none = Verify.decide(m, 'كلام لا يتبع الشكل');
  assert.ok(none.text.includes('⟦محمد|محمود⟧') && none.text.includes('⟦7/1/2026|7/1/2025⟧') && none.text.includes('⟦مصري⟧'), 'unanswered disputes stay yellow with both readings: ' + none.text);
  assert.strictEqual(Verify.marks(a, 'نص مختلف تماماً عن القراءة الأولى'), null, 'reads too far apart → the full judge');
});
test('memory: learns lawyers, judges and sure names from a reviewed paper; the private link adds lawyers; prompts', () => {
  global.Fields = require('../kateb/fields.js');
  const Memory = require('../kateb/memory.js');
  Memory.reset();
  Memory.learn('مكتب الأستاذ / سمير عادل فهمي المحامي\nالسيد / ⟦رامي⟧ فوزي جرجس بصفته\nالسيد / ناصر وهبة شاكر بصفته\nبرئاسة المستشار / عادل نبيل رشدي\nأمام محكمة بندر أول أسيوط الجزئية');
  assert.deepStrictEqual(Memory.list('lawyer', 5), ['سمير عادل فهمي']);
  assert.deepStrictEqual(Memory.list('judge', 5), ['عادل نبيل رشدي']);
  assert.ok(Memory.list('person', 9).includes('ناصر وهبة شاكر') && !Memory.list('person', 9).some(n => /رامي/.test(n)), 'a name still yellow is not learned');
  const h = Buffer.from(JSON.stringify({ lawyers: ['هدى كمال نصر'] })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.strictEqual(Memory.fromHash('#k=abc&m=' + h), 1);
  assert.ok(Memory.list('lawyer', 5)[0] === 'هدى كمال نصر');
  assert.ok(/OFFICE MEMORY/.test(Memory.privatePrompt()) && Memory.privatePrompt().includes('ناصر وهبة شاكر'));
  const pub = JSON.parse(fs.readFileSync(path.join(REPO, 'kateb/bank/memory.json'), 'utf8'));
  assert.ok(Memory.publicPrompt(pub).includes('محكمة أسيوط الابتدائية') && Memory.publicPrompt(pub).includes('قسم أول أسيوط'));
  Memory.reset();
});
test('v23b: page 1 text wraps beside the side column (it no longer runs under it); «دعوى …» pleadings use the صحيفة layout', async () => {
  assert.strictEqual(Office.detect('[H] **دعوى الزام بصرف مستحقات تامينيه**\nانه في يوم'), 'sahifa');
  assert.strictEqual(Office.detect('[H] دعوى صحة توقيع\nانه في يوم'), 'sihha');
  for (const k of ['sahifa', 'announce', 'reannounce', 'sihha', 'warning', 'inherit_announce']) {
    const zip = await Office.build(JSZip, DocxBuilder.parseMarkup('[H] عنوان\nانه في يوم السبت\nبناء على طلب السيد / فلان\nنص.\nولأجل العلم ،،'), k, { lawyer: { name: 'س', title: 'المحامي' } });
    const doc = await zip.file('word/document.xml').async('string');
    const tall = [...doc.matchAll(/<wp:anchor\b[^>]*>[\s\S]*?<\/wp:anchor>/g)].map(m => m[0]).filter(a => +((/<wp:extent cx="\d+" cy="(\d+)"/.exec(a) || [])[1] || 0) > 3000000);
    assert.ok(tall.length >= 1, k + ': has the side column');
    for (const a of tall) {
      assert.ok(/<wp:wrapSquare wrapText="largest"\/>/.test(a) && !/<wp:wrapNone\/>/.test(a), k + ': the column pushes page-1 text aside');
      const pos = +/<wp:positionH relativeFrom="column">\s*<wp:posOffset>(-?\d+)</.exec(a)[1], cx = +/<wp:extent cx="(\d+)"/.exec(a)[1], dr = +/distR="(\d+)"/.exec(a)[1];
      assert.strictEqual(pos + cx + dr, 0, k + ': page-1 text starts exactly at the margin line');
    }
    assert.ok(/<w10:wrap type="square" side="largest"\/>/.test(doc), k + ': the Word 2007 fallback wraps too');
  }
});
test('v26: automatic spelling — standard legal spelling, never names, yellow words or the office\'s pronoun forms', () => {
  const D = require('../kateb/dict.js');
  if (!D.ready()) D.loadText(fs.readFileSync(path.join(REPO, 'kateb/dict/ar.aff.txt'), 'utf8'), fs.readFileSync(path.join(REPO, 'kateb/dict/ar.dic.txt'), 'utf8'));
  const lex = JSON.parse(fs.readFileSync(path.join(REPO, 'kateb/bank/lexicon.json'), 'utf8'));
  const t = 'بناء علي طلب السيد / علي حسن محمد\nانتقلت انا معاون تنفيذ محكمه عابدين الي مقر الهيئه القوميه واعلنته بالاتي\nمع الزام المدعي عليه بالمصروفات ومقابل اتعاب المحاماه لسنه ١٩٨٠\nمبلغ وقدره ٥٠٠ جنيه قيد طلبه ⟦الهيئه⟧ ولاجل العلم';
  const r = D.fix(t, { lexicon: lex, names: ['علي حسن محمد'] });
  for (const w of ['بناء على طلب', 'السيد / علي حسن', 'أنا', 'محكمة', 'إلى', 'الهيئة القومية', 'وأعلنته بالآتي', 'إلزام المدعى عليه', 'أتعاب المحاماة', 'لسنة', 'ولأجل'])
    assert.ok(r.text.includes(w), w + ' ← ' + r.text);
  assert.ok(r.text.includes('وقدره ٥٠٠ جنيه') && r.text.includes('طلبه') && r.text.includes('⟦الهيئه⟧'), 'pronoun forms and yellow words untouched: ' + r.text);
  const lexText = JSON.stringify(lex), { hasName } = require('./privacy.cjs');
  const ws = lex.seen.split(' ');
  assert.ok(!ws.some((w, i) => hasName(ws.slice(Math.max(0, i - 2), i + 3).join(' '))) && !/جرجس|بطرس|ألون/.test(lexText), 'no names in the public lexicon');
});
test('v26: the paper title picks the formulas of its case kind', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(REPO, 'kateb/bank/cases.json'), 'utf8')).kinds;
  const kind = t => { t = t.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي'); const k = idx.find(k => new RegExp(k.re).test(t)); return k && k.key; };
  assert.strictEqual(kind('دعوى إلزام بصرف مستحقات تأمينية'), 'tameen');
  assert.strictEqual(kind('دعوى صحة توقيع'), 'sihha');
  assert.strictEqual(kind('دعوى تبديد قائمة منقولات زوجية'), 'qaima');
  assert.strictEqual(kind('دعوى نفقة زوجية وصغار'), 'nafaqa');
  assert.strictEqual(kind('صحيفة استئناف'), 'istinaf');
  assert.strictEqual(kind('إعادة إعلان'), 'ilan');
  assert.ok(idx.length >= 20 && idx.every(k => fs.existsSync(path.join(REPO, 'kateb/bank/case_' + k.key + '.json'))));
});
