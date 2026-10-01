'use strict';

/** Per-server request admission; no entry-point globals or storage dependencies. */
function createChatAdmissionService({ stableUserId, requestLimit, maxInflight, maxPerUser,
  windowMs = 60000, now = Date.now, timers = { setInterval, clearInterval } }) {
  const rate = new Map();
  const users = new Map();
  let inflight = 0;
  function actorKey(value) {
    if (value && typeof value === 'object' && value.userId) return String(value.userId);
    const email = value && typeof value === 'object' ? value.email : value;
    return stableUserId(String(email || '').trim().toLowerCase());
  }
  function allowChatRate(actor) {
    const key = actorKey(actor);
    const time = now();
    const previous = rate.get(key);
    if (!previous || time - previous.startedAt >= windowMs) {
      rate.set(key, { startedAt: time, count: 1 });
      return true;
    }
    if (previous.count >= requestLimit) return false;
    previous.count++;
    return true;
  }
  function acquireChatSlot(actor) {
    const key = actorKey(actor);
    const count = users.get(key) || 0;
    if (inflight >= maxInflight || count >= maxPerUser) return false;
    inflight++;
    users.set(key, count + 1);
    return true;
  }
  function releaseChatSlot(actor) {
    const key = actorKey(actor);
    const count = users.get(key) || 0;
    if (!count) return;
    inflight--;
    if (count > 1) users.set(key, count - 1);
    else users.delete(key);
  }
  function sweep() {
    const time = now();
    for (const [key, item] of rate) if (time - item.startedAt >= windowMs) rate.delete(key);
  }
  const cleanup = timers.setInterval(sweep, 5 * 60000);
  cleanup.unref?.();
  return { allowChatRate, acquireChatSlot, releaseChatSlot, activeCount: () => inflight,
    close: () => timers.clearInterval(cleanup) };
}

module.exports = { createChatAdmissionService };
