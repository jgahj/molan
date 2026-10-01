'use strict';

function createNativeBillingService({ repository, isAdminUser, creditCostForUser, roundCreditValue,
  toTokenCount, matchesTokenUsageReservation }) {
  async function reserveCredits(user, modelId, providerModel, requestId, reservedCost, skillAudit, messagesHash, scope, options) {
    const input = { userId: user.userId, userEmail: String(user.email || '').toLowerCase(), modelId, providerModel,
      requestId, reservedCost: isAdminUser(user) ? 0 : roundCreditValue(reservedCost),
      messagesHash, skillAudit, workspaceId: scope?.workspaceId || scope?.workspace_id || '',
      projectId: scope?.projectId || scope?.project_id || '' };
    const old = await repository.lookupTokenUsage(input);
    if (old) return matchesTokenUsageReservation(old, options?.lookupOnly ? { ...input, reservedCost: undefined } : input)
      ? { ok: true, existing: true, reservedCost: old.reservedCost }
      : { ok: false, conflict: true, reservedCost: input.reservedCost };
    if (options?.lookupOnly) return { ok: true, existing: false, missing: true, reservedCost: input.reservedCost };
    try {
      const result = await repository.reserveTokenUsage(input);
      const account = await repository.getAccount(user.userId);
      return { ok: true, existing: result.idempotent, reservedCost: result.reservedCost, remainingCredits: account.credits };
    } catch (error) {
      if (error.code === 'INSUFFICIENT_CREDITS') return { ok: false, reservedCost: input.reservedCost };
      if (error.code === 'IDEMPOTENCY_KEY_REUSED') return { ok: false, conflict: true, reservedCost: input.reservedCost };
      throw error;
    }
  }
  async function recordDispatchAttempt(event) {
    if (!event || !event.requestId) throw Object.assign(new Error('派发记录缺少 requestId'), { status: 422 });
    const user = await repository.getAccount(event.userId || { email: event.userEmail });
    if (!user) throw Object.assign(new Error('账户不存在'), { status: 404 });
    const input = {
      ...event,
      userId: user.userId,
      projectId: event.projectId || '',
      instanceId: event.instanceId || '',
      leaseMs: event.leaseMs,
      leaseUntil: event.leaseUntil
    };
    if (typeof repository.recordDispatchAttempt !== 'function') {
      throw Object.assign(new Error('DISPATCH_RECORDER_REQUIRED: 仓储未实现派发边界记录接口'), { status: 500, code: 'DISPATCH_RECORDER_REQUIRED' });
    }
    const result = await repository.recordDispatchAttempt(input);
    if (!result || result.ok !== true || result.authorized === false || result.status === 'settled' || result.status === 'released' || result.duplicate === true) {
      return {
        ok: false,
        authorized: false,
        duplicate: Boolean(result && result.duplicate),
        status: result && result.status || 'unknown',
        code: result && result.duplicate ? 'DUPLICATE_DISPATCH_ATTEMPT' : (result && result.code || 'DISPATCH_UNAUTHORIZED'),
        ...result
      };
    }
    return { ok: true, authorized: true, ...result };
  }
  async function settleTokenUsage(event) {
    const user = await repository.getAccount(event.userId || { email: event.userEmail });
    if (!user) throw Object.assign(new Error('账户不存在'), { status: 404 });
    const rawTotal = event.totalTokens !== undefined ? event.totalTokens : (event.total_tokens !== undefined ? event.total_tokens : event.usage?.totalTokens);
    const exact = toTokenCount(rawTotal) !== null && event.providerUsageIncomplete !== true && event.provider_usage_incomplete !== true;
    const old = await repository.lookupTokenUsage({ userId: user.userId, projectId: event.projectId || '', requestId: event.requestId });
    if (!old) throw Object.assign(new Error('费用预占不存在'), { status: 409 });
    if (!exact && (old.status === 'provider_unknown' || old.status === 'dispatched' || event.providerUsageIncomplete === true ||
        event.status === 'usage_unavailable' || event.providerRequestSent === true || event.providerResponseReceived === true)) {
      const result = await repository.holdTokenUsage({ userId: user.userId, projectId: event.projectId || '',
        requestId: event.requestId, usage: event });
      return { recorded: !result.idempotent, creditCost: result.actualCost, billingStatus: result.billingStatus };
    }
    const cost = exact ? creditCostForUser(user, event.modelId, event.totalTokens)
      : event.status === 'credit_exhausted' ? roundCreditValue(event.estimatedCreditCost) : 0;
    const actualCost = Math.min(old.reservedCost, cost);
    const result = await repository.settleTokenUsage({ userId: user.userId, projectId: event.projectId || '',
      requestId: event.requestId, actualCost, outcome: event.status || 'succeeded', usage: event });
    return { recorded: !result.idempotent, creditCost: actualCost,
      billingStatus: exact ? 'exact' : event.status === 'credit_exhausted' ? 'capped_estimate' : 'released' };
  }
  return { reserveCredits, settleTokenUsage, recordDispatchAttempt, buildUsageSummary };
}

