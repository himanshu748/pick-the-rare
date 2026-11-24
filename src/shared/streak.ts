import { utcDay } from './rules';
const DAY = 86400000;
export type PlayStreak = {
  current: number;
  best: number;
  lastPlayed: string | null;
  graceUsedOn: string | null;
};
export type ContrarianStreak = { current: number; best: number; lastScored: string | null };
export type Progress = {
  play: PlayStreak;
  contra: ContrarianStreak;
  cursor: string | null;
  flairOptIn: boolean;
};
export const freshProgress = (): Progress => ({
  play: { current: 0, best: 0, lastPlayed: null, graceUsedOn: null },
  contra: { current: 0, best: 0, lastScored: null },
  cursor: null,
  flairOptIn: false,
});
const daysBetween = (a: string, b: string) => Math.round((utcDay(b) - utcDay(a)) / DAY);
export const graceOpen = (play: PlayStreak, missedDay: string): boolean =>
  play.graceUsedOn === null || daysBetween(play.graceUsedOn, missedDay) >= 7;
export function recordPlay(progress: Progress, day: string): Progress {
  const play = { ...progress.play };
  if (play.lastPlayed === day) return { ...progress, play };
  if (play.lastPlayed === null) {
    play.current = 1;
  } else {
    const gap = daysBetween(play.lastPlayed, day);
    if (gap <= 0) return { ...progress, play };
    if (gap === 1) {
      play.current += 1;
    } else if (gap === 2) {
      const missed = new Date(utcDay(day) - DAY).toISOString().slice(0, 10);
      if (!graceOpen(play, missed)) {
        play.current = 1;
      } else {
        play.graceUsedOn = missed;
        play.current += 1;
      }
    } else {
      play.current = 1;
    }
  }
  play.lastPlayed = day;
  play.best = Math.max(play.best, play.current);
  return { ...progress, play };
}
export type DayOutcome = 'win' | 'loss' | 'missed' | 'neutral';
export function recordOutcome(progress: Progress, day: string, outcome: DayOutcome): Progress {
  if (outcome === 'neutral') return progress;
  if (progress.cursor !== null && daysBetween(progress.cursor, day) <= 0) return progress;
  const contra = { ...progress.contra };
  if (outcome === 'win') {
    contra.current += 1;
    contra.lastScored = day;
  } else {
    contra.current = 0;
  }
  contra.best = Math.max(contra.best, contra.current);
  return { ...progress, contra, cursor: day };
}
export function weekKey(day: string): string {
  const d = new Date(utcDay(day));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function dayNumber(day: string, startDate: string): number | null {
  const n = daysBetween(startDate, day) + 1;
  return n >= 1 ? n : null;
}
export const FLAIR_TIERS = [
  { min: 0, name: 'Starter' },
  { min: 15000, name: 'Scout' },
  { min: 30000, name: 'Contrarian' },
  { min: 45000, name: 'Outlier' },
] as const;
export function weeklyTier(weeklyPointsHundredths: number): string | null {
  if (weeklyPointsHundredths <= 0) return null;
  let tier: string | null = null;
  for (const t of FLAIR_TIERS) if (weeklyPointsHundredths >= t.min) tier = t.name;
  return tier;
}
export function flairText(progress: Progress, tier: string | null): string | null {
  const milestone = progress.play.best >= 30 ? '30-day' : progress.play.best >= 7 ? '7-day' : progress.play.best >= 3 ? '3-day' : null;
  const parts = [tier ? `${tier} league` : null, milestone ? `${milestone} streak` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
