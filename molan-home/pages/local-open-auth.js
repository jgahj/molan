(function () {
  'use strict';

  var pendingPromise = null;

  function persistSession(data) {
    if (!data || !data.localOpenAccess || !data.token || !data.user) return null;
    try {
      localStorage.setItem('ml_token', data.token);
      sessionStorage.setItem('ml_token', data.token);
      var userStr = JSON.stringify(data.user);
      localStorage.setItem('ml_user', userStr);
      sessionStorage.setItem('ml_user', userStr);
      var admToken = data.adminToken || data.token;
      localStorage.setItem('ml_admin_token', admToken);
      localStorage.setItem('ml_admin_user', userStr);
      localStorage.setItem('molan_admin_token', admToken);
      localStorage.setItem('molan_admin_user', userStr);
    } catch (_) {}
    try {
      window.dispatchEvent(new CustomEvent('molan:auth-changed', { detail: data.user }));
    } catch (_) {}
    return data;
  }

  function ensureLocalSession(apiBase) {
    if (pendingPromise) return pendingPromise;
    var base = String(apiBase || '');
    pendingPromise = fetch(base + '/api/auth/local-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store'
    }).then(function (response) {
      if (!response.ok) return null;
      return response.json().catch(function () { return null; });
    }).then(function (data) {
      return persistSession(data);
    }).catch(function () {
      return null;
    }).finally(function () {
      pendingPromise = null;
    });
    return pendingPromise;
  }

  window.MolanLocalOpenAuth = {
    ensureLocalSession: ensureLocalSession,
    persistSession: persistSession
  };
}());
