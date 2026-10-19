"""Build Kateb's office templates from real Word files of the office.

    python tests/tools/build_templates.py <folder with the chosen .docx files> kateb/templates

For every template key in CHOICES it reads <folder>/<key>.docx and writes:
  kateb/templates/<key>.docx   the original package (styles, fonts, theme, page setup, stamp texture) with an EMPTY body
  kateb/templates/templates.json  per key: the exact paragraph/run formatting of each role (title, date, party, body,
                                  heading, closing, clause, table ...), the stamp / side-box / ornament shapes with
                                  placeholders, and nothing of the client text.
The browser (kateb/office.js) pours the transcription into the skeleton using these formats.
Client data never leaves: body text is dropped, docProps / customXml / attached-template paths are scrubbed,
and the only texts kept are fixed boilerplate phrases (headings, closings) used to match lines.
"""
import copy, json, os, re, sys, zipfile
from lxml import etree

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
def q(t): return '{%s}%s' % (W, t)

# key -> label shown in the app (the .docx in the input folder must be named <key>.docx)
CHOICES = {
    'sihha': 'دعوى صحة توقيع',
    'reannounce': 'إعادة إعلان',
    'announce': 'إعلان بأصل الصحيفة',
    'warning': 'إنذار',
    'sahifa': 'صحيفة / استئناف',
    'inherit_announce': 'إعلان في مادة الوراثة',
    'inherit_request': 'طلب وراثة',
    'sale': 'عقد بيع',
    'gift': 'عقد هبة',
    'price': 'إقرار سعر',
    'iqrar': 'إقرار',
    'memo': 'مذكرة',
}

# ---------- text rules (kept in step with ROLE rules in kateb/office.js) ----------
TASHKEEL = re.compile('[ً-ْٰـ]')
def norm(t):
    t = TASHKEEL.sub('', t or '')
    t = re.sub('[أإآ]', 'ا', t).replace('ة', 'ه').replace('ى', 'ي')
    return re.sub(r'\s+', ' ', t).strip()

ORD = r'(بند تمهيدي|اولا|ثانيا|ثالثا|رابعا|خامسا|سادسا|سابعا|ثامنا|تاسعا|عاشرا|(حادي|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع) ?عشر|السبب [^ :]+)'
HEADWORDS = r'^(و?(اعلنت|انذرت)\S* ?بال(ا|ا)تي|بناء علي[هة]|وبناء علي[هة]|الموضو+ع|لذلك|الطلبات|الدفاع|الوقائع|ضد|نصمم علي الطلبات)'

def role_of(text, jc, idx_after_title, seen_title):
    n = norm(text)
    if not n: return 'blank'
    if re.fullmatch(r'[هنمك]{2,6}', n): return 'ornament'
    if n.startswith('بسم الله الرحمن الرحيم'): return 'basmala'
    if re.match(r'^(ا|ا)نه في يوم', n): return 'date'
    if re.match(r'^بناء (علي|عل) طلب', n): return 'request'
    if re.match(r'^ومحل\S* ?المختار', n): return 'office'
    if re.match(r'^ولا?جل العلم', n.replace('آ', 'ا')): return 'closing'
    if re.match(r'^(الشهود|شهد بذلك)', n): return 'witnesses'
    if re.match(r'^(الطرف الاول|وكيل (الطالب|المتهم|المدعي))', n): return 'signature'
    if n.startswith('=='): return 'agreement'
    if re.match('^' + ORD + r'\s*[:\-]', n): return 'clause'
    if re.match(r'^\(?\s*[0-9٠-٩]+\s*[-–.)]', n): return 'party'
    if n.startswith('[') or n.startswith('(('): return 'cite'
    if n.startswith('"') or n.startswith('«'): return 'quote'
    if re.match(HEADWORDS, n) and len(n) <= 45: return 'heading'
    if jc == 'center':
        if not seen_title: return 'title'
        if idx_after_title == 1: return 'title2'
        return 'heading' if len(n) <= 45 else 'body'
    return 'body'

