import { Hono } from 'hono';
import type { Form, UiResponse } from '@devvit/web/shared';
import { context, reddit, redis } from '@devvit/web/server';
import { pending, queueCounts, review } from '../core/community';
import type { Submission } from '../../shared/community';

export const forms = new Hono();

function selectedValue(value: unknown): string | undefined {
  const field = Array.isArray(value) && value.length === 1 ? value[0] : value;
  return typeof field === 'string' ? field : undefined;
}

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
  const values = await c.req.json<{ id?: string; decision?: unknown; tier?: unknown; note?: string }>();
  // Devvit select fields return an array of selected values, even for one choice.
  const decision = selectedValue(values.decision);
  if (values.decision !== undefined && decision === undefined) {
    return c.json<UiResponse>({ showToast: 'Unknown decision.' }, 400);
  }
  const counts = await queueCounts(redis);
  const actor = (await reddit.getCurrentUsername().catch(() => undefined)) ?? context.userId ?? 'moderator';
  if (!values.id || !decision || decision === 'skip') {
    const [next] = await pending(redis, 1);
    return c.json<UiResponse>(reviewForm(next ?? null, counts));
  }
  if (decision !== 'approve' && decision !== 'reject') {
    return c.json<UiResponse>({ showToast: 'Unknown decision.' }, 400);
  }
  const assignedTier = Number(selectedValue(values.tier));
  if (decision === 'approve' && (!Number.isInteger(assignedTier) || assignedTier < 1 || assignedTier > 7)) {
    return c.json<UiResponse>({ showToast: 'Pick a tier from 1 to 7.' }, 400);
  }
  const message = await review(redis, values.id, decision, assignedTier, actor, values.note || undefined);
  const [next] = await pending(redis, 1);
  const followUp = reviewForm(next ?? null, { ...counts, pending: counts.pending - 1 });
  if ('showForm' in followUp) {
    followUp.showToast = message;
    return c.json<UiResponse>(followUp);
  }
  return c.json<UiResponse>({ showToast: `${message} Queue is now empty.` });
});
