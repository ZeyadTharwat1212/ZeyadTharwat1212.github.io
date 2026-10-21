# Arabic dictionary (third-party data)

`ar.aff.txt` + `ar.dic.txt` are the AyaSpell Arabic spellchecking dictionary (hunspell-ar) by Taha Zerrouki and
Mohamed Kebdani — GPL/LGPL/MPL tri-license, https://github.com/linuxscout/ayaspell — taken from the LibreOffice
copy (https://github.com/LibreOffice/dictionaries/tree/master/ar) and compacted by `tests/tools/build_dict.py`
(tashkeel removed as hunspell's IGNORE does, morphology fields dropped, affix aliases renumbered). About 294,000
words and 1,600 affix rules; 1 MB over the wire. Read by `kateb/dict.js` on the device only; nothing is sent anywhere.
