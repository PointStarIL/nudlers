import { describe, it, expect } from 'vitest';
import { evaluateDailyCronGuard } from '../utils/cronGuards';

const at = (yyyy: number, mm: number, dd: number, hh: number) =>
    new Date(yyyy, mm - 1, dd, hh, 0, 0, 0);

describe('evaluateDailyCronGuard', () => {
    describe('enabled gating', () => {
        it('skips with reason=disabled when enabledValue is missing', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: undefined,
                hourValue: 10,
                lastRunValue: null,
                defaultHour: 3,
                now: at(2026, 4, 25, 10),
            });
            expect(result).toEqual({ shouldRun: false, reason: 'disabled' });
        });

        it('skips with reason=disabled when enabledValue is false', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: false,
                hourValue: 10,
                lastRunValue: null,
                defaultHour: 3,
                now: at(2026, 4, 25, 10),
            });
            expect(result.shouldRun).toBe(false);
            if (!result.shouldRun) expect(result.reason).toBe('disabled');
        });

        it('passes the enabled check when value is boolean true', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: true,
                hourValue: 10,
                lastRunValue: null,
                defaultHour: 3,
                now: at(2026, 4, 25, 10),
            });
            expect(result.shouldRun).toBe(true);
        });

        it('passes the enabled check when value is JSON-string "true"', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: 'true',
                hourValue: 10,
                lastRunValue: null,
                defaultHour: 3,
                now: at(2026, 4, 25, 10),
            });
            expect(result.shouldRun).toBe(true);
        });

        it('skips when enabledValue is the number 1 (not coerced)', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: 1,
                hourValue: 10,
                lastRunValue: null,
                defaultHour: 3,
                now: at(2026, 4, 25, 10),
            });
            expect(result.shouldRun).toBe(false);
            if (!result.shouldRun) expect(result.reason).toBe('disabled');
        });
    });

    describe('hour gating', () => {
        it('skips with hour_mismatch when current hour differs from target', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: true,
                hourValue: 10,
                lastRunValue: null,
                defaultHour: 3,
                now: at(2026, 4, 25, 9),
            });
            expect(result).toEqual({
                shouldRun: false,
                reason: 'hour_mismatch',
                currentHour: 9,
                targetHour: 10,
            });
        });

        it('falls back to defaultHour when hourValue is missing', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: true,
                hourValue: undefined,
                lastRunValue: null,
                defaultHour: 3,
                now: at(2026, 4, 25, 3),
            });
            expect(result.shouldRun).toBe(true);
            if (result.shouldRun) expect(result.targetHour).toBe(3);
        });

        it('parses string hour values like "10"', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: true,
                hourValue: '10',
                lastRunValue: null,
                defaultHour: 3,
                now: at(2026, 4, 25, 10),
            });
            expect(result.shouldRun).toBe(true);
        });

        it('accepts numeric hour values like 10', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: true,
                hourValue: 10,
                lastRunValue: null,
                defaultHour: 3,
                now: at(2026, 4, 25, 10),
            });
            expect(result.shouldRun).toBe(true);
        });
    });

    describe('already-ran-today gating', () => {
        it('skips with already_ran_today when lastRun ISO date matches today', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: true,
                hourValue: 10,
                lastRunValue: '2026-04-25T08:00:00.295Z',
                defaultHour: 3,
                now: at(2026, 4, 25, 10),
            });
            expect(result).toEqual({
                shouldRun: false,
                reason: 'already_ran_today',
                lastRunDate: '2026-04-25',
                today: '2026-04-25',
            });
        });

        it('skips when lastRun is a date-only string matching today', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: true,
                hourValue: 10,
                lastRunValue: '2026-04-25',
                defaultHour: 3,
                now: at(2026, 4, 25, 10),
            });
            expect(result.shouldRun).toBe(false);
            if (!result.shouldRun) expect(result.reason).toBe('already_ran_today');
        });

        it('strips JSON-encoded quotes around the lastRun value', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: true,
                hourValue: 10,
                lastRunValue: '"2026-04-25T08:00:00.295Z"',
                defaultHour: 3,
                now: at(2026, 4, 25, 10),
            });
            expect(result.shouldRun).toBe(false);
            if (!result.shouldRun) expect(result.reason).toBe('already_ran_today');
        });

        it('runs when lastRun is yesterday', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: true,
                hourValue: 10,
                lastRunValue: '2026-04-24T10:00:00.000Z',
                defaultHour: 3,
                now: at(2026, 4, 25, 10),
            });
            expect(result.shouldRun).toBe(true);
        });

        it('runs when lastRun is empty string', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: true,
                hourValue: 10,
                lastRunValue: '',
                defaultHour: 3,
                now: at(2026, 4, 25, 10),
            });
            expect(result.shouldRun).toBe(true);
        });

        it('runs when lastRun is null', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: true,
                hourValue: 10,
                lastRunValue: null,
                defaultHour: 3,
                now: at(2026, 4, 25, 10),
            });
            expect(result.shouldRun).toBe(true);
        });
    });

    describe('happy path', () => {
        it('returns shouldRun=true with targetHour and today', () => {
            const result = evaluateDailyCronGuard({
                enabledValue: true,
                hourValue: 10,
                lastRunValue: '2026-04-24T10:00:00.000Z',
                defaultHour: 3,
                now: at(2026, 4, 25, 10),
            });
            expect(result).toEqual({
                shouldRun: true,
                targetHour: 10,
                today: '2026-04-25',
            });
        });
    });
});