# ---------- XML helpers ----------
ROOT_NS = {}
def ser(el):
    s = etree.tostring(el, encoding='unicode')
    # drop only the declarations the skeleton's root already makes; shapes keep their own (a:, pic:, …)
    s = re.sub(r' xmlns:(\w+)="([^"]+)"', lambda m: '' if ROOT_NS.get(m.group(1)) == m.group(2) else m.group(0), s)
    return re.sub(r' o:gfxdata="[^"]*"', '', s)   # cached preview blobs: Word rebuilds them

def clean_rpr(rpr):
    if rpr is None: return etree.Element(q('rPr'))
    r = copy.deepcopy(rpr)
    for tag in ('noProof', 'lang', 'rtl', 'highlight', 'vanish'):
        for e in r.findall(q(tag)): r.remove(e)
    for e in r.iter():
        for a in list(e.attrib):
            if a.endswith('}hint') or 'rsid' in a: del e.attrib[a]
    return r

def run_text(r): return ''.join(t.text or '' for t in r.iter(q('t')))
def is_anchor_run(r): return r.find('.//{%s}AlternateContent' % MC) is not None or r.find(q('pict')) is not None or r.find(q('drawing')) is not None
def is_bold(rpr): return rpr is not None and (rpr.find(q('b')) is not None or rpr.find(q('bCs')) is not None)

def para_formats(p):
    """pPr + most used normal / bold run formats (by text length) + the first run's format (for prefixes)."""
    ppr = p.find(q('pPr'))
    ppr = copy.deepcopy(ppr) if ppr is not None else etree.Element(q('pPr'))
    for e in ppr.findall(q('rPr')): ppr.remove(e)            # paragraph-mark formatting: rebuilt from the run format
    for e in ppr.findall(q('sectPr')): ppr.remove(e)
    for a in list(ppr.attrib): del ppr.attrib[a]
    runs = [r for r in p.iter(q('r')) if not is_anchor_run(r) and run_text(r).strip()]
    tally = {}
    for r in runs:
        rp = clean_rpr(r.find(q('rPr'))); k = ser(rp)
        tally.setdefault(k, [0, rp]); tally[k][0] += len(run_text(r))
    normal = sorted([v for v in tally.values() if not is_bold(v[1])], key=lambda v: -v[0])
    bold = sorted([v for v in tally.values() if is_bold(v[1])], key=lambda v: -v[0])
    first = clean_rpr(runs[0].find(q('rPr'))) if runs else None
    rest = runs[1:] if len(runs) > 1 else runs
    rest_t = {}
    for r in rest:
        rp = clean_rpr(r.find(q('rPr'))); k = ser(rp); rest_t.setdefault(k, [0, rp]); rest_t[k][0] += len(run_text(r))
    rest_best = sorted(rest_t.values(), key=lambda v: -v[0])
    out = {'pPr': ser(ppr)}
    if normal: out['rN'] = ser(normal[0][1])
    if bold: out['rB'] = ser(bold[0][1])
    if first is not None: out['rP'] = ser(first)
    if rest_best: out['rR'] = ser(rest_best[0][1])
    if 'rN' not in out and 'rB' in out: out['rN'] = out['rB']
    return out

PLACE = {'lawyer': '{{LAWYER}}', 'ltitle': '{{LAWYER_TITLE}}', 'subject': '{{SUBJECT}}', 'agent': '{{AGENT}}'}
def set_par_text(p, text):
    ts = list(p.iter(q('t')))
    if not ts: return
    ts[0].text = text
    for t in ts[1:]: t.text = ''

