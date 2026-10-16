/*
 * docs.js — 自 HTML 内联脚本外移（2026-10-15 CSP 收紧）
 * 原因：CSP script-src 移除 'unsafe-inline' 需外移全部内联脚本；
 * 代码为逐字迁移（行为不变），加载位置与原内联位置一致。
 */
        /**
         * 初始化 Lucide 图标
         */
        lucide.createIcons();

        /**
         * 移动端菜单切换
         */
        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        const mobileMenu = document.getElementById('mobile-menu');
        if (mobileMenuToggle && mobileMenu) {
            mobileMenuToggle.addEventListener('click', function () {
                mobileMenu.classList.toggle('hidden');
            });
        }

        /**
         * 教程分类筛选功能
         * 点击标签按钮时高亮当前按钮并显示对应分类的卡片
         */
        const filterTabs = document.querySelectorAll('.filter-tab');
        const tutorialCards = document.querySelectorAll('.tutorial-card');

        /**
         * 更新筛选标签按钮的激活样式
         * @param {HTMLElement} activeTab - 当前激活的标签按钮
         */
        function updateTabStyles(activeTab) {
            filterTabs.forEach(function (tab) {
                if (tab === activeTab) {
                    tab.classList.add('bg-[#0a0a0a]', 'text-white', 'border-[#0a0a0a]');
                    tab.classList.remove('bg-white', 'text-[#666666]', 'border-[#e5e5e5]', 'hover:border-[#0a0a0a]', 'hover:text-[#0a0a0a]');
                } else {
                    tab.classList.remove('bg-[#0a0a0a]', 'text-white', 'border-[#0a0a0a]');
                    tab.classList.add('bg-white', 'text-[#666666]', 'border-[#e5e5e5]', 'hover:border-[#0a0a0a]', 'hover:text-[#0a0a0a]');
                }
            });
        }

        /**
         * 根据分类过滤教程卡片
         * @param {string} category - 要显示的分类标识，all 表示全部
         */
        function filterCards(category) {
            tutorialCards.forEach(function (card) {
                if (category === 'all' || card.dataset.category === category) {
                    card.style.display = 'flex';
                } else {
                    card.style.display = 'none';
                }
            });
        }

        // 初始化默认激活「全部」标签样式
        const defaultTab = document.querySelector('.filter-tab[data-filter="all"]');
        if (defaultTab) {
            updateTabStyles(defaultTab);
        }

        // 为每个筛选标签绑定点击事件
        filterTabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                const filter = tab.dataset.filter;
                updateTabStyles(tab);
                filterCards(filter);
            });
        });
