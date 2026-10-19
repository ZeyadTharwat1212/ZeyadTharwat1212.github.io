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

Layout rules on top of the office formats (v17, `office.js`):
- the stamp box reaches into the text column; the office files float it over the text (`wrapNone`). The Word file
  uses `wrapSquare` and the PDF a float, so the first lines flow beside the stamp instead of under it;
- the side box («الموضوع…») and the vertical rule hang from a text paragraph in the office files and ride up into
  the stamp when the text is short; when the stamp sits on the first line they are placed on the page instead,
  just under the stamp (`placedAnchors`);
- running text takes the size most office files of the type use (the builder's third argument is the office
  corpus folder; e.g. sihha body 13pt in the one source file → 17pt across 52 files);
- the office's 0.8 line spacing overlaps glyphs on any machine without Simplified Arabic (phones, most PCs):
  single spacing is the floor (`LINE_FLOOR`), Word and PDF alike;
- the ornament glyph line («ههه» in the Zokrofi font) is left blank in the Word file (it is garbage without the font).

    python tests/tools/build_templates.py <folder of one source .docx per type> kateb/templates <office corpus folder>

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

## Voice, audio files, sharing, smart scanning (v18)
- **Four ways in** on the start screen: 📷 تصوير ورقة · 🖼️ رفع صورة أو ملف · 🎙️ إملاء صوتي · 🎧 رفع تسجيل صوتي. All end in the
  same review screen, document store, Word/PDF export and share.
- **Smart scanner** (`scan.js`: `detect`, `warp`, `smart`): the paper is found in the photo (bright, low-saturation
  region → convex hull → four corners), straightened with a homography, then cleaned as before. The tray keeps the
  photo as taken and the page; the viewer toggles «الصورة الأصلية / المحسّنة», «✂️ تعديل القص» drags the four
  corners, «✅ استخدام الصورة» applies. No crop when nothing paper-like is found (scans, PDFs, full-frame pages).
- **Share** (`doShare`): the actual `.docx` goes to the system share sheet through the Web Share API with files
  (WhatsApp is one of its targets on phones); the button is hidden where file sharing is not available and the
  download stays. PDF is produced by the browser's print dialog, so it is not shareable this way.
- **Voice dictation** (`speech.js` + `convertAudio`): MediaRecorder with pause/resume, a level waveform, duration;
  the browser's own recogniser (`ar-EG`, interim grey / final black) shows the text while speaking, with spoken
  commands («نقطة» «فاصلة» at the end of a phrase, «سطر جديد», «فقرة جديدة», «عنوان» before a title; switchable).
  After «إنهاء التسجيل»: playback, then «✨ تحويل التسجيل إلى Word».
- **Audio files**: any format the browser decodes (mp3, m4a/aac, ogg/opus, webm, wav); name and duration shown,
  playback, «✨ تحويل إلى نص».
- **Transcription**: Claude does not hear, so audio goes to Gemini with a second key («مفتاح الصوت»: `&g=` in the
  link from setup.html, or pasted in ⚙️ الإعدادات; a Gemini main key doubles as it). The recording is decoded in
  the browser to 16 kHz mono WAV, normalised if quiet, cut at quiet moments into ≤8-minute chunks with 3 s overlap;
  chunks are transcribed three at a time (Gemini 2.5 Flash first: seconds per minute of speech; Pro only as fallback, it is 5-10× slower) with a legal-context prompt that marks unsure words `⟦…⟧` and
  never completes formulas; chunks are merged with the overlap removed. Without an audio key the live text is the
  transcript (dictation only; uploads say what is missing).
- **Layout**: Claude lays the transcript out as the written paper (LEGAL_FORMAT markup, punctuation, digits for
  spoken numbers and dates) under the rule «every spoken word, nothing added»; a shortened reply is refused.
  Then the usual house-style passes and the same review screen; the recording is stored with the document
  («🔊 التسجيل الأصلي» on the review screen, «🔄 إعادة التحويل» transcribes it again).
- Errors are said plainly: no microphone permission, unsupported browser, undecodable file, no audio key, silence.

## Intelligence layer (v16)
- **Readings to choose from**: a reader that hesitates writes `⟦محمود|محمد⟧` (most likely first, at most three).
  Only the first reading is the word for every check; the review pill shows the readings as chips and why the word
  is yellow (`data-why`: القارئ غير متأكد / متردد بين قراءتين / القراءتان اختلفتا / غير مقروءة). Picking a chip
  confirms the word, and a picked reading that differs from the first is learned as a correction.
