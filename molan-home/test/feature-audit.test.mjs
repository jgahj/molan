import test from 'node:test';
import assert from 'node:assert/strict';
import { auditContracts, evaluateFeatureGate, findUnknownFeatureMarkers, loadAuditSources, scanInteractiveControls } from '../scripts/audit-features.mjs';

test('功能审计加载模块化路由、服务和仓储源码', async () => {
  const sources = await loadAuditSources();
  assert.ok(sources.has('routes/auth.js'));
  assert.ok(sources.has('services/auth-attempt-limiter.js'));
  assert.ok(sources.has('lib/repositories/assert-json-source.js'));
});

test('功能契约区分能力缺失 FAIL 与证据缺失 PARTIAL', () => {
  const contracts = {
    READY: {
      displayName: 'ready',
      ui: true,
      api: true,
      required: ['ui', 'api'],
      evidence: {
        ui: { file: 'pages/editor.html', includes: 'data-feature="READY"' },
        api: { file: 'server.js', includes: '/api/ready' }
      }
    },
    PARTIAL: { displayName: 'partial', ui: true, test: true, required: ['ui', 'test'], evidence: { ui: { file: 'pages/editor.html', includes: 'data-feature="READY"' } } },
    FAIL: { displayName: 'not implemented', ui: false, required: ['ui'], evidence: { ui: { file: 'pages/editor.html', includes: 'missing' } } },
    EMPTY: { displayName: 'empty', ui: true, required: [], evidence: {} }
  };
  const sources = new Map([
    ['pages/editor.html', '<button data-feature="READY">'],
    ['server.js', "route('/api/ready')"]
  ]);
  const results = auditContracts(contracts, sources);
  assert.equal(results[0].status, 'PASS');
  assert.equal(results[1].status, 'PARTIAL');
  assert.deepEqual(results[1].missing, ['evidence:test']);
  assert.equal(results[2].status, 'FAIL');
  assert.deepEqual(results[2].missing, ['capability:ui', 'evidence:ui']);
  assert.equal(results[3].status, 'PARTIAL');
  assert.deepEqual(results[3].missing, ['contract:required', 'contract:untracked-capability:ui']);
});

test('源码中未注册的 data-feature 标记会被识别', () => {
  const unknown = findUnknownFeatureMarkers(new Map([
    ['pages/editor.html', '<button data-feature="READY"></button><a data-feature="MISSING"></a>']
  ]), { READY: {} });
  assert.deepEqual(unknown, ['MISSING']);
});

test('交互控件扫描统计显式动作并列出待审控件', () => {
  const result = scanInteractiveControls(new Map([
    ['pages/workbench.html', '<script src="../completion-editor.js"></script><button data-completion-action="save"></button><input id="query"><button>无动作</button>'],
    ['completion-editor.js', `document.addEventListener('click', event => {
      const action = event.target.closest('[data-completion-action]');
      if (!action) return;
      const name = action.dataset.completionAction;
      if (name === 'save') save();
    });
    document.getElementById("query").addEventListener('input', handleQuery);`],
    ['test/feature-audit.test.mjs', '<button>测试样例</button>']
  ]));
  assert.equal(result.total, 3);
  assert.equal(result.explicit, 2);
  assert.equal(result.unmapped[0].kind, 'button');
});

test('交互控件扫描识别按 ID 分派的文档事件和表单级动态绑定', () => {
  const result = scanInteractiveControls(new Map([
    ['pages/import.html', '<script src="../completion-import.js"></script><input id="resourceSearch"><select id="resourceImportModel"></select><form id="creationPlanForm"><input id="creationTitle"></form>'],
    ['completion-import.js', `function onInput(event) {
      const node = event.target;
      if (node.id === 'resourceSearch') { state.query = node.value; updateResourceImportDom(); }
    }
    function onChange(event) {
      const node = event.target;
      if (node.id === 'resourceImportModel') { state.model = node.value; estimateResourceImport(); }
    }
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onChange, true);
    document.querySelectorAll('#modalBackdrop #creationPlanForm input, #modalBackdrop #creationPlanForm select')
      .forEach(node => node.addEventListener('input', updateEstimate));`]
  ]));
  assert.equal(result.total, 3);
  assert.equal(result.explicit, 3);
  assert.deepEqual(result.unmapped, []);
});

test('委托监听不能替代具体控件分派或对应表单绑定', () => {
  const result = scanInteractiveControls(new Map([
    ['pages/import.html', '<script src="../completion-import.js"></script><input id="unhandled"><form id="creationPlanForm"><input id="unbound"></form>'],
    ['completion-import.js', `function onInput(event) { if (event.target.value) refreshPreview(); }
      document.addEventListener('input', onInput, true);
      document.querySelectorAll('#modalBackdrop #otherForm input').forEach(node => node.addEventListener('input', update));`]
  ]));
  assert.equal(result.unmapped.length, 2);
});

