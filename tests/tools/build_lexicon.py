"""Office spelling lexicon (kateb/bank/lexicon.json) from the office's own papers (kept outside the repo):

    python tests/tools/build_lexicon.py <folder of .txt exported from the office files> kateb/bank/lexicon.json

For every word, all the ways the office typed it are grouped by its bare form (أإآ→ا, ة→ه, ى→ي). When the office
sometimes types the standard form (with ة / hamza / ى) and that form clearly dominates the other standard forms,
the plain form is corrected to it: الهيئه → الهيئة, الزام → إلزام. At run time (Dict.fix) a correction is made
only when the standard dictionary knows the corrected word and does not know the plain one — or for ه → ة where
«…ه» cannot be a pronoun (after ال, or when the stem is no word of these papers): the office's own slips
(أسم، أبن، وقدرة) are never imposed. Pronoun forms (طلبه «his
request») are never touched because the office never types them with ة. Only words: a word that is mostly part of
a person's name, or a common given name, is left out (public site).
"""
import collections, glob, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from privacy import NAMES

TASH = re.compile('[ً-ْٰـ]')
WORD = re.compile('[ء-ي]{2,}')
TITLE = re.compile(r'(السيد|السيده|السيدة|الاستاذ|الأستاذ|الاستاذه|الأستاذة|المرحوم|المرحومه|المرحومة|الدكتور|الحاج|الحاجه|الحاجة|ورثه|ورثة|القاصر|المستشار)\s*/\s*$')
SKIP = {'وقدره', 'قدره', 'وقدرها', 'جنيه', 'وجنيه', 'بجنيه', 'علي', 'المدعي', 'المدعيه', 'المدعية', 'مدعي', 'ان', 'انه', 'انها', 'انهم', 'انما', 'لان', 'بان', 'وان', 'فان', 'كان', 'اذا', 'اذ',
        'الي', 'اليه', 'عيسي', 'موسي', 'يحيي', 'مصطفي', 'مرتضي', 'منى', 'مني', 'هدي', 'سلمي', 'ليلي', 'نهي', 'بشري', 'عزه', 'هبه', 'رحمه', 'نعمه', 'فاطمه', 'حمده', 'عطيه', 'حماده'}

def bare(w): return re.sub('[أإآ]', 'ا', w).replace('ة', 'ه').replace('ى', 'ي')
def marks(w): return sum(w.count(c) for c in 'أإآةىؤئ')

def main(src, out):
    forms = collections.defaultdict(collections.Counter)   # bare → written form → files
    inname = collections.Counter(); total = collections.Counter()
    names = set(bare(TASH.sub('', n)) for n in NAMES)
    files = glob.glob(os.path.join(src, '**', '*.txt'), recursive=True)
    for f in files:
        t = TASH.sub('', open(f, encoding='utf8', errors='ignore').read())
        seen = set()
        for line in t.split('\n'):
            name_left = 0
            for m in re.finditer(r'[ء-ي]+|/|[^ء-ي/]+', line):
                tok = m.group(0)
                if tok == '/':
                    if TITLE.search(line[:m.end()]): name_left = 4
                    continue
                if not WORD.fullmatch(tok):
                    if re.search(r'[\-–،,.:()\t]', tok): name_left = 0
                    continue
                b = bare(tok); total[b] += 1
                if name_left > 0: inname[b] += 1; name_left -= 1
                if (b, tok) not in seen: seen.add((b, tok)); forms[b][tok] += 1
    std = {}; sure_h = []
    seen_forms = collections.Counter()
    for b, c in forms.items():
        if b in names or (total[b] and inname[b] / total[b] > 0.2): continue
        for w, n in c.items():
            if n >= 2: seen_forms[w] = n
    for b, c in forms.items():
        if b in SKIP or b in names or len(b) < 2: continue
        if total[b] and inname[b] / total[b] > 0.2: continue                     # mostly part of names
        marked = {w: n for w, n in c.items() if marks(w) > 0}
        if not marked: continue
        best, bn = max(marked.items(), key=lambda x: (x[1], marks(x[0])))
        if bn < 3: continue
        rivals = sum(n for w, n in marked.items() if w != best and not (set(w) <= set(best) or marks(w) < marks(best)))
        if rivals > 0.5 * bn: continue                                           # أنه / إنه: two standard forms compete
        plain_h = sum(n for w, n in c.items() if w != best and ('ة' in best and w.endswith('ه') and best.endswith('ة') or best.endswith('ى') and w.endswith('ي')))
        definite = re.match(r'^(ال|بال|وال|لل|فال|كال|وبال|ولل)', b) is not None   # ال + a pronoun is not Arabic: الخاضعه is الخاضعة
        stem_rare = total[b[:-1]] < 0.2 * max(total[b], 1) and bn >= 0.5 * plain_h   # لسنه: «لسن» is no word here, so it is لسنة
        if plain_h > 0.3 * bn and not (best.endswith('ة') and (definite or stem_rare)): continue   # طلبه «his request» ≠ طلبة
        std[b] = best
        if best.endswith('ة') and (definite or stem_rare): sure_h.append(b)      # ه → ة even where «…ه» parses as a pronoun
    json.dump({'type': 'lexicon', 'note': 'bare form (أإآ→ا ة→ه ى→ي) → the standard spelling the office types (built from its papers; words only, no names)', 'std': dict(sorted(std.items())), 'sureH': sorted(sure_h), 'seen': ' '.join(sorted(seen_forms))},
              open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=0)
    print('files', len(files), 'words', len(forms), 'standard forms', len(std))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
