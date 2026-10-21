"""AyaSpell (hunspell-ar) → kateb/dict/ar.aff.txt + ar.dic.txt, the compact form Dict (kateb/dict.js) reads.
Source: the LibreOffice copy of the AyaSpell Arabic dictionary (GPL/LGPL/MPL, Taha Zerrouki & Mohamed Kebdani):
  https://raw.githubusercontent.com/LibreOffice/dictionaries/master/ar/ar.aff
  https://raw.githubusercontent.com/LibreOffice/dictionaries/master/ar/ar.dic
What changes: the IGNORE characters (tashkeel, tatweel) are removed from words, affixes and conditions as hunspell
itself does on lookup; morphology fields (AM, po:) and comments are dropped; AF aliases are re-numbered after the
merge of entries that only differed in tashkeel. Run:  python tests/tools/build_dict.py ar.aff ar.dic kateb/dict"""
import os, re, sys, collections

IGNORE = 'ًٌٍَُِّْـٰ'
RX = re.compile('[' + IGNORE + ']')
def strip(s): return RX.sub('', s)

def split_flags(s):              # FLAG long: two characters per flag
    return [s[i:i + 2] for i in range(0, len(s), 2)]

def main(aff_in, dic_in, out):
    aliases = []
    rules = []                   # (kind, flag, cross, strip, add, cont, cond)
    headers = {}
    for l in open(aff_in, encoding='utf8'):
        l = l.rstrip('\n')
        if l.startswith('AF '):
            p = l.split()
            if p[1].isdigit(): continue
            aliases.append(p[1]); continue
        m = re.match(r'^(PFX|SFX)\s+(\S+)\s+([YN])\s+(\d+)\s*$', l)
        if m: headers[(m.group(1), m.group(2))] = m.group(3); continue
        m = re.match(r'^(PFX|SFX)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)', l)
        if m:
            kind, flag, st, add, cond = m.groups()
            cont = ''
            if '/' in add: add, cont = add.split('/', 1)
            st = '' if st == '0' else strip(st); add = '' if add == '0' else strip(add)
            cond = strip(cond) or '.'
            rules.append([kind, flag, headers.get((kind, flag), 'N'), st, add, cont, cond])
    # alias ids in the source refer to AF lines; continuation classes on affixes do too
    def alias_flags(n): return set(split_flags(aliases[int(n) - 1])) if n else set()
    words = collections.OrderedDict()
    first = True
    for l in open(dic_in, encoding='utf8'):
        if first: first = False; continue
        l = l.rstrip('\n')
        if not l or l.startswith('#'): continue
        l = l.split('\t')[0]
        m = re.match(r'^([^/ ]+)(?:/(\d+))?', l)
        if not m: continue
        w = strip(m.group(1))
        if not w: continue
        fl = alias_flags(m.group(2))
        if w in words: words[w] |= fl
        else: words[w] = set(fl)
    # continuation classes become flag-set strings too
    sets = {}
    def sid(fl):
        key = ''.join(sorted(fl))
        if not key: return ''
        if key not in sets: sets[key] = len(sets) + 1
        return str(sets[key])
    for r in rules: r[5] = sid(alias_flags(r[5]))
    dic_lines = []
    for w, fl in words.items():
        i = sid(fl); dic_lines.append(w + ('/' + i if i else ''))
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'ar.aff.txt'), 'w', encoding='utf8') as f:
        f.write('# AyaSpell hunspell-ar, compacted for kateb/dict.js (see tests/tools/build_dict.py)\n')
        for key, i in sorted(sets.items(), key=lambda kv: kv[1]): f.write('AF ' + key + '\n')
        for kind, flag, cross, st, add, cont, cond in rules:
            f.write(' '.join([kind, flag, cross, st or '0', (add or '0') + ('/' + cont if cont else ''), cond]) + '\n')
    with open(os.path.join(out, 'ar.dic.txt'), 'w', encoding='utf8') as f:
        f.write('\n'.join(dic_lines) + '\n')
    print('words', len(dic_lines), 'flag sets', len(sets), 'rules', len(rules))

if __name__ == '__main__':
    main(*sys.argv[1:4])
