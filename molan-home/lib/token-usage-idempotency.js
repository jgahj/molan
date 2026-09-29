'use strict';

/** 读取 SQLite 行或 PostgreSQL 投影中的同一身份字段。 */
function read(row, camel, snake) {
  return row && row[camel] !== undefined ? row[camel] : row && row[snake];
}

/** 验证费用 requestId 是否绑定到原账户、项目、模型和请求哈希；传入金额时也校验原预占。 */
function matchesTokenUsageReservation(existing, expected) {
  if (!existing || !expected) return false;
  const textFields = [
    ['userId', 'user_id'], ['workspaceId', 'workspace_id'], ['projectId', 'project_id'],
    ['modelId', 'model_id'], ['providerModel', 'provider_model'], ['messagesHash', 'messages_sha256']
  ];
  if (String(read(existing, 'userEmail', 'user_email') || '').trim().toLowerCase() !==
      String(read(expected, 'userEmail', 'user_email') || '').trim().toLowerCase()) return false;
  for (const [camel, snake] of textFields) {
    if (String(read(existing, camel, snake) || '') !== String(read(expected, camel, snake) || '')) return false;
  }
  const expectedCostValue = read(expected, 'reservedCost', 'reserved_cost');
  if (expectedCostValue === undefined || expectedCostValue === null) return true;
  const existingCost = Number(read(existing, 'reservedCost', 'reserved_cost')) || 0;
  const expectedCost = Number(expectedCostValue) || 0;
  return existingCost.toFixed(4) === expectedCost.toFixed(4);
}

module.exports = { matchesTokenUsageReservation };
