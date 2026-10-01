'use strict';

function createCloudApiConfigService({ fs, configFile, port, env, logger }) {
  let errorMessage = '';

  function normalizeCloudApiBase(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let parsed;
    try { parsed = new URL(raw); } catch (_) { throw new Error('云端同步地址不是合法的 HTTP(S) URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('云端同步地址只支持 HTTP 或 HTTPS');
    if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== '/')) {
      throw new Error('云端同步地址只能填写服务根地址，不能包含账号、参数或路径');
    }
    return parsed.origin;
  }

  function loadCloudApiBase() {
    errorMessage = '';
    let configured = String(env.MOLAN_CLOUD_API_BASE || '').trim();
    if (!configured) {
      try {
        const cfg = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        configured = String(cfg && cfg.cloudApiBase || '').trim();
      } catch (_) {}
    }
    if (!configured) return '';
    try {
      const base = normalizeCloudApiBase(configured);
      const parsed = new URL(base);
      const hostname = String(parsed.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
      const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
      const configuredPort = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
      const localPort = Number(port || 3000);
      if (localHosts.has(hostname) && configuredPort === localPort) {
        throw new Error('云端同步地址不能指向当前本地服务，避免请求循环');
      }
      return base;
    } catch (error) {
      errorMessage = error.message || '云端同步地址不可用';
      logger.warn('[cloud-sync] ' + errorMessage + '，已回退本地数据模式');
      return '';
    }
  }

  return {
    normalizeCloudApiBase,
    loadCloudApiBase,
    getErrorMessage: () => errorMessage
  };
}

module.exports = { createCloudApiConfigService };
