/*
 * pages/js/register.js — 墨阑独立注册页交互逻辑（复刻 sub2api 两步邮箱验证码流）
 * 严格遵循 CSP 无内联脚本要求。
 */
(function () {
  'use strict';

  var API = location.origin.indexOf('http') === 0 ? '' : 'http://localhost:3000';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  var state = {
    step: 1,
    emailVerifyEnabled: true,
    emailConfigured: true,
    countdownSeconds: 60,
    expiresMinutes: 15,
    countdown: 0,
    timerId: null,
    submitting: false,
    resending: false,
    email: '',
    name: '',
    password: ''
  };

  function $(id) { return document.getElementById(id); }

  function safeRedirectUrl() {
    var raw = new URLSearchParams(location.search).get('redirect') || '';
    if (!raw) return '../index.html';
    if (/^[a-z]+:/i.test(raw) || raw.indexOf('//') === 0) return '../index.html';
    return raw;
  }

  function syncCrossLinks() {
    var search = location.search || '';
    var headerLogin = $('headerLoginLink');
    var footerLogin = $('footerLoginLink');
    if (headerLogin && search) headerLogin.setAttribute('href', './login.html' + search);
    if (footerLogin && search) footerLogin.setAttribute('href', './login.html' + search);
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
    }
  }

  function applyTheme(dark, persist) {
    var enabled = Boolean(dark);
    document.documentElement.classList.toggle('dark', enabled);
    document.documentElement.classList.toggle('light', !enabled);
    document.documentElement.setAttribute('data-theme', enabled ? 'dark' : 'light');
    if (document.body) document.body.classList.toggle('theme-dim', enabled);
    if (persist) {
      try { localStorage.setItem('molan_theme', enabled ? 'dim' : 'light'); } catch (_) {}
    }
    var toggle = $('authThemeToggle');
    if (toggle) {
      var label = toggle.querySelector('.auth-theme-label');
      var icon = toggle.querySelector('[data-lucide]');
      if (label) label.textContent = enabled ? '浅色' : '深色';
      if (icon) icon.setAttribute('data-lucide', enabled ? 'sun' : 'moon');
      toggle.setAttribute('aria-label', enabled ? '切换到宣纸浅色主题' : '切换到护眼深色主题');
      refreshIcons();
    }
  }

  function initTheme() {
    var saved = '';
    try { saved = localStorage.getItem('molan_theme') || ''; } catch (_) {}
    applyTheme(saved === 'dim' || saved === 'dark', false);
    window.addEventListener('storage', function (event) {
      if (event && event.key === 'molan_theme') {
        applyTheme(event.newValue === 'dim' || event.newValue === 'dark', false);
      }
    });
    var toggle = $('authThemeToggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var dark = !document.body.classList.contains('theme-dim');
        applyTheme(dark, true);
      });
    }
  }

  function setTip(msg, tone) {
    var tip = $('registerTip');
    if (!tip) return;
    tip.textContent = msg || '';
    tip.classList.remove('is-success', 'is-info');
    if (tone === 'success') tip.classList.add('is-success');
    else if (tone === 'info') tip.classList.add('is-info');
  }

  function apiRequest(path, options) {
    var opts = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store'
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || ('请求失败（' + res.status + '）'));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function bindEyeToggle(btnId, inputId) {
    var btn = $(btnId);
    var input = $(inputId);
    if (!btn || !input) return;
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      var icon = btn.querySelector('[data-lucide]');
      if (icon) {
        icon.setAttribute('data-lucide', show ? 'eye-off' : 'eye');
        refreshIcons();
      }
    });
  }

  function updateResendButton() {
    var btn = $('resendCodeBtn');
    if (!btn) return;
    if (state.resending) {
      btn.disabled = true;
      btn.textContent = '正在发送…';
    } else if (state.countdown > 0) {
      btn.disabled = true;
      btn.textContent = '重新发送 (' + state.countdown + 's)';
    } else {
      btn.disabled = false;
      btn.textContent = '重新发送验证码';
    }
  }

  function startCountdown(seconds) {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    state.countdown = Math.max(0, Number(seconds) || 0);
    updateResendButton();
    if (state.countdown <= 0) return;
    state.timerId = setInterval(function () {
      state.countdown -= 1;
      if (state.countdown <= 0) {
        state.countdown = 0;
        clearInterval(state.timerId);
        state.timerId = null;
      }
      updateResendButton();
    }, 1000);
  }

  function renderStep() {
    var step1Form = $('registerStep1Form');
    var step2Form = $('registerStep2Form');
    var stepsWrap = $('registerSteps');
    var badge1 = $('stepBadge1');
    var badge2 = $('stepBadge2');
    var eyebrow = $('registerEyebrow');
    var title = $('registerTitle');
    var subtitle = $('registerSubtitle');
    var nextLabel = $('registerNextLabel');

    if (stepsWrap) stepsWrap.hidden = !state.emailVerifyEnabled;

    if (state.step === 1) {
      if (step1Form) step1Form.hidden = false;
      if (step2Form) step2Form.hidden = true;
      if (badge1) { badge1.classList.add('is-active'); badge1.classList.remove('is-done'); }
      if (badge2) { badge2.classList.remove('is-active', 'is-done'); }
      if (eyebrow) eyebrow.textContent = state.emailVerifyEnabled ? 'STEP 1 OF 2 · REGISTER' : 'REGISTER';
      if (title) title.textContent = '注册新账号';
      if (subtitle) {
        subtitle.textContent = state.emailVerifyEnabled
          ? '填写邮箱与密码，系统将自动向你的邮箱发送 6 位数字验证码。'
          : '填写邮箱与密码，立即开启你的墨阑创作工作台。';
      }
      if (nextLabel) {
        nextLabel.textContent = state.emailVerifyEnabled ? '继续并发送验证码' : '立即注册';
      }
    } else {
      if (step1Form) step1Form.hidden = true;
      if (step2Form) step2Form.hidden = false;
      if (badge1) { badge1.classList.remove('is-active'); badge1.classList.add('is-done'); }
      if (badge2) { badge2.classList.add('is-active'); badge2.classList.remove('is-done'); }
      if (eyebrow) eyebrow.textContent = 'STEP 2 OF 2 · EMAIL VERIFY';
      if (title) title.textContent = '验证你的邮箱';
      if (subtitle) subtitle.textContent = '请输入收件箱中收到的 6 位数字验证码，验证通过后立即完成注册。';
      var targetEl = $('verifyTargetEmail');
      var expireEl = $('verifyExpireText');
      if (targetEl) targetEl.textContent = state.email;
      if (expireEl) expireEl.textContent = String(state.expiresMinutes || 15);
      var codeInput = $('regVerifyCode');
      if (codeInput) {
        codeInput.value = '';
        setTimeout(function () { codeInput.focus(); }, 40);
      }
    }
  }

  function saveAuthAndRedirect(data) {
    try {
      if (data && data.token) localStorage.setItem('ml_token', data.token);
      if (data && data.user) localStorage.setItem('ml_user', JSON.stringify(data.user));
    } catch (_) {}
    setTip('注册成功，已赠送 500 创作积分，正在进入工作台…', 'success');
    setTimeout(function () {
      location.href = safeRedirectUrl();
    }, 650);
  }

  function loadRegisterConfig() {
    return apiRequest('/api/auth/register-config', { method: 'GET' })
      .then(function (cfg) {
        state.emailVerifyEnabled = Boolean(cfg.emailVerifyEnabled);
        state.emailConfigured = Boolean(cfg.emailConfigured);
        if (cfg.countdownSeconds) state.countdownSeconds = Number(cfg.countdownSeconds) || 60;
        if (cfg.codeExpiresMinutes) state.expiresMinutes = Number(cfg.codeExpiresMinutes) || 15;
        renderStep();
        if (state.emailVerifyEnabled && !state.emailConfigured) {
          setTip('当前已开启邮箱验证，但尚未检测到可用的 SMTP 邮箱配置，请确认 sub2api 邮箱配置或环境变量。', 'error');
        }
      })
      .catch(function () {
        renderStep();
      });
  }

  function handleStep1Submit(event) {
    event.preventDefault();
    if (state.submitting) return;
    var email = String(($('regEmail') || {}).value || '').trim().toLowerCase();
    var name = String(($('regName') || {}).value || '').trim();
    var password = String(($('regPassword') || {}).value || '');
    var confirmPassword = String(($('regConfirmPassword') || {}).value || '');

    if (!EMAIL_RE.test(email)) { setTip('请输入正确的邮箱地址'); return; }
    if (name.length > 24) { setTip('笔名 / 昵称不能超过 24 个字符'); return; }
    if (password.length < 6 || password.length > 256) { setTip('密码长度需为 6 到 256 位'); return; }
    if (password !== confirmPassword) { setTip('两次输入的密码不一致，请核对'); return; }

    state.email = email;
    state.name = name;
    state.password = password;
    state.submitting = true;
    var nextBtn = $('registerNextBtn');
    var nextLabel = $('registerNextLabel');
    if (nextBtn) nextBtn.disabled = true;

    if (!state.emailVerifyEnabled) {
      if (nextLabel) nextLabel.textContent = '正在创建账号…';
      setTip('', 'info');
      apiRequest('/api/auth/register', {
        method: 'POST',
        body: { email: email, password: password, name: name || undefined }
      }).then(saveAuthAndRedirect)
        .catch(function (err) { setTip(err.message || '注册失败，请稍后重试'); })
        .finally(function () {
          state.submitting = false;
          if (nextBtn) nextBtn.disabled = false;
          if (nextLabel) nextLabel.textContent = '立即注册';
        });
      return;
    }

    if (nextLabel) nextLabel.textContent = '正在发送验证码…';
    setTip('正在向 ' + email + ' 发送验证码…', 'info');

    apiRequest('/api/auth/send-verify-code', {
      method: 'POST',
      body: { email: email }
    }).then(function (data) {
      if (data && data.expiresMinutes) state.expiresMinutes = Number(data.expiresMinutes) || state.expiresMinutes;
      state.step = 2;
      setTip('', 'info');
      renderStep();
      startCountdown((data && data.countdown) || state.countdownSeconds);
    }).catch(function (err) {
      if (err && err.status === 429 && err.data && err.data.retryAfter) {
        // 仍在冷却期内：允许用户直接进入第 2 步填写已收到的验证码
        state.step = 2;
        renderStep();
        startCountdown(err.data.retryAfter);
        setTip(err.message || '验证码已发送，请查收邮箱或等待倒计时后重发', 'info');
        return;
      }
      setTip(err.message || '发送验证码失败，请稍后重试');
    }).finally(function () {
      state.submitting = false;
      if (nextBtn) nextBtn.disabled = false;
      if (nextLabel) nextLabel.textContent = state.emailVerifyEnabled ? '继续并发送验证码' : '立即注册';
    });
  }

  function handleStep2Submit(event) {
    event.preventDefault();
    if (state.submitting) return;
    var codeInput = $('regVerifyCode');
    var verifyCode = String(codeInput ? codeInput.value : '').replace(/\D+/g, '').trim();
    if (verifyCode.length !== 6) {
      setTip('请输入完整的 6 位数字验证码');
      if (codeInput) codeInput.focus();
      return;
    }

    state.submitting = true;
    var submitBtn = $('verifySubmitBtn');
    var submitLabel = $('verifySubmitLabel');
    if (submitBtn) submitBtn.disabled = true;
    if (submitLabel) submitLabel.textContent = '正在验证并注册…';
    setTip('', 'info');

    apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        email: state.email,
        password: state.password,
        name: state.name || undefined,
        verifyCode: verifyCode
      }
    }).then(saveAuthAndRedirect)
      .catch(function (err) {
        setTip(err.message || '验证失败，请核对验证码后重试');
      })
      .finally(function () {
        state.submitting = false;
        if (submitBtn) submitBtn.disabled = false;
        if (submitLabel) submitLabel.textContent = '验证并完成注册';
      });
  }

  function handleResendCode() {
    if (state.resending || state.countdown > 0 || !state.email) return;
    state.resending = true;
    updateResendButton();
    setTip('正在重新发送验证码…', 'info');

    apiRequest('/api/auth/send-verify-code', {
      method: 'POST',
      body: { email: state.email }
    }).then(function (data) {
      setTip('新验证码已发送至 ' + state.email + '，请注意查收', 'success');
      startCountdown((data && data.countdown) || state.countdownSeconds);
    }).catch(function (err) {
      if (err && err.status === 429 && err.data && err.data.retryAfter) {
        startCountdown(err.data.retryAfter);
      }
      setTip(err.message || '重新发送失败，请稍后重试');
    }).finally(function () {
      state.resending = false;
      updateResendButton();
    });
  }

  function handleBackToStep1() {
    state.step = 1;
    setTip('', 'info');
    renderStep();
    var emailEl = $('regEmail');
    if (emailEl) emailEl.focus();
  }

  function init() {
    initTheme();
    syncCrossLinks();
    refreshIcons();

    bindEyeToggle('toggleRegPassword', 'regPassword');
    bindEyeToggle('toggleRegConfirmPassword', 'regConfirmPassword');

    var step1Form = $('registerStep1Form');
    var step2Form = $('registerStep2Form');
    var backBtn = $('backToStep1Btn');
    var resendBtn = $('resendCodeBtn');
    var codeInput = $('regVerifyCode');

    if (step1Form) step1Form.addEventListener('submit', handleStep1Submit);
    if (step2Form) step2Form.addEventListener('submit', handleStep2Submit);
    if (backBtn) backBtn.addEventListener('click', handleBackToStep1);
    if (resendBtn) resendBtn.addEventListener('click', handleResendCode);
    if (codeInput) {
      codeInput.addEventListener('input', function () {
        var cleaned = codeInput.value.replace(/\D+/g, '').slice(0, 6);
        if (codeInput.value !== cleaned) codeInput.value = cleaned;
      });
    }

    renderStep();
    loadRegisterConfig();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
