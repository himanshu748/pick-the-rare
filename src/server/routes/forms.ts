import { Hono } from 'hono';
import type { Form, UiResponse } from '@devvit/web/shared';
import { context, reddit, redis } from '@devvit/web/server';
import { pending, queueCounts, review } from '../core/community';
import type { Submission } from '../../shared/community';

export const forms = new Hono();

// Renders the oldest pending submission as a review form. Content is shown in
// disabled fields; the decision select drives the submit handler.
export function reviewForm(sub: Submission | null, counts: { pending: number; approved: number }): UiResponse {
  if (!sub) return { showToast: `Queue is empty. ${counts.approved} approved question(s) waiting for a ballot.` };
  const fields: Form['fields'] = [
    { type: 'string', name: 'id', label: `Submission ${sub.id} (${counts.pending} pending)`, defaultValue: sub.id, disabled: true },
    { type: 'string', name: 'q', label: 'Question', defaultValue: sub.question, disabled: true },
    ...sub.answers.map((a, i) => ({ type: 'string' as const, name: `a${i}`, label: `Answer ${'ABCD'[i]}`, defaultValue: a, disabled: true })),
  ];
  if (sub.flags.length) {
    fields.push({ type: 'paragraph', name: 'flags', label: 'Automatic flags (review before approving)', defaultValue: sub.flags.join(', ') });
  }
  fields.push(
    { type: 'select', name: 'decision', label: `Suggested tier ${sub.suggestedTier} · by ${sub.author}`, options: [
      { label: 'Approve', value: 'approve' }, { label: 'Reject', value: 'reject' }, { label: 'Skip for now', value: 'skip' },
    ], required: true, defaultValue: ['skip'] },
    { type: 'select', name: 'tier', label: 'Tier if approving (1 easy Monday - 7 hardest Sunday)', options: [1,2,3,4,5,6,7].map(t => ({ label: String(t), value: String(t) })), defaultValue: [String(sub.suggestedTier)] },
    { type: 'string', name: 'note', label: 'Note (optional, kept in the audit log)' },
  );
  return { showForm: { name: 'reviewSubmission', form: { title: 'Review submission', fields } } };
}

forms.post('/review', async c => {
  const values = await c.req.json<{ id?: string; decision?: string; tier?: string; note?: string }>();
  const counts = await queueCounts(redis);
  const actor = (await reddit.getCurrentUsername().catch(() => undefined)) ?? context.userId ?? 'moderator';
  if (!values.id || !values.decision || values.decision === 'skip') {
    const [next] = await pending(redis, 1);
    return c.json<UiResponse>(reviewForm(next ?? null, counts));
  }
  if (values.decision !== 'approve' && values.decision !== 'reject') {
    return c.json<UiResponse>({ showToast: 'Unknown decision.' }, 400);
  }
  const message = await review(redis, values.id, values.decision, Number(values.tier), actor, values.note || undefined);
  const [next] = await pending(redis, 1);
  const followUp = reviewForm(next ?? null, { ...counts, pending: counts.pending - 1 });
  if ('showForm' in followUp) {
    followUp.showToast = message;
    return c.json<UiResponse>(followUp);
  }
  return c.json<UiResponse>({ showToast: `${message} Queue is now empty.` });
});
