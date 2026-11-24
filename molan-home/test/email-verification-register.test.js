'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const {
  SUB2API_SMTP_KEYS,
  buildSMTPMessage,
  buildVerifyCodeEmailHtml,
  sendSmtpEmailWithConfig,
  createSmtpMailService
} = require('../services/smtp-mail-service');
const { createEmailVerificationService } = require('../services/email-verification-service');
const { createAuthAccountService } = require('../services/auth-account-service');
const { createAuthRoutes } = require('../routes/auth');

function startMockSmtpServer({ authMechanisms = 'PLAIN LOGIN', expectedUser = 'sender@example.com', expectedPass = 'secret-pass' } = {}) {
  const received = [];
  const server = net.createServer(socket => {
    socket.on('error', () => {});
    let buffer = '';
    let inData = false;
    let dataLines = [];
    let loginStage = 0;
    let loginUser = '';
    let currentEnvelope = { from: '', to: '', authMethod: '' };

    socket.write('220 mock-smtp.local ESMTP ready\r\n');

    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      while (true) {
        const idx = buffer.indexOf('\n');
        if (idx < 0) break;
        const rawLine = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);

        if (inData) {
          if (rawLine === '.') {
            inData = false;
            received.push({
              ...currentEnvelope,
              data: dataLines.join('\r\n')
            });
            dataLines = [];
            socket.write('250 2.0.0 OK queued\r\n');
          } else {
            dataLines.push(rawLine.startsWith('..') ? rawLine.slice(1) : rawLine);
          }
          continue;
        }

        if (loginStage === 1) {
          loginUser = Buffer.from(rawLine.trim(), 'base64').toString('utf8');
          loginStage = 2;
          socket.write('334 UGFzc3dvcmQ6\r\n');
          continue;
        }
        if (loginStage === 2) {
          const loginPass = Buffer.from(rawLine.trim(), 'base64').toString('utf8');
          loginStage = 0;
          if (loginUser === expectedUser && loginPass === expectedPass) {
            currentEnvelope.authMethod = 'LOGIN';
            socket.write('235 2.7.0 Authentication successful\r\n');
          } else {
            socket.write('535 5.7.8 Authentication credentials invalid\r\n');
          }
          continue;
        }

        const upper = rawLine.toUpperCase();
        if (upper.startsWith('EHLO ') || upper.startsWith('HELO ')) {
          socket.write('250-mock-smtp.local Hello\r\n');
          socket.write(`250 AUTH ${authMechanisms}\r\n`);
        } else if (upper.startsWith('AUTH PLAIN ')) {
          const payload = Buffer.from(rawLine.slice('AUTH PLAIN '.length).trim(), 'base64').toString('utf8');
          const parts = payload.split('\u0000');
          if (parts[1] === expectedUser && parts[2] === expectedPass) {
            currentEnvelope.authMethod = 'PLAIN';
            socket.write('235 2.7.0 Authentication successful\r\n');
          } else {
            socket.write('535 5.7.8 Authentication credentials invalid\r\n');
          }
        } else if (upper === 'AUTH LOGIN') {
          loginStage = 1;
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (upper.startsWith('MAIL FROM:')) {
          currentEnvelope.from = rawLine.slice('MAIL FROM:'.length).trim();
          socket.write('250 2.1.0 OK\r\n');
        } else if (upper.startsWith('RCPT TO:')) {
          currentEnvelope.to = rawLine.slice('RCPT TO:'.length).trim();
          socket.write('250 2.1.5 OK\r\n');
        } else if (upper === 'DATA') {
          inData = true;
          dataLines = [];
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('500 Unrecognized command\r\n');
        }
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        received,
        close: () => new Promise(done => server.close(done))
      });
    });
  });
}

