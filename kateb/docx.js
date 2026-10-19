/* Word (.docx) builder — Word 2007/2010 compatible, RTL aware.
   blocks: [{align:'J'|'C'|'R'|'L', heading:bool, sub:bool, list:bool, pageBreak:bool, runs:[{text, b, u, hl}]}]
           or {table: [[runs, …], …]} (rows of cells; a shorter row's last cell spans the rest) */
var DocxBuilder = (function () {
  var AR = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
  var LAT = /[A-Za-z]/g;
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function isRtlText(t) { return (t.match(AR) || []).length >= (t.match(LAT) || []).length && (t.match(AR) || []).length > 0; }

  function runXml(r, rtlPara, size) {
    var rtl = rtlPara && /[؀-ۿ]/.test(r.text);
    var rpr = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Simplified Arabic"/>' +
      (r.b ? '<w:b/><w:bCs/>' : '') +
      (size ? '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>' : '') +
      (r.hl ? '<w:highlight w:val="yellow"/>' : '') +
      (r.u ? '<w:u w:val="single"/>' : '') +
      (rtl ? '<w:rtl/>' : '') + '</w:rPr>';
    var out = '';
    r.text.split('\t').forEach(function (part, i) {
      if (i) out += '<w:r>' + rpr + '<w:tab/></w:r>';
      if (part) out += '<w:r>' + rpr + '<w:t xml:space="preserve">' + esc(part) + '</w:t></w:r>';
    });
    return out;
  }

  function paraXml(p) {
    var text = p.runs.map(function (r) { return r.text; }).join('');
    var rtl = isRtlText(text);
    var jc = '';
    var bidi = rtl;
    if (p.align === 'J') jc = 'both';
    else if (p.align === 'C') jc = 'center';
    else if (p.align === 'L') { if (rtl) { bidi = false; } jc = rtl ? 'left' : ''; }
    else if (p.align === 'R') { jc = rtl ? '' : 'right'; }
    if (p.sub) jc = '';                                   // subheadings sit at the start edge in both directions
    var size = p.heading ? 32 : p.sub ? 30 : 0;
    /* in a right-to-left paragraph w:left is the leading (right) edge, so one indent works both ways */
    var ind = p.list ? '<w:ind w:left="567" w:hanging="425"/>' : '';
    var ppr = '<w:pPr>' + ((p.heading || p.sub) ? '<w:keepNext/>' : '') + (p.pageBreak ? '<w:pageBreakBefore/>' : '') + (bidi ? '<w:bidi/>' : '') +
      '<w:spacing w:before="' + (p.sub ? 120 : 0) + '" w:after="80"/>' + ind + (jc ? '<w:jc w:val="' + jc + '"/>' : '') + '</w:pPr>';
    var runs = p.runs.map(function (r) {
      return runXml({ text: r.text, b: r.b || p.heading || p.sub, u: r.u, hl: r.hl }, rtl, size);
    }).join('');
    return '<w:p>' + ppr + runs + '</w:p>';
  }

  function tableXml(rows, docRtl) {
    var cols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1), W = 9638, cw = Math.floor(W / cols), grid = '';
    for (var i = 0; i < cols; i++) grid += '<w:gridCol w:w="' + cw + '"/>';
    var b = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (e) { return '<w:' + e + ' w:val="single" w:sz="6" w:space="0" w:color="000000"/>'; }).join('') + '</w:tblBorders>';
    var trs = rows.map(function (r) {
      return '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + r.map(function (cell, j) {
        var span = j === r.length - 1 ? cols - r.length + 1 : 1, t = cell.map(function (x) { return x.text; }).join(''), rtl = isRtlText(t);
        var runs = cell.map(function (x) { return runXml({ text: x.text, b: x.b, u: x.u, hl: x.hl }, rtl, 0); }).join('');
        return '<w:tc><w:tcPr><w:tcW w:w="' + (cw * span) + '" w:type="dxa"/>' + (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '') + '</w:tcPr>' +
          '<w:p><w:pPr>' + (rtl ? '<w:bidi/>' : '') + '<w:spacing w:before="40" w:after="40"/><w:jc w:val="center"/></w:pPr>' + runs + '</w:p></w:tc>';
      }).join('') + '</w:tr>';
    }).join('');
    return '<w:tbl><w:tblPr>' + (docRtl ? '<w:bidiVisual/>' : '') + '<w:tblW w:w="' + (cw * cols) + '" w:type="dxa"/>' + b +
      '<w:tblLayout w:type="fixed"/><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>' + trs + '</w:tbl><w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>';
  }
  function blockText(p) { return p.table ? p.table.map(function (r) { return r.map(function (c) { return c.map(function (x) { return x.text; }).join(''); }).join(' '); }).join(' ') : p.runs.map(function (r) { return r.text; }).join(''); }

  var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

  function build(JSZip, paragraphs, opts) {
    opts = opts || {};
    var allText = paragraphs.map(blockText).join(' ');
    var docRtl = isRtlText(allText);
    var body = paragraphs.length ? paragraphs.map(function (p) { return p.table ? tableXml(p.table, docRtl) : paraXml(p); }).join('') : '<w:p/>';
    var sect = '<w:sectPr>' + (opts.pageNumbers !== false ? '<w:footerReference w:type="default" r:id="rIdFooter"/>' : '') +
      '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="567" w:gutter="0"/>' +
      (docRtl ? '<w:bidi/>' : '') + '</w:sectPr>';
    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + body + sect + '</w:body></w:document>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ' + NS + '><w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Simplified Arabic"/>' +
      '<w:sz w:val="28"/><w:szCs w:val="28"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-EG"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/></w:style></w:styles>';
    var settings = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ' + NS + '><w:zoom w:percent="100"/>' +
      '<w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat>' +
      '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="14"/></w:compat></w:settings>';
    var footer = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' + NS + '><w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/></w:pPr>' +
      '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>';
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
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
      '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>';
    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(opts.title || 'Document') + '</dc:title><dc:creator>Al-Kateb</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>';
    var zip = new JSZip();
    zip.file('[Content_Types].xml', ct);
    zip.file('_rels/.rels', rels);
    zip.file('docProps/core.xml', core);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', styles);
    zip.file('word/settings.xml', settings);
    zip.file('word/footer1.xml', footer);
    zip.file('word/_rels/document.xml.rels', docRels);
    return zip;
  }

  /* inline: **b** __u__ ⟦doubt⟧, runs of ___ kept as typed blanks */
  function inline(line) {
    var runs = [], b = false, u = false, hl = false, buf = '';
    var re = /(_{3,}|\*\*|__|⟦|⟧)/g, last = 0, mm;
    function push() { if (buf) runs.push({ text: buf, b: b, u: u, hl: hl }); buf = ''; }
    while ((mm = re.exec(line))) {
      buf += line.slice(last, mm.index); push();
      if (/^_{3,}$/.test(mm[1])) { buf = mm[1]; push(); } else if (mm[1] === '**') b = !b; else if (mm[1] === '__') u = !u; else if (mm[1] === '⟦') hl = true; else hl = false;
      last = re.lastIndex;
    }
    buf += line.slice(last); push();
    return runs;
  }
  /* markup line → block. Line tags: [H] title, [S] subheading, [C] [R] [L] [J] alignment, [N] list item, [TABLE] a | b || c | d */
  function parseMarkup(text) {
    var paras = [];
    text.replace(/\r/g, '').split('\n').forEach(function (line) {
      if (!line.trim()) return;
      var t = line.match(/^\s*\[TABLE\]\s*(.*)$/);
      if (t) {
        var rows = t[1].split('||').map(function (r) { return r.split('|').map(function (c) { return inline(c.trim()); }); })
          .filter(function (r) { return r.some(function (c) { return c.length; }); });
        if (rows.length) paras.push({ table: rows });
        return;
      }
      var m = line.match(/^\s*\[(C|R|L|J|H|S|N)\]\s*/);
      var align = 'J', heading = false, sub = false, list = false;
      if (m) {
        align = m[1]; line = line.slice(m[0].length);
        if (align === 'H') { align = 'C'; heading = true; } else if (align === 'S') { align = 'R'; sub = true; } else if (align === 'N') { align = 'J'; list = true; }
      }
      var runs = inline(line);
      if (runs.length) paras.push({ align: align, heading: heading, sub: sub, list: list, runs: runs });
    });
    return paras;
  }

  return { build: build, parseMarkup: parseMarkup, inline: inline, isRtlText: isRtlText, tableXml: tableXml };
})();


if (typeof module !== 'undefined' && module.exports) module.exports = DocxBuilder;
