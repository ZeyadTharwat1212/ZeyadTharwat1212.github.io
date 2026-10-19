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
Bump `?v=N` on the script/style tags in both HTML pages so phones load the new files. Then run the tests:

    cd tests && npm install && npm test        # unit + browser (fake Gemini)
    GEMINI_KEY=... npm run eval                # real accuracy on your own sample pages (tests/eval/samples)
