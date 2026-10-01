'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatAdmissionService } = require('../services/chat-admission-service');

function fixture(t) {
  let time = 0;
  let stopped = 0;
  const service = createChatAdmissionService({ stableUserId: email => `id:${email}`,
    requestLimit: 2, maxInflight: 2, maxPerUser: 1, now: () => time,
    timers: { setInterval: () => ({ unref() {} }), clearInterval: () => stopped++ } });
  t.after(() => service.close());
  return { service, advance: amount => { time += amount; }, stopped: () => stopped };
}

test('rate windows follow stable actors across email changes and isolate other users', t => {
  const { service, advance } = fixture(t);
  assert.equal(service.allowChatRate({ userId: 'a', email: 'old@example.com' }), true);
  assert.equal(service.allowChatRate({ userId: 'a', email: 'new@example.com' }), true);
  assert.equal(service.allowChatRate({ userId: 'a' }), false);
  assert.equal(service.allowChatRate({ userId: 'b' }), true);
  advance(60000);
  assert.equal(service.allowChatRate({ userId: 'a' }), true);
});

test('per-user and global slots remain occupied after an unrelated or repeated release', t => {
  const { service } = fixture(t);
  assert.equal(service.acquireChatSlot({ userId: 'a' }), true);
  assert.equal(service.acquireChatSlot({ userId: 'a' }), false);
  assert.equal(service.acquireChatSlot({ userId: 'b' }), true);
  service.releaseChatSlot({ userId: 'outsider' });
  assert.equal(service.acquireChatSlot({ userId: 'c' }), false);
  service.releaseChatSlot({ userId: 'a' });
  service.releaseChatSlot({ userId: 'a' });
  assert.equal(service.activeCount(), 1);
  assert.equal(service.acquireChatSlot({ userId: 'c' }), true);
  assert.equal(service.acquireChatSlot({ userId: 'd' }), false);
});

test('server instances own independent admission state and release their cleanup timer', t => {
  const first = fixture(t);
  const second = fixture(t);
  first.service.acquireChatSlot({ userId: 'a' });
  assert.equal(second.service.activeCount(), 0);
  first.service.close();
  assert.equal(first.stopped(), 1);
});
