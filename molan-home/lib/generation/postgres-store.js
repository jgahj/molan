'use strict';

/** 将 PostgreSQL 仓储适配为 Generation Orchestrator 使用的统一接口。 */
function createPostgresGenerationStore(repository) {
  if (!repository || typeof repository.createGenerationRun !== 'function') {
    throw new TypeError('PostgreSQL Generation 仓储不可用');
  }
  return {
    createRun(_db, input) { return repository.createGenerationRun(input); },
    getRun(_db, input) { return repository.getGenerationRun(input); },
    getRunById(_db, input) { return repository.getGenerationRunById(input); },
    getRunInput(_db, input) { return repository.getGenerationRunInput(input); },
    updateRun(_db, input) { return repository.updateGenerationRun(input); },
    acquireLease(_db, input) { return repository.acquireGenerationRunLease(input); },
    renewLease(_db, input) { return repository.renewGenerationRunLease(input); },
    releaseLease(_db, input) { return repository.releaseGenerationRunLease(input); },
    beginProvider(_db, input) { return repository.beginGenerationProvider(input); },
    requestPause(_db, input) { return repository.requestGenerationPause(input); },
    resumeRun(_db, input) { return repository.resumeGenerationRun(input); },
    recoverExpiredRuns(_db, scopeOrNow, maybeNow) {
      const scope = scopeOrNow && typeof scopeOrNow === 'object' ? scopeOrNow : {};
      const now = scope.now ?? (typeof scopeOrNow === 'number' ? scopeOrNow : maybeNow);
      return repository.recoverExpiredGenerationRuns({ ...scope, now });
    },
    appendEvent(_db, input) { return repository.appendGenerationEvent(input); },
    recordStage(_db, input) { return repository.recordGenerationStage(input); },
    listStages(_db, input) { return repository.listGenerationStages(input); },
    listEvents(_db, input) { return repository.listGenerationEvents(input); }
  };
}

module.exports = { createPostgresGenerationStore };
