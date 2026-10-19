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
  assert.deepStrictEqual(Verify.tokens('[H] **مُذَكِّرة** ⟦بدفاع⟧، __نعم__'), ['مذكرة', 'بدفاع', 'نعم']);
  assert.deepStrictEqual(Verify.tokens('[TABLE] الاسم | العدد || أحمد | {3/4}'), ['الاسم', 'العدد', 'أحمد', '3/4']);
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
  const loose = Verify.guard(A.replace('السيد', 'الاستاذ'), A, B, false).text;
  assert.match(loose, /⟦الاستاذ⟧/);          // in neither reading
  assert.match(loose, /⟦1234⟧/);             // number the readings disagreed on
  assert.doesNotMatch(loose, /⟦محمد⟧/);      // name: only in strict mode
  const strict = Verify.guard(A, A, B, true).text;
  assert.match(strict, /⟦محمد⟧/);
  assert.match(strict, /^\[H\] \*\*مذكرة بدفاع\*\*/, 'markup kept intact');
  assert.strictEqual(Verify.guard(A, A, A, true).added, 0, 'agreeing readings add nothing');
});

test('guard keeps a word marked when either reader doubted it', () => {
  const g = Verify.guard('رقم 55 لسنة', 'رقم ⟦55⟧ لسنة', 'رقم 55 لسنة', false);
  assert.strictEqual(g.text, 'رقم ⟦55⟧ لسنة');
  assert.strictEqual(Verify.guard('رقم ⟦55⟧ لسنة', 'رقم 55 لسنة', 'رقم 55 لسنة').text, 'رقم ⟦55⟧ لسنة', 'no double brackets');
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
