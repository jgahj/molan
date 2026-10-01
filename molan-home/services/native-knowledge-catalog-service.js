'use strict';

const { getGenreCatalog } = require('../lib/genre/genre-registry');
const { listSupportedModels } = require('../lib/model/model-registry');
const { getStyleCatalog } = require('../lib/style/style-registry');

function createNativeKnowledgeCatalogService({ json }) {
  if (typeof json !== 'function') throw new TypeError('Knowledge catalog JSON responder is required');

  function dispatch(req, res, pathname) {
    if (req.method !== 'GET') return false;
    const route = String(pathname || '').split('?')[0];
    let value;
    if (route === '/api/genre-catalog') value = { ok: true, catalog: getGenreCatalog() };
    else if (route === '/api/model-capabilities') value = { ok: true, models: listSupportedModels() };
    else if (route === '/api/style-catalog') value = { ok: true, catalog: getStyleCatalog() };
    else return false;

    json(res, 200, value);
    return true;
  }

  return { dispatch };
}

module.exports = { createNativeKnowledgeCatalogService };
