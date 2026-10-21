"""Formula banks per case kind (kateb/bank/case_<key>.json + kateb/bank/cases.json index) from published Egyptian
legal form collections (one text file per kind, collected outside the repo), plus the legal terms list:

    python tests/tools/build_cases.py <folder with <key>.txt files and terms.txt> kateb/bank

Each kind's file: lines of the paper's standard wording, names as {{NAME}}, places as {{PLACE}}, numbers as #
(law and article numbers kept), "# source: …" lines at the top. The reader gets the kind's lines (chosen from
the paper's title) in the cached system prompt; Bank.snap uses them to settle doubtful formula words.
terms.txt: correct spellings of legal terms → added to the lexicon's standard forms (spelling correction).
"""
import glob, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from privacy import keep
from build_lexicon import SKIP
from build_bank import tokens as bank_tokens

KINDS = [  # key, label, title regex (on the normalised title: أإآ→ا ة→ه ى→ي)
    ('sihha', 'صحة توقيع', r'صحه توقيع'),
    ('nafaz', 'صحة ونفاذ عقد', r'صحه ونفاذ|نفاذ عقد'),
    ('tameen', 'إلزام بصرف مستحقات تأمينية / معاش', r'تامين|معاش|مستحقات'),
    ('qaima', 'قائمة منقولات / تبديد', r'قايمه|قائمه|منقولات|تبديد'),
    ('nafaqa', 'نفقة', r'نفقه|متجمد'),
    ('khul', 'خلع', r'خلع'),
    ('talaq', 'تطليق للضرر', r'تطليق|طلاق'),
    ('hadana', 'حضانة ورؤية', r'حضانه|رؤيه|رويه'),
    ('tard', 'طرد للغصب', r'طرد|غصب'),
    ('rea', 'ريع', r'ريع'),
    ('faskh', 'فسخ عقد', r'فسخ'),
    ('taawid', 'تعويض', r'تعويض'),
    ('ikhla', 'إخلاء', r'اخلاء'),
    ('adaa', 'أمر أداء / مطالبة', r'اداء|مطالبه|الزام بمبلغ|الزام بدفع|الزام باداء'),
    ('mustajal', 'دعوى مستعجلة / إثبات حالة', r'مستعجل|اثبات حاله|حراسه'),
    ('tanfiz', 'منازعة تنفيذ', r'منازعه|اشكال'),
    ('istinaf', 'استئناف', r'استئناف|استيناف'),
    ('inzar', 'إنذار', r'انذار'),
    ('ilan', 'إعلان / إعادة إعلان', r'اعلان'),
    ('junha', 'جنحة مباشرة', r'جنحه|مباشره'),
    ('amana', 'شيك / إيصال أمانة', r'شيك|ايصال|امانه'),
    ('mozakra', 'مذكرة بدفاع', r'مذكره'),
    ('warasa', 'إعلام وراثة', r'وراثه|وراثة'),
]
TASH = re.compile('[ً-ْٰـ]')

def bare(w): return re.sub('[أإآ]', 'ا', w).replace('ة', 'ه').replace('ى', 'ي')
def tokens(t): return [w for w in re.split(r'\s+', t.strip()) if w]

def main(src, out_dir):
    index = []
    for key, label, rx in KINDS:
        f = os.path.join(src, key + '.txt')
        if not os.path.exists(f): continue
        lines, seen = [], set()
        for l in open(f, encoding='utf8', errors='ignore').read().split('\n'):
            l = TASH.sub('', l).strip().lstrip('-*•').strip()
            if not l or l.startswith('#') or 'http' in l or len(l) < 8: continue
            l = re.sub(r'\s+', ' ', l)
            if not keep(l): continue                       # a person's name slipped in: never published
            k = bare(l)
            if k in seen: continue
            seen.add(k); lines.append({'t': l, 'n': 5, 'o': bank_tokens(l)})
        if not lines: continue
        json.dump({'type': 'case_' + key, 'label': label, 'lines': lines}, open(os.path.join(out_dir, 'case_' + key + '.json'), 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
        index.append({'key': key, 'label': label, 're': rx, 'n': len(lines)})
        print(key, len(lines))
    json.dump({'type': 'cases', 'kinds': index}, open(os.path.join(out_dir, 'cases.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=0)
    terms = os.path.join(src, 'terms.txt')
    lexp = os.path.join(out_dir, 'lexicon.json')
    if os.path.exists(terms) and os.path.exists(lexp):
        lex = json.load(open(lexp, encoding='utf8')); added = 0
        for l in open(terms, encoding='utf8', errors='ignore'):
            for w in re.findall('[ء-ي]{3,}', TASH.sub('', l)):
                b = bare(w)
                if b in SKIP or w.endswith('ى') or len(b) < 4: continue          # المدعى/المدعي، إنه/أنه: context decides, not a list
                if any(c in w for c in 'أإآةؤئ') and b not in lex['std']: lex['std'][b] = w; added += 1
        lex['std'] = dict(sorted(lex['std'].items()))
        json.dump(lex, open(lexp, 'w', encoding='utf8'), ensure_ascii=False, indent=0)
        print('terms → lexicon standard forms +', added)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
