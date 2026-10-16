/*
 * admin-login.js — 自 HTML 内联脚本外移（2026-10-15 CSP 收紧）
 * 原因：CSP script-src 移除 'unsafe-inline' 需外移全部内联脚本；
 * 代码为逐字迁移（行为不变），加载位置与原内联位置一致。
 */
    (function () {
      'use strict';
      var form = document.getElementById('adminLoginForm');
      var emailInput = document.getElementById('adminEmail');
      var passwordInput = document.getElementById('adminPassword');
      var submit = document.getElementById('adminSubmit');
      var tip = document.getElementById('adminLoginTip');
      function setTip(message, ok) { tip.textContent = message || ''; tip.style.color = ok ? '#3b9b70' : '#c95858'; }
      function storedToken() { try { return localStorage.getItem('molan_admin_token') || ''; } catch (_) { return ''; } }
      function fetchMe(token) { return fetch('/api/admin/auth/me', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' }).then(function (res) { return res.ok ? res.json() : null; }); }
      function redirectIfAdmin() {
        var token = storedToken();
        if (!token) return;
        fetchMe(token).then(function (data) {
          if (data && data.user && data.user.isAdmin) location.href = './admin.html';
        }).catch(function () {});
      }
      function logoutToken(token) { return fetch('/api/admin/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: '{}' }).catch(function () {}); }
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var email = emailInput.value.trim();
        var password = passwordInput.value;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setTip('请输入正确的管理员邮箱'); return; }
        if (!password) { setTip('请输入登录密码'); return; }
        submit.disabled = true;
        setTip('正在验证管理员权限...', true);
        fetch('/api/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: password }), cache: 'no-store' })
          .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { if (!res.ok) { throw new Error(data.error || '登录失败'); } return data; }); })
          .then(function (data) {
            if (!data.user || !data.user.isAdmin) {
              return logoutToken(data.token).then(function () { throw new Error('该账户没有管理员权限'); });
            }
            try { localStorage.setItem('molan_admin_token', data.token); localStorage.setItem('molan_admin_user', JSON.stringify(data.user)); } catch (_) {}
            setTip('验证通过，正在进入管理后台...', true);
            setTimeout(function () { location.href = './admin.html'; }, 260);
          })
          .catch(function (error) { setTip(error.message || '登录失败'); })
          .finally(function () { submit.disabled = false; });
      });
      redirectIfAdmin();
    }());
