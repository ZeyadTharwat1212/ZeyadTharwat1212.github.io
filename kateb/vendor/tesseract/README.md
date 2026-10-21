# Third-party files (not written here)

- `tesseract.min.js`, `worker.min.js` — tesseract.js 7.0.0 (Apache-2.0, https://github.com/naptha/tesseract.js), unmodified `dist/` build.
- `tesseract-core-simd-lstm.wasm.js` — tesseract.js-core 7.0.0 (Apache-2.0), the single-file SIMD + LSTM core.
- `ara.traineddata.gz` — Tesseract Arabic model from `tessdata_fast` (Apache-2.0, https://github.com/tesseract-ocr/tessdata_fast), gzipped.
- `LICENSE` — Apache License 2.0 for the above.

Used by `kateb/ocr.js` for printed pages only; loaded on first use (about 5 MB once, then kept by the browser).
Update: `tests/tools/fetch_vendor.sh` names the versions and sources.
