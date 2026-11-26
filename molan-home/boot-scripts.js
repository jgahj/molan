/*
 * boot-scripts.js — 自 HTML 内联脚本外移（2026-10-15 CSP 收紧）
 * 原因：CSP script-src 移除 'unsafe-inline' 需外移全部内联脚本；
 * 代码为逐字迁移（行为不变），加载位置与原内联位置一致。
 */
    if (location.protocol !== 'file:') {
      const v = '20261126_deep_opt_v2';
      // 核心脚本（首屏必需）：作品库 / 平台页 / 工作区装配
      // completion-editor.js（editor/outline/knowledge，679KB）、completion-import.js（321KB）
      // 与 completion-admin.js（72KB）均按路由懒加载，首屏合计立省约 1,072KB；
      // 同时显式设置 s.async = false，根除公网环境下动态脚本乱序执行的竞态隐患。
      [
        `./pages/js/editor-shared-core.js?v=${v}`,
        `./completion-library.js?v=${v}`,
        `./completion-platform.js?v=${v}`,
        `./workspace-completion.js?v=${v}`
      ].forEach(src => {
        const s = document.createElement('script');
        s.async = false;
        s.src = src;
        document.body.appendChild(s);
      });
    }
