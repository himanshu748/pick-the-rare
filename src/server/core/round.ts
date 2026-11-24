import type { BaseView } from '../../shared/contracts';
import type { RedisClient } from '@devvit/redis';
import { cutoff, score, validQuestion, type Choice, type Counts, type Question } from '../../shared/rules';

export type Round = { day: string; postId: string; question: Question };
export type Pick = { choice: Choice; prediction: Choice | null; acceptedAt: number };
export const key = (day: string, suffix: string) => `cc:v1:day:${day}:${suffix}`;
export function choice(value: unknown): value is Choice { return value === 0 || value === 1 || value === 2 || value === 3; }
export function parsePick(value: unknown): { choice: Choice; prediction: Choice | null } {
  if (typeof value !== 'object' || value === null || !('choice' in value) || !choice(value.choice) || !('prediction' in value) || !(value.prediction === null || choice(value.prediction))) throw new Error('Choose one answer and an optional prediction.');
  return { choice: value.choice, prediction: value.prediction };
}
export function shard(user: string): number {
  let hash = 0;
  for (const c of user) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
  return (hash >>> 0) % 64;
}
// The gate changes only on close/void. Independent users do not contend on counts.
export function rounds(redis: RedisClient, now: () => number = Date.now) {
  async function lock(round: Round, user: string, input: ReturnType<typeof parsePick>): Promise<Pick> {
    if (!user || !validQuestion(round.question)) throw new Error('This round is unavailable.');
    const voteKey = key(round.day, `vote:${user}`);
    const gate = key(round.day, 'gate');
    for (let attempt = 0; attempt < 4; attempt++) {
      const tx = await redis.watch(voteKey, gate);
      let queued = false;
      let ended = false;
      try {
        const existing = await redis.get(voteKey);
        if (existing) return JSON.parse(existing);
        const status = await redis.get(gate);
        const acceptedAt = now();
        if (status !== 'open' || acceptedAt >= cutoff(round.day) || acceptedAt < cutoff(round.day) - 86400000) throw new Error('This round is closed.');
        const receipt: Pick = { ...input, acceptedAt };
        const counts = key(round.day, `counts:${shard(user)}`);
        await tx.multi(); queued = true;
        await tx.set(voteKey, JSON.stringify(receipt));
        await tx.expire(voteKey, 90 * 86400);
        await tx.hIncrBy(counts, String(input.choice), 1);
        await tx.expire(counts, 90 * 86400);
        await tx.zAdd(key(round.day, 'voters'), { member: user, score: acceptedAt });
        await tx.expire(key(round.day, 'voters'), 90 * 86400);
        const result = await tx.exec(); ended = true;
        if (result?.length === 6) return receipt;
      } finally {
        if (!ended) { if (queued) await tx.discard(); else await tx.unwatch(); }
      }
      await new Promise(resolve => setTimeout(resolve, 15 + Math.random() * 40));
    }
    throw new Error('Busy saving your choice. Retry to check your receipt.');
  }
  async function finalize(day: string): Promise<Counts | null> {
    if (now() < cutoff(day)) return null;
    const status = await redis.get(key(day, 'gate'));
    if (status === 'void') return null; // Moderator-skipped days never finalize.
    // Closing invalidates every in-flight watched admission before we read counts.
    await redis.set(key(day, 'gate'), 'closed');
    const existing = await redis.get(key(day, 'final'));
    if (existing) return JSON.parse(existing);
    const counts: [number, number, number, number] = [0, 0, 0, 0];
    for (let s = 0; s < 64; s++) {
      const values = await redis.hGetAll(key(day, `counts:${s}`));
      for (const i of [0, 1, 2, 3] as const) counts[i] += Number(values[String(i)] ?? 0);
    }
    score(counts, 0, null); // Validate counters before publishing a snapshot.
    await redis.set(key(day, 'final'), JSON.stringify(counts));
    return counts;
  }
  async function view(round: Round, user: string | undefined): Promise<BaseView> {
    const receipt: Pick | null = user ? JSON.parse(await redis.get(key(round.day, `vote:${user}`)) ?? 'null') : null;
    const status = await redis.get(key(round.day, 'gate'));
    const closed = now() >= cutoff(round.day);
    const counts: Counts | null = closed ? JSON.parse(await redis.get(key(round.day, 'final')) ?? 'null') : null;
    const total = counts?.reduce((a,b) => a+b,0);
    return {
      day: round.day, question: round.question.question, answers: round.question.answers,
      author: round.question.author, closesAt: cutoff(round.day), serverTime: now(), signedIn: !!user, receipt,
      state: status === 'void' ? 'skipped' : closed ? counts ? 'revealed' : 'finalizing' : 'open',
      // No actual counts, total, score or geometry crosses the boundary before close.
      ...(counts ? { total, ...(total !== undefined && total >= 10 ? { counts, result: receipt ? score(counts, receipt.choice, receipt.prediction) : null } : {}) } : {}),
    };
  }
  async function gate(day: string): Promise<'open' | 'closed' | 'void' | 'missing'> {
    const status = await redis.get(key(day, 'gate'));
    return status === 'open' || status === 'closed' || status === 'void' ? status : 'missing';
  }
  return { lock, finalize, view, gate };
}
