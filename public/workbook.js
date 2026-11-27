const parse = xml => {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('This workbook contains invalid XML.');
  return document;
};
const tags = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
const columnIndex = address => [...(address.match(/^[A-Z]+/)?.[0] ?? '')]
  .reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
const flattenText = node => tags(node, 't')
  .filter(item => item.parentElement.localName !== 'rPh')
  .map(item => item.textContent).join('');

export async function openWorkbook(file) {
  if (!/\.xlsx$|\.xlsm$/i.test(file.name)) throw new Error('Choose an .xlsx or .xlsm workbook.');
  if (file.size > 30 * 1024 * 1024) throw new Error('This workbook exceeds the 30 MB limit.');
  let entries;
  let expandedSize = 0;
  try {
    entries = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter(entry) {
        if (!/^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(entry.name)) return false;
        expandedSize += entry.originalSize;
        if (expandedSize > 120 * 1024 * 1024) throw new Error('The expanded workbook is too large.');
        return true;
      }
    });
  } catch (error) {
    throw new Error(expandedSize > 120 * 1024 * 1024 ? error.message : 'This file could not be opened as an Excel workbook.');
  }
  const xml = path => entries[path] && parse(fflate.strFromU8(entries[path]));
  const manifest = xml('xl/workbook.xml');
  const metadata = xml('xl/_rels/workbook.xml.rels');
  if (!manifest || !metadata) throw new Error('This file is missing its Excel workbook information.');
  const shared = xml('xl/sharedStrings.xml');
  const strings = shared ? tags(shared, 'si').map(flattenText) : [];
  const relations = new Map(tags(metadata, 'Relationship').filter(node =>
    node.getAttribute('Type')?.endsWith('/worksheet') && node.getAttribute('TargetMode') !== 'External'
  ).map(node => [node.getAttribute('Id'), node.getAttribute('Target')]));
  return tags(manifest, 'sheet').flatMap(sheet => {
    const id = Array.from(sheet.attributes).find(attr => attr.localName === 'id')?.value;
    const target = relations.get(id);
    if (!target) return [];
    const path = new URL(target, 'https://workbook.invalid/xl/workbook.xml').pathname.slice(1);
    const document = xml(path);
    if (!document) return [];
    const rows = [];
    for (const item of tags(document, 'row')) {
      const rowIndex = item.hasAttribute('r') ? Number(item.getAttribute('r')) - 1 : rows.length;
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= 1_048_576) throw new Error('Invalid worksheet row number.');
      const values = [];
      for (const cell of tags(item, 'c')) {
        const column = cell.hasAttribute('r') ? columnIndex(cell.getAttribute('r')) : values.length;
        if (column < 0 || column >= 16_384) throw new Error('Invalid worksheet column.');
        const type = cell.getAttribute('t');
        const value = tags(cell, 'v')[0]?.textContent;
        if (type === 's') values[column] = strings[Number(value)] ?? '';
        else if (type === 'inlineStr') values[column] = flattenText(cell);
        else if (type === 'e' || (tags(cell, 'f').length && !value)) values[column] = 'Invalid or uncached cell';
        else if (value != null && value !== '') values[column] = !type || type === 'n' ? Number(value) : value;
      }
      rows[rowIndex] = values;
    }
    return [{ name: sheet.getAttribute('name'), rows }];
  });
}

function escapeXml(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[character]));
}

const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageNs = 'http://schemas.openxmlformats.org/package/2006';
const relationshipXml = content => `<Relationships xmlns="${packageNs}/relationships">${content}</Relationships>`;

export function saveReview(sheets, filename) {
  const files = {};
  const put = (path, content) => { files[path] = fflate.strToU8('<?xml version="1.0" encoding="UTF-8"?>' + content); };
  put('[Content_Types].xml', `<Types xmlns="${packageNs}/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
    ${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
    </Types>`);
  put('_rels/.rels', relationshipXml(`<Relationship Id="rId1" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/>`));
  put('xl/_rels/workbook.xml.rels', relationshipXml(sheets.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="${relationships}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')));
  put('xl/workbook.xml', `<workbook xmlns="${spreadsheet}" xmlns:r="${relationships}"><sheets>${sheets.map((sheet, i) =>
    `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  sheets.forEach((sheet, i) => {
    const rows = sheet.rows.map((row, index) => `<row r="${index + 1}">${row.map(value => {
      if (typeof value === 'number' && Number.isFinite(value)) return `<c t="n"><v>${value}</v></c>`;
      return `<c t="inlineStr"><is><t xml:space="preserve">${escapeXml(value ?? '')}</t></is></c>`;
    }).join('')}</row>`).join('');
    put(`xl/worksheets/sheet${i + 1}.xml`, `<worksheet xmlns="${spreadsheet}"><sheetData>${rows}</sheetData></worksheet>`);
  });
  const blob = new Blob([fflate.zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement('a'), { href: url, download: filename });
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
