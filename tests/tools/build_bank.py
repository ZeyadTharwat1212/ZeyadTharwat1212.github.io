"""Build the formula bank (kateb/bank/<type>.json) from the office's documents + published formulas.

    python tests/tools/build_bank.py <txt root: folders of .txt exported from the office .doc files>
                                     <docx list file or folder> <web formulas folder (md/txt per type) or ->  kateb/bank

A line enters the bank only when it appears, after normalisation (digits → #, names → {{NAME}}), in at least
MIN_FILES different office files of the same paper type, or comes from a published formula. So the bank holds
the fixed wording of the papers and never a client's data: a name, a number, an address or a date is a placeholder.
"""
import collections, glob, json, os, re, sys, zipfile

MIN_FILES = 4
TASHKEEL = re.compile('[ً-ْٰـ]')

TYPES = [  # (key, filename patterns)
    ('reannounce', ['إعادة إعلان', 'اعادة اعلان', 'أعادة اعلان', 'إعادة اعلان', 'اعادة إعلان']),
    ('announce', ['إعلان بأصل', 'اعلان باصل', 'اعلان بأصل', 'إعلان باصل', 'إعلان صحيفة', 'اعلان صحيفة', 'إعلان تجديد', 'اعلان تجديد', 'إعلان بتقديم', 'اعلان بتقديم', 'اعلان بتصحيح']),
    ('inherit_announce', ['إعلان وراثة', 'اعلان وراثة', 'إعلان في مادة الوراثة']),
    ('inherit_request', ['طلب وراثة']),
    ('sihha', ['صحة توقيع']),
    ('warning', ['إنذار', 'انذار']),
    ('sahifa', ['صحيفة', 'عريضة', 'طعن', 'استئناف']),
    ('gift', ['عقد هبه', 'عقد هبة', 'عقد  هبه']),
    ('sale', ['عقد بيع', 'عربون', 'عقد قسمة', 'عقد اتفاق', 'عقد تنازل', 'عقد شركة', 'عقد فسخ', 'عقد']),
    ('price', ['إقرار سعر', 'اقرار سعر']),
    ('iqrar', ['إقرار', 'اقرار', 'أقرار']),
    ('memo', ['مذكرة']),
]
def type_of(name):
    n = os.path.basename(name)
    for key, pats in TYPES:
        for p in pats:
            if p in n: return key
    return 'other'

def norm(t):
    t = TASHKEEL.sub('', t)
    t = re.sub('[أإآ]', 'ا', t).replace('ة', 'ه').replace('ى', 'ي')
    return re.sub(r'\s+', ' ', t).strip()
def tokens(m):
    """original-spelling tokens, same rule as Bank.words(): whitespace split, empty-after-normalisation dropped"""
    return [tok for tok in m.split() if norm(tok)]

# names after a title → placeholder; numbers → #; both in the original spelling and the normalised key
NAME_AFTER = r'(السيد(?:ة|ه)?|الأستاذ(?:ة|ه)?|الاستاذ(?:ة|ه)?|الدكتور(?:ة|ه)?|المرحوم(?:ة|ه)?|الطالب(?:ة|ه)?|المدعي(?:ة|ه)?|المتهم(?:ة|ه)?|الموكل(?:ة|ه)?|المعلن إليه(?:ا)?|المنذر إليه(?:ا)?|بناء علي طلب|بناء على طلب|كل من|والدي|والدتي|زوجي|زوجتي|مورث(?:ي|نا|هم)?|المحضر|بطاقة رقم|رقم قومي)'
def mask(t):
    t = re.sub(r'[0-9٠-٩]+([\/\-\.,:][0-9٠-٩]+)*', '#', t)
    t = re.sub(r'#(\s*/\s*#)+', '#', t)
    t = re.sub(NAME_AFTER + r'\s*(?:/|:)\s*[^\-–,،.:()\n]{2,60}?(?=\s*(?:[\-–,،.():]|بالغ|كامل|المقيم|مقيم|بصفت|مخاطب|وذلك|عن نفس|$))', r'\1 / {{NAME}}', t)
    t = re.sub(r'(مكتب (?:الأستاذ|الاستاذ)(?:ة|ه)?\s*/?\s*)[^.،,\n]{2,50}?(\s+المحامي(?:ة|ه)?)', r'\1{{NAME}}\2', t)
    # no delimiter found after a title: the next words are the name anyway
    t = re.sub(NAME_AFTER + r'\s*/\s*(?!\{\{NAME\}\})(?:\S+\s+){0,3}\S+', r'\1 / {{NAME}}', t)
    t = re.sub(r'((?:شارع|ش|حارة|عطفة|ناحية|قرية|مركز|عقار رقم|زمام)\s+)[^\-–,،.()\n]{2,40}', r'\1{{PLACE}}', t)
    return t

