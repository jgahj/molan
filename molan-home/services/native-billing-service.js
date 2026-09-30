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
  async function settleTokenUsage(event) {
    const user = await repository.getAccount(event.userId || { email: event.userEmail });
    if (!user) throw Object.assign(new Error('账户不存在'), { status: 404 });
    const exact = toTokenCount(event.totalTokens) !== null;
    if (!exact && event.status === 'usage_unavailable') return { recorded: false, creditCost: 0, billingStatus: 'pending' };
    const old = await repository.lookupTokenUsage({ userId: user.userId, projectId: event.projectId || '', requestId: event.requestId });
    if (!old) throw Object.assign(new Error('费用预占不存在'), { status: 409 });
    const cost = exact ? creditCostForUser(user, event.modelId, event.totalTokens)
      : event.status === 'credit_exhausted' ? roundCreditValue(event.estimatedCreditCost) : 0;
    const actualCost = Math.min(old.reservedCost, cost);
    const result = await repository.settleTokenUsage({ userId: user.userId, projectId: event.projectId || '',
      requestId: event.requestId, actualCost, outcome: event.status || 'succeeded', usage: event });
    return { recorded: !result.idempotent, creditCost: actualCost,
      billingStatus: exact ? 'exact' : event.status === 'credit_exhausted' ? 'capped_estimate' : 'released' };
  }
  return { reserveCredits, settleTokenUsage };
}
module.exports = { createNativeBillingService };
