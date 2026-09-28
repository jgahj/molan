(function () {
  'use strict';

  var TOKEN_KEY = 'ml_token';
  var USER_KEY = 'ml_user';
  var state = { token: null, user: null, draftAvatar: '', modal: null, refreshSeq: 0 };

  function readState() {
    try {
      state.token = localStorage.getItem(TOKEN_KEY);
      state.user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch (_) {
      state.token = null;
      state.user = null;
    }
    if (!state.user || !state.user.email) state.user = null;
  }

  function saveState() {
    try {
      if (state.token) localStorage.setItem(TOKEN_KEY, state.token);
      if (state.user) localStorage.setItem(USER_KEY, JSON.stringify(state.user));
      else localStorage.removeItem(USER_KEY);
    } catch (_) {}
  }

  function loginUrl() {
    return location.pathname.indexOf('/pages/') >= 0 ? './login.html' : './pages/login.html';
  }

  function accountElements() {
    var list = Array.prototype.slice.call(document.querySelectorAll('[data-molan-account], #navLogin, a[data-dom-id="nav-login"], #mobileNavMenu a[href*="login.html"]'));
    Array.prototype.slice.call(document.querySelectorAll('footer a')).forEach(function (el) {
      if ((el.textContent || '').replace(/\s+/g, '') === '登录') {
        el.setAttribute('data-molan-account', '');
        list.push(el);
      }
    });
    var seen = [];
    return list.filter(function (el) {
      if (seen.indexOf(el) >= 0) return false;
      seen.push(el);
      return true;
    });
  }

  function setAvatarNode(parent, user, preview) {
    parent.replaceChildren();
    var frame = document.createElement('span');
    frame.className = preview ? 'molan-account-avatar' : 'molan-avatar';
    frame.setAttribute('aria-hidden', 'true');
    if (user && user.avatar) {
      var image = document.createElement('img');
      image.alt = '';
      image.src = user.avatar;
      frame.appendChild(image);
    }
    parent.appendChild(frame);
  }

  function renderAccounts() {
    accountElements().forEach(function (el) {
      if (!el._molanAccountBound) {
        el._molanAccountBound = true;
        el.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (state.user) openModal();
          else location.href = loginUrl();
        }, true);
      }
      if (!el._molanOriginalHref && el.getAttribute('href')) el._molanOriginalHref = el.getAttribute('href');
      el.classList.toggle('molan-account-control', !!state.user);
      el.classList.toggle('molan-account-login', !state.user);
      el.setAttribute('aria-label', state.user ? '已登录，打开账户设置' : '登录');
      el.title = state.user ? (state.user.email + ' · 已登录') : '登录';
      if (state.user) {
        el.removeAttribute('href');
        el.setAttribute('role', 'button');
        setAvatarNode(el, state.user, false);
      } else {
        if (el._molanOriginalHref) el.setAttribute('href', el._molanOriginalHref);
        else if (el.tagName === 'A') el.setAttribute('href', loginUrl());
        el.removeAttribute('role');
        el.textContent = '登录';
      }
    });
  }

  function modalStatus(message, error) {
    if (!state.modal) return;
    var status = state.modal.querySelector('[data-account-status]');
    status.textContent = message || '';
    status.classList.toggle('is-error', !!error);
  }

  function syncModalPreview() {
    if (!state.modal || !state.user) return;
    var preview = state.modal.querySelector('[data-account-preview]');
    setAvatarNode(preview, { avatar: state.draftAvatar }, true);
    state.modal.querySelector('[data-account-name]').value = state.user.name || '';
    state.modal.querySelector('[data-account-email]').textContent = state.user.email || '';
  }

  function ensureModal() {
    if (state.modal) return state.modal;
    var modal = document.createElement('div');
    modal.className = 'molan-account-modal';
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = '<section class="molan-account-modal__card" role="dialog" aria-modal="true" aria-labelledby="molanAccountTitle">' +
      '<header class="molan-account-modal__head"><span id="molanAccountTitle">账户设置</span><button type="button" class="molan-account-modal__close" data-account-close aria-label="关闭">×</button></header>' +
      '<div class="molan-account-modal__body">' +
      '<div class="molan-account-modal__profile"><div class="molan-account-avatar" data-account-preview></div><div class="molan-account-modal__identity"><strong data-account-name-label></strong><span data-account-email></span></div></div>' +
      '<label class="molan-account-modal__field">昵称<input type="text" maxlength="24" autocomplete="nickname" data-account-name></label>' +
      '<div class="molan-account-modal__field"><span>头像</span><div class="molan-account-modal__actions"><label class="molan-account-modal__upload">上传头像<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-account-file></label><button type="button" class="molan-account-modal__clear" data-account-clear>清除头像</button></div><span class="molan-account-modal__hint">支持 PNG、JPG、WebP、GIF，系统会自动压缩。</span></div>' +
      '<p class="molan-account-modal__status" data-account-status aria-live="polite"></p>' +
      '<div class="molan-account-modal__actions"><span></span><button type="button" class="molan-account-modal__save" data-account-save>保存更改</button></div>' +
      '</div><footer class="molan-account-modal__foot"><button type="button" class="molan-account-modal__logout" data-account-logout>退出登录</button></footer></section>';
    document.body.appendChild(modal);
    state.modal = modal;
    modal.querySelector('[data-account-close]').addEventListener('click', closeModal);
    modal.addEventListener('click', function (event) { if (event.target === modal) closeModal(); });
    modal.querySelector('[data-account-file]').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      compressAvatar(file).then(function (avatar) {
        state.draftAvatar = avatar;
        syncModalPreview();
        modalStatus('头像已准备好，点击保存后生效。', false);
      }).catch(function (error) {
        event.target.value = '';
        modalStatus(error.message || '头像处理失败，请更换图片。', true);
      });
    });
    modal.querySelector('[data-account-clear]').addEventListener('click', function () {
      state.draftAvatar = '';
      syncModalPreview();
      modalStatus('头像已清除，点击保存后生效。', false);
    });
    modal.querySelector('[data-account-save]').addEventListener('click', saveProfile);
    modal.querySelector('[data-account-logout]').addEventListener('click', logout);
    return modal;
  }

  function openModal() {
    if (!state.user) return;
    var modal = ensureModal();
    state.draftAvatar = state.user.avatar || '';
    modal.querySelector('[data-account-name-label]').textContent = state.user.name || state.user.email || '';
    syncModalPreview();
    modalStatus('', false);
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    var name = modal.querySelector('[data-account-name]');
    name.focus();
  }

  function closeModal() {
    if (!state.modal) return;
    state.modal.hidden = true;
    state.modal.setAttribute('aria-hidden', 'true');
  }

  function parseResponse(response) {
    return response.json().catch(function () { return {}; }).then(function (data) {
      if (!response.ok) {
        var error = new Error(data.error || '请求失败');
        error.status = response.status;
        throw error;
      }
      return data;
    });
  }

  function refresh() {
    readState();
    renderAccounts();
    if (!state.token) return Promise.resolve(null);
    var requestToken = state.token;
    var requestSeq = ++state.refreshSeq;
    return fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + requestToken }, cache: 'no-store' })
      .then(parseResponse)
      .then(function (data) {
        if (requestSeq !== state.refreshSeq || requestToken !== state.token) return null;
        state.user = data.user || null;
        saveState();
        renderAccounts();
        return state.user;
      })
      .catch(function (error) {
        if (requestSeq !== state.refreshSeq || requestToken !== state.token) return null;
        if (error && (error.status === 401 || /未登录|登录/.test(error.message || ''))) {
          state.token = null;
          state.user = null;
          saveState();
          renderAccounts();
        }
        return null;
      });
  }

  function saveProfile() {
    if (!state.token || !state.user || !state.modal) return;
    var button = state.modal.querySelector('[data-account-save]');
    var name = state.modal.querySelector('[data-account-name]').value.trim();
    if (name.length > 24) { modalStatus('昵称不能超过 24 个字符。', true); return; }
    button.disabled = true;
    modalStatus('正在保存…', false);
    fetch('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
      body: JSON.stringify({ name: name, avatar: state.draftAvatar })
    }).then(parseResponse).then(function (data) {
      state.user = data.user || state.user;
      saveState();
      renderAccounts();
      closeModal();
      window.dispatchEvent(new CustomEvent('molan:auth-changed', { detail: state.user }));
    }).catch(function (error) {
      modalStatus(error.message || '保存失败，请稍后重试。', true);
    }).finally(function () { button.disabled = false; });
  }

  function logout() {
    var token = state.token;
    if (token) fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: '{}' }).catch(function () {});
    state.token = null;
    state.user = null;
    saveState();
    closeModal();
    renderAccounts();
    window.dispatchEvent(new CustomEvent('molan:auth-changed', { detail: null }));
  }

  function compressAvatar(file) {
    if (!/^image\/(?:png|jpe?g|webp|gif)$/i.test(file.type)) return Promise.reject(new Error('请选择 PNG、JPG、WebP 或 GIF 图片。'));
    if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error('图片不能超过 5 MB。'));
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      var image = new Image();
      image.onload = function () {
        try {
          var size = 256;
          var canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          var ctx = canvas.getContext('2d');
          var scale = Math.max(size / image.width, size / image.height);
          var width = image.width * scale, height = image.height * scale;
          ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
          var avatar = canvas.toDataURL('image/jpeg', .82);
          if (avatar.length > 280000) avatar = canvas.toDataURL('image/jpeg', .66);
          if (avatar.length > 300000) throw new Error('图片压缩后仍然过大，请选择更简单的图片。');
          resolve(avatar);
        } catch (error) { reject(error); }
      };
      image.onerror = function () { reject(new Error('图片读取失败，请更换图片。')); };
      reader.onerror = function () { reject(new Error('图片读取失败，请更换图片。')); };
      reader.onload = function () { image.src = reader.result; };
      reader.readAsDataURL(file);
    });
  }

  function init() {
    refresh();
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeModal(); });
    window.addEventListener('storage', function (event) { if (event.key === TOKEN_KEY || event.key === USER_KEY) { refresh(); } });
  }

  window.MolanAccount = { refresh: refresh, open: openModal, logout: logout };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
