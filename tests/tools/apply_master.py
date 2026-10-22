"""Put the office's master template (the .dotx every lawyer file is made in) under the court-paper templates.

    python tests/tools/apply_master.py <master.dotx> kateb/templates

What comes from the master: page margins and the page-1 parts — the basmala picture, the marble stamp box
(مكتب / lawyer / المحامي), the side column (الموضوع / subject / كطلب الطالب وتحت مسئوليته / وكيل الطالب / المحامي)
and the double vertical rule. Pages 2+ have none of them (they hang from the first paragraph).
What stays from each paper type's own office files: every paragraph and run format (fonts, sizes, spacing,
alignment), styles and settings — so the two are never mixed. Contracts, إقرار, مذكرة and طلب وراثة are not
court papers with a side column in the office files and keep their own layout.
"""
import io, json, os, re, sys, zipfile

TYPES = ['sihha', 'reannounce', 'announce', 'warning', 'sahifa', 'inherit_announce']
MEDIA = {'rId5': ('kmaster1.png', 'rIdKM1'), 'rId6': ('kmaster2.jpeg', 'rIdKM2'), 'rId7': ('kmaster3.jpeg', 'rIdKM3')}
IMG_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'


def first_para(body):
    """the first top-level <w:p> of the body (paragraphs inside text boxes are nested in it)"""
    depth, start = 0, None
    for m in re.finditer(r'<w:p(?=[\s>])[^>]*>|</w:p>', body):
        if m.group(0) == '</w:p>':
            depth -= 1
            if depth == 0: return body[start:m.end()]
        else:
            if depth == 0: start = m.start()
            depth += 1


def top_runs(p):
    """top-level <w:r> elements of a paragraph (runs inside text boxes are nested and stay inside)"""
    out, depth, start = [], 0, None
    for m in re.finditer(r'<w:r(?=[\s>])[^>]*>|</w:r>', p):
        if m.group(0) == '</w:r>':
            depth -= 1
            if depth == 0: out.append(p[start:m.end()])
        else:
            if depth == 0: start = m.start()
            depth += 1
    return out


def fill_box(xml, fill):
    """fill: list of (match text or '' for the empty paragraph after a label, placeholder, after-label)"""
    def per_box(tb):
        paras = re.findall(r'<w:p\b.*?</w:p>', tb, re.S)
        texts = [''.join(re.findall(r'<w:t[^>]*>([^<]*)<', p)).strip() for p in paras]
        new = list(paras)
        for want, ph, after in fill:
            for i, t in enumerate(texts):
                if after is not None:
                    if t == after and i + 1 < len(paras) and texts[i + 1] == '':
                        p = paras[i + 1]
                        rpr = (re.search(r'<w:pPr>.*?(<w:rPr>.*?</w:rPr>).*?</w:pPr>', p, re.S) or [None, '<w:rPr/>'])[1]
                        new[i + 1] = p.replace('</w:p>', '<w:r>' + rpr + '<w:t xml:space="preserve">' + ph + '</w:t></w:r></w:p>')
                        texts[i + 1] = ph; break
                elif t == want:
                    p, first = paras[i], [True]
                    def sub(m):
                        if first[0]: first[0] = False; return m.group(1) + ph + '</w:t>'
                        return m.group(1) + '</w:t>'
                    new[i] = re.sub(r'(<w:t[^>]*>)[^<]*</w:t>', sub, p)
                    texts[i] = ph; break
        for a, b in zip(paras, new): tb = tb.replace(a, b, 1)
        return tb
    return re.sub(r'(<w:txbxContent>)(.*?)(</w:txbxContent>)', lambda m: m.group(1) + per_box(m.group(2)) + m.group(3), xml, flags=re.S)


