const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createShortsFeed, createShortsInputAdapter } = require('../app');

const item = (id, title = id) => ({ videoId: id, title, channel: 'Test channel' });
const A = 'aaaaaaaaaaa'; const B = 'bbbbbbbbbbb'; const C = 'ccccccccccc'; const D = 'ddddddddddd';

test('Shorts feed deduplicates paginated public results and retains backward history', async () => {
  const calls = [];
  const feed = createShortsFeed({ fetchPage: async (query, token) => {
    calls.push([query, token]);
    return token ? { videos: [item(B), item(C), item(D)], nextPageToken: '' } : { videos: [item(A), item(B), item(B)], nextPageToken: 'page-2' };
  }, prefetchThreshold: 1 });
  let state = await feed.start('popular');
  assert.equal(state.current.videoId, A);
  state = await feed.move(1, { bypassCooldown: true }); assert.equal(state.current.videoId, B);
  state = await feed.move(1, { bypassCooldown: true }); assert.equal(state.current.videoId, C);
  state = await feed.move(-1, { bypassCooldown: true }); assert.equal(state.current.videoId, B);
  assert.deepEqual(calls, [['popular', ''], ['popular', 'page-2']]);
  assert.deepEqual(state.queue.map((video) => video.videoId), [A, B, C, D]);
});

test('Shorts feed honors boundaries, cooldown, inactive state, and page errors', async () => {
  let clock = 1000;
  const feed = createShortsFeed({ now: () => clock, cooldownMs: 400, fetchPage: async () => ({ videos: [item(A)], nextPageToken: '' }) });
  await feed.start('topic');
  assert.equal((await feed.move(-1)).reason, 'start');
  assert.equal((await feed.move(1)).reason, 'end');
  feed.stop(); assert.equal((await feed.move(1)).reason, 'inactive');
  const rapid = createShortsFeed({ now: () => clock, cooldownMs: 400, fetchPage: async () => ({ videos: [item(A), item(B)], nextPageToken: '' }) });
  await rapid.start('topic'); assert.equal((await rapid.move(1)).moved, true); assert.equal((await rapid.move(-1)).reason, 'cooldown'); clock += 401; assert.equal((await rapid.move(-1)).moved, true);
  const failed = createShortsFeed({ fetchPage: async () => { throw new Error('network unavailable'); } });
  await assert.rejects(() => failed.start('topic'), /network unavailable/);
});

test('Shorts input adapter maps ArrowUp/ArrowDown only outside text entry and rate-limits swipes', () => {
  let clock = 0; const moves = [];
  const adapter = createShortsInputAdapter({ now: () => clock, cooldownMs: 300, onNext: () => moves.push('next'), onPrevious: () => moves.push('previous') });
  const event = (key, target = {}) => ({ key, target, prevented: false, preventDefault() { this.prevented = true; } });
  assert.equal(adapter.handle(event('ArrowUp')), true); assert.deepEqual(moves, ['next']);
  assert.equal(adapter.handle(event('ArrowDown')), true); assert.deepEqual(moves, ['next']);
  clock = 301; assert.equal(adapter.handle(event('ArrowDown')), true); assert.deepEqual(moves, ['next', 'previous']);
  assert.equal(adapter.handle(event('ArrowUp', { matches: () => true })), false);
  assert.equal(adapter.handle(event('Enter')), false);
});
