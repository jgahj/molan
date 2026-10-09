'use strict';

/**
 * Creates the Creation Books domain router.
 * @param {object} options
 * @param {boolean} options.postgresMode - Whether PostgreSQL mode is active
 * @param {object} options.handlers - Injected handlers map
 * @returns {function(IncomingMessage, ServerResponse, string): Promise<boolean>}
 */
function createCreationBookRoutes({ postgresMode, handlers }) {
  const h = handlers || {};
  const respondError = h.respondError;
  const respondPostgresError = h.respondPostgresError;

  // Handler references with fallback to legacy naming
  const list = h.list || h.handleCreationBooksList;
  const postgresList = h.postgresList || h.handlePostgresCreationBooksList;
  const create = h.create || h.handleCreationBooksCreate;
  const postgresCreate = h.postgresCreate || h.handlePostgresCreationBooksCreate;

  const coreJobCreate = h.coreJobCreate || h.handleCreationCoreJobCreate;
  const postgresCoreJobCreate = h.postgresCoreJobCreate || h.handlePostgresCreationCoreJobCreate;
  const coreJobGet = h.coreJobGet || (h.creationCoreJobHttpService && h.creationCoreJobHttpService.get);
  const coreJobCancel = h.coreJobCancel || (h.creationCoreJobHttpService && h.creationCoreJobHttpService.cancel);

  const bibleGet = h.bibleGet || h.handleCreationBookBibleGet;
  const postgresBibleGet = h.postgresBibleGet || h.handlePostgresCreationBookBibleGet;
  const biblePut = h.biblePut || h.handleCreationBookBiblePut;
  const postgresBiblePut = h.postgresBiblePut || h.handlePostgresCreationBookBiblePut;

  const state = h.state || h.handleCreationBookState;
  const postgresState = h.postgresState || h.handlePostgresCreationBookState;

  const planExpand = h.planExpand || h.handleCreationBookPlanExpand;
  const postgresPlanExpand = h.postgresPlanExpand || h.handlePostgresCreationBookPlanExpand;

  const planReview = h.planReview || h.handleCreationBookPlanReview;
  const postgresPlanReview = h.postgresPlanReview || h.handlePostgresCreationBookPlanReview;

  const linkNovel = h.linkNovel || h.handleCreationBookLinkNovel;
  const postgresLinkNovel = h.postgresLinkNovel || h.handlePostgresCreationBookLinkNovel;

  const chapterContract = h.chapterContract || h.handleCreationBookChapterContract;
  const postgresChapterContract = h.postgresChapterContract || h.handlePostgresCreationBookChapterContract;

  const chapterAudit = h.chapterAudit || h.handleCreationBookChapterAudit;
  const postgresAudit = h.postgresAudit || h.handlePostgresCreationBookAudit;

  const commit = h.commit || h.handleCreationBookCommit;
  const postgresCommit = h.postgresCommit || h.handlePostgresCreationBookCommit;

  const qualityReport = h.qualityReport || h.handleCreationBookQualityReport;
  const postgresQualityReport = h.postgresQualityReport || h.handlePostgresCreationBookQualityReport;

  const debts = h.debts || (h.creationDebtService && h.creationDebtService.handleCreationBookDebts) || h.handleCreationBookDebts;
  const postgresDebts = h.postgresDebts || h.handlePostgresCreationBookDebts;

  const regenerateAsset = h.regenerateAsset || h.handleCreationBookRegenerateAsset;
  const postgresRegenerateAsset = h.postgresRegenerateAsset || h.handlePostgresCreationBookRegenerateAsset;

  return async function dispatchCreationBookRoute(req, res, url) {
    if (!url || !url.startsWith('/api/creation-books')) return false;

    const pathname = url.split('?')[0];
    const method = req.method;
    let m;

    // 1. Collection routes: /api/creation-books
    if (pathname === '/api/creation-books') {
      if (method === 'GET') {
        if (postgresMode && postgresList) {
          await postgresList(req, res).catch(error => respondPostgresError(res, error));
        } else if (list) {
          await list(req, res);
        }
        return true;
      }
      if (method === 'POST') {
        if (postgresMode && postgresCreate) {
          await postgresCreate(req, res).catch(error => respondPostgresError(res, error));
        } else if (create) {
          await create(req, res).catch(error => respondError(res, error, 502));
        }
        return true;
      }
    }

    // 2. Core jobs: /api/creation-books/core-jobs and /api/creation-books/core-jobs/:jobId
    if (pathname === '/api/creation-books/core-jobs') {
      if (method === 'POST') {
        if (postgresMode && postgresCoreJobCreate) {
          await postgresCoreJobCreate(req, res).catch(error => respondPostgresError(res, error));
        } else if (coreJobCreate) {
          await coreJobCreate(req, res).catch(error => respondError(res, error, 502));
        }
        return true;
      }
    }

    if ((m = pathname.match(/^\/api\/creation-books\/core-jobs\/([A-Za-z0-9_]+)$/))) {
      const jobId = m[1];
      if (method === 'GET' && coreJobGet) {
        await coreJobGet(req, res, jobId).catch(error => (postgresMode ? respondPostgresError(res, error) : respondError(res, error)));
        return true;
      }
      if (method === 'DELETE' && coreJobCancel) {
        await coreJobCancel(req, res, jobId).catch(error => (postgresMode ? respondPostgresError(res, error) : respondError(res, error)));
        return true;
      }
    }

    // 3. Item routes: /api/creation-books/:id/...
    if ((m = pathname.match(/^\/api\/creation-books\/([A-Za-z0-9_]+)\/plan-expand$/))) {
      const id = m[1];
      if (method === 'POST') {
        if (postgresMode && postgresPlanExpand) {
          await postgresPlanExpand(req, res, id).catch(error => respondPostgresError(res, error));
        } else if (planExpand) {
          await planExpand(req, res, id).catch(error => respondError(res, error, 502));
        }
        return true;
      }
    }

    if ((m = pathname.match(/^\/api\/creation-books\/([A-Za-z0-9_]+)\/bible$/))) {
      const id = m[1];
      if (method === 'GET') {
        if (postgresMode && postgresBibleGet) {
          await postgresBibleGet(req, res, id).catch(error => respondPostgresError(res, error));
        } else if (bibleGet) {
          await bibleGet(req, res, id);
        }
        return true;
      }
      if (method === 'PUT') {
        if (postgresMode && postgresBiblePut) {
          await postgresBiblePut(req, res, id).catch(error => respondPostgresError(res, error));
        } else if (biblePut) {
          await biblePut(req, res, id).catch(error => respondError(res, error, 502));
        }
        return true;
      }
    }

    if ((m = pathname.match(/^\/api\/creation-books\/([A-Za-z0-9_]+)\/state$/))) {
      const id = m[1];
      if (method === 'GET') {
        if (postgresMode && postgresState) {
          await postgresState(req, res, id).catch(error => respondPostgresError(res, error));
        } else if (state) {
          await state(req, res, id);
        }
        return true;
      }
    }

    if ((m = pathname.match(/^\/api\/creation-books\/([A-Za-z0-9_]+)\/plan-review$/))) {
      const id = m[1];
      if (method === 'POST') {
        if (postgresMode && postgresPlanReview) {
          await postgresPlanReview(req, res, id).catch(error => respondPostgresError(res, error));
        } else if (planReview) {
          await planReview(req, res, id).catch(error => respondError(res, error, 502));
        }
        return true;
      }
    }

    if ((m = pathname.match(/^\/api\/creation-books\/([A-Za-z0-9_]+)\/link-novel$/))) {
      const id = m[1];
      if (method === 'POST') {
        if (postgresMode && postgresLinkNovel) {
          await postgresLinkNovel(req, res, id).catch(error => respondPostgresError(res, error));
        } else if (linkNovel) {
          await linkNovel(req, res, id).catch(error => respondError(res, error, 502));
        }
        return true;
      }
    }

    if ((m = pathname.match(/^\/api\/creation-books\/([A-Za-z0-9_]+)\/chapter-contract$/))) {
      const id = m[1];
      if (method === 'POST') {
        if (postgresMode && postgresChapterContract) {
          await postgresChapterContract(req, res, id).catch(error => respondPostgresError(res, error));
        } else if (chapterContract) {
          await chapterContract(req, res, id).catch(error => respondError(res, error, 502));
        }
        return true;
      }
    }

    if ((m = pathname.match(/^\/api\/creation-books\/([A-Za-z0-9_]+)\/audit$/))) {
      const id = m[1];
      if (method === 'POST') {
        if (postgresMode && postgresAudit) {
          await postgresAudit(req, res, id).catch(error => respondPostgresError(res, error));
        } else if (chapterAudit) {
          await chapterAudit(req, res, id).catch(error => respondError(res, error, 502));
        }
        return true;
      }
    }

    if ((m = pathname.match(/^\/api\/creation-books\/([A-Za-z0-9_]+)\/commit$/))) {
      const id = m[1];
      if (method === 'POST') {
        if (postgresMode && postgresCommit) {
          await postgresCommit(req, res, id).catch(error => respondPostgresError(res, error));
        } else if (commit) {
          await commit(req, res, id).catch(error => respondError(res, error, 502));
        }
        return true;
      }
    }

    if ((m = pathname.match(/^\/api\/creation-books\/([A-Za-z0-9_]+)\/quality-report$/))) {
      const id = m[1];
      if (method === 'GET') {
        if (postgresMode && postgresQualityReport) {
          await postgresQualityReport(req, res, id).catch(error => respondPostgresError(res, error));
        } else if (qualityReport) {
          await qualityReport(req, res, id);
        }
        return true;
      }
    }

    if ((m = pathname.match(/^\/api\/creation-books\/([A-Za-z0-9_]+)\/debts$/))) {
      const id = m[1];
      if (method === 'GET') {
        if (postgresMode && postgresDebts) {
          await postgresDebts(req, res, id).catch(error => respondPostgresError(res, error));
        } else if (debts) {
          await debts(req, res, id);
        }
        return true;
      }
    }

    if ((m = pathname.match(/^\/api\/creation-books\/([A-Za-z0-9_]+)\/regenerate-asset$/))) {
      const id = m[1];
      if (method === 'POST') {
        if (postgresMode && postgresRegenerateAsset) {
          await postgresRegenerateAsset(req, res, id).catch(error => respondPostgresError(res, error));
        } else if (regenerateAsset) {
          await regenerateAsset(req, res, id).catch(error => respondError(res, error, 502));
        }
        return true;
      }
    }

    return false;
  };
}

module.exports = { createCreationBookRoutes };
