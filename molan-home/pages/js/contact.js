/*
 * contact.js — 自 HTML 内联脚本外移（2026-10-15 CSP 收紧）
 * 原因：CSP script-src 移除 'unsafe-inline' 需外移全部内联脚本；
 * 代码为逐字迁移（行为不变），加载位置与原内联位置一致。
 */
        /**
         * 初始化 Lucide 图标
         * 在 DOM 加载完成后调用，将页面中所有 data-lucide 属性替换为对应 SVG 图标
         */
        document.addEventListener('DOMContentLoaded', function() {
            lucide.createIcons();
        });
