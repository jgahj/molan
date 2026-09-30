'use strict';

function createDissectionRoutes(handlers) {
  return function dispatchDissectionRoute(req, res, url) {
    const method = req.method;
    let match;
    const dissection = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)$/);
    const exportMatch = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/export$/);
    const applyMatch = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/apply$/);
    const cancelMatch = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/cancel$/);
    const retryMatch = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/retry$/);
    if (method === 'POST' && url === '/api/dissection/extract') { handlers.extract(req, res); return true; }
    if (method === 'POST' && url === '/api/dissections') { handlers.create(req, res); return true; }
    if (method === 'GET' && url === '/api/dissections') { handlers.list(req, res); return true; }
    if (method === 'GET' && exportMatch) { handlers.export(req, res, exportMatch[1]); return true; }
    if (method === 'POST' && applyMatch) {
      handlers.apply(req, res, applyMatch[1]).catch(error => handlers.respondError(res, error, 502));
      return true;
    }
    if (method === 'POST' && (match = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/creative-brief$/))) {
      handlers.creativeBrief(req, res, match[1]).catch(error => handlers.respondError(res, error, 500));
      return true;
    }
    if (method === 'GET' && (match = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/creation-context$/))) { handlers.creationContext(req, res, match[1]); return true; }
    if (method === 'POST' && (match = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/chapter-contract$/))) {
      handlers.chapterContract(req, res, match[1]).catch(error => handlers.respondError(res, error, 500));
      return true;
    }
    if (method === 'POST' && (match = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/audit$/))) {
      handlers.audit(req, res, match[1]).catch(error => handlers.respondError(res, error, 500));
      return true;
    }
    if (method === 'GET' && (match = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/coverage$/))) { handlers.coverage(req, res, match[1]); return true; }
    if (method === 'GET' && (match = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/units$/))) { handlers.units(req, res, match[1]); return true; }
    if (method === 'GET' && (match = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/entities$/))) { handlers.entities(req, res, match[1]); return true; }
    if (method === 'GET' && (match = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/foreshadows$/))) { handlers.foreshadows(req, res, match[1]); return true; }
    if (method === 'GET' && (match = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/summaries$/))) { handlers.summaries(req, res, match[1]); return true; }
    if (method === 'GET' && (match = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/validation$/))) { handlers.validation(req, res, match[1]); return true; }
    if (method === 'GET' && (match = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/search$/))) { handlers.search(req, res, match[1]); return true; }
    if (method === 'POST' && (match = url.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/rebuild$/))) { handlers.rebuild(req, res, match[1]); return true; }
    if (method === 'PATCH' && dissection) { handlers.patch(req, res, dissection[1]); return true; }
    if (method === 'GET' && dissection) { handlers.get(req, res, dissection[1]); return true; }
    if (method === 'POST' && cancelMatch) { handlers.cancel(req, res, cancelMatch[1]); return true; }
    if (method === 'POST' && retryMatch) { handlers.retry(req, res, retryMatch[1]); return true; }
    if (method === 'DELETE' && dissection) { handlers.remove(req, res, dissection[1]); return true; }
    if (method === 'POST' && (match = url.match(/^\/api\/dissection\/([A-Za-z0-9_]+)\/imitate$/))) { handlers.imitate(req, res, match[1]); return true; }
    if (method === 'POST' && (match = url.match(/^\/api\/dissection\/([A-Za-z0-9_]+)\/diagnose$/))) { handlers.diagnose(req, res, match[1]); return true; }
    if (method === 'POST' && (match = url.match(/^\/api\/dissection\/([A-Za-z0-9_]+)\/sync-characters$/))) { handlers.syncCharacters(req, res, match[1]); return true; }
    if (method === 'GET' && (match = url.match(/^\/api\/dissection\/([A-Za-z0-9_]+)\/share$/))) { handlers.share(req, res, match[1]); return true; }
    if (method === 'POST' && (match = url.match(/^\/api\/dissection\/([A-Za-z0-9_]+)\/share$/))) { handlers.share(req, res, match[1]); return true; }
    if (method === 'DELETE' && (match = url.match(/^\/api\/dissection\/([A-Za-z0-9_]+)\/share\/([A-Za-z0-9]+)$/))) { handlers.shareDelete(req, res, match[1], match[2]); return true; }
    if (method === 'GET' && (match = url.match(/^\/api\/dissection\/([A-Za-z0-9_]+)\/versions$/))) { handlers.versions(req, res, match[1]); return true; }
    if (method === 'POST' && (match = url.match(/^\/api\/dissection\/([A-Za-z0-9_]+)\/versions$/))) { handlers.versions(req, res, match[1]); return true; }
    if (['GET', 'POST', 'DELETE'].includes(method) && (match = url.match(/^\/api\/dissection\/([A-Za-z0-9_]+)\/versions\/([A-Za-z0-9_]+)$/))) {
      handlers.version(req, res, match[1], match[2]);
      return true;
    }
    if (method === 'POST' && url === '/api/dissections/compare') { handlers.compare(req, res); return true; }
    if (method === 'POST' && url === '/api/dissections/batch') { handlers.batch(req, res); return true; }
    if (method === 'GET' && url === '/api/dissections/shared') { handlers.sharedList(req, res); return true; }
    return false;
  };
}

module.exports = { createDissectionRoutes };