function createMockReqRes(method, url, body) {
  const req = { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  let statusCode = 0;
  let responseHeaders = {};
  let responsePayload = null;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const res = {
    writeHead(code, headers) {
      statusCode = code;
      responseHeaders = headers || {};
    },
    end(raw) {
      responsePayload = raw ? JSON.parse(String(raw)) : null;
      resolveDone({ status: statusCode, headers: responseHeaders, body: responsePayload });
    }
  };
  return {
    req,
    res,
    body,
    done,
    result: () => ({ status: statusCode, headers: responseHeaders, body: responsePayload })
  };
}

test('SMTP message builder guards header injection and renders Molan verification HTML', () => {
  assert.throws(
    () => buildSMTPMessage({ host: 'smtp.example.com', from: 'a@example.com' }, 'evil@example.com\r\nBcc: x@y.com', 'Hi', '<p>ok</p>'),
    /line break/i
  );

  const html = buildVerifyCodeEmailHtml({ code: '482910', siteName: '墨阑 <测试>', expiresMinutes: 15 });
  assert.ok(html.includes('482910'));
  assert.ok(html.includes('墨阑 &lt;测试&gt;'));
  assert.ok(html.includes('#0a0a0a'));

  const msg = buildSMTPMessage(
    { host: 'smtp.example.com', from: 'noreply@example.com', fromName: '墨阑 AI 小说' },
    'writer@example.com',
    '[墨阑 AI 小说] 注册邮箱验证码：482910',
    html
  );
  assert.equal(msg.envelopeFrom, 'noreply@example.com');
  assert.equal(msg.envelopeTo, 'writer@example.com');
  assert.match(msg.data, /Subject: =\?UTF-8\?B\?/);
  assert.match(msg.data, /Content-Transfer-Encoding: base64/);
  assert.match(msg.data, /Message-ID: <[0-9a-f]{32}@example\.com>/);
});

test('sendSmtpEmailWithConfig delivers mail via AUTH PLAIN and AUTH LOGIN fallback', async () => {
  const plainServer = await startMockSmtpServer({ authMechanisms: 'PLAIN LOGIN' });
  try {
    const res = await sendSmtpEmailWithConfig(
      {
        host: '127.0.0.1',
        port: plainServer.port,
        username: 'sender@example.com',
        password: 'secret-pass',
        from: 'sender@example.com',
        fromName: '墨阑 AI 小说',
        useTLS: false
      },
      'author@example.com',
      '[墨阑 AI 小说] 验证码',
      '<p>123456</p>'
    );
    assert.equal(res.ok, true);
    assert.equal(plainServer.received.length, 1);
    assert.equal(plainServer.received[0].authMethod, 'PLAIN');
    assert.equal(plainServer.received[0].from, '<sender@example.com>');
    assert.equal(plainServer.received[0].to, '<author@example.com>');
  } finally {
    await plainServer.close();
  }

  const loginOnlyServer = await startMockSmtpServer({ authMechanisms: 'LOGIN' });
  try {
    const res = await sendSmtpEmailWithConfig(
      {
        host: '127.0.0.1',
        port: loginOnlyServer.port,
        username: 'sender@example.com',
        password: 'secret-pass',
        from: 'sender@example.com',
        fromName: '墨阑 AI 小说',
        useTLS: false
      },
      'author2@example.com',
      '[墨阑 AI 小说] 验证码',
      '<p>654321</p>'
    );
    assert.equal(res.ok, true);
    assert.equal(loginOnlyServer.received.length, 1);
    assert.equal(loginOnlyServer.received[0].authMethod, 'LOGIN');
  } finally {
    await loginOnlyServer.close();
  }
});

test('SMTP config resolution prioritizes env > config.json > sub2api PostgreSQL settings with caching', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-smtp-cfg-'));
  const sub2EnvPath = path.join(tmpDir, 'sub2.env');
  const molanConfigPath = path.join(tmpDir, 'config.json');
  fs.writeFileSync(sub2EnvPath, 'POSTGRES_USER=sub2api\nPOSTGRES_PASSWORD=pg-test-secret\nPOSTGRES_DB=sub2api\n', 'utf8');

  let pgQueryCount = 0;
  let capturedPgOpts = null;
  const fakePgFactory = opts => {
    capturedPgOpts = opts;
    return {
      async connect() {},
      async query(sql, params) {
        pgQueryCount += 1;
        assert.match(sql, /FROM settings WHERE key = ANY/);
        assert.deepEqual(params[0], SUB2API_SMTP_KEYS);
        return {
          rows: [
            { key: 'smtp_host', value: 'smtp.qq.com' },
            { key: 'smtp_port', value: '465' },
            { key: 'smtp_username', value: 'sub2@qq.com' },
            { key: 'smtp_password', value: 'auth-code-123' },
            { key: 'smtp_from', value: 'sub2@qq.com' },
            { key: 'smtp_from_name', value: 'Sub2API' },
            { key: 'smtp_use_tls', value: 'true' }
          ]
        };
      },
      async end() {}
    };
  };

  try {
    // 1. Sub2API PostgreSQL fallback + caching + Sub2API -> 墨阑 fromName rebrand
    const sub2Service = createSmtpMailService({
      env: { MOLAN_SUB2API_ENV_FILE: sub2EnvPath },
      configFile: molanConfigPath,
      pgClientFactory: fakePgFactory
    });
    const resolved1 = await sub2Service.resolveSmtpConfig();
    const resolved2 = await sub2Service.resolveSmtpConfig();
    assert.equal(pgQueryCount, 1, 'sub2api SMTP config should be cached');
    assert.equal(capturedPgOpts.password, 'pg-test-secret');
    assert.equal(capturedPgOpts.port, 25432);
    assert.equal(resolved1.source, 'sub2api-pg');
    assert.equal(resolved1.host, 'smtp.qq.com');
    assert.equal(resolved1.port, 465);
    assert.equal(resolved1.useTLS, true);
    assert.equal(resolved1.fromName, '墨阑 AI 小说');
    assert.deepEqual(resolved1, resolved2);

    // 2. config.json overrides sub2api fallback
    fs.writeFileSync(molanConfigPath, JSON.stringify({
      smtp: { host: 'smtp.163.com', port: 465, username: 'cfg@163.com', password: 'p', from: 'cfg@163.com', useTLS: true }
    }), 'utf8');
    const cfgService = createSmtpMailService({
      env: { MOLAN_SUB2API_ENV_FILE: sub2EnvPath },
      configFile: molanConfigPath,
      pgClientFactory: fakePgFactory
    });
    const fromFile = await cfgService.resolveSmtpConfig();
    assert.equal(fromFile.source, 'config');
    assert.equal(fromFile.host, 'smtp.163.com');

    // 3. Env overrides config.json
    const envService = createSmtpMailService({
      env: {
        MOLAN_SMTP_HOST: 'smtp.aliyun.com',
        MOLAN_SMTP_PORT: '587',
        MOLAN_SMTP_USERNAME: 'env@aliyun.com',
        MOLAN_SMTP_PASSWORD: 'p2',
        MOLAN_SMTP_FROM: 'env@aliyun.com',
        MOLAN_SMTP_USE_TLS: 'false'
      },
      configFile: molanConfigPath,
      pgClientFactory: fakePgFactory
    });
    const fromEnv = await envService.resolveSmtpConfig();
    assert.equal(fromEnv.source, 'env');
    assert.equal(fromEnv.host, 'smtp.aliyun.com');
    assert.equal(fromEnv.useTLS, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('email verification service enforces cooldown, expiry, 5-attempt lockout, single-use, and failure rollback', async () => {
  let clock = 1_700_000_000_000;
  let shouldFailSend = false;
  const sent = [];

  const mockMail = {
    async isConfigured() { return true; },
    async sendVerificationCodeEmail(payload) {
      if (shouldFailSend) throw new Error('upstream smtp unavailable');
      sent.push(payload);
      return { ok: true, source: 'sub2api-pg' };
    }
  };

  let seq = 0;
  const codes = ['112233', '445566', '778899', '990011'];
  const svc = createEmailVerificationService({
    mailService: mockMail,
    env: {},
    now: () => clock,
    codeGenerator: () => codes[seq++ % codes.length]
  });

  // Failure rollback: should not trap user in cooldown
  shouldFailSend = true;
  await assert.rejects(() => svc.sendRegisterCode('new@example.com'), err => err.status === 503);
  shouldFailSend = false;

  // Immediate retry succeeds
  const s1 = await svc.sendRegisterCode('new@example.com');
  assert.equal(s1.ok, true);
  assert.equal(s1.countdown, 60);
  assert.equal(sent.length, 1);

  // Cooldown enforced within 60s
  clock += 10_000;
  await assert.rejects(
    () => svc.sendRegisterCode('new@example.com'),
    err => err.status === 429 && err.retryAfter === 50
  );

  // 5 wrong attempts lock and invalidate code
  for (let i = 1; i <= 4; i += 1) {
    assert.throws(() => svc.verifyRegisterCode('new@example.com', '000000'), err => err.status === 400);
  }
  assert.throws(() => svc.verifyRegisterCode('new@example.com', '000000'), err => err.status === 429);
  assert.throws(() => svc.verifyRegisterCode('new@example.com', sent[0].code), err => err.status === 400);

  // After cooldown, resend and verify once; replay must fail
  clock += 60_000;
  await svc.sendRegisterCode('new@example.com');
  const code2 = sent[1].code;
  assert.equal(svc.verifyRegisterCode('new@example.com', code2).ok, true);
  assert.throws(() => svc.verifyRegisterCode('new@example.com', code2), err => err.status === 400);

  // Expiry after 15 minutes
  clock += 65_000;
  await svc.sendRegisterCode('expire@example.com');
  const code3 = sent[2].code;
  clock += 15 * 60 * 1000 + 1;
  assert.throws(() => svc.verifyRegisterCode('expire@example.com', code3), err => err.status === 400);
});

test('auth routes enforce email verification when enabled, block duplicate emails before SMTP, and stay backward-compatible when disabled', async () => {
  const accounts = new Map();
  const sessionsCreated = [];
  const sentEmails = [];

  function buildAuthHarness({ emailConfigured, envOverrides = {} }) {
    const mailService = {
      async isConfigured() { return emailConfigured; },
      async sendVerificationCodeEmail(payload) {
        sentEmails.push(payload);
        return { ok: true, source: 'sub2api-pg' };
      }
    };
    const emailVerificationService = createEmailVerificationService({
      mailService,
      env: envOverrides,
      codeGenerator: () => '654321'
    });

    let currentBody = {};
    const service = createAuthAccountService({
      SESSION_TTL_MS: 86400000,
      allowAuthAttempt: () => true,
      authAttemptLimiter: { recordFailure() {}, recordSuccess() {}, retryAfterSeconds: () => 60 },
      applyAuthSessionInvalidation: () => false,
      canChooseModel: () => true,
      crypto,
      currentDefaultModel: () => 'gpt-6-luna',
      emailVerificationService,
      findPlatformModel: () => ({ id: 'gpt-6-luna' }),
      getPostgresUsageSummary: async () => ({ requestCount: 0, totalTokens: 0 }),
      isAdminUser: () => false,
      json: (res, status, payload, headers) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...(headers || {}) });
        res.end(JSON.stringify(payload));
      },
      normalizeUserRole: u => (u && u.role) || 'normal',
      postgresRepository: {
        enabled: true,
        async runtimeAccountByEmail(email) { return accounts.get(email) || null; },
        async runtimeRegisterAccount(user) {
          if (accounts.has(user.email)) return null;
          const saved = { ...user, userId: user.userId || `u_${accounts.size + 1}` };
          accounts.set(user.email, saved);
          return saved;
        },
        async createAuthSession(session) { sessionsCreated.push(session); }
      },
      postgresRuntimeUserFromRow: row => row,
      projectScope: { stableUserId: email => `uid_${email}` },
      readBody: async () => currentBody,
      requestError: (status, message) => Object.assign(new Error(message), { status }),
      resolveFallbackAuth: () => null,
      respondError: (res, err) => {
        res.writeHead(err && err.status ? err.status : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err && err.message ? err.message : '请求失败' }));
      },
      sessionEventUserId: () => ''
    });

    const dispatch = createAuthRoutes({
      registerConfig: service.handleRegisterConfig,
      sendVerifyCode: service.handleSendVerifyCode,
      register: service.handleRegister,
      login: service.handleLogin,
      sendCode: service.handleSendCode,
      loginByCode: service.handleLoginByCode,
      me: service.handleMe,
      profile: service.handleProfile,
      logout: service.handleLogout,
      logoutAll: service.handleLogoutAll,
      adminLogin: service.handleAdminLogin,
      adminMe: service.handleAdminMe,
      usage: async () => {}
    });

    return async (method, url, body = {}) => {
      currentBody = body;
      const io = createMockReqRes(method, url, body);
      const handled = await dispatch(io.req, io.res, url);
      assert.equal(handled, true);
      return io.done;
    };
  }

  // Case 1: SMTP configured -> email verification automatically active
  const callVerified = buildAuthHarness({ emailConfigured: true });
  const cfg = await callVerified('GET', '/api/auth/register-config');
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.emailVerifyEnabled, true);
  assert.equal(cfg.body.emailConfigured, true);

  // Register without verify code must fail
  const missingCode = await callVerified('POST', '/api/auth/register', { email: 'alice@example.com', password: 'password123' });
  assert.equal(missingCode.status, 400);
  assert.match(missingCode.body.error, /验证码/);

  // Send verification code
  const sent = await callVerified('POST', '/api/auth/send-verify-code', { email: 'alice@example.com' });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.countdown, 60);
  assert.equal(sentEmails.length, 1);

  // Register with valid code (using verify_code alias) succeeds
  const regOk = await callVerified('POST', '/api/auth/register', {
    email: 'alice@example.com',
    password: 'password123',
    name: '墨客',
    verify_code: '654321'
  });
  assert.equal(regOk.status, 200);
  assert.equal(regOk.body.ok, true);
  assert.equal(regOk.body.user.name, '墨客');
  assert.equal(regOk.body.user.credits, 500);
  assert.equal(typeof regOk.body.token, 'string');

  // Sending code for already-registered email returns 409 WITHOUT burning SMTP quota
  const dupSend = await callVerified('POST', '/api/auth/send-verify-code', { email: 'alice@example.com' });
  assert.equal(dupSend.status, 409);
  assert.equal(sentEmails.length, 1);

  // Case 2: Forced enabled without SMTP -> fail-closed 503
  const callFailClosed = buildAuthHarness({ emailConfigured: false, envOverrides: { MOLAN_EMAIL_VERIFY_ENABLED: '1' } });
  const failClosed = await callFailClosed('POST', '/api/auth/register', { email: 'bob@example.com', password: 'password123', verifyCode: '654321' });
  assert.equal(failClosed.status, 503);

  // Case 3: Unconfigured offline test mode -> backward compatible registration without code
  const callCompat = buildAuthHarness({ emailConfigured: false });
  const compatCfg = await callCompat('GET', '/api/auth/register-config');
  assert.equal(compatCfg.body.emailVerifyEnabled, false);
  const compatReg = await callCompat('POST', '/api/auth/register', { email: 'compat@example.com', password: 'password123' });
  assert.equal(compatReg.status, 200);
  assert.equal(compatReg.body.ok, true);
});

