import { context, reddit, redis } from '@devvit/web/server';
import { cutoff, tier, validQuestion, type Question } from '../../shared/rules';
import { dayNumber, weekKey } from '../../shared/streak';
import { ensureWeekSchedule, markUsed, scheduledEntry } from './community';
import { project } from './progress';
import { key, rounds, type Round } from './round';
import { appSettings } from './settings';

// Owner authorized one generated playtest question on 2026-11-15.
// This is not a human-authored seed and must not enter the production bank.
const sample: Question = {
  id: 'playtest-sample-1', question: 'Which tiny luxury would you keep?',
  answers: ['A warm towel', 'The window seat', 'An extra ten minutes', 'The last crunchy bite'],
  author: 'AI-assisted playtest sample', tier: 1, approved: true,
};

const privatePlaytestSubreddit = 'pick_the_rare_dev';
const privateSampleClaim = 'cc:v1:playtest-sample-claim';
const roundsIndex = 'cc:v1:rounds';
const inspection = 'Post creation needs inspection before retrying.';

type PostIntent = { day: string; question: Question; subId?: string | null } & (
  | { status: 'creating' }
  | { status: 'created'; postId: string; indexed?: boolean }
);

async function reservePrivateSample(intentKey: string, intent: PostIntent): Promise<boolean> {
  const tx = await redis.watch(privateSampleClaim, intentKey);
  let queued = false;
  let ended = false;
  try {
    if (await redis.get(privateSampleClaim) || await redis.get(intentKey)) return false;
    await tx.multi();
    queued = true;
    // Record the claim and intent together so storage cannot consume the sample on its own.
    await tx.set(privateSampleClaim, intent.day);
    await tx.set(intentKey, JSON.stringify(intent));
    const result = await tx.exec();
    ended = true;
    return !!result?.length;
  } finally {
    if (!ended) {
      if (queued) await tx.discard();
      else await tx.unwatch();
    }
  }
}

async function finishPostIndex(day: string, postId: string): Promise<string> {
  const roundKey = key(day, 'round');
  const intentKey = key(day, 'post-intent');
  const gateKey = key(day, 'gate');
  const tx = await redis.watch(intentKey, roundKey, gateKey);
  let queued = false;
  let ended = false;
  try {
    const raw = await redis.get(intentKey);
    const intent: PostIntent | null = raw ? JSON.parse(raw) : null;
    if (intent?.status !== 'created' || intent.day !== day || intent.postId !== postId) throw new Error(inspection);
    const rawRound = await redis.get(roundKey);
    if (intent.indexed && rawRound) return postId;
    const round: Round = rawRound ? JSON.parse(rawRound) : { day, postId, question: intent.question };
    if (round.postId !== postId || round.day !== day || !round.question || !validQuestion(round.question)) throw new Error(inspection);
    const gate = await redis.get(gateKey);
    const subId = intent.subId === undefined ? round.question.id : intent.subId;
    if (subId) await markUsed(redis, day, subId);

    await tx.multi();
    queued = true;
    await tx.set(`cc:v1:post:${postId}`, day);
    if (gate !== 'closed' && gate !== 'void') {
      if (!gate) await tx.set(gateKey, 'open', { nx: true });
      await tx.zAdd(roundsIndex, { member: day, score: cutoff(day) });
    }
    await tx.set(roundKey, JSON.stringify(round));
    await tx.set(intentKey, JSON.stringify({ ...intent, indexed: true }));
    const result = await tx.exec();
    ended = true;
    if (!result?.length) throw new Error('Post indexing changed. Retry the creation action.');
    return postId;
  } finally {
    if (!ended) {
      if (queued) await tx.discard();
      else await tx.unwatch();
    }
  }
}

async function existingPost(day: string): Promise<string | null> {
  const rawRound = await redis.get(key(day, 'round'));
  const round: Round | null = rawRound ? JSON.parse(rawRound) : null;
  const rawIntent = await redis.get(key(day, 'post-intent'));
  const intent: PostIntent | null = rawIntent ? JSON.parse(rawIntent) : null;
  if (intent?.status === 'created' && (!round || intent.postId === round.postId)) {
    if (!intent.postId) throw new Error(inspection);
    return round && intent.indexed ? round.postId : finishPostIndex(day, intent.postId);
  }
  if (round) return round.postId;
  if (intent) throw new Error(inspection);
  return null;
}

// The recurring job uses human-authored snapshots. Only the moderator's
// explicit action in the private test subreddit can request the labeled sample.
async function resolveQuestion(day: string, includePrivateSample: boolean): Promise<{ question: Question; subId: string | null; privateSample?: true } | null> {
  await ensureWeekSchedule(redis, weekKey(day));
  const scheduled = await scheduledEntry(redis, day);
  if (scheduled && scheduled !== 'none') {
    return { question: scheduled.question, subId: scheduled.subId ?? null };
  }
  if (!includePrivateSample || context.subredditName?.toLowerCase() !== privatePlaytestSubreddit) return null;
  return { question: { ...sample, tier: tier(day) }, subId: null, privateSample: true };
}

export async function createPost({ includePrivateSample = false } = {}): Promise<string | null> {
  const day = new Date().toISOString().slice(0, 10);
  const existing = await existingPost(day);
  if (existing) return existing;
  const resolved = await resolveQuestion(day, includePrivateSample);
  if (!resolved) return null;
  const { question, subId, privateSample } = resolved;
  const cfg = await appSettings();
  const n = dayNumber(day, cfg.startDate);
  const playtest = subId === null;
  const title = `${n ? `Day ${n}` : 'Day'} · ${question.question}${playtest ? ' · Playtest sample' : ''}`.slice(0, 300);
  // Only one caller can reserve the non-transactional Reddit operation. A
  // lost reply leaves the intent in creating state for operator inspection.
  const intentKey = key(day, 'post-intent');
  const intent: PostIntent = { day, question, subId, status: 'creating' };
  const reserved = privateSample
    ? await reservePrivateSample(intentKey, intent)
    : await redis.set(intentKey, JSON.stringify(intent), { nx: true });
  if (!reserved) {
    const winner = await existingPost(day);
    if (winner) return winner;
    if (privateSample && await redis.get(privateSampleClaim)) return null;
    throw new Error(inspection);
  }
  const post = await reddit.submitCustomPost({
    title, entry:'default',
    postData:{day,dayNumber:n,question:question.question,tier:question.tier,author:question.author,playtest},
    textFallback:{text: playtest
      ? 'Private-app playtest sample. Pick the least popular answer. Reveal after midnight UTC.'
      : `Community question by ${question.author}. Pick the least popular answer. Reveal after midnight UTC.`},
    styles:{backgroundColor:'#F6F1E7FF',backgroundColorDark:'#171C26FF'},
  });
  await redis.set(intentKey, JSON.stringify({ ...intent, status: 'created', postId: post.id }));
  return finishPostIndex(day, post.id);
}
export async function dailyTick() {
  // Known, bounded index. One round per day; process the oldest pending close.
  const due = await redis.zRange(roundsIndex, 0, 0);
  const first = due[0];
  if (first && Date.now() >= cutoff(first.member)) {
    await rounds(redis).finalize(first.member);
    // Exactly-once projections; a throw here keeps the day indexed for retry.
    await project(redis, first.member);
    await redis.zRem(roundsIndex, [first.member]);
  }
  return createPost();
}
