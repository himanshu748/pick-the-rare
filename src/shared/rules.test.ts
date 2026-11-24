import { describe, expect, it } from 'vitest';
import { cutoff, generate, score, tier, utcDay, validQuestion, type Question } from './rules';
describe('UTC and deterministic content', () => {
  it('rejects rollover dates and respects leap-day cutoffs', () => {
    expect(() => utcDay('2026-02-29')).toThrow();
    expect(cutoff('2028-02-29')).toBe(utcDay('2028-03-01'));
  });
  it('validates 120 consecutive synthetic days and weekday tiers', () => {
    const manifest: Record<string, Question> = {};
    for (let i=0;i<120;i++) {
      const day = new Date(utcDay('2026-11-16')+i*86400000).toISOString().slice(0,10);
      manifest[day] = {id: `fixture-${i}`, question:'Synthetic test fixture', answers:['Fixture A','Fixture B','Fixture C','Fixture D'],author:'test fixture',approved:true,tier:i%7+1};
      expect(tier(day)).toBe(i%7+1);
      expect(generate(day,manifest)).toEqual(generate(day,manifest));
      expect(generate(day,manifest)?.closesAt).toBe(cutoff(day));
    }
    expect(generate('2027-12-01',manifest)).toBeNull();
    expect(validQuestion({...manifest['2026-11-16']!,question:'TODO'})).toBe(false);
  });
});
describe('rarity', () => {
  it('suppresses low-turnout scoring', () => { expect(score([3,2,2,2],0,0)).toEqual({eligible:false,total:9}); });
  it('honors tied winners and predictions', () => { expect(score([3,3,3,3],0,1)).toMatchObject({eligible:true,base:7500,bonus:500,winner:true}); });
  it('does not award a win when an unchosen answer has zero votes', () => { expect(score([10,0,0,0],0,0)).toMatchObject({winner:false,base:0,bonus:500}); });
  it('rejects malformed counts', () => { expect(()=>score([-1,10,0,0],0,null)).toThrow(); });
});
