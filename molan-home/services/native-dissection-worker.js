'use strict';
const { hashJson } = require('../lib/evolution/replay-manifest');

function createNativeDissectionWorker({ repository, phases, callStage, getAccount, leaseMs = 300000 }) {
  const active = new Map();
  async function execute({ actorUserId, jobId, authToken }) {
    if (active.has(jobId)) return active.get(jobId);
    const task = (async () => {
      const scope = { actorUserId, jobId };
      const lease = await repository.acquireLease({ ...scope, workerId: 'native-dissection', leaseMs });
      const leased = { ...scope, leaseToken: lease.leaseToken, fence: lease.fence };
      let current = await repository.get(scope);
      try {
        const completed = new Set((await repository.listStages(scope)).map(stage => stage.stageId));
        for (const stageId of phases) {
          if (completed.has(stageId)) continue;
          await repository.renewLease({ ...leased, leaseMs });
          current = await repository.get(scope);
          const requestId = `${jobId}:${stageId}`;
          const requestHash = hashJson({ stageId, sourceHash: current.sourceHash, selectedModel: current.selectedModel, versions: current.versions });
          const attempt = await repository.beginProvider({ ...leased, requestId, requestHash, model: current.selectedModel });
          if (attempt.alreadyCompleted) throw Object.assign(new Error('Provider 已完成但阶段未持久化，需要人工恢复'), { code: 'PROVIDER_RESULT_REVIEW_REQUIRED' });
          const user = await getAccount(actorUserId);
          let output;
          const controller = new AbortController();
          let renewal = Promise.resolve();
          const renewalTimer = setInterval(() => {
            renewal = renewal.then(() => repository.renewLease({ ...leased, leaseMs }))
              .catch(error => { controller.abort(error); });
          }, Math.min(30000, Math.max(1, Math.floor(leaseMs / 3))));
          try { output = await callStage({ record: current, stageId, user, authToken, requestId, controller }); }
          catch (error) {
            await repository.endProvider({ ...leased, requestId, requestHash, attemptToken: attempt.attemptToken, receipt: { status: 'unknown', error: String(error.code || error.message) } });
            throw error;
          } finally { clearInterval(renewalTimer); await renewal; }
          const usage = { prompt_tokens: output.usage?.promptTokens, completion_tokens: output.usage?.completionTokens };
          const receipt = await repository.endProvider({ ...leased, requestId, requestHash, attemptToken: attempt.attemptToken,
            receipt: { status: 'succeeded', usage, providerRequestId: output.usage?.providerRequestId || '', resultHash: hashJson(output.json) } });
          if (receipt.status !== 'completed') throw new Error('Provider 精确用量不可确认');
          if (Number.isFinite(output.usage?.creditCost) && output.usage.creditCost >= 0) {
            await repository.recordCost({ ...leased, requestId, requestHash, attemptToken: attempt.attemptToken,
              model: current.selectedModel, usage, amount: output.usage.creditCost, currency: 'credits' });
          }
          current = await repository.get(scope);
          await repository.appendStageRun({ ...leased, stageId, requestId, result: output.json, expectedRevision: current.revision });
        }
        current = await repository.get(scope);
        return await repository.complete({ ...leased, expectedRevision: current.revision });
      } catch (error) {
        current = await repository.get(scope);
        if (current.status === 'running') await repository.failRun({ ...leased, expectedRevision: current.revision, error: error.message });
        throw error;
      }
    })();
    active.set(jobId, task);
    try { return await task; } finally { active.delete(jobId); }
  }
  return { execute };
}

module.exports = { createNativeDissectionWorker };
