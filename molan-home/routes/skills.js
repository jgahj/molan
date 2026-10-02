'use strict';

function createSkillRoutes(handlers) {
  return async function dispatchSkillRoute(req, res, url) {
    const method = req.method;
    if (method === 'GET' && url === '/api/skills') { await handlers.list(req, res); return true; }
    if (method === 'POST' && url === '/api/skills/import') { await handlers.import(req, res); return true; }
    if (method === 'GET' && url === '/api/open-skills') { await handlers.openList(req, res); return true; }
    if (method === 'POST' && url === '/api/open-skills') { await handlers.openCreate(req, res); return true; }
    const downloadMatch = url.match(/^\/api\/open-skills\/([^/]+)\/download$/);
    const itemMatch = url.match(/^\/api\/open-skills\/([^/]+)$/);
    if (method === 'GET' && itemMatch) { await handlers.openGet(req, res, itemMatch[1]); return true; }
    if (method === 'PATCH' && itemMatch) { await handlers.openPatch(req, res, itemMatch[1]); return true; }
    if (method === 'DELETE' && itemMatch) { await handlers.openDelete(req, res, itemMatch[1]); return true; }
    if (method === 'POST' && downloadMatch) { await handlers.openDownload(req, res, downloadMatch[1]); return true; }
    return false;
  };
}

module.exports = { createSkillRoutes };
