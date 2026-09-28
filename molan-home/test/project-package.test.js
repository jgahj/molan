'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  calculatePackageId,
  canonicalJson,
  exportProjectPackage,
  importProjectPackage,
  sha256
} = require('../lib/project-package');

const scope = {
  projectId: 'project-local-001',
  workspaceId: 'workspace-local-001',
  ownerUserId: 'user-local-001'
};

function buildRepresentativeState() {
  return {
    title: '星河拾光',
    subtitle: '长夜之后',
    penName: '墨舟',
    genres: ['科幻', '成长', '悬疑'],
    theme: '在失去记忆后仍选择守护',
    counterTheme: '力量不能替代选择',
    coreIdea: '每一次回望都要承担代价',
    tone: { base: '克制', localChanges: ['温暖', '紧张'] },
    targetReaders: { age: '18+', interests: ['长篇', '世界观'] },
    sellingPoints: ['双时间线', '群像', '失忆谜团'],
    hook: '月背灯塔在主角出生前发来求救',
    totalWordTarget: 1200000,
    completionPlan: { milestone: '终局回收', range: [1000000, 1400000] },
    shortSynopsis: '一名测绘师追查来自过去的求救信号。',
    longSynopsis: '她需要在真相与同伴之间作出一次不可撤回的选择。',
    era: '新历七百年',
    civilizations: ['环城联盟', '月背聚落'],
    worldRules: [{ id: 'rule-1', name: '记忆燃料', exceptions: ['梦境'] }],
    locations: [{ id: 'place-1', name: '月背灯塔', distance: 42, terrain: '冰原' }],
    factions: [{ id: 'faction-1', name: '环城联盟', goals: ['封锁信号'] }],
    powerSystem: { upperLimit: '七阶', restrictions: ['不可逆记忆损耗'] },
    customs: [{ id: 'culture-1', language: '旧地球语', currency: '光币', belief: '归航' }],
    history: [{ id: 'history-1', year: '新历100', event: '第一次断联' }],
    taboos: ['不得唤醒旧月核'],
    characters: [{
      id: 'char-1',
      name: '沈遥',
      aliases: ['阿遥'],
      age: { value: 27, range: [26, 29] },
      appearance: '银灰短发，左手有旧伤',
      identity: '月面测绘师',
      personality: ['谨慎', '护短'],
      strengths: ['空间记忆'],
      flaws: ['不肯求助'],
      obsession: '找回弟弟',
      boundary: '不牺牲无辜者',
      arc: { expected: '从独行到信任', actual: '开始向队友交底' },
      background: ['出生于环城边缘'],
      family: [{ relation: '弟弟', id: 'char-2' }],
      trauma: '童年事故',
      goals: { short: '找到信号源', medium: '破解月核', ultimate: '阻止第二次断联' },
      skills: [{ id: 'skill-1', mastery: 0.7 }],
      equipment: [{ id: 'item-1', ownership: 'char-1' }],
      voice: '短句，少用比喻',
      habits: ['记录潮汐'],
      catchphrase: '先看证据',
      roleTags: ['主角', '调查者'],
      villainPhase: null,
      mentions: [{ chapterId: 'chapter-1', kind: 'viewpoint', order: 1 }]
    }],
    relations: [{
      id: 'relation-1',
      fromId: 'char-1',
      toId: 'char-2',
      type: '亲属',
      direction: '双向',
      knowledge: { from: '已知', to: '未知' },
      visibility: '秘密',
      validFrom: 'chapter-1',
      validTo: null
    }],
    outline: {
      premise: '求救信号来自被删除的历史',
      phases: ['起因', '发展', '转折', '高潮', '结局'],
      storyLines: [{ id: 'line-main', type: '主线', title: '月核谜团' }],
      events: [{ id: 'event-1', prerequisites: ['event-0'], consequences: ['event-2'], status: 'planned' }],
      ending: { version: 'v-final', openQuestions: ['信号是否仍在'], fates: { 'char-1': '回到地球' } },
      volumes: [{
        id: 'volume-1',
        name: '无声月面',
        chapterRange: [1, 20],
        wordTarget: 100000,
        goal: '找到灯塔',
        conflict: '联盟封锁',
        events: ['event-1'],
        climax: '灯塔重启',
        endingHook: ['下一卷进入月核'],
        chapters: [{
          id: 'chapter-1',
          events: ['event-1'],
          conflict: '队友失踪',
          highlights: ['首次接收回声'],
          emotionalBeat: '压抑后震动',
          characters: ['char-1'],
          scenes: [{ id: 'scene-1', locationId: 'place-1', povId: 'char-1', storyTime: '新历727年冬' }],
          foreshadowingActions: [{ foreshadowId: 'foreshadow-1', action: 'plant' }],
          endingHook: { type: 'suspense', text: '灯塔回应了她的名字' }
        }]
      }]
    },
    items: [{ id: 'item-1', type: '信物', ownerId: 'char-1', locationId: 'place-1', status: '完整' }],
    skills: [{ id: 'skill-1', name: '潮汐定位', effect: '定位旧轨道', cost: '记忆片段', limitation: '一天一次' }],
    environmentTemplates: [{ id: 'env-1', weather: '极夜', time: '黎明前', viewpoint: 'char-1', text: '冰面泛起蓝光' }],
    foreshadowing: [{
      id: 'foreshadow-1',
      status: 'partial',
      plannedPlantChapterId: 'chapter-1',
      actualPlantChapterId: 'chapter-1',
      plannedPayoffChapterId: 'chapter-20',
      actualPayoffEvidence: null,
      delayReason: '等待终局',
      dependencies: ['event-1']
    }],
    dialogueLibrary: [{ id: 'line-1', speakerId: 'char-1', sceneId: 'scene-1', usage: '拟用', source: '原创' }],
    terms: [{ id: 'term-1', canonical: '月核', aliases: ['旧核'], definition: '月背能源中枢', period: '新历' }],
    timeline: [{ id: 'time-1', storyDate: '新历727-冬-1', narrativeOrder: 1, systemUpdatedAt: '2026-09-15T00:00:00.000Z' }],
    progress: { state: 'writing', blockers: ['第七章视角冲突'], nextAction: '补齐证据' },
    correctionRecords: [{ id: 'correction-1', severity: 'warning', evidence: ['chapter-1'], resolution: '待作者确认' }],
    manuscript: {
      id: 'manuscript-1',
      status: 'draft',
      body: '正文保留：月背的风穿过废弃天线，像有人在黑暗中轻声呼唤。',
      continuityId: 'mainline',
      documentType: 'chapter',
      revisionId: 'revision-1'
    },
    postscript: { documentType: '后记', continuityId: 'mainline', body: '后记不改变主线事实。' },
    customFutureField: { nested: true, values: ['未知字段', 7] }
  };
}