def placeholder_shapes(run):
    """Text boxes: stamp «مكتب / NAME / المحامي» and side box «الموضوع / SUBJECT… / كطلب… / وكيل الطالب / المحامي»."""
    for box in run.iter(q('txbxContent')):
        ps = [p for p in box.findall(q('p'))]
        texts = [norm(''.join(t.text or '' for t in p.iter(q('t')))) for p in ps]
        nonempty = [i for i, t in enumerate(texts) if t]
        if not nonempty: continue
        head = texts[nonempty[0]]
        if head == 'مكتب' and len(nonempty) >= 2:
            set_par_text(ps[nonempty[1]], PLACE['lawyer'])
            if len(nonempty) >= 3: set_par_text(ps[nonempty[2]], PLACE['ltitle'])
            for i in nonempty[3:]: set_par_text(ps[i], '')
        elif head.startswith('الموضو'):
            stop = next((i for i in nonempty[1:] if texts[i].startswith('كطلب')), None)
            subj = [i for i in nonempty[1:] if stop is None or i < stop]
            if subj:
                set_par_text(ps[subj[0]], PLACE['subject'])
                for i in subj[1:]: box.remove(ps[i])
            # «كطلب الطالب وتحت مسئوليته» / «وكيل الطالب» / «المحامي» follow the client and the lawyer
            for i in [i for i in nonempty if stop is not None and i >= stop]:
                t = texts[i]
                if t.startswith('كطلب'): set_par_text(ps[i], '{{BYREQ}}')
                elif t.startswith('وكيل'): set_par_text(ps[i], '{{AGENTOF}}')
                elif t in ('الطالب', 'الطالبه', 'الطالبان', 'الطالبين'): set_par_text(ps[i], '{{CLIENT}}')
                elif t in ('المحامي', 'المحاميه'): set_par_text(ps[i], PLACE['agent'])

def table_formats(tbl):
    tblpr = tbl.find(q('tblPr')); grid = [int(g.get(q('w'))) for g in tbl.findall(q('tblGrid') + '/' + q('gridCol'))]
    rows = tbl.findall(q('tr'))
    def row_fmt(tr):
        cells = []
        for tc in tr.findall(q('tc')):
            tcpr = copy.deepcopy(tc.find(q('tcPr'))) if tc.find(q('tcPr')) is not None else etree.Element(q('tcPr'))
            p = tc.find(q('p')); f = para_formats(p) if p is not None else {'pPr': '<w:pPr/>'}
            cells.append({'tcPr': ser(tcpr), **f})
        trpr = tr.find(q('trPr'))
        return {'trPr': ser(trpr) if trpr is not None else '', 'cells': cells}
    return {'tblPr': ser(tblpr) if tblpr is not None else '<w:tblPr/>', 'grid': grid,
            'head': row_fmt(rows[0]) if rows else None, 'row': row_fmt(rows[1]) if len(rows) > 1 else (row_fmt(rows[0]) if rows else None)}

CORPUS_PAT = {'sihha': r'صحة توقيع', 'reannounce': r'(إ|ا)عادة (إ|ا)علان', 'announce': r'(إ|ا)علان ب(أ|ا)صل', 'warning': r'(إ|ا)نذار',
              'sale': r'عقد بيع', 'gift': r'هب[هة]', 'price': r'(إ|ا)قرار سعر', 'iqrar': r'^(إ|ا)قرار(?! سعر)', 'memo': r'مذكر[هة]',
              'sahifa': r'صحيفة|استئناف', 'inherit_announce': r'(إ|ا)علان.*وراث', 'inherit_request': r'طلب وراث'}
SIZE_ROLES = ('body', 'party', 'clause', 'request', 'date')

def corpus_body_size(corpus_dir, key):
    """the font size (half-points) most office files of this type use for their running text"""
    import glob, collections
    pat = CORPUS_PAT.get(key)
    if not corpus_dir or not pat: return None
    modes = collections.Counter()
    for f in glob.glob(os.path.join(corpus_dir, '**', '*.docx'), recursive=True):
        name = os.path.basename(f)
        if name.startswith('~$') or not re.search(pat, name): continue
        try: x = zipfile.ZipFile(f).read('word/document.xml').decode('utf8')
        except Exception: continue
        body = re.sub(r'<w:txbxContent>.*?</w:txbxContent>', '', x[x.find('<w:body>'):], flags=re.S)
        szs = []
        for p in re.findall(r'<w:p\b.*?</w:p>', body, re.S):
            t = ''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', p)).strip()
            if len(t) < 15: continue
            m = re.findall(r'<w:szCs w:val="(\d+)"', p) or re.findall(r'<w:sz w:val="(\d+)"', p)
            if m: szs.append(collections.Counter(m).most_common(1)[0][0])
        if szs: modes[collections.Counter(szs).most_common(1)[0][0]] += 1
    return int(modes.most_common(1)[0][0]) if modes else None

