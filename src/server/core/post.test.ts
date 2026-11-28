import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, redis } from '@devvit/web/server';
import { afterEach, expect, vi } from 'vitest';
import { tier, type Question } from '../../shared/rules';
import { weekKey } from '../../shared/streak';
import { ensureWeekSchedule, loadSub, review, scheduledQuestion, submit } from './community';
import { createPost } from './post';
import { key } from './round';
import { menu } from '../routes/menu';

const privateTest = createDevvitTest({ subredditName: 'pick_the_rare_dev' });
const otherSubredditTest = createDevvitTest({ subredditName: 'daily_games' });

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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
  expect(await redis.get(key(day, 'round'))).toBeDefined();
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

function mockClock(): string {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-28T12:00:00Z'));
  return '2026-11-28';
}

function postFixture(id: `t3_${string}`): Awaited<ReturnType<typeof reddit.submitCustomPost>> {
  return { id } as unknown as Awaited<ReturnType<typeof reddit.submitCustomPost>>;
}

privateTest('a failed first-play reservation leaves the private sample available for retry', async () => {
  const day = mockClock();
  const claimKey = 'cc:v1:playtest-sample-claim';
  const intentKey = key(day, 'post-intent');
  const post = vi.spyOn(reddit, 'submitCustomPost').mockResolvedValue(postFixture('t3_retry'));
  const unavailable = new Error('Redis reservation unavailable');
  let fail = true;
  const set = redis.set.bind(redis);
  vi.spyOn(redis, 'set').mockImplementation(async (...args) => {
    if (fail && args[0] === intentKey) throw unavailable;
    return set(...args);
  });
  const watch = redis.watch.bind(redis);
  vi.spyOn(redis, 'watch').mockImplementation(async (...keys) => {
    const tx = await watch(...keys);
    if (fail && keys.includes(claimKey) && keys.includes(intentKey)) {
      vi.spyOn(tx, 'exec').mockRejectedValueOnce(unavailable);
    }
    return tx;
  });

  await expect(createPost({ includePrivateSample: true })).rejects.toThrow(unavailable);
  expect(post).not.toHaveBeenCalled();
  expect(await redis.get(intentKey)).toBeUndefined();
  expect(await redis.get(claimKey)).toBeUndefined();

  fail = false;
  await expect(createPost({ includePrivateSample: true })).resolves.toBe('t3_retry');
  expect(await redis.get(claimKey)).toBe(day);
  expect(await redis.get('cc:v1:post:t3_retry')).toBe(day);
  vi.setSystemTime(new Date('2026-11-29T12:00:00Z'));
  await expect(createPost({ includePrivateSample: true })).resolves.toBeNull();
  expect(post).toHaveBeenCalledOnce();
});

