import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import { key, parsePick, rounds, type Round } from '../core/round';
import { loadProgress, names, percentile, rememberName, ukey, weekLeague, weekRank } from '../core/progress';
import { appSettings } from '../core/settings';
import { ballotView, mine, remainingToday, submit, support, withdraw } from '../core/community';
import { dayNumber, flairText, graceOpen, weeklyTier } from '../../shared/streak';
import { mondayAfter, parseDraft, type CommunityView } from '../../shared/community';
import type { InitResponse, LeagueView, StreakView, View } from '../../shared/contracts';
const service = rounds(redis);
const DAY = 86400000;
export const api = new Hono();
async function currentRound(): Promise<Round | null> {
  if (!context.postId) return null;
  const day = await redis.get(`cc:v1:post:${context.postId}`);
  if (!day) return null;
  const raw = await redis.get(key(day, 'round'));
  const round: Round | null = raw ? JSON.parse(raw) : null;
  return round?.postId === context.postId ? round : null;
}
function shareText(view: View): string {
  const day = view.dayNumber ? `Day ${view.dayNumber}` : view.day;
  const lines = [`Pick the Rare · ${day}`];
  if (view.result?.eligible && view.result.points !== undefined) {
    lines.push(`Score: ${(view.result.points / 100).toFixed(2)}${view.percentile !== undefined ? ` (top ${Math.max(1, 100 - view.percentile)}% of the field)` : ''}`);
    if (view.result.winner) lines.push('Picked the rarest answer.');
    if (view.result.bonus) lines.push(`Prediction bonus +${(view.result.bonus / 100).toFixed(2)}.`);
  } else {
    lines.push(`Too few players today, no competitive score.`);
  }
  if (view.streaks) lines.push(`Streaks: ${view.streaks.play.current} days played, ${view.streaks.contrarian.current} contrarian wins`);
  return lines.join('\n');
}
async function enrich(round: Round): Promise<View> {
  const base = await service.view(round, context.userId);
  const cfg = await appSettings();
  const view: View = {
    ...base,
    dayNumber: dayNumber(round.day, cfg.startDate),
    timezone: cfg.timezone,
    nextOpenAt: Math.ceil((base.serverTime + 1) / DAY) * DAY,
  };
  const user = context.userId;
  if (!user) return view;
  if (await redis.get(ukey(user, 'subscribed'))) view.subscribed = true;
  const progress = await loadProgress(redis, user);
  view.streaks = {
    play: { current: progress.play.current, best: progress.play.best, graceAvailable: graceOpen(progress.play, round.day), lastPlayed: progress.play.lastPlayed },
    contrarian: { current: progress.contra.current, best: progress.contra.best },
  } satisfies StreakView;
  if (base.state === 'revealed' && base.result?.eligible && base.result.points !== undefined) {
    view.percentile = await percentile(redis, round.day, base.result.points);
    const [top, mine] = await Promise.all([weekLeague(redis, round.day), weekRank(redis, round.day, user)]);
    const table = await names(redis, top.map(e => e.user));
    const league: LeagueView = {
      top: top.map(e => ({ rank: e.rank, name: table[e.user] ?? (e.user === user ? 'You' : 'Player'), points: e.points, you: e.user === user })),
      you: mine.rank ? { rank: mine.rank, points: mine.points } : (mine.points ? { rank: null, points: mine.points } : null),
    };
    view.league = league;
    view.shareText = shareText(view);
    view.flair = { optedIn: progress.flairOptIn, text: flairText(progress, weeklyTier(mine.points)) };
  }
  return view;
}
api.get('/init', async c => {
  const round = await currentRound();
  return c.json<InitResponse>(round ? await enrich(round) : {
    state: 'no-content', signedIn: !!context.userId, message: 'The next question is being prepared.',
  });
});
api.post('/pick', async c => {
  if (!context.userId) return c.json({ error: 'Sign in to lock a choice.' }, 401);
  const round = await currentRound();
  if (!round) return c.json({ error: 'This round is unavailable.' }, 404);
  let input;
  try { input = parsePick(await c.req.json<unknown>()); }
  catch { return c.json({ error: 'Choose one answer and an optional prediction.' }, 400); }
  try {
    await service.lock(round, context.userId, input);
    reddit.getCurrentUsername().then(n => rememberName(redis, context.userId!, n)).catch(() => undefined);
    return c.json(await enrich(round));
  } catch {
    return c.json({ error: 'Your save could not be confirmed. Reload to check your receipt before retrying.' }, 409);
  }
});
api.post('/share', async c => {
  const user = context.userId;
  if (!user || !context.postId) return c.json({ error: 'Sign in to share.' }, 401);
  const round = await currentRound();
  if (!round) return c.json({ error: 'This round is unavailable.' }, 404);
  const view = await enrich(round);
  if (!view.shareText) return c.json({ error: 'Nothing to share yet.' }, 400);
  const intentKey = key(round.day, `share:${user}`);
  try {
    await redis.set(intentKey, JSON.stringify({ status: 'posting', at: Date.now() }));
    const comment = await reddit.submitComment({ id: context.postId as `t3_${string}`, text: view.shareText, runAs: 'USER' });
    await redis.set(intentKey, JSON.stringify({ status: 'posted', at: Date.now(), commentId: comment.id }));
    return c.json({ posted: true, commentId: comment.id });
  } catch {
    await redis.set(intentKey, JSON.stringify({ status: 'fallback', at: Date.now() }));
    return c.json({ posted: false, text: view.shareText });
  }
});
api.post('/subscribe', async c => {
  const user = context.userId;
  if (!user) return c.json({ error: 'Sign in to subscribe.' }, 401);
  try {
    await reddit.subscribeToCurrentSubreddit();
    await redis.set(ukey(user, 'subscribed'), '1');
    return c.json({ subscribed: true });
  } catch { return c.json({ subscribed: false, message: 'Subscribing is unavailable right now.' }); }
});
api.post('/flair', async c => {
  const user = context.userId;
  if (!user) return c.json({ error: 'Sign in to use flair.' }, 401);
  const body = await c.req.json<{ optIn: boolean }>().catch(() => null);
  if (!body || typeof body.optIn !== 'boolean') return c.json({ error: 'Bad request.' }, 400);
  const progress = { ...(await loadProgress(redis, user)), flairOptIn: body.optIn };
  await redis.set(ukey(user, 'progress'), JSON.stringify(progress));
  if (!body.optIn) {
    if (context.subredditName) {
      const name = await reddit.getCurrentUsername().catch(() => undefined);
      if (name) await reddit.removeUserFlair(context.subredditName, name).catch(() => undefined);
    }
    return c.json({ optedIn: false, applied: false });
  }
  const round = await currentRound();
  const mine = round ? await weekRank(redis, round.day, user) : { rank: null, points: 0 };
  const text = flairText(progress, weeklyTier(mine.points));
  if (!text || !context.subredditName) return c.json({ optedIn: true, applied: false, message: 'Play a scored day to earn flair.' });
  try {
    const name = await reddit.getCurrentUsername();
    if (!name) throw new Error('no username');
    await reddit.setUserFlair({ subredditName: context.subredditName, username: name, text });
    return c.json({ optedIn: true, applied: true, text });
  } catch {
    return c.json({ optedIn: true, applied: false, message: 'Flair is unavailable here.' });
  }
});

