import './index.css';
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { InitResponse } from '../shared/contracts';
import type { Choice } from '../shared/rules';
import { track } from './lib/track';
import { sfx } from './lib/sfx';
const Community = lazy(() => import('./community'));
const letters = ['A', 'B', 'C', 'D'];
const fmt = (points: number) => (points / 100).toFixed(2);

function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, deadline - now);
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return <p className="countdown" role="timer" aria-label="Time until the next question">
    Next question in <b>{h}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</b>
  </p>;
}

export function App() {
  const [content, setContent] = useState<InitResponse | null>(null);
  const empty = content?.state === 'no-content';
  const view = empty ? null : content;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Choice | null>(null);
  const [prediction, setPrediction] = useState<Choice | null>(null);
  const [sound, setSound] = useState(sfx.enabled);
  const [share, setShare] = useState<'idle' | 'posted' | 'copy'>('idle');
  const [shareText, setShareText] = useState('');
  const [note, setNote] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [flair, setFlair] = useState<{ optedIn: boolean; text: string | null } | null>(null);
  const fired = useRef(new Set<string>());
  const deadline = useMemo(() => view ? view.nextOpenAt - view.serverTime + Date.now() : 0, [view]);

  function once(event: Parameters<typeof track>[0], details = {}) {
    if (fired.current.has(event)) return;
    fired.current.add(event);
    void track(event, details);
  }
  async function load() {
    try {
      const response = await fetch('/api/init');
      if (!response.ok) throw new Error('Could not load this round.');
      const data: InitResponse = await response.json();
      setError('');
      setContent(data);
      if (data.state === 'no-content') return;
      setSubscribed(!!data.subscribed);
      setFlair(data.flair ?? null);
      if (data.streaks?.play.lastPlayed && data.streaks.play.lastPlayed < data.day) once('return_next_day', { day: data.day });
      if (data.state === 'revealed') once('reveal_view', { day: data.day });
    } catch { setError('Could not load this round. Please retry.'); }
  }
  useEffect(() => {
    once('post_view');
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(i: Choice) {
    once('first_interaction'); once('attempt_start');
    setPick(i);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!view || view.state !== 'open' || view.receipt || busy) return;
      if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      const n = '1234'.indexOf(e.key);
      if (e.key.length === 1 && n >= 0) choose(n as Choice);
      else if (e.key === 'Enter' && !e.repeat && !target?.closest('button, a[href]')) void lock();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  async function lock() {
    if (pick === null || busy || !view?.signedIn || view.state !== 'open' || view.receipt) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice: pick, prediction }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setContent(data);
      sfx.click();
      once('attempt_complete', { choice: pick });
    } catch (e) { setError(e instanceof Error ? e.message : 'Save not confirmed. Reload to check your receipt.'); }
    finally { setBusy(false); }
  }
  async function shareResult() {
    if (busy) return;
    setBusy(true); setNote('');
    try {
      const response = await fetch('/api/share', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      once('share_comment');
      if (data.posted) setShare('posted');
      else { setShare('copy'); setShareText(data.text ?? view?.shareText ?? ''); }
    } catch (e) { setNote(e instanceof Error ? e.message : 'Sharing failed.'); }
    finally { setBusy(false); }
  }
  async function copyResult() {
    try { await navigator.clipboard.writeText(shareText); setNote('Copied.'); }
    catch { setNote('Select the text to copy it.'); }
  }
  async function subscribe() {
    try {
      const response = await fetch('/api/subscribe', { method: 'POST' });
      const data = await response.json();
      if (data.subscribed) { setSubscribed(true); setNote('Joined the community.'); }
      else setNote(data.message ?? 'Subscribing is unavailable right now.');
    } catch { setNote('Subscribing is unavailable right now.'); }
  }
  async function optFlair(optIn: boolean) {
    try {
      const response = await fetch('/api/flair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optIn }) });
      const data = await response.json();
      setFlair({ optedIn: data.optedIn, text: data.text ?? flair?.text ?? null });
      setNote(data.applied ? `Flair set: ${data.text}` : data.message ?? (data.optedIn ? 'Flair will update when you earn a tier.' : 'Flair off.'));
    } catch { setNote('Flair is unavailable here.'); }
  }

  const r = view?.receipt;
  const res = view?.result;
  const eligible = view?.state === 'revealed' && !!res?.eligible;
  return <main>
    <header>
      <span className="mark" aria-hidden="true">◧</span><strong>Pick the Rare</strong>
      <button className="ghost" aria-pressed={sound} aria-label={sound ? 'Turn sound off' : 'Turn sound on'} onClick={() => setSound(sfx.toggle())}>{sound ? '♪' : '∅'}</button>
    </header>
    {error && <section role="alert"><p>{error}</p><button onClick={() => void load()}>Reload receipt</button></section>}
    {empty ? <section className="hero"><p className="eyebrow">A LITTLE AGAINST THE GRAIN</p><h1>Tomorrow’s crowd starts with a question.</h1><p>The next question is being prepared by the community. No round is open yet.</p></section>
      : !view ? <p role="status">Opening today’s round…</p> : <>
        <p className="eyebrow">{view.dayNumber ? `DAY ${view.dayNumber} · ` : ''}{view.day} · REVEALS AT MIDNIGHT UTC</p>
        <h1>{view.question}</h1>
        {view.state === 'skipped' && <section><p>This day was skipped by the moderators. It is neutral for scores, streaks and leagues.</p><Countdown deadline={deadline} /></section>}
        {view.state !== 'skipped' && <>
          {view.state === 'open' && !r && <p>Pick the answer you think the fewest people will choose.</p>}
          <div className="choices">{([0, 1, 2, 3] as const).map(i =>
            <button key={i} disabled={busy || !!r || view.state !== 'open'} aria-pressed={(r?.choice ?? pick) === i} onClick={() => choose(i)}>
              <span>{letters[i]}</span>{view.answers[i]}
            </button>)}
          </div>
          {!r && view.state === 'open' && <>
            <fieldset disabled={busy}>
              <legend>Optional: which will be most popular?</legend>
              <div className="prediction">{([0, 1, 2, 3] as const).map(i =>
                <button key={i} aria-label={`Predict ${letters[i]}: ${view.answers[i]}`} aria-pressed={prediction === i} onClick={() => setPrediction(i)}>{letters[i]}</button>)}
                <button aria-pressed={prediction === null} onClick={() => setPrediction(null)}>Skip</button>
              </div>
            </fieldset>
            <p className="small">Your choice and prediction cannot be changed after locking. Keys 1-4 pick, Enter locks.</p>
            <button className="primary" disabled={pick === null || busy || !view.signedIn} onClick={() => void lock()}>{busy ? 'Saving…' : view.signedIn ? 'Lock my choice' : 'Sign in on Reddit to play'}</button>
          </>}
          {r && view.state === 'open' && <section className="receipt">
            <p className="eyebrow">CHOICE SEALED</p>
            <h2>{letters[r.choice]} is locked.</h2>
            <p>{r.prediction === null ? 'Prediction skipped.' : `You predicted ${letters[r.prediction]} would be most popular.`}</p>
            <div className="sealed" aria-hidden="true">▥ ▥ ▥ ▥</div>
            <p>The crowd is still deciding. Results reveal after midnight UTC.</p>
            <p className="small">Sealed illustration · no live vote data</p>
          </section>}
          {view.state === 'finalizing' && <section><h2>Counting the final choices.</h2><p>This round is closed. Check back for the reveal.</p><button onClick={() => void load()}>Check reveal</button></section>}
          {view.state === 'revealed' && <section className="endcard">
            {(view.total ?? 0) < 10 ? <>
              <h2>Too few players today.</h2>
              <p>{view.total} participants. Participation counts; competitive scores need at least ten players.</p>
            </> : <>
              <h2>The crowd has spoken.</h2>
              <p>{view.total} participants</p>
              <div role="table" aria-label="Final distribution">
                {view.counts?.map((n, i) => <div className="result" key={i} role="row">
                  <span role="cell">{letters[i]} · {view.answers[i]}{r?.choice === i && <b className="you">YOU</b>}</span>
                  <meter role="cell" min={0} max={Math.max(...(view.counts ?? [1]))} value={n} aria-label={`${letters[i]}: ${n} of ${view.total} votes`} />
                  <b role="cell">{n}</b>
                </div>)}
              </div>
              {res?.eligible && <>
                <p className="score">{fmt(res.points!)} <small>points</small></p>
                {view.percentile !== undefined && <p>You scored higher than {view.percentile}% of the field.</p>}
                {res.winner && <p className="win">You picked the rarest answer.</p>}
                {res.bonus ? <p>Prediction bonus +{fmt(res.bonus)}.</p> : null}
                {r?.prediction !== null && r?.prediction !== undefined && !res.bonus && <p className="small">Your prediction missed.</p>}
              </>}
            </>}
          </section>}
          {view.streaks && view.state !== 'open' && <div className="chips">
            <span className="chip" title="Days played in a row">Streak {view.streaks.play.current} · best {view.streaks.play.best}</span>
            <span className="chip" title="Consecutive rarest picks">Contrarian {view.streaks.contrarian.current} · best {view.streaks.contrarian.best}</span>
          </div>}
          {view.league && view.league.top.length > 0 && <section className="league">
            <p className="eyebrow">THIS WEEK’S LEAGUE</p>
            <ol>{view.league.top.map((e, index) => <li key={index} className={e.you ? 'you' : ''}><span>#{e.rank} {e.name}</span><b>{fmt(e.points)}</b></li>)}</ol>
            {view.league.you && !view.league.top.some(e => e.you) && <p className="small">You: {fmt(view.league.you.points)} pts{view.league.you.rank ? ` · #${view.league.you.rank}` : ''}</p>}
          </section>}
          {view.state === 'revealed' && <>
            {eligible && <div className="actions">
              {share !== 'posted' && <button className="primary" disabled={busy} onClick={() => void shareResult()}>{busy ? 'Sharing…' : 'Share result as comment'}</button>}
              {share === 'posted' && <p className="note">Result posted to the comments.</p>}
              {share === 'copy' && <>
                <p className="small">Comment posting is unavailable on this account. Copy your result instead:</p>
                <textarea readOnly rows={4} value={shareText} aria-label="Shareable result text" />
                <button onClick={() => void copyResult()}>Copy result</button>
              </>}
            </div>}
            {!subscribed && <button className="ghost" onClick={() => void subscribe()}>Join the community for daily questions</button>}
            {flair && !flair.optedIn && flair.text && <button className="ghost" onClick={() => void optFlair(true)}>Earn flair: {flair.text}. Opt in</button>}
            {flair?.optedIn && <button className="ghost" onClick={() => void optFlair(false)}>Flair on{flair.text ? `: ${flair.text}` : ''}. Opt out</button>}
            <Countdown deadline={deadline} />
          </>}
          {note && <p className="note" role="status">{note}</p>}
        </>}
        <footer>Question by {view.author} · One pick per day · UTC cutoff</footer>
      </>}
    {content && <Suspense fallback={null}><Community signedIn={content.signedIn} /></Suspense>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