test('register.html and login.html share homepage ink-paper design system and two-step verification UI', () => {
  const root = path.resolve(__dirname, '..');
  const registerHtml = fs.readFileSync(path.join(root, 'pages', 'register.html'), 'utf8');
  const loginHtml = fs.readFileSync(path.join(root, 'pages', 'login.html'), 'utf8');
  const authCss = fs.readFileSync(path.join(root, 'pages', 'auth.css'), 'utf8');

  for (const [name, html] of [['register.html', registerHtml], ['login.html', loginHtml]]) {
    assert.ok(html.includes('./tokens.css?v='), `${name} must load tokens.css`);
    assert.ok(html.includes('./auth.css?v='), `${name} must load unified auth.css`);
    assert.ok(html.includes('id="authThemeToggle"'), `${name} must support homepage theme toggle`);
    assert.ok(html.includes('auth-brand-mark'), `${name} must use homepage ink brand seal`);
    assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), `${name} must not have inline scripts`);
    assert.ok(!/\son[a-z]+\s*=/i.test(html), `${name} must not have inline event handlers`);
  }

  assert.ok(registerHtml.includes('id="registerStep1Form"'));
  assert.ok(registerHtml.includes('id="registerStep2Form"'));
  assert.ok(registerHtml.includes('id="regVerifyCode"'));
  assert.ok(registerHtml.includes('id="resendCodeBtn"'));
  assert.ok(registerHtml.includes('id="backToStep1Btn"'));
  assert.ok(loginHtml.includes('href="./register.html"'));
  assert.ok(authCss.includes('body.theme-dim'));
  assert.ok(authCss.includes('var(--canvas)'));
  assert.ok(authCss.includes('var(--paper)'));
  assert.ok(authCss.includes('var(--ink)'));
});

