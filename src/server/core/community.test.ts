import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/web/server';
import { expect } from 'vitest';
import { draftIssues, mondayAfter } from '../../shared/community';
import { utcDay } from '../../shared/rules';
import {
  ballotView, ensureWeekSchedule, loadSub, mine, queueCounts, remainingToday,
  review, scheduledQuestion, submit, support, withdraw,
} from './community';

const test = createDevvitTest();
const DAY = 86400000;
const draft = (question: string) => ({ question, answers: ['One', 'Two', 'Three', 'Four'] });
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);

test('draftIssues accepts a clean draft and rejects bad ones', () => {
  expect(draftIssues(draft('Which small joy would you keep?'))).toEqual([]);
  expect(draftIssues({ question: 'x'.repeat(161), answers: ['a', 'b', 'c', 'd'] })).toContain('Questions are limited to 160 characters.');
  expect(draftIssues({ question: 'Q', answers: ['same', ' Same ', 'c', 'd'] })).toContain('Answers must be distinct.');
  expect(draftIssues({ question: 'Q', answers: ['a', 'b', 'c'] })).toContain('Give exactly four answers.');
  expect(draftIssues({ question: 'Q', answers: ['a', 'b', 'c', 'see https://x.example'] })).toContain('Links and user or subreddit references are not allowed.');
  expect(draftIssues(draft('TODO write a real question'))).toContain('Placeholder text cannot be submitted.');
});

test('submit creates a pending record and enforces the daily limit', async () => {
  const user = 't2_author';
  for (let i = 0; i < 3; i++) {
    const r = await submit(redis, user, 'alice', draft(`Question ${i}?`), 1000);
    expect(r).toHaveProperty('id');
  }
  expect(await remainingToday(redis, user, 1000)).toBe(0);
  const fourth = await submit(redis, user, 'alice', draft('One more?'), 1000);
  expect(fourth).toHaveProperty('issues');
  const subs = await mine(redis, user);
  expect(subs).toHaveLength(3);
  expect(subs.every(s => s.state === 'pending')).toBe(true);
  expect((await queueCounts(redis)).pending).toBe(3);
});

test('review approves with tier, credits move to the approved pool', async () => {
  const { id } = await submit(redis, 't2_a', 'bob', draft('Which breakfast wins?')) as { id: string };
  expect(await review(redis, id, 'approve', 4, 'mod')).toBe('Approved at tier 4.');
  const sub = await loadSub(redis, id);
  expect(sub).toMatchObject({ state: 'approved', tier: 4 });
  expect((await queueCounts(redis))).toMatchObject({ pending: 0, approved: 1 });
  // Rejecting an already-approved item is a no-op.
  expect(await review(redis, id, 'reject', 1, 'mod')).toBe('Already approved; skipped.');
});

test('withdraw only allows the author on pending items', async () => {
  const { id } = await submit(redis, 't2_a', 'carol', draft('Which shortcut do you take?')) as { id: string };
  expect(await withdraw(redis, 't2_other', id)).toBe('You can only withdraw your own submissions.');
  expect(await withdraw(redis, 't2_a', id)).toBeNull();
  expect((await loadSub(redis, id))?.state).toBe('withdrawn');
  expect((await queueCounts(redis)).pending).toBe(0);
});

test('ballot: one immutable support vote, no self-vote, totals hidden until frozen', async () => {
  const monday = '2026-12-07'; // a real Monday
  const mk = async (u: string, n: string, q: string, t: number) => {
    const { id } = await submit(redis, u, n, { ...draft(q), tier: t }) as { id: string };
    await review(redis, id, 'approve', t, 'mod');
    return id;
  };
  const mine_ = await mk('t2_self', 'self', 'Self question?', 1);
  const theirs = await mk('t2_other', 'other', 'Other question?', 1);
  // Self-vote is rejected.
  const selfVote = await support(redis, monday, 't2_self', mine_, utcDay(monday) - DAY);
  expect(selfVote).toHaveProperty('error');
  // A real vote records once.
  const v1 = await support(redis, monday, 't2_voter', theirs, utcDay(monday) - DAY);
  expect(v1).toEqual({ voted: theirs });
  // A different id returns the original vote, not a re-vote.
  const v2 = await support(redis, monday, 't2_voter', mine_, utcDay(monday) - DAY);
  expect(v2).toEqual({ voted: theirs });
  const open = await ballotView(redis, monday, 't2_voter');
  expect(open.yourVote).toBe(theirs);
  expect(open.candidates.every(c => c.support === undefined)).toBe(true);
  // Votes after the ballot closes are refused.
  const late = await support(redis, monday, 't2_late', theirs, utcDay(monday) + 1);
  expect(late).toHaveProperty('error');
});

test('weekly schedule picks highest-supported tier-matching candidate, then marks used', async () => {
  const monday = '2026-12-14';
  const mk = async (u: string, q: string, t: number) => {
    const { id } = await submit(redis, u, 'author', { ...draft(q), tier: t }) as { id: string };
    await review(redis, id, 'approve', t, 'mod');
    return id;
  };
  // Monday needs tier 1. Two tier-1 candidates; the higher-supported wins.
  const low = await mk('t2_a', 'Low support?', 1);
  const high = await mk('t2_b', 'High support?', 1);
  await mk('t2_c', 'Tier two question?', 2); // Tuesday material
  const t = utcDay(monday) - DAY;
  await support(redis, monday, 't2_v1', low, t);
  await support(redis, monday, 't2_v2', high, t);
  await support(redis, monday, 't2_v3', high, t);
  await ensureWeekSchedule(redis, monday);
  const scheduled = await scheduledQuestion(redis, monday);
  expect(scheduled).not.toBe('none');
  expect(scheduled && scheduled !== 'none' && scheduled.question).toBe('High support?');
  expect(scheduled && scheduled !== 'none' && scheduled.author).toBe('u/author');
  expect(scheduled && scheduled !== 'none' && scheduled.tier).toBe(1);
  // Winning submission is claimed and leaves the approved pool.
  expect((await loadSub(redis, high))?.state).toBe('scheduled');
  expect((await queueCounts(redis)).approved).toBe(1);
  // Days without a tier match get the explicit no-content snapshot.
  expect(await scheduledQuestion(redis, date(utcDay(monday) + 2 * DAY))).toBe('none');
  // Frozen ballot now exposes totals.
  const frozen = await ballotView(redis, monday, 't2_v1');
  expect(frozen.frozen).toBe(true);
  expect(frozen.candidates.find(c => c.id === low)?.support).toBe(1);
  // markUsed transitions scheduled to used.
  const { markUsed } = await import('./community');
  await markUsed(redis, monday);
  expect((await loadSub(redis, high))?.state).toBe('used');
});

test('mondayAfter always lands on the next Monday', () => {
  expect(mondayAfter('2026-11-25')).toBe('2026-11-30'); // Wednesday
  expect(mondayAfter('2026-11-30')).toBe('2026-12-07'); // Monday itself
  expect(mondayAfter('2026-12-06')).toBe('2026-12-07'); // Sunday
});
