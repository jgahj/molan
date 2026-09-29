'use strict';

const crypto = require('node:crypto');

/** 按显式开关或稳定用户散列执行分批放量，默认保持旧生成链。 */
function generationV2Enabled(env = process.env, actorId = '') {
  const raw = String(env.MOLAN_GENERATION_V2 || '').trim().toLowerCase();
  const killSwitch = String(env.MOLAN_GENERATION_V2_FORCE_OFF || '').trim().toLowerCase();
  if (['1', 'true', 'on', 'enabled'].includes(killSwitch)) return false;
  if (['1', 'true', 'on', 'enabled'].includes(raw)) return true;
  if (['0', 'false', 'off', 'disabled'].includes(raw)) return false;
  if (raw) return false;
  if (!actorId) return false;
  const percent = Math.max(0, Math.min(100, Number(env.MOLAN_GENERATION_V2_PERCENT) || 0));
  if (percent <= 0) return false;
  const bucket = crypto.createHash('sha256').update(String(actorId)).digest().readUInt32BE(0) % 100;
  return bucket < percent;
}

function generationV2Status(enabled) {
  const generationV2 = enabled === true;
  return { generationV2, code: generationV2 ? null : 'generation_v2_disabled' };
}

module.exports = { generationV2Enabled, generationV2Status };