def resize(fmt, sz):
    out = dict(fmt)
    for k in ('rN', 'rB', 'rP', 'rR'):
        if k in out and out[k]:
            out[k] = re.sub(r'<w:sz w:val="\d+"/>', '<w:sz w:val="%d"/>' % sz, out[k])
            out[k] = re.sub(r'<w:szCs w:val="\d+"/>', '<w:szCs w:val="%d"/>' % sz, out[k])
    return out

def build(src_dir, out_dir, corpus_dir=None):
    os.makedirs(out_dir, exist_ok=True)
    spec = {}
    for key, label in CHOICES.items():
        src = os.path.join(src_dir, key + '.docx')
        if not os.path.exists(src): print('skip (missing)', key); continue
        zin = zipfile.ZipFile(src)
        root = etree.fromstring(zin.read('word/document.xml'))
        ROOT_NS.clear(); ROOT_NS.update({k: v for k, v in root.nsmap.items() if k})
        body = root.find(q('body')); sect = body.find(q('sectPr'))
        roles, anchors, table, blanks, seen_title, after_title = {}, [], None, [], False, 99
        order = []
        for el in list(body):
            ln = etree.QName(el).localname
            if ln == 'tbl':
                if table is None: table = table_formats(el)
                order.append('table'); continue
            if ln != 'p': continue
            txt_runs = [r for r in el.iter(q('r')) if not is_anchor_run(r)]
            text = ''.join(run_text(r) for r in txt_runs if r.getparent() is not None and r.getparent().tag != q('txbxContent'))
            # text outside text boxes only
            text = ''.join(run_text(r) for r in el.findall('.//' + q('r')) if not is_anchor_run(r) and not any(a.tag == q('txbxContent') for a in r.iterancestors()))
            jcel = el.find(q('pPr') + '/' + q('jc')); jc = jcel.get(q('val')) if jcel is not None else ''
            after_title = after_title + 1 if seen_title else 99
            role = role_of(text, jc, after_title, seen_title)
            if role == 'title': seen_title, after_title = True, 0
            if role == 'blank' and not seen_title and not anchors and not order: role = 'lead'   # empty first line that holds shapes
            order.append(role)
            ars = [r for r in el.findall(q('r')) if is_anchor_run(r)]
            for r in ars:
                rr = copy.deepcopy(r); placeholder_shapes(rr)
                anchors.append({'role': role, 'at': len(order) - 1, 'xml': ser(rr)})
            f = para_formats(el)
            if role == 'blank': blanks.append(f['pPr']); continue
            if role == 'ornament': f['text'] = text.strip()
            n = norm(text)
            if role in ('heading', 'closing', 'witnesses', 'signature') and len(n) <= 60 and not re.search(r'[0-9٠-٩]', n):
                f['key'] = n
            roles.setdefault(role, []).append(f)
        # keep only what the filler needs: first exemplar per role, every keyed phrase, the longest body
        out_roles = {}
        for role, fs in roles.items():
            if role in ('heading', 'closing', 'witnesses', 'signature'): out_roles[role] = fs
            else:
                # the look most lines of this role share (the first «أولاً :» may be a one-off)
                sig = lambda f: (f.get('pPr'), f.get('rP'), f.get('rN'))
                counts = {}
                for f in fs: counts[sig(f)] = counts.get(sig(f), 0) + 1
                out_roles[role] = [max(fs, key=lambda f: (counts[sig(f)], -fs.index(f)))]
        # the one source file may be an outlier in size: running text takes the size most files of the type use
        mode = corpus_body_size(corpus_dir, key)
        if mode:
            for role in SIZE_ROLES:
                if role not in out_roles: continue
                cur = re.search(r'<w:sz w:val="(\d+)"', out_roles[role][0].get('rN', '') or out_roles[role][0].get('rP', '') or '')
                if cur and abs(int(cur.group(1)) - mode) >= 4:
                    print('  %s/%s: size %s -> corpus %d' % (key, role, cur.group(1), mode))
                    out_roles[role] = [resize(fmt, mode) for fmt in out_roles[role]]
        mar = sect.find(q('pgMar')); page = {a: int(mar.get(q(a))) for a in ('top', 'right', 'bottom', 'left')} if mar is not None else {}
        spec[key] = {'label': label, 'roles': out_roles, 'anchors': anchors, 'table': table, 'page': page,
                     'blank': blanks[0] if blanks else '<w:pPr/>', 'order': order,
                     'blankBeforeWitnesses': count_blank_before(order, 'witnesses')}
        write_skeleton(zin, root, sect, anchors, os.path.join(out_dir, key + '.docx'))
        print(key, 'roles:', {k: len(v) for k, v in out_roles.items()}, 'anchors:', [(a['role'], a['at']) for a in anchors], 'table:', bool(table))
    with open(os.path.join(out_dir, 'templates.json'), 'w', encoding='utf8') as fh:
        json.dump(spec, fh, ensure_ascii=False, separators=(',', ':'))

