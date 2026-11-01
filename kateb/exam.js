/* Math exam Word builder (Word 2007/2010 compatible) in Ms. Hanan's layout.
   blocks: {k:'q'|'item'|'p'|'opt'|'table'|'gap'|'fig', ...}
   runs:   {text, b, u, hl, frac:[num, den], math: 'LaTeX'} */
var ExamBuilder = (function () {
  var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  var BODY_FONT = 'Times New Roman';
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  var AR = /[؀-ۿ]/;

  function rpr(o) {
    o = o || {};
    var f = o.font || BODY_FONT;
    return '<w:rPr><w:rFonts w:ascii="' + f + '" w:hAnsi="' + f + '" w:cs="' + (o.cs || 'Times New Roman') + '"/>' +
      (o.b ? '<w:b/><w:bCs/>' : '') + (o.i ? '<w:i/><w:iCs/>' : '') +
      (o.sz ? '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>' : '') +
      (o.hl ? '<w:highlight w:val="yellow"/>' : '') + (o.u ? '<w:u w:val="single"/>' : '') +
      (o.rtl ? '<w:rtl/>' : '') + '</w:rPr>';
  }
  function textRuns(text, o) {
    var out = '';
    String(text).split('\t').forEach(function (part, i) {
      if (i) out += '<w:r>' + rpr(o) + '<w:tab/></w:r>';
      if (part) out += '<w:r>' + rpr(Object.assign({}, o, { rtl: AR.test(part) })) + '<w:t xml:space="preserve">' + esc(part) + '</w:t></w:r>';
    });
    return out;
  }
  function mrpr(o) {
    return '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>' + (o && o.sz ? '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>' : '') + (o && o.hl ? '<w:highlight w:val="yellow"/>' : '') + '</w:rPr>';
  }
  function mrun(t, o) {
    return '<m:r>' + mrpr(o) + '<m:t xml:space="preserve">' + esc(t) + '</m:t></m:r>';
  }
  /* v50 any mathematics written as LaTeX \( … \): Temml (LaTeX → MathML, MIT) then mathml2omml (MathML → Word's own
     equation format, LGPL) — square roots, powers, segment/ray/line bars, angles, recurring decimals become real Word equations */
  function libs() { var g = typeof globalThis !== 'undefined' ? globalThis : window; return g.temml && g.MML2OMML ? { T: g.temml, M: g.MML2OMML } : null; }
  function texPlain(t) {
    return String(t).replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2').replace(/\\sqrt\[(\d+)\]\{([^{}]*)\}/g, '$1√$2').replace(/\\sqrt\{([^{}]*)\}/g, '√$1')
      .replace(/\^\{?\\circ\}?/g, '°').replace(/\\(overline|overrightarrow|overleftrightarrow)\{([^{}]*)\}/g, '$2').replace(/\\angle\s*/g, '∠').replace(/\\times/g, '×').replace(/\\div/g, '÷')
      .replace(/\\left|\\right/g, '').replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  }
  function mathXml(tex, o) {
    var L = libs();
    if (L) {
      try {
        var x = L.M.mml2omml(L.T.renderToString(tex, { xml: true, throwOnError: true }));
        x = x.replace(/<m:oMath\b[^>]*>/, '<m:oMath>')
          .replace(/<m:chr m:val="([^"]*)" m:pos="(top|bot)"\/>/g, '<m:chr m:val="$1"/><m:pos m:val="$2"/><m:vertJc m:val="$2"/>')       // the library writes pos as an attribute: Word wants an element
          .replace(/(<m:t[^>]*>)([^<]*)/g, function (a, t, v) { return t + v.replace(/\|/g, '∣'); })                   // |−5|: the bar sign every Word and LibreOffice draws
          .replace(/<m:borderBox><m:borderBoxPr><m:hideBot m:val="on"\/><m:hideLeft m:val="on"\/><m:hideRight m:val="on"\/><\/m:borderBoxPr>([\s\S]*?)<\/m:borderBox>/g, function (a, e) { return '<m:bar><m:barPr><m:pos m:val="top"/></m:barPr>' + e + '</m:bar>'; })
          /* v52: every run rebuilt in schema order (m:rPr, then w:rPr, then m:t); the library's own <w:rPr/> and its
             <m:sty m:val="undefined"/> (from \mathrm{m}) made Word complain about unreadable content */
          .replace(/<m:r>([\s\S]*?)<\/m:r>/g, function (all, inner) {
            var mp = (inner.match(/<m:rPr>[\s\S]*?<\/m:rPr>/) || [''])[0].replace(/<m:sty m:val="undefined"\/>/g, '').replace(/<m:rPr><\/m:rPr>/, '');
            var rest = inner.replace(/<m:rPr>[\s\S]*?<\/m:rPr>/g, '').replace(/<w:rPr\/>|<w:rPr>[\s\S]*?<\/w:rPr>/g, '');
            return '<m:r>' + mp + mrpr(o) + rest + '</m:r>';
          });
        var nested = /<m:t[^>]*>[^<]*<(?!\/m:t>)/.test(x);                     // an element inside m:t (\stackrel): Word rejects it
        if (!nested && /^<m:oMath>[\s\S]*<\/m:oMath>$/.test(x)) return x;
      } catch (e) {}
    }
    return textRuns(texPlain(tex), Object.assign({}, o, { hl: true }));          // v52: a formula Word cannot get is shown yellow, never silently flattened
  }
  function runsXml(runs, base) {
    return (runs || []).map(function (r) {
      var o = Object.assign({}, base || {}, { b: r.b || (base && base.b), u: r.u || (base && base.u), hl: r.hl });
      if (r.math) return mathXml(r.math, o);
      if (r.frac) return '<m:oMath><m:f><m:num>' + mrun(r.frac[0], o) + '</m:num><m:den>' + mrun(r.frac[1], o) + '</m:den></m:f></m:oMath>';
      return textRuns(r.text, o);
    }).join('');
  }
  function para(inner, ppr) { return '<w:p><w:pPr>' + (ppr || '') + '</w:pPr>' + inner + '</w:p>'; }
  function spacing(before, after, line) { return '<w:spacing w:before="' + (before || 0) + '" w:after="' + (after || 0) + '" w:line="' + (line || 276) + '" w:lineRule="auto"/>'; }

  var NOB = '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';

  function headerTable(h) {
    var L = [h.line1, h.line2, h.line3], R = h.right || ['Subject: ' + (h.subject || ''), 'Grade: ' + (h.grade || ''), 'Time: ' + (h.time || '')];
    var rows = '';
    for (var i = 0; i < 3; i++) {
      var szL = i === 2 && (L[i] || '').length > 48 ? 16 : 20;
      rows += '<w:tr>' +
        '<w:tc><w:tcPr><w:tcW w:w="6200" w:type="dxa"/></w:tcPr>' + para(textRuns(L[i] || '', { font: 'Arial', b: true, sz: szL }), spacing(20, 20, 240)) + '</w:tc>' +
        '<w:tc><w:tcPr><w:tcW w:w="3438" w:type="dxa"/></w:tcPr>' + para(textRuns(R[i], { font: 'Arial', b: true, sz: 20 }), spacing(20, 20, 240)) + '</w:tc></w:tr>';
    }
    return '<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="000000"/>' +
      '<w:left w:val="nil"/><w:bottom w:val="single" w:sz="8" w:space="0" w:color="000000"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>' +
      '<w:tblLayout w:type="fixed"/><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid><w:gridCol w:w="6200"/><w:gridCol w:w="3438"/></w:tblGrid>' + rows + '</w:tbl>';
  }

  function optXml(cells) {
    var n = cells.length, per = n > 4 ? n : 4;
    var tabs = '<w:tabs>';
    for (var i = 1; i < per; i++) tabs += '<w:tab w:val="left" w:pos="' + Math.round(9400 * i / per) + '"/>';
    tabs += '</w:tabs>';
    var inner = cells.map(function (c, i) { return (i ? '<w:r>' + rpr({ sz: 32 }) + '<w:tab/></w:r>' : '') + runsXml(c, { sz: 32 }); }).join('');
    return para(inner, '<w:keepLines/>' + tabs + spacing(40, 120) + '<w:ind w:left="284"/>');
  }

  function tableXml(rows) {
    var cols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
    var W = Math.min(6000, 1600 * cols), cw = Math.floor(W / cols), grid = '';
    for (var i = 0; i < cols; i++) grid += '<w:gridCol w:w="' + cw + '"/>';
    var trs = rows.map(function (r) {
      return '<w:tr>' + r.map(function (cell, j) {
        var span = (j === r.length - 1) ? cols - r.length + 1 : 1;
        return '<w:tc><w:tcPr><w:tcW w:w="' + (cw * span) + '" w:type="dxa"/>' + (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '') + '</w:tcPr>' +
          para(runsXml(cell), spacing(60, 60, 240) + '<w:jc w:val="center"/>') + '</w:tc>';
      }).join('') + '</w:tr>';
    }).join('');
    var b = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (e) { return '<w:' + e + ' w:val="single" w:sz="6" w:space="0" w:color="000000"/>'; }).join('') + '</w:tblBorders>';
    return '<w:tbl><w:tblPr><w:tblW w:w="' + (cw * cols) + '" w:type="dxa"/><w:jc w:val="right"/>' + b + '<w:tblLayout w:type="fixed"/><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>' + trs + '</w:tbl>' +
      para('', spacing(0, 60));
  }

  function figXml(f, id, rid) {
    var maxW = 7.5 * 360000, maxH = 6 * 360000, px = 9525 * 1.4;
    var k = Math.min(1, maxW / (f.w * px), maxH / (f.h * px));
    var cx = Math.round(f.w * px * k), cy = Math.round(f.h * px * k);
    var d = '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + id + '" name="Figure ' + id + '"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="figure' + id + '.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    return para(d, spacing(0, 80) + '<w:jc w:val="right"/>');
  }

  function b64ToBytes(b64) {
    if (typeof atob === 'function') { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
    return Buffer.from(b64, 'base64');
  }

  function build(JSZip, blocks, header, opts) {
    opts = opts || {};
    var zip = new JSZip(), media = [], body = '';
    if (header) {
      if (!header.noTable) body += headerTable(header);
      /* v29: sizes as in Hanan's own files — title 20 pt Arial Black, «Question (n)» 18 pt bold, items 16 pt bold, choices 16 pt */
      if (header.title) body += para(textRuns(header.title, { font: 'Arial Black', b: true, u: true, sz: 40 }), spacing(header.noTable ? 0 : 160, 160, 240) + '<w:jc w:val="center"/>');
    }
    var qn = 0;
    blocks.forEach(function (bl) {
      if (bl.k === 'q') {
        body += para(runsXml(bl.runs, { b: true, u: !!opts.underlineQ, sz: 36 }), '<w:keepNext/>' + spacing(200, 100));
      } else if (bl.k === 'item') {
        body += para(runsXml(bl.runs, { b: true, sz: 32 }), '<w:keepNext/>' + spacing(100, 40) + '<w:ind w:left="0"/>');
      } else if (bl.k === 'opt') {
        body += optXml(bl.cells.map(function (c) { return c.map(function (r) { return Object.assign({}, r); }); }));
      } else if (bl.k === 'table') {
        body += tableXml(bl.rows);
      } else if (bl.k === 'gap') {
        for (var g = 0; g < (bl.n || 3); g++) body += para('', spacing(0, 0));
      } else if (bl.k === 'fig' && bl.data) {
        var id = media.length + 1, rid = 'rIdImg' + id;
        media.push({ name: 'image' + id + '.png', data: b64ToBytes(bl.data.split(',')[1]), rid: rid });
        body += figXml(bl, id, rid);
      } else if (bl.k === 'p') {
        var jc = bl.align === 'C' ? 'center' : bl.align === 'R' ? 'right' : '';
        var rtl = AR.test((bl.runs || []).map(function (r) { return r.text || ''; }).join(''));
        body += para(runsXml(bl.runs, { b: bl.heading, sz: bl.heading ? 36 : 32 }), (rtl ? '<w:bidi/>' : '') + spacing(60, 60) + (jc ? '<w:jc w:val="' + jc + '"/>' : ''));
      }
    });
    var sect = '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="851" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + body + sect + '</w:body></w:document>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ' + NS + '><w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="28"/><w:szCs w:val="28"/>' +
      '<w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-EG"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/></w:style></w:styles>';
    var settings = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ' + NS + '><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/>' +
      '<w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="14"/></w:compat><m:mathPr><m:mathFont m:val="Cambria Math"/></m:mathPr></w:settings>';
    var footer = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' + NS + '><w:p><w:pPr><w:pStyle w:val="Footer"/>' +
      '<w:pBdr><w:top w:val="single" w:sz="4" w:space="1" w:color="D9D9D9"/></w:pBdr></w:pPr>' +
      '<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>' +
      '<w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve"> | </w:t></w:r><w:r><w:rPr><w:color w:val="7F7F7F"/><w:spacing w:val="60"/><w:sz w:val="22"/></w:rPr><w:t>Page</w:t></w:r></w:p></w:ftr>';
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
    var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
      '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
      media.map(function (m) { return '<Relationship Id="' + m.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + m.name + '"/>'; }).join('') +
      '</Relationships>';
    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc((header && header.title) || 'Exam') + '</dc:title><dc:creator>Mathematics</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>';
    zip.file('[Content_Types].xml', ct); zip.file('_rels/.rels', rels); zip.file('docProps/core.xml', core);
    zip.file('word/document.xml', doc); zip.file('word/styles.xml', styles); zip.file('word/settings.xml', settings);
    zip.file('word/footer1.xml', footer); zip.file('word/_rels/document.xml.rels', docRels);
    media.forEach(function (m) { zip.file('word/media/' + m.name, m.data); });
    return zip;
  }

  /* inline: **b** __u__ ⟦doubt⟧ {a/b} */
  function parseInline(line) {
    var runs = [], b = false, u = false, hl = false, buf = '';
    var re = /(\\\(([\s\S]+?)\\\)|_{3,}|\*\*|__|⟦|⟧|\{([^{}\/]{1,20})\/([^{}\/]{1,20})\})/g, last = 0, m;
    function push() { if (buf) runs.push({ text: buf, b: b, u: u, hl: hl }); buf = ''; }
    while ((m = re.exec(line))) {
      buf += line.slice(last, m.index); push();
      if (m[2] !== undefined) runs.push({ math: m[2].trim(), text: m[2].trim(), b: b, u: u, hl: hl });
      else if (/^_{3,}$/.test(m[1])) { buf = m[1]; push(); } else if (m[1] === '**') b = !b; else if (m[1] === '__') u = !u; else if (m[1] === '⟦') hl = true; else if (m[1] === '⟧') hl = false;
      else runs.push({ frac: [m[3].trim(), m[4].trim()], b: b, u: u, hl: hl, text: m[3].trim() + '/' + m[4].trim() });
      last = re.lastIndex;
    }
    buf += line.slice(last); push();
    return runs;
  }

  /* split a line on | or || but never inside \( … \) or ⟦ … ⟧ (|x| and ⟦a|b⟧ stay whole) */
  function splitTop(str, sep, loose) {
    var out = [], cur = '', depthM = 0, depthD = 0;
    /* v52: a bare |−5| (absolute value without \( \)) is not a separator: a single | splits only with a space on both
       sides; if that finds no separator at all, the old loose rule applies */
    if (sep === '|' && !loose) { var strict = splitTop(str, sep, 'strict'); return strict.length > 1 ? strict : splitTop(str, sep, true); }
    for (var i = 0; i < str.length; i++) {
      if (loose === 'strict' && str[i] === '|' && !depthM && !depthD && str[i + 1] !== '|' && str[i - 1] !== '|' && !(/\s/.test(str[i - 1] || ' ') && /\s/.test(str[i + 1] || ' '))) { cur += '|'; continue; }
      if (str.substr(i, 2) === '\\(') { depthM++; cur += '\\('; i++; continue; }
      if (str.substr(i, 2) === '\\)' && depthM) { depthM--; cur += '\\)'; i++; continue; }
      var ch = str[i];
      if (ch === '⟦') depthD++; else if (ch === '⟧' && depthD) depthD--;
      if (!depthM && !depthD && str.substr(i, sep.length) === sep && (sep === '||' || str[i + 1] !== '|')) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
      cur += ch;
    }
    out.push(cur); return out;
  }

  /* model output → {meta, blocks}. Figures keep their box for the page to crop. */
  function parseExam(text) {
    var meta = {}, blocks = [];
    /* v52: an SVG the model wrapped over several lines is joined back onto its [FIG] line */
    text = String(text || '').replace(/\r/g, '').replace(/(\[FIG[^\]]*\][^\n]*<svg[^\n]*?)(?![^\n]*<\/svg>)\n([\s\S]*?<\/svg>)/gi, function (a, head, rest) { return head + ' ' + rest.replace(/\n+/g, ' '); });
    text.split('\n').forEach(function (raw) {
      var line = raw.trim(); if (!line) return;
      var mm;
      if ((mm = line.match(/^GRADE:\s*(.+)$/i))) { meta.grade = mm[1].trim(); return; }
      if ((mm = line.match(/^TITLE:\s*(.+)$/i))) { meta.title = mm[1].trim(); return; }
      if ((mm = line.match(/^\[Q\]\s*(.*)$/))) { blocks.push({ k: 'q', runs: parseInline(mm[1]) }); return; }
      if ((mm = line.match(/^\[I\]\s*(.*)$/))) { blocks.push({ k: 'item', runs: parseInline(mm[1]) }); return; }
      if ((mm = line.match(/^\[OPT\]\s*(.*)$/))) { blocks.push({ k: 'opt', cells: splitTop(mm[1], '|').map(function (c) { return parseInline(c.trim()); }) }); return; }
      if ((mm = line.match(/^\[TABLE\]\s*(.*)$/))) { blocks.push({ k: 'table', rows: splitTop(mm[1], '||').map(function (r) { return splitTop(r, '|').map(function (c) { return parseInline(c.trim()); }); }) }); return; }
      if (/^\[GAP\]/.test(line)) { blocks.push({ k: 'gap', n: 3 }); return; }
      if ((mm = line.match(/^\[FIG[^\]]*\]\s*(.*)$/))) {
        var sv = (mm[1].match(/<svg[\s\S]*<\/svg>/i) || [])[0] || '';
        blocks.push({ k: 'fig', svg: sv, desc: sv ? 'figure' : mm[1] }); return;
      }
      var al = 'J', heading = false;
      if ((mm = line.match(/^\[(C|R|L|H)\]\s*/))) { al = mm[1]; line = line.slice(mm[0].length); if (al === 'H') { al = 'C'; heading = true; } }
      blocks.push({ k: 'p', align: al, heading: heading, runs: parseInline(line) });
    });
    return { meta: meta, blocks: blocks };
  }

  /* ---------- v53 the sheet back to the exam format, question groups, form B ---------- */
  function runsText(runs) {
    return (runs || []).map(function (r) {
      var t = r.math ? '\\(' + r.math + '\\)' : r.frac ? '{' + r.frac[0] + '/' + r.frac[1] + '}' : String(r.text || '');
      if (r.u) t = '__' + t + '__'; if (r.b) t = '**' + t + '**'; if (r.hl) t = '⟦' + t + '⟧';
      return t;
    }).join('').replace(/\*\*\*\*/g, '').replace(/\s+/g, ' ').trim();
  }
  function blocksToText(blocks) {
    return (blocks || []).map(function (b) {
      if (b.k === 'q') return '[Q] ' + runsText(b.runs);
      if (b.k === 'item') return '[I] ' + runsText(b.runs);
      if (b.k === 'opt') return '[OPT] ' + b.cells.map(runsText).join(' | ');
      if (b.k === 'table') return '[TABLE] ' + b.rows.map(function (r) { return r.map(runsText).join(' | '); }).join(' || ');
      if (b.k === 'gap') return '[GAP]';
      if (b.k === 'fig') return b.svg ? '[FIG] ' + b.svg : '[FIG] (a drawing)';
      var t = runsText(b.runs); return (b.heading ? '[H] ' : b.align === 'C' ? '[C] ' : '') + t;
    }).filter(function (l) { return l.trim(); }).join('\n');
  }
  /* sections → questions; a question = its [I] line + the options / table / drawing / gap under it */
  function groups(blocks) {
    var out = [], sec = null, q = null;
    (blocks || []).forEach(function (b) {
      if (b.k === 'q') { sec = { head: b, items: [], pre: [] }; out.push(sec); q = null; return; }
      if (!sec) { sec = { head: null, items: [], pre: [] }; out.push(sec); }
      if (b.k === 'item') { q = { blocks: [b] }; sec.items.push(q); return; }
      if (q && (b.k === 'opt' || b.k === 'table' || b.k === 'fig' || b.k === 'gap')) { q.blocks.push(b); return; }
      if (q) q.blocks.push(b); else sec.pre.push(b);
    });
    return out;
  }
  var NUM = /^\s*\(?\d+\s*[).\-]\s*/;
  function renumber(item, n) {
    var runs = (item.runs || []).map(function (r) { return Object.assign({}, r); });
    for (var i = 0; i < runs.length; i++) {
      if (runs[i].math || runs[i].frac) break;
      if (!String(runs[i].text || '').trim()) continue;
      if (NUM.test(runs[i].text)) { runs[i].text = runs[i].text.replace(NUM, ''); if (!runs[i].text.trim()) runs.splice(i, 1); }
      break;
    }
    runs.unshift({ text: ' ' }); runs.unshift({ text: n + ')', b: true });
    return Object.assign({}, item, { runs: runs });
  }
  var LET = /^\s*\(?[a-dA-Dأبجد]\s*[).\-]\s*/;
  function relabel(cells, letters) {
    return cells.map(function (c, k) {
      var runs = c.map(function (r) { return Object.assign({}, r); });
      for (var i = 0; i < runs.length; i++) { if (runs[i].math || runs[i].frac) break; if (!String(runs[i].text || '').trim()) continue; if (LET.test(runs[i].text)) { runs[i].text = runs[i].text.replace(LET, ''); if (!runs[i].text.trim()) runs.splice(i, 1); } break; }
      runs.unshift({ text: letters[k] + ') ' });
      return runs;
    });
  }
  function isKeyHead(b) { return /^(question\s*\(\d+\)\s*)?(answers?|answer key|the answers|model answers?|marking scheme|الإجابات|الاجابات|نموذج الإجابة)\b/i.test(runsText(b.runs).replace(/\*/g, '').trim()) || /^(الإجابات|الاجابات|نموذج الإجابة)/.test(runsText(b.runs).replace(/\*/g, '').trim()); }
  function shuffle(a, rnd) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  /* form B: the same questions in another order inside each section, the choices of each question in another order;
     an answer-key section is left out (it would not match) */
  function variant(blocks, rnd) {
    rnd = rnd || Math.random; var out = [];
    groups(blocks).forEach(function (g) {
      if (g.head && isKeyHead(g.head)) return;
      if (g.head) out.push(g.head);
      out = out.concat(g.pre);
      shuffle(g.items, rnd).forEach(function (q, n) {
        q.blocks.forEach(function (b, k) {
          if (k === 0 && b.k === 'item') out.push(renumber(b, n + 1));
          else if (b.k === 'opt' && b.cells.length >= 2 && b.cells.length <= 6) { var letters = 'abcdef'.slice(0, b.cells.length).split(''); out.push(Object.assign({}, b, { cells: relabel(shuffle(b.cells, rnd), letters) })); }
          else out.push(b);
        });
      });
    });
    return out;
  }

  return { build: build, parseExam: parseExam, parseInline: parseInline, splitTop: splitTop, texPlain: texPlain,
    runsText: runsText, blocksToText: blocksToText, groups: groups, renumber: renumber, variant: variant, isKeyHead: isKeyHead };
})();


if (typeof module !== 'undefined' && module.exports) module.exports = ExamBuilder;
