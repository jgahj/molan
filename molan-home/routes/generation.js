'use strict';

function createGenerationRoutes(handlers) {
  function dispatchBeforeProxy(req, res, url) {
    if (url.startsWith('/api/benchmark/')) { handlers.benchmark(req, res, url); return true; }
    if (url === '/api/generation-runs' || url.startsWith('/api/generation-runs/')) {
      handlers.generationRuns(req, res, url).catch(error => handlers.generationRunError(res, error));
      return true;
    }
    return false;
  }

  async function dispatchCore(req, res, url) {
    const method = req.method;
    if (method === 'POST' && url === '/api/chat') { handlers.chat(req, res, handlers.legacyGenerationChat); return true; }
    if (method === 'GET' && url === '/api/models') { handlers.models(req, res); return true; }
    if (method === 'POST' && url === '/api/billing/estimate') { handlers.billingEstimate(req, res); return true; }
    if (method === 'POST' && url === '/api/billing/topup') { handlers.billingTopup(req, res); return true; }
    if (method === 'GET' && url === '/api/health') { await handlers.health(req, res); return true; }
    return false;
  }

  function dispatchWebChat(req, res, url) {
    if (req.method === 'POST' && url === '/api/web-chat') { handlers.webChat(req, res); return true; }
    if (req.method === 'GET' && url === '/api/web-chat/status') { handlers.webChatStatus(req, res); return true; }
    return false;
  }

  return { dispatchBeforeProxy, dispatchCore, dispatchWebChat };
}

module.exports = { createGenerationRoutes };
