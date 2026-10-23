import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAnalyticsDate, formatAnalyticsDateTime } from '../src/modules/module7/services/dateDisplay.ts';

test('unavailable and malformed dates never throw or render Invalid Date', () => {
  for (const value of [null, undefined, '', ' ', 'not a date', '2026-13-01', '2026-02-30',
    '2026-02-30T12:00:00Z', '2026-10-02T99:00:00Z', '2026-10-02Tinvalid', 0, NaN, {}, false]) {
    assert.equal(formatAnalyticsDate(value), 'Date unavailable');
    assert.equal(formatAnalyticsDateTime(value), 'Date unavailable');
  }
});

test('valid saved dates preserve existing Manila formatting, including date-only and timezone rollover', () => {
  for (const value of ['2026-10-02', '2024-02-29', '2026-10-02T20:30:00Z',
    '2026-10-02T00:00:00.123456+08:00', '2026-10-02T12:00:00-05:00']) {
    const dateOnly = value.length === 10;
    const date = new Date(dateOnly ? `${value}T00:00:00+08:00` : value);
    assert.equal(formatAnalyticsDate(value), date.toLocaleDateString('en-PH', {
      timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric',
    }));
    assert.equal(formatAnalyticsDateTime(value), date.toLocaleString('en-PH', {
      timeZone: 'Asia/Manila', dateStyle: 'medium', ...(dateOnly ? {} : { timeStyle: 'short' as const }),
    }));
  }
});
