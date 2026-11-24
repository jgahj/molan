'use strict';

const crypto = require('node:crypto');

const DEFAULT_CODE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_PENDING_CODES = 10000;

function parseOptionalBool(value) {
  if (value === undefined || value === null || value === '') return null;
  const norm = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(norm)) return true;
  if (['0', 'false', 'no', 'off'].includes(norm)) return false;
  return null;
}

function makeError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

function generateSixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function timingSafeCodeEquals(expected, actual) {
  const left = Buffer.from(String(expected || ''), 'utf8');
  const right = Buffer.from(String(actual || ''), 'utf8');
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

function createEmailVerificationService({
  mailService,
  env = process.env,
  siteName = '墨阑 AI 小说',
  codeTtlMs = DEFAULT_CODE_TTL_MS,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  now = () => Date.now(),
  codeGenerator = generateSixDigitCode
} = {}) {
  const store = new Map(); // email -> { code, attempts, createdAt, expiresAt }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function pruneExpired(currentTs) {
    for (const [key, entry] of store.entries()) {
      if (!entry || entry.expiresAt <= currentTs) {
        store.delete(key);
      }
    }
    while (store.size >= MAX_PENDING_CODES) {
      const oldestKey = store.keys().next().value;
      if (oldestKey === undefined) break;
      store.delete(oldestKey);
    }
  }

  async function getPolicy() {
    const explicit = parseOptionalBool(env.MOLAN_EMAIL_VERIFY_ENABLED);
    const emailConfigured = mailService && typeof mailService.isConfigured === 'function'
      ? Boolean(await mailService.isConfigured())
      : false;
    const emailVerifyEnabled = explicit !== null ? explicit : emailConfigured;
    const emailStatusReason = !emailConfigured && mailService && typeof mailService.getLastDiagnostic === 'function'
      ? String(mailService.getLastDiagnostic() || '')
      : '';
    return {
      registrationEnabled: true,
      emailVerifyEnabled,
      emailConfigured,
      emailStatusReason,
      countdownSeconds: Math.max(1, Math.ceil(cooldownMs / 1000)),
      codeLength: 6,
      codeExpiresMinutes: Math.max(1, Math.round(codeTtlMs / 60000)),
      siteName
    };
  }

  async function isVerificationRequired() {
    const policy = await getPolicy();
    return policy.emailVerifyEnabled;
  }

  async function sendRegisterCode(rawEmail) {
    const email = normalizeEmail(rawEmail);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw makeError(400, '邮箱格式不正确', { code: 'INVALID_EMAIL' });
    }
    if (!mailService || typeof mailService.sendVerificationCodeEmail !== 'function') {
      throw makeError(503, '邮件服务尚未配置，暂无法发送验证码', { code: 'EMAIL_NOT_CONFIGURED' });
    }

    const ts = now();
    pruneExpired(ts);

    const existing = store.get(email);
    if (existing && existing.expiresAt > ts) {
      const elapsed = ts - existing.createdAt;
      if (elapsed < cooldownMs) {
        const retryAfter = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
        throw makeError(429, `验证码发送过于频繁，请 ${retryAfter} 秒后再试`, {
          code: 'VERIFY_CODE_TOO_FREQUENT',
          retryAfter
        });
      }
    }

    const code = String(codeGenerator() || '').trim();
    if (!/^\d{6}$/.test(code)) {
      throw makeError(500, '验证码生成失败');
    }

    const record = {
      code,
      attempts: 0,
      createdAt: ts,
      expiresAt: ts + codeTtlMs
    };
    store.set(email, record);

    const expiresMinutes = Math.max(1, Math.round(codeTtlMs / 60000));
    try {
      const delivery = await mailService.sendVerificationCodeEmail({
        to: email,
        code,
        siteName,
        expiresMinutes
      });
      return {
        ok: true,
        email,
        countdown: Math.max(1, Math.ceil(cooldownMs / 1000)),
        expiresMinutes,
        source: delivery && delivery.source ? delivery.source : ''
      };
    } catch (error) {
      // 发信失败时撤回刚写入的记录，不让用户被误锁 60 秒冷却
      if (store.get(email) === record) {
        if (existing && existing.expiresAt > ts) {
          store.set(email, existing);
        } else {
          store.delete(email);
        }
      }
      if (error && error.status) throw error;
      throw makeError(503, '验证码邮件发送失败：' + String(error && error.message || '请稍后重试'), {
        code: 'EMAIL_SEND_FAILED'
      });
    }
  }

  function verifyRegisterCode(rawEmail, rawCode, { consume = true } = {}) {
    const email = normalizeEmail(rawEmail);
    const code = String(rawCode || '').trim();
    if (!code) {
      throw makeError(400, '请输入邮箱验证码', { code: 'VERIFY_CODE_REQUIRED' });
    }
    if (!/^\d{6}$/.test(code)) {
      throw makeError(400, '验证码格式不正确，请输入 6 位数字验证码', { code: 'INVALID_VERIFY_CODE' });
    }

    const ts = now();
    const record = store.get(email);
    if (!record || record.expiresAt <= ts) {
      if (record) store.delete(email);
      throw makeError(400, '验证码无效或已过期，请重新获取', { code: 'INVALID_VERIFY_CODE' });
    }

    if (record.attempts >= maxAttempts) {
      store.delete(email);
      throw makeError(429, '验证码错误次数过多，请重新获取验证码', { code: 'VERIFY_CODE_MAX_ATTEMPTS' });
    }

    if (!timingSafeCodeEquals(record.code, code)) {
      record.attempts += 1;
      if (record.attempts >= maxAttempts) {
        store.delete(email);
        throw makeError(429, '验证码错误次数过多，请重新获取验证码', { code: 'VERIFY_CODE_MAX_ATTEMPTS' });
      }
      const remaining = maxAttempts - record.attempts;
      throw makeError(400, `验证码不正确，还可重试 ${remaining} 次`, { code: 'INVALID_VERIFY_CODE' });
    }

    if (consume) {
      store.delete(email);
    }
    return { ok: true, email };
  }

  function clearAll() {
    store.clear();
  }

  return {
    getPolicy,
    isVerificationRequired,
    sendRegisterCode,
    verifyRegisterCode,
    clearAll
  };
}

module.exports = {
  generateSixDigitCode,
  createEmailVerificationService
};
