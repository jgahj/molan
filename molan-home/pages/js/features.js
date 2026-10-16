/*
 * features.js — 自 HTML 内联脚本外移（2026-10-15 CSP 收紧）
 * 原因：CSP script-src 移除 'unsafe-inline' 需外移全部内联脚本；
 * 代码为逐字迁移（行为不变），加载位置与原内联位置一致。
 */
        /**
         * 初始化页面所需的交互行为
         */
        (function () {
            // 初始化 Lucide 图标
            lucide.createIcons();

            // 移动端菜单切换
            const toggle = document.getElementById('mobile-menu-toggle');
            const mobileMenu = document.getElementById('mobile-menu');
            if (toggle && mobileMenu) {
                toggle.addEventListener('click', function () {
                    mobileMenu.classList.toggle('hidden');
                });
            }
        })();
