"""Personal-name guard for the formula bank and templates (they ship on a PUBLIC site).

    python tests/tools/privacy.py            # report
    python tests/tools/privacy.py --fix      # drop every bank line that carries a person's name

build_bank.py uses keep() so a rebuild can never publish a client's or neighbour's name again;
unit.test.cjs runs the same rule (privacy.cjs) and fails on any leak.
"""
import re
# common Egyptian/Arabic given names (normalised: no hamza variants, ة→ه, ى→ي)
RAW = """محمد احمد محمود مصطفي علي حسن حسين ابراهيم اسماعيل يوسف عبد عبدالله عبدالرحمن عبدالعزيز عبدالحميد عبدالحفيظ عبدالمجيد عبدالفتاح عبدالرحيم عبدالسلام عبدالناصر عبدالباسط عبدالمنعم عبدالحليم عبدالعال عبدالرازق عبدالغني
خالد طارق عمرو عمر عثمان سيد سعيد سعد سامي سمير صلاح جمال كمال شريف هشام هاني هانى وليد ياسر ايمن ايهاب اشرف عادل عاطف عصام عماد فتحي فاروق فوزي فؤاد ماهر مجدي مدحت مراد مصطفى منصور منير نبيل ناصر نادر نصر هيثم وائل وجدي ياسين يحيي يحيى رجب رمضان شعبان صابر صبري طه عاشور عوض فرج قاسم كريم لطفي مسعد مسعود ممدوح موسي موسى نصار نور زكريا زكي جابر جاد جرجس حنا حنفي حمدي حمادة خليل رأفت رافت رشاد رضا رفعت زياد ثروت شحاته شحاتة شوقي عزت علاء فايز فكري قدري كامل مرسي مرقص مينا بولس بطرس اندرو ميلاد عزيز نجيب لملوم المهدي المهدى
فاطمه فاطمة عائشه عائشة مريم مروه مروة منى مني نجلاء نجلا هدي هدى هند هبه هبة اسماء امل امال ايمان ايناس رحاب رشا زينب سعاد سلمي سلمى سماح سميره سميرة شيماء صفاء عبير عزه عزة فايزه فايزة كريمه كريمة ليلي ليلى ماجده ماجدة مها ناديه نادية نجوي نجوى نعمه نعمة نوال هاله هالة هناء وفاء ياسمين حنان سناء سهام سوزان دعاء رانيا داليا شيرين"""
def norm(t):
    t = re.sub('[ً-ْٰـ]', '', t); t = re.sub('[أإآ]', 'ا', t).replace('ة', 'ه').replace('ى', 'ي')
    return t
NAMES = set(norm(w) for w in RAW.split())
TITLE = re.compile(r'(?:السيد|السيده|القاصر|القاصره|المدعو|المرحوم|المرحومه|الاستاذ|الاستاذه|ورثه|منزل|ملك)\s*/(?!\s*(?:\{\{|$|الاستاذ|رئيس|المستشار|السيد|قاضي|مدير|وكيل|مامور|مأمور|محافظ|وزير|النائب|المحامي|نقيب))')
def has_name(text):
    n = norm(text)
    toks = re.findall(r'[؀-ۿ]+', n)
    if TITLE.search(n): return True
    # two given-name tokens close together = a person's name (e.g. "نجلاء محمد", "هانى محمد")
    if re.search(r'\}\}\s*[\u0600-\u06FF]+', n):
        after = re.findall(r'\}\}\s*([\u0600-\u06FF]+)', n)
        if any(a in NAMES for a in after): return True
    for i, t in enumerate(toks):
        if t in NAMES and any(u in NAMES or u.startswith('عبد') for u in toks[i+1:i+3]): return True
    # property boundaries name the neighbours: «القبلي / ...», «الحد البحري : منزل فلان»
    # any boundary line that names who owns the next plot is client data, whoever the neighbour is
    for m in re.finditer(r'(?:القبلي|البحري|الشرقي|الغربي)\s*[:/]\s*(?:منزل|ورثه|ملك|ارض)?\s*/?\s*([\u0600-\u06FF ]{3,40})', n):
        rest = m.group(1).strip()
        if rest and not re.match(r'(?:باقي|شارع|ش |طريق|حاره|عطفه|ممر|مدخل|منور|سلم|الشارع|الطريق|جار|ملك الغير|الملك|فضاء|ارض فضاء|مسقي|ترعه|مصرف|السكه|حد|بطول|يليه)', rest):
            return True
    if re.search(r'(?:القبلي|البحري|الشرقي|الغربي|الحد)', n) and any(t in NAMES or t.startswith('عبد') or t.startswith('ابو') for t in toks):
        return True
    return False


def keep(line_text):
    return not has_name(line_text)

if __name__ == '__main__':
    import glob, json, os, sys
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'kateb')
    fix = '--fix' in sys.argv; total = 0
    for f in sorted(glob.glob(os.path.join(root, 'bank', '*.json'))):
        d = json.load(open(f, encoding='utf8'))
        if 'lines' not in d: continue
        bad = [l for l in d['lines'] if has_name(l.get('t', ''))]
        total += len(bad)
        if bad: print(os.path.basename(f), len(bad), 'line(s) with a name')
        if fix and bad:
            d['lines'] = [l for l in d['lines'] if not has_name(l.get('t', ''))]
            json.dump(d, open(f, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
    t = json.dumps(json.load(open(os.path.join(root, 'templates', 'templates.json'), encoding='utf8')), ensure_ascii=False)
    import re as _re
    tl = [s for s in _re.findall(r'"([^"]{6,})"', t) if has_name(s)]
    if tl: print('templates.json', len(tl), 'string(s) with a name'); total += len(tl)
    print('removed' if fix else 'found', total)
    sys.exit(0 if (fix or total == 0) else 1)