test('扫描器识别模板渲染后绑定的数据控件和明确禁用的控件', () => {
  const result = scanInteractiveControls(new Map([
    ['pages/import.js', `const markup = \`<button class="chip" data-target="creationGenre" data-value="\${value}">题材</button><button id="code-button">获取验证码</button>\`;
      const node = document.createElement('div');
      node.innerHTML = markup;
      node.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
        const target = button.dataset.target;
        const value = button.dataset.value;
        apply(target, value);
      }));
      const codeButton = document.getElementById('code-button');
      codeButton.disabled = true;`]
  ]));
  assert.equal(result.explicit, 2);
  assert.deepEqual(result.unmapped, []);
});

test('动态 data-action 必须穷举并分派所有候选值', () => {
  const result = scanInteractiveControls(new Map([
    ['pages/skills.js', `'<button data-action="' + (withdrawn ? 'republish' : 'withdraw') + '" data-id="' + id + '">状态</button>';
      document.addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (button.dataset.action === 'republish') republish(button.dataset.id);
        else if (button.dataset.action === 'withdraw') withdraw(button.dataset.id);
      });`]
  ]));
  assert.equal(result.explicit, 1);
  const incomplete = scanInteractiveControls(new Map([
    ['pages/skills.js', `'<button data-action="' + action + '">状态</button>';
      document.addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (button.dataset.action === 'withdraw') withdraw();
      });`]
  ]));
  assert.equal(incomplete.unmapped.length, 1);
});

test('扫描器识别 DOM helper 的多变量绑定和父表单提交', () => {
  const result = scanInteractiveControls(new Map([
    ['pages/login.html', '<script src="./site.js"></script><form class="login-form"><input id="email" name="email"></form><button id="copy">复制</button>'],
    ['pages/site.js', `var form = $('.login-form'), email = $('#email'), copy = $('#copy');
      form.addEventListener('submit', event => { event.preventDefault(); submitLogin(email.value); });
      copy.addEventListener('click', copyResult);`]
  ]));
  assert.equal(result.explicit, 2);
  assert.deepEqual(result.unmapped, []);
});

test('扫描器识别 DOM helper 集合回调中的控件绑定', () => {
  const result = scanInteractiveControls(new Map([
    ['pages/login.html', '<script src="./site.js"></script><button class="login-provider">Google</button><form id="loginForm"><input type="email"><input type="password"><button type="submit">登录</button></form><a class="login-terms-tos" href="javascript:void(0)">服务条款</a>'],
    ['pages/site.js', `var form = $('#loginForm');
      form.addEventListener('submit', submitLogin);
      $all('.login-provider').forEach(function (button) {
        button.addEventListener('click', showOAuthNotice);
      });
      $all('a.login-terms-tos').forEach(function (link) {
        link.addEventListener('click', openTerms);
      });`]
  ]));
  assert.equal(result.explicit, 5);
  assert.deepEqual(result.unmapped, []);
});

test('扫描器识别嵌套搜索框、ID 循环绑定和精确属性选择器', () => {
  const result = scanInteractiveControls(new Map([
    ['pages/sample.html', '<script src="./sample.js"></script><div class="search-box"><input id="search"></div><button id="resume"></button><button id="previous"></button><button aria-label="切换主题"></button>'],
    ['pages/sample.js', `document.querySelectorAll('.search-box input').forEach(input => input.addEventListener('input', search));
      for (const action of ['resume']) element(action).addEventListener('click', resume);
      for (const [id, delta] of [['previous', -1]]) element(id).addEventListener('click', move);
      document.querySelectorAll('button[aria-label="切换主题"]').forEach(bind);
      function bind(button) { button.addEventListener('click', toggleTheme); }`]
  ]));
  assert.equal(result.explicit, 4);
  assert.deepEqual(result.unmapped, []);
});

test('扫描器识别由模态确认回调读取的文件和表单控件', () => {
  const result = scanInteractiveControls(new Map([
    ['pages/flow.html', '<script src="../completion-library.js"></script><input id="avatarFile" type="file"><input id="libraryCreateTitle">'],
    ['completion-library.js', `function openCreateModal() { openActionModal({ onConfirm: async function () {
        const file = document.getElementById('avatarFile').files[0];
        const titleNode = document.getElementById('libraryCreateTitle');
        if (!titleNode.value) return false;
      } }); }`]
  ]));
  assert.equal(result.explicit, 2);
  assert.deepEqual(result.unmapped, []);
});

test('重定向到正式工作台的旧编辑器 UI 不计入活动交互控件', () => {
  const result = scanInteractiveControls(new Map([
    ['pages/editor.html', '<button id="legacyAction">旧入口</button>'],
    ['pages/editor.js', '<input class="legacy-option">']
  ]));
  assert.equal(result.excluded, 2);
  assert.deepEqual(result.unmapped, []);
});

test('PARTIAL 契约、未知标记和未映射控件都会关闭总门禁', () => {
  const cleanControls = { unmapped: [] };
  assert.equal(evaluateFeatureGate([{ status: 'PARTIAL' }], [], cleanControls).gate, 'FAIL');
  assert.equal(evaluateFeatureGate([{ status: 'PASS' }], ['UNREGISTERED'], cleanControls).gate, 'FAIL');
  assert.equal(evaluateFeatureGate([{ status: 'PASS' }], [], { unmapped: [{}] }).gate, 'FAIL');
  assert.equal(evaluateFeatureGate([{ status: 'PASS' }], [], cleanControls).gate, 'PASS');
});
