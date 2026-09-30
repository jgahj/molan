'use strict';

function createAuthAttemptLimiter({ windowMs = 10 * 60 * 1000, now = Date.now } = {}) {
  const attempts = new Map();
  const cleanupTimer = setInterval(() => {
    const currentTime = now();
    for (const [key, item] of attempts.entries()) {
      if (currentTime - item.startedAt >= windowMs * 2) attempts.delete(key);
    }
  }, windowMs);
  cleanupTimer.unref();

  function allow(req, scope, limit) {
    const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
    const key = scope + '|' + ip;
    const currentTime = now();
    const previous = attempts.get(key);
    if (!previous || currentTime - previous.startedAt >= windowMs) {
      attempts.set(key, { startedAt: currentTime, count: 1 });
      return true;
    }
    if (previous.count >= limit) return false;
    previous.count += 1;
    return true;
  }

  return {
    allow,
    close() { clearInterval(cleanupTimer); }
  };
}

module.exports = { createAuthAttemptLimiter };
