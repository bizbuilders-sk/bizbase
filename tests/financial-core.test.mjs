import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyAllocation } from '../financial-core.mjs';

test('proportional plans include the final month and preserve the contract total in cents', () => {
  const months = ['2026-01', '2026-02', '2026-03'];
  const values = months.map(month => monthlyAllocation(300, '2026-01-15', '2026-03-31', month));
  assert.deepEqual(values, [100, 100, 100]);
  assert.equal(values.reduce((sum, value) => sum + Math.round(value * 100), 0), 30000);
});

test('cent remainder is assigned explicitly and months outside the schedule are zero', () => {
  const values = ['2026-01', '2026-02', '2026-03'].map(month => monthlyAllocation(100, '2026-01-01', '2026-03-31', month));
  assert.deepEqual(values, [33.34, 33.33, 33.33]);
  assert.equal(values.reduce((sum, value) => sum + Math.round(value * 100), 0), 10000);
  assert.equal(monthlyAllocation(100, '2026-01-01', '2026-03-31', '2025-12'), 0);
  assert.equal(monthlyAllocation(100, '2026-01-01', '2026-03-31', '2026-04'), 0);
});