def split_lines(text):
    for raw in text.replace('\r', '').split('\n'):
        l = raw.strip()
        if not l or len(l) < 8 or len(l) > 600: continue
        if re.fullmatch(r'[\W_#]+', l): continue
        yield l
        # a long sentence = fixed clauses + variable tail: the clauses recur across papers even when the line does not
        for part in re.split(r'\s*[،,:;()\[\]«»"]+\s*|\s+[-–]+\s+', l):
            part = part.strip()
            if part != l and len(part.split()) >= 4: yield part

def docx_text(path):
    try:
        x = zipfile.ZipFile(path).read('word/document.xml').decode('utf8')
    except Exception: return ''
    x = re.sub(r'<w:txbxContent>.*?</w:txbxContent>', '', x, flags=re.S)
    paras = re.findall(r'<w:p\b.*?</w:p>', x, flags=re.S)
    out = []
    for p in paras:
        t = ''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', p)).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
        out.append(t)
    return '\n'.join(out)

def collect(sources):
    """sources: list of (type, text). Returns per type: key → {count files, original spelling}"""
    per = collections.defaultdict(lambda: collections.defaultdict(lambda: {'n': 0, 'o': collections.Counter()}))
    for typ, text in sources:
        seen = set()
        for l in split_lines(text):
            m = mask(l); k = norm(m)
            if '{{NAME}}' in k and k.count('{{NAME}}') * 10 > len(k.split()): pass
            if k in seen: continue
            seen.add(k)
            e = per[typ][k]; e['n'] += 1; e['o'][m] += 1
    return per

def has_private(k):
    """a normalised line that still carries something identifying is left out"""
    if re.search(r'\b(بطاقه|قومي)\b.*#', k) and '{{NAME}}' not in k: return True
    if re.search(r'[0-9]', k): return True
    if re.search(r'(السيد|السيده|الاستاذ|الدكتور|المرحوم)[هة]?\s*/\s*(?!\{\{NAME\}\})\S', k): return True
    return False

def build(txt_root, docx_src, web_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    sources = []
    for f in glob.glob(os.path.join(txt_root, '**', '*.txt'), recursive=True):
        try: sources.append((type_of(f), open(f, encoding='utf8', errors='ignore').read()))
        except Exception: pass
    docxs = []
    if os.path.isdir(docx_src): docxs = glob.glob(os.path.join(docx_src, '**', '*.docx'), recursive=True)
    elif os.path.exists(docx_src): docxs = [l.strip() for l in open(docx_src, encoding='utf8') if l.strip()]
    base = os.path.dirname(docx_src) if not os.path.isdir(docx_src) else ''
    for f in docxs:
        if '~$' in f: continue
        sources.append((type_of(f), docx_text(f if os.path.isabs(f) or os.path.isdir(docx_src) else os.path.join(base, f))))
    print('office files:', len(sources), collections.Counter(t for t, _ in sources).most_common())
    per = collect(sources)
    web = collections.defaultdict(list)
    if web_dir and web_dir != '-' and os.path.isdir(web_dir):
        for f in glob.glob(os.path.join(web_dir, '*.*')):
            typ = os.path.basename(f).split('.')[0]
            for l in split_lines(open(f, encoding='utf8', errors='ignore').read()):
                if l.startswith('#') or l.startswith('http') or l.startswith('- http'): continue
                m = mask(l.lstrip('-* ').strip()); k = norm(m)
                if has_private(k): continue
                web[typ].append((k, m))
    all_types = sorted(set(list(per.keys()) + list(web.keys())))
    summary = {}
    for typ in all_types:
        if typ == 'other': continue
        lines = []
        seen = set()
        for k, e in per.get(typ, {}).items():
            if e['n'] < MIN_FILES or has_private(k): continue
            o = e['o'].most_common(1)[0][0]
            lines.append({'t': o, 'n': e['n'], 'o': tokens(o)})
            seen.add(k)
        for k, m in web.get(typ, []):
            if k in seen or len(k) < 12: continue
            seen.add(k); lines.append({'t': m, 'n': 1, 'o': tokens(m), 'src': 'web'})
        lines.sort(key=lambda x: -x['n'])
        # words tokens of the original spelling (for snap) must align with Bank.words(t): same split on whitespace
        with open(os.path.join(out_dir, typ + '.json'), 'w', encoding='utf8') as fh:
            json.dump({'type': typ, 'lines': lines}, fh, ensure_ascii=False, separators=(',', ':'))
        summary[typ] = len(lines)
    print('bank:', summary)

if __name__ == '__main__':
    build(*sys.argv[1:5])