api.get('/community', async c => {
  const user = context.userId;
  const today = new Date().toISOString().slice(0, 10);
  const monday = mondayAfter(today);
  const view: CommunityView = {
    remaining: user ? await remainingToday(redis, user) : 0,
    mine: user ? await mine(redis, user) : [],
    ballot: await ballotView(redis, monday, user),
  };
  return c.json(view);
});
api.post('/community/submit', async c => {
  const user = context.userId;
  if (!user) return c.json({ error: 'Sign in to suggest a question.' }, 401);
  let draft;
  try { draft = parseDraft(await c.req.json<unknown>()); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : 'Check the question and answers.' }, 400); }
  const name = await reddit.getCurrentUsername().catch(() => undefined);
  const result = await submit(redis, user, name ?? '', draft);
  if ('issues' in result) return c.json({ error: result.issues[0], issues: result.issues }, 400);
  return c.json({ id: result.id, state: 'pending' });
});
api.post('/community/withdraw', async c => {
  const user = context.userId;
  if (!user) return c.json({ error: 'Sign in to withdraw.' }, 401);
  const body = await c.req.json<{ id?: string }>().catch(() => null);
  if (!body?.id) return c.json({ error: 'Bad request.' }, 400);
  const problem = await withdraw(redis, user, body.id);
  return problem ? c.json({ error: problem }, 400) : c.json({ withdrawn: true });
});
api.post('/community/support', async c => {
  const user = context.userId;
  if (!user) return c.json({ error: 'Sign in to vote.' }, 401);
  const body = await c.req.json<{ id?: string }>().catch(() => null);
  if (!body?.id) return c.json({ error: 'Bad request.' }, 400);
  const monday = mondayAfter(new Date().toISOString().slice(0, 10));
  const result = await support(redis, monday, user, body.id);
  if ('error' in result) return c.json({ error: result.error }, 400);
  return c.json({ voted: result.voted });
});
api.onError((_error, c) => c.json({ error: 'Temporarily unavailable. Please retry.' }, 503));
