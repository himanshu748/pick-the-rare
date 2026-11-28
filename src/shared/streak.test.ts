import { describe, expect, it } from 'vitest';
import { dayNumber, flairText, freshProgress, recordOutcome, recordPlay, weekKey, weeklyTier } from './streak';
describe('play streak', () => {
  it('counts consecutive days and tolerates same-day replays', () => {
    let p = freshProgress();
    p = recordPlay(p, '2026-11-16', []);
    p = recordPlay(p, '2026-11-16', []);
    expect(p.play).toMatchObject({ current: 1, best: 1, lastPlayed: '2026-11-16' });
    p = recordPlay(p, '2026-11-17', []);
    expect(p.play.current).toBe(2);
  });
  it('forgives one missed day per rolling seven-day window', () => {
    let p = freshProgress();
    p = recordPlay(p, '2026-11-10', []);
    p = recordPlay(p, '2026-11-12', ['2026-11-11']);
    expect(p.play).toMatchObject({ current: 2, graceUsedOn: '2026-11-11' });
    p = recordPlay(p, '2026-11-14', ['2026-11-13']);
    expect(p.play.current).toBe(1);
  });
  it('allows grace again once the window has passed', () => {
    let p = freshProgress();
    p = recordPlay(p, '2026-11-01', []);
    p = recordPlay(p, '2026-11-03', ['2026-11-02']);
    expect(p.play.graceUsedOn).toBe('2026-11-02');
    p = recordPlay(p, '2026-11-09', ['2026-11-04', '2026-11-05']);
    p = recordPlay(p, '2026-11-11', ['2026-11-10']);
    expect(p.play).toMatchObject({ current: 2, graceUsedOn: '2026-11-10' });
  });
  it('resets on a two-day gap', () => {
    let p = freshProgress();
    p = recordPlay(p, '2026-11-10', []);
    p = recordPlay(p, '2026-11-13', ['2026-11-11', '2026-11-12']);
    expect(p.play.current).toBe(1);
  });
});
describe('contrarian streak', () => {
  it('advances on wins, resets on losses and misses, ignores neutral', () => {
    let p = freshProgress();
    p = recordOutcome(p, '2026-11-16', 'win');
    p = recordOutcome(p, '2026-11-17', 'win');
    expect(p.contra).toMatchObject({ current: 2, best: 2 });
    p = recordOutcome(p, '2026-11-18', 'neutral');
    expect(p.contra.current).toBe(2);
    p = recordOutcome(p, '2026-11-19', 'loss');
    expect(p.contra.current).toBe(0);
    p = recordOutcome(p, '2026-11-20', 'missed');
    expect(p.contra.current).toBe(0);
  });
  it('never reprocesses an earlier day', () => {
    let p = freshProgress();
    p = recordOutcome(p, '2026-11-18', 'win');
    p = recordOutcome(p, '2026-11-17', 'loss');
    expect(p.contra.current).toBe(1);
  });
});
describe('weeks and tiers', () => {
  it('keys weeks by Monday UTC', () => {
    expect(weekKey('2026-11-16')).toBe('2026-11-16');
    expect(weekKey('2026-11-21')).toBe('2026-11-16');
    expect(weekKey('2026-11-22')).toBe('2026-11-16');
    expect(weekKey('2026-11-23')).toBe('2026-11-23');
  });
  it('counts days from the configured start', () => {
    expect(dayNumber('2026-11-20', '2026-11-20')).toBe(1);
    expect(dayNumber('2026-11-21', '2026-11-20')).toBe(2);
    expect(dayNumber('2026-11-19', '2026-11-20')).toBeNull();
  });
  it('awards tiers only on real weekly points', () => {
    expect(weeklyTier(0)).toBeNull();
    expect(weeklyTier(14999)).toBe('Starter');
    expect(weeklyTier(30000)).toBe('Contrarian');
    expect(weeklyTier(46000)).toBe('Outlier');
  });
  it('combines tier and milestone for opt-in flair', () => {
    const p = freshProgress();
    expect(flairText(p, null)).toBeNull();
    expect(flairText({ ...p, play: { ...p.play, best: 7 } }, 'Scout')).toBe('Scout league · 7-day streak');
  });
});
