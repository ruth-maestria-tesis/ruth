import {
  addBusinessDays,
  businessDaysRemaining,
  calendarDaysBetween,
  isBusinessDay,
  localDateKey,
} from './business-days';

const NONE = new Set<string>();
// 2026-11-18 is a Wednesday; 12:00 in Bogotá is 17:00Z.
const WED_NOON = new Date('2026-11-18T17:00:00Z');

describe('business days (America/Bogotá, UTC−5)', () => {
  it('uses the Bogotá calendar date, not the UTC one', () => {
    expect(localDateKey(new Date('2026-11-19T03:00:00Z'))).toBe('2026-11-18');
    expect(localDateKey(new Date('2026-11-19T05:00:00Z'))).toBe('2026-11-19');
  });

  it('weekends and holidays are not business days', () => {
    expect(isBusinessDay('2026-11-21', NONE)).toBe(false); // Saturday
    expect(isBusinessDay('2026-11-22', NONE)).toBe(false); // Sunday
    expect(isBusinessDay('2026-11-23', new Set(['2026-11-23']))).toBe(false);
    expect(isBusinessDay('2026-11-23', NONE)).toBe(true);
  });

  it('deadline = end of the N-th business day after the start day', () => {
    // Thu 19, Fri 20, Mon 23 … Mon 30 → end of Mon 30 Bogotá.
    expect(addBusinessDays(WED_NOON, 8, NONE).toISOString()).toBe(
      '2026-12-01T04:59:59.999Z',
    );
    expect(
      addBusinessDays(WED_NOON, 8, new Set(['2026-11-23'])).toISOString(),
    ).toBe('2026-12-02T04:59:59.999Z');
    // Late Wednesday evening in Bogotá is already Thursday in UTC.
    expect(
      addBusinessDays(new Date('2026-11-19T03:00:00Z'), 1, NONE).toISOString(),
    ).toBe('2026-11-20T04:59:59.999Z');
    // From a Friday, one business day is the next Monday.
    expect(
      addBusinessDays(new Date('2026-11-20T15:00:00Z'), 1, NONE).toISOString(),
    ).toBe('2026-11-24T04:59:59.999Z');
  });

  it('rejects a negative or non-integer day count', () => {
    expect(() => addBusinessDays(WED_NOON, -1, NONE)).toThrow(RangeError);
    expect(() => addBusinessDays(WED_NOON, 1.5, NONE)).toThrow(RangeError);
  });

  it('counts remaining business days in (today, deadline day]', () => {
    const deadline = addBusinessDays(WED_NOON, 8, NONE);
    expect(businessDaysRemaining(WED_NOON, deadline, NONE)).toBe(8);
    expect(
      businessDaysRemaining(new Date('2026-11-27T15:00:00Z'), deadline, NONE),
    ).toBe(1);
    expect(
      businessDaysRemaining(new Date('2026-11-30T15:00:00Z'), deadline, NONE),
    ).toBe(0);
    expect(
      businessDaysRemaining(new Date('2026-12-01T05:00:00Z'), deadline, NONE),
    ).toBe(0);
  });

  it('counts calendar days between Bogotá dates', () => {
    expect(
      calendarDaysBetween(WED_NOON, new Date('2026-11-21T02:00:00Z')),
    ).toBe(2);
    expect(calendarDaysBetween(WED_NOON, WED_NOON)).toBe(0);
  });
});
