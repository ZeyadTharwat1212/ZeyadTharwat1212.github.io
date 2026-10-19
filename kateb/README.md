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

## Changing the code
Bump `?v=N` on the script/style tags in both HTML pages and in `sw.js` (`CACHE` + `SHELL`) so phones load the new files. Then run the tests:

    cd tests && npm install && npm test        # unit + browser (fake Gemini)
    GEMINI_KEY=... npm run eval                # real accuracy on your own sample pages (tests/eval/samples)
