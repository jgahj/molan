/*
 * pages/js/login.js — 自 login.html 内联脚本外移（2026-10-15 CSP 收紧）
 * 原因：CSP script-src 移除 'unsafe-inline' 后，行内 onsubmit 与
 * `lucide.createIcons()` 调用不得再以 HTML 属性/内联块存在。
 * 本文件先于 site.js 加载（HTML 中的脚本顺序不变），
 * 在此补挂与原 onsubmit 等价的提交守卫，保证无 JS 异常时表单
 * 也不会发生原生 GET 提交；createIcons 调用位置与原内联块一致。
 */
(function () {
  'use strict';
  var form = document.getElementById('loginForm');
  if (form) {
    form.addEventListener('submit', function (event) { event.preventDefault(); });
  }
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
})();
