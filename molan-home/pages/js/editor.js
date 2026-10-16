/*
 * editor.js — 自 HTML 内联脚本外移（2026-10-15 CSP 收紧）
 * 原因：CSP script-src 移除 'unsafe-inline' 需外移全部内联脚本；
 * 代码为逐字迁移（行为不变），加载位置与原内联位置一致。
 */
      (function () {
        var target = new URL('../index.html', window.location.href);
        var params = new URLSearchParams(window.location.search);
        target.search = window.location.search;
        target.hash = params.get('panel') === 'resources'
          ? 'resources'
          : params.get('panel') === 'sheji'
            ? 'knowledge'
            : params.get('tab') === 'outline'
              ? 'outline'
              : 'editor';
        if (target.href !== window.location.href) window.location.replace(target.href);
      }());
