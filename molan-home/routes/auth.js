'use strict';

function createAuthRoutes(handlers) {
  return function dispatchAuthRoute(req, res, url) {
    const method = req.method;
    if (method === 'POST' && url === '/api/auth/register') { handlers.register(req, res); return true; }
    if (method === 'POST' && url === '/api/auth/login') { handlers.login(req, res); return true; }
    if (method === 'POST' && url === '/api/auth/code') { handlers.sendCode(req, res); return true; }
    if (method === 'POST' && url === '/api/auth/login-code') { handlers.loginByCode(req, res); return true; }
    if (method === 'GET' && url === '/api/auth/me') { handlers.me(req, res); return true; }
    if (method === 'PATCH' && url === '/api/auth/profile') { handlers.profile(req, res); return true; }
    if (method === 'POST' && url === '/api/auth/logout') { handlers.logout(req, res); return true; }
    if (method === 'POST' && url === '/api/auth/logout-all') { handlers.logoutAll(req, res); return true; }
    if (method === 'POST' && url === '/api/admin/auth/login') { handlers.adminLogin(req, res); return true; }
    if (method === 'GET' && url === '/api/admin/auth/me') { handlers.adminMe(req, res); return true; }
    if (method === 'POST' && url === '/api/admin/auth/logout') { handlers.logout(req, res, 'admin'); return true; }
    if (method === 'GET' && url === '/api/usage') { handlers.usage(req, res); return true; }
    return false;
  };
}

module.exports = { createAuthRoutes };
