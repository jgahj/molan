(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MolanGenerationRuns = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TERMINAL_STATES = new Set(['committed', 'cancelled', 'failed', 'provider_unknown', 'rejected']);
  const AUTHOR_STATES = new Set(['waiting_author', 'needs_human']);

  function runPath(id, suffix = '') {
    return `/api/generation-runs/${encodeURIComponent(String(id || ''))}${suffix}`;
  }

  function createGenerationRunClient(options = {}) {
    const request = options.request;
    const wait = options.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    if (typeof request !== 'function') throw new TypeError('Generation Run 客户端需要 request 函数');

    async function create(body, idempotencyKey) {
      const key = String(idempotencyKey || '').trim();
      if (!key) throw new TypeError('Generation Run 缺少 Idempotency-Key');
      return request('/api/generation-runs', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { ...body, idempotencyKey: key }
      });
    }

    async function get(id) {
      return request(runPath(id));
    }

    async function events(id, after = 0, limit = 100) {
      const cursor = Math.max(0, Math.floor(Number(after) || 0));
      const boundedLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
      return request(`${runPath(id, '/events')}?after=${cursor}&limit=${boundedLimit}`);
    }

    async function cancel(id) {
      return request(runPath(id, '/cancel'), { method: 'POST', body: {} });
    }

    async function revise(id, payload) {
      return request(runPath(id, '/revision'), { method: 'POST', body: payload });
    }

    async function commit(id, payload) {
      return request(runPath(id, '/commit'), { method: 'POST', body: payload });
    }

    async function observe(id, settings = {}) {
      let cursor = Math.max(0, Math.floor(Number(settings.after) || 0));
      const interval = Math.max(100, Number(settings.intervalMs) || 650);
      const signal = settings.signal;
      const onEvent = typeof settings.onEvent === 'function' ? settings.onEvent : () => {};
      const onRun = typeof settings.onRun === 'function' ? settings.onRun : () => {};
      let latest = null;

      const stopped = () => Boolean(signal && signal.aborted);
      while (!stopped()) {
        let page;
        try {
          page = await events(id, cursor, 100);
        } catch (error) {
          if (stopped()) break;
          try {
            const snapshot = await get(id);
            latest = snapshot && snapshot.run || null;
            if (latest) onRun(latest, snapshot.stages || []);
            if (latest && (TERMINAL_STATES.has(latest.state) || AUTHOR_STATES.has(latest.state))) {
              return { run: latest, stages: snapshot.stages || [], cursor, events: [], outcome: outcomeOf(latest.state) };
            }
          } catch (_) {
            if (stopped()) break;
          }
          await wait(interval);
          continue;
        }

        const received = Array.isArray(page && page.events) ? page.events : [];
        for (const event of received) {
          const sequence = Number(event && event.sequence);
          if (!Number.isSafeInteger(sequence) || sequence <= cursor) continue;
          cursor = sequence;
          onEvent(event);
        }

        try {
          const snapshot = await get(id);
          latest = snapshot && snapshot.run || null;
          if (latest) onRun(latest, snapshot.stages || []);
          if (latest && (TERMINAL_STATES.has(latest.state) || AUTHOR_STATES.has(latest.state))) {
            return { run: latest, stages: snapshot.stages || [], cursor, events: received, outcome: outcomeOf(latest.state) };
          }
        } catch (_) {
          if (stopped()) break;
        }

        if (page && page.hasMore) continue;
        await wait(interval);
      }

      return { run: latest, stages: [], cursor, events: [], outcome: 'aborted' };
    }

    return { create, get, events, cancel, revise, commit, observe };
  }

  function outcomeOf(state) {
    if (state === 'waiting_author') return 'waiting_author';
    if (state === 'needs_human') return 'needs_human';
    if (state === 'provider_unknown') return 'provider_unknown';
    if (state === 'committed') return 'committed';
    if (state === 'cancelled') return 'cancelled';
    if (state === 'rejected') return 'rejected';
    if (state === 'failed') return 'failed';
    return 'active';
  }

  return { createGenerationRunClient, TERMINAL_STATES, AUTHOR_STATES };
});
