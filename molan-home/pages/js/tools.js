/*
 * tools.js — 自 HTML 内联脚本外移（2026-10-15 CSP 收紧）
 * 原因：CSP script-src 移除 'unsafe-inline' 需外移全部内联脚本；
 * 代码为逐字迁移（行为不变），加载位置与原内联位置一致。
 */
        /**
         * 渲染所有 Lucide 图标
         */
        lucide.createIcons();

        /**
         * 移动端汉堡菜单切换逻辑
         */
        (function () {
            const toggle = document.getElementById('mobile-menu-toggle');
            const menu = document.getElementById('mobile-menu');
            if (!toggle || !menu) return;

            toggle.addEventListener('click', function () {
                menu.classList.toggle('hidden');
            });
        })();

        /**
         * 工具即时搜索与分类筛选交互
         */
        (function () {
            const searchInput = document.getElementById('toolSearchInput');
            const searchClear = document.getElementById('toolSearchClear');
            const catButtons = document.querySelectorAll('.tool-cat-btn');
            const emptyState = document.getElementById('toolsEmptyState');
            const resetBtn = document.getElementById('toolsResetFilterBtn');
            const coreSection = document.getElementById('tools-grid');
            const genSection = document.getElementById('generatorSection');
            const ideaSection = document.getElementById('idea-chain');
            const allCards = document.querySelectorAll('#tools-grid .tool-card, #generatorSection .tool-card, #idea-chain .idea-card');

            let currentCategory = 'all';
            let currentSearch = '';

            function applyFilter() {
                let visibleCount = 0;
                let visibleCore = 0;
                let visibleGen = 0;
                let visibleIdea = 0;

                allCards.forEach(function (card) {
                    const cardCat = card.getAttribute('data-category') || '';
                    const searchSource = (card.getAttribute('data-search-text') || card.textContent || '').toLowerCase();
                    
                    let catMatch = false;
                    if (currentCategory === 'all') {
                        catMatch = true;
                    } else if (currentCategory === cardCat) {
                        catMatch = true;
                    }

                    let searchMatch = true;
                    if (currentSearch) {
                        searchMatch = searchSource.includes(currentSearch);
                    }

                    const isMatch = catMatch && searchMatch;
                    card.style.display = isMatch ? '' : 'none';

                    if (isMatch) {
                        visibleCount++;
                        if (card.closest('#tools-grid')) visibleCore++;
                        else if (card.closest('#generatorSection')) visibleGen++;
                        else if (card.closest('#idea-chain')) visibleIdea++;
                    }
                });

                if (coreSection) coreSection.style.display = visibleCore > 0 ? '' : 'none';
                if (genSection) genSection.style.display = visibleGen > 0 ? '' : 'none';
                if (ideaSection) ideaSection.style.display = visibleIdea > 0 ? '' : 'none';

                if (emptyState) {
                    if (visibleCount === 0) emptyState.classList.remove('hidden');
                    else emptyState.classList.add('hidden');
                }

                if (window.lucide && typeof window.lucide.createIcons === 'function') {
                    window.lucide.createIcons();
                }
            }

            if (searchInput) {
                searchInput.addEventListener('input', function () {
                    currentSearch = this.value.trim().toLowerCase();
                    if (searchClear) {
                        if (currentSearch) searchClear.classList.remove('hidden');
                        else searchClear.classList.add('hidden');
                    }
                    applyFilter();
                });
            }

            if (searchClear) {
                searchClear.addEventListener('click', function () {
                    if (searchInput) {
                        searchInput.value = '';
                        currentSearch = '';
                        searchClear.classList.add('hidden');
                        applyFilter();
                        searchInput.focus();
                    }
                });
            }

            if (catButtons && catButtons.length) {
                catButtons.forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        catButtons.forEach(function (b) {
                            b.classList.remove('is-active');
                        });
                        this.classList.add('is-active');
                        currentCategory = this.getAttribute('data-category') || 'all';
                        applyFilter();
                    });
                });
            }

            if (resetBtn) {
                resetBtn.addEventListener('click', function () {
                    currentCategory = 'all';
                    currentSearch = '';
                    if (searchInput) searchInput.value = '';
                    if (searchClear) searchClear.classList.add('hidden');
                    catButtons.forEach(function (b) {
                        if (b.getAttribute('data-category') === 'all') {
                            b.classList.add('is-active');
                        } else {
                            b.classList.remove('is-active');
                        }
                    });
                    applyFilter();
                });
            }
        })();
