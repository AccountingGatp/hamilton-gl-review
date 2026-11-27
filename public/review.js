const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const clean = value => String(value ?? '').trim();
const normalize = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const glLabel = /^(\d+(?:[-.]\d+)*)(?:\s+[-–:]?\s*|\s*[:–]\s*|$)(.*)$/;
const round = value => Math.sign(value) * Math.round((Math.abs(value) + 1e-9) * 100) / 100 || 0;

function period(value, column) {
  const match = clean(value).match(/^([a-z]{3,9})\.?[\s-]+(\d{4})(?:\s+actual)?$/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const month = monthNames.findIndex(item => [item.toLowerCase(), item.slice(0, 3).toLowerCase()].includes(name));
  if (month === -1) return null;
  return { column, key: Number(match[2]) * 12 + month, label: monthNames[month].slice(0, 3) + ' ' + match[2] };
}

export function amount(value) {
  if (value == null || /^(?:\s*|[-–—])$/.test(clean(value))) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = clean(value).replace(/^\((.*)\)$/, '-$1').replace(/[$,\s]/g, '');
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) && Number.isFinite(Number(normalized))) return Number(normalized);
  return NaN;
}

export function readHeads(sheets) {
  const sheet = sheets.find(item => item.name.toLowerCase() === 'glh') ?? sheets[0];
  const rows = sheet?.rows ?? [];
  const heading = rows.slice(0, 25).findIndex(row => row?.some(value =>
    /^(?:gl(?:head|account)?(?:code|number|no|heads?)?|account(?:code|number|no)?|code)$/.test(normalize(value))));
  const column = heading === -1 ? 0 : rows[heading].findIndex(value =>
    /^(?:gl(?:head|account)?(?:code|number|no|heads?)?|account(?:code|number|no)?|code)$/.test(normalize(value)));
  const codes = new Set();
  let invalid = 0;
  for (const row of rows.slice(heading + 1)) {
    const value = clean(row?.[column]);
    if (!value) continue;
    const match = glLabel.exec(value);
    if (match) codes.add(match[1]);
    else invalid++;
  }
  if (!codes.size) throw new Error('GL heads file has no account codes. Place codes in column A or under a GL Account header.');
  return { codes, invalid };
}

export function readReport(sheets) {
  const candidates = [ ...sheets ].sort((a, b) => Number(b.name.toLowerCase() === 'pnl') - Number(a.name.toLowerCase() === 'pnl'));
  for (const sheet of candidates) {
    for (const [index, row] of sheet.rows.slice(0, 100).entries()) {
      if (!row) continue;
      const accountColumn = row.findIndex(value => /^(account|accounts|accountname|glaccount|glhead)$/.test(normalize(value)));
      if (accountColumn < 0) continue;
      const periods = row.map(period).filter(Boolean).sort((a, b) => a.key - b.key);
      if (periods.length < 2) continue;
      if (new Set(periods.map(item => item.key)).size !== periods.length) {
        throw new Error('The P&L contains duplicate month columns. Use an export with one Actual column per month.');
      }
      const firstMonthColumn = Math.min(...periods.map(item => item.column));
      const totalColumn = row.findIndex(value => /^(adjustedtotal|totalactual|total)$/.test(normalize(value)));
      const varianceColumn = row.findIndex(value => normalize(value) === 'variance');
      const title = sheet.rows.slice(0, index).map(item => clean(item?.[accountColumn])).filter(Boolean);
      const lines = [];
      for (const [offset, detail] of sheet.rows.slice(index + 1).entries()) {
        if (!detail) continue;
        const label = detail.slice(accountColumn, firstMonthColumn).map(clean).filter(Boolean).at(-1);
        if (!label) continue;
        const values = periods.map(item => amount(detail[item.column]));
        if (values.every(value => value === null)) continue;
        const match = glLabel.exec(label);
        lines.push({
          row: index + offset + 2,
          code: match?.[1] ?? '',
          label: match?.[2] || label,
          subtotal: /^(?:total\b|net (?:operating )?income\b)/i.test(match?.[2] || label),
          values,
          total: amount(detail[totalColumn]),
          sourceVariance: amount(detail[varianceColumn])
        });
      }
      if (!lines.length) throw new Error('The monthly headers were found, but the sheet has no P&L lines with amounts.');
      return { title, periods, lines, sheet: sheet.name };
    }
  }
  throw new Error('P&L headers were not found. Choose a Trailing Profit and Loss Detail export with an Account header and at least two monthly Actual columns, such as Jan 2026 Actual.');
}

export function compare(report, heads, currentIndex, priorIndex) {
  return report.lines.map(line => {
    const current = line.values[currentIndex];
    const prior = line.values[priorIndex];
    // An empty monthly cell is zero activity. An invalid cell remains uncalculated.
    const difference = Number.isNaN(current) || Number.isNaN(prior) ? null : round((current ?? 0) - (prior ?? 0));
    const selected = !line.subtotal && !!line.code && heads.codes.has(line.code);
    return { ...line, selected, current, prior, difference };
  });
}
