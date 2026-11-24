import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/web/server';
import { expect } from 'vitest';
import { cutoff } from '../../shared/rules';
import { key, rounds, shard, type Round } from './round';
const test = createDevvitTest();
const round: Round = { day:'2026-11-15', postId:'t3_fixture', question:{id:'fixture',question:'Synthetic test fixture',answers:['Fixture A','Fixture B','Fixture C','Fixture D'],author:'test fixture',tier:7,approved:true} };
test('retry preserves original choice and prediction with one count', async () => {
  await redis.set(key(round.day,'gate'),'open');
  const service = rounds(redis,()=>cutoff(round.day)-1000);
  const first = await service.lock(round,'t2_fixture',{choice:0,prediction:1});
  expect(await service.lock(round,'t2_fixture',{choice:3,prediction:null})).toEqual(first);
  expect(await redis.hGetAll(key(round.day,`counts:${shard('t2_fixture')}`))).toEqual({'0':'1'});
  const view = await service.view(round,'t2_fixture');
  expect(view).not.toHaveProperty('counts');
  expect(view).not.toHaveProperty('total');
  expect(view).not.toHaveProperty('result');
});
test('cutoff rejects new picks and low turnout reveals only total', async () => {
  await redis.set(key(round.day,'gate'),'open');
  const open = rounds(redis,()=>cutoff(round.day)-1);
  await open.lock(round,'t2_fixture',{choice:2,prediction:null});
  const closed = rounds(redis,()=>cutoff(round.day));
  await expect(closed.lock(round,'t2_late',{choice:0,prediction:null})).rejects.toThrow('closed');
  expect(await closed.finalize(round.day)).toEqual([0,0,1,0]);
  const view = await closed.view(round,'t2_fixture');
  expect(view).toMatchObject({state:'revealed',total:1});
  expect(view).not.toHaveProperty('counts');
  expect(view).not.toHaveProperty('result');
});
test('eligible reveal is stable across repeated finalization', async () => {
  await redis.set(key(round.day,'gate'),'open');
  const open = rounds(redis,()=>cutoff(round.day)-1);
  for(let i=0;i<10;i++) await open.lock(round,`t2_fixture_${i}`,{choice:i===0?1:0,prediction:0});
  const closed = rounds(redis,()=>cutoff(round.day));
  expect(await closed.finalize(round.day)).toEqual([9,1,0,0]);
  expect(await closed.finalize(round.day)).toEqual([9,1,0,0]);
  expect(await closed.view(round,'t2_fixture_0')).toMatchObject({result:{base:9000,bonus:500,points:9500,winner:false}});
});
