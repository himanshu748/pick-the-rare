import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, redis } from '@devvit/web/server';
import { createPost } from '../core/post';
import { ensureWeekSchedule, pending, queueCounts } from '../core/community';
import { reviewForm } from './forms';
import { project } from '../core/progress';
import { key } from '../core/round';
import { cutoff, utcDay } from '../../shared/rules';
import { weekKey } from '../../shared/streak';
export const menu = new Hono();
const toast = (showToast: string) => ({ showToast } satisfies UiResponse);
async function dayOf(): Promise<{ day: string; gate: string | undefined } | { error: string }> {
  if (!context.postId) return { error: 'This action runs from a round post.' };
  const day = await redis.get(`cc:v1:post:${context.postId}`);
  if (!day) return { error: 'This post is not bound to a round.' };
  return { day, gate: (await redis.get(key(day, 'gate'))) ?? undefined };
}
menu.post('/post-create', async c => {
  try {
    const id = await createPost();
    return c.json<UiResponse>(id ? { navigateTo: `https://www.reddit.com/comments/${id.slice(3)}` } : { showToast: 'The sample has already been used. Add authored content for future rounds.' });
  } catch { return c.json<UiResponse>({ showToast: 'Creation needs inspection. Check the stored intent before retrying.' }, 500); }
});
menu.post('/skip', async c => {
  const found = await dayOf();
  if ('error' in found) return c.json<UiResponse>(toast(found.error), 400);
  if (found.gate === 'closed') return c.json<UiResponse>(toast('This round already closed and finalized.'));
  if (found.gate === 'void') return c.json<UiResponse>(toast('This round is already skipped.'));
  await redis.set(key(found.day, 'gate'), 'void');
  return c.json<UiResponse>(toast('Day skipped. It is neutral for scores, streaks and leagues.'));
});
menu.post('/regen', async c => {
  const found = await dayOf();
  if ('error' in found) return c.json<UiResponse>(toast(found.error), 400);
  if (found.gate === 'closed' || (await redis.get(key(found.day, 'final')))) {
    return c.json<UiResponse>(toast('Finalized rounds cannot be regenerated.'));
  }
  if (Date.now() >= cutoff(found.day)) return c.json<UiResponse>(toast('The round is past cutoff. Skip it instead.'));
  const voters = await redis.zCard(key(found.day, 'voters'));
  if (voters > 0) return c.json<UiResponse>(toast(`${voters} players already locked. Skip the day instead of regenerating.`));
  await redis.del(key(found.day, 'round'), key(found.day, 'gate'), `cc:v1:post:${context.postId}`, key(found.day, 'post-intent'));
  await redis.zRem('cc:v1:rounds', [found.day]);
  try {
    const id = await createPost();
    return c.json<UiResponse>(id ? { navigateTo: `https://www.reddit.com/comments/${id.slice(3)}` } : { showToast: 'Round cleared. No remaining authored content is schedulable.' });
  } catch { return c.json<UiResponse>({ showToast: 'Cleared, but recreation needs inspection.' }, 500); }
});
menu.post('/adopt', async c => {
  const found = await dayOf();
  if ('error' in found) return c.json<UiResponse>(toast(found.error), 400);
  const intent = await redis.get(key(found.day, 'post-intent'));
  if (!intent) return c.json<UiResponse>(toast('No post intent is stored for this day.'));
  const parsed: { status?: string; postId?: string } = JSON.parse(intent);
  if (parsed.status === 'created' && parsed.postId) {
    await redis.set(`cc:v1:post:${parsed.postId}`, found.day);
    const raw = await redis.get(key(found.day, 'round'));
    if (raw) {
      const round = JSON.parse(raw);
      round.postId = parsed.postId;
      await redis.set(key(found.day, 'round'), JSON.stringify(round));
    }
    return c.json<UiResponse>(toast(`Bound ${parsed.postId} to ${found.day}.`));
  }
  return c.json<UiResponse>({ showToast: `Intent is '${parsed.status ?? 'unknown'}'. If a post exists, add its id to the stored intent, then rerun adopt.` });
});
menu.post('/backfill', async c => {
  const found = await dayOf();
  if ('error' in found) return c.json<UiResponse>(toast(found.error), 400);
  if (!(await redis.get(key(found.day, 'final')))) return c.json<UiResponse>(toast('This day is not finalized yet.'));
  if (await redis.get(key(found.day, 'projected'))) return c.json<UiResponse>(toast('Projections already complete for this day.'));
  try {
    await project(redis, found.day);
    return c.json<UiResponse>(toast(`Projections finished for ${found.day}.`));
  } catch { return c.json<UiResponse>(toast('Projection failed. Rerun backfill to resume where it left off.'), 500); }
});
menu.post('/review-queue', async c => {
  const [first, counts] = await Promise.all([pending(redis, 1).then(p => p[0] ?? null), queueCounts(redis)]);
  return c.json<UiResponse>(reviewForm(first, counts));
});
menu.post('/reschedule-week', async c => {
  // Lets newly approved content fill this week's remaining no-content days.
  // Frozen question snapshots stay untouched.
  const monday = weekKey(new Date().toISOString().slice(0, 10));
  const today = new Date().toISOString().slice(0, 10);
  let cleared = 0;
  for (let i = 0; i < 7; i++) {
    const day = new Date(utcDay(monday) + i * 86400000).toISOString().slice(0, 10);
    if (day < today) continue;
    const raw = await redis.get(`cc:v1:schedule:${day}`);
    if (raw && 'none' in JSON.parse(raw)) { await redis.del(`cc:v1:schedule:${day}`); cleared++; }
  }
  if (cleared) await ensureWeekSchedule(redis, monday);
  const counts = await queueCounts(redis);
  return c.json<UiResponse>(toast(`${cleared ? `Rescheduled ${cleared} day(s).` : 'Nothing to reschedule.'} Queue: ${counts.pending} pending, ${counts.approved} approved.`));
});
menu.post('/inspect', async c => {
  const found = await dayOf();
  if ('error' in found) return c.json<UiResponse>(toast(found.error), 400);
  const [gate, intent, final, projected] = await Promise.all([
    redis.get(key(found.day, 'gate')), redis.get(key(found.day, 'post-intent')),
    redis.get(key(found.day, 'final')), redis.get(key(found.day, 'projected')),
  ]);
  const counts = final ? (JSON.parse(final) as number[]).reduce((a, b) => a + b, 0) : 0;
  return c.json<UiResponse>(toast(`${found.day}: gate=${gate ?? 'none'}, total=${counts}, projected=${projected ? 'yes' : 'no'}, intent=${intent ?? 'none'}`));
});
