export type Choice = 0 | 1 | 2 | 3;
export type Counts = readonly [number, number, number, number];
export function utcDay(value: string): number {
  const ms = Date.parse(value + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw new Error('Invalid UTC date');
  return ms;
}
export function cutoff(day: string): number { return utcDay(day) + 86400000; }
export function tier(day: string): number { return (new Date(utcDay(day)).getUTCDay() + 6) % 7 + 1; }
export function score(counts: Counts, pick: Choice, prediction: Choice | null) {
  if (counts.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('Invalid counts');
  const total = counts.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total)) throw new Error('Count overflow');
  if (total < 10) return { eligible: false as const, total };
  const base = Math.round(10000 * (total - counts[pick]) / total);
  const bonus = prediction !== null && counts[prediction] === Math.max(...counts) ? 500 : 0;
  return { eligible: true as const, total, base, bonus, points: base + bonus, winner: counts[pick] === Math.min(...counts) };
}
export type Question = { id: string; question: string; answers: readonly string[]; author: string; tier: number; approved: boolean };
export function validQuestion(q: Question): boolean {
  const text = [q.question, ...q.answers, q.author];
  return q.approved && q.tier >= 1 && q.tier <= 7 && Number.isInteger(q.tier) && q.answers.length === 4 &&
    q.question.trim().length > 0 && q.question.length <= 160 && q.author.trim().length > 0 &&
    q.answers.every(a => a.trim().length > 0 && a.length <= 48) &&
    new Set(q.answers.map(a => a.normalize('NFKC').trim().toLowerCase())).size === 4 &&
    text.every(t => !/TODO|https?:/i.test(t) && ![...t].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127));
}
export function generate(day: string, manifest: Readonly<Record<string, Question>>) {
  const expectedTier = tier(day);
  const q = manifest[day];
  if (!q || !validQuestion(q) || q.tier !== expectedTier) return null;
  return { ...q, answers: [...q.answers], day, closesAt: cutoff(day) };
}
