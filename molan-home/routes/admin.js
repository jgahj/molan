'use strict';

function createAdminRoutes(handlers) {
  return async function dispatchAdminRoute(req, res, url) {
    const method = req.method;
    if (method === 'GET' && url === '/api/correction-library') { handlers.correctionSummary(req, res); return true; }
    if (method === 'GET' && url === '/api/correction-library/stats') { handlers.correctionStats(req, res); return true; }
    if (method === 'POST' && url === '/api/correction-library/scan') { handlers.correctionScan(req, res); return true; }
    if (method === 'GET' && url === '/api/correction-library/inbox') { handlers.correctionInboxList(req, res); return true; }
    if (method === 'POST' && url === '/api/correction-library/inbox') { handlers.correctionInbox(req, res); return true; }
    if (method === 'POST' && url === '/api/correction-library/merge') { handlers.correctionMerge(req, res); return true; }
    if (method === 'GET' && url === '/api/admin/correction-library') { handlers.adminCorrection(req, res); return true; }
    if (method === 'GET' && url === '/api/admin/overview') { await handlers.overview(req, res); return true; }
    if (method === 'GET' && url === '/api/admin/models') { handlers.models(req, res); return true; }
    if (method === 'PATCH' && url === '/api/admin/models') { await handlers.modelsPatch(req, res); return true; }
    if (method === 'GET' && url === '/api/admin/skills') { await handlers.skills(req, res); return true; }
    if (method === 'POST' && url === '/api/admin/skills') { await handlers.skillCreate(req, res); return true; }
    if (method === 'GET' && url === '/api/admin/audit') { await handlers.audit(req, res); return true; }
    if (method === 'GET' && url === '/api/admin/character-material/audit') { handlers.characterAudit(req, res); return true; }
    if (method === 'PATCH' && url === '/api/admin/character-material/audit') { await handlers.characterAuditPatch(req, res); return true; }
    if (method === 'GET' && url === '/api/admin/data') { await handlers.dataList(req, res); return true; }
    if (method === 'PATCH' && url === '/api/admin/data') { await handlers.dataPatch(req, res); return true; }
    if (method === 'DELETE' && url === '/api/admin/data') { await handlers.dataDelete(req, res); return true; }
    const userMatch = url.match(/^\/api\/admin\/users\/(.+)$/);
    const skillMatch = url.match(/^\/api\/admin\/skills\/(.+)$/);
    if (method === 'PATCH' && userMatch) { await handlers.userPatch(req, res, userMatch[1]); return true; }
    if (method === 'PATCH' && skillMatch) { await handlers.skillPatch(req, res, skillMatch[1]); return true; }
    if (method === 'DELETE' && skillMatch) { await handlers.skillDelete(req, res, skillMatch[1]); return true; }
    return false;
  };
}

module.exports = { createAdminRoutes };
