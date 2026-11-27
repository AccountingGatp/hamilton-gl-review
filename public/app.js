import { compare, readHeads, readReport } from './review.js';
import { openWorkbook, saveReview } from './workbook.js';

const $ = id => document.getElementById(id);
const currency = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const display = value => Number.isFinite(value) ? currency.format(value) : '—';
const percentage = line => Number.isFinite(line.difference) && Number.isFinite(line.prior) && line.prior !== 0
  ? line.difference / Math.abs(line.prior) : null;
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const changed = line => Number.isFinite(line.difference) && line.difference !== 0;
const pageSize = 25;
let report, heads, reviewed;
let current = 0, prior = 0, page = 0, view = 'selected';

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value != null) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function status(message, error = false) {
  $('status').hidden = !message;
  $('status').classList.toggle('error', error);
  $('status').textContent = message;
}

function setPeriods() {
  $('current').replaceChildren(...report.periods.slice(1).map((period, index) => new Option(period.label, index + 1)));
  $('current').value = current;
  $('prior').replaceChildren(...report.periods.slice(0, current).map((period, index) => new Option(period.label, index)));
  $('prior').value = prior;
}

async function load(event) {
  event.preventDefault();
  const reportFile = $('report').files[0];
  const headsFile = $('heads').files[0];
  for (const id of ['run', 'report', 'heads']) $(id).disabled = true;
  $('results').hidden = true;
  status('Reading workbooks…');
  try {
    const [reportSheets, headSheets] = await Promise.all([
      openWorkbook(reportFile).catch(error => { throw new Error('P&L file — ' + error.message); }),
      openWorkbook(headsFile).catch(error => { throw new Error('GL heads file — ' + error.message); })
    ]);
    report = readReport(reportSheets);
    heads = readHeads(headSheets);
    current = report.periods.length - 1;
    prior = current - 1;
    setPeriods();
    view = 'selected';
    $('query').value = '';
    $('threshold').value = '0';
    $('changed').checked = true;
    $('report-name').textContent = report.title.slice(0, 2).join(' · ') || reportFile.name;
    page = 0;
    render();
    $('results').hidden = false;
    status('');
  } catch (error) {
    status(error.message, true);
  } finally {
    for (const id of ['run', 'report', 'heads']) $(id).disabled = false;
  }
}

function renderChart(lines) {
  const largest = lines.filter(line => !line.subtotal && changed(line)).slice(0, 5);
  const max = Math.abs(largest[0]?.difference ?? 0);
  const bars = largest.map(line => {
    const row = element('div', null, 'bar-row');
    const track = element('span', null, 'bar-track');
    track.setAttribute('aria-hidden', 'true');
    const bar = element('span', null, 'bar-fill' + (line.difference < 0 ? ' down' : ''));
    bar.style.width = (Math.abs(line.difference) / max * 100) + '%';
    track.append(bar);
    row.append(element('span', [line.code, line.label].filter(Boolean).join(' ')), track, element('strong', display(line.difference)));
    return row;
  });
  $('chart').replaceChildren(...(bars.length ? bars : [element('p', 'No account changes to plot for these filters.')]));
}

function renderWarnings(lines) {
  const matched = new Set(lines.filter(line => line.selected).map(line => line.code));
  const missing = [...heads.codes].filter(code => !matched.has(code));
  const invalid = lines.filter(line => line.difference === null);
  const warnings = [];
  if (missing.length) warnings.push('GL heads absent from the P&L (' + missing.length + '): ' + missing.join(', '));
  if (heads.invalid) warnings.push(heads.invalid + ' GL heads entries could not be read as account codes.');
  if (invalid.length) warnings.push(invalid.length + ' P&L lines have invalid or uncached amounts in the comparison months. Their Difference is blank.');
  $('warnings').replaceChildren(...warnings.map(message => element('p', message)));
  $('warnings').hidden = !warnings.length;
  $('matched-count').textContent = matched.size + ' / ' + heads.codes.size;
}