- **Glossary** (`kateb/bank/glossary.json`, `tests/tools/build_glossary.py`): ~420 fixed expressions of Egyptian
  court papers of every type (pleadings, judgments, notices, contracts, inheritance, family). They go into the
  reader's cached system prompt with every legal page, next to the formulas of the detected paper type.
- **Faithful by default (mode A, «النص الأصلي كما هو»)**: the prompt says a slip the hand really made stays, an
  unusual legal phrase stays, only unreadable words are marked, numbers and names come from the ink only.
- **«✍️ تصحيح اللغة والإملاء» (mode B)**: one text-only Opus pass lists spelling/grammar suggestions (hamza, ة/ه,
  ى/ي, agreement, missing/repeated word, punctuation; never names, numbers, dates, formulas; number suggestions are
  dropped on the device). Each is accepted or rejected by hand, an accepted change is a green `span.fixd` (plain in
  Word), one undo step; the faithful text stays in the versions.
- **«🔎 بيانات الورقة»** (`kateb/fields.js`): court, case numbers (رقم … لسنة …), dates, amounts, party names
  found in the text, as chips that select the fact in the editor; consistency warnings for a case number that
  differs by one digit, a name written two close ways, an impossible date — warnings only, never merged.
- Smart-mode wording: «✨ تحويل المستند بذكاء», «✅ تم تحويل المستند», «يوجد بعض الكلمات التي تحتاج مراجعة (n)»,
  «مراجعة الكلمات».
- `tests/eval/run_eval.cjs` (real key: `CLAUDE_KEY`, `LEARN=0/1`) now also reports critical-field accuracy
  (case numbers, dates, amounts, names found in the truth) and hallucinated words, so pipeline changes are
  compared on real pages before being called improvements.

## Speed: ⚡ fast mode (default on, ⚙️ الإعدادات)
Every Opus call (the two reads, the judge, the numbers pass) goes through Claude's fast mode (`speed: "fast"`, beta
`fast-mode-2026-02-01`): the same model answering up to 2.5× faster at twice the list price (about $0.5-0.7 a page).
The two reads then run at effort `high` instead of `medium` in about the same wall time. A 429 on the fast lane or a
400 for an account without it falls back to the standard lane at once (no wait); Haiku stays standard. The usage
ledger prices fast-lane calls at $8 / $40 (model key `… ⚡`). The review screen shows the lane and the read time.

## Paper kind, cancel, usage, scans
- The first Word / PDF of a document asks «ما نوع هذه الورقة؟» (once per document; «🗂️ / 📝 … ▾» next to the name
  re-opens it). Legal: every office template with the detected one pre-selected, lawyer name for stamp templates.
  Exam: امتحان (full school header), مراجعة (Subject / Grade / Date + «Revision Sheet»), مذكرة (title only),
  عادية (no header); the title is editable. «إلغاء» leaves without a file.
- «✖ إلغاء القراءة» on the work screen aborts the reader calls (AbortController) and returns to the start; nothing is
  saved. «إلغاء الكل» empties the tray. A tray photo opens full size after clean-up and can be downloaded as JPG
  (the zoom overlay's download also saves the original photo of a reviewed page).
- Claude usage: every reply's `usage` is added to a ledger on the device (`kateb.usage`, per day per model);
  ⚙️ الإعدادات shows today / month / total calls, tokens and the estimated cost at Anthropic list prices (the real
  bill is on console.anthropic.com); the review screen shows the cost of the page just read, kept on the document.
- Files are named like the office's own: «صحة توقيع مينا سامي», «إعادة إعلان نجوى لطفى» (type + the client found by
  `Office.partyName`: the person on whose request the paper is made, else the first party, else the first «السيد / …»;
  type + date when no name is found). The name is editable at the top of the review screen; an untouched name follows
  the type chosen in the kind dialog.
- Dates on screen and in the PDF read from the right (`٢٠٢٠/١١/١٠` = 10 Nov 2020) like Word shows them in an
  Arabic paragraph: `Verify.rtlDates` puts a right-to-left mark around each slash for display; `walkRuns` strips
  them so the Word file keeps the office's plain `10/11/2020`.

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
