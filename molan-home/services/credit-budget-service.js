'use strict';

function createCreditBudgetService({ promptTokenUpperBound, isAdminUser, creditCostForUser, roundCreditValue }) {
  function reservationTokenUpperBound(messages, maxTokens) {
    const promptTokens = promptTokenUpperBound(messages);
    const completionTokens = Math.max(1, Number.isFinite(Number(maxTokens)) ? Math.floor(Number(maxTokens)) : 8192);
    return Math.min(20000000, promptTokens + completionTokens + 128);
  }

  function reservationCostForRequest(user, modelId, messages, maxTokens) {
    if (isAdminUser(user)) return 0;
    return creditCostForUser(user, modelId, reservationTokenUpperBound(messages, maxTokens));
  }

  // If the requested output cannot fit the current balance, cap the upstream
  // output budget to the largest safe value. This preserves atomic reservations
  // while allowing a low-balance request to finish partially instead of running
  // past the user's account and being settled only after the stream ends.
  function planCreditReservation(user, modelId, messages, requestedMaxTokens) {
    if (isAdminUser(user)) {
      return {
        ok: true,
        maxTokens: requestedMaxTokens,
        reservationTokenLimit: reservationTokenUpperBound(messages, requestedMaxTokens),
        reservedCost: 0,
        cappedByBalance: false
      };
    }
    const balance = roundCreditValue(user && user.credits);
    const requested = Math.max(1, Math.floor(Number(requestedMaxTokens) || 1));
    const requestedTokenLimit = reservationTokenUpperBound(messages, requested);
    const requestedCost = creditCostForUser(user, modelId, requestedTokenLimit);
    if (requestedCost <= balance + 0.000001) {
      return {
        ok: true,
        maxTokens: requested,
        reservationTokenLimit: requestedTokenLimit,
        reservedCost: requestedCost,
        cappedByBalance: false
      };
    }

    let low = 0;
    let high = requested;
    while (low < high) {
      const candidate = Math.ceil((low + high + 1) / 2);
      const candidateCost = creditCostForUser(user, modelId, reservationTokenUpperBound(messages, candidate));
      if (candidateCost <= balance + 0.000001) low = candidate;
      else high = candidate - 1;
    }
    if (low < 1) return { ok: false, cappedByBalance: true, reservedCost: 0, maxTokens: 0, reservationTokenLimit: 0 };
    const reservationTokenLimit = reservationTokenUpperBound(messages, low);
    const reservedCost = creditCostForUser(user, modelId, reservationTokenLimit);
    if (!reservedCost || reservedCost > balance + 0.000001) {
      return { ok: false, cappedByBalance: true, reservedCost: 0, maxTokens: 0, reservationTokenLimit: 0 };
    }
    return { ok: true, maxTokens: low, reservationTokenLimit, reservedCost, cappedByBalance: true };
  }

  return { reservationTokenUpperBound, reservationCostForRequest, planCreditReservation };
}

module.exports = { createCreditBudgetService };