function clonePackage(packageValue) {
  return structuredClone(packageValue);
}

function refreshPackageId(packageValue) {
  packageValue.manifest.packageId = calculatePackageId(packageValue.manifest);
  return packageValue;
}

test('49类代表资料字段导出导入后保持结构和未知字段', () => {
  const state = buildRepresentativeState();
  const assets = [
    {
      id: 'asset-1',
      createdBy: scope.ownerUserId,
      type: 'world-rule',
      title: '月核规则',
      content: '规则正文',
      relations: ['relation-1'],
      extensions: { source: 'author' }
    }
  ];
  const versions = [{
    id: 'version-1',
    createdBy: scope.ownerUserId,
    revision: 1,
    state: 'draft',
    manuscriptId: 'manuscript-1',
    body: '版本正文',
    metadata: { reason: '初稿' }
  }];
  const packageValue = exportProjectPackage({ ...scope, state, assets, versions });
  const imported = importProjectPackage(packageValue, {
    ...scope,
    mode: 'apply',
    existingIds: []
  });
  assert.equal(imported.ok, true, JSON.stringify(imported.errors));
  assert.deepEqual(imported.state, state);
  assert.deepEqual(imported.assets, assets);
  assert.deepEqual(imported.versions, versions);
  assert.deepEqual(imported.result.state.customFutureField, state.customFutureField);
  assert.equal(packageValue.manifest.scope.projectId, scope.projectId);
  assert.equal(packageValue.manifest.scope.workspaceId, scope.workspaceId);
  assert.equal(packageValue.manifest.createdBy, scope.ownerUserId);
});

