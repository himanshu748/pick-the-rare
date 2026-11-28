import type { RedisClient } from '@devvit/redis';
import { utcDay, score, type Counts, type Choice } from '../../shared/rules';
import { freshProgress, recordOutcome, recordPlay, weekKey, type DayOutcome, type Progress } from '../../shared/streak';
import { key } from './round';

export const ukey = (user: string, suffix: string) => `cc:v1:user:${user}:${suffix}`;
export const wkey = (monday: string) => `cc:v1:week:${monday}:leaderboard`;
export const NAMES = 'cc:v1:names';
const DAY = 86400000;

export async function loadProgress(redis: RedisClient, user: string): Promise<Progress> {
  const raw = await redis.get(ukey(user, 'progress'));
  if (!raw) return freshProgress();
  try { return { ...freshProgress(), ...JSON.parse(raw) }; } catch { return freshProgress(); }
}

export async function rememberName(redis: RedisClient, user: string, name: string | undefined) {
  if (name) await redis.hSet(NAMES, { [user]: name.slice(0, 40) });
}
export async function names(redis: RedisClient, users: string[]): Promise<Record<string, string>> {
  if (!users.length) return {};
  const out: Record<string, string> = {};
  const values = await redis.hMGet(NAMES, users);
  users.forEach((u, i) => { const v = values[i]; if (v) out[u] = v; });
  return out;
}
export type Result = { eligible: boolean; points?: number; base?: number; bonus?: number; winner?: boolean };

async function missedPlayDays(redis: RedisClient, lastPlayed: string | null, day: string, user: string): Promise<string[]> {
  const missed: string[] = [];
  if (!lastPlayed) return missed;
  const end = utcDay(day);
  for (let t = utcDay(lastPlayed) + DAY; t < end && missed.length < 2; t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10);
    const gate = await redis.get(key(date, 'gate'));
    if ((gate === 'open' || gate === 'closed') && !(await redis.get(key(date, `vote:${user}`)))) {
      missed.push(date);
    }
  }
  return missed;
}

// Exactly-once per user/day: the applied marker travels with leaderboard writes
// in one transaction, so retries cannot double-score.
async function applyOutcome(redis: RedisClient, day: string, user: string, counts: Counts, pick: { choice: Choice; prediction: Choice | null }, eligible: boolean): Promise<Result> {
  const applied = key(day, `applied:${user}`);
  if (await redis.get(applied)) {
    const existing = await redis.get(key(day, `result:${user}`));
    return existing ? JSON.parse(existing) : { eligible };
  }
  const scored = score(counts, pick.choice, pick.prediction);
  const result: Result = eligible && scored.eligible ? { eligible: true, points: scored.points, base: scored.base, bonus: scored.bonus, winner: scored.winner } : { eligible: false };
  let progress = await loadProgress(redis, user);
  const missed = await missedPlayDays(redis, progress.play.lastPlayed, day, user);
  progress = recordPlay(progress, day, missed);
  if (progress.cursor !== null && progress.cursor < day) {
    // Missed finalized days between the last outcome and this one break the
    // contrarian streak before today's outcome applies.
    for (let t = utcDay(progress.cursor) + DAY; t < utcDay(day); t += DAY) {
      const d = new Date(t).toISOString().slice(0, 10);
      const prior = await redis.get(key(d, 'final'));
      if (!prior) continue;
      const c: Counts = JSON.parse(prior);
      if (c.reduce((a, b) => a + b, 0) >= 10 && !(await redis.get(key(d, `vote:${user}`)))) {
        progress = recordOutcome(progress, d, 'missed');
      }
    }
  }
  const dayOutcome: DayOutcome = !result.eligible ? 'neutral' : result.winner ? 'win' : 'loss';
  progress = { ...recordOutcome(progress, day, dayOutcome), cursor: day };
  const tx = await redis.watch(applied);
  try {
    if (await redis.get(applied)) return result;
    await tx.multi();
    await tx.set(applied, '1');
    await tx.expire(applied, 90 * DAY / 1000);
    await tx.set(key(day, `result:${user}`), JSON.stringify(result));
    await tx.expire(key(day, `result:${user}`), 90 * DAY / 1000);
    if (result.eligible && result.points !== undefined) {
      await tx.zAdd(key(day, 'leaderboard'), { member: user, score: result.points });
      await tx.expire(key(day, 'leaderboard'), 90 * DAY / 1000);
      await tx.zIncrBy(wkey(weekKey(day)), user, result.points);
      await tx.expire(wkey(weekKey(day)), 90 * DAY / 1000);
    }
    await tx.set(ukey(user, 'progress'), JSON.stringify(progress));
    await tx.exec();
    return result;
  } finally { /* exec errors leave the marker unset so a retry can finish */ }
}

// Runs once after finalize. Idempotent and resumable: a crash leaves applied
// markers per user so a later sweep finishes the rest.
export async function project(redis: RedisClient, day: string, batch = 256): Promise<void> {
  const raw = await redis.get(key(day, 'final'));
  if (!raw) return;
  if (await redis.get(key(day, 'projected'))) return;
  const counts: Counts = JSON.parse(raw);
  const eligible = counts.reduce((a, b) => a + b, 0) >= 10;
  const votes = await redis.zCard(key(day, 'voters'));
  for (let offset = 0; offset < votes; offset += batch) {
    const page = await redis.zRange(key(day, 'voters'), offset, offset + batch - 1);
    for (const { member: user } of page) {
      const vote = await redis.get(key(day, `vote:${user}`));
      if (!vote) continue;
      const pick: { choice: Choice; prediction: Choice | null } = JSON.parse(vote);
      await applyOutcome(redis, day, user, counts, pick, eligible);
    }
  }
  await redis.set(key(day, 'projected'), '1');
  await redis.expire(key(day, 'projected'), 90 * DAY / 1000);
}

export type LeagueEntry = { user: string; points: number; rank: number };
export async function weekLeague(redis: RedisClient, day: string, limit = 5): Promise<LeagueEntry[]> {
  const entries = (await redis.zRange(wkey(weekKey(day)), -limit, -1)).reverse();
  let rank = 0;
  return entries.map((entry, index) => {
    if (index === 0 || entry.score !== entries[index - 1]?.score) rank = index + 1;
    return { user: entry.member, points: entry.score, rank };
  });
}
export async function weekRank(redis: RedisClient, day: string, user: string): Promise<{ rank: number | null; points: number }> {
  const points = (await redis.zScore(wkey(weekKey(day)), user)) ?? 0;
  const entries = await redis.zRange(wkey(weekKey(day)), 0, -1);
  const ahead = entries.filter(e => e.score > points).length;
  return { rank: points > 0 ? ahead + 1 : null, points };
}
export async function percentile(redis: RedisClient, day: string, points: number): Promise<number> {
  const entries = await redis.zRange(key(day, 'leaderboard'), 0, -1);
  if (!entries.length) return 0;
  const below = entries.filter(e => e.score < points).length;
  return Math.round(10000 * below / entries.length) / 100;
}
