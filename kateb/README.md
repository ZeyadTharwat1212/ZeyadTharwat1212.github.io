# Al-Kateb — handwriting → Word / PDF

Static pages on GitHub Pages; no server, nothing paid. Each person's free Gemini key is locked in their link (setup.html).

| Page | For | Output |
|---|---|---|
| `kateb.html` | legal papers (Arabic / English) | Word + PDF |
| `hanan.html` | handwritten maths exams | Word (exam header, fractions, redrawn figures) + PDF |

Both pages are thin shells over the shared code in this folder:

| File | What it does |
|---|---|
| `engine.js` | key unlock (AES-GCM), Gemini calls with model fallback and rate-limit waits, photo/PDF → page images, rotation |
| `verify.js` | compares two readings word by word, marks every word they did not agree on (`guard`), error rates for the tests |
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
1. Rotation check, then the page is sent whole + as 2–3 sharper strips.
2. **Read 1** and **read 2** are made independently (different instructions and temperature).
3. If they agree word for word → done. If not → a **judge** pass looks at the images for each disagreement.
4. `Verify.guard` then marks yellow: any word neither read saw, any word either read was unsure of,
   and every word the two reads disagreed on (legal mode; exam mode: numbers).
5. **Review screen**: the photo sits beside the editable text; «التالي» jumps to the next yellow word and the
   same height of the photo, «صحيح» confirms it. Edits are saved on the device (survive a refresh).
6. Word is built in the browser; PDF uses the browser's print engine (perfect Arabic shaping) → «Save as PDF».

If the second read fails (daily quota), the old single proofreading pass is used instead.

## Changing the code
Bump `?v=N` on the script/style tags in both HTML pages and in `sw.js` (`CACHE` + `SHELL`) so phones load the new files. Then run the tests:

    cd tests && npm install && npm test        # unit + browser (fake Gemini)
    GEMINI_KEY=... npm run eval                # real accuracy on your own sample pages (tests/eval/samples)
