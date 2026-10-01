'use strict';

/** HTTP lifecycle owns readiness and shutdown; domain storage remains injected. */
function createServerLifecycleService(deps) {
  const { server, postgresMode, nativeJsonMode, initializeStorage, preparePostgres,
    prepareLocal, flushSessions, flushWrites, closeStorage, stopLocalWorkers,
    port, host, maxConnections } = deps;
  const runtime = deps.runtime || process;
  const logger = deps.logger || console;
  const timers = deps.timers || { setTimeout, clearTimeout };
  let shuttingDown = false;
  let shutdownPromise;
  let started = false;
  let preparation = Promise.resolve();

  function fail(message, error) {
    runtime.exitCode = 1;
    logger.error(message, error);
  }

  function listen() {
    if (shuttingDown) return;
    const onListen = () => {
      logger.log('🖌  墨阑落地页已启动 → http://localhost:' + server.address().port + ' (http://127.0.0.1:' + server.address().port + ')');
      logger.log(postgresMode ? '   🐘 PostgreSQL 权威数据库已启用'
        : nativeJsonMode ? '   📁 原生 JSON 领域仓储已启用' : '   📦 本地兼容存储已启用');
    };
    server.once('error', error => {
      if (error.code === 'EADDRNOTAVAIL' && host !== '127.0.0.1') {
        logger.warn('⚠️  地址监听不可用，回退至 IPv4 127.0.0.1');
        server.listen(port, '127.0.0.1', onListen);
      } else {
        fail('HTTP 监听失败：', error);
        void shutdown('listen-error');
      }
    });
    server.listen(port, host, onListen);
  }

  function shutdown(signal) {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    const deadline = timers.setTimeout(() => {
      fail('Storage shutdown did not complete before the deadline.', new Error('SHUTDOWN_TIMEOUT'));
      runtime.exit(1);
    }, deps.shutdownTimeoutMs || 5000);
    deadline.unref?.();
    shutdownPromise = (async () => {
      await preparation.catch(() => {});
      try { if (!postgresMode) stopLocalWorkers(); }
      catch (error) { fail('Local workers failed to stop:', error); }
      try { flushSessions(); }
      catch (error) { fail('Session shutdown flush failed:', error); }
      try {
        if (server.listening) await new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
        });
      } catch (error) { fail('HTTP shutdown failed:', error); }
      try { await flushWrites(); }
      catch (error) { fail('PostgreSQL writes failed to flush:', error); }
      try { await closeStorage(); }
      catch (error) { fail('Storage shutdown failed:', error); }
    })().finally(() => timers.clearTimeout(deadline));
    logger.log('🛑  墨阑服务正在优雅退出：' + signal);
    return shutdownPromise;
  }

  async function start() {
    if (started) throw new Error('Server lifecycle was already started');
    started = true;
    if (runtime.env.NODE_ENV === 'production' && !postgresMode) {
      throw Object.assign(new Error('Production mode requires PostgreSQL; local storage is not an allowed fallback.'),
        { code: 'PRODUCTION_POSTGRES_REQUIRED' });
    }
    runtime.once('SIGTERM', () => { void shutdown('SIGTERM'); });
    runtime.once('SIGINT', () => { void shutdown('SIGINT'); });
    server.keepAliveTimeout = 5000;
    server.headersTimeout = 15000;
    server.maxRequestsPerSocket = 1000;
    server.maxConnections = maxConnections;
    try {
      preparation = (async () => {
        await initializeStorage();
        if (shuttingDown) return;
        if (postgresMode) await preparePostgres();
        else await prepareLocal();
      })();
      await preparation;
      listen();
    } catch (error) {
      fail('Storage initialization failed; service will not listen:', error);
      deps.onStartupFailure?.(error);
      await shutdown('startup-failure');
    }
  }

  return { start, shutdown };
}

module.exports = { createServerLifecycleService };
