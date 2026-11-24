/*
 * pages/js/login.js — 自 login.html 内联脚本外移（2026-10-15 CSP 收紧）
 * 原因：CSP script-src 移除 'unsafe-inline' 后，行内 onsubmit 与
 * `lucide.createIcons()` 调用不得再以 HTML 属性/内联块存在。
 * 本文件先于 site.js 加载（HTML 中的脚本顺序不变），
 * 在此补挂与原 onsubmit 等价的提交守卫，保证无 JS 异常时表单
 * 也不会发生原生 GET 提交；同时同步主页明暗主题切换与注册跳转参数。
 */
(function () {
  'use strict';

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
    var toggle = document.getElementById('authThemeToggle');
    if (toggle) {
      var label = toggle.querySelector('.auth-theme-label');
      var icon = toggle.querySelector('[data-lucide]');
      if (label) label.textContent = enabled ? '浅色' : '深色';
      if (icon) icon.setAttribute('data-lucide', enabled ? 'sun' : 'moon');
      toggle.setAttribute('aria-label', enabled ? '切换到宣纸浅色主题' : '切换到护眼深色主题');
      refreshIcons();
    }
  }

  var form = document.getElementById('loginForm');
  if (form) {
    form.addEventListener('submit', function (event) { event.preventDefault(); });
  }

  var saved = '';
  try { saved = localStorage.getItem('molan_theme') || ''; } catch (_) {}
  applyTheme(saved === 'dim' || saved === 'dark', false);
  window.addEventListener('storage', function (event) {
    if (event && event.key === 'molan_theme') {
      applyTheme(event.newValue === 'dim' || event.newValue === 'dark', false);
    }
  });

  var toggleBtn = document.getElementById('authThemeToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      var dark = !document.body.classList.contains('theme-dim');
      applyTheme(dark, true);
    });
  }

  var search = location.search || '';
  if (search) {
    var headerRegister = document.getElementById('headerRegisterLink');
    var footerRegister = document.querySelector('.login-register');
    if (headerRegister) headerRegister.setAttribute('href', './register.html' + search);
    if (footerRegister) footerRegister.setAttribute('href', './register.html' + search);
  }

  refreshIcons();
})();
