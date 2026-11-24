import { useEffect, useState } from 'react';
import type { CommunityView } from '../shared/community';
import { draftIssues } from '../shared/community';
import { track } from './lib/track';

const TIERS = ['Easiest (Mon)', '2', '3', '4', '5', '6', 'Hardest (Sun)'];
const STATE_LABEL: Record<string, string> = {
  pending: 'in review', approved: 'approved', rejected: 'rejected',
  scheduled: 'scheduled', used: 'played', withdrawn: 'withdrawn',
};

export default function Community({ signedIn }: { signedIn: boolean }) {
  const [data, setData] = useState<CommunityView | null>(null);
  const [open, setOpen] = useState<'none' | 'suggest'>('none');
  const [q, setQ] = useState('');
  const [answers, setAnswers] = useState(['', '', '', '']);
  const [tier, setTier] = useState(3);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [vote, setVote] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch('/api/community');
      if (r.ok) {
        const v: CommunityView = await r.json();
        setData(v); setVote(v.ballot.yourVote);
      }
    } catch { /* community tools stay hidden on failure */ }
  }
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, []);

  const issues = open === 'suggest' ? draftIssues({ question: q, answers }) : [];

  async function send() {
    if (busy || issues.length) return;
    setBusy(true); setNote('');
    try {
      const r = await fetch('/api/community/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, answers, tier }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      void track('question_submitted');
      setNote('Sent to the moderator queue.'); setOpen('none');
      setQ(''); setAnswers(['', '', '', '']);
      void load();
    } catch (e) { setNote(e instanceof Error ? e.message : 'Submit failed.'); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setNote('');
    try {
      const r = await fetch('/api/community/withdraw', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setNote('Withdrawn.'); void load();
    } catch (e) { setNote(e instanceof Error ? e.message : 'Withdraw failed.'); }
    finally { setBusy(false); }
  }
  async function support(id: string) {
    if (busy || vote) return;
    setBusy(true); setNote('');
    try {
      const r = await fetch('/api/community/support', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setVote(d.voted); void track('ballot_vote');
      void load();
    } catch (e) { setNote(e instanceof Error ? e.message : 'Vote failed.'); }
    finally { setBusy(false); }
  }

  const b = data?.ballot;
  return <section className="community">
    <p className="eyebrow">COMMUNITY QUESTIONS</p>
    {b && b.candidates.length > 0 && <>
      <h2>Support next week&rsquo;s questions</h2>
      <p className="small">Pick one question you would like to play. Totals stay hidden until the ballot closes.</p>
      <div className="ballot">
        {b.candidates.map(c => <div className="ballot-item" key={c.id}>
          <div><b>{c.question}</b><span className="small"> by {c.author}{c.support !== undefined ? ` · ${c.support} votes` : ''}</span></div>
          <button className="ghost" disabled={busy || !!vote || b.frozen || !signedIn} aria-pressed={vote === c.id} onClick={() => void support(c.id)}>
            {vote === c.id ? 'Supported' : 'Support'}
          </button>
        </div>)}
      </div>
    </>}
    {b && b.candidates.length === 0 && <p className="small">No approved questions on next week&rsquo;s ballot yet.</p>}
    {!!data?.mine.length && <>
      <p className="eyebrow">YOUR SUBMISSIONS</p>
      <ul className="subs">{data.mine.map(s => <li key={s.id}>
        <span>{s.question}</span><span className="small">{STATE_LABEL[s.state] ?? s.state}{s.state === 'approved' && s.tier ? ` · tier ${s.tier}` : ''}</span>
        {s.state === 'pending' && <button className="ghost" disabled={busy} onClick={() => void remove(s.id)}>Withdraw</button>}
      </li>)}</ul>
    </>}
    {open === 'suggest' ? <>
      <h2>Suggest a question</h2>
      <label className="field">Question (1-160 chars)
        <input value={q} maxLength={200} onChange={e => setQ(e.target.value)} placeholder="Which small joy would you keep?" />
      </label>
      {answers.map((a, i) => <label className="field" key={i}>Answer {'ABCD'[i]} (1-48 chars)
        <input value={a} maxLength={60} onChange={e => setAnswers(answers.map((x, j) => j === i ? e.target.value : x))} />
      </label>)}
      <label className="field">How tricky should the reasoning feel? (mods confirm)
        <select value={tier} onChange={e => setTier(Number(e.target.value))}>
          {TIERS.map((t, i) => <option key={i} value={i + 1}>Tier {i + 1}{i === 0 || i === 6 ? ` ${t}` : ''}</option>)}
        </select>
      </label>
      {issues.length > 0 && <ul className="issues">{issues.map(i => <li key={i}>{i}</li>)}</ul>}
      <div className="actions">
        <button className="primary" disabled={busy || issues.length > 0 || !signedIn || (data?.remaining ?? 0) === 0} onClick={() => void send()}>
          {busy ? 'Sending…' : signedIn ? `Send to review (${data?.remaining ?? 0} left today)` : 'Sign in on Reddit to suggest'}
        </button>
        <button className="ghost" onClick={() => setOpen('none')}>Cancel</button>
      </div>
    </> : <button className="ghost" onClick={() => setOpen('suggest')}>Suggest a question for the community</button>}
    {note && <p className="note" role="status">{note}</p>}
  </section>;
}
