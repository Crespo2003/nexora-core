import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDaysToIsoDate,
  currentIsoDate,
  displayDateTimeToIso,
  displayDateToIso,
  formatExtractedNexoraDate,
  formatNexoraDate,
  formatNexoraDateTime,
  normalizeDateForStorage
} from '../lib/dates/formatDate';

test('all calendar dates render as DD/MM/YYYY without parsing date-only values as timestamps', () => {
  assert.equal(formatNexoraDate('2026-07-18'), '18/07/2026');
  assert.equal(formatNexoraDate('18/07/2026'), '18/07/2026');
  assert.equal(formatNexoraDate('2026-07-17T18:00:00.000Z'), '18/07/2026');
  assert.equal(formatNexoraDate('07/18/2026'), '');
  assert.equal(formatNexoraDate('2026-02-31'), '');
  assert.equal(formatExtractedNexoraDate('1 July 2026'), '01/07/2026');
  assert.equal(formatExtractedNexoraDate('1/7/2026'), '01/07/2026');
});

test('date inputs accept only DD/MM/YYYY and retain ISO storage at the boundary', () => {
  assert.equal(displayDateToIso('05/01/2027'), '2027-01-05');
  assert.equal(normalizeDateForStorage('2027-01-05'), '2027-01-05');
  assert.equal(normalizeDateForStorage('05/01/2027'), '2027-01-05');
  assert.equal(displayDateToIso('31/02/2027'), null);
  assert.equal(displayDateToIso('01/05/27'), null);
  assert.equal(displayDateToIso('05-01-2027'), null);
  assert.equal(displayDateToIso('29/02/2028'), '2028-02-29');
  assert.equal(displayDateToIso('29/02/2027'), null);
});

test('timestamps use Malaysia time without shifting the displayed date', () => {
  assert.equal(currentIsoDate(new Date('2026-07-17T16:30:00.000Z')), '2026-07-18');
  assert.equal(formatNexoraDateTime('2026-07-17T16:30:00.000Z'), '18/07/2026 00:30');
  assert.equal(displayDateTimeToIso('18/07/2026 00:30'), '2026-07-17T16:30:00.000Z');
  assert.equal(displayDateTimeToIso('2026-07-17T16:30:00.000Z'), '2026-07-17T16:30:00.000Z');
  assert.equal(displayDateTimeToIso('18/07/2026 25:00'), null);
  assert.equal(addDaysToIsoDate('2026-07-31', 1), '2026-08-01');
  assert.equal(addDaysToIsoDate('2028-02-28', 1), '2028-02-29');
  assert.equal(addDaysToIsoDate('2027-12-31', 1), '2028-01-01');
});
