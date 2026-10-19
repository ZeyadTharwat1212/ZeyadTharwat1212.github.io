# Al-Kateb — handwriting → Word / PDF

Static pages on GitHub Pages; no server. The reading key is locked in each person's link (setup.html): a Claude key
(`sk-ant-…`, paid, console.anthropic.com) or a Gemini key (free tier). The engine picks the provider from the key.

| Page | For | Output |
|---|---|---|
| `kateb.html` | legal papers (Arabic / English) | Word + PDF |
| `hanan.html` | handwritten maths exams | Word (exam header, fractions, redrawn figures) + PDF |

Both pages are thin shells over the shared code in this folder:

| File | What it does |
|---|---|
| `engine.js` | key unlock (AES-GCM), Gemini calls with model fallback and rate-limit waits, photo/PDF → page images, rotation |
| `verify.js` | compares two readings word by word, marks every word they did not agree on (`guard`), error rates for the tests |
| `bank.js` + `bank/*.json` | formula bank: the fixed wording of each paper type (from the office's files + published formulas, names/numbers as placeholders); feeds the judge prompt and `snap()` fixes doubtful words that sit inside a known formula |
| `docx.js` | legal Word builder: titles, side headings, numbered items, tables, bold/underline, yellow doubts, page numbers |
| `exam.js` | exam Word builder |
| `app.js` | screens, the reading pipeline, the review screen, Word/PDF export, saved draft |
| `store.js` | on-device documents (IndexedDB, localStorage fallback): pages + photos, versions, recently deleted (30 days), learning records |
| `learn.js` | handwriting learning: corrections and confirmations per writer profile → prompt block for the reader, on-device lexicon |
| `style.css` | screen + print (PDF) styles |

## Installable app (web + phone)
`kateb.webmanifest` / `hanan.webmanifest` + `sw.js` make each page an app with its own icon (`kateb/icons/`):
Android / desktop Chrome show «ثبّت التطبيق على الشاشة الرئيسية» on the start screen; iPhone shows the
Share → «إضافة إلى الشاشة الرئيسية» hint. The app opens full screen and loads offline (reading still needs internet).
An iPhone home-screen app has its own storage, so the first time it asks to paste the link once (then the password).
When you bump `?v=N`, bump it in `sw.js` too (the `CACHE` name and the `SHELL` list).

## Office templates (legal page)
`kateb/templates/<key>.docx` are the office's own Word files with the body emptied (styles, fonts, page setup, stamp
texture kept) and `templates.json` holds the exact paragraph/run formatting of every line role in each original
(title, date, party, body, heading, clause, closing, table …) plus the stamp box, vertical rule and subject box with
placeholders. `kateb/office.js` detects the paper type from its title, finds the lawyer in «ومحله المختار مكتب الأستاذ /»,
and pours the reviewed text into the skeleton; the PDF path renders the same plan as HTML with the same fonts, sizes,
spacing, margins and shapes. No client text is stored in the repo (a unit test checks).

To rebuild after changing the chosen originals (kept outside the repo):

    python tests/tools/build_templates.py <folder with sihha.docx, sale.docx, …> kateb/templates

## How a page is read
1. The page is sent whole + as 2–3 sharper strips (1568px on Claude, 3072px on Gemini).
2. **Read 1** and **read 2** run **at the same time** (Claude Sonnet 5.5, different instructions and temperature).
   The first line of each reply says how far the page must be turned (ROT); a sideways page is turned and read again.
3. The paper type is detected from the title (`Office.detect`) and its **formula bank** is loaded.
4. If the reads agree word for word and nothing is doubtful → done. Otherwise a **judge** pass (Claude Opus 5.5, high
   effort) sees the images, both reads, the formula bank of this paper type, and the earlier pages of the same paper
   (names, case numbers, dates recur), and settles each disagreement from the ink.
5. `Verify.guard` marks yellow any word neither read saw, any word a read doubted, and every word the reads
   disagreed on (legal mode; exam mode: numbers). `Bank.snap` then un-marks doubtful words that sit inside a known
   formula with matching neighbours (never names, numbers, dates or places).
6. **Review screen**: the photo sits beside the editable text; «التالي» / «صحيح» walk the yellow words.
7. Word is built in the browser (office template or plain); PDF uses the browser's print engine.

On Gemini the same pipeline runs with the free models (slower; the second read falls back to one proofreading pass
when the quota is gone).

To rebuild the bank after adding office files or web formulas (kept outside the repo):

    python tests/tools/build_bank.py <txt folder from the .doc files> <folder of .docx> <web formulas folder or -> kateb/bank

## Documents, autosave, undo, versions
- Every converted paper becomes a document on the device (`store.js`): name (editable at the top of the review
  screen), pages with their photos, status (مسودة / تم التصدير). «📁 ملفاتي السابقة» lists them (open / rename /
  delete); deleted files wait 30 days in «🗑️ المحذوفات» (restore or permanent delete, each confirmed).
- Autosave writes 0.8 s after the last change and says so («جارٍ الحفظ...» → «✅ تم الحفظ تلقائيًا», or
  «تعذر الحفظ» with a tap to retry). A closed tab or a switched app flushes a pending save.
- «↩️ تراجع» / «↪️ إعادة» (Ctrl+Z / Ctrl+Y, 100 steps) cover typing, confirmations and restores.
- «🕘 نسخ سابقة»: the first reading, every export, every re-read and autosaves at most every 10 minutes (20 kept,
  the first always). «استرجاع النص الأول» restores the reading; «🔄 إعادة التحويل» reads the stored photos again.
- «⬅️ رجوع» walks a screen stack (also the phone's back button); the review screen keeps its state.

## Handwriting learning (opt-in, real, on the device)
Off until switched on in «🧠 تحسين خط اليد». When on, per writer profile (👩 ماما / 👨 بابا / عام):
- a word the reviewer replaces since the first reading is recorded as *misread → correct* (`Learn.wordDiff`:
  one-for-one Arabic word replacements only, never numbers);
- a yellow word confirmed as read is recorded as a known word.
Next page of the same profile: the records go into the reader's system prompt («this hand writes X as Y»), a
doubtful word corrected the same way twice before is swapped (still yellow), and a word confirmed twice is no longer
marked when the model doubted it (the two reads must still agree). The learn screen shows every record with its
count and a delete per row; «حذف بيانات التعلم» clears all. Nothing leaves the device except, during a read, the
learned words inside the prompt. Measure the effect with `tests/eval` (same pages with learning on and off).

## Hosting: GitHub Pages or Cloudflare Pages
The site is static, so either host serves it unchanged. Cloudflare Pages: *Workers & Pages → Create → Pages → Connect
to Git → this repo*, production branch `main`, framework **None**, no build command, output directory `/`. Every merge
to `main` then deploys in about a minute, and `_headers` keeps `sw.js`, `version.json` and the pages uncached so the
self-update works. Links keep working with the new domain: only the part before `#k=` changes (the key blob is the
same), and each phone asks for the password once on the new domain.

## Changing the code
Bump the version everywhere (`python tests/tools/bump.py N`: `?v=N`, `sw.js`, `APP_VER`, `version.json`) so every open phone updates itself. Then run the tests:

    cd tests && npm install && npm test        # unit + browser (fake Gemini)
    GEMINI_KEY=... npm run eval                # real accuracy on your own sample pages (tests/eval/samples)
