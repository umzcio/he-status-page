import { describe, it, expect } from 'vitest';
import { nextOccurrenceTime } from '../maintenanceManager';

// Build a MaintenanceRow with sensible defaults; override what each test needs.
// `nextOccurrenceTime` only reads scheduled_start/scheduled_end, recurrence_type,
// and recurrence_day_of_month, but the row type requires the rest.
function makeRow(overrides: {
  start: Date;
  durationMinutes?: number;
  recurrence_type: 'daily' | 'weekly' | 'monthly';
  recurrence_day_of_month?: number | null;
}) {
  const durationMs = (overrides.durationMinutes ?? 60) * 60 * 1000;
  return {
    id: 'm1',
    service_id: 's1',
    series_id: 'series1',
    title: 'Test',
    description: null,
    scheduled_start: overrides.start,
    scheduled_end: new Date(overrides.start.getTime() + durationMs),
    recurrence_type: overrides.recurrence_type,
    recurrence_day_of_week: null,
    recurrence_day_of_month: overrides.recurrence_day_of_month ?? null,
    announce: true,
    service_name: 'Svc',
    category_slug: 'core',
    current_status: 'operational',
  } as any;
}

describe('nextOccurrenceTime', () => {
  describe('monthly day-clamping', () => {
    it('Jan 31 -> Feb 28 in a non-leap year (not March)', () => {
      const { start } = nextOccurrenceTime(
        makeRow({ start: new Date(2023, 0, 31, 2, 0), recurrence_type: 'monthly', recurrence_day_of_month: 31 }),
      );
      expect(start.getFullYear()).toBe(2023);
      expect(start.getMonth()).toBe(1); // February
      expect(start.getDate()).toBe(28); // clamped, NOT March 3
    });

    it('Feb 28 -> Mar 31 (target day 31 restored in a long month)', () => {
      const { start } = nextOccurrenceTime(
        makeRow({ start: new Date(2023, 1, 28, 2, 0), recurrence_type: 'monthly', recurrence_day_of_month: 31 }),
      );
      expect(start.getMonth()).toBe(2); // March
      expect(start.getDate()).toBe(31); // NOT March 3
    });

    it('Jan 31 -> Feb 29 in a leap year', () => {
      const { start } = nextOccurrenceTime(
        makeRow({ start: new Date(2024, 0, 31, 9, 0), recurrence_type: 'monthly', recurrence_day_of_month: 31 }),
      );
      expect(start.getMonth()).toBe(1); // February
      expect(start.getDate()).toBe(29);
    });

    it('day 30 clamps to Feb 28 (general clamping)', () => {
      const { start } = nextOccurrenceTime(
        makeRow({ start: new Date(2023, 0, 30, 12, 0), recurrence_type: 'monthly', recurrence_day_of_month: 30 }),
      );
      expect(start.getMonth()).toBe(1);
      expect(start.getDate()).toBe(28);
    });

    it('rolls the year over from December to January', () => {
      const { start } = nextOccurrenceTime(
        makeRow({ start: new Date(2023, 11, 15, 3, 0), recurrence_type: 'monthly', recurrence_day_of_month: 15 }),
      );
      expect(start.getFullYear()).toBe(2024);
      expect(start.getMonth()).toBe(0); // January
      expect(start.getDate()).toBe(15);
    });

    it('falls back to the current occurrence day when no target day is set', () => {
      const { start } = nextOccurrenceTime(
        makeRow({ start: new Date(2023, 5, 10, 8, 0), recurrence_type: 'monthly', recurrence_day_of_month: null }),
      );
      expect(start.getMonth()).toBe(6); // July
      expect(start.getDate()).toBe(10);
    });
  });

  describe('wall-clock preservation (local-time approach)', () => {
    it('keeps the same local hour/minute across a spring DST-boundary month', () => {
      // A March occurrence: in DST-observing zones the offset changes mid-March.
      // The local-time construction keeps the wall-clock time identical regardless
      // of the runner's timezone.
      const base = new Date(2024, 1, 15, 2, 30); // Feb 15, 02:30 local
      const { start, end } = nextOccurrenceTime(
        makeRow({ start: base, durationMinutes: 90, recurrence_type: 'monthly', recurrence_day_of_month: 15 }),
      );
      expect(start.getMonth()).toBe(2); // March
      expect(start.getDate()).toBe(15);
      expect(start.getHours()).toBe(2);
      expect(start.getMinutes()).toBe(30);
      // duration is preserved
      expect(end.getTime() - start.getTime()).toBe(90 * 60 * 1000);
    });
  });

  describe('daily and weekly', () => {
    it('daily advances one calendar day, preserving wall-clock time', () => {
      const { start } = nextOccurrenceTime(
        makeRow({ start: new Date(2023, 0, 31, 14, 15), recurrence_type: 'daily' }),
      );
      expect(start.getMonth()).toBe(1); // February
      expect(start.getDate()).toBe(1);
      expect(start.getHours()).toBe(14);
      expect(start.getMinutes()).toBe(15);
    });

    it('weekly advances seven days across a month boundary', () => {
      const { start } = nextOccurrenceTime(
        makeRow({ start: new Date(2023, 0, 28, 6, 0), recurrence_type: 'weekly' }),
      );
      expect(start.getMonth()).toBe(1); // February
      expect(start.getDate()).toBe(4);
      expect(start.getHours()).toBe(6);
    });
  });
});
