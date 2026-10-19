/* Office templates: pour the transcription into the office's own Word files (kateb/templates/<key>.docx).
   Every paragraph takes the exact paragraph + run formatting of the matching line in the original
   (title, date, party, body, heading, closing, clause, table …); the stamp box, side box, vertical rule and
   ornament come from the original with the lawyer's name and the subject filled in.
   templates.json is built by tests/tools/build_templates.py (role rules there are kept in step with ROLE below). */
var Office = (function () {
  'use strict';
  var SPEC = null, SKEL = {};
  var VER = '4';

  async function spec() {
    if (!SPEC) { var r = await fetch('kateb/templates/templates.json?v=' + VER); if (!r.ok) throw { code: 'template' }; SPEC = await r.json(); }
    return SPEC;
  }
  async function skeleton(key) {
    if (!SKEL[key]) { var r = await fetch('kateb/templates/' + key + '.docx?v=' + VER); if (!r.ok) throw { code: 'template' }; SKEL[key] = await r.arrayBuffer(); }
    return SKEL[key];
  }

  /* ---------- text rules ---------- */
  function norm(t) {
    return String(t || '').replace(/[\u064B-\u0652\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
  }
  var ORD = '(بند تمهيدي|اولا|ثانيا|ثالثا|رابعا|خامسا|سادسا|سابعا|ثامنا|تاسعا|عاشرا|(حادي|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع) ?عشر|السبب [^ :]+)';
  var CLAUSE = new RegExp('^' + ORD + '\\s*[:\\-]');
  var HEADWORDS = /^(و?(اعلنت|انذرت)\S* ?بال(ا|ا)تي|بناء علي[هة]|وبناء علي[هة]|الموضو+ع|لذلك|الطلبات|الدفاع|الوقائع|ضد|نصمم علي الطلبات)/;

  /* which office template fits this text (title lines decide) */
  var TYPES = [
    ['reannounce', /^(ا|ا)?عاده اعلان/], ['announce', /^اعلان (باصل|صحيفه)/], ['inherit_announce', /^اعلان في ماده الوراثه|^اعلان وراثه/],
    ['inherit_request', /^طلب وراثه/], ['sihha', /^دعو[يه] صحه توقيع|^صحه توقيع/], ['warning', /^انذار/],
    ['sahifa', /^(صحيفه|عريضه|استئناف)/], ['gift', /^عقد ?هبه/], ['sale', /^عقد/], ['price', /^اقرار سعر/], ['iqrar', /^اقرار/], ['memo', /^مذكره/]
  ];
  function detect(text) {
    var lines = String(text || '').split('\n').map(function (l) { return norm(l.replace(/^\s*\[[A-Z]+\]\s*/, '').replace(/[*_⟦⟧]/g, '')); })
      .filter(function (l) { return l && !/^[هنمك]{2,6}$/.test(l) && l.indexOf('بسم الله') !== 0; });
    for (var i = 0; i < Math.min(3, lines.length); i++)
      for (var j = 0; j < TYPES.length; j++) if (TYPES[j][1].test(lines[i])) return TYPES[j][0];
    var all = lines.slice(0, 12).join(' ');
    if (/صحه توقيع/.test(all) && /معاون|محضر/.test(all)) return 'sihha';
    return null;
  }
  /* «ومحله المختار مكتب الأستاذ / فلان المحامي» → stamp name and title */
  function lawyerFrom(text) {
    var t = String(text || '').replace(/[*_⟦⟧]/g, '').replace(/[\u064B-\u0652\u0670\u0640]/g, '').replace(/[ \t]+/g, ' ');
    var m = t.match(/مكتب\s+ال?[أاإ]ستاذ[ةه]?\s*\/?\s*([^.،,\n]+?)\s+(المحامي[ةه]?)(\s+بالنقض)?(?=[\s.،,]|$)/);
    if (!m) return null;
    return { name: m[1].trim(), title: /[ةه]$/.test(m[2]) ? 'المحامية' : 'المحامي', nakd: !!m[3] };
  }


  function roleOf(b, st) {
    if (b.table) return 'table';
    var t = b.runs.map(function (r) { return r.text; }).join(''), n = norm(t);
    if (!n) return 'blank';
    if (/^[هنمك]{2,6}$/.test(n)) return 'ornament';
    if (n.indexOf('بسم الله الرحمن الرحيم') === 0) return 'basmala';
    if (/^(ا|ا)نه في يوم/.test(n)) return 'date';
    if (/^بناء (علي|عل) طلب/.test(n)) return 'request';
    if (/^ومحل\S* ?المختار/.test(n)) return 'office';
    if (/^ولا?جل العلم/.test(n)) return 'closing';
    if (/^(الشهود|شهد بذلك)/.test(n)) return 'witnesses';
    if (/^(الطرف الاول|وكيل (الطالب|المتهم|المدعي))/.test(n)) return 'signature';
    if (n.indexOf('==') === 0) return 'agreement';
    if (CLAUSE.test(n)) return 'clause';
    if (/^\(?\s*[0-9٠-٩]+\s*[-–.)]/.test(n) || b.list) return 'party';
    if (n[0] === '[' || n.indexOf('((') === 0) return 'cite';
    if (n[0] === '"' || n[0] === '«') return 'quote';
    if (HEADWORDS.test(n) && n.length <= 45) return 'heading';
    var centered = b.heading || b.align === 'C' || b.sub;
    if (centered) {
      if (!st.title) return 'title';
      if (st.sinceTitle === 1 && !st.body) return 'title2';
      return n.length <= 60 ? 'heading' : 'body';
    }
    return 'body';
  }

  /* ---------- run formatting (rPr children must stay in schema order) ---------- */
  var ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];
  function rprParts(rpr) {
    var inner = (String(rpr || '').match(/^<w:rPr\s*>([\s\S]*)<\/w:rPr>$/) || [])[1] || '';
    var parts = [], re = /<w:(\w+)\b[^>]*?(\/>|>[\s\S]*?<\/w:\1>)/g, m;
    while ((m = re.exec(inner))) parts.push([m[1], m[0]]);
    return parts;
  }
  function rprSet(rpr, adds) {
    var parts = rprParts(rpr).filter(function (p) { return !adds.some(function (a) { return a[0] === p[0]; }); }).concat(adds);
    parts.sort(function (a, b) { return ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]); });
    return '<w:rPr>' + parts.map(function (p) { return p[1]; }).join('') + '</w:rPr>';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  var AR = /[\u0600-\u06FF]/;
  function runXml(text, base, r) {
    var adds = [];
    if (r.b && !/<w:b\/>|<w:bCs\/>/.test(base)) adds.push(['b', '<w:b/>'], ['bCs', '<w:bCs/>']);
    if (r.u && !/<w:u /.test(base)) adds.push(['u', '<w:u w:val="single"/>']);
    if (r.hl) adds.push(['highlight', '<w:highlight w:val="yellow"/>']);
    if (AR.test(text)) adds.push(['rtl', '<w:rtl/>']);
    var rpr = rprSet(base || '<w:rPr/>', adds), out = '';
    String(text).split('\t').forEach(function (part, i) {
      if (i) out += '<w:r>' + rpr + '<w:tab/></w:r>';
      if (part) out += '<w:r>' + rpr + '<w:t xml:space="preserve">' + esc(part) + '</w:t></w:r>';
    });
    return out;
  }

  /* ---------- pick the exemplar for a role ---------- */
  var FALL = { title2: ['title'], office: ['request', 'body'], request: ['body'], party: ['body'], quote: ['body'], cite: ['quote', 'body'],
    agreement: ['body'], clause: ['body'], basmala: ['ornament', 'body'], witnesses: ['signature', 'heading', 'body'], signature: ['heading', 'body'],
    closing: ['body'], heading: ['title2', 'title', 'body'], date: ['body'], title: ['heading', 'body'], body: ['party', 'request'], lead: ['body'] };
  function sim(a, b) {
    if (!a || !b) return 0; if (a === b) return 1;
    var m = a.length, n = b.length, d = []; for (var i = 0; i <= m; i++) { d[i] = [i]; } for (var j = 1; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return 1 - d[m][n] / Math.max(m, n);
  }
  function exemplar(T, role, text) {
    var list = T.roles[role];
    if (list && list.length) {
      if (list.length > 1 && text) {
        var n = norm(text).replace(/[،,.:؛\s]+$/, ''), best = list[0], bs = 0;
        list.forEach(function (f) { var s = sim((f.key || '').replace(/[،,.:؛\s]+$/, ''), n); if (s > bs) { bs = s; best = f; } });
        return bs >= 0.6 ? best : list[0];
      }
      return list[0];
    }
    var chain = FALL[role] || ['body'];
    for (var i = 0; i < chain.length; i++) if (T.roles[chain[i]] && T.roles[chain[i]].length) return T.roles[chain[i]][0];
    var any = Object.keys(T.roles)[0]; return T.roles[any][0];
  }

  function paraXml(T, role, b) {
    var text = b.runs.map(function (r) { return r.text; }).join(''), ex = exemplar(T, role, text);
    var rN = ex.rN || ex.rR || ex.rP || '<w:rPr/>', rB = ex.rB || rN, runs = '';
    if (role === 'clause' && ex.rP) {
      /* «أولاً :» keeps the original's prefix look, the rest the clause body look */
      var cut = text.search(/[:\-]/) + 1, pos = 0, body = ex.rR && ex.rR !== ex.rP ? ex.rR : rN;
      b.runs.forEach(function (r) {
        var s = r.text, a = Math.max(0, Math.min(s.length, cut - pos)); pos += s.length;
        if (a) runs += runXml(s.slice(0, a), ex.rP, { u: r.u, hl: r.hl });
        if (s.length > a) runs += runXml(s.slice(a), r.b ? rB : body, r);
      });
    } else {
      b.runs.forEach(function (r) { runs += runXml(r.text, r.b ? rB : rN, r); });
    }
    return { pPr: airy(ex.pPr || '<w:pPr/>'), runs: runs };
  }
  /* the office types its running text at 0.8 line spacing in Simplified Arabic, whose glyphs are short; on any
     machine without that font (phones, most PCs) the lines overlap. Single spacing is the floor. */
  var LINE_FLOOR = 240;
  function airy(ppr) {
    return String(ppr || '').replace(/<w:spacing([^>]*)w:line="(\d+)"([^>]*)\/>/, function (m, a, v, b) {
      if (/w:lineRule="(exact|atLeast)"/.test(a + b) || +v >= LINE_FLOOR) return m;
      return '<w:spacing' + a + 'w:line="' + LINE_FLOOR + '"' + b + '/>';
    });
  }

  function tableXml(T, rows) {
    var t = T.table, cols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
    var grid = t.grid.length === cols ? t.grid.slice() : (function () { var tot = t.grid.reduce(function (a, b) { return a + b; }, 0) || 9600, w = Math.floor(tot / cols), g = []; for (var i = 0; i < cols; i++) g.push(w); return g; })();
    function cell(fmt, runs, w, span) {
      var tcpr = String(fmt.tcPr || '<w:tcPr/>').replace(/<w:tcW [^>]*\/>/, '').replace(/<w:gridSpan [^>]*\/>/, '');
      tcpr = tcpr.replace(/^<w:tcPr\s*\/>$/, '<w:tcPr></w:tcPr>').replace(/^<w:tcPr>/, '<w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : ''));
      var rN = fmt.rN || fmt.rR || '<w:rPr/>', rB = fmt.rB || rN;
      return '<w:tc>' + tcpr + '<w:p>' + (fmt.pPr || '<w:pPr/>') + runs.map(function (r) { return runXml(r.text, r.b ? rB : rN, r); }).join('') + '</w:p></w:tc>';
    }
    var trs = rows.map(function (r, i) {
      var rf = (i === 0 ? t.head : t.row) || t.row || t.head;
      return '<w:tr>' + (rf.trPr || '') + r.map(function (c, j) {
        var span = j === r.length - 1 ? cols - r.length + 1 : 1, w = 0; for (var k = j; k < j + span; k++) w += grid[k] || 0;
        return cell(rf.cells[Math.min(j, rf.cells.length - 1)] || {}, c, w, span);
      }).join('') + '</w:tr>';
    }).join('');
    return '<w:tbl>' + t.tblPr + '<w:tblGrid>' + grid.map(function (g) { return '<w:gridCol w:w="' + g + '"/>'; }).join('') + '</w:tblGrid>' + trs + '</w:tbl>';
  }

  /* ---------- assemble ---------- */
  function plan(T, blocks) {
    var st = { title: false, sinceTitle: 99, body: false }, out = [];
    blocks.forEach(function (b) {
      var role = roleOf(b, st);
      if (role === 'ornament' || role === 'blank') return;               // the template's own ornament is used
      if (role === 'title') { st.title = true; st.sinceTitle = 0; } else if (st.title) st.sinceTitle++;
      if (/^(date|request|body|party|clause)$/.test(role)) st.body = true;
      out.push({ role: role, b: b });
    });
    return out;
  }
  /* «ومحله / ومحلها / ومحلهما / ومحلهم المختار» tells who the client is: الطالب / الطالبة / الطالبان / الطالبين */
  function client(blocks) {
    var t = norm(blocks.map(function (b) { return b.runs ? b.runs.map(function (r) { return r.text; }).join('') : ''; }).join('\n'));
    var m = t.match(/ومحل(هما|هم|ها|ه)? ?المختار/), k = m ? (m[1] || 'ه') : 'ه';
    return { 'ه': { who: 'الطالب', resp: 'مسئوليته' }, 'ها': { who: 'الطالبة', resp: 'مسئوليتها' }, 'هما': { who: 'الطالبان', resp: 'مسئوليتهما' }, 'هم': { who: 'الطالبين', resp: 'مسئوليتهم' } }[k];
  }
  /* the client's name, for the file name the office uses («صحة توقيع سمير رزق», «إعادة إعلان نجوى لطفى»):
     the person on whose request the paper is made, else the first party of a contract, else the first «السيد / …» */
  var TITLES = '(?:(?:السيد|السيدة|الأستاذ|الأستاذة|الدكتور|الدكتورة|الحاج|الحاجة|الشيخ|المهندس|المهندسة|ورثة|الورثة|المرحوم|المرحومة)\\s*\\/?\\s*)*';
  var STOP = '(?=\\s+(?:بصفت|والمقيم|المقيم|ومحل|بالغ|وشهرت|المولود|ويمثل|الموطن|وجنسيت|ومهنت|ويعلن|رقم قومي|بطاقة|ت\\.?ق|-|–|—|،|,|\\(|\\)|\\/)|\\s*[\\n،,.:;()\\/]|\\s*$)';
  var PARTY = [
    new RegExp('بناء\\s+عل[ىي]\\s+طلب\\s+' + TITLES + '\\s*\\/?\\s*([^\\n\\/،,()]{3,60}?)' + STOP),
    new RegExp('(?:الطرف\\s+الأول|طرف\\s+أول|البائع|الواهب|المقر|المنذر|المقدم\\s+من|مقدمة?\\s+من|مقدم\\s+من|المدعي|الطالب|المعلن)\\s*[:\\/]?\\s*' + TITLES + '\\s*\\/?\\s*([^\\n\\/،,()]{3,60}?)' + STOP),
    new RegExp('(?:السيد|السيدة)\\s*\\/\\s*([^\\n\\/،,()]{3,60}?)' + STOP)
  ];
  function partyName(text) {
    var t = String(text || '').replace(/[⟦⟧*_]/g, '').replace(/^\s*\[[A-Z]+\]\s*/gm, '').replace(/[ \t]+/g, ' ');
    for (var i = 0; i < PARTY.length; i++) {
      var m = t.match(PARTY[i]); if (!m) continue;
      var name = m[1].replace(/\s+/g, ' ').trim().replace(/[\-–—:،,.؛]+$/, '').trim();
      var w = name.split(' ').filter(function (x) { return !/^(?:و|ال)$/.test(x); }); if (w.length > 4) w = w.slice(0, 4);
      if (w.length && /[؀-ۿ]/.test(w[0])) return w.join(' ');
    }
    return '';
  }
  function subjectOf(items) {
    var t = items.filter(function (x) { return x.role === 'title' || x.role === 'title2'; }).slice(0, 2)
      .map(function (x) { return x.b.runs.map(function (r) { return r.text; }).join('').replace(/\s+/g, ' ').trim(); });
    return t.join(' ');
  }

  async function build(JSZip, blocks, key, opts) {
    opts = opts || {};
    var S = await spec(), T = S[key]; if (!T) throw { code: 'template' };
    var items = plan(T, blocks), paras = [];
    var lead = T.order[0] === 'ornament' || T.order[0] === 'lead' ? T.order[0] : null;
    if (lead) { var oex = T.roles[lead][0]; paras.push({ role: lead, pPr: oex.pPr, runs: lead === 'ornament' ? runXml(' ', oex.rN || oex.rB || oex.rP, {}) : '' }); }
    var blankBeforeDate = T.order.indexOf('date') > 0 && T.order[T.order.indexOf('date') - 1] === 'blank';
    items.forEach(function (it) {
      if (it.role === 'table') {
        paras.push({ role: 'table', xml: T.table ? tableXml(T, it.b.table) : (typeof DocxBuilder !== 'undefined' ? DocxBuilder.tableXml(it.b.table, true) : '') });
        return;
      }
      if (it.role === 'date' && blankBeforeDate && !paras.some(function (p) { return p.role === 'date'; })) paras.push({ role: 'blank', pPr: T.blank, runs: '' });
      if (it.role === 'witnesses') for (var i = 0; i < (T.blankBeforeWitnesses || 0); i++) paras.push({ role: 'blank', pPr: T.blank, runs: '' });
      var p = paraXml(T, it.role, it.b); p.role = it.role; paras.push(p);
    });
    if (!paras.length) paras.push({ role: 'body', pPr: '<w:pPr/>', runs: '' });
    /* shapes hang from the same line number as in the original (their offsets are measured from that line) */
    placedAnchors(T).forEach(function (a) {
      var i = Math.min(a.at, paras.length - 1);
      while (i > 0 && paras[i].xml) i--;
      if (paras[i].xml) { paras.unshift({ role: 'lead', pPr: T.blank, runs: '' }); i = 0; }
      paras[i].anchors = (paras[i].anchors || '') + wrapStamp(a.xml);
    });
    var L = opts.lawyer || {}, title = L.title || 'المحامي', c = client(blocks);
    var fill = {
      '{{BYREQ}}': 'كطلب ' + c.who + ' وتحت ' + c.resp, '{{AGENTOF}}': 'وكيل ' + c.who, '{{CLIENT}}': c.who,
      '{{LAWYER}}': L.name || '', '{{LAWYER_TITLE}}': title.replace('المحامي', 'المحــامي') + (L.nakd ? ' بالنقض' : ''),
      '{{AGENT}}': title, '{{SUBJECT}}': opts.subject || subjectOf(items)
    };
    var body = paras.map(function (p) {
      if (p.xml) return p.xml;
      var anchors = (p.anchors || '').replace(/\{\{(LAWYER|LAWYER_TITLE|AGENT|SUBJECT|BYREQ|AGENTOF|CLIENT)\}\}/g, function (m) { return esc(fill[m]); });
      return '<w:p>' + p.pPr + anchors + p.runs + '</w:p>';
    }).join('');
    var zip = await JSZip.loadAsync(await skeleton(key));
    var doc = await zip.file('word/document.xml').async('string');
    if (doc.indexOf('<!--KATEB-BODY-->') < 0) throw { code: 'template' };
    zip.file('word/document.xml', doc.replace('<!--KATEB-BODY-->', body));
    return zip;
  }

  /* the stamp box sits in the left margin but reaches into the text column; in the office files it floats over
     the text (wrapNone). Here the first lines flow beside it instead (wrapSquare), so nothing is covered. */
  function intrusion(xml) {
    var ph = /<wp:positionH relativeFrom="column">\s*<wp:posOffset>(-?\d+)</.exec(xml), ex = /<wp:extent cx="(\d+)"/.exec(xml);
    return ph && ex ? +ph[1] + +ex[1] : 0;
  }
  function wrapStamp(xml) {
    if (xml.indexOf('{{LAWYER}}') < 0 || intrusion(xml) <= 0) return xml;
    return xml.replace(/<wp:wrapNone\/>/g, '<wp:wrapSquare wrapText="bothSides"/>').replace(/allowOverlap="1"/g, 'allowOverlap="0"');
  }
  /* the side box and the vertical rule hang from a text paragraph in the office files; with a short first text they
     would ride up into the stamp. When the stamp sits on the first line, they take a fixed place on the page instead:
     just under the stamp, where the office puts them. */
  function placedAnchors(T) {
    var pg = T.page || {}, out = (T.anchors || []).map(function (a) { return { role: a.role, at: a.at, xml: a.xml }; });
    var st = out.filter(function (a) { return a.xml.indexOf('{{LAWYER}}') >= 0 && a.at === 0; })[0];
    if (!st) return out;
    var pv = /<wp:positionV relativeFrom="paragraph">\s*<wp:posOffset>(-?\d+)</.exec(st.xml), cy = /<wp:extent cx="\d+" cy="(\d+)"/.exec(st.xml);
    if (!pv || !cy) return out;
    var bottom = (pg.top || 0) * 635 + +pv[1] + +cy[1] + 90000;         // page top → stamp bottom + a small gap (EMU)
    out.forEach(function (a) {
      if (a === st || !/relativeFrom="paragraph"/.test(a.xml)) return;
      a.xml = a.xml.replace(/<wp:positionV relativeFrom="paragraph">\s*<wp:posOffset>-?\d+<\/wp:posOffset>/, '<wp:positionV relativeFrom="page"><wp:posOffset>' + bottom + '</wp:posOffset>');
      a.at = 0; a.pageRel = true;
    });
    return out;
  }
  function hasStamp(T) { return (T.anchors || []).some(function (a) { return a.xml.indexOf('{{LAWYER}}') >= 0; }); }
  function hasSide(T) { return (T.anchors || []).some(function (a) { return a.xml.indexOf('{{SUBJECT}}') >= 0; }); }
  async function labels() { var S = await spec(); return Object.keys(S).map(function (k) { return { key: k, label: S[k].label, stamp: hasStamp(S[k]) }; }); }

  /* ---------- PDF: the same plan rendered as HTML with the original's fonts, sizes and spacing ---------- */
  function attr(xml, tag, a) { var m = String(xml || '').match(new RegExp('<w:' + tag + '\\b[^>]*\\bw:' + a + '="([^"]*)"')); return m ? m[1] : null; }
  function has(xml, tag) { var m = String(xml || '').match(new RegExp('<w:' + tag + '(\\s[^>]*)?/>')); return !!m && !/w:val="(0|false)"/.test(m[0]); }
  var FONT_OK = {};
  function fontOk(f) {
    if (!f) return false; if (f in FONT_OK) return FONT_OK[f];
    try {
      var c = document.createElement('canvas').getContext('2d'), probe = 'هههابجد mmmmWWW', w = function (fam) { c.font = '40px ' + fam; return c.measureText(probe).width; };
      FONT_OK[f] = w('"' + f + '", monospace') !== w('monospace') || w('"' + f + '", serif') !== w('serif');
    } catch (e) { FONT_OK[f] = false; }
    return FONT_OK[f];
  }
  function pCss(ppr) {
    var jc = attr(ppr, 'jc', 'val'), css = '';
    css += 'text-align:' + ({ center: 'center', both: 'justify', lowKashida: 'justify', mediumKashida: 'justify', highKashida: 'justify', distribute: 'justify', end: 'left', left: 'left' }[jc] || 'right') + ';';
    var line = +attr(ppr, 'spacing', 'line') || 0, rule = attr(ppr, 'spacing', 'lineRule');
    if (line && (!rule || rule === 'auto')) css += 'line-height:' + (Math.max(line, LINE_FLOOR) / 240 * 1.45).toFixed(2) + ';';
    var bf = +attr(ppr, 'spacing', 'before') || 0, af = +attr(ppr, 'spacing', 'after') || 0;
    css += 'margin:' + (bf / 20) + 'pt 0 ' + (af / 20) + 'pt 0;';
    var st = +(attr(ppr, 'ind', 'start') || attr(ppr, 'ind', 'right') || 0), fl = +attr(ppr, 'ind', 'firstLine') || 0, hg = +attr(ppr, 'ind', 'hanging') || 0;
    if (st) css += 'padding-right:' + (st / 20) + 'pt;';
    if (fl || hg) css += 'text-indent:' + ((fl - hg) / 20) + 'pt;';
    return css;
  }
  function rCss(rpr, r) {
    var f = attr(rpr, 'rFonts', 'cs') || attr(rpr, 'rFonts', 'ascii'), sz = +attr(rpr, 'szCs', 'val') || +attr(rpr, 'sz', 'val') || 28;
    var css = 'font-family:' + (f ? '"' + f + '",' : '') + '"Simplified Arabic","Noto Naskh Arabic","Amiri","Times New Roman",serif;font-size:' + (sz / 2) + 'pt;';
    if (has(rpr, 'b') || has(rpr, 'bCs') || r.b) css += 'font-weight:700;';
    var u = attr(rpr, 'u', 'val') || (r.u ? 'single' : null);
    if (u && u !== 'none') css += 'text-decoration:underline;' + (u === 'double' ? 'text-decoration-style:double;' : '');
    var col = attr(rpr, 'color', 'val'); if (col && col !== 'auto') css += 'color:#' + col + ';';
    if (r.hl) css += 'background:#ffe066;';
    return css;
  }
  function escH(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  /* PDF shows ٠-٩ like the office's Word display (Numeral: Context); the Word file itself keeps 0-9 */
  function rtlDates(t) { return String(t).replace(/([0-9٠-٩]{1,4})\/([0-9٠-٩]{1,4})(\/([0-9٠-٩]{1,4}))?/g, function (m, a, b, c, d) { return a + '\u200F/\u200F' + b + (d ? '\u200F/\u200F' + d : ''); }); }   // dates read from the right, like Word shows them
  function spanHtml(text, rpr, r) { return '<span style="' + rCss(rpr, r) + '">' + escH(rtlDates(String(text).replace(/[0-9]/g, function (c) { return '٠١٢٣٤٥٦٧٨٩'[+c]; }))).replace(/\t/g, '<span style="display:inline-block;width:3em"></span>') + '</span>'; }

  /* a Word shape (stamp box, rule, text box) → absolutely positioned HTML with the same geometry */
  function cm(emu) { return (emu / 360000).toFixed(3) + 'cm'; }
  function shapeHtml(xml, fill, page) {
    var out = '', choice = (xml.split('<mc:Fallback>')[0]);
    var re = /<wp:anchor[\s\S]*?<\/wp:anchor>/g, m;
    while ((m = re.exec(choice))) {
      var a = m[0], ext = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(a), w = ext ? +ext[1] : 0, h = ext ? +ext[2] : 0;
      var ph = /<wp:positionH relativeFrom="(\w+)">\s*<wp:(posOffset|align)>([^<]+)</.exec(a), pv = /<wp:positionV relativeFrom="(\w+)">\s*<wp:(posOffset|align)>([^<]+)</.exec(a);
      var x = ph && ph[2] === 'posOffset' ? +ph[3] : 0, y = pv && pv[2] === 'posOffset' ? +pv[3] : 0;
      if (ph && ph[1] === 'page') x -= (page.left || 0) * 635;                 // twips → EMU
      if (pv && (pv[1] === 'page' || pv[1] === 'margin')) y -= (page.top || 0) * 635;
      var prst = (/prst="(\w+)"/.exec(a) || [])[1] || 'rect', ln = /<a:ln\b([^>]*)>([\s\S]*?)<\/a:ln>/.exec(a);
      var lw = ln && /\bw="(\d+)"/.test(ln[1]) ? +/\bw="(\d+)"/.exec(ln[1])[1] / 12700 : (ln && /<a:noFill\/>/.test(ln[2]) ? 0 : 0.75);
      var dbl = ln && /cmpd="dbl"/.test(ln[1]);
      var stamp = /\{\{LAWYER\}\}/.test(xml) && ph && ph[1] === 'column' && x + w > 0;
      var css = stamp ? 'float:left;box-sizing:border-box;z-index:2;margin:' + cm(Math.max(y, 0)) + ' 0.25cm 0.2cm ' + cm(x) + ';'
                      : 'position:absolute;box-sizing:border-box;z-index:2;left:' + cm(x) + ';top:' + cm(y) + ';';
      if (prst === 'line' || prst === 'straightConnector1') {
        css += 'width:0;height:' + cm(h) + ';border-left:' + lw + 'pt solid #000;';
        out += '<span class="oshape" style="display:block;' + css + '"></span>'; continue;
      }
      css += 'width:' + cm(w) + ';height:' + cm(h) + ';padding:0.13cm 0.25cm;overflow:hidden;';
      css += 'background:' + (/<a:blipFill/.test(a) ? '#f3f3f3' : '#fff') + ';';
      if (lw) css += 'border:' + Math.max(lw, dbl ? 3 : 0.75) + 'pt ' + (dbl ? 'double' : 'solid') + ' #000;';
      if (prst === 'flowChartAlternateProcess' || prst === 'roundRect') css += 'border-radius:0.45cm;';
      var tb = /<w:txbxContent>([\s\S]*?)<\/w:txbxContent>/.exec(a), inner = '';
      if (tb) {
        var pre = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, pm;
        while ((pm = pre.exec(tb[1]))) {
          var pp = pm[0], ppr = (/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(pp) || [''])[0], runs = '', rr = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g, rm;
          while ((rm = rr.exec(pp))) {
            var rpr = (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(rm[1]) || [''])[0], t = (rm[1].match(/<w:t\b[^>]*>([^<]*)<\/w:t>/g) || []).map(function (x) { return x.replace(/<[^>]+>/g, ''); }).join('');
            if (t) runs += spanHtml(fill(t), rpr, {});
          }
          inner += '<span style="display:block;' + pCss(ppr) + 'margin:0;min-height:0.6em;line-height:1.2">' + (runs || '&nbsp;') + '</span>';
        }
      }
      out += '<span class="oshape' + (stamp ? ' ostamp' : '') + '" style="display:block;' + css + '">' + inner + '</span>';
    }
    return out;
  }

  async function printHtml(blocks, key, opts) {
    opts = opts || {};
    var S = await spec(), T = S[key]; if (!T) throw { code: 'template' };
    var items = plan(T, blocks), paras = [], L = opts.lawyer || {}, title = L.title || 'المحامي', c = client(blocks);
    var lead = T.order[0] === 'ornament' || T.order[0] === 'lead' ? T.order[0] : null;
    if (lead) { var oex = T.roles[lead][0], showOrn = lead === 'ornament' && fontOk(attr(oex.rN || oex.rB || oex.rP, 'rFonts', 'cs'));
      paras.push({ role: lead, html: '<p style="' + pCss(oex.pPr) + '">' + (showOrn ? spanHtml(oex.text || '', oex.rN || oex.rB || oex.rP, {}) : '&nbsp;') + '</p>' }); }
    var blankBeforeDate = T.order.indexOf('date') > 0 && T.order[T.order.indexOf('date') - 1] === 'blank', dated = false;
    items.forEach(function (it) {
      var b = it.b;
      if (it.role === 'table') {
        paras.push({ role: 'table', html: '<table class="otbl"><tbody>' + b.table.map(function (row, i) {
          var rf = (i === 0 ? T.table && T.table.head : T.table && T.table.row) || {}, cols = Math.max.apply(null, b.table.map(function (x) { return x.length; }));
          return '<tr>' + row.map(function (cell, j) { var cf = (rf.cells || [])[Math.min(j, (rf.cells || []).length - 1)] || {}, sp = j === row.length - 1 ? cols - row.length + 1 : 1;
            return '<td' + (sp > 1 ? ' colspan="' + sp + '"' : '') + ' style="' + pCss(cf.pPr) + '">' + cell.map(function (r) { return spanHtml(r.text, r.b ? (cf.rB || cf.rN) : cf.rN, r); }).join('') + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>' });
        return;
      }
      if (it.role === 'date' && blankBeforeDate && !dated) { paras.push({ role: 'blank', html: '<p class="oblank"></p>' }); dated = true; }
      if (it.role === 'witnesses') for (var i = 0; i < (T.blankBeforeWitnesses || 0); i++) paras.push({ role: 'blank', html: '<p class="oblank"></p>' });
      var text = b.runs.map(function (r) { return r.text; }).join(''), ex = exemplar(T, it.role, text), rN = ex.rN || ex.rR || ex.rP, rB = ex.rB || rN, inner = '';
      if (it.role === 'clause' && ex.rP) {
        var cut = text.search(/[:\-]/) + 1, pos = 0, body = ex.rR && ex.rR !== ex.rP ? ex.rR : rN;
        b.runs.forEach(function (r) { var s = r.text, a = Math.max(0, Math.min(s.length, cut - pos)); pos += s.length;
          if (a) inner += spanHtml(s.slice(0, a), ex.rP, { hl: r.hl }); if (s.length > a) inner += spanHtml(s.slice(a), r.b ? rB : body, r); });
      } else b.runs.forEach(function (r) { inner += spanHtml(r.text, r.b ? rB : rN, r); });
      paras.push({ role: it.role, html: '<p style="' + pCss(ex.pPr) + '">' + inner + '</p>' });
    });
    if (!paras.length) paras.push({ role: 'body', html: '<p>&nbsp;</p>' });
    var fillMap = {
      '{{LAWYER}}': L.name || '', '{{LAWYER_TITLE}}': title.replace('المحامي', 'المحــامي') + (L.nakd ? ' بالنقض' : ''), '{{AGENT}}': title,
      '{{SUBJECT}}': opts.subject || subjectOf(items), '{{BYREQ}}': 'كطلب ' + c.who + ' وتحت ' + c.resp, '{{AGENTOF}}': 'وكيل ' + c.who, '{{CLIENT}}': c.who
    };
    var fill = function (t) { return t.replace(/\{\{(LAWYER|LAWYER_TITLE|AGENT|SUBJECT|BYREQ|AGENTOF|CLIENT)\}\}/g, function (m) { return fillMap[m]; }); };
    var pg = T.page || {};
    placedAnchors(T).forEach(function (a) {
      var i = Math.min(a.at, paras.length - 1); while (i > 0 && paras[i].role === 'table') i--;
      var sh = shapeHtml(a.xml, fill, pg); if (!sh) return;
      paras[i].html = paras[i].html.replace(/^<p( style=")?/, function (m, q) { return q ? '<p style="position:relative;' : '<p style="position:relative"'; });
      if (/ostamp/.test(sh)) paras[i].html = paras[i].html.replace(/^(<p[^>]*>)/, '$1' + sh); else paras[i].html = paras[i].html.replace(/<\/p>$/, sh + '</p>');
    });
    var tw = function (t) { return (t / 567).toFixed(2) + 'cm'; };
    /* Chrome clips whatever crosses into the page margin, so the side margins become padding: the stamp and
       the side box sit inside the printable area, exactly where the original puts them */
    var edge = 284, pr = Math.max((pg.right || 1134) - edge, 0), pl = Math.max((pg.left || 1134) - edge, 0);
    var page = '@page{size:A4;margin:' + tw(Math.max(pg.top || 0, 280)) + ' ' + tw(edge) + ' ' + tw(Math.max(pg.bottom || 0, 400)) + ' ' + tw(edge) + '}' +
      '#printRoot.office{padding:0 ' + tw(pr) + ' 0 ' + tw(pl) + '}';
    return { html: paras.map(function (p) { return p.html; }).join(''), pageCss: page };
  }

  return { spec: spec, labels: labels, detect: detect, lawyerFrom: lawyerFrom, partyName: partyName, build: build, printHtml: printHtml, roleOf: roleOf, norm: norm, _plan: plan, _rprSet: rprSet };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Office;
