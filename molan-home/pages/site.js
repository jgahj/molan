/**
 * 墨阑 · 全站共享脚本
 * 职责：
 *  1) 路由修补 —— 把设计稿中的 href="#" 死链替换为真实页面路由
 *  2) 账号体系 —— 注册 / 密码登录 / 登录态渲染 / 退出
 *  3) 工具工作台 —— 免费工具页 17 个工具的真实 AI 调用（流式）
 *  4) 内容详情 —— 博客文章 / 使用教程的阅读弹窗
 *  5) 博客筛选、主题切换、其他页面交互补齐
 */
(function () {
  'use strict';

  /* ===================== 0. 基础工具 ===================== */
  var API = location.origin.indexOf('http') === 0 ? '' : 'http://localhost:3000';
  var PAGE = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* 轻量 toast */
  function toast(msg) {
    var t = $('#ml-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ml-toast';
      t.style.cssText = 'position:fixed;left:50%;bottom:48px;transform:translateX(-50%);background:#0a0a0a;color:#fff;padding:10px 20px;border-radius:999px;font-size:13px;z-index:9999;opacity:0;transition:opacity .25s;pointer-events:none;max-width:80vw;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.style.opacity = '0'; }, 2200);
  }

  /* ===================== 1. 路由映射与死链修补 ===================== */
  var ROUTES = {
    index: './index.html', features: './features.html', pricing: './pricing.html',
    docs: './docs.html', blog: './blog.html', tools: './tools.html',
    login: './login.html', about: './about.html', contact: './contact.html', editor: '../index.html#editor', skills: './skills.html'
  };
  /* 首页在上一级目录 */
  ROUTES.index = '../index.html';

  /* data-dom-id → 路由 */
  var DOM_ID_ROUTES = {
    'nav-index': ROUTES.index,
    'nav-features': ROUTES.features, 'nav-pricing': ROUTES.pricing, 'nav-docs': ROUTES.docs,
    'nav-blog': ROUTES.blog, 'nav-tools': ROUTES.tools, 'nav-skills': ROUTES.skills, 'nav-login': ROUTES.login,
    'entry-pricing': ROUTES.pricing, 'entry-docs': ROUTES.docs, 'entry-blog': ROUTES.blog, 'entry-kb': ROUTES.docs
  };
  var NAV_ROUTES = {
    home: ROUTES.index, features: ROUTES.features, pricing: ROUTES.pricing,
    kb: ROUTES.docs, tools: ROUTES.tools, docs: ROUTES.docs, blog: ROUTES.blog, skills: ROUTES.skills
  };

  /* 链接文本 → 路由（用于页脚等无标识的死链） */
  var TEXT_ROUTES = {
    '功能总览': ROUTES.features, '价格与订阅': ROUTES.pricing, '订阅方案': ROUTES.pricing,
    '使用文档': ROUTES.docs, '创作者手札': ROUTES.blog, '免费工具': ROUTES.tools,
    '登录': ROUTES.login, '开始使用': ROUTES.login, '免费注册': ROUTES.login,
    '联系我们': ROUTES.contact, '关于我们': ROUTES.about, '文档': ROUTES.docs,
    '查看全部工具': ROUTES.tools, 'llms.txt': '../llms.txt',
    '去 AI 味改写': ROUTES.tools + '?tool=deai', '错别字检测': ROUTES.tools + '?tool=typo',
    'AI 味浓度检测': ROUTES.tools + '?tool=aiflavor', '小说命名生成器': ROUTES.tools + '?tool=namer',
    '排版清洗': ROUTES.tools + '?tool=format', '重复内容检测': ROUTES.tools + '?tool=duplicate',
    'AI 小说生成器': ROUTES.tools + '?tool=novel',
    '与 Sudowrite 对比': ROUTES.blog + '?filter=industry', '与 NovelCrafter 对比': ROUTES.blog + '?filter=industry',
    '与 ChatGPT 对比': ROUTES.blog + '?filter=industry', '与 DeepSeek 对比': ROUTES.blog + '?filter=industry',
    '与笔灵 AI 写作对比': ROUTES.blog + '?filter=industry', '与蛙蛙写作对比': ROUTES.blog + '?filter=industry',
    '2026 中文网文 AI 横评': ROUTES.blog + '?filter=industry', '查看全部对比': ROUTES.blog + '?filter=industry',
    '作者交流 QQ 1062403092': 'https://wpa.qq.com/msgrd?v=3&uin=1062403092&site=qq&menu=yes',
    '微信交流群': ROUTES.contact, 'GitHub 源码': 'https://github.com/Deng-m1/MaliangAINovalWriter',
    '姊妹产品 Foreverse': ROUTES.about, '加入交流群': ROUTES.contact
  };

  function patchLinks() {
    $all('a').forEach(function (a) {
      var domId = a.getAttribute('data-dom-id') || '';
      var href = a.getAttribute('href') || '';
      var navKey = a.getAttribute('data-nav') || '';
      if (NAV_ROUTES[navKey]) { a.setAttribute('href', NAV_ROUTES[navKey]); return; }
      /* 1) 按 data-dom-id 修补 */
      if (DOM_ID_ROUTES[domId]) { a.setAttribute('href', DOM_ID_ROUTES[domId]); return; }
      /* 2) 工具卡片 → JS 工作台（保留 href 便于中键打开） */
      if (/^tool-(\w+)-try$/.test(domId)) {
        var key = domId.replace(/^tool-/, '').replace(/-try$/, '');
        a.setAttribute('href', ROUTES.tools + '?tool=' + key);
        a.setAttribute('data-tool', key);
        return;
      }
      if (domId === 'hub-novel-generator') { a.setAttribute('href', ROUTES.tools + '?tool=novel'); a.setAttribute('data-tool', 'novel'); return; }
      if (/^idea-(\w+)$/.test(domId)) {
        var ikey = 'idea_' + domId.replace(/^idea-/, '');
        a.setAttribute('href', ROUTES.tools + '?tool=' + ikey);
        a.setAttribute('data-tool', ikey);
        return;
      }
      /* 3) 死链按文本修补 */
      if (href === '#') {
        var text = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (TEXT_ROUTES[text]) {
          a.setAttribute('href', TEXT_ROUTES[text]);
          if (/^https?:/.test(TEXT_ROUTES[text])) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
        }
      }
    });
    /* 当前页导航高亮 */
    var current = { 'features.html': 'nav-features', 'pricing.html': 'nav-pricing', 'docs.html': 'nav-docs', 'blog.html': 'nav-blog', 'tools.html': 'nav-tools', 'skills.html': 'nav-skills', 'login.html': 'nav-login' }[PAGE];
    if (current) {
      $all('a[data-dom-id="' + current + '"]').forEach(function (a) {
        a.classList.remove('text-[#666666]');
        a.classList.add('text-[#0a0a0a]', 'font-medium');
      });
    }
  }

  /* ===================== 2. 主题切换（明 / 暗） ===================== */
  function applyTheme(dark) {
    var st = $('#ml-dark-style');
    if (dark) {
      if (!st) {
        st = document.createElement('style');
        st.id = 'ml-dark-style';
        st.textContent = 'html{filter:invert(1) hue-rotate(180deg);background:#0a0a0a;}img,video,iframe,svg.no-invert{filter:invert(1) hue-rotate(180deg);}';
        document.head.appendChild(st);
      }
    } else if (st) { st.remove(); }
    try { localStorage.setItem('ml_theme', dark ? 'dark' : 'light'); } catch (e) {}
  }
  function initTheme() {
    var dark = false;
    try { dark = localStorage.getItem('ml_theme') === 'dark'; } catch (e) {}
    if (dark) applyTheme(true);
    /* 导航栏中带 moon / sun 图标的按钮视为主题切换 */
    $all('button[aria-label="切换主题"], button[aria-label="主题切换"]').forEach(bind);
    $all('nav button, header button').forEach(function (btn) {
      if (btn._mlTheme) return;
      var icon = btn.querySelector('[data-lucide="moon"],[data-lucide="sun"],svg.lucide-moon,svg.lucide-sun');
      if (icon) bind(btn);
    });
    function bind(btn) {
      if (btn._mlTheme) return;
      btn._mlTheme = true;
      btn.addEventListener('click', function () {
        var isDark = !!$('#ml-dark-style');
        applyTheme(!isDark);
        toast(!isDark ? '已切换到暗色主题' : '已切换到亮色主题');
      });
    }
  }

  /* ===================== 3. 账号体系 ===================== */
  var auth = {
    token: null, user: null,
    load: function () {
      try {
        this.token = localStorage.getItem('ml_token');
        var u = localStorage.getItem('ml_user');
        this.user = u ? JSON.parse(u) : null;
      } catch (e) {}
    },
    save: function (token, user) {
      this.token = token; this.user = user;
      try { localStorage.setItem('ml_token', token); localStorage.setItem('ml_user', JSON.stringify(user)); } catch (e) {}
    },
    clear: function () {
      this.token = null; this.user = null;
      try { localStorage.removeItem('ml_token'); localStorage.removeItem('ml_user'); } catch (e) {}
    }
  };

  function accountStorageSuffix() {
    try {
      var u = JSON.parse(localStorage.getItem('ml_user') || 'null');
      var identity = u && (u.userId || u.email);
      return identity ? encodeURIComponent(String(identity).trim().toLowerCase()) : 'guest';
    } catch (e) { return 'guest'; }
  }

  function storedAccountModel() {
    try { return localStorage.getItem('molan_model:' + accountStorageSuffix()) || ''; } catch (e) { return ''; }
  }

  /* 免费工具也走平台统一模型；服务端仍会按账户角色做最终校验。 */
  function resolveToolModel() {
    return api('/api/models', null, 'GET').then(function (data) {
      var access = data && data.access || {};
      var models = data && Array.isArray(data.models) ? data.models : [];
      var requested = storedAccountModel();
      var selectable = access.canChooseModel === true && models.some(function (item) { return item.id === requested; });
      if (selectable) return requested;
      return access.defaultModel || (models[0] && models[0].id) || '';
    }).catch(function () { return ''; });
  }

  function api(path, body, method) {
    return fetch(API + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth.token ? { 'Authorization': 'Bearer ' + auth.token } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || '请求失败'); return d; }); });
  }

  /* 积分以服务端账户为准，前端只展示最近一次同步结果。 */
  function refreshAuthUser() {
    if (!auth.token) return Promise.resolve(null);
    return api('/api/auth/me', null, 'GET').then(function (d) {
      auth.user = d.user;
      try { localStorage.setItem('ml_user', JSON.stringify(d.user)); } catch (e) {}
      return d.user;
    }).catch(function () { return null; });
  }

  /* 登录态渲染：导航栏「登录」按钮 → 用户菜单 */
  function renderAuthNav() {
    if (!auth.user) return;
    $all('a[data-dom-id="nav-login"]').forEach(function (a) {
      var name = auth.user.name || auth.user.email;
      a.textContent = name.length > 10 ? name.slice(0, 10) + '…' : name;
      a.setAttribute('href', 'javascript:void(0)');
      a.title = auth.user.email + ' · 积分 ' + (auth.user.credits == null ? '—' : auth.user.credits) + '（点击退出登录）';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        if (confirm('确定退出登录（' + auth.user.email + '）吗？')) {
          api('/api/auth/logout', {}).catch(function () {});
          auth.clear();
          location.reload();
        }
      });
    });
  }

  /* 登录页逻辑 */
  function initLoginPage() {
    if (PAGE !== 'login.html') return;
    var form = $('form');
    var emailInput = $('#email');
    var pwdInput = $('#password');
    if (!form || !emailInput || !pwdInput) return;

    var mode = 'login'; // login | register | code
    var formTitle = $('#login-title');
    var formDescription = $('#login-description');

    /* 已登录则提示并自动返回 */
    if (auth.user && auth.token) {
      var redirectParam = new URLSearchParams(location.search).get('redirect');
      if (redirectParam) {
        toast('当前已登录：' + auth.user.email + '，正在返回…');
        setTimeout(function () { location.href = redirectParam; }, 500);
        return;
      }
      toast('当前已登录：' + auth.user.email);
    }

    /* 密码可见性切换 */
    var eyeBtn = $('button[aria-label="切换密码可见性"]');
    if (eyeBtn) eyeBtn.addEventListener('click', function () {
      pwdInput.type = pwdInput.type === 'password' ? 'text' : 'password';
    });

    /* 找到各按钮（按文本匹配，避免改动设计稿结构） */
    var buttons = $all('button');
    var submitBtn = form.querySelector('button[type="submit"]');
    var codeBtn = null, forgotBtn = document.querySelector('.login-forgot'), registerLink = null;
    buttons.forEach(function (b) {
      var t = (b.textContent || '').replace(/\s+/g, '');
      if (/验证码/.test(t) && b.type !== 'submit') codeBtn = b;
      if (/忘记密码/.test(t)) forgotBtn = forgotBtn || b;
    });
    $all('a,button').forEach(function (el) {
      var t = (el.textContent || '').replace(/\s+/g, '');
      if (/^注册|立即注册|免费注册|创建(?:新)?账号/.test(t)) registerLink = el;
    });

    /* 状态提示条 */
    var tip = form.querySelector('.login-tip');
    if (!tip) {
      tip = document.createElement('p');
      tip.className = 'login-tip';
      form.insertBefore(tip, form.firstChild);
    }
    tip.style.cssText = 'font-size:13px;margin:4px 0 0;min-height:18px;color:#dc2626;';
    function setTip(msg, ok) { tip.textContent = msg || ''; tip.style.color = ok ? '#16a34a' : '#dc2626'; }

    /* 验证码入口保留为禁用状态，避免没有邮件服务时误导用户。 */
    var codeWrap = document.createElement('div');
    codeWrap.style.display = 'none';
    codeWrap.innerHTML = '<div style="display:flex;gap:8px;">' +
      '<input type="text" id="ml-code" placeholder="6 位验证码" maxlength="6" class="w-full px-4 py-3 bg-white border border-[#e5e5e5] rounded-xl text-sm text-[#0a0a0a] placeholder:text-[#b3b3b3] focus:outline-none focus:border-[#0a0a0a] transition-colors" style="flex:1;">' +
      '<button type="button" id="ml-send-code" class="px-4 py-3 border border-[#e5e5e5] rounded-xl text-sm text-[#0a0a0a] hover:bg-[#fafafa] transition-colors" style="white-space:nowrap;">获取验证码</button></div>' +
      '<p id="ml-code-tip" style="font-size:12px;color:#16a34a;margin-top:6px;min-height:16px;"></p>';
    pwdInput.closest('div').parentNode.insertBefore(codeWrap, pwdInput.closest('div').nextSibling);

    function setMode(m) {
      mode = m;
      var pwdBox = pwdInput.closest('div');
      if (m === 'code') { pwdBox.style.display = 'none'; codeWrap.style.display = 'block'; }
      else { pwdBox.style.display = ''; codeWrap.style.display = 'none'; }
      if (submitBtn) submitBtn.textContent = m === 'register' ? '注 册' : m === 'code' ? '验证码登录' : '登 录';
      if (formTitle) formTitle.textContent = m === 'register' ? '创建专属写作空间' : '开始你的 AI 写作工作台';
      if (formDescription) formDescription.textContent = m === 'register' ? '注册后即可保存作品，开始你的第一本书' : '从灵感、大纲到成稿，智能完成每一本书';
      setTip(m === 'register' ? '注册后自动登录，赠送 500 积分' : '', true);
    }

    if (codeBtn) {
      codeBtn.disabled = true;
      codeBtn.title = '邮箱验证码登录暂未开放，请使用密码登录';
      codeBtn.textContent = '验证码登录（暂未开放）';
    }
    if (registerLink) registerLink.addEventListener('click', function (e) {
      e.preventDefault();
      setMode(mode === 'register' ? 'login' : 'register');
    });
    if (forgotBtn) forgotBtn.addEventListener('click', function (e) {
      e.preventDefault();
      setTip('密码重置暂未开放，请使用已注册密码登录或联系管理员');
      emailInput.focus();
    });

    /* 表单提交 */
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = emailInput.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setTip('请输入正确的邮箱地址'); return; }
      var p;
      if (mode === 'code') {
        var code = ($('#ml-code') || {}).value || '';
        if (code.length !== 6) { setTip('请输入 6 位验证码'); return; }
        p = api('/api/auth/login-code', { email: email, code: code.trim() });
      } else if (mode === 'register') {
        if (pwdInput.value.length < 6) { setTip('密码至少 6 位'); return; }
        p = api('/api/auth/register', { email: email, password: pwdInput.value });
      } else {
        if (!pwdInput.value) { setTip('请输入密码'); return; }
        p = api('/api/auth/login', { email: email, password: pwdInput.value });
      }
      if (submitBtn) { submitBtn.disabled = true; submitBtn.style.opacity = '.6'; }
      p.then(function (d) {
        auth.save(d.token, d.user);
        setTip((mode === 'register' ? '注册成功' : '登录成功') + '，正在跳转…', true);
        setTimeout(function () {
          var redirect = new URLSearchParams(location.search).get('redirect');
          if (redirect) {
            location.href = redirect;
          } else {
            location.href = '../index.html';
          }
        }, 800);
      }).catch(function (err) {
        setTip(err.message);
        /* 登录失败只展示错误，不自动切换模式，避免误导用户注册。 */
      }).finally(function () {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.style.opacity = ''; }
      });
    });

    /* 第三方登录（本地环境未接入 OAuth，给出明确反馈并引导） */
    buttons.forEach(function (b) {
      var t = (b.textContent || '').replace(/\s+/g, '');
      if (/Google|GitHub/i.test(t)) {
        b.addEventListener('click', function () {
          toast('本地环境暂未接入第三方 OAuth，请使用邮箱登录 / 注册');
        });
      }
      if (/其他选项|显示其他/.test(t)) {
        b.addEventListener('click', function () { setMode('code'); });
      }
    });
  }

  /* ===================== 4. 通用弹窗框架 ===================== */
  function openModal(html, wide) {
    closeModal();
    var overlay = document.createElement('div');
    overlay.id = 'ml-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,10,10,.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = '<div style="background:#fff;border-radius:20px;max-width:' + (wide ? '860px' : '680px') + ';width:100%;max-height:86vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.25);">' +
      '<div style="display:flex;justify-content:flex-end;padding:14px 16px 0;"><button id="ml-modal-close" aria-label="关闭" style="border:none;background:#f5f5f5;border-radius:999px;width:32px;height:32px;cursor:pointer;font-size:16px;line-height:1;color:#666;">✕</button></div>' +
      '<div id="ml-modal-body" style="overflow-y:auto;padding:0 28px 28px;">' + html + '</div></div>';
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    $('#ml-modal-close').addEventListener('click', closeModal);
    return overlay;
  }
  function closeModal() {
    var m = $('#ml-modal');
    if (m) m.remove();
    document.body.style.overflow = '';
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  function mdToHtml(md) {
    return md.split(/\n\n+/).map(function (p) {
      p = p.trim();
      if (!p) return '';
      if (/^###\s/.test(p)) return '<h3 style="font-size:17px;font-weight:600;color:#0a0a0a;margin:20px 0 8px;">' + esc(p.replace(/^###\s*/, '')) + '</h3>';
      if (/^##\s/.test(p)) return '<h2 style="font-size:19px;font-weight:600;color:#0a0a0a;margin:24px 0 10px;">' + esc(p.replace(/^##\s*/, '')) + '</h2>';
      if (/^[-•]/.test(p)) {
        return '<ul style="margin:8px 0;padding-left:20px;color:#444;font-size:14.5px;line-height:1.9;">' + p.split(/\n/).map(function (li) { return '<li>' + esc(li.replace(/^[-•]\s*/, '')) + '</li>'; }).join('') + '</ul>';
      }
      return '<p style="color:#444;font-size:14.5px;line-height:1.9;margin:10px 0;">' + esc(p) + '</p>';
    }).join('');
  }

  /* ===================== 5. 博客：筛选 + 文章详情 ===================== */
  var BLOG_ARTICLES = [
    { title: '如何用AI写小说？2026完整教程：4步写出日更4000字的网文', cat: 'tutorial', body: '很多作者第一次接触 AI 写作时，都会陷入「生成一大段再狂改」的低效循环。真正可持续的流程是四步法：定大纲 → 建设定 → 分章生成 → 人工润色。\n\n## 第一步：用三级大纲锁定方向\n先让 AI 生成总纲（世界观 + 主线冲突 + 结局走向），再拆分卷纲，最后落到章纲。每一级都人工确认后再往下拆，避免后期整体返工。\n\n## 第二步：设定卡先行\n主角、金手指、核心配角、势力关系先建卡。生成正文时把设定卡装配进上下文，AI 就不会写崩人设。\n\n## 第三步：分章生成，每章一个爽点\n每次只生成一章（2000-4000 字），并在提示中明确本章的目标事件与情绪落点。生成后立即校对入库，作为下一章的上下文。\n\n## 第四步：人工润色去 AI 味\n重点改三处：开头第一段的节奏、对话的口语化程度、结尾钩子。每天稳定执行这套流程，日更 4000 字完全可以在 2 小时内完成。' },
    { title: '穿进盗墓笔记当黎簇同桌是什么体验？同人写法拆解', cat: 'case', body: '同人写作最大的难点不是文笔，而是「原著感」。读者点开一篇盗墓笔记同人，期待的是熟悉的氛围：闷油瓶的沉默、胖子的贫嘴、吴邪的碎碎念。\n\n## 视角选择：小人物切入\n以黎簇同桌这样的边缘视角切入，好处是既能旁观主线剧情，又拥有自己的成长弧线，不会被原著剧情绑死。\n\n## 原著细节的「锚点」用法\n每章埋 2-3 个原著细节（麒麟纹身、青铜门、张家古楼），读者会因为认出这些锚点而产生强烈的代入感。但切忌堆砌——锚点是调味料，不是主菜。\n\n## AI 辅助的正确姿势\n把原著人物的说话风格整理成设定卡（例如：胖子——自来熟、爱用歇后语、关键时刻靠谱），让 AI 生成对话时装配这些卡片，原著感会稳定很多。' },
    { title: '从30本高分网文中提炼的2025年写作十大黄金法则', cat: 'skill', body: '我们分析了 2025 年起点、番茄、七猫三平台评分 9.0+ 的 30 本作品，提炼出十条可直接落地的法则。\n\n- 第一章必须出现主角的「困境 + 特质」，缺一不可\n- 前三章至少一次「情绪反转」，让读者体验落差\n- 金手指要有代价，无代价的能力没有张力\n- 每 3-5 章一个小高潮，每 30 章一个大高潮\n- 配角要有自己的欲望，不能只是主角的背景板\n- 对话推动剧情，描写渲染情绪，二者比例约 6:4\n- 悬念开一个填一个，未解悬念不超过 3 条\n- 升级体系前 10 章内讲清楚，中途不换规则\n- 反派的逻辑要自洽，「坏得有道理」才可怕\n- 每章结尾留钩子：新信息、新危机或新目标\n\n这十条法则同样适用于 AI 辅助写作——把它们写进你的生成提示里，出稿质量会有肉眼可见的提升。' },
    { title: '爆款小说开头怎么写：黄金三章结构拆解', cat: 'skill', body: '网文的生死线在前三章。数据显示，70% 的读者流失发生在第一章，而留存到第四章的读者有一半会读完前五十章。\n\n## 第一章：困境开局\n不要从「早晨醒来」写起。让主角在第一屏就处于具体困境：被退婚、被夺舍、破产、濒死。困境越具体，代入越快。\n\n## 第二章：展示特质与金手指\n主角靠什么走出困境？这一章要让读者看到希望——金手指觉醒、贵人出现、隐藏身份浮出水面。注意：金手指要「露一角」，不要一次性展示全部。\n\n## 第三章：第一次爽点兑现\n用一场小规模的胜利兑现前两章积累的期待：打脸质疑者、通过考核、赚到第一桶金。这场胜利要干脆利落，不拖泥带水。\n\n三章看下来，读者对主角的处境、能力、目标一清二楚——这就是所谓的「黄金三章」。' },
    { title: '世界观设定不崩的五个关键', cat: 'skill', body: '长篇最怕「吃书」——写到一百章发现设定自相矛盾。五个关键习惯可以避免：\n\n## 1. 规则先于例外\n先定死体系规则（力量等级、资源稀缺度、势力格局），再设计例外。例外必须有成本，否则规则形同虚设。\n\n## 2. 设定卡外置\n不要依赖记忆。每个人物、势力、功法、道具都建卡，写作时随查随用。墨阑的知识图谱会自动维护这些实体之间的关系。\n\n## 3. 时间线单独管理\n把关键事件按时间轴排列，标注主角当时的实力与位置。九成的吃书都是时间线错乱导致的。\n\n## 4. 增量披露\n世界观不要一次性抛给读者。按「当前剧情需要」披露，既保持神秘感，也给自己留下调整余地。\n\n## 5. 定期回读\n每 20 章回读一次大纲与设定库，检查偏移。发现矛盾立即在设定卡上标注修正，而不是留到「以后再说」。' },
    { title: '如何让 AI 写出符合角色性格的对话', cat: 'tutorial', body: 'AI 生成的对话经常「千人一面」，根源是提示里缺少人物的语言指纹。\n\n## 建立语言指纹卡\n为每个主要角色整理：口头禅、句长习惯（短句急促/长句从容）、敬语程度、幽默方式、禁忌词。例如：冷面剑客——单句不超过十字，从不解释，习惯用反问结束对话。\n\n## 对话生成的三段式提示\n1）场景与目标：谁在哪、想从对方那里得到什么；2）双方的语言指纹卡；3）本段对话需要透露的信息与需要隐藏的信息。\n\n## 检验标准：遮住名字猜人\n生成后把说话人名字遮住，如果你能凭语气猜出是谁在说话，这段对话就合格了。猜不出来，就回头补语言指纹。\n\n在墨阑中，语言指纹可以直接存入角色卡，多智能体生成对话时会自动装配，长篇中角色的说话方式不会漂移。' },
    { title: '网文节奏：爽点、铺垫与反转', cat: 'skill', body: '节奏是网文的呼吸。读者说「这本书好看但说不出为什么」，多半是节奏做对了。\n\n## 爽点的密度与强度\n小爽点（打脸、捡漏、升级）每 3-5 章一个；大爽点（大战、身份揭晓、体系突破）每 25-35 章一个。强度要递增——后一个大爽点必须比前一个更强，否则读者会疲劳。\n\n## 铺垫的「三次法则」\n重要的反转至少铺垫三次：第一次一笔带过，第二次引起注意，第三次让部分读者猜到。全猜到没惊喜，全猜不到像开挂，「一半读者猜到」是最佳状态。\n\n## 反转的成本守恒\n每次反转都要付出叙事成本：提前埋线、牺牲配角、消耗主角资源。零成本的反转（突然出现的救兵、突然觉醒的力量）会迅速消耗读者信任。\n\n用大纲工具把爽点和铺垫标注在章纲上，写作时按图施工，节奏就不会失控。' },
    { title: 'AI 写作工具选型指南 2026', cat: 'industry', body: '2026 年的 AI 写作工具已经分化出三个流派，选型前先想清楚自己的需求。\n\n## 通用对话流（ChatGPT / DeepSeek 网页版）\n优点：免费或低成本、模型能力强。缺点：无长篇记忆管理，超过十万字后上下文管理全靠手动，吃书风险高。适合短篇与试水。\n\n## 海外专业流（Sudowrite / NovelCrafter）\n优点：功能成熟、社区活跃。缺点：中文网文语感偏弱，爽点、打脸这类中式叙事节奏理解不到位，订阅价格偏高。\n\n## 中文垂直流（墨阑等）\n优点：针对中文网文优化，三级大纲、知识图谱、多智能体协作解决长篇一致性问题；按积分计费对轻度用户友好。缺点：生态相对年轻。\n\n## 选型建议\n- 写 10 万字以内短篇：通用对话流足够\n- 写百万字长篇：必须选择有设定管理与上下文装配能力的垂直工具\n- 预算敏感：优先积分制而非包月制' },
    { title: '长篇小说如何避免"吃书"', cat: 'skill', body: '「吃书」指作者忘记或推翻自己之前写下的设定。百万字长篇中，靠人脑记住所有细节是不可能的。\n\n## 吃书的三大重灾区\n1）数值体系：主角的钱、修为、库存道具；2）人物关系：谁认识谁、谁欠谁人情；3）时间线：事件先后与人物年龄。\n\n## 工程化解法\n把小说当项目管理：每章写完后更新「状态快照」——主角当前实力、位置、身上的资源、未解决的伏笔。这份快照就是下一章生成时的上下文基底。\n\n## 知识图谱的作用\n墨阑会从正文中自动抽取实体与关系，构建人物-势力-道具-事件的图谱。写到第 500 章时问一句「主角和青云宗的恩怨进展到哪了」，图谱直接给出完整链路，不需要翻前文。\n\n## 读者比你记得清楚\n永远假设读者拿着放大镜读书。与其事后在评论区圆设定，不如写作时就把一致性交给工具保障。' },
    { title: '从大纲到日更：一个全职作者的 AI 写作工作流', cat: 'tutorial', body: '我是全职网文作者，日更 8000 字，AI 参与度约 60%。分享我的完整工作流。\n\n## 早上 9:00-9:30：校对与入库\n把前一天晚上生成的草稿做最后校对，确认后入库。同时更新设定卡的变动（新人物、新道具、实力变化）。\n\n## 9:30-10:00：当日章纲细化\n从卷纲里取出今天要写的两章，把章纲细化到「事件序列」级别：谁做了什么 → 遇到什么阻力 → 情绪落点在哪。\n\n## 10:00-11:30：分段生成与即时修改\n每次生成 800-1200 字，读一遍改一遍再继续。这比一次生成 4000 字再大改效率高得多——错误不会向后传播。\n\n## 下午：人工深度润色\n重点打磨对话与情绪段落。AI 负责骨架与肌肉，血肉必须自己填。\n\n## 晚上：预生成明日草稿\n用批量任务让 AI 按明日章纲生成初稿，第二天早上校对。整个循环跑顺后，日更 8000 字的实际工作时间约 5 小时。' }
  ];

  function initBlogPage() {
    if (PAGE !== 'blog.html') return;
    var cards = $all('.blog-card');
    var btns = $all('.filter-btn');

    function setActive(btn) {
      btns.forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('active', on);
        b.classList.toggle('bg-[#0a0a0a]', on);
        b.classList.toggle('text-white', on);
        b.classList.toggle('border-[#0a0a0a]', on);
        b.classList.toggle('text-[#666666]', !on);
        b.classList.toggle('border-[#e5e5e5]', !on);
      });
    }
    function filter(cat) {
      cards.forEach(function (c) {
        c.style.display = (cat === 'all' || c.dataset.category === cat) ? '' : 'none';
      });
    }
    btns.forEach(function (b) {
      b.addEventListener('click', function () { setActive(b); filter(b.dataset.filter); });
    });
    /* 支持 ?filter= 直达 */
    var q = new URLSearchParams(location.search).get('filter');
    if (q) {
      var target = btns.filter(function (b) { return b.dataset.filter === q; })[0];
      if (target) { setActive(target); filter(q); }
    }

    /* 文章详情弹窗（按卡片顺序对应文章数据），href 带 ?a= 支持直达 */
    cards.forEach(function (card, i) {
      var art = BLOG_ARTICLES[i];
      if (!art) return;
      $all('a', card).forEach(function (a) {
        a.setAttribute('href', './blog.html?a=' + i);
        a.addEventListener('click', function (e) {
          e.preventDefault();
          openModal(
            '<span style="display:inline-block;font-size:11px;letter-spacing:.15em;color:#999;text-transform:uppercase;margin-bottom:8px;">创作者手札</span>' +
            '<h1 style="font-size:24px;font-weight:700;color:#0a0a0a;line-height:1.4;margin:0 0 16px;">' + esc(art.title) + '</h1>' +
            mdToHtml(art.body) +
            '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #f0f0f0;display:flex;gap:12px;">' +
            '<a href="./tools.html" style="font-size:13px;color:#16a34a;text-decoration:none;">→ 试试免费工具</a>' +
            '<a href="./login.html" style="font-size:13px;color:#0a0a0a;text-decoration:none;">→ 开始创作</a></div>', true);
        });
      });
    });

    /* ?a= 直达文章 */
    var ai = parseInt(new URLSearchParams(location.search).get('a'), 10);
    if (!isNaN(ai) && cards[ai]) {
      setTimeout(function () {
        var link = cards[ai].querySelector('a');
        if (link) link.click();
      }, 300);
    }
  }

  /* ===================== 6. 使用文档：教程详情 ===================== */
  var TUTORIALS = [
    { title: '第一次用墨阑？从这里开始', body: '## 第一步：注册账号\n打开登录页，输入邮箱与密码即可注册，新账号自动赠送 500 积分。\n\n## 第二步：创建第一本小说\n进入工作台后点击「开始创作」，填写书名与题材。系统会引导你选择创作模式：从灵感开始（AI 帮你发散）或从大纲开始（你已有想法）。\n\n## 第三步：认识工作台\n左侧是章节树与设定库，中间是编辑区，右侧是 AI 协作面板。先花两分钟把鼠标悬停在各个图标上看提示，比任何教程都直观。\n\n完成这三步，你就可以生成第一段正文了。建议先从「10 分钟写出第一章」教程继续。' },
    { title: '管理你的书架：创建新书和找到旧书', body: '## 书架视图\n首页的书架按「最近编辑」排序展示所有作品，每本书显示字数、章节数与最后编辑时间。\n\n## 创建新书\n点击书架右上角的「+ 新建」，支持三种起点：空白项目、导入已有文稿（txt/docx）、从模板开始（预置了玄幻、都市、悬疑等题材的设定框架）。\n\n## 归档与搜索\n完结或暂停的作品可以右键归档，书架会保持整洁；顶部搜索框支持按书名、标签、正文内容全文检索。\n\n## 多端同步\n所有作品实时云端保存，换设备登录同一账号即可继续写作。' },
    { title: '10 分钟写出第一章：最快拿到成果的方法', body: '## 准备（2 分钟）\n新建小说后，在「快速设定」里填三样东西：主角是谁、他遇到了什么麻烦、这个世界有什么特别之处。不用完美，一句话即可。\n\n## 生成（5 分钟）\n在 AI 面板输入：「按快速设定写第一章，2500 字左右，困境开局，结尾留钩子」。AI 会流式输出正文，你可以随时暂停调整方向。\n\n## 修改（3 分钟）\n重点看三处：第一段是否足够抓人、对话是否自然、结尾钩子是否成立。选中不满意的段落点「重写」，AI 会给出 2-3 个替代版本。\n\n第一章不需要完美——它的作用是让你进入状态。写完第一章，你对这本书的感觉会比任何大纲都真实。' },
    { title: '三层大纲怎么搭：总纲、分卷、章节的写作顺序', body: '## 总纲：定方向（500-1000 字）\n回答四个问题：世界观核心冲突是什么？主角的起点和终点？贯穿全书的主线是什么？大结局的画面感。总纲一旦确定，轻易不改。\n\n## 卷纲：控节奏（每卷 300-500 字）\n把总纲切成 4-8 卷，每卷一个阶段性目标：本卷主角从什么状态到什么状态、本卷大高潮是什么、留下什么悬念进入下一卷。\n\n## 章纲：落细节（每章 50-150 字）\n只对当前卷做章纲，写明每章的事件、冲突与情绪落点。后面卷的章纲不要提前写——剧情会生长，提前写的章纲多半会作废。\n\n## AI 协作方式\n每一级大纲都可以让 AI 先出草案，你做减法和修正。记住原则：方向你定，体力活 AI 干。' },
    { title: 'AI 协作模式怎么选：单个 AI 还是多个 AI 一起干', body: '## 单智能体模式\n一个 AI 负责从头写到尾。优点：风格统一、响应快、积分消耗低。适合：短篇、单线剧情、风格要求强烈的作品。\n\n## 多智能体协作模式\n多个专业 Agent 分工：大纲师负责结构、写手负责正文、设定管家盯一致性、评审员挑毛病，最后由主编 Agent 汇总。优点：长篇一致性显著更好，复杂多线剧情不易崩。代价：生成速度稍慢、积分消耗约为单智能体的 1.5-2 倍。\n\n## 选择建议\n- 30 万字以内 / 单主线 → 单智能体\n- 百万字长篇 / 多线群像 → 多智能体\n- 折中方案：平时用单智能体，大高潮章节切换到多智能体精工细作。' },
    { title: '怎么整理资料和笔记', body: '## 知识库：作品的外脑\n每本书都有独立知识库，支持导入 txt、markdown、网页剪藏。参考资料（历史背景、行业知识、地理资料）都放这里，AI 生成时可以按需检索。\n\n## 标签系统\n给笔记打标签（#人物灵感 #场景素材 #金句），跨书检索灵感时非常好用。\n\n## 快速笔记\n写作过程中冒出的灵感，用快捷键 Ctrl+Shift+N 随手记下，不打断心流。笔记会自动关联当前章节，回头整理时带着上下文。\n\n## 与设定卡的分工\n知识库放「素材」（未加工的原料），设定卡放「事实」（已确认的正史）。AI 生成时优先信任设定卡，知识库仅作参考。' },
    { title: '角色、世界观和悬念在哪里管', body: '## 设定面板\n工作台左侧的「设定」标签页集中管理三类实体：\n\n- 角色卡：外貌、性格、语言指纹、目标与恐惧、当前状态\n- 世界观词条：力量体系、地理、势力、规则与禁忌\n- 悬念线：每条悬念的埋设章节、当前进展、计划揭晓位置\n\n## 自动引用\n生成正文时，系统会根据章纲自动装配相关设定卡进入上下文。你也可以手动指定「本章必须参考」的卡片。\n\n## 变更追踪\n角色实力提升、势力覆灭等重大变化，在卡片上直接更新并标注章节号。卡片保留修改历史，随时可以查「主角在第 120 章时是什么实力」。\n\n## 悬念健康度\n悬念面板会提醒超过 50 章未推进的悬念线——读者忘了不要紧，你不能忘。' },
    { title: '检查和改掉 AI 味', body: '## 什么是 AI 味\n典型症状：排比句泛滥、形容词堆砌、每段结尾都在总结升华、人物说话像新闻发言人、滥用「仿佛」「似乎」「不禁」。\n\n## 内置检测工具\n选中文本点「AI 味检测」，系统会标注疑似痕迹并按浓度打分。80 分以上建议重写，60-80 分局部修改即可。\n\n## 一键改写\n检测结果页可直接「去 AI 味改写」：系统会缩短句子、删掉冗余修饰、把书面语替换成口语、打散工整的排比结构。\n\n## 治本之道\n在生成提示里就写明文风要求（如「短句为主，少用成语，对话口语化」），比事后修补效率高十倍。可以把你的文风样本存进知识库，让 AI 模仿你的笔感。' },
    { title: '怎么给文章"去 AI 味"', body: '## 三个最有效的手动技巧\n\n## 1. 语气降格\nAI 爱写「他的内心涌起一股难以名状的悲伤」，人会写「他鼻子一酸」。把抽象情绪描述换成身体反应，AI 味立减一半。\n\n## 2. 句式打散\nAI 的句子长度过于均匀。手动把一些长句砍成短句，再把几个短句合并成长句，制造自然的呼吸感。特别是动作场面——短句才有速度感。\n\n## 3. 细节注入\nAI 写「街上很热闹」，你补一句「卖糖葫芦的老头正跟人吵架」。具体、意外、带烟火气的细节是人类作者的指纹，AI 模仿不来。\n\n## 工具辅助\n免费工具页的「去 AI 味改写」可以批量处理初稿，之后再用上面三个技巧精修关键段落，效率与质量兼得。' },
    { title: '让 AI 只看该看的：上下文装配怎么配', body: '## 为什么需要上下文装配\n把全书都塞给 AI 既不可能（上下文有限）也不明智（信息过载会稀释重点，还可能剧透后文伏笔）。\n\n## 装配面板\n生成前打开「上下文装配」面板，勾选本次生成 AI 可见的内容：\n\n- 章节：默认带上前 2 章正文 + 本章章纲\n- 设定卡：系统按章纲自动推荐，可手动增删\n- 知识库：选择相关素材条目\n- 状态快照：主角当前实力、位置、资源\n\n## 防剧透机制\n标记为「未揭晓」的设定卡（如幕后黑手的真实身份）默认不进入上下文，除非当前章节被标记为揭晓章。这能防止 AI 提前把底牌写漏。\n\n## 积分优化\n上下文越长消耗越多。日常章节用「精简装配」（前 1 章 + 章纲 + 3 张核心卡）就够了，大高潮章节再用完整装配。' },
    { title: '设定的隐藏与按卷渐进开放', body: '## 分层可见性\n每张设定卡有三档可见性：\n\n- 公开：AI 随时可引用（如主角外貌）\n- 按卷开放：指定从第 N 卷起对 AI 可见（如第三卷才揭晓的身世）\n- 锁定：仅作者可见，AI 永远不引用（如大结局反转）\n\n## 为什么要这样做\nAI 不会「装不知道」。如果它知道管家是凶手，前文的描写就会不自觉地泄露倾向。把底牌锁住，AI 写出来的「不知情视角」才真实。\n\n## 渐进开放的操作\n在卡片编辑页设置「开放条件」：到达指定卷/章后自动解锁。你也可以在揭晓章手动临时装配锁定卡片。\n\n## 与悬念线联动\n悬念线上的每个节点可以关联设定卡的解锁时机，伏笔的埋设与揭晓在一张时间轴上一目了然。' },
    { title: '自定义智能体：给每个 AI 配人设和专属知识库', body: '## 什么是自定义智能体\n除了系统内置的写手、大纲师等 Agent，你可以创建自己的智能体：给它起名、写人设提示词、绑定专属知识库、指定默认模型。\n\n## 实用案例\n\n- 「毒舌评审」：绑定你收藏的书评方法论，人设是挑剔的老编辑，专门给章节挑毛病\n- 「古风润色师」：知识库里放古典文学摘抄，负责把白话改出古韵\n- 「战斗导演」：人设强调镜头感与打击感，专写动作场面\n\n## 创建步骤\n设置 → 智能体 → 新建：填写名称、人设提示词（建议 200-500 字，具体说明它的职责、风格、禁忌）、挂载知识库、选择模型（快速任务用 flash，精细任务用 pro）。\n\n## 团队协作\n多智能体模式下，自定义智能体可以加入流水线，替换或补充内置角色——组建一支完全符合你口味的写作团队。' }
  ];

  function initDocsPage() {
    if (PAGE !== 'docs.html') return;
    var dcards = $all('.tutorial-card');
    dcards.forEach(function (card, i) {
      var tut = TUTORIALS[i];
      if (!tut) return;
      $all('a', card).forEach(function (a) {
        a.setAttribute('href', './docs.html?t=' + i);
        a.addEventListener('click', function (e) {
          e.preventDefault();
          openModal(
            '<span style="display:inline-block;font-size:11px;letter-spacing:.15em;color:#999;text-transform:uppercase;margin-bottom:8px;">使用教程</span>' +
            '<h1 style="font-size:24px;font-weight:700;color:#0a0a0a;line-height:1.4;margin:0 0 16px;">' + esc(tut.title) + '</h1>' +
            mdToHtml(tut.body) +
            '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #f0f0f0;">' +
            '<a href="./login.html" style="font-size:13px;color:#16a34a;text-decoration:none;">→ 注册账号，跟着教程实操</a></div>', true);
        });
      });
    });

    /* ?t= 直达教程 */
    var ti = parseInt(new URLSearchParams(location.search).get('t'), 10);
    if (!isNaN(ti) && dcards[ti]) {
      setTimeout(function () {
        var link = dcards[ti].querySelector('a[href^="./docs.html?t="]');
        if (link) link.click();
      }, 300);
    }
  }

  /* ===================== 7. 免费工具：真实 AI 工作台 ===================== */
  var TOOL_DEFS = {
    deai: {
      name: '去 AI 味改写',
      ph: '粘贴需要去 AI 味的文本…',
      btn: '开始改写',
      sys: '你是中文去 AI 味改写专家，任务是依据 Stop AI Slop 准则消除文本中的典型 AI 写作痕迹，拆掉八股骨架，改写成人话：\n' +
        '1. 删虚词与程度副词：删去“非常/十分/极其/一种/某种/其实/本质上/坦白说”等无信息增量的虚词；\n' +
        '2. 拆排比三件套：凡出现“是…是…更是…”或“既要…又要…还要…”，直接拆除，仅保留一句最有力的，其余删除或分句表述；\n' +
        '3. 去名词化：把“进行优化/做出选择/实现增长/采取措施/加以改进/给予支持”等“动词+抽象名词”换成本词动作（如优化、选、涨了、怎么做）；\n' +
        '4. 删金句收尾与抒情扩散：坚决删除段尾升华套话（如“这，就是…的力量”、“唯有…方能…”、“在这个…的时代”、“让我们一起…”）；\n' +
        '5. 换抽象主语为具体细节：绝不用“时代/科技/AI/未来/行业/现实”做主语，换成具体的人、动作、数字与场景；\n' +
        '6. 删元评论与八股连接词：删除“首先/其次/再者/最后/综上所述/总而言之/值得注意的是/不得不说/毫无疑问/让我们来探讨”；\n' +
        '7. 给具体：把“重要/关键/核心/显著/巨大”等空泛价值判断换成具体的数据、画面或事实；\n' +
        '8. 砍八股结构：打破总分总套路，让长短句交错，节奏自然舒展。\n' +
        '保持原意、事实与信息完整。直接输出改写后的最终文本，不要前言、不要解释、不要元评论。'
    },
    typo: { name: '错别字检测', ph: '粘贴需要检查错别字的文本…', btn: '开始检测', sys: '你是专业中文校对。逐句检查用户文本中的错别字、多字漏字、标点误用、的地得混用。以列表输出：每条包含【原文片段】→【修改建议】→【原因】。最后给出全文修正版。若无错误则明确说明。' },
    aiflavor: {
      name: 'AI 味浓度检测',
      ph: '粘贴要检测 AI 味的文本…',
      btn: '开始检测',
      sys: '你是中文 AI 文本鉴别专家，基于 Stop AI Slop 五维量规进行专业诊断：\n' +
        '1. 评分标准（总分 50 分，每维 1-10 分）：\n' +
        '   - 【直】直白度与虚词密度（虚词是否刷屏）；\n' +
        '   - 【实】具体度与信息密度（是否有名字、数字、动作、画面，还是充斥抽象大词与价值判断）；\n' +
        '   - 【变】节奏与句长变化（是否存在排比三件套、句长趋同、段落等长）；\n' +
        '   - 【散】去骨架与去八股（是否存在“首先/其次/综上”密集与总分总架构）；\n' +
        '   - 【真】人味与叙述视角（是否有真实人类说话的判断态度，还是抽象主语与段尾金句升华）。\n' +
        '2. 诊断输出格式：\n' +
        '   - 【五维评分表】列出各维度得分与总分（低于 35 分即判定为严重 AI 味）；\n' +
        '   - 【典型病灶诊断】精准指出原文命中的特征（排比三件套、名词化动词、抽象主语、金句收尾、八股连接词等）并引用原文句子；\n' +
        '   - 【精修与去 AI 味建议】针对每一个病灶给出具体人话改写示范。'
    },
    namer: { name: '小说命名生成器', ph: '描述你的小说：题材、主角、核心设定、风格…', btn: '生成书名', sys: '你是网文书名策划专家，深谙各平台爆款书名规律。根据用户描述生成 12 个书名，分为四组：传统大气组、悬念钩子组、长句流量组、文艺格调组，每组 3 个。每个书名附一句推荐理由。' },
    format: { name: '排版清洗', ph: '粘贴需要清洗排版的文本…', btn: '开始清洗', sys: '你是文本排版工具。清洗用户文本：统一为中文标点、去除多余空格与空行、每段首行不缩进（网文格式）、对话独立成段、修复段落粘连。直接输出清洗后的文本，不要解释。' },
    duplicate: { name: '重复内容检测', ph: '粘贴需要检测重复的文本…', btn: '开始检测', sys: '你是文本查重助手。检测用户文本内部的重复问题：重复用词（高频词统计）、重复句式、语义重复的段落、口头禅式表达。输出问题清单（引用原文位置）与替换建议。' },
    chaptertitle: { name: '章节标题生成', ph: '粘贴本章内容或概要…', btn: '生成标题', sys: '你是网文章节标题专家。根据用户提供的章节内容生成 10 个章节标题，覆盖不同风格：悬念式、冲突式、金句式、白描式。标题控制在 12 字以内，附一句说明各自适用场景。' },
    charactercard: { name: '人物卡生成', ph: '描述人物的基本信息：身份、性格关键词、在故事中的作用…', btn: '生成人物卡', sys: '你是角色设计师。根据用户描述生成完整人物卡：姓名（3 个备选）、外貌特征、性格（表 / 里两层）、语言指纹（口头禅、句式习惯）、欲望与恐惧、成长弧线建议、与主角的关系张力点。用清晰的分节格式输出。' },
    blurb: { name: '作品简介生成', ph: '描述你的小说：题材、主线、主角金手指、最大卖点…', btn: '生成简介', sys: '你是网文简介文案专家。根据用户描述生成 3 版作品简介：悬念版（150 字内，钩子开头）、爽点版（200 字内，突出金手指与打脸）、文艺版（150 字内，氛围与格调）。每版后注明适合的平台调性。' },
    beat: { name: '情节节拍器', ph: '描述本章目标：谁要做什么、遇到什么阻力、想要什么效果…', btn: '生成节拍', sys: '你是剧情结构师。根据用户的章节目标生成本章节拍表（beat sheet）：以时间顺序列出 6-10 个节拍，每个节拍标注：事件、冲突升级点、情绪曲线位置、字数占比建议。最后给出本章结尾钩子的 3 个方案。' },
    novel: { name: 'AI 小说生成器', ph: '一句话描述你想写的小说，例如：一个外卖员获得了暂停时间的能力…', btn: '开始生成', sys: '你是专业网文作者。根据用户的灵感描述，生成小说开篇方案：1) 书名（2 个备选）；2) 一段话故事梗概；3) 主角设定（含金手指及其代价）；4) 第一章正文（1500 字左右，困境开局，结尾留钩子）。文风自然，避免 AI 腔。' },
    idea_outline: { name: '大纲灵感 · 三级大纲生成', ph: '输入你的故事灵感或一句话梗概…', btn: '生成大纲', sys: '你是大纲架构师。根据用户灵感生成三级大纲：总纲（世界观核心冲突、主角起点终点、主线、结局画面）、分卷纲（4-6 卷，每卷阶段目标与大高潮）、第一卷前 10 章章纲（每章事件与情绪落点）。' },
    idea_world: { name: '世界观灵感 · 设定生成', ph: '描述你想要的世界基调：修仙 / 赛博 / 克苏鲁 / 历史架空…', btn: '生成世界观', sys: '你是世界观设计师。根据用户的基调生成世界观框架：力量 / 科技体系（含等级与代价）、地理与势力格局、核心规则与禁忌、三个可挖掘的历史谜团、这个世界最独特的一条设定。' },
    idea_cheat: { name: '金手指灵感 · 能力设计', ph: '描述主角身份与故事题材…', btn: '生成金手指', sys: '你是金手指设计专家。根据用户描述生成 5 个金手指方案，每个包含：能力描述、成长路线、使用代价 / 限制（必须有）、与题材的化学反应、可能产生的爽点场景。避免烂大街的系统流套路，追求新意。' },
    idea_power: { name: '力量体系灵感 · 体系搭建', ph: '描述题材与你想要的战斗风格…', btn: '生成体系', sys: '你是力量体系架构师。生成完整力量体系：等级划分（命名要有辨识度）、晋升条件与瓶颈、资源与稀缺性、各等级的社会地位对照、体系漏洞（供剧情利用的规则边缘）。' },
    idea_opening: { name: '开篇灵感 · 黄金三章方案', ph: '描述你的小说：题材、主角、核心冲突…', btn: '生成方案', sys: '你是开篇专家。根据用户描述生成黄金三章方案：第一章（困境开局：具体场景与冲突）、第二章（特质与金手指展示方式）、第三章（第一个爽点如何兑现）。每章给出 200 字的详细方案与开头第一段的示范文字。' },
    idea_dialogue: { name: '对话灵感 · 名场面生成', ph: '描述场景：谁和谁对话、各自目标、当前关系…', btn: '生成对话', sys: '你是对话大师。根据用户的场景描述生成一段 500-800 字的名场面对话：双方语言风格差异鲜明、有潜台词与信息差、对话推动剧情或关系变化、结尾留余味。对白为主，动作与神态描写为辅。' },
    idea_checklist: { name: '开书自查清单', ph: '粘贴你的开书准备：书名、简介、大纲、前三章概要（有什么贴什么）…', btn: '开始体检', sys: '你是资深网文编辑。对用户的开书准备做上架前体检，逐项打分（10 分制）并给出修改意见：书名吸引力、简介钩子、题材红海度、开篇困境强度、金手指新意、前三章爽点密度、预期读者画像。最后给出总分与最需要优先修改的三件事。' }
  };

  function initToolsPage() {
    if (PAGE !== 'tools.html') return;
    /* 点击工具卡 → 打开工作台（需登录） */
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-tool], button[data-tool], [data-dom-id^="tool-"], [data-dom-id^="idea-"], [data-dom-id="hub-novel-generator"], [data-dom-id="hero-cta-deai"], .tool-card');
      if (!a) return;
      var toolKey = a.getAttribute('data-tool');
      if (!toolKey && a.getAttribute('data-dom-id')) {
        var did = a.getAttribute('data-dom-id');
        if (did === 'hub-novel-generator') toolKey = 'novel';
        else if (did === 'hero-cta-deai') toolKey = 'deai';
        else {
          var m = did.match(/^tool-([a-z0-9_-]+)-try$/);
          if (m) toolKey = m[1];
          else {
            var m2 = did.match(/^idea-([a-z0-9_-]+)$/);
            if (m2) toolKey = 'idea_' + m2[1];
          }
        }
      }
      if (!toolKey && a.classList && a.classList.contains('tool-card')) {
        var innerTry = a.querySelector('[data-tool], [data-dom-id^="tool-"]');
        if (innerTry) {
          toolKey = innerTry.getAttribute('data-tool');
          if (!toolKey && innerTry.getAttribute('data-dom-id')) {
            var m3 = innerTry.getAttribute('data-dom-id').match(/^tool-([a-z0-9_-]+)-try$/);
            if (m3) toolKey = m3[1];
          }
        }
      }
      if (!toolKey && a.getAttribute('href')) {
        var href = a.getAttribute('href');
        var match = href.match(/[?&]tool=([a-z0-9_-]+)/);
        if (match) toolKey = match[1];
      }
      if (!toolKey || !TOOL_DEFS[toolKey]) return;
      e.preventDefault();
      if (!auth.token) {
        toast('请先登录后使用 AI 工具');
        setTimeout(function () {
          location.href = ROUTES.login + '?redirect=' + encodeURIComponent(ROUTES.tools + '?tool=' + toolKey);
        }, 400);
        return;
      }
      openWorkbench(toolKey);
    });
    /* ?tool= 直达（需登录） */
    var q = new URLSearchParams(location.search).get('tool');
    if (q && TOOL_DEFS[q]) {
      if (!auth.token) {
        toast('请先登录后使用 AI 工具');
        setTimeout(function () {
          location.href = ROUTES.login + '?redirect=' + encodeURIComponent(ROUTES.tools + '?tool=' + q);
        }, 400);
      } else {
        setTimeout(function () { openWorkbench(q); }, 300);
      }
    }
  }

  function openWorkbench(key) {
    var def = TOOL_DEFS[key];
    if (!def) return;
    if (!auth.token) {
      toast('请先登录后使用 AI 工具');
      setTimeout(function () {
        location.href = ROUTES.login + '?redirect=' + encodeURIComponent(ROUTES.tools + '?tool=' + key);
      }, 400);
      return;
    }
    openModal(
      '<span style="display:inline-block;font-size:11px;letter-spacing:.15em;color:#16a34a;text-transform:uppercase;margin-bottom:8px;">AI 工具 · 已登录</span>' +
      '<h1 style="font-size:22px;font-weight:700;color:#0a0a0a;margin:0 0 16px;">' + esc(def.name) + '</h1>' +
      '<textarea id="ml-tool-input" placeholder="' + esc(def.ph) + '" style="width:100%;min-height:140px;padding:14px;border:1px solid #e5e5e5;border-radius:14px;font-size:14px;line-height:1.7;resize:vertical;outline:none;font-family:inherit;box-sizing:border-box;" onfocus="this.style.borderColor=\'#0a0a0a\'" onblur="this.style.borderColor=\'#e5e5e5\'"></textarea>' +
      '<div style="display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap;">' +
      '<button id="ml-tool-run" style="padding:11px 28px;background:#0a0a0a;color:#fff;border:none;border-radius:999px;font-size:14px;cursor:pointer;">' + esc(def.btn) + '</button>' +
      '<span id="ml-tool-status" style="font-size:12px;color:#999;"></span>' +
      '<div id="ml-tool-actions" style="display:none;margin-left:auto;align-items:center;gap:8px;">' +
      '<button id="ml-tool-diff" style="display:none;padding:8px 18px;background:#111827;color:#fff;border:none;border-radius:999px;font-size:13px;font-weight:500;cursor:pointer;align-items:center;gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M8 21H3v-5"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>进入对比工具</button>' +
      '<button id="ml-tool-copy" style="padding:8px 18px;background:#fff;color:#0a0a0a;border:1px solid #d1d5db;border-radius:999px;font-size:13px;font-weight:500;cursor:pointer;">' + (key === 'deai' ? '复制' : '复制结果') + '</button>' +
      '</div></div>' +
      '<div id="ml-tool-output" style="display:none;margin-top:16px;padding:18px;background:#fafafa;border:1px solid #f0f0f0;border-radius:14px;font-size:14px;line-height:1.9;color:#333;white-space:pre-wrap;word-break:break-word;max-height:44vh;overflow-y:auto;"></div>', true);

    var runBtn = $('#ml-tool-run'), input = $('#ml-tool-input'), out = $('#ml-tool-output'), status = $('#ml-tool-status'), actionsGroup = $('#ml-tool-actions'), copyBtn = $('#ml-tool-copy'), diffBtn = $('#ml-tool-diff');
    input.focus();
    function showCreditShortage() {
      if (out && !out.textContent.trim()) out.style.display = 'none';
      status.innerHTML = '积分不足，请前往<a href="' + esc(ROUTES.pricing) + '" style="color:#16a34a;text-decoration:underline;">价格页查看方案</a>';
    }
    function showToolFailure(err) {
      if (out && !out.textContent.trim()) out.style.display = 'none';
      var message = String(err || '').trim();
      if (/insufficient\s+balance|余额不足/i.test(message)) {
        status.textContent = 'AI 服务额度暂时不足，请稍后再试';
        return;
      }
      if (/积分不足|credits?\s+(?:are\s+)?insufficient/i.test(message)) {
        showCreditShortage();
        return;
      }
      status.textContent = '生成失败：' + (message || '服务暂时不可用，请稍后再试');
    }
    function executeRun(user) {
      var text = input.value.trim();
      var isAdmin = user && (user.isAdmin === true || user.role === 'admin' || user.unlimitedCredits === true);
      var credits = user && typeof user.credits === 'number' ? user.credits : 0;
      if (!isAdmin && credits <= 0) {
        showCreditShortage();
        return;
      }
      runBtn.disabled = true; runBtn.style.opacity = '.5';
      status.textContent = '正在生成…';
      out.style.display = 'block'; out.textContent = '';
      if (actionsGroup) actionsGroup.style.display = 'none';
      resolveToolModel().then(function (model) {
        streamChat([
          { role: 'system', content: def.sys },
          { role: 'user', content: text }
        ], function (chunk) {
          out.textContent += chunk;
          out.scrollTop = out.scrollHeight;
        }, function (err) {
          runBtn.disabled = false; runBtn.style.opacity = '';
          if (err) {
            showToolFailure(err);
            refreshAuthUser();
            return;
          }
          refreshAuthUser().then(function (u) {
            var isAdm = u && (u.isAdmin === true || u.role === 'admin');
            var credText = isAdm ? '无限' : (u && typeof u.credits === 'number' ? u.credits : '');
            status.textContent = u ? ('生成完成' + (credText !== '' ? ' · 当前余额 ' + credText + ' 积分' : '')) : '生成完成';
            if (actionsGroup) {
              actionsGroup.style.display = 'inline-flex';
              if (diffBtn) diffBtn.style.display = (key === 'deai') ? 'inline-flex' : 'none';
            }
          });
        }, model);
      });
    }

    runBtn.addEventListener('click', function () {
      var text = input.value.trim();
      if (!text) { status.textContent = '请先输入内容'; return; }
      if (!auth.token) {
        status.innerHTML = '<a href="' + esc(ROUTES.login + '?redirect=' + encodeURIComponent(ROUTES.tools + '?tool=' + key)) + '" style="color:#16a34a;text-decoration:underline;">请先登录后使用 AI 工具</a>';
        setTimeout(function () {
          location.href = ROUTES.login + '?redirect=' + encodeURIComponent(ROUTES.tools + '?tool=' + key);
        }, 800);
        return;
      }
      status.textContent = '正在检查账户…';
      refreshAuthUser().then(function (user) {
        if (!user) {
          if (auth.user) {
            executeRun(auth.user);
          } else {
            status.textContent = '登录状态已失效，请重新登录';
          }
          return;
        }
        executeRun(user);
      }).catch(function () {
        if (auth.user) executeRun(auth.user);
        else status.textContent = '检查账户失败，请刷新或重新登录';
      });
    });
    copyBtn.addEventListener('click', function () {
      var content = out.textContent;
      navigator.clipboard.writeText(content).then(function () {
        toast(key === 'deai' ? '已复制全文' : '已复制到剪贴板');
      }).catch(function () {
        var ta = document.createElement('textarea');
        ta.value = content; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); toast(key === 'deai' ? '已复制全文' : '已复制到剪贴板'); }
        catch (_) { toast('复制失败，请手动选择复制'); }
        document.body.removeChild(ta);
      });
    });
    if (diffBtn) {
      diffBtn.addEventListener('click', function () {
        var originalText = input.value;
        var revisedText = out.textContent;
        var reopenWorkbench = function () {
          openWorkbench(key);
          var newInput = $('#ml-tool-input'), newOut = $('#ml-tool-output'), newActions = $('#ml-tool-actions'), newDiff = $('#ml-tool-diff');
          if (newInput) newInput.value = originalText;
          if (newOut) { newOut.style.display = 'block'; newOut.textContent = revisedText; }
          if (newActions) {
            newActions.style.display = 'inline-flex';
            if (newDiff) newDiff.style.display = 'inline-flex';
          }
        };
        closeModal();
        if (typeof window.openDiffcheckerModal === 'function') {
          window.openDiffcheckerModal({
            original: originalText,
            revised: revisedText,
            title: '去 AI 味对比工具',
            onBack: reopenWorkbench
          });
        } else {
          var s = document.createElement('script');
          s.src = './diffchecker.js';
          s.onload = function () {
            if (typeof window.openDiffcheckerModal === 'function') {
              window.openDiffcheckerModal({
                original: originalText,
                revised: revisedText,
                title: '去 AI 味对比工具',
                onBack: reopenWorkbench
              });
            }
          };
          document.head.appendChild(s);
        }
      });
    }
  }

  /** 调用 /api/chat（DeepSeek SSE 流式） */
  function streamChat(messages, onChunk, onDone, model) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var finished = false;
    function finish(error) {
      if (finished) return;
      finished = true;
      onDone(error || null);
    }
    fetch(API + '/api/chat', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth.token ? { 'Authorization': 'Bearer ' + auth.token } : {}),
      body: JSON.stringify({
        model: model || '',
        messages: messages,
        thinking: false,
        max_tokens: 4096,
        // 工具页没有 Skill 选择器，明确记录“本次不适用 Skill”，避免与编辑器请求混淆。
        skillAudit: { version: 1, skills: [] }
      }),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'HTTP ' + res.status); });
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      function handleLine(rawLine) {
        var line = String(rawLine || '').trim();
        if (!line.startsWith('data:')) return;
        var data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        try {
          var j = JSON.parse(data);
          var delta = j.choices && j.choices[0] && j.choices[0].delta;
          if (delta && delta.content) onChunk(delta.content);
        } catch (e) {}
      }
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            buf += decoder.decode();
            if (buf.trim()) handleLine(buf);
            finish(null);
            return;
          }
          buf += decoder.decode(r.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          lines.forEach(handleLine);
          return pump();
        });
      }
      return pump();
    }).catch(function (e) {
      finish(e.message);
    });
  }

  /* ===================== 7.5 功能详情（features 页六大核心功能） ===================== */
  var FEATURE_DETAILS = {
    'feature-agents': { title: '多智能体协作', body: '## 它解决什么问题\n单个 AI 写长篇时，既要管结构又要管文笔还要盯一致性，往往顾此失彼。多智能体协作把这些职责拆给专业分工的 Agent 团队。\n\n## 团队构成\n- 大纲师：负责结构与节奏，守住三级大纲\n- 写手：专注正文生成，只管把当前章写好\n- 设定管家：实时核对人物、世界观与时间线，防止吃书\n- 评审员：按网文编辑标准挑毛病，打回重写\n- 主编：汇总各方意见，输出最终稿\n\n## 使用方式\n在生成面板切换到「多智能体模式」即可。日常章节建议用单智能体（更快更省），大高潮章节切多智能体精工细作。\n\n## 积分消耗\n约为单智能体模式的 1.5-2 倍，消耗明细在生成记录中逐条可查。' },
    'feature-outline': { title: '三级大纲', body: '## 结构\n总纲（方向）→ 卷纲（节奏）→ 章纲（细节），三级联动。上级大纲修改后，系统会标记受影响的下级条目，提示你同步调整。\n\n## AI 协作\n每一级都支持 AI 起草 + 人工修正：AI 先给方案，你做减法。章纲可以一键「按纲生成正文」，生成结果自动关联回章纲，方便追踪偏移。\n\n## 大纲偏移检测\n写作过程中剧情难免生长。系统会定期对比正文与章纲的偏差，偏移过大时提醒你：是改正文，还是改大纲。\n\n## 适合谁\n计划写 30 万字以上长篇的作者强烈建议从三级大纲开始——前期多花一小时，后期少改十万字。' },
    'feature-knowledge': { title: '知识图谱', body: '## 自动构建\n系统从你的正文与设定卡中自动抽取实体（人物、势力、道具、地点、事件）和它们之间的关系，构建随作品成长的知识图谱。\n\n## 典型用法\n- 写到 500 章忘了某条恩怨线？在图谱中点开两个人物，完整关系链路一目了然\n- 生成正文时，图谱自动为 AI 装配相关实体的最新状态\n- 发现孤立节点（出场一次再没提过的人物），提醒你回收伏笔\n\n## 与设定卡的关系\n设定卡是你手工维护的「正史」，图谱是系统自动维护的「索引」。两者互相校验，冲突时以设定卡为准并向你报告。' },
    'feature-world': { title: '世界观管理', body: '## 分层可见性\n每条世界观词条支持三档可见性：公开（AI 随时可用）、按卷开放（第 N 卷起解锁）、锁定（仅作者可见）。底牌锁住，AI 写「不知情视角」才真实。\n\n## 渐进披露\n伏笔的埋设与揭晓在时间轴上统一管理，到达指定章节自动解锁对应设定，防止 AI 提前剧透。\n\n## 一致性守护\n力量体系、地理、势力格局等核心规则一经确认，AI 生成时严格遵守。检测到正文与世界观冲突时（比如主角用出了尚未学会的功法），实时标黄提醒。\n\n## 模板库\n内置玄幻、都市、科幻、历史等题材的世界观框架模板，新书起步不用从零开始。' },
    'feature-models': { title: '多模型支持', body: '## 可用模型\n平台接入多家主流大模型，按任务特点自由切换：\n- 极速模型（flash 级）：日常章节、批量生成、工具类任务\n- 深度思考模型（pro 级）：大纲设计、高潮章节、复杂多线剧情\n\n## 按模型计费\n不同模型消耗不同积分，生成前明确显示预估消耗，生成后逐条记录。轻度用户每日免费额度足够写 2-3 章。\n\n## 智能推荐\n系统会根据任务类型推荐性价比最高的模型：写章纲用 flash 就够，设计大结局建议上 pro。\n\n## 自定义组合\n多智能体模式下，可以为每个 Agent 单独指定模型——评审员用 pro 挑毛病，写手用 flash 出初稿，兼顾质量与成本。' },
    'feature-imitation': { title: '爆款仿写', body: '## 学文风，不抄内容\n上传你欣赏的文风样本（或从内置的风格库中选择），系统提炼其叙事节奏、句式特征、用词习惯，形成「风格卡」。生成正文时装配风格卡，AI 的输出会贴近目标文风——但情节、人物、设定完全是你自己的。\n\n## 风格库\n内置多种经过验证的网文风格模板：热血爽文流、轻松日常流、悬疑压抑流、古典雅致流等。\n\n## 自我风格养成\n把你自己写得最满意的章节存入风格库，让 AI 学习「你的笔感」。写得越多，AI 越像你。\n\n## 合规边界\n仿写仅提炼抽象的风格特征，不复制受版权保护的具体表达。检测到输出与样本相似度过高时会自动重写。' }
  };

  function initFeaturesPage() {
    if (PAGE !== 'features.html') return;
    Object.keys(FEATURE_DETAILS).forEach(function (id) {
      $all('a[data-dom-id="' + id + '"]').forEach(function (a) {
        a.setAttribute('href', './features.html?f=' + id.replace('feature-', ''));
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var d = FEATURE_DETAILS[id];
          openModal(
            '<span style="display:inline-block;font-size:11px;letter-spacing:.15em;color:#999;text-transform:uppercase;margin-bottom:8px;">核心功能</span>' +
            '<h1 style="font-size:24px;font-weight:700;color:#0a0a0a;margin:0 0 16px;">' + esc(d.title) + '</h1>' +
            mdToHtml(d.body) +
            '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #f0f0f0;display:flex;gap:12px;">' +
            '<a href="./login.html" style="font-size:13px;color:#16a34a;text-decoration:none;">→ 免费注册体验</a>' +
            '<a href="./pricing.html" style="font-size:13px;color:#0a0a0a;text-decoration:none;">→ 查看价格</a></div>', true);
        });
      });
    });
    /* ?f= 直达 */
    var q = new URLSearchParams(location.search).get('f');
    if (q && FEATURE_DETAILS['feature-' + q]) {
      setTimeout(function () {
        var a = $('a[data-dom-id="feature-' + q + '"]');
        if (a) a.click();
      }, 300);
    }
  }

  /* ===================== 7.6 服务条款 / 隐私政策弹窗 ===================== */
  var LEGAL = {
    tos: { title: '服务条款', body: '## 1. 服务说明\n墨阑（由上海欧克安文化传媒有限公司运营）为用户提供 AI 辅助小说创作服务，包括但不限于大纲生成、正文创作、设定管理与免费工具。\n\n## 2. 账号与安全\n用户注册后应妥善保管账号凭据。因用户自身原因导致的账号泄露，平台不承担相应损失。\n\n## 3. 内容权属\n用户通过本平台创作的作品，其著作权归用户本人所有。平台不会将用户的私有作品内容用于模型训练或对外披露。\n\n## 4. 使用规范\n用户不得利用本服务生成违反法律法规的内容。平台有权对违规账号采取警告、限制或封禁措施。\n\n## 5. 积分与订阅\n当前积分为注册赠送额度，充值与订阅功能尚未开放；正式开放后以价格页公示规则为准。\n\n## 6. 服务变更\n平台保留调整功能与资费的权利，重大变更将提前在官网公告。' },
    privacy: { title: '隐私政策', body: '## 1. 我们收集什么\n注册邮箱、登录记录、创作行为数据（用于积分结算与产品优化）。作品正文仅存储于你的账号空间。\n\n## 2. 我们如何使用\n- 提供并改进创作服务\n- 积分结算与账单\n- 安全风控与违规检测\n\n## 3. 我们不会做什么\n- 不出售你的个人信息\n- 不将你的私有作品用于训练公开模型\n- 不向无关第三方披露你的创作内容\n\n## 4. 数据安全\n传输采用 HTTPS 加密，密码经加盐哈希存储，核心数据定期备份。\n\n## 5. 你的权利\n你可以随时导出全部作品、注销账号并要求删除数据。联系 postmaster@maliangwriter.com 处理。' }
  };
  function openLegal(key) {
    var d = LEGAL[key];
    openModal('<h1 style="font-size:22px;font-weight:700;color:#0a0a0a;margin:0 0 16px;">' + esc(d.title) + '</h1>' + mdToHtml(d.body));
  }

  /* ===================== 8. 其余页面补齐 ===================== */
  function initMisc() {
    /* features 页 / pricing 页 CTA 按钮（文本包含「开始」「免费」「立即」的死链按钮） */
    $all('a[href="#"]').forEach(function (a) {
      var t = (a.textContent || '').replace(/\s+/g, '');
      if (/开始创作|立即开始|免费试用|立即体验|免费使用|开始使用|立即订阅/.test(t)) {
        a.setAttribute('href', ROUTES.login);
      }
      if (/查看教程|阅读全文|了解更多/.test(t) && PAGE !== 'docs.html' && PAGE !== 'blog.html') {
        a.setAttribute('href', ROUTES.docs);
      }
    });
    /* 语言切换按钮（登录页）：提示 */
    $all('button[aria-label="切换语言为英文"]').forEach(function (b) {
      b.addEventListener('click', function () { toast('English 版本即将上线，敬请期待'); });
    });

    /* 残留死链的兜底处理（按文本语义补齐） */
    $all('a[href="#"]').forEach(function (a) {
      var t = (a.textContent || '').replace(/\s+/g, ' ').trim();
      /* pricing：深度对比 → 行业观察文章 */
      if (t === '深度对比') { a.setAttribute('href', './blog.html?filter=industry'); return; }
      /* tools：查看说明 → 与同卡片「立即试用」相同的工具工作台 */
      if (t === '查看说明') {
        var card = a.closest('article, div.tool-card, section, div');
        var tryLink = card ? card.querySelector('a[data-tool]') : null;
        if (tryLink) {
          var key = tryLink.getAttribute('data-tool');
          a.setAttribute('href', './tools.html?tool=' + key);
          a.setAttribute('data-tool', key);
        }
        return;
      }
      /* login 公告弹窗：功能直达 → 首页工作台；教程 → 使用文档 */
      if (/^功能直达/.test(t)) { a.setAttribute('href', '../index.html'); return; }
      if (/^教程：/.test(t)) { a.setAttribute('href', './docs.html'); return; }
      /* 服务条款 / 隐私政策 → 弹窗 */
      if (/服务条款|用户协议/.test(t)) {
        a.setAttribute('href', 'javascript:void(0)');
        a.addEventListener('click', function (e) { e.preventDefault(); openLegal('tos'); });
        return;
      }
      if (/隐私政策/.test(t)) {
        a.setAttribute('href', 'javascript:void(0)');
        a.addEventListener('click', function (e) { e.preventDefault(); openLegal('privacy'); });
        return;
      }
      /* login：注册链接（已由 initLoginPage 绑定切换逻辑，仅清理 href） */
      if (t === '注册') { a.setAttribute('href', 'javascript:void(0)'); return; }
    });
  }

  /* ===================== 启动 ===================== */
  function boot() {
    auth.load();
    patchLinks();
    initTheme();
    renderAuthNav();
    initLoginPage();
    initBlogPage();
    initDocsPage();
    initToolsPage();
    initFeaturesPage();
    initMisc();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