test('Unicode正文按固定UTF-8字节计算哈希并保留原文', () => {
  const body = '组合字符：e\u0301；中文、emoji🌌；CRLF\r\n第二行';
  const packageValue = exportProjectPackage({
    ...scope,
    state: { manuscript: { id: 'unicode-manuscript', body } }
  });
  const bodyFileEntry = Object.entries(packageValue.files).find(([, file]) => file.content === body);
  assert.ok(bodyFileEntry);
  const expectedHash = crypto.createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
  assert.equal(bodyFileEntry[1].sha256, expectedHash);
  const descriptor = packageValue.manifest.files.find(file => file.path === bodyFileEntry[0]);
  assert.equal(descriptor.sha256, expectedHash);
  assert.equal(descriptor.textSha256, expectedHash);
  const imported = importProjectPackage(packageValue, { ...scope, mode: 'apply' });
  assert.equal(imported.ok, true, JSON.stringify(imported.errors));
  assert.equal(imported.state.manuscript.body, body);
});

test('导出包和manifest均不携带恶意凭据字段', () => {
  const packageValue = exportProjectPackage({
    ...scope,
    state: {
      title: '安全测试',
      token: 'token-value',
      password: 'password-value',
      session: { id: 'session-value' },
      nested: { apiKey: 'api-key-value', normal: '保留' }
    },
    assets: [{ id: 'safe-asset', secret: 'secret-value', note: '安全' }]
  });
  const serializedManifest = JSON.stringify(packageValue.manifest);
  const serializedPackage = JSON.stringify(packageValue);
  assert.equal(serializedManifest.includes('token-value'), false);
  assert.equal(serializedManifest.includes('password-value'), false);
  assert.equal(serializedManifest.includes('session-value'), false);
  assert.equal(serializedPackage.includes('token-value'), false);
  assert.equal(serializedPackage.includes('password-value'), false);
  assert.equal(serializedPackage.includes('secret-value'), false);
  const malicious = clonePackage(packageValue);
  malicious.manifest.extensions = { token: 'evil' };
  refreshPackageId(malicious);
  const rejected = importProjectPackage(malicious, { ...scope, mode: 'preflight' });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.some(error => error.code === 'sensitive_field'));
});

test('scope冲突、跨项目引用和目标项目覆盖均被拒绝', () => {
  const packageValue = exportProjectPackage({
    ...scope,
    state: { projectId: scope.projectId, title: '作用域测试' }
  });
  const foreignState = { projectId: 'project-foreign-999', title: '越界数据' };
  const stateFile = packageValue.files['data/state.json'];
  stateFile.content = canonicalJson(foreignState);
  stateFile.byteLength = Buffer.byteLength(stateFile.content, 'utf8');
  stateFile.sha256 = sha256(stateFile.content);
  const stateDescriptor = packageValue.manifest.files.find(file => file.path === 'data/state.json');
  stateDescriptor.byteLength = stateFile.byteLength;
  stateDescriptor.sha256 = stateFile.sha256;
  packageValue.manifest.fileHashes['data/state.json'] = stateDescriptor.sha256;
  refreshPackageId(packageValue);
  const scopeRejected = importProjectPackage(packageValue, { ...scope, mode: 'preflight' });
  assert.equal(scopeRejected.ok, false);
  assert.ok(scopeRejected.errors.some(error => error.code === 'scope_conflict'));

  const validPackage = exportProjectPackage({ ...scope, state: { title: '不覆盖' } });
  const occupied = importProjectPackage(validPackage, {
    ...scope,
    mode: 'apply',
    existingIds: { projectIds: [scope.projectId] }
  });
  assert.equal(occupied.ok, false);
  assert.ok(occupied.conflicts.some(conflict => conflict.code === 'project_exists'));
});

