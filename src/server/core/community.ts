import type { RedisClient } from '@devvit/redis';
import { tier, utcDay, validQuestion, type Question } from '../../shared/rules';
import {
  MAX_SUBMISSIONS_PER_DAY, draftFlags, draftIssues, parseDraft, rotateOrder,
  type CommunityView, type Submission,
} from '../../shared/community';
import { ukey } from './progress';

const DAY = 86400000;
const QUEUE = 'cc:v1:queue';
const APPROVED = 'cc:v1:approved';
const AUDIT = 'cc:v1:audit';
const subKey = (id: string) => `cc:v1:sub:${id}`;
const claimedKey = (id: string) => `cc:v1:claimed:${id}`;
const scheduleKey = (day: string) => `cc:v1:schedule:${day}`;
const ballotKey = (monday: string, suffix: string) => `cc:v1:ballot:${monday}:${suffix}`;

export type Schedule = { day: string; question: Question; subId: string } | { day: string; none: true; reason: string };

async function audit(redis: RedisClient, action: string, id: string, actor: string, at = Date.now()) {
  await redis.zAdd(AUDIT, { member: JSON.stringify({ at, action, id, actor }), score: at });
  await redis.zRemRangeByRank(AUDIT, 0, -501);
}

export async function loadSub(redis: RedisClient, id: string): Promise<Submission | null> {
  const raw = await redis.get(subKey(id));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function submit(redis: RedisClient, user: string, name: string, draft: ReturnType<typeof parseDraft>, now = Date.now()): Promise<{ id: string } | { issues: string[] }> {
  const issues = draftIssues(draft);
  if (issues.length) return { issues };
  const day = new Date(now).toISOString().slice(0, 10);
  const rateKey = ukey(user, `subcount:${day}`);
  const id = `s-${Math.random().toString(36).slice(2, 10)}`;
  const sub: Submission = {
    id, question: draft.question, answers: draft.answers,
    authorId: user, author: name ? `u/${name}` : 'an anonymous redditor',
    suggestedTier: draft.tier ?? 1, tier: null, state: 'pending',
    submittedAt: now, reviewedAt: null, flags: draftFlags(draft),
    history: [{ at: now, action: 'submitted', actor: user }],
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const tx = await redis.watch(subKey(id), rateKey);
    let queued = false, ended = false;
    try {
      const used = Number(await redis.get(rateKey) ?? 0);
      if (used >= MAX_SUBMISSIONS_PER_DAY) return { issues: [`You can suggest up to ${MAX_SUBMISSIONS_PER_DAY} questions per day.`] };
      await tx.multi(); queued = true;
      await tx.set(subKey(id), JSON.stringify(sub));
      await tx.zAdd(QUEUE, { member: id, score: now });
      await tx.zAdd(ukey(user, 'subs'), { member: id, score: now });
      await tx.incrBy(rateKey, 1);
      await tx.expire(rateKey, 2 * DAY / 1000);
      const result = await tx.exec(); ended = true;
      if (result?.length === 5) {
        await audit(redis, 'submitted', id, user, now);
        return { id };
      }
    } finally {
      if (!ended) { if (queued) await tx.discard(); else await tx.unwatch(); }
    }
    await new Promise(r => setTimeout(r, 15 + Math.random() * 40));
  }
  return { issues: ['Busy. Retry your submission.'] };
}

export async function mine(redis: RedisClient, user: string): Promise<CommunityView['mine']> {
  const entries = await redis.zRange(ukey(user, 'subs'), -20, -1);
  const out: CommunityView['mine'] = [];
  for (const { member } of entries.reverse()) {
    const sub = await loadSub(redis, member);
    if (sub) out.push({ id: sub.id, question: sub.question, state: sub.state, tier: sub.tier ?? sub.suggestedTier });
  }
  return out;
}

export async function remainingToday(redis: RedisClient, user: string, now = Date.now()): Promise<number> {
  const day = new Date(now).toISOString().slice(0, 10);
  return Math.max(0, MAX_SUBMISSIONS_PER_DAY - Number(await redis.get(ukey(user, `subcount:${day}`)) ?? 0));
}

export async function withdraw(redis: RedisClient, user: string, id: string): Promise<string | null> {
  const sub = await loadSub(redis, id);
  if (!sub) return 'That submission no longer exists.';
  if (sub.authorId !== user) return 'You can only withdraw your own submissions.';
  if (sub.state !== 'pending') return 'Only pending submissions can be withdrawn.';
  sub.state = 'withdrawn';
  sub.history.push({ at: Date.now(), action: 'withdrawn', actor: user });
  await redis.set(subKey(id), JSON.stringify(sub));
  await redis.expire(subKey(id), 30 * DAY / 1000);
  await redis.zRem(QUEUE, [id]);
  await audit(redis, 'withdrawn', id, user);
  return null;
}

export async function pending(redis: RedisClient, limit = 25): Promise<Submission[]> {
  const members = await redis.zRange(QUEUE, 0, limit - 1);
  const out: Submission[] = [];
  for (const { member } of members) {
    const sub = await loadSub(redis, member);
    if (sub && sub.state === 'pending') out.push(sub);
    else if (!sub) await redis.zRem(QUEUE, [member]);
  }
  return out;
}

export async function queueCounts(redis: RedisClient): Promise<{ pending: number; approved: number }> {
  return { pending: await redis.zCard(QUEUE), approved: await redis.zCard(APPROVED) };
}

export async function review(redis: RedisClient, id: string, action: 'approve' | 'reject', tierAssigned: number, actor: string, note?: string): Promise<string> {
  const sub = await loadSub(redis, id);
  if (!sub) return 'That submission no longer exists.';
  if (sub.state !== 'pending') return `Already ${sub.state}; skipped.`;
  const at = Date.now();
  if (action === 'approve') {
    if (!Number.isInteger(tierAssigned) || tierAssigned < 1 || tierAssigned > 7) return 'Pick a tier from 1 to 7.';
    sub.state = 'approved';
    sub.tier = tierAssigned;
    sub.reviewedAt = at;
    await redis.zAdd(APPROVED, { member: id, score: at });
  } else {
    sub.state = 'rejected';
    sub.reviewedAt = at;
    await redis.expire(subKey(id), 30 * DAY / 1000);
  }
  sub.history.push({ at, action, actor, ...(note ? { note } : {}) } as Submission['history'][number]);
  await redis.set(subKey(id), JSON.stringify(sub));
  await redis.zRem(QUEUE, [id]);
  await audit(redis, action === 'approve' ? `approved:t${tierAssigned}` : 'rejected', id, actor, at);
  return action === 'approve' ? `Approved at tier ${tierAssigned}.` : 'Rejected.';
}

// --- Weekly ballot -----------------------------------------------------------

// The open ballot is keyed by the upcoming Monday; it freezes when that week is
// scheduled. Support totals stay hidden until the freeze.
export async function ballotView(redis: RedisClient, monday: string, user: string | undefined): Promise<CommunityView['ballot']> {
  const frozen = !!(await redis.get(ballotKey(monday, 'frozen')));
  const approved = await redis.zRange(APPROVED, 0, -1);
  const candidates = [];
  for (const { member } of approved) {
    const sub = await loadSub(redis, member);
    if (!sub || sub.state !== 'approved' || await redis.get(claimedKey(member))) continue;
    candidates.push({ id: sub.id, question: sub.question, answers: sub.answers, author: sub.author });
  }
  const ordered = user ? rotateOrder(candidates, user) : candidates;
  const yourVote = user ? (JSON.parse(await redis.get(ballotKey(monday, `vote:${user}`)) ?? 'null')?.id ?? null) : null;
  const withTotals = await Promise.all(ordered.map(async c => ({
    ...c,
    ...(frozen ? { support: (await redis.zScore(ballotKey(monday, 'rank'), c.id)) ?? 0 } : {}),
  })));
  return {
    week: monday, closesAt: utcDay(monday), frozen,
    yourVote: withTotals.some(c => c.id === yourVote) ? yourVote : null,
    candidates: withTotals,
  };
}

export async function support(redis: RedisClient, monday: string, user: string, id: string, now = Date.now()): Promise<{ voted: string } | { error: string }> {
  if (now >= utcDay(monday)) return { error: 'This ballot is closed.' };
  const sub = await loadSub(redis, id);
  if (!sub || sub.state !== 'approved') return { error: 'That question is not on the ballot.' };
  if (sub.authorId === user) return { error: 'You cannot support your own question.' };
  const voteKey = ballotKey(monday, `vote:${user}`);
  const rank = ballotKey(monday, 'rank');
  for (let attempt = 0; attempt < 4; attempt++) {
    const tx = await redis.watch(voteKey);
    let queued = false, ended = false;
    try {
      const existing = await redis.get(voteKey);
      if (existing) return { voted: JSON.parse(existing).id };
      await tx.multi(); queued = true;
      await tx.set(voteKey, JSON.stringify({ id, at: now }));
      await tx.expire(voteKey, 90 * DAY / 1000);
      await tx.zIncrBy(rank, id, 1);
      await tx.expire(rank, 90 * DAY / 1000);
      const result = await tx.exec(); ended = true;
      if (result?.length === 4) {
        await audit(redis, 'ballot-vote', id, user, now);
        return { voted: id };
      }
    } finally {
      if (!ended) { if (queued) await tx.discard(); else await tx.unwatch(); }
    }
    await new Promise(r => setTimeout(r, 15 + Math.random() * 40));
  }
  return { error: 'Busy recording support. Retry.' };
}

// --- Scheduling ---------------------------------------------------------------

// Freezing is the single writer of the week's ordered candidate list.
async function frozenOrder(redis: RedisClient, monday: string): Promise<string[]> {
  const existing = await redis.get(ballotKey(monday, 'frozen'));
  if (existing) return JSON.parse(existing);
  const approved = await redis.zRange(APPROVED, 0, -1);
  const ranked: { id: string; support: number; approvedAt: number }[] = [];
  for (const { member, score } of approved) {
    const sub = await loadSub(redis, member);
    if (!sub || sub.state !== 'approved') continue;
    ranked.push({ id: member, support: (await redis.zScore(ballotKey(monday, 'rank'), member)) ?? 0, approvedAt: score });
  }
  ranked.sort((a, b) => b.support - a.support || a.approvedAt - b.approvedAt || a.id.localeCompare(b.id));
  const order = ranked.map(r => r.id);
  await redis.set(ballotKey(monday, 'frozen'), JSON.stringify(order));
  await redis.expire(ballotKey(monday, 'frozen'), 90 * DAY / 1000);
  return order;
}

// Materializes each unscheduled day of the week. Ballot-frozen candidates rank
// first; questions approved after the freeze follow in approval order so a
// moderator reschedule can still fill empty days.
export async function ensureWeekSchedule(redis: RedisClient, monday: string): Promise<void> {
  const order = await frozenOrder(redis, monday);
  for (const { member } of await redis.zRange(APPROVED, 0, -1)) {
    if (!order.includes(member)) order.push(member);
  }
  for (let i = 0; i < 7; i++) {
    const day = new Date(utcDay(monday) + i * DAY).toISOString().slice(0, 10);
    if (await redis.get(scheduleKey(day))) continue;
    const want = tier(day);
    let picked: Submission | null = null;
    for (const id of order) {
      if (await redis.get(claimedKey(id))) continue;
      const sub = await loadSub(redis, id);
      if (!sub || sub.state !== 'approved' || sub.tier !== want) continue;
      const claimed = await redis.set(claimedKey(id), day, { nx: true });
      if (!claimed) continue;
      await redis.expire(claimedKey(id), 90 * DAY / 1000);
      picked = sub;
      break;
    }
    if (picked) {
      const question: Question = {
        id: picked.id, question: picked.question, answers: [...picked.answers],
        author: picked.author || 'a former member', tier: want, approved: true,
      };
      const snapshot: Schedule = { day, question, subId: picked.id };
      await redis.set(scheduleKey(day), JSON.stringify(snapshot));
      picked.state = 'scheduled';
      picked.history.push({ at: Date.now(), action: `scheduled:${day}`, actor: 'system' });
      await redis.set(subKey(picked.id), JSON.stringify(picked));
      await redis.zRem(APPROVED, [picked.id]);
      await audit(redis, `scheduled:${day}`, picked.id, 'system');
    } else {
      const empty: Schedule = { day, none: true, reason: 'no-approved-content' };
      await redis.set(scheduleKey(day), JSON.stringify(empty));
      await audit(redis, `schedule-empty:${day}`, day, 'system');
    }
    await redis.expire(scheduleKey(day), 120 * DAY / 1000);
  }
}

// The pure read half: returns the frozen snapshot for a day without writing.
export async function scheduledQuestion(redis: RedisClient, day: string): Promise<Question | 'none' | null> {
  const raw = await redis.get(scheduleKey(day));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Schedule;
  if ('none' in parsed) return 'none';
  return validQuestion(parsed.question) ? parsed.question : 'none';
}

export async function markUsed(redis: RedisClient, day: string): Promise<void> {
  const raw = await redis.get(scheduleKey(day));
  if (!raw) return;
  const parsed = JSON.parse(raw) as Schedule;
  if ('none' in parsed) return;
  const sub = await loadSub(redis, parsed.subId);
  if (sub && sub.state === 'scheduled') {
    sub.state = 'used';
    sub.history.push({ at: Date.now(), action: `used:${day}`, actor: 'system' });
    await redis.set(subKey(parsed.subId), JSON.stringify(sub));
  }
}