function buildUsageSummary(rows, aggregate = null) {
  const list = Array.isArray(rows) ? rows : (rows && typeof rows === 'object' && !aggregate && !rows.requestCount && !rows.request_count ? [rows] : []);
  const summary = {
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    requestCount: list.length,
    preciseRequestCount: 0,
    usageUnavailableCount: 0
  };
  const countOf = v => {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    const n = Number(v);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  for (const row of list) {
    const total = countOf(row && row.totalTokens !== undefined ? row.totalTokens : row && row.total_tokens);
    const prompt = countOf(row && row.promptTokens !== undefined ? row.promptTokens : row && row.prompt_tokens);
    const completion = countOf(row && row.completionTokens !== undefined ? row.completionTokens : row && row.completion_tokens);
    const reasoning = countOf(row && row.reasoningTokens !== undefined ? row.reasoningTokens : row && row.reasoning_tokens);
    const isIncomplete = Boolean(
      row && (
        row.providerUsageIncomplete === true ||
        row.provider_usage_incomplete === true ||
        row.status === 'provider_unknown' ||
        row.status === 'usage_unavailable' ||
        row.status === 'dispatched' ||
        row.billingStatus === 'pending' ||
        row.billing_status === 'pending' ||
        (row.usage && (
          row.usage.providerUsageIncomplete === true ||
          row.usage.provider_usage_incomplete === true ||
          row.usage.status === 'provider_unknown' ||
          row.usage.status === 'usage_unavailable' ||
          row.usage.billingStatus === 'pending' ||
          row.usage.billing_status === 'pending'
        ))
      )
    );
    if (total !== null) {
      summary.totalTokens += total;
    }
    if (total === null || isIncomplete) {
      summary.usageUnavailableCount += 1;
    } else {
      summary.preciseRequestCount += 1;
    }
    if (prompt !== null) summary.promptTokens += prompt;
    if (completion !== null) summary.completionTokens += completion;
    if (reasoning !== null) summary.reasoningTokens += reasoning;
    const cached = countOf(row && row.cachedTokens !== undefined ? row.cachedTokens : row && row.cached_tokens);
    const cacheWrite = countOf(row && row.cacheWriteTokens !== undefined ? row.cacheWriteTokens : row && row.cache_write_tokens);
    if (cached !== null) summary.cachedTokens += cached;
    if (cacheWrite !== null) summary.cacheWriteTokens += cacheWrite;
  }
  summary.inputTokens = summary.promptTokens;
  summary.outputTokens = summary.completionTokens;
  summary.cacheHitRate = summary.promptTokens > 0 ? Math.round(summary.cachedTokens / summary.promptTokens * 10000) / 10000 : 0;
  const agg = aggregate || (!Array.isArray(rows) && rows && typeof rows === 'object' && (rows.requestCount !== undefined || rows.request_count !== undefined) ? rows : null);
  if (agg) {
    if (agg.requestCount !== undefined) summary.requestCount = Number(agg.requestCount) || 0;
    else if (agg.request_count !== undefined) summary.requestCount = Number(agg.request_count) || 0;
    if (agg.preciseRequestCount !== undefined) summary.preciseRequestCount = Number(agg.preciseRequestCount) || 0;
    else if (agg.precise_request_count !== undefined) summary.preciseRequestCount = Number(agg.precise_request_count) || 0;
    if (agg.usageUnavailableCount !== undefined) summary.usageUnavailableCount = Number(agg.usageUnavailableCount) || 0;
    else if (agg.usage_unavailable_count !== undefined) summary.usageUnavailableCount = Number(agg.usage_unavailable_count) || 0;
  }
  return summary;
}

module.exports = { createNativeBillingService, buildUsageSummary };