test('main SPA workbench integrates two-step email verification registration and global auth entries', () => {
  const root = path.resolve(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const completionPlatformJs = fs.readFileSync(path.join(root, 'completion-platform.js'), 'utf8');
  const appBootJs = fs.readFileSync(path.join(root, 'app-boot.js'), 'utf8');
  const molanShellJs = fs.readFileSync(path.join(root, 'pages', 'molan-shell.js'), 'utf8');

  assert.ok(indexHtml.includes('id="topAuthActions"'), 'index.html topbar should include topAuthActions');
  assert.ok(indexHtml.includes('data-auth-intent="register"'), 'index.html should provide direct register intent entry');
  assert.ok(completionPlatformJs.includes('/api/auth/register-config'), 'SPA login/register must query register-config');
  assert.ok(completionPlatformJs.includes('/api/auth/send-verify-code'), 'SPA register must send 6-digit email verification code');
  assert.ok(completionPlatformJs.includes('verifyCode: verifyCode'), 'SPA register must submit verifyCode in step 2');
  assert.ok(completionPlatformJs.includes('data-c-auth-steps'), 'SPA register must render 2-step indicator');
  assert.ok(completionPlatformJs.includes('window.MolanOpenAuth = openAuthMode'), 'SPA must expose MolanOpenAuth bridge');
  assert.ok(appBootJs.includes("label: '注册新账号'"), 'Ctrl+K command palette must include register entry');
  assert.ok(appBootJs.includes("rawInitialPage === 'register'"), 'app-boot.js must support #register hash alias');
  assert.ok(molanShellJs.includes("'register.html'"), 'molan-shell.js sidebar must link to standalone register.html');
});