test('坏hash、目录穿越、超大声明和schema错误都会在preflight失败', () => {
  const packageValue = exportProjectPackage({ ...scope, state: { title: '校验' } });
  const badHash = clonePackage(packageValue);
  badHash.files['data/state.json'].content = canonicalJson({ title: '已篡改' });
  const badHashResult = importProjectPackage(badHash, { ...scope, mode: 'preflight' });
  assert.equal(badHashResult.ok, false);
  assert.ok(badHashResult.errors.some(error => error.code === 'hash_mismatch'));

  const badPath = clonePackage(packageValue);
  const stateDescriptor = badPath.manifest.files.find(file => file.path === 'data/state.json');
  stateDescriptor.path = '../state.json';
  badPath.manifest.fileHashes['../state.json'] = badPath.manifest.fileHashes['data/state.json'];
  delete badPath.manifest.fileHashes['data/state.json'];
  refreshPackageId(badPath);
  const badPathResult = importProjectPackage(badPath, { ...scope, mode: 'preflight' });
  assert.equal(badPathResult.ok, false);
  assert.ok(badPathResult.errors.some(error => error.code === 'invalid_path'));

  const badSchema = clonePackage(packageValue);
  badSchema.manifest.schemaVersion = 999;
  refreshPackageId(badSchema);
  const badSchemaResult = importProjectPackage(badSchema, { ...scope, mode: 'preflight' });
  assert.equal(badSchemaResult.ok, false);
  assert.ok(badSchemaResult.errors.some(error => error.code === 'schema_mismatch'));
});

test('重复导入幂等，preflight不改变existingIds，稳定ID冲突不覆盖已有记录', () => {
  const packageValue = exportProjectPackage({
    ...scope,
    state: { title: '幂等测试' },
    assets: [{ id: 'asset-idempotent', title: '资产' }],
    versions: [{ id: 'version-idempotent', revision: 1 }]
  });
  const first = importProjectPackage(packageValue, { ...scope, mode: 'apply', existingIds: [] });
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  const beforePreflight = structuredClone(first.existingIds);
  const preflight = importProjectPackage(packageValue, {
    ...scope,
    mode: 'preflight',
    existingIds: first.existingIds
  });
  assert.equal(preflight.ok, true, JSON.stringify(preflight.errors));
  assert.deepEqual(first.existingIds, beforePreflight);
  const second = importProjectPackage(packageValue, {
    ...scope,
    mode: 'apply',
    existingIds: first.existingIds
  });
  assert.equal(second.ok, true, JSON.stringify(second.errors));
  assert.equal(second.idempotent, true);
  assert.deepEqual(second.conflicts, []);

  const conflict = importProjectPackage(packageValue, {
    targetProjectId: 'project-new-002',
    targetWorkspaceId: 'workspace-new-002',
    mode: 'apply',
    existingIds: {
      entityIds: ['asset-idempotent'],
      hashes: { 'asset:asset-idempotent': '0'.repeat(64) }
    }
  });
  assert.equal(conflict.ok, true);
  assert.ok(conflict.conflicts.some(item => item.stableId === 'asset-idempotent'));
  assert.equal(conflict.result.assets.length, 0);
});

test('未知manifest字段进入extensions，legacy文件进入rawLegacy而不丢弃', () => {
  const packageValue = exportProjectPackage({ ...scope, state: { title: '扩展字段' } });
  const legacyContent = canonicalJson({ oldField: '旧字段', nested: { value: 3 } });
  const legacyHash = sha256(legacyContent);
  packageValue.files['legacy/old.json'] = {
    path: 'legacy/old.json',
    content: legacyContent,
    encoding: 'UTF-8',
    byteLength: Buffer.byteLength(legacyContent, 'utf8'),
    sha256: legacyHash
  };
  packageValue.manifest.files.push({
    path: 'legacy/old.json',
    kind: 'legacy',
    schema: 'molan.project.legacy.v1',
    encoding: 'UTF-8',
    hashAlgorithm: 'sha256',
    sha256: legacyHash,
    byteLength: Buffer.byteLength(legacyContent, 'utf8'),
    stableId: 'legacy-old',
    createdBy: scope.ownerUserId
  });
  packageValue.manifest.fileHashes['legacy/old.json'] = legacyHash;
  packageValue.manifest.fileCount += 1;
  packageValue.manifest.totalByteLength += Buffer.byteLength(legacyContent, 'utf8');
  packageValue.manifest.futureField = { keep: true };
  refreshPackageId(packageValue);
  const imported = importProjectPackage(packageValue, { ...scope, mode: 'apply' });
  assert.equal(imported.ok, true, JSON.stringify(imported.errors));
  assert.deepEqual(imported.extensions.futureField, { keep: true });
  assert.deepEqual(imported.rawLegacy[0].value, { oldField: '旧字段', nested: { value: 3 } });
});