def main(master, tdir):
    z = zipfile.ZipFile(master)
    d = z.read('word/document.xml').decode('utf8')
    body = d[d.index('<w:body>'):]
    p0 = first_para(body)
    ppr = re.search(r'<w:pPr>.*?</w:pPr>', p0, re.S).group(0)
    runs = [r for r in top_runs(p0) if '<wp:anchor' in r]
    assert len(runs) == 4, len(runs)
    anchors = []
    for r in runs:
        x = r
        for old, (name, new) in MEDIA.items(): x = x.replace('"%s"' % old, '"%s"' % new)
        if 'مكتب' in x:
            x = fill_box(x, [('', '{{LAWYER}}', 'مكتب'), ('المحامي', '{{LAWYER_TITLE}}', None)])
        elif 'الموضوع' in x:
            x = fill_box(x, [('', '{{SUBJECT}}', 'الموضوع'), ('كطلب الطالب وتحت مسئوليته', '{{BYREQ}}', None), ('وكيل الطالب', '{{AGENTOF}}', None), ('المحامي', '{{AGENT}}', None)])
        a = {'role': 'master', 'at': 0, 'xml': x}
        if '<pic:pic' in x:
            a['img'] = 'kateb/templates/basmala.png'
            # v34: the master's بسم الله is an old WMF with an odd frame; Word drew it shifted right, half off the page
            # (Zeyad's screenshot). Now a PNG, pinned to the right margin (its place in the master: right edge = text edge).
            x = re.sub(r'<wp:positionH relativeFrom="column">\s*<wp:posOffset>-?\d+</wp:posOffset>\s*</wp:positionH>',
                       '<wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>', x)
            assert 'relativeFrom="margin"><wp:align>right' in x
            x = x.replace(' cstate="print"', '')
            a['xml'] = x
        anchors.append(a)
    sect = re.findall(r'<w:sectPr\b.*?</w:sectPr>', d, re.S)[-1]
    pgmar = re.search(r'<w:pgMar [^>]*/>', sect).group(0)
    page = {k: int(v) for k, v in re.findall(r'w:(top|right|bottom|left)="(\d+)"', pgmar)}
    media = {name: z.read('word/media/' + {'rId6': 'image2.jpeg', 'rId7': 'image3.jpeg'}[old]) for old, (name, _) in MEDIA.items() if old != 'rId5'}
    media['kmaster1.png'] = open(os.path.join(tdir, 'basmala.png'), 'rb').read()

    spec_path = os.path.join(tdir, 'templates.json')
    spec = json.load(open(spec_path, encoding='utf8'))
    for k in TYPES:
        T = spec[k]
        if 'officeAnchors' not in T: T['officeAnchors'] = T['anchors']; T['officePage'] = T['page']
        T['anchors'] = anchors; T['page'] = page; T['master'] = {'pPr': ppr}
        path = os.path.join(tdir, k + '.docx')
        src = zipfile.ZipFile(path); buf = io.BytesIO(); out = zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED)
        for it in src.infolist():
            b = src.read(it.filename)
            if it.filename.startswith('word/media/kmaster'): continue
            if it.filename == 'word/_rels/document.xml.rels':
                s = re.sub(r'<Relationship Id="rIdKM\d"[^>]*/>', '', b.decode('utf8'))
                s = s.replace('</Relationships>', ''.join('<Relationship Id="%s" Type="%s" Target="media/%s"/>' % (new, IMG_REL, name) for _, (name, new) in MEDIA.items()) + '</Relationships>')
                b = s.encode('utf8')
            elif it.filename == '[Content_Types].xml':
                s = b.decode('utf8')
                for ext, ct in (('png', 'image/png'), ('jpeg', 'image/jpeg')):
                    if 'Extension="%s"' % ext not in s: s = s.replace('<Default ', '<Default Extension="%s" ContentType="%s"/><Default ' % (ext, ct), 1)
                b = s.encode('utf8')
            elif it.filename == 'word/document.xml':
                s = b.decode('utf8')
                s = re.sub(r'<w:pgMar [^>]*/>', pgmar, s)
                b = s.encode('utf8')
            out.writestr(it, b)
        for name, data in media.items(): out.writestr('word/media/' + name, data)
        out.close(); src.close()
        open(path, 'wb').write(buf.getvalue())
        print(k, 'master applied')
    json.dump(spec, open(spec_path, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
