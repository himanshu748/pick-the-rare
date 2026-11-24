import { reddit, redis } from '@devvit/web/server';
import { cutoff, tier, type Question } from '../../shared/rules';
import { dayNumber, weekKey } from '../../shared/streak';
import { ensureWeekSchedule, markUsed, scheduledQuestion } from './community';
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

// Resolves the day's question: frozen schedule first, then the one-time
// playtest sample. Returns null for the explicit no-content state.
async function resolveQuestion(day: string): Promise<{ question: Question; subId: string | null } | null> {
  await ensureWeekSchedule(redis, weekKey(day));
  const scheduled = await scheduledQuestion(redis, day);
  if (scheduled && scheduled !== 'none') {
    const raw = await redis.get(`cc:v1:schedule:${day}`);
    const subId = raw ? (JSON.parse(raw) as { subId?: string }).subId ?? null : null;
    return { question: scheduled, subId };
  }
  if (scheduled === 'none') return null;
  const claimed = await redis.set('cc:v1:playtest-sample-claim', day, { nx: true });
  if (!claimed) return null;
  return { question: { ...sample, tier: tier(day) }, subId: null };
}

export async function createPost(): Promise<string | null> {
  const day = new Date().toISOString().slice(0,10);
  const existing = await redis.get(key(day,'round'));
  if (existing) { const round: Round = JSON.parse(existing); return round.postId; }
  const resolved = await resolveQuestion(day);
  if (!resolved) return null;
  const { question, subId } = resolved;
  const cfg = await appSettings();
  const n = dayNumber(day, cfg.startDate);
  const playtest = subId === null;
  const title = `${n ? `Day ${n}` : 'Day'} · ${question.question}${playtest ? ' · Playtest sample' : ''}`.slice(0, 300);
  // Persist intent before the non-transactional Reddit operation. Never blindly
  // retry an ambiguous post creation; moderators can inspect/adopt its ID.
  await redis.set(key(day,'post-intent'),JSON.stringify({day,question,status:'creating'}));
  const post = await reddit.submitCustomPost({
    title, entry:'default',
    postData:{day,dayNumber:n,question:question.question,tier:question.tier,author:question.author,playtest},
    textFallback:{text: playtest
      ? 'Private-app playtest sample. Pick the least popular answer. Reveal after midnight UTC.'
      : `Community question by ${question.author}. Pick the least popular answer. Reveal after midnight UTC.`},
    styles:{backgroundColor:'#F6F1E7FF',backgroundColorDark:'#171C26FF'},
  });
  await redis.set(key(day,'post-intent'),JSON.stringify({day,question,status:'created',postId:post.id}));
  const round: Round = {day,postId:post.id,question};
  await redis.set(key(day,'round'),JSON.stringify(round));
  await redis.set(`cc:v1:post:${post.id}`,day);
  await redis.zAdd('cc:v1:rounds',{member:day,score:cutoff(day)});
  await redis.set(key(day,'gate'),'open');
  if (subId) await markUsed(redis, day);
  return post.id;
}
export async function dailyTick() {
  // Known, bounded index. One round per day; process the oldest pending close.
  const due = await redis.zRange('cc:v1:rounds',0,0);
  const first = due[0];
  if (first && Date.now() >= cutoff(first.member)) {
    await rounds(redis).finalize(first.member);
    // Exactly-once projections; a throw here keeps the day indexed for retry.
    await project(redis, first.member);
    await redis.zRem('cc:v1:rounds',[first.member]);
  }
  return createPost();
}
