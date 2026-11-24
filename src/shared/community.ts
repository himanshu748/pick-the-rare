import { utcDay } from './rules';
export const MAX_SUBMISSIONS_PER_DAY = 3;
export type SubmissionState = 'pending' | 'approved' | 'rejected' | 'scheduled' | 'used' | 'withdrawn';
export type Draft = { question: string; answers: string[] };
export type Submission = {
  id: string; question: string; answers: string[]; authorId: string; author: string;
  suggestedTier: number; tier: number | null; state: SubmissionState;
  submittedAt: number; reviewedAt: number | null; flags: string[];
  history: { at: number; action: string; actor: string; note?: string }[];
};

// A handful of obvious whole-word flags surfaced to human moderators. This is
// deliberately minimal: it never blocks a submission and never replaces review.
const FLAG_WORDS = ['slur', 'hate', 'kill yourself', 'doxx'];
const clean = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ');
const badChar = (s: string) => [...s].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

export function draftIssues(draft: Draft): string[] {
  const issues: string[] = [];
  const q = clean(draft.question);
  if (!q) issues.push('Add a question.');
  else if (q.length > 160) issues.push('Questions are limited to 160 characters.');
  if (draft.answers.length !== 4) issues.push('Give exactly four answers.');
  const answers = draft.answers.map(clean);
  if (answers.some(a => !a)) issues.push('Every answer needs text.');
  if (answers.some(a => a.length > 48)) issues.push('Answers are limited to 48 characters.');
  if (new Set(answers.map(a => a.toLowerCase())).size !== answers.length) issues.push('Answers must be distinct.');
  for (const text of [q, ...answers]) {
    if (badChar(text)) issues.push('Remove control characters.');
    if (/https?:\/\/|www\.|reddit\.com|\bu\/|\br\//i.test(text)) issues.push('Links and user or subreddit references are not allowed.');
    if (/TODO/i.test(text)) issues.push('Placeholder text cannot be submitted.');
    if (/\b(email|phone number|address|password|real name)\b/i.test(text)) issues.push('Do not ask for personal information.');
  }
  return [...new Set(issues)];
}
export function draftFlags(draft: Draft): string[] {
  const text = clean([draft.question, ...draft.answers].join(' ')).toLowerCase();
  return FLAG_WORDS.filter(w => new RegExp(`\\b${w.replace(/ /g, '\\s+')}\\b`, 'i').test(text)).map(w => `flagged word: ${w}`);
}
export function parseDraft(value: unknown): Draft & { tier?: number } {
  if (typeof value !== 'object' || value === null) throw new Error('A question and four answers are required.');
  const v = value as Record<string, unknown>;
  const question = typeof v.question === 'string' ? clean(v.question) : '';
  const answers = Array.isArray(v.answers) ? v.answers.map(a => typeof a === 'string' ? clean(a) : '') : [];
  const tier = 'tier' in v && Number.isInteger(v.tier) ? Number(v.tier) : undefined;
  const issues = draftIssues({ question, answers });
  if (tier !== undefined && (tier < 1 || tier > 7)) issues.push('Tier must be between 1 and 7.');
  if (issues.length) throw Object.assign(new Error(issues[0]), { issues });
  return { question, answers, ...(tier !== undefined ? { tier } : {}) };
}
export type CommunityView = {
  remaining: number; mine: { id: string; question: string; state: SubmissionState; tier: number | null }[];
  ballot: {
    week: string; closesAt: number; frozen: boolean; yourVote: string | null;
    candidates: { id: string; question: string; answers: string[]; author: string; support?: number }[];
  };
};
// Stable per-user rotation for ballot order. Same hash family as vote shards.
export function rotateOrder<T>(items: readonly T[], user: string): T[] {
  if (items.length < 2) return [...items];
  let hash = 0;
  for (const c of user) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
  const offset = (hash >>> 0) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}
export function mondayAfter(day: string): string {
  const d = new Date(utcDay(day));
  d.setUTCDate(d.getUTCDate() + (7 - ((d.getUTCDay() + 6) % 7)));
  return d.toISOString().slice(0, 10);
}
