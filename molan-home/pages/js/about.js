/*
 * about.js — 自 HTML 内联脚本外移（2026-10-15 CSP 收紧）
 * 原因：CSP script-src 移除 'unsafe-inline' 需外移全部内联脚本；
 * 代码为逐字迁移（行为不变），加载位置与原内联位置一致。
 */
        lucide.createIcons();
        /**
         * 切换移动端导航菜单的显示与隐藏
         */
        (function () {
            const toggle = document.getElementById('mobile-menu-toggle');
            const menu = document.getElementById('mobile-menu');
            if (!toggle || !menu) return;

            toggle.addEventListener('click', function () {
                menu.classList.toggle('hidden');
            });
        })();
