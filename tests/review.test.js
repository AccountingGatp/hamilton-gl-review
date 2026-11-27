import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, readHeads, readReport } from '../public/review.js';

test('discovers shifted columns, sorts month headers and matches exact codes', () => {
  const report = readReport([{ name: 'October report', rows: [
    ['Another property'],
    [],
    ['Account', '', 'Oct 2030 Actual', 'Aug 2030 Actual', 'Sep 2030 Actual', 'Adjusted Total', 'Variance'],
    ['', '0010 Insurance', '3,500.00', 3300, '(250.00)', 6550, 99],
    ['', '00101 Rent', 20, 40, 0],
    ['0010 Total Insurance', '', 3500, 3300, -250],
    ['', '0011 Vacant units', 42, 12, 'bad'],
    ['', '0012 Services', null, 11, 40],
    ['', '0013 No change', 6.01, 0, 6]
  ] }]);
  const heads = readHeads([{ name: 'Selected', rows: [['Description', 'GL Account'], ['a', '0010'], ['b', 'bad'], ['c', '0010'], ['d', '0013']] }]);
  const result = compare(report, heads, 2, 1);
  assert.deepEqual(report.periods.map(period => period.label), ['Aug 2030', 'Sep 2030', 'Oct 2030']);
  assert.equal(heads.invalid, 1);
  assert.deepEqual(result.map(line => line.difference), [3750, 20, 3750, null, -40, 0.01]);
  assert.deepEqual(result.filter(line => line.selected).map(line => line.code), ['0010', '0013']);
  assert.equal(result[0].sourceVariance, 99);
  assert.equal(compare(report, heads, 2, 0)[0].difference, 200);
});

test('rejects malformed layouts and ambiguous month columns', () => {
  assert.throws(() => readReport([{ name: 'Invoice', rows: [['Invoice', 'Date', 'Amount']] }]), /headers were not found/);
  assert.throws(() => readReport([{ name: 'Report', rows: [['Account', 'Jan 2031 Actual', 'January 2031 Actual']] }]), /duplicate month/);
  assert.throws(() => readHeads([{ name: 'GL', rows: [['GL Code'], ['Invalid']] }]), /no account codes/);
});
