import { settings } from '@devvit/web/server';
import { utcDay } from '../../shared/rules';

export type AppSettings = { startDate: string; timezone: string };
const FALLBACK: AppSettings = { startDate: '2026-11-20', timezone: 'UTC' };

export async function appSettings(): Promise<AppSettings> {
  try {
    const [start, tz] = await Promise.all([
      settings.get<string>('start-date'),
      settings.get<string>('display-timezone'),
    ]);
    const startDate = typeof start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(start) ? (utcDay(start), start) : FALLBACK.startDate;
    let timezone = FALLBACK.timezone;
    if (typeof tz === 'string' && tz.trim()) {
      try { new Intl.DateTimeFormat('en', { timeZone: tz.trim() }); timezone = tz.trim(); } catch { /* keep fallback */ }
    }
    return { startDate, timezone };
  } catch {
    return FALLBACK;
  }
}