privateTest('an ambiguous submission keeps the sample claim and the post intent for inspection', async () => {
  const day = mockClock();
  const post = vi.spyOn(reddit, 'submitCustomPost').mockRejectedValue(new Error('Reddit response lost'));

  await expect(createPost({ includePrivateSample: true })).rejects.toThrow('Reddit response lost');
  expect(await redis.get('cc:v1:playtest-sample-claim')).toBe(day);
  expect(JSON.parse((await redis.get(key(day, 'post-intent'))) ?? 'null')).toMatchObject({ day, status: 'creating' });
  await expect(createPost({ includePrivateSample: true })).rejects.toThrow('inspection');
  expect(post).toHaveBeenCalledOnce();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function scheduledFixture(day: string): Promise<Question> {
  const draft = { question: 'Synthetic post test fixture?', answers: ['One', 'Two', 'Three', 'Four'] };
  const submitted = await submit(redis, 't2_author', 'fixture', draft);
  if (!('id' in submitted)) throw new Error('Failed to create the test question');
  await review(redis, submitted.id, 'approve', tier(day), 'test moderator');
  await redis.del(`cc:v1:schedule:${day}`);
  await ensureWeekSchedule(redis, weekKey(day));
  const question = await scheduledQuestion(redis, day);
  if (!question || question === 'none') throw new Error('Failed to schedule the test question');
  return question;
}

otherSubredditTest('an ambiguous Reddit response never causes a second submit', async () => {
  const day = mockClock();
  await scheduledFixture(day);
  const post = vi.spyOn(reddit, 'submitCustomPost').mockResolvedValue(postFixture('t3_duplicate'));
  post.mockRejectedValueOnce(new Error('Reddit response lost'));

  await expect(createPost()).rejects.toThrow('Reddit response lost');
  await expect(createPost()).rejects.toThrow('inspection');
  expect(post).toHaveBeenCalledOnce();
});

otherSubredditTest('overlapping scheduler and moderator calls send one Reddit request', async () => {
  const day = mockClock();
  await scheduledFixture(day);
  const started = deferred<void>();
  const response = deferred<ReturnType<typeof postFixture>>();
  const post = vi.spyOn(reddit, 'submitCustomPost').mockResolvedValue(postFixture('t3_duplicate'));
  post.mockImplementationOnce(() => {
    started.resolve();
    return response.promise;
  });

  const scheduler = createPost();
  await started.promise;
  try {
    const moderator = await menu.request('/post-create', { method: 'POST' });
    expect(moderator.status).toBe(500);
    expect(post).toHaveBeenCalledOnce();
  } finally {
    response.resolve(postFixture('t3_original'));
    await scheduler;
  }
  await expect(scheduler).resolves.toBe('t3_original');
  await expect(createPost()).resolves.toBe('t3_original');
  expect(post).toHaveBeenCalledOnce();
});

otherSubredditTest('concurrent callers that both saw an empty day share one reservation', async () => {
  const day = mockClock();
  await scheduledFixture(day);
  const post = vi.spyOn(reddit, 'submitCustomPost').mockResolvedValue(postFixture('t3_reserved'));
  const ready = deferred<void>();
  const set = redis.set.bind(redis);
  let claimants = 0;
  vi.spyOn(redis, 'set').mockImplementation(async (...args) => {
    if (args[0] === key(day, 'post-intent') && args[2]?.nx) {
      if (++claimants === 2) ready.resolve();
      await ready.promise;
    }
    return set(...args);
  });

  const attempts = await Promise.allSettled([createPost(), createPost()]);
  expect(claimants).toBe(2);
  expect(attempts).toContainEqual({ status: 'fulfilled', value: 't3_reserved' });
  expect(post).toHaveBeenCalledOnce();
});

otherSubredditTest('a confirmed post resumes indexing without a second submit', async () => {
  const day = mockClock();
  const question = await scheduledFixture(day);
  const post = vi.spyOn(reddit, 'submitCustomPost').mockResolvedValue(postFixture('t3_confirmed'));
  const watch = redis.watch.bind(redis);
  const index = 'cc:v1:post:t3_confirmed';
  let interrupted = false;
  vi.spyOn(redis, 'watch').mockImplementation(async (...args) => {
    const tx = await watch(...args);
    if (args.includes(key(day, 'post-intent')) && !interrupted) {
      interrupted = true;
      vi.spyOn(tx, 'exec').mockRejectedValueOnce(new Error('Redis index unavailable'));
    }
    return tx;
  });

  await expect(createPost()).rejects.toThrow('Redis index unavailable');
  await expect(createPost()).resolves.toBe('t3_confirmed');
  expect(post).toHaveBeenCalledOnce();
  expect(await redis.get(index)).toBe(day);
  expect(await redis.get(key(day, 'gate'))).toBe('open');
  expect((await loadSub(redis, question.id))?.state).toBe('used');
});

otherSubredditTest('legacy confirmed state repairs a missing index and preserves moderation', async () => {
  const day = mockClock();
  const later = await scheduledFixture(day);
  const question = { ...later, id: 'legacy-question' };
  const postId = 't3_legacy';
  await redis.set(key(day, 'round'), JSON.stringify({ day, postId, question }));
  await redis.set(key(day, 'post-intent'), JSON.stringify({ day, postId, question, status: 'created' }));
  await redis.set(key(day, 'gate'), 'void');
  const post = vi.spyOn(reddit, 'submitCustomPost');

  await expect(createPost()).resolves.toBe(postId);
  expect(await redis.get(`cc:v1:post:${postId}`)).toBe(day);
  expect(await redis.get(key(day, 'gate'))).toBe('void');
  expect((await loadSub(redis, later.id))?.state).toBe('scheduled');
  expect(post).not.toHaveBeenCalled();
});

otherSubredditTest('a pending prior day does not block a different scheduled round', async () => {
  const first = mockClock();
  const earlier = await scheduledFixture(first);
  await redis.set(key(first, 'post-intent'), JSON.stringify({ day: first, status: 'creating', question: earlier }));
  const second = '2026-11-29';
  vi.setSystemTime(new Date(`${second}T12:00:00Z`));
  await scheduledFixture(second);
  const post = vi.spyOn(reddit, 'submitCustomPost').mockResolvedValue(postFixture('t3_new_day'));

  await expect(createPost()).resolves.toBe('t3_new_day');
  expect(await redis.get('cc:v1:post:t3_new_day')).toBe(second);
  expect(post).toHaveBeenCalledOnce();
});

otherSubredditTest('the post only consumes the same question snapshot it publishes', async () => {
  const day = mockClock();
  const original = await scheduledFixture(day);
  const competing = await scheduledFixture(day);
  const scheduleKey = `cc:v1:schedule:${day}`;
  await redis.set(scheduleKey, JSON.stringify({ day, question: original, subId: original.id }));
  const get = redis.get.bind(redis);
  let scheduleReads = 0;
  vi.spyOn(redis, 'get').mockImplementation(async (redisKey) => {
    if (redisKey === scheduleKey && ++scheduleReads === 3) {
      await redis.set(scheduleKey, JSON.stringify({ day, question: competing, subId: competing.id }));
    }
    return get(redisKey);
  });
  vi.spyOn(reddit, 'submitCustomPost').mockResolvedValue(postFixture('t3_original'));

  await expect(createPost()).resolves.toBe('t3_original');
  const round = JSON.parse((await redis.get(key(day, 'round'))) ?? 'null');
  expect(round.question.id).toBe(original.id);
  expect((await loadSub(redis, competing.id))?.state).toBe('scheduled');
});