function render() {
  reviewed = compare(report, heads, current, prior);
  const selected = reviewed.filter(line => line.selected);
  const query = $('query').value.trim().toLowerCase();
  const minimum = Math.max(0, Number($('threshold').value) || 0);
  const lines = (view === 'selected' ? selected : reviewed).filter(line =>
    [line.code, line.label].join(' ').toLowerCase().includes(query)
    && (!$('changed').checked || changed(line))
    && (!minimum || (Number.isFinite(line.difference) && Math.abs(line.difference) >= minimum))
  ).sort((a, b) => Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0));

  $('selected').setAttribute('aria-pressed', view === 'selected');
  $('all').setAttribute('aria-pressed', view === 'all');
  $('line-count').textContent = reviewed.length;
  $('selected-count').textContent = selected.filter(changed).length;
  $('change-count').textContent = reviewed.filter(changed).length;
  $('current-label').textContent = report.periods[current].label;
  $('prior-label').textContent = report.periods[prior].label;
  renderWarnings(reviewed);
  renderChart(lines);

  const pages = Math.max(1, Math.ceil(lines.length / pageSize));
  page = Math.min(page, pages - 1);
  const start = page * pageSize;
  $('rows').replaceChildren(...lines.slice(start, start + pageSize).map(line => {
    const row = element('tr', null, line.subtotal ? 'subtotal' : line.selected ? 'monitored' : '');
    const account = element('td');
    if (line.code) account.append(element('span', line.code, 'code'));
    account.append(document.createTextNode(line.label));
    const ratio = percentage(line);
    row.append(account, element('td', display(line.current ?? 0)), element('td', display(line.prior ?? 0)),
      element('td', display(line.difference), 'diff'), element('td', ratio === null ? '—' : percent.format(ratio)),
      element('td', line.row));
    return row;
  }));
  $('shown').textContent = lines.length ? `Showing ${start + 1}–${Math.min(start + pageSize, lines.length)} of ${lines.length} lines` : '';
  $('empty').hidden = lines.length > 0;
  $('pagination').hidden = pages < 2;
  $('previous').disabled = page === 0;
  $('next').disabled = page >= pages - 1;
  $('page').textContent = `Page ${page + 1} of ${pages}`;
}

function download() {
  const header = ['GL code', 'Account', ...report.periods.map(period => period.label + ' Actual'),
    'Adjusted Total (source)', 'Variance (source)', 'Difference', 'Change %', 'Monitored GL head', 'Line type', 'Source row'];
  function rows(lines) {
    const excelValue = value => Number.isNaN(value) ? 'Invalid or uncached' : value;
    return [header, ...lines.map(line => [
      line.code, line.label, ...line.values.map(excelValue), excelValue(line.total), excelValue(line.sourceVariance),
      line.difference, percentage(line) === null ? '' : percent.format(percentage(line)),
      line.selected ? 'Yes' : 'No', line.subtotal ? 'Subtotal' : 'Detail', line.row
    ])];
  }
  const matched = new Set(reviewed.filter(line => line.selected).map(line => line.code));
  const currentMonth = report.periods[current].label;
  const previousMonth = report.periods[prior].label;
  const notes = [
    ['GL review', ...report.title],
    ['Source sheet', report.sheet],
    ['Current month', currentMonth],
    ['Comparison month', previousMonth],
    ['Difference', 'Current month minus comparison month'],
    ['Change %', 'Difference divided by the absolute comparison amount. Blank when the comparison amount is zero or unavailable.'],
    ['GL heads entries skipped', heads.invalid],
    ['GL code', 'Match status'],
    ...[...heads.codes].map(code => [code, matched.has(code) ? 'Matched' : 'Absent from P&L'])
  ];
  saveReview([
    { name: 'Selected GL Changes', rows: rows(reviewed.filter(line => line.selected && changed(line))) },
    { name: 'All Changes', rows: rows(reviewed.filter(changed)) },
    { name: 'Full P&L Review', rows: rows(reviewed) },
    { name: 'Review Notes', rows: notes }
  ], 'Hamilton_GL_Review_' + currentMonth.replace(' ', '_') + '.xlsx');
}

$('upload').addEventListener('submit', load);
$('export').addEventListener('click', download);
$('current').addEventListener('change', () => {
  current = Number($('current').value);
  prior = current - 1;
  setPeriods();
  page = 0;
  render();
});
$('prior').addEventListener('change', () => { prior = Number($('prior').value); page = 0; render(); });
for (const id of ['selected', 'all']) {
  $(id).addEventListener('click', () => { view = id; page = 0; render(); });
}
for (const id of ['query', 'threshold', 'changed']) {
  $(id).addEventListener('input', () => { page = 0; render(); });
}
$('previous').addEventListener('click', () => { page--; render(); });
$('next').addEventListener('click', () => { page++; render(); });
for (const id of ['report', 'heads']) {
  $(id).addEventListener('change', () => {
    $('results').hidden = true;
    status('');
  });
}
