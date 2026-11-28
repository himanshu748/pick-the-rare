import type { Choice, Counts, score } from './rules';
export type Pick = { choice: Choice; prediction: Choice | null; acceptedAt: number };
export type StreakView = {
  play: { current: number; best: number; graceAvailable: boolean; lastPlayed: string | null };
  contrarian: { current: number; best: number };
};
export type LeagueView = {
  top: { rank: number; name: string; points: number; you: boolean }[];
  you: { rank: number | null; points: number } | null;
};
export type BaseView = {
  day: string; question: string; answers: readonly string[]; author: string;
  closesAt: number; serverTime: number; signedIn: boolean; receipt: Pick | null;
  state: 'open' | 'finalizing' | 'revealed' | 'skipped'; total?: number; counts?: Counts;
  result?: ReturnType<typeof score> | null;
};
export type View = BaseView & {
  dayNumber: number | null; nextOpenAt: number; timezone: string;
  percentile?: number; streaks?: StreakView; league?: LeagueView; shareText?: string;
  flair?: { optedIn: boolean; text: string | null }; subscribed?: boolean;
};
export type InitResponse = View | { state: 'no-content'; signedIn: boolean; message: string };