def count_blank_before(order, role):
    if role not in order: return 0
    i, n = order.index(role) - 1, 0
    while i >= 0 and order[i] == 'blank': n += 1; i -= 1
    return n

def write_skeleton(zin, root, sect, anchors, dst):
    body = root.find(q('body'))
    for el in list(body): body.remove(el)
    body.append(etree.Comment('KATEB-BODY'))
    body.append(sect)
    doc = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    used = set(re.findall(r'r:(?:embed|id|link)="([^"]+)"', ''.join(a['xml'] for a in anchors)))
    used |= set(re.findall(r'r:id="([^"]+)"', etree.tostring(sect, encoding='unicode')))
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
        rels = etree.fromstring(zin.read('word/_rels/document.xml.rels'))
        drop_targets = set()
        for rel in list(rels):
            typ, tid, tgt = rel.get('Type'), rel.get('Id'), rel.get('Target')
            if (typ.endswith('/image') or typ.endswith('/customXml') or typ.endswith('/comments') or typ.endswith('/people')) and tid not in used:
                rels.remove(rel); drop_targets.add('word/' + tgt if not tgt.startswith('/') else tgt[1:])
        for item in zin.infolist():
            n = item.filename
            if n.startswith('customXml/') or n in drop_targets or n in ('word/comments.xml', 'word/people.xml'): continue
            data = zin.read(n)
            if n == 'word/document.xml': data = doc
            elif n == 'word/_rels/document.xml.rels': data = etree.tostring(rels, xml_declaration=True, encoding='UTF-8', standalone=True)
            elif n == 'word/_rels/settings.xml.rels': continue            # attached template path (a local folder name)
            elif n == 'word/settings.xml':
                s = data.decode('utf8'); s = re.sub(r'<w:attachedTemplate[^>]*/>', '', s); data = s.encode('utf8')
            elif n == 'docProps/core.xml':
                s = data.decode('utf8')
                for tag in ('dc:creator', 'cp:lastModifiedBy', 'dc:title', 'dc:subject', 'cp:keywords', 'dc:description'):
                    s = re.sub(r'<%s>[^<]*</%s>' % (tag, tag), '<%s></%s>' % (tag, tag), s)
                data = s.encode('utf8')
            elif n == 'docProps/app.xml':
                s = data.decode('utf8'); s = re.sub(r'<(Company|Manager)>[^<]*</\1>', r'<\1></\1>', s); data = s.encode('utf8')
            elif n == '[Content_Types].xml':
                s = data.decode('utf8'); s = re.sub(r'<Override PartName="/(customXml|word/comments|word/people)[^>]*/>', '', s); data = s.encode('utf8')
            zout.writestr(item, data)

if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
