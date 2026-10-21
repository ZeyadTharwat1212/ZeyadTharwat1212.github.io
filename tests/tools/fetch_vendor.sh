#!/bin/sh
# Re-fetch the third-party runtime files (see kateb/vendor/tesseract/README.md and kateb/dict/README.md).
set -e
cd "$(dirname "$0")/../.."
T=kateb/vendor/tesseract; mkdir -p $T tmp_vendor
curl -sSL -o tmp_vendor/t.tgz https://registry.npmjs.org/tesseract.js/-/tesseract.js-7.0.0.tgz
curl -sSL -o tmp_vendor/c.tgz https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-7.0.0.tgz
tar xzf tmp_vendor/t.tgz -C tmp_vendor; cp tmp_vendor/package/dist/tesseract.min.js tmp_vendor/package/dist/worker.min.js $T/
rm -rf tmp_vendor/package; tar xzf tmp_vendor/c.tgz -C tmp_vendor; cp tmp_vendor/package/tesseract-core-simd-lstm.wasm.js tmp_vendor/package/LICENSE $T/
curl -sSL -o $T/ara.traineddata https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/ara.traineddata && gzip -9 -n -f $T/ara.traineddata
curl -sSL -o tmp_vendor/ar.aff https://raw.githubusercontent.com/LibreOffice/dictionaries/master/ar/ar.aff
curl -sSL -o tmp_vendor/ar.dic https://raw.githubusercontent.com/LibreOffice/dictionaries/master/ar/ar.dic
python3 tests/tools/build_dict.py tmp_vendor/ar.aff tmp_vendor/ar.dic kateb/dict
rm -rf tmp_vendor
