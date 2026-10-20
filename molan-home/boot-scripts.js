/*
 * boot-scripts.js — 自 HTML 内联脚本外移（2026-10-15 CSP 收紧）
 * 原因：CSP script-src 移除 'unsafe-inline' 需外移全部内联脚本；
 * 代码为逐字迁移（行为不变），加载位置与原内联位置一致。
 */
    if (location.protocol !== 'file:') {
      const v = '20261020_fix_v1';
      // 核心脚本（首屏必需）：作品库 / 编辑器 / 平台页 / 工作区装配
      // completion-import.js（resources/dissect/creation）与 completion-admin.js（admin）
      // 改为按路由懒加载，由 app-boot.js 的 renderPage 守卫触发，节省首屏约 399KB。
      [
        `./completion-library.js?v=${v}`,
        `./completion-editor.js?v=${v}`,
        `./completion-platform.js?v=${v}`,
        `./workspace-completion.js?v=${v}`
      ].forEach(src => {
        const s = document.createElement('script');
        s.src = src;
        document.body.appendChild(s);
      });
    }
