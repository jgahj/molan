'use strict';

const { getGenreCatalog } = require('../lib/genre/genre-registry');
const { listSupportedModels } = require('../lib/model/model-registry');
const { getStyleCatalog } = require('../lib/style/style-registry');

function createKnowledgeRoutes(handlers) {
  function dispatchLocal(req, res, url) {
    if (req.method === 'GET' && url === '/api/local-style/samples') {
      handlers.localStyleSamples(req, res, new URL(req.url, 'http://molan.local').searchParams);
      return true;
    }
    if (req.method === 'GET' && url === '/api/local-style/baseline') {
      handlers.localStyleBaseline(req, res, new URL(req.url, 'http://molan.local').searchParams);
      return true;
    }
    return false;
  }

  function dispatch(req, res, url) {
    const method = req.method;
    if (method === 'POST' && url === '/api/style/detect') { handlers.styleDetect(req, res); return true; }
    if (method === 'POST' && url === '/api/chapter/health-check') { handlers.chapterHealthCheck(req, res); return true; }
    if (method === 'GET' && url === '/api/genre-catalog') {
      handlers.json(res, 200, { ok: true, catalog: getGenreCatalog() });
      return true;
    }
    if (method === 'GET' && url === '/api/model-capabilities') {
      handlers.json(res, 200, { ok: true, models: listSupportedModels() });
      return true;
    }
    if (method === 'GET' && url === '/api/style-catalog') {
      handlers.json(res, 200, { ok: true, catalog: getStyleCatalog() });
      return true;
    }

    const settle = url.match(/^\/api\/causal-debts\/([^/]+)\/settle$/);
    const extract = url.match(/^\/api\/causal-debts\/([^/]+)\/extract$/);
    const debt = url.match(/^\/api\/causal-debts\/([^/]+)$/);
    if (handlers.postgresMode && method === 'POST' && settle) {
      handlers.postgresDebtSettle(req, res, settle[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (method === 'POST' && settle) { handlers.debtSettle(req, res, settle[1]); return true; }
    if (handlers.postgresMode && method === 'POST' && extract) {
      handlers.postgresDebtsExtract(req, res, extract[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (method === 'POST' && extract) { handlers.debtsExtract(req, res, extract[1]); return true; }
    if (handlers.postgresMode && method === 'GET' && debt) {
      handlers.postgresDebtsGet(req, res, debt[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (method === 'GET' && debt) { handlers.debtsGet(req, res, debt[1]); return true; }
    if (handlers.postgresMode && method === 'POST' && debt) {
      handlers.postgresDebtCreate(req, res, debt[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (method === 'POST' && debt) { handlers.debtCreate(req, res, debt[1]); return true; }
    return false;
  }

  return { dispatchLocal, dispatch };
}

module.exports = { createKnowledgeRoutes };
