import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, redis } from '@devvit/web/server';
import { afterEach, expect, vi } from 'vitest';
import { tier } from '../../shared/rules';
import { review, scheduledQuestion, submit } from './community';
import { createPost } from './post';
import { key } from './round';
import { menu } from '../routes/menu';

const privateTest = createDevvitTest({ subredditName: 'pick_the_rare_dev' });
const otherSubredditTest = createDevvitTest({ subredditName: 'daily_games' });

afterEach(() => vi.restoreAllMocks());

privateTest('an empty private install can create the labeled moderator sample', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const post = vi.spyOn(reddit, 'submitCustomPost').mockResolvedValue({ id: 't3_sample' } as unknown as Awaited<ReturnType<typeof reddit.submitCustomPost>>);

  expect(await createPost()).toBeNull();
  expect(await scheduledQuestion(redis, day)).toBe('none');
  expect(post).not.toHaveBeenCalled();

  const response = await menu.request('/post-create', { method: 'POST' });
  expect(await response.json()).toEqual({ navigateTo: 'https://www.reddit.com/comments/sample' });
  expect(post).toHaveBeenCalledWith(expect.objectContaining({
    postData: expect.objectContaining({ playtest: true, author: 'AI-assisted playtest sample' }),
  }));
  expect(await scheduledQuestion(redis, day)).toBe('none');

  await redis.del(key(day, 'round'));
  await menu.request('/post-create', { method: 'POST' });
  expect(post).toHaveBeenCalledTimes(1);
});

otherSubredditTest('the moderator action preserves a no-content day in other subreddits', async () => {
  const post = vi.spyOn(reddit, 'submitCustomPost');
  await menu.request('/post-create', { method: 'POST' });
  expect(post).not.toHaveBeenCalled();
});

privateTest('an approved scheduled question takes priority over the private sample', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const question = 'Synthetic community scheduling fixture?';
  const submitted = await submit(redis, 't2_author', 'fixture', { question, answers: ['A', 'B', 'C', 'D'] });
  if (!('id' in submitted)) throw new Error('Failed to create the test question');
  await review(redis, submitted.id, 'approve', tier(day), 'test moderator');
  const post = vi.spyOn(reddit, 'submitCustomPost').mockResolvedValue({ id: 't3_authored' } as unknown as Awaited<ReturnType<typeof reddit.submitCustomPost>>);

  await menu.request('/post-create', { method: 'POST' });
  expect(post).toHaveBeenCalledOnce();
  expect(post).toHaveBeenCalledWith(expect.objectContaining({
    postData: expect.objectContaining({ playtest: false, question }),
  }));
  expect(await redis.get('cc:v1:playtest-sample-claim')).toBeUndefined();
});
