import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/web/server';
import { expect } from 'vitest';
import { tier } from '../../shared/rules';
import { weekKey } from '../../shared/streak';
import { ensureWeekSchedule, loadSub, scheduledQuestion, submit } from '../core/community';
import { forms } from './forms';

const test = createDevvitTest();

function submitReview(body: unknown) {
  return forms.request('/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function suggestion() {
  const result = await submit(redis, 't2_fixture', 'fixture', {
    question: 'Synthetic approval fixture?',
    answers: ['One', 'Two', 'Three', 'Four'],
  });
  if (!('id' in result)) throw new Error('Could not submit the test question');
  return result.id;
}

test('a Devvit dropdown approval makes its human review decision schedulable', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const id = await suggestion();
  const response = await submitReview({ id, decision: ['approve'], tier: [String(tier(day))] });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ showToast: `Approved at tier ${tier(day)}. Queue is now empty.` });
  await ensureWeekSchedule(redis, weekKey(day));
  expect(await scheduledQuestion(redis, day)).toMatchObject({
    id, author: 'u/fixture', approved: true, tier: tier(day),
  });
});

test('a multi-value review decision leaves the question pending', async () => {
  const id = await suggestion();
  const response = await submitReview({ id, decision: ['approve', 'reject'], tier: ['1'] });
  expect(response.status).toBe(400);
  expect(await loadSub(redis, id)).toMatchObject({ state: 'pending', tier: null });
});

test('the older scalar review payload remains accepted', async () => {
  const id = await suggestion();
  const response = await submitReview({ id, decision: 'reject' });
  expect(response.status).toBe(200);
  expect(await loadSub(redis, id)).toMatchObject({ state: 'rejected' });
});
