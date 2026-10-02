'use strict';

function createProjectRoutes({ postgresMode, handlers }) {
  return async function dispatchProjectRoute(req, res, url) {
    const method = req.method;
    let match;
    if (method === 'GET' && url === '/api/characters') { await handlers.charactersList(req, res); return true; }
    if (method === 'GET' && url === '/api/characters/export') { await handlers.charactersExport(req, res); return true; }
    if (method === 'POST' && url === '/api/characters/merge') { await handlers.charactersMerge(req, res); return true; }
    if (method === 'PATCH' && (match = url.match(/^\/api\/characters\/([A-Za-z0-9_]+)$/))) { await handlers.charactersPatch(req, res, match[1]); return true; }
    if (postgresMode && method === 'POST' && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/import-characters$/))) {
      handlers.postgresNovelImportCharacters(req, res, match[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (method === 'POST' && (match = url.match(/^\/api\/novels\/([A-Za-z0-9_]+)\/import-characters$/))) { handlers.novelImportCharacters(req, res, match[1]); return true; }
    if (method === 'GET' && (match = url.match(/^\/api\/shared\/dissection\/([A-Za-z0-9]+)$/))) { handlers.sharedDissectionGet(req, res, match[1]); return true; }
    if (postgresMode && method === 'GET' && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/export$/))) {
      handlers.postgresNovelExport(req, res, match[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (method === 'GET' && (match = url.match(/^\/api\/novels\/([A-Za-z0-9_]+)\/export$/))) { handlers.novelExport(req, res, match[1]); return true; }
    if (postgresMode && method === 'GET' && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/package$/))) {
      handlers.postgresPackageExport(req, res, match[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && method === 'POST' && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/package\/import$/))) {
      handlers.postgresPackageImport(req, res, match[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && method === 'POST' && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/package\/restore$/))) {
      handlers.postgresPackageRestore(req, res, match[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && method === 'GET' && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/resources\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/history$/))) {
      handlers.postgresResourceHistory(req, res, match[1], match[2], match[3]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && method === 'POST' && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/resources\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/history\/(\d+)\/restore$/))) {
      handlers.postgresResourceHistory(req, res, match[1], match[2], match[3], Number(match[4])).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && ['GET', 'POST'].includes(method) && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/resources\/([A-Za-z0-9_-]+)$/))) {
      handlers.postgresResources(req, res, match[1], match[2]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && ['GET', 'POST', 'PATCH', 'DELETE'].includes(method) && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/resources\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/))) {
      handlers.postgresResources(req, res, match[1], match[2], match[3]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && method === 'GET' && url === '/api/workspaces') { handlers.postgresWorkspaceList(req, res).catch(error => handlers.respondPostgresError(res, error)); return true; }
    if (postgresMode && method === 'POST' && url === '/api/workspaces') { handlers.postgresWorkspaceCreate(req, res).catch(error => handlers.respondPostgresError(res, error)); return true; }
    if (postgresMode && method === 'GET' && (match = url.match(/^\/api\/workspaces\/([A-Za-z0-9_-]+)\/members$/))) {
      handlers.postgresWorkspaceMembers(req, res, match[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && ['POST', 'PATCH', 'DELETE'].includes(method) && (match = url.match(/^\/api\/workspaces\/([A-Za-z0-9_-]+)\/members$/))) {
      handlers.postgresWorkspaceMembers(req, res, match[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && method === 'GET' && (match = url.match(/^\/api\/workspaces\/([A-Za-z0-9_-]+)\/projects$/))) {
      handlers.postgresWorkspaceProjectList(req, res, match[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && method === 'GET' && (match = url.match(/^\/api\/workspaces\/([A-Za-z0-9_-]+)\/projects\/(n_[A-Za-z0-9_]+)\/members$/))) {
      handlers.postgresNovelMembers(req, res, match[1], match[2]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && ['POST', 'PATCH', 'DELETE'].includes(method) && (match = url.match(/^\/api\/workspaces\/([A-Za-z0-9_-]+)\/projects\/(n_[A-Za-z0-9_]+)\/members$/))) {
      handlers.postgresNovelMembers(req, res, match[1], match[2]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && method === 'GET' && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)$/))) {
      handlers.postgresNovelGet(req, res, match[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (method === 'PATCH' && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/scenes\/([^/]+)$/))) {
      handlers.novelScenePatch(req, res, match[1], match[2]);
      return true;
    }
    if (postgresMode && method === 'PUT' && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)$/))) {
      handlers.postgresNovelSave(req, res, match[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && method === 'DELETE' && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)$/))) {
      handlers.postgresNovelDelete(req, res, match[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && method === 'POST' && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/restore$/))) {
      handlers.postgresNovelRestore(req, res, match[1]).catch(error => handlers.respondPostgresError(res, error));
      return true;
    }
    if (postgresMode && method === 'GET' && url === '/api/novels') { handlers.postgresNovelList(req, res).catch(error => handlers.respondPostgresError(res, error)); return true; }
    if (postgresMode && method === 'POST' && url === '/api/novels') { handlers.postgresNovelCreate(req, res).catch(error => handlers.respondPostgresError(res, error)); return true; }
    if (method === 'GET' && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/resources\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/history$/))) {
      handlers.novelResourceHistory(req, res, match[1], match[2], match[3]).catch(error => handlers.respondError(res, error, 502));
      return true;
    }
    if (method === 'POST' && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/resources\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/history\/(\d+)\/restore$/))) {
      handlers.novelResourceHistory(req, res, match[1], match[2], match[3], Number(match[4])).catch(error => handlers.respondError(res, error, 502));
      return true;
    }
    if (['GET', 'POST'].includes(method) && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/resources\/([A-Za-z0-9_-]+)$/))) {
      handlers.novelResources(req, res, match[1], match[2]).catch(error => handlers.respondError(res, error, 502));
      return true;
    }
    if (['GET', 'POST', 'PATCH', 'DELETE'].includes(method) && (match = url.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/resources\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/))) {
      handlers.novelResources(req, res, match[1], match[2], match[3]).catch(error => handlers.respondError(res, error, 502));
      return true;
    }
    if (method === 'GET' && url === '/api/workspaces') { handlers.workspaceList(req, res); return true; }
    if (method === 'POST' && url === '/api/workspaces') { handlers.workspaceCreate(req, res).catch(error => handlers.respondError(res, error, 502)); return true; }
    if (['GET', 'POST', 'PATCH', 'DELETE'].includes(method) && (match = url.match(/^\/api\/workspaces\/([A-Za-z0-9_-]+)\/members$/))) {
      handlers.workspaceMembers(req, res, match[1]).catch(error => handlers.respondError(res, error, 502));
      return true;
    }
    if (method === 'GET' && (match = url.match(/^\/api\/workspaces\/([A-Za-z0-9_-]+)\/projects$/))) { handlers.workspaceProjectList(req, res, match[1]); return true; }
    if (method === 'GET' && (match = url.match(/^\/api\/workspaces\/([A-Za-z0-9_-]+)\/projects\/(n_[A-Za-z0-9_]+)\/members$/))) { handlers.novelMembers(req, res, match[1], match[2]); return true; }
    if (['POST', 'PATCH', 'DELETE'].includes(method) && (match = url.match(/^\/api\/workspaces\/([A-Za-z0-9_-]+)\/projects\/(n_[A-Za-z0-9_]+)\/members$/))) {
      handlers.novelMembers(req, res, match[1], match[2]).catch(error => handlers.respondError(res, error, 502));
      return true;
    }
    if (method === 'GET' && (match = url.match(/^\/api\/novels\/([A-Za-z0-9_]+)\/package$/))) { handlers.novelPackageExport(req, res, match[1]); return true; }
    if (method === 'POST' && (match = url.match(/^\/api\/novels\/([A-Za-z0-9_]+)\/package\/import$/))) {
      handlers.novelPackageImport(req, res, match[1]).catch(error => handlers.respondError(res, error, 502));
      return true;
    }
    if (method === 'POST' && (match = url.match(/^\/api\/novels\/([A-Za-z0-9_]+)\/package\/restore$/))) {
      handlers.novelPackageRestore(req, res, match[1]).catch(error => handlers.respondError(res, error, 502));
      return true;
    }
    if (method === 'GET' && (match = url.match(/^\/api\/novels\/([A-Za-z0-9_]+)$/))) { handlers.novelGet(req, res, match[1]); return true; }
    if (method === 'PUT' && (match = url.match(/^\/api\/novels\/([A-Za-z0-9_]+)$/))) { handlers.novelSave(req, res, match[1]); return true; }
    if (method === 'DELETE' && (match = url.match(/^\/api\/novels\/([A-Za-z0-9_]+)$/))) { handlers.novelDelete(req, res, match[1]); return true; }
    if (method === 'POST' && (match = url.match(/^\/api\/novels\/([A-Za-z0-9_]+)\/restore$/))) { handlers.novelRestore(req, res, match[1]); return true; }
    if (method === 'GET' && url === '/api/novels') { handlers.novelList(req, res); return true; }
    if (method === 'POST' && url === '/api/novels') { handlers.novelCreate(req, res); return true; }
    return false;
  };
}

module.exports = { createProjectRoutes };
