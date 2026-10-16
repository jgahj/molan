/*
 * boot-head.js — 自 HTML 内联脚本外移（2026-10-15 CSP 收紧）
 * 原因：CSP script-src 移除 'unsafe-inline' 需外移全部内联脚本；
 * 代码为逐字迁移（行为不变），加载位置与原内联位置一致。
 */
    if (location.protocol !== 'file:') {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = './pages/tokens.css?v=20261014_opt_v2';
      document.head.appendChild(l);
    }
