import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const materialSchema = require('../lib/project-material-schema.js');

function materialSample(field) {
  if (field.type === 'reference') return '';
  if (field.type === 'references' || field.type === 'array') return [];
  if (field.type === 'json') return {};
  if (field.type === 'number') return 1;
  if (field.type === 'boolean') return true;
  return `PG验收-${field.path}`;
}

/** 运行 PG 模式真实 HTTP、权限、CAS、资料包恢复烟测。 */
async function main() {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pg-http-'));
  process.env.MOLAN_DATA_DIR = dataDirectory;
  process.env.MOLAN_CONFIG_DIR = dataDirectory;
  process.env.MOLAN_PUBLIC_MODE = '0';
  process.env.MOLAN_LOCAL_ONLY = '1';
  process.env.MOLAN_REQUIRE_SQLITE = '0';
  process.env.MOLAN_DB_BACKEND = 'postgres';
  fs.writeFileSync(path.join(dataDirectory, 'users.json'), '[]', 'utf8');
  // 规划扩展、语义审核和资产重生成走隔离的 OpenAI-compatible stub，避免烟测产生模型费用。
  const modelServer = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let input = {};
      try { input = JSON.parse(body || '{}'); } catch (_) {}
      const prompt = (Array.isArray(input.messages) ? input.messages : [])
        .map(message => String(message && message.content || ''))
        .join('\n');
      let output;
      if (prompt.includes('核心资源扩展') || prompt.includes('资源扩展器')) {
        output = {
          worldbuilding: Array.from({ length: 11 }, (_, index) => ({ category: '地点', name: `新域${index + 1}`, detail: '与潮汐秩序相关的原创场景', function: '制造选择成本' })),
          worldRules: Array.from({ length: 9 }, (_, index) => ({ rule: `潮汐律${index + 1}`, limit: '每次只能改变一项事实', consequence: '承担对应记忆代价', scope: '雾港' })),
          characters: [
            { name: '陆遥', role: '竞争者', goal: '夺回航图', conflict: '不信任阿岚', flaw: '过度谨慎', arc: '从旁观到承担', relationships: ['与阿岚竞争'], voice: { samples: ['先看证据。', '别替我做决定。'], taboo: '绝不承认害怕', habit: '先问后答' }, tell: [{ when: '紧张', how: '反复整理袖口' }], wound: '曾误信盟友', stance: [{ toward: '阿岚', current: '提防', evolution: '并肩' }], emotionStyle: '克制型' },
            { name: '秦川', role: '守门人', goal: '守住旧塔', conflict: '必须选择一方', flaw: '执拗', arc: '学会放手', relationships: ['对阿岚亏欠'], voice: { samples: ['门后没有退路。', '规矩先于人情。'], taboo: '绝不求饶', habit: '说话前摸钥匙' }, tell: [{ when: '犹豫', how: '按住门闩' }], wound: '失去过同伴', stance: [{ toward: '阿岚', current: '亏欠', evolution: '扶持' }], emotionStyle: '克制型' },
            { name: '白芷', role: '线人', goal: '换回自由', conflict: '手里握着假消息', flaw: '习惯试探', arc: '从交易到信任', relationships: ['与顾沉竞争'], voice: { samples: ['消息有价。', '先付代价，再谈答案。'], taboo: '绝不空手见人', habit: '把话说半句' }, tell: [{ when: '说谎', how: '看向门外' }], wound: '被旧契约束缚', stance: [{ toward: '顾沉', current: '竞争', evolution: '互相利用' }], emotionStyle: '转移型' },
            { name: '沈岳', role: '旧友', goal: '修复潮井', conflict: '身体承受反噬', flaw: '逞强', arc: '承认需要帮助', relationships: ['与苏野扶持'], voice: { samples: ['我还能撑。', '别把代价算在别人头上。'], taboo: '绝不示弱', habit: '先检查工具' }, tell: [{ when: '受伤', how: '把手藏到身后' }], wound: '害怕成为累赘', stance: [{ toward: '苏野', current: '扶持', evolution: '托付' }], emotionStyle: '外放型' },
            { name: '林霜', role: '监察者', goal: '找出篡改者', conflict: '证据指向自己', flaw: '过分相信规则', arc: '从执法到追问', relationships: ['与陆遥提防'], voice: { samples: ['记录不会替你辩护。', '事实要经得起第二次查看。'], taboo: '绝不销毁证据', habit: '逐字复述口供' }, tell: [{ when: '动摇', how: '合上记录册' }], wound: '曾替错误签字', stance: [{ toward: '陆遥', current: '提防', evolution: '合作' }], emotionStyle: '克制型' },
            { name: '周岑', role: '商人', goal: '买下旧塔', conflict: '无法承担公开代价', flaw: '把人情当筹码', arc: '第一次守约', relationships: ['与秦川亏欠'], voice: { samples: ['价钱可以再谈。', '我只认最后的结果。'], taboo: '绝不免费帮忙', habit: '用指节敲桌面' }, tell: [{ when: '心虚', how: '清点袖中筹码' }], wound: '害怕失去掌控', stance: [{ toward: '秦川', current: '亏欠', evolution: '交易' }], emotionStyle: '转移型' }
          ],
          characterLibrary: ['陆遥', '秦川', '白芷', '沈岳', '林霜', '周岑', '韩策'].map(name => ({ name, role: '原创配角', goal: '完成个人目标', flaw: '有明确限制', arc: '在选择中改变', relationships: ['与主角存在张力'] })),
          map: { nodes: [
            { id: 'new-harbor', name: '新港', parentId: '', type: '地点', detail: '潮线交汇处', function: '提供路线选择' },
            { id: 'salt-market', name: '盐市', parentId: 'new-harbor', type: '地点', detail: '消息交换地', function: '制造交易' },
            { id: 'watch-house', name: '望潮楼', parentId: 'new-harbor', type: '地点', detail: '监察站', function: '暴露证据' },
            { id: 'deep-well', name: '深井', parentId: 'new-harbor', type: '地点', detail: '规则源头', function: '触发代价' },
            { id: 'north-gate', name: '北门', parentId: 'new-harbor', type: '地点', detail: '封锁线', function: '阻挡退路' },
            { id: 'tide-archive', name: '潮档', parentId: 'new-harbor', type: '地点', detail: '记录代价的档案室', function: '提供证据' }
          ], edges: [{ source: 'new-harbor', target: 'salt-market', relation: '通向' }] },
          relationships: [
            { from: '阿岚', to: '陆遥', type: '竞争', change: '共同目标迫使二人暂时合作' },
            { from: '顾沉', to: '秦川', type: '提防', change: '钥匙归属成为冲突' },
            { from: '苏野', to: '白芷', type: '亏欠', change: '旧账换来假消息' },
            { from: '阿岚', to: '沈岳', type: '扶持', change: '共同承担反噬' },
            { from: '陆遥', to: '林霜', type: '提防', change: '证据互相指向' }
          ],
          volumePlan: [{ volume: 1, title: '潮线卷', purpose: '建立规则与代价', goal: '找到潮汐律源头', turningPoint: '旧塔钥匙现世', endingHook: '深井开始回声', chapterRange: '1-1' }],
          architecture: { volumes: [{ title: '潮线卷', purpose: '建立规则与代价', goal: '找到潮汐律源头', turningPoint: '旧塔钥匙现世', endingHook: '深井开始回声', chapterRange: '1-1' }] },
          storyTree: [{ node: '找到钥匙', parent: '', goal: '确认旧塔入口', conflict: '守门人拒绝', result: '拿到半枚钥匙', chapterRange: '1' }, { node: '验证潮汐律', parent: '找到钥匙', goal: '确认代价', conflict: '记忆被扣除', result: '打开深井', chapterRange: '1' }],
          conflictChain: [{ stage: 1, source: '旧塔封锁', pressure: '潮水上涨', choice: '交出罗盘', cost: '失去一段记忆', chapterRange: '1' }],
          rewardChain: [{ stage: 1, setup: '罗盘指向暗门', payoff: '主角获得入口', cost: '承担潮汐反噬', chapterRange: '1' }],
          arcPlan: [{ arc: 1, title: '旧塔入口', goal: '打开暗门', opposition: '守门规则', turn: '钥匙属于主角', payoff: '获得深井线索', chapterRange: '1-1' }],
          foreshadowLedger: Array.from({ length: 7 }, (_, index) => ({ id: `pg-f${index + 1}`, plantIn: 1, payoffIn: 1, desc: `潮线伏笔${index + 1}`, strength: 'medium', status: 'planned' }))
        };
      } else if (prompt.includes('分批章纲扩展') || prompt.includes('章纲扩展器')) {
        output = { chapters: [{ chapterNo: 1, title: '旧塔的半枚钥匙', synopsis: '阿岚在潮水上涨前追查钥匙来源。', goal: '确认旧塔入口的真实规则', protagonistAction: '阿岚主动把罗盘交给顾沉并进入旧塔', opposition: '秦川封锁入口且潮水持续上涨', informationChange: '阿岚确认罗盘会吞掉一段记忆', result: '半枚钥匙嵌入罗盘，入口被迫开启', hook: '门后传来与阿岚相同的脚步声', hookType: '悬念', emotionIntensity: 8, payoffGap: 0, line: '主线', characterStateChanges: [], foreshadowActions: [] }] };
      } else if (prompt.includes('多层审核器') || prompt.includes('规划审核')) {
        output = { status: 'passed', summary: '隔离模型确认规划结构完整且原创性门禁通过。', issues: [], patches: [], layers: ['structure', 'worldbuilding', 'characters', 'mainline', 'conflict', 'reward', 'chapter', 'originality'].map(layer => ({ layer, status: 'passed', issues: [] })) };
      } else if (prompt.includes('人物「') || prompt.includes('人物卡必须包含演绎层')) {
        output = { character: { name: '阿岚', role: '主角', goal: '确认潮汐律的代价', conflict: '每次使用罗盘都会失去一段记忆', flaw: '不愿向同伴求助', arc: '从独自承担到主动托付', relationships: ['与顾沉互相试探'], voice: { samples: ['先把门打开。', '代价我来记。'], taboo: '绝不承认害怕', habit: '先确认出口再行动' }, tell: [{ when: '隐瞒情绪', how: '把罗盘攥得发白' }], wound: '曾因迟疑失去同伴', stance: [{ toward: '顾沉', current: '试探', evolution: '托付' }], emotionStyle: '克制型' } };
      } else if (prompt.includes('世界规则数组') || prompt.includes('输出格式：{"worldRules"')) {
        output = { worldRules: [{ rule: '潮汐律只允许改变已被记录的事实', limit: '每次只能改变一项', consequence: '使用者失去一段相关记忆', scope: '雾港及其潮线范围' }, { rule: '暗门只能由持有半枚钥匙者开启', limit: '钥匙不能转交', consequence: '强行转交会让入口移位', scope: '旧塔' }] };
      } else {
        output = { ok: true };
      }
      const content = JSON.stringify(output);
      const usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, creditCost: 0, requestId: `pg-http-stub-${Date.now()}`, status: 'completed' };
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: ${JSON.stringify({ choices: [], molan_usage: usage })}\n\ndata: [DONE]\n\n`);
    });
  });
  const modelPort = await new Promise((resolve, reject) => {
    modelServer.once('error', reject);
    modelServer.listen(0, '127.0.0.1', () => resolve(modelServer.address().port));
  });
  const appPortProbe = http.createServer();
  const appPort = await new Promise((resolve, reject) => {
    appPortProbe.once('error', reject);
    appPortProbe.listen(0, '127.0.0.1', () => resolve(appPortProbe.address().port));
  });
  await new Promise(resolve => appPortProbe.close(resolve));
  process.env.PORT = String(appPort);
  fs.writeFileSync(path.join(dataDirectory, 'config.json'), JSON.stringify({
    platformModels: [{ id: 'local-test-model', model: 'local-test-model', provider: 'openai-compat', apiKey: 'pg-http-smoke', baseURL: `http://127.0.0.1:${modelPort}/v1` }],
    modelPolicy: { defaultModel: 'local-test-model' }
  }), 'utf8');
  const app = require('../server.js');
  const projectScope = require('../lib/project-scope.js');
  const userA = { email: `pg-http-a-${Date.now()}@example.com`, name: 'PG作者', role: 'normal', level: 'normal', plan: 'normal', credits: 100, spent: 0 };
  const userB = { email: `pg-http-b-${Date.now()}@example.com`, name: 'PG协作者', role: 'normal', level: 'normal', plan: 'normal', credits: 100, spent: 0 };
  app.initDB();
  await app.initializePostgresRuntime();
  const savedUserA = app.saveUser(userA) || userA;
  const savedUserB = app.saveUser(userB) || userB;
  await Promise.all([savedUserA.__postgresWrite, savedUserB.__postgresWrite].filter(Boolean));
  const tokenA = crypto.randomBytes(32).toString('hex');
  const tokenB = crypto.randomBytes(32).toString('hex');
  const actorA = savedUserA.userId || projectScope.stableUserId(userA.email);
  const actorB = savedUserB.userId || projectScope.stableUserId(userB.email);
  app.sessions.set(app.hashSessionToken(tokenA), { email: userA.email, userId: actorA, scope: 'client', expiresAt: Date.now() + 600000 });
  app.sessions.set(app.hashSessionToken(tokenB), { email: userB.email, userId: actorB, scope: 'client', expiresAt: Date.now() + 600000 });
  const port = await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(appPort, '127.0.0.1', () => resolve(app.server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;
  const request = (pathname, token, options = {}) => fetch(base + pathname, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const novelId = `n_pght${Date.now().toString(36)}`;
  const state = {
    title: 'PG HTTP作品',
    volumes: [{ id: 'volume-1', title: '第一卷', chapters: [{
      id: 'chapter-memory', title: '记忆验收章', scenes: [{
        id: 'scene-memory', name: '雾港', content: '旧稿正文。'
      }]
    }] }],
    creationAssets: { timeline: [{ id: 'time-1', storyDate: '新历一日' }] }
  };
  try {
    const createdResponse = await request('/api/novels', tokenA, {
      method: 'POST',
      body: JSON.stringify({ id: novelId, title: state.title, state })
    });
    const created = await createdResponse.json();
    if (!created.ok || created.revision !== 1) throw new Error('HTTP创建作品失败：' + JSON.stringify({ status: createdResponse.status, body: created }));
    if ((await request(`/api/novels/${novelId}`, tokenB)).status !== 404) throw new Error('未授权 HTTP 读取未被拒绝');
    const workspaces = await (await request('/api/workspaces', tokenA)).json();
    const workspaceId = workspaces.workspaces[0] && workspaces.workspaces[0].id;
    if (!workspaceId) throw new Error('HTTP工作区未创建');
    const addedWorkspaceMember = await (await request(`/api/workspaces/${workspaceId}/members`, tokenA, {
      method: 'POST',
      body: JSON.stringify({ email: userB.email, role: 'member' })
    })).json();
    if (!addedWorkspaceMember.ok) throw new Error('HTTP工作区成员授权失败');
    const addedProjectMember = await (await request(`/api/workspaces/${workspaceId}/projects/${novelId}/members`, tokenA, {
      method: 'POST',
      body: JSON.stringify({ email: userB.email, role: 'editor' })
    })).json();
    if (!addedProjectMember.ok) throw new Error('HTTP项目成员授权失败');
    const shared = await (await request(`/api/novels/${novelId}`, tokenB)).json();
    if (!shared.ok || shared.novel.scope.role !== 'editor') throw new Error('HTTP协作者读取失败');
    const changedState = { ...shared.novel.state, title: 'PG协作者保存' };
    const changedResponse = await request(`/api/novels/${novelId}`, tokenB, {
      method: 'PUT',
      body: JSON.stringify({ state: changedState, title: changedState.title, revision: shared.novel.revision })
    });
    const changed = await changedResponse.json();
    if (!changed.ok || changed.revision !== 2) throw new Error('HTTP协作者CAS保存失败：' + JSON.stringify({ status: changedResponse.status, body: changed, sharedRevision: shared.novel.revision }));
    if ((await request(`/api/novels/${novelId}`, tokenA, {
      method: 'PUT',
      body: JSON.stringify({ state, title: state.title, revision: 1 })
    })).status !== 412) throw new Error('HTTP过期作品版本未被拒绝');
    const beforeCharacterImport = await (await request(`/api/novels/${novelId}`, tokenA)).json();
    const characterImport = {
      revision: beforeCharacterImport.novel.revision,
      characters: [{ name: '拆书导入验收角色', function: '守门', goal: '保住钥匙', conflict: '不信任主角', arc: '从拒绝到合作' }]
    };
    const characterImportResponse = await request(`/api/novels/${novelId}/import-characters`, tokenA, {
      method: 'POST', body: JSON.stringify(characterImport)
    });
    const characterImportResult = await characterImportResponse.json();
    if (!characterImportResult.ok || characterImportResult.added !== 1 ||
        characterImportResult.revision !== beforeCharacterImport.novel.revision + 1) {
      throw new Error('HTTP PG拆书角色导入失败：' + JSON.stringify({ status: characterImportResponse.status, body: characterImportResult }));
    }
    const importedNovel = await (await request(`/api/novels/${novelId}`, tokenA)).json();
    const importedEntityId = 'ent_' + crypto.createHash('sha1').update(novelId + '|拆书导入验收角色').digest('hex').slice(0, 14);
    if (!importedNovel.ok || !importedNovel.novel.state.knowledge.entities[importedEntityId]) {
      throw new Error('HTTP PG拆书角色导入未持久化到作品 state');
    }
    const staleCharacterImport = await request(`/api/novels/${novelId}/import-characters`, tokenA, {
      method: 'POST', body: JSON.stringify(characterImport)
    });
    if (staleCharacterImport.status !== 412) throw new Error('HTTP PG拆书角色导入未拒绝过期版本');
    const resource = await (await request(`/api/novels/${novelId}/resources/character`, tokenA, {
      method: 'POST',
      body: JSON.stringify({ id: 'character-http-pg', payload: { name: 'HTTP角色', age: 1 } })
    })).json();
    if (!resource.ok) throw new Error('HTTP资料创建失败');
    const resourceReadResponse = await request(`/api/novels/${novelId}/resources/character/character-http-pg`, tokenB);
    const resourceRead = await resourceReadResponse.json();
    const resourceUpdated = await (await request(`/api/novels/${novelId}/resources/character/character-http-pg`, tokenB, {
      method: 'PATCH',
      headers: { 'If-Match': resourceReadResponse.headers.get('etag') },
      body: JSON.stringify({ payload: { name: 'HTTP角色', age: 2 } })
    })).json();
    if (!resourceUpdated.ok || resourceUpdated.resource.revision !== 2) throw new Error('HTTP资料CAS更新失败');
    const packageValue = await (await request(`/api/novels/${novelId}/package`, tokenA)).json();
    if (!packageValue.ok) throw new Error('HTTP资料包导出失败');
    const novelAfterUpdate = await (await request(`/api/novels/${novelId}`, tokenA)).json();
    const changedAgain = await (await request(`/api/novels/${novelId}/resources/character/character-http-pg`, tokenB, {
      method: 'PATCH',
      headers: { 'If-Match': resourceUpdated.resource.etag },
      body: JSON.stringify({ payload: { name: 'HTTP角色', age: 3 } })
    })).json();
    if (!changedAgain.ok) throw new Error('HTTP资料二次更新失败');
    const restoredPackage = await (await request(`/api/novels/${novelId}/package/restore`, tokenA, {
      method: 'POST',
      body: JSON.stringify({ revision: novelAfterUpdate.novel.revision, package: packageValue.package })
    })).json();
    if (!restoredPackage.ok) throw new Error('HTTP资料包恢复失败');
    const restoredResource = await (await request(`/api/novels/${novelId}/resources/character/character-http-pg`, tokenB)).json();
    if (restoredResource.resource.payload.age !== 2) throw new Error('HTTP资料包恢复未回滚资料');

    for (const requirement of materialSchema.requirements) {
      const resourceId = `pg49_${requirement.id.toLowerCase()}_${Date.now().toString(36)}`;
      const resourcePath = `/api/novels/${novelId}/resources/${encodeURIComponent(requirement.kind)}`;
      const requirementData = Object.fromEntries(requirement.fields.map(field => [field.path, materialSample(field)]));
      const payload = { requirementIds: [requirement.id], requirementData };
      const createResponse = await request(resourcePath, tokenA, {
        method: 'POST', body: JSON.stringify({ id: resourceId, payload })
      });
      const createdRequirement = await createResponse.json();
      if (createResponse.status !== 201 || !createdRequirement.ok) {
        throw new Error(`PG ${requirement.id} 资料创建失败：${JSON.stringify({ status: createResponse.status, body: createdRequirement })}`);
      }
      const encodedResource = `${resourcePath}/${encodeURIComponent(resourceId)}?workspaceId=${encodeURIComponent(workspaceId)}`;
      const readResponse = await request(encodedResource, tokenB);
      const reopenedRequirement = await readResponse.json();
      if (readResponse.status !== 200 || !reopenedRequirement.ok) throw new Error(`PG ${requirement.id} 资料读取失败`);
      assert.deepEqual(reopenedRequirement.resource.payload, payload, `PG ${requirement.id} payload roundtrip`);
      const changedPayload = {
        ...reopenedRequirement.resource.payload,
        requirementData: { ...requirementData, 'extensions.pgAcceptanceUpdated': requirement.id }
      };
      const updateResponse = await request(encodedResource, tokenB, {
        method: 'PATCH', headers: { 'If-Match': readResponse.headers.get('etag') },
        body: JSON.stringify({ payload: changedPayload })
      });
      const updatedRequirement = await updateResponse.json();
      if (!updatedRequirement.ok || updatedRequirement.resource.revision !== 2) throw new Error(`PG ${requirement.id} CAS更新失败`);
      if (requirement.id === 'A01') {
        const staleResponse = await request(encodedResource, tokenB, {
          method: 'PATCH', headers: { 'If-Match': readResponse.headers.get('etag') },
          body: JSON.stringify({ payload })
        });
        if (staleResponse.status !== 412) throw new Error('PG资料旧ETag未被拒绝');
      }
      const historyResponse = await request(`${resourcePath}/${encodeURIComponent(resourceId)}/history?workspaceId=${encodeURIComponent(workspaceId)}`, tokenB);
      const history = await historyResponse.json();
      assert.deepEqual((history.versions || []).map(version => version.revision), [2, 1], `PG ${requirement.id} version history`);
      assert.deepEqual(history.versions[0].payload.requirementData, changedPayload.requirementData, `PG ${requirement.id} history payload`);
    }

    const creationBookId = `cb_pght${Date.now().toString(36)}`;
    const biblePayload = {
      creationPlan: { totalChapters: 1 },
      mainline: { premise: '阿岚追查潮汐律的代价', goal: '找出旧塔钥匙的真相', escalation: '每次使用罗盘都会失去一段记忆', endingPromise: '真相必须以主动承担代价换来' },
      characters: [{ name: '阿岚' }, { name: '顾沉' }, { name: '苏野' }],
      map: { nodes: [{ name: '雾港' }, { name: '旧塔' }, { name: '潮井' }] },
      goldenFinger: { type: '潮汐罗盘' },
      chapterPlan: [],
      scenePlan: [{ chapterNo: 1, sceneNo: 1, purpose: '发现旧塔线索', viewpoint: '阿岚', goal: '确认钥匙来源', conflict: '守门规则阻止进入', turn: '罗盘指向暗门', exitHook: '门后传来相同的脚步声' }]
    };
    const creation = await (await request('/api/creation-books', tokenA, {
      method: 'POST',
      body: JSON.stringify({ creationBookId, title: 'PG创作书', novelId, bible: biblePayload, plan: { totalChapters: 1 } })
    })).json();
    if (!creation.ok || !creation.book || !creation.bible) throw new Error('HTTP PG创作书创建失败');
    const creationBible = await (await request(`/api/creation-books/${creationBookId}/bible`, tokenA)).json();
    if (!creationBible.ok || creationBible.bible.version !== 1) throw new Error('HTTP PG创作书Bible读取失败');
    const changedBible = { ...creationBible.bible.payload, chapterPlan: [{ chapterNo: 1, goal: '完成真实PG创作闭环' }] };
    const savedBible = await (await request(`/api/creation-books/${creationBookId}/bible`, tokenA, {
      method: 'PUT',
      body: JSON.stringify({ bible: changedBible, bibleVersion: creationBible.bible.version })
    })).json();
    if (!savedBible.ok || savedBible.bibleVersion !== 2) throw new Error('HTTP PG创作书Bible更新失败');
    const planResourcesResponse = await request(`/api/creation-books/${creationBookId}/plan-expand`, tokenA, {
      method: 'POST', body: JSON.stringify({ baseBibleVersion: savedBible.bibleVersion, modelId: 'local-test-model', batchSize: 20 })
    });
    const planResources = await planResourcesResponse.json();
    if (planResourcesResponse.status === 503 || !planResources.ok || planResources.phase !== 'resources') {
      throw new Error(`HTTP PG规划资源扩展失败：${JSON.stringify({ status: planResourcesResponse.status, body: planResources })}`);
    }
    const planChaptersResponse = await request(`/api/creation-books/${creationBookId}/plan-expand`, tokenA, {
      method: 'POST', body: JSON.stringify({ baseBibleVersion: planResources.bible.version, modelId: 'local-test-model', batchSize: 20 })
    });
    const planChapters = await planChaptersResponse.json();
    if (planChaptersResponse.status === 503 || !planChapters.ok || planChapters.phase !== 'chapters' || !planChapters.done) {
      throw new Error(`HTTP PG章纲扩展失败：${JSON.stringify({ status: planChaptersResponse.status, body: planChapters })}`);
    }
    const planReviewResponse = await request(`/api/creation-books/${creationBookId}/plan-review`, tokenA, {
      method: 'POST', body: JSON.stringify({ baseVersion: planChapters.bible.version, modelId: 'local-test-model', autoRevise: false })
    });
    const planReview = await planReviewResponse.json();
    if (planReviewResponse.status === 503 || !planReview.ok || !planReview.review || planReview.review.status !== 'passed') {
      throw new Error(`HTTP PG规划审核失败：${JSON.stringify({ status: planReviewResponse.status, body: planReview })}`);
    }
    const regenerateCharacterResponse = await request(`/api/creation-books/${creationBookId}/regenerate-asset`, tokenA, {
      method: 'POST', body: JSON.stringify({ asset: 'characters', name: '阿岚', modelId: 'local-test-model', guidance: '保持既有因果与人物关系' })
    });
    const regeneratedCharacter = await regenerateCharacterResponse.json();
    if (regenerateCharacterResponse.status === 503 || !regeneratedCharacter.ok || regeneratedCharacter.asset !== 'characters') {
      throw new Error(`HTTP PG人物资产重生成失败：${JSON.stringify({ status: regenerateCharacterResponse.status, body: regeneratedCharacter })}`);
    }
    const regenerateRulesResponse = await request(`/api/creation-books/${creationBookId}/regenerate-asset`, tokenA, {
      method: 'POST', body: JSON.stringify({ asset: 'worldRules', modelId: 'local-test-model', guidance: '规则必须带限制、后果和适用范围' })
    });
    const regeneratedRules = await regenerateRulesResponse.json();
    if (regenerateRulesResponse.status === 503 || !regeneratedRules.ok || regeneratedRules.asset !== 'worldRules') {
      throw new Error(`HTTP PG世界规则重生成失败：${JSON.stringify({ status: regenerateRulesResponse.status, body: regeneratedRules })}`);
    }

    const linkBookId = `cb_pght_link${Date.now().toString(36)}`;
    const linkBook = await (await request('/api/creation-books', tokenA, {
      method: 'POST', body: JSON.stringify({ creationBookId: linkBookId, title: 'PG待关联创作书', bible: {
        creationPlan: { totalChapters: 1 }, characters: [{ name: '连星' }, { name: '方舟' }, { name: '冷月' }],
        map: { nodes: [{ name: '河口' }, { name: '石门' }, { name: '灯塔' }] }, goldenFinger: { type: '回声尺' }
      }, plan: { totalChapters: 1 } })
    })).json();
    if (!linkBook.ok) throw new Error('HTTP PG待关联创作书创建失败');
    const linkedBook = await (await request(`/api/creation-books/${linkBookId}/link-novel`, tokenA, {
      method: 'POST', body: JSON.stringify({ novelId })
    })).json();
    if (!linkedBook.ok || !linkedBook.book || linkedBook.book.projectId !== novelId) throw new Error('HTTP PG创作书关联小说失败');

    const debtId = `debt_pght${Date.now().toString(36)}`;
    const createdDebt = await (await request(`/api/causal-debts/${creationBookId}`, tokenA, {
      method: 'POST', body: JSON.stringify({ id: debtId, originChapter: 1, type: 'arc', debtCategory: 'contractual', seed: '阿岚欠下旧塔一份承诺，必须在潮水上涨前归还钥匙。', immediateCost: '失去一次撤退机会', maturationChapter: 2 })
    })).json();
    if (!createdDebt.ok || !createdDebt.debt || createdDebt.debt.id !== debtId) throw new Error('HTTP PG因果债务创建失败');
    const debtRead = await (await request(`/api/causal-debts/${creationBookId}?chapterNo=1`, tokenA)).json();
    if (!debtRead.ok || !debtRead.active.some(debt => debt.id === debtId)) throw new Error('HTTP PG因果债务读取失败');
    const debtExtract = await (await request(`/api/causal-debts/${creationBookId}/extract`, tokenA, {
      method: 'POST', body: JSON.stringify({ chapterNo: 1, text: '“我记下这笔代价，等我回来。”他欠下三两银子，路引被扣。' })
    })).json();
    if (!debtExtract.ok || debtExtract.count < 1) throw new Error('HTTP PG因果债务提取失败');
    const settledDebt = await (await request(`/api/causal-debts/${creationBookId}/settle`, tokenA, {
      method: 'POST', body: JSON.stringify({ debtId, reason: '阿岚在旧塔归还钥匙并承担后果' })
    })).json();
    if (!settledDebt.ok || !settledDebt.debt || settledDebt.debt.status !== 'settled') throw new Error('HTTP PG因果债务平账失败');

    const contract = await (await request(`/api/creation-books/${creationBookId}/chapter-contract`, tokenA, {
      method: 'POST',
      body: JSON.stringify({ chapterNo: 1, prompt: '让主角验证潮汐罗盘并承担代价' })
    })).json();
    if (!contract.ok || !contract.contract) throw new Error('HTTP PG章节合同生成失败');
    const chapterContent = '潮汐罗盘在雾港旧塔下发出微光，阿岚必须在潮水上涨前作出选择。';
    const chapterHash = crypto.createHash('sha256').update(chapterContent, 'utf8').digest('hex');
    const audit = await (await request(`/api/creation-books/${creationBookId}/audit`, tokenA, {
      method: 'POST',
      body: JSON.stringify({ chapterNo: 1, content: chapterContent, contentHash: chapterHash })
    })).json();
    if (!audit.ok || audit.status !== 'passed') throw new Error('HTTP PG章节审计失败');
    const committed = await (await request(`/api/creation-books/${creationBookId}/commit`, tokenA, {
      method: 'POST',
      body: JSON.stringify({ chapterNo: 1, content: chapterContent, contentHash: chapterHash, auditId: audit.auditId, baseStateVersion: 0 })
    })).json();
    if (!committed.ok || committed.stateVersion !== 1) throw new Error('HTTP PG章节提交失败');
    const creationStateResponse = await request(`/api/creation-books/${creationBookId}/state`, tokenA);
    const creationState = await creationStateResponse.json();
    if (!creationState.ok || !Array.isArray(creationState.snapshots) || creationState.snapshots.length !== 1) {
      throw new Error('HTTP PG状态快照读取失败：' + JSON.stringify({ status: creationStateResponse.status, body: creationState }));
    }
    const creationPackage = await (await request(`/api/novels/${novelId}/package`, tokenA)).json();
    const creationAssetFile = creationPackage.package && Object.values(creationPackage.package.files || {}).find(file => {
      try {
        const content = JSON.parse(String(file && file.content || '{}'));
        return content && content.creationData && Array.isArray(content.creationData.books);
      } catch (_) {
        return false;
      }
    });
    if (!creationPackage.ok || !creationAssetFile) throw new Error('HTTP PG导出未包含创作域版本');
    const creationPackageProfile = await (await request(`/api/novels/${novelId}`, tokenA)).json();
    const creationPackageRestoreResponse = await request(`/api/novels/${novelId}/package/restore`, tokenA, {
      method: 'POST',
      body: JSON.stringify({ revision: creationPackageProfile.novel.revision, package: creationPackage.package })
    });
    const creationPackageRestored = await creationPackageRestoreResponse.json();
    if (!creationPackageRestored.ok) {
      throw new Error('HTTP PG创作域恢复失败：' + JSON.stringify({ status: creationPackageRestoreResponse.status, body: creationPackageRestored }));
    }

    const memoryWorkbenchResponse = await request(`/api/books/${creationBookId}/workbench`, tokenA);
    const memoryWorkbench = await memoryWorkbenchResponse.json();
    if (!memoryWorkbench.ok || !memoryWorkbench.chapters.some(chapter => chapter.chapterId === 'chapter-memory')) {
      throw new Error('PG记忆工作台未读取创作书章节');
    }
    const manuscriptText = '阿岚将潮汐罗盘交给顾沉。顾沉说：“雾港暗门已经开启。”';
    const manuscriptResponse = await request(`/api/books/${creationBookId}/manuscripts`, tokenA, {
      method: 'POST',
      body: JSON.stringify({
        chapterId: 'chapter-memory', sceneId: 'scene-memory', text: manuscriptText,
        expectedRevision: 0, expectedNovelRevision: memoryWorkbench.novelRevision
      })
    });
    const manuscriptResult = await manuscriptResponse.json();
    if (manuscriptResponse.status !== 201 || !manuscriptResult.manuscript) {
      throw new Error(`PG正文候选保存失败：${JSON.stringify({ status: manuscriptResponse.status, body: manuscriptResult })}`);
    }
    const extractResponse = await request(`/api/books/${creationBookId}/memory/extract`, tokenA, {
      method: 'POST', body: JSON.stringify({ manuscriptRevisionId: manuscriptResult.manuscript.id })
    });
    const extracted = await extractResponse.json();
    if (!extracted.ok || !extracted.propositions.length || !extracted.evidence.length) throw new Error('PG正文记忆抽取未落库');
    const rewriteResponse = await request(`/api/books/${creationBookId}/rewrite`, tokenA, {
      method: 'POST', body: JSON.stringify({
        manuscriptRevisionId: manuscriptResult.manuscript.id,
        contract: { lockedPropositions: ['阿岚将潮汐罗盘交给顾沉'], allowedChanges: [] }
      })
    });
    const rewrite = await rewriteResponse.json();
    if (!rewrite.ok || !rewrite.compliant || !rewrite.review || rewrite.review.passed !== true) throw new Error('PG改写合同复核失败');
    const changesetResponse = await request(`/api/books/${creationBookId}/memory/changesets`, tokenA, {
      method: 'POST',
      body: JSON.stringify({
        manuscriptRevisionId: manuscriptResult.manuscript.id,
        rewriteReviewId: rewrite.review.id,
        operations: [{ type: 'INSERT_FACT', payload: {
          id: 'fact_pg_http_smoke', propositionId: extracted.propositions[0].id,
          verdict: 'true', status: 'confirmed', decisionReason: '隔离 PostgreSQL HTTP 验收'
        } }]
      })
    });
    const changesetResult = await changesetResponse.json();
    if (changesetResponse.status !== 201 || !changesetResult.changeset) {
      throw new Error(`PG记忆变更集创建失败：${JSON.stringify({ status: changesetResponse.status, body: changesetResult })}`);
    }
    const approvalResponse = await request(`/api/books/${creationBookId}/memory/changesets/${changesetResult.changeset.id}/approve`, tokenA, {
      method: 'POST', body: JSON.stringify({ status: 'approved' })
    });
    if (!(await approvalResponse.json()).ok) throw new Error('PG记忆变更集审批失败');
    const commitResponse = await request(`/api/books/${creationBookId}/memory/changesets/${changesetResult.changeset.id}/commit`, tokenA, {
      method: 'POST', headers: { 'Idempotency-Key': `pg-http-memory-${creationBookId}` }, body: JSON.stringify({})
    });
    const memoryCommit = await commitResponse.json();
    if (!memoryCommit.ok || memoryCommit.stateVersion !== 2) {
      throw new Error(`PG记忆正式提交失败：${JSON.stringify({ status: commitResponse.status, body: memoryCommit })}`);
    }
    const memoryRead = await (await request(`/api/books/${creationBookId}/memory`, tokenA)).json();
    if (!memoryRead.ok || !memoryRead.memory.some(record => record.id === 'fact_pg_http_smoke')) throw new Error('PG记忆事实未跨请求持久化');
    const evidenceRead = await (await request(`/api/books/${creationBookId}/memory/records?type=evidence`, tokenA)).json();
    if (!evidenceRead.ok || !evidenceRead.records.length) throw new Error('PG记忆证据未跨请求持久化');
    const projectionResponse = await request(`/api/books/${creationBookId}/projections/process`, tokenA, {
      method: 'POST', body: JSON.stringify({ branchId: 'main' })
    });
    const projection = await projectionResponse.json();
    if (!projection.ok || !projection.projections.synced) throw new Error('PG记忆投影未同步');

    const styleCreateResponse = await request(`/api/books/${creationBookId}/styles`, tokenA, {
      method: 'POST', body: JSON.stringify({
        name: 'PG隔离文风', level: 'novel_narrative', hardRules: ['第三人称限知'],
        positiveSamples: ['阿岚把罗盘收入袖中。'], checkRules: { forbiddenTerms: ['恐怖如斯'] }
      })
    });
    const styleCreated = await styleCreateResponse.json();
    if (!styleCreated.ok || styleCreated.revision !== 1) throw new Error('PG文风档案创建失败');
    const styleUpdateResponse = await request(`/api/books/${creationBookId}/styles`, tokenA, {
      method: 'POST', body: JSON.stringify({
        id: styleCreated.id, expectedRevision: 1, name: 'PG隔离文风', level: 'novel_narrative',
        hardRules: ['第三人称限知', '不解释已呈现动作'],
        positiveSamples: ['顾沉没有回答，只把门闩推回原位。'], checkRules: { forbiddenTerms: ['恐怖如斯'] }
      })
    });
    const styleUpdated = await styleUpdateResponse.json();
    if (!styleUpdated.ok || styleUpdated.revision !== 2) throw new Error('PG文风版本更新失败');
    const stylesRead = await (await request(`/api/books/${creationBookId}/styles`, tokenA)).json();
    const persistedStyle = (stylesRead.styles || []).find(style => style.id === styleCreated.id);
    if (!persistedStyle || persistedStyle.revision !== 2 || persistedStyle.positiveSamples[0] !== '顾沉没有回答，只把门闩推回原位。') {
      throw new Error('PG文风档案未跨请求持久化');
    }
    const styleAudit = await (await request(`/api/books/${creationBookId}/style-audits`, tokenA, {
      method: 'POST', body: JSON.stringify({ text: '顾沉没有回答，只把门闩推回原位。' })
    })).json();
    if (!styleAudit.ok || !styleAudit.audit.styleVersions.some(version => version.id === styleCreated.id && version.revision === 2)) {
      throw new Error('PG文风审计未读取最新版本');
    }

    const coreJobId = `cj_pght_core_${Date.now().toString(36)}`;
    const coreJobResponse = await request('/api/creation-books/core-jobs', tokenA, {
      method: 'POST',
      body: JSON.stringify({
        creationRequestId: `cb_pght_core_${Date.now().toString(36)}`,
        novelId,
        title: 'PG持久创书任务',
        genre: '本地测试',
        plan: { totalChapters: 1 },
        providerMode: 'local-stub',
        system: '只在本地 worker stub 中处理',
        userPrompt: '验证任务输入持久化和租约恢复'
      }),
      headers: { 'Idempotency-Key': coreJobId }
    });
    const coreJob = await coreJobResponse.json();
    if (coreJobResponse.status !== 202 || !coreJob.ok || coreJob.status !== 'queued') {
      throw new Error('HTTP PG创书持久任务创建失败：' + JSON.stringify({ status: coreJobResponse.status, body: coreJob }));
    }
    const coreJobRead = await (await request(`/api/creation-books/core-jobs/${coreJob.jobId}`, tokenA)).json();
    if (!coreJobRead.ok || !coreJobRead.job || coreJobRead.job.status !== 'queued') throw new Error('HTTP PG创书持久任务读取失败');
    const coreJobCancel = await (await request(`/api/creation-books/core-jobs/${coreJob.jobId}`, tokenA, { method: 'DELETE' })).json();
    if (!coreJobCancel.ok || coreJobCancel.status !== 'cancelling') throw new Error('HTTP PG创书持久任务取消失败');
    const persistedJobId = `cj_pght${Date.now().toString(36)}`;
    await app.postgresRepository.upsertJob({
      userId: actorA,
      workspaceId,
      projectId: novelId,
      jobId: persistedJobId,
      kind: 'creation-core',
      state: 'provider_unknown',
      workerId: 'http-smoke-worker',
      inputHash: crypto.createHash('sha256').update('provider-unknown-smoke', 'utf8').digest('hex'),
      errorCode: 'provider_timeout',
      result: { bookId: creationBookId }
    });
    const persistedJob = await (await request(`/api/creation-books/core-jobs/${persistedJobId}`, tokenA)).json();
    if (!persistedJob.ok || !persistedJob.job || persistedJob.job.status !== 'provider_unknown') throw new Error('HTTP PG持久任务读取失败');
    if ((await request(`/api/novels/${novelId}`, tokenB, { method: 'DELETE' })).status !== 403) throw new Error('HTTP协作者删除权限未拒绝');
    if (!(await (await request(`/api/novels/${novelId}`, tokenA, { method: 'DELETE' })).json()).deleted) throw new Error('HTTP作品删除失败');
    if ((await request(`/api/novels/${novelId}`, tokenA)).status !== 404) throw new Error('HTTP软删除后仍可读取');
    if (!(await (await request(`/api/novels/${novelId}/restore`, tokenA, { method: 'POST', body: '{}' })).json()).restored) throw new Error('HTTP作品恢复失败');
    process.stdout.write(JSON.stringify({
      ok: true,
      novelId,
      workspaceId,
      checks: ['http-auth', 'project-isolation', 'member-acl', 'profile-cas', 'character-import-cas', 'resource-cas', 'project-materials-49-create-read-cas-history', 'package-restore', 'creation-export-restore', 'creation-bible', 'creation-plan-expand', 'creation-plan-review', 'creation-link-novel', 'creation-regenerate-assets', 'creation-audit-commit', 'postgres-memory-extract-review-commit-projection', 'postgres-style-create-version-audit', 'postgres-causal-debt-crud-extract-settle', 'creation-job-persistence', 'persistent-job', 'soft-delete-restore']
    }) + '\n');
  } finally {
    app.sessions.delete(app.hashSessionToken(tokenA));
    app.sessions.delete(app.hashSessionToken(tokenB));
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
    await app.postgresRepository.close();
    await new Promise(resolve => modelServer.close(resolve));
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: String(error && error.code || 'postgres_http_smoke_failed'),
    error: String(error && error.message || 'PostgreSQL HTTP烟测失败')
  }) + '\n');
  process.exitCode = 1;
});
