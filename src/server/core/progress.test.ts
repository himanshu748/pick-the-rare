import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/web/server';
import { expect } from 'vitest';
import { cutoff, type Counts } from '../../shared/rules';
import { weekKey } from '../../shared/streak';
import { key, rounds, type Round } from './round';
import { loadProgress, project, wkey, weekRank } from './progress';
const test = createDevvitTest();
const question = { id: 'fixture', question: 'Synthetic test fixture', answers: ['Fixture A', 'Fixture B', 'Fixture C', 'Fixture D'], author: 'test fixture', tier: 1, approved: true };
const dayRound = (day: string): Round => ({ day, postId: `t3_${day}`, question });
const openAt = (day: string) => () => cutoff(day) - 1000;
const closedAt = (day: string) => () => cutoff(day);
async function seededFinal(day: string, counts: Counts, votes: Record<string, { choice: number; prediction: number | null }> = {}) {
  await redis.set(key(day, 'gate'), 'closed');
  await redis.set(key(day, 'final'), JSON.stringify(counts));
  for (const [user, pick] of Object.entries(votes)) {
    await redis.set(key(day, `vote:${user}`), JSON.stringify({ ...pick, acceptedAt: 1 }));
    await redis.zAdd(key(day, 'voters'), { member: user, score: 1 });
  }
}
test('projection writes results, leaderboards and streaks exactly once', async () => {
  const day = '2026-11-16';
  const round = dayRound(day);
  await redis.set(key(day, 'gate'), 'open');
  const service = rounds(redis, openAt(day));
  // t2_p0 picks the unique rarest answer; everyone else fills the other three.
  const picks = [1, 0, 0, 2, 2, 2, 3, 3, 3, 3];
  for (let i = 0; i < 10; i++) {
    await service.lock(round, `t2_p${i}`, { choice: picks[i] as 0 | 1 | 2 | 3, prediction: 0 });
  }
  await rounds(redis, closedAt(day)).finalize(day);
  await project(redis, day);
  expect(await redis.get(key(day, 'projected'))).toBe('1');
  const winner = await redis.get(key(day, 'result:t2_p0'));
  expect(winner && JSON.parse(winner)).toMatchObject({ eligible: true, points: 9000, winner: true });
  const progress = await loadProgress(redis, 't2_p0');
  expect(progress.play).toMatchObject({ current: 1, lastPlayed: day });
  expect(progress.contra).toMatchObject({ current: 1, lastScored: day });
  expect(await redis.zScore(key(day, 'leaderboard'), 't2_p0')).toBe(9000);
  expect(await redis.zScore(wkey(weekKey(day)), 't2_p0')).toBe(9000);
  await project(redis, day);
  expect(await redis.zScore(wkey(weekKey(day)), 't2_p0')).toBe(9000);
});
test('low turnout days are neutral for streaks and leagues', async () => {
  const day = '2026-11-17';
  await seededFinal(day, [2, 0, 0, 0], { t2_lone: { choice: 0, prediction: null } });
  await project(redis, day);
  expect(await redis.get(key(day, 'projected'))).toBe('1');
  expect(await redis.get(key(day, 'result:t2_lone'))).toBe(JSON.stringify({ eligible: false }));
  const progress = await loadProgress(redis, 't2_lone');
  expect(progress.play).toMatchObject({ current: 1, lastPlayed: day });
  expect(progress.contra.current).toBe(0);
  expect(await redis.zCard(key(day, 'leaderboard'))).toBe(0);
});
test('a missed eligible day breaks the contrarian streak before the next win', async () => {
  const d1 = '2026-11-18', d2 = '2026-11-19', d3 = '2026-11-20';
  await seededFinal(d1, [2, 1, 4, 3], { t2_streak: { choice: 1, prediction: null } });
  await seededFinal(d2, [5, 5, 0, 0]);
  await seededFinal(d3, [2, 1, 4, 3], { t2_streak: { choice: 1, prediction: null } });
  await project(redis, d1);
  expect((await loadProgress(redis, 't2_streak')).contra.current).toBe(1);
  await project(redis, d3);
  const progress = await loadProgress(redis, 't2_streak');
  expect(progress.contra).toMatchObject({ current: 1, best: 1 });
  expect(progress.play.current).toBe(2);
});
test('weekRank reports weekly points and rank', async () => {
  const day = '2026-11-16';
  await redis.zIncrBy(wkey(weekKey(day)), 't2_a', 5000);
  await redis.zIncrBy(wkey(weekKey(day)), 't2_b', 8000);
  const rank = await weekRank(redis, day, 't2_b');
  expect(rank).toMatchObject({ rank: 1, points: 8000 });
});
