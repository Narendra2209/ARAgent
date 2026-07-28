import { zipSync, strToU8 } from 'fflate';

/**
 * Minimal .xlsx writer — just enough SpreadsheetML to emit a styled, multi-sheet
 * workbook. We already depend on fflate for reading MYOB's exports
 * (arAgingImport.js), and an .xlsx is only a zip of XML parts, so writing one
 * costs a few templates instead of a new dependency.
 *
 * Strings are written inline (`t="inlineStr"`) rather than via sharedStrings:
 * marginally larger files, but no second pass to build a string table.
 *
 * Usage:
 *   buildXlsx([{ name: 'Sheet1', cols: [{ width: 12 }], rows: [[cell, ...]] }])
 * where a cell is null (blank), or { v, s }: `v` a string or number, `s` one of
 * the STYLE indices below.
 */

/** Style slots available to callers as `cell.s`. Indices match `cellXfs` order. */
export const STYLE = {
  DEFAULT: 0,
  TITLE: 1,
  SUBTITLE: 2,
  HEADER: 3,
  MONEY: 4,
  TOTAL_LABEL: 5,
  TOTAL_MONEY: 6,
  FLAG: 7, // bold red — the "OVER" credit-limit marker
  BOLD: 8,
};

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters are illegal in XML 1.0 and make Excel refuse the file.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

/** 0-based column index -> spreadsheet letters (0 -> A, 26 -> AA). */
function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; ) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const CONTENT_TYPES = (count) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${Array.from(
  { length: count },
  (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

// Fill 0 (none) and fill 1 (gray125) are mandatory in that order — Excel
// treats the first two fill slots as reserved and misreads the file without them.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFB91C1C"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top style="thin"><color rgb="FF9CA3AF"/></top><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="4" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(sheet) {
  const cols = sheet.cols?.length
    ? `<cols>${sheet.cols
        .map(
          (c, i) =>
            `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 12}" customWidth="1"/>`
        )
        .join('')}</cols>`
    : '';

  const rows = sheet.rows
    .map((cells, r) => {
      const body = cells
        .map((cell, c) => {
          if (cell === null || cell === undefined) return '';
          const ref = `${colName(c)}${r + 1}`;
          const s = cell.s ? ` s="${cell.s}"` : '';
          if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
            return `<c r="${ref}"${s}><v>${cell.v}</v></c>`;
          }
          const text = esc(cell.v ?? '');
          if (!text) return `<c r="${ref}"${s}/>`;
          // xml:space="preserve" keeps leading/trailing spaces in names intact.
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${body}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

/** Excel rejects these characters in a tab name, and caps it at 31 chars. */
const safeSheetName = (name, i) =>
  (String(name).replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || `Sheet${i + 1}`);

/**
 * Build the workbook. Returns a Buffer ready to stream as
 * application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.
 */
export function buildXlsx(sheets) {
  if (!sheets?.length) throw new Error('buildXlsx: at least one sheet is required');

  // Tab names must be unique or Excel reports the file as corrupt; de-duplicate
  // by suffixing, which can only happen if two branches normalise to one name.
  const used = new Set();
  const names = sheets.map((s, i) => {
    let name = safeSheetName(s.name, i);
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${safeSheetName(s.name, i).slice(0, 28)}(${n++})`;
    used.add(name.toLowerCase());
    return name;
  });

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
    .map(
      (name, i) =>
        `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    )
    .join('')}</sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const files = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES(sheets.length)),
    '_rels/.rels': strToU8(ROOT_RELS),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/styles.xml': strToU8(STYLES),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });

  return Buffer.from(zipSync(files, { level: 6 }));
}
