'use strict';

function createSkillRoutes(handlers) {
  return function dispatchSkillRoute(req, res, url) {
    const method = req.method;
    if (method === 'GET' && url === '/api/skills') { handlers.list(req, res); return true; }
    if (method === 'POST' && url === '/api/skills/import') { handlers.import(req, res); return true; }
    if (method === 'GET' && url === '/api/open-skills') { handlers.openList(req, res); return true; }
    if (method === 'POST' && url === '/api/open-skills') { handlers.openCreate(req, res); return true; }
    const downloadMatch = url.match(/^\/api\/open-skills\/([^/]+)\/download$/);
    const itemMatch = url.match(/^\/api\/open-skills\/([^/]+)$/);
    if (method === 'GET' && itemMatch) { handlers.openGet(req, res, itemMatch[1]); return true; }
    if (method === 'PATCH' && itemMatch) { handlers.openPatch(req, res, itemMatch[1]); return true; }
    if (method === 'DELETE' && itemMatch) { handlers.openDelete(req, res, itemMatch[1]); return true; }
    if (method === 'POST' && downloadMatch) { handlers.openDownload(req, res, downloadMatch[1]); return true; }
    return false;
  };
}

module.exports = { createSkillRoutes };
