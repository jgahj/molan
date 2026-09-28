(function () {
  'use strict';

  function install() {
    const modules = [
      window.MolanCompletionLibrary,
      window.MolanCompletionEditor,
      window.MolanCompletionImport,
      window.MolanCompletionPlatform,
      window.MolanCompletionAdmin
    ];
    modules.forEach((module) => {
      if (module && typeof module.install === 'function') module.install();
    });
    if (typeof renderPage === 'function' && typeof currentPage === 'string') {
      renderPage(currentPage, { fromHistory: true });
    }
    window.dispatchEvent(new Event('molan:completion-ready'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
}());
