'use strict';

function createAuthRoutes(handlers) {
  return async function dispatchAuthRoute(req, res, url) {
    const method = req.method;
    if (method === 'POST' && url === '/api/auth/register') { await handlers.register(req, res); return true; }
    if (method === 'POST' && url === '/api/auth/login') { await handlers.login(req, res); return true; }
    if (method === 'POST' && url === '/api/auth/code') { await handlers.sendCode(req, res); return true; }
    if (method === 'POST' && url === '/api/auth/login-code') { await handlers.loginByCode(req, res); return true; }
    if (method === 'GET' && url === '/api/auth/me') { await handlers.me(req, res); return true; }
    if (method === 'PATCH' && url === '/api/auth/profile') { await handlers.profile(req, res); return true; }
    if (method === 'POST' && url === '/api/auth/logout') { await handlers.logout(req, res); return true; }
    if (method === 'POST' && url === '/api/auth/logout-all') { await handlers.logoutAll(req, res); return true; }
    if (method === 'POST' && url === '/api/admin/auth/login') { await handlers.adminLogin(req, res); return true; }
    if (method === 'GET' && url === '/api/admin/auth/me') { await handlers.adminMe(req, res); return true; }
    if (method === 'POST' && url === '/api/admin/auth/logout') { await handlers.logout(req, res, 'admin'); return true; }
    if (method === 'GET' && url === '/api/usage') { await handlers.usage(req, res); return true; }
    return false;
  };
}

module.exports = { createAuthRoutes };
