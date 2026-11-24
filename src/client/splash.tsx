import './index.css';
import { context, requestExpandedMode } from '@devvit/web/client';
import { createRoot } from 'react-dom/client';

type SplashData = { day?: string; dayNumber?: number; question?: string; tier?: number; playtest?: boolean };
const data = (context.postData ?? {}) as SplashData;

export function Splash() {
  // A deterministic motif per day keeps the feed tile visually distinct without
  // storing or fetching anything on the splash.
  const seed = data.day ? [...data.day].reduce((a, c) => a + c.charCodeAt(0), 0) : 0;
  return <main className={`splash motif-${seed % 4}`}>
    <header><span className="mark" aria-hidden="true">◧</span><strong>Pick the Rare</strong>
      {data.dayNumber ? <span className="edition">DAY {data.dayNumber}</span> : null}
    </header>
    <p className="eyebrow">ONE CHOICE. EVERY DAY.</p>
    <h1>{data.question ?? 'Think outside the crowd.'}</h1>
    <p>Four answers. Pick the least popular. Find out after midnight UTC.</p>
    <div className="cta">
      <button className="primary" onClick={event => requestExpandedMode(event.nativeEvent, 'game')}>Open today’s question</button>
      <span className="ghosthand" aria-hidden="true">👆</span>
    </div>
    {data.playtest ? <p className="small">Playtest build</p> : null}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Splash />);
