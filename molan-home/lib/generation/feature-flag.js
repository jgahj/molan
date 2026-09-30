'use strict';

const crypto = require('node:crypto');

/** 按显式开关或稳定用户散列执行分批放量，支持传入集群共享持久化状态对齐多实例部署。 */
function generationV2Enabled(env = process.env, actorId = '', sharedSettings = null) {
  const shared = sharedSettings && typeof sharedSettings === 'object' ? sharedSettings : null;
  const sharedKill = Boolean(shared && (shared.forceOff === true || shared.killSwitch === true || shared.MOLAN_GENERATION_V2_FORCE_OFF === '1'));
  const sharedExplicit = shared ? (typeof shared.generationV2 === 'boolean' ? shared.generationV2 : (typeof shared.enabled === 'boolean' ? shared.enabled : undefined)) : undefined;
  const sharedPercent = shared ? (typeof shared.percent === 'number' ? shared.percent : (typeof shared.MOLAN_GENERATION_V2_PERCENT !== 'undefined' ? Number(shared.MOLAN_GENERATION_V2_PERCENT) : undefined)) : undefined;

  const raw = String(env.MOLAN_GENERATION_V2 || '').trim().toLowerCase();
  const killSwitch = String(env.MOLAN_GENERATION_V2_FORCE_OFF || '').trim().toLowerCase();

  // 熔断保护：无论本地环境变量还是集群共享状态，只要触发紧急停机即全面下线
  if (['1', 'true', 'on', 'enabled'].includes(killSwitch) || sharedKill) return false;
  if (sharedExplicit === false) return false;
  if (['1', 'true', 'on', 'enabled'].includes(raw) || sharedExplicit === true) return true;
  if (['0', 'false', 'off', 'disabled'].includes(raw)) return false;
  if (raw) return false;
  if (!actorId) return false;

  const percent = sharedPercent !== undefined && !Number.isNaN(sharedPercent)
    ? Math.max(0, Math.min(100, sharedPercent))
    : Math.max(0, Math.min(100, Number(env.MOLAN_GENERATION_V2_PERCENT) || 0));
  if (percent <= 0) return false;
  const bucket = crypto.createHash('sha256').update(String(actorId)).digest().readUInt32BE(0) % 100;
  return bucket < percent;
}

function generationV2Status(enabled) {
  const generationV2 = enabled === true;
  return { generationV2, code: generationV2 ? null : 'generation_v2_disabled' };
}

/** 跨实例共享状态提取器，统一收敛从 DB/缓存/文件系统读取的系统配置。 */
function alignClusterFeatureState(sharedStoreResult, env = process.env) {
  const storeState = sharedStoreResult && typeof sharedStoreResult === 'object' ? sharedStoreResult : {};
  return {
    generationV2: storeState.generationV2 ?? storeState.enabled,
    forceOff: Boolean(storeState.forceOff || storeState.killSwitch || ['1', 'true', 'on'].includes(String(env.MOLAN_GENERATION_V2_FORCE_OFF || ''))),
    percent: typeof storeState.percent === 'number' ? storeState.percent : Number(env.MOLAN_GENERATION_V2_PERCENT) || 0
  };
}

module.exports = { generationV2Enabled, generationV2Status, alignClusterFeatureState };
