'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const zlib = require('node:zlib');
const { createPostgresDissectionReadService } = require('../services/postgres-dissection-read-service');
const { buildDissectionDocx } = require('../lib/dissection-docx');

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    writeHead(code, headers = {}) {
      this.statusCode = code;
      Object.assign(this.headers, headers);
      return this;
    },
    end(data) {
      this.body = data;
      this.ended = true;
      return this;
    }
  };
}

function extractZipEntry(zipBuffer, targetName) {
  let offset = 0;
  while (offset + 30 <= zipBuffer.length) {
    if (zipBuffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const nameLen = zipBuffer.readUInt16LE(offset + 26);
    const extraLen = zipBuffer.readUInt16LE(offset + 28);
    const fileName = zipBuffer.toString('utf8', offset + 30, offset + 30 + nameLen);
    const dataStart = offset + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compressedSize;
    if (fileName === targetName) {
      const rawData = zipBuffer.subarray(dataStart, dataEnd);
      if (method === 0) return rawData.toString('utf8');
      if (method === 8) return zlib.inflateRawSync(rawData).toString('utf8');
      throw new Error('Unsupported compression method: ' + method);
    }
    offset = dataEnd;
  }
  return null;
}

function harness(options = {}) {
  const repositoryCalls = [];
  const writeCalls = [];

  const defaultRow = {
    id: 'd_test-sample-1',
    owner_user_id: 'actor-1',
    user_email: 'author@example.test',
    title: '神级天道',
    source_type: 'text',
    source_name: '第一章',
    source_text: '正文样本内容',
    depth: 'standard',
    purpose: 'new-writer',
    selected_model: 'deepseek-v4-flash',
    status: 'completed',
    phase: 'completed',
    phase_index: 8,
    progress: 100,
    estimated_credits: null,
    actual_credits: null,
    result_json: JSON.stringify({
      overview: { positioning: '玄幻爽文' },
      framework: { premise: '主角逆袭' },
      architecture: { pacingModel: '三段式' },
      opening: { hook: '退婚' },
      goldenFinger: { exists: true, type: '系统' },
      characters: [{ name: '林凡' }],
      worldbuilding: [{ category: '境界', detail: '练气' }],
      outline: [{ title: '序幕' }],
      styleProfile: { summary: '快节奏' },
      craftConstraints: [{ rule: '短句为主' }],
      authorDna: { tone: '热血' },
      emotion: { curve: [1, 2] },
      foreshadowing: [{ id: 'f_result_1', title: '旧结果伏笔', status: 'open' }],
      chapterSummaries: [{ id: 's_res_ch1', summary: '旧结果章摘要' }],
      volumeSummaries: [{ id: 's_res_vol1', summary: '旧结果卷摘要' }],
      validation: { conclusion: 'passed' }
    }),
    meta_json: JSON.stringify({
      wordCount: 15000,
      chapterCount: 5,
      pipeline: {
        unitTotal: 10,
        unitCompleted: 10,
        factCoverage: 1.0,
        batchTotal: 2,
        batchDone: 2,
        failedBatches: [],
        aggregated: true
      }
    }),
    error: '',
    cancel_requested: false,
    created_at_value: 1700000000000,
    updated_at_value: 1700000050000
  };

  const defaultDissectionRows = [
    { source_table: 'dissection_entities', document: { status: 'candidate', name: '林凡' } },
    { source_table: 'dissection_entities', document: { status: 'confirmed', name: '萧炎' } },
    { source_table: 'dissection_entity_mentions', document: { count: 3 } },
    { source_table: 'dissection_events', document: { action: '战胜' } },
    { source_table: 'dissection_summaries', document: { summary: '第一卷' } },
    { source_table: 'dissection_claims', document: { claim: '天资过人' } },
    { source_table: 'dissection_units', document: { ordinal: 1 } },
    { source_table: 'dissection_units', document: { ordinal: 2 } },
    { source_table: 'dissection_foreshadows', document: { desc: '神秘残玉' } },
    { source_table: 'dissection_event_edges', document: { edge: '因果' } },
    { source_table: 'dissection_entity_states', document: { state: '重伤' } }
  ];

  const repository = {
    async runtimeListDissections(actor) {
      repositoryCalls.push(['runtimeListDissections', actor]);
      if (options.listError) throw options.listError;
      return options.listRows !== undefined ? options.listRows : [defaultRow];
    },
    async runtimeGetDissection(actor, id) {
      repositoryCalls.push(['runtimeGetDissection', actor, id]);
      if (options.getError) throw options.getError;
      if (options.getRow !== undefined) return options.getRow;
      return id === defaultRow.id ? defaultRow : null;
    },
    async runtimeListDissectionRows(actor, id) {
      repositoryCalls.push(['runtimeListDissectionRows', actor, id]);
      if (options.rowsError) throw options.rowsError;
      return options.dissectionRows !== undefined ? options.dissectionRows : defaultDissectionRows;
    },
    async runtimeInsertDissection(...args) {
      writeCalls.push(['runtimeInsertDissection', ...args]);
      throw new Error('Write operations strictly prohibited');
    },
    async runtimeUpdateDissection(...args) {
      writeCalls.push(['runtimeUpdateDissection', ...args]);
      throw new Error('Write operations strictly prohibited');
    },
    async runtimeDeleteDissection(...args) {
      writeCalls.push(['runtimeDeleteDissection', ...args]);
      throw new Error('Write operations strictly prohibited');
    }
  };

  const rowToRecord = row => {
    let result = {}, meta = {};
    try { result = JSON.parse(row.result_json || '{}'); } catch (_) {}
    try { meta = JSON.parse(row.meta_json || '{}'); } catch (_) {}
    return {
      id: row.id,
      userEmail: row.user_email,
      ownerUserId: row.owner_user_id || 'stable:usr',
      title: row.title,
      sourceType: row.source_type,
      sourceName: row.source_name,
      sourceText: row.source_text,
      depth: row.depth,
      purpose: row.purpose,
      selectedModel: row.selected_model,
      status: row.status,
      phase: row.phase,
      phaseIndex: Number(row.phase_index) || 0,
      progress: Number(row.progress) || 0,
      estimatedCredits: row.estimated_credits === null ? null : (Number(row.estimated_credits) || 0),
      actualCredits: row.actual_credits === null ? null : (Number(row.actual_credits) || 0),
      result,
      meta,
      error: row.error || '',
      cancelRequested: !!row.cancel_requested,
      createdAt: Number(row.created_at_value || row.created_at) || 0,
      updatedAt: Number(row.updated_at_value || row.updated_at) || 0
    };
  };

  const publicRecord = (record, includeResult = true, pipelineStats) => {
    if (!record) return null;
    const meta = record.meta && typeof record.meta === 'object' ? record.meta : {};
    const pipeline = meta.pipeline ? { ...meta.pipeline, ...pipelineStats } : pipelineStats;
    const output = {
      id: record.id,
      title: record.title,
      sourceType: record.sourceType,
      sourceName: record.sourceName,
      sourceText: record.sourceText,
      depth: record.depth,
      purpose: record.purpose,
      selectedModel: record.selectedModel,
      status: record.status,
      phase: record.phase,
      phaseIndex: record.phaseIndex,
      progress: record.progress,
      estimatedCredits: record.estimatedCredits,
      actualCredits: record.actualCredits,
      wordCount: meta.wordCount || 0,
      chapterCount: meta.chapterCount || 0,
      pipeline,
      isComplete: record.status === 'completed',
      needsReview: false,
      hasResult: true,
      hasPartialResult: true,
      resultMissingFields: [],
      error: record.error || '',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
    if (includeResult) output.result = record.result;
    return output;
  };

  const buildMarkdown = record => {
    return `# ${record.title}\n\n> 深度：${record.depth}\n\n## 概览\n\n${JSON.stringify(record.result && record.result.overview || {})}`;
  };

  const buildDocx = (record, view) => {
    if (options.docxError) throw options.docxError;
    return buildDissectionDocx(record, view || (record && record.result) || {});
  };

  const service = createPostgresDissectionReadService({
    postgresRepository: repository,
    getAuthUser: req => req.auth || null,
    postgresActor: auth => String(auth && auth.user && auth.user.userId || '').trim(),
    json: (res, status, body) => {
      res.statusCode = status;
      res.body = body;
      return body;
    },
    respondPostgresError: (res, error) => {
      res.statusCode = Number(error && error.status) || 503;
      res.body = { error: error && error.message || 'PostgreSQL 操作失败', code: error && error.code || 'pg_error' };
      return res.body;
    },
    rowToRecord,
    publicRecord,
    buildMarkdown,
    buildDocx,
    resultView: r => r || {},
    hasCompleteContent: options.omitCompleteValidator ? undefined : () => (options.hasCompleteContent !== undefined ? options.hasCompleteContent : true),
    responseCors: () => ({ 'Access-Control-Allow-Origin': '*' })
  });

  const req = (url, method = 'GET', authUser = { userId: 'actor-1', email: 'author@example.test' }) => ({
    url,
    method,
    auth: authUser ? { user: authUser } : null
  });

  return {
    repository,
    repositoryCalls,
    writeCalls,
    defaultRow,
    defaultDissectionRows,
    service,
    req
  };
}

test('GET /api/dissections list: returns legacy tasks shape, limits 50, zero writes', async () => {
  const h = harness();
  const res = createMockResponse();
  const handled = await h.service.dispatch(h.req('/api/dissections'), res, '/api/dissections');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.tasks));
  assert.equal(res.body.tasks.length, 1);
  const task = res.body.tasks[0];
  assert.equal(task.id, 'd_test-sample-1');
  assert.equal(task.title, '神级天道');
  assert.equal(task.estimatedCredits, null);
  assert.equal(task.actualCredits, null);
  assert.equal(task.pipeline.entities, 2);
  assert.equal(task.pipeline.candidates, 1);
  assert.equal(task.pipeline.units, 2);
  assert.equal(h.writeCalls.length, 0);
  assert.equal(h.repositoryCalls[0][0], 'runtimeListDissections');
});

test('GET /api/dissections list strictly caps at 50 when repository returns more than 50', async () => {
  const sixtyRows = Array.from({ length: 60 }, (_, index) => ({
    ...harness().defaultRow,
    id: `d_item_${index}`
  }));
  const h = harness({ listRows: sixtyRows });
  const res = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections'), res, '/api/dissections');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.tasks.length, 50);
  assert.equal(res.body.tasks[0].id, 'd_item_0');
  assert.equal(res.body.tasks[49].id, 'd_item_49');
});

test('GET /api/dissections/:id get: returns legacy task shape, checks owner, retains null costs', async () => {
  const h = harness();
  const res = createMockResponse();
  const handled = await h.service.dispatch(h.req('/api/dissections/d_test-sample-1'), res, '/api/dissections/d_test-sample-1');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.task);
  assert.equal(res.body.task.id, 'd_test-sample-1');
  assert.equal(res.body.task.estimatedCredits, null);
  assert.equal(res.body.task.actualCredits, null);
  assert.equal(res.body.task.pipeline.entities, 2);
  assert.equal(res.body.task.pipeline.candidates, 1);
  assert.equal(res.body.task.pipeline.claims, 1);
  assert.equal(res.body.task.pipeline.events, 1);
  assert.equal(res.body.task.pipeline.foreshadows, 1);
  assert.equal(h.writeCalls.length, 0);
});

test('Authentication and permissions: anonymous 401, cross-user 404, not found 404', async () => {
  const h = harness();

  const anonRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections', 'GET', null), anonRes, '/api/dissections');
  assert.equal(anonRes.statusCode, 401);

  const anonGetRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1', 'GET', null), anonGetRes, '/api/dissections/d_test-sample-1');
  assert.equal(anonGetRes.statusCode, 401);

  const anonExportRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/export', 'GET', null), anonExportRes, '/api/dissections/d_test-sample-1/export');
  assert.equal(anonExportRes.statusCode, 401);

  const crossRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1', 'GET', { userId: 'admin-99', email: 'admin@example.test' }), crossRes, '/api/dissections/d_test-sample-1');
  assert.equal(crossRes.statusCode, 404);

  const crossExportRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/export', 'GET', { userId: 'admin-99', email: 'admin@example.test' }), crossExportRes, '/api/dissections/d_test-sample-1/export');
  assert.equal(crossExportRes.statusCode, 404);

  const notFoundRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_nonexistent', 'GET'), notFoundRes, '/api/dissections/d_nonexistent');
  assert.equal(notFoundRes.statusCode, 404);
  assert.equal(h.writeCalls.length, 0);
});

test('Error branches: PG error does not fake 0 and does not fallback', async () => {
  const listErrH = harness({ listError: Object.assign(new Error('PG down'), { status: 503, code: 'pg_down' }) });
  const listRes = createMockResponse();
  await listErrH.service.dispatch(listErrH.req('/api/dissections'), listRes, '/api/dissections');
  assert.equal(listRes.statusCode, 503);
  assert.equal(listRes.body.code, 'pg_down');

  const getErrH = harness({ getError: Object.assign(new Error('PG get failed'), { status: 503, code: 'pg_get_error' }) });
  const getRes = createMockResponse();
  await getErrH.service.dispatch(getErrH.req('/api/dissections/d_test-sample-1'), getRes, '/api/dissections/d_test-sample-1');
  assert.equal(getRes.statusCode, 503);
  assert.equal(getRes.body.code, 'pg_get_error');

  const rowsErrH = harness({ rowsError: Object.assign(new Error('Rows query failed'), { status: 500, code: 'query_failed' }) });
  const rowsRes = createMockResponse();
  await rowsErrH.service.dispatch(rowsErrH.req('/api/dissections/d_test-sample-1'), rowsRes, '/api/dissections/d_test-sample-1');
  assert.equal(rowsRes.statusCode, 500);
  assert.equal(rowsRes.body.code, 'query_failed');

  assert.equal(listErrH.writeCalls.length, 0);
  assert.equal(getErrH.writeCalls.length, 0);
  assert.equal(rowsErrH.writeCalls.length, 0);
});

test('PG rows and list returning non-array must error and reject fake zeros', async () => {
  const badListH = harness({ listRows: null });
  const badListRes = createMockResponse();
  await badListH.service.dispatch(badListH.req('/api/dissections'), badListRes, '/api/dissections');
  assert.equal(badListRes.statusCode, 500);
  assert.equal(badListRes.body.code, 'invalid_list_format');

  const badRowsH = harness({ dissectionRows: null });
  const badRowsRes = createMockResponse();
  await badRowsH.service.dispatch(badRowsH.req('/api/dissections/d_test-sample-1'), badRowsRes, '/api/dissections/d_test-sample-1');
  assert.equal(badRowsRes.statusCode, 500);
  assert.equal(badRowsRes.body.code, 'invalid_rows_format');
});

test('Stats verification: zero when table empty, null when meta pipeline missing', async () => {
  const emptyRow = {
    ...harness().defaultRow,
    meta_json: JSON.stringify({ wordCount: 100 })
  };
  const h = harness({
    getRow: emptyRow,
    dissectionRows: []
  });
  const res = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1'), res, '/api/dissections/d_test-sample-1');
  assert.equal(res.statusCode, 200);
  const p = res.body.task.pipeline;
  assert.equal(p.entities, 0);
  assert.equal(p.candidates, 0);
  assert.equal(p.units, 0);
  assert.equal(p.events, 0);
  assert.equal(p.unitTotal, null);
  assert.equal(p.unitCompleted, null);
  assert.equal(p.batchTotal, null);
  assert.equal(p.batchDone, null);
  assert.equal(p.factCoverage, null);
  assert.equal(p.failedBatches, null);
  assert.equal(p.aggregated, null);
});

test('Stats strict validation: preserves legal 0 and booleans, rejects non-finite, whitespace, and string fake booleans', async () => {
  const legalZeroRow = {
    ...harness().defaultRow,
    meta_json: JSON.stringify({
      pipeline: {
        unitTotal: 0,
        unitCompleted: 0,
        factCoverage: 0,
        batchTotal: 0,
        batchDone: 0,
        aggregated: false
      }
    })
  };
  const legalH = harness({ getRow: legalZeroRow, dissectionRows: [] });
  const legalRes = createMockResponse();
  await legalH.service.dispatch(legalH.req('/api/dissections/d_test-sample-1'), legalRes, '/api/dissections/d_test-sample-1');
  assert.equal(legalRes.statusCode, 200);
  const legalP = legalRes.body.task.pipeline;
  assert.equal(legalP.unitTotal, 0);
  assert.equal(legalP.unitCompleted, 0);
  assert.equal(legalP.factCoverage, 0);
  assert.equal(legalP.batchTotal, 0);
  assert.equal(legalP.batchDone, 0);
  assert.equal(legalP.aggregated, false);

  const invalidRow = {
    ...harness().defaultRow,
    meta_json: JSON.stringify({
      pipeline: {
        unitTotal: true,
        unitCompleted: [],
        batchTotal: {},
        batchDone: '   ',
        factCoverage: 1.5,
        aggregated: 'false'
      }
    })
  };
  const invalidH = harness({ getRow: invalidRow, dissectionRows: [] });
  const invalidRes = createMockResponse();
  await invalidH.service.dispatch(invalidH.req('/api/dissections/d_test-sample-1'), invalidRes, '/api/dissections/d_test-sample-1');
  assert.equal(invalidRes.statusCode, 200);
  const invalidP = invalidRes.body.task.pipeline;
  assert.equal(invalidP.unitTotal, null);
  assert.equal(invalidP.unitCompleted, null);
  assert.equal(invalidP.batchTotal, null);
  assert.equal(invalidP.batchDone, null);
  assert.equal(invalidP.factCoverage, null);
  assert.equal(invalidP.aggregated, null);
});

test('Export format json: maintains publicRecord shape and omits sourceText', async () => {
  const h = harness();
  const res = createMockResponse();
  const handled = await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/export?format=json'), res, '/api/dissections/d_test-sample-1/export');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.ok(res.headers['Content-Disposition'].includes('dissection-d_test-sample-1.json'));
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.id, 'd_test-sample-1');
  assert.equal(parsed.title, '神级天道');
  assert.equal(parsed.sourceText, undefined);
  assert.ok(parsed.result);
});

test('Export format markdown: returns markdown text with headers', async () => {
  const h = harness();
  const res = createMockResponse();
  const handled = await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/export?format=markdown'), res, '/api/dissections/d_test-sample-1/export');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/markdown; charset=utf-8');
  assert.ok(res.body.includes('# 神级天道'));
});

test('Export format docx: parses ZIP entries and asserts decompressed document.xml containing title, overview, and w:document', async () => {
  const h = harness();
  const res = createMockResponse();
  const handled = await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/export?format=docx'), res, '/api/dissections/d_test-sample-1/export');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.ok(Buffer.isBuffer(res.body));
  assert.equal(res.body[0], 0x50);
  assert.equal(res.body[1], 0x4b);
  assert.equal(res.body[2], 0x03);
  assert.equal(res.body[3], 0x04);
  const documentXml = extractZipEntry(res.body, 'word/document.xml');
  assert.ok(documentXml, 'word/document.xml must exist in zip');
  assert.ok(documentXml.includes('<w:document'), 'must contain <w:document root');
  assert.ok(documentXml.includes('神级天道'), 'must contain Chinese novel title');
  assert.ok(documentXml.includes('玄幻爽文'), 'must contain overview content');
});

test('Export incomplete: returns 409 when incomplete', async () => {
  const h = harness({ hasCompleteContent: false });
  const res = createMockResponse();
  const handled = await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/export?format=json'), res, '/api/dissections/d_test-sample-1/export');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, '拆书结果不完整，请先重新分析');
});

test('Export fails closed with 409 when completeness validator dependency is missing', async () => {
  const h = harness({ omitCompleteValidator: true });
  const res = createMockResponse();
  const handled = await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/export?format=json'), res, '/api/dissections/d_test-sample-1/export');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, '拆书结果不完整，请先重新分析');
});

test('Dispatch ignores non-GET and unrelated dissection subroutes', async () => {
  const h = harness();
  const res = createMockResponse();

  assert.equal(await h.service.dispatch(h.req('/api/dissections', 'POST'), res, '/api/dissections'), false);
  assert.equal(await h.service.dispatch(h.req('/api/dissections/d_test-1', 'PATCH'), res, '/api/dissections/d_test-1'), false);
  assert.equal(await h.service.dispatch(h.req('/api/dissections/d_test-1', 'DELETE'), res, '/api/dissections/d_test-1'), false);
  assert.equal(await h.service.dispatch(h.req('/api/dissections/d_test-1/creative-brief', 'GET'), res, '/api/dissections/d_test-1/creative-brief'), false);
  assert.equal(await h.service.dispatch(h.req('/api/dissections/shared', 'GET'), res, '/api/dissections/shared'), false);
  assert.equal(h.writeCalls.length, 0);
});

test('GET /api/dissections/:id/coverage: returns cleaned stats, rejects anon and cross-user', async () => {
  const h = harness();

  const anonRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/coverage', 'GET', null), anonRes, '/api/dissections/d_test-sample-1/coverage');
  assert.equal(anonRes.statusCode, 401);

  const crossRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/coverage', 'GET', { userId: 'admin-99', email: 'admin@example.test' }), crossRes, '/api/dissections/d_test-sample-1/coverage');
  assert.equal(crossRes.statusCode, 404);

  const res = createMockResponse();
  const handled = await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/coverage'), res, '/api/dissections/d_test-sample-1/coverage');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.coverage);
  assert.equal(res.body.coverage.entities, 2);
  assert.equal(res.body.coverage.candidates, 1);
  assert.equal(res.body.coverage.units, 2);
  assert.equal(res.body.coverage.factCoverage, 1.0);
  assert.equal(h.writeCalls.length, 0);
});

test('GET /api/dissections/:id/validation: returns validation view and cleaned stats, rejects anon and cross-user', async () => {
  const h = harness();

  const anonRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/validation', 'GET', null), anonRes, '/api/dissections/d_test-sample-1/validation');
  assert.equal(anonRes.statusCode, 401);

  const crossRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/validation', 'GET', { userId: 'admin-99', email: 'admin@example.test' }), crossRes, '/api/dissections/d_test-sample-1/validation');
  assert.equal(crossRes.statusCode, 404);

  const res = createMockResponse();
  const handled = await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/validation'), res, '/api/dissections/d_test-sample-1/validation');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.validation, { conclusion: 'passed' });
  assert.equal(res.body.stats.entities, 2);
  assert.equal(h.writeCalls.length, 0);

  const emptyValidationRow = {
    ...h.defaultRow,
    result_json: JSON.stringify({ overview: { positioning: '测试' } })
  };
  const emptyValH = harness({ getRow: emptyValidationRow });
  const emptyValRes = createMockResponse();
  await emptyValH.service.dispatch(emptyValH.req('/api/dissections/d_test-sample-1/validation'), emptyValRes, '/api/dissections/d_test-sample-1/validation');
  assert.equal(emptyValRes.statusCode, 200);
  assert.deepEqual(emptyValRes.body.validation, { conclusion: 'unknown' });
});

test('GET /api/dissections/:id/units: pagination without duplicate items, limit capped at 200, mapped document fields', async () => {
  const unitRows = [
    { source_table: 'dissection_units', document: { id: 'u_1', ordinal: 1, title: '第一回', unit_type: 'chapter', char_count: 3000, token_estimate: 800 } },
    { source_table: 'dissection_units', document: { id: 'u_2', ordinal: 2, title: '第二回', unit_type: 'chapter', char_count: 3200, token_estimate: 850 } },
    { source_table: 'dissection_units', document: { id: 'u_3', ordinal: 3, title: '第三回', unit_type: 'chapter', char_count: 2900, token_estimate: 780 } },
    { source_table: 'dissection_units', document: { id: 'u_4', ordinal: 4, title: '第四回', unit_type: 'chapter', char_count: 3100, token_estimate: 820 } },
    { source_table: 'dissection_units', document: { id: 'u_5', ordinal: 5, title: '第五回', unit_type: 'chapter', char_count: 3300, token_estimate: 900 } }
  ];
  const h = harness({ dissectionRows: unitRows });

  const anonRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/units', 'GET', null), anonRes, '/api/dissections/d_test-sample-1/units');
  assert.equal(anonRes.statusCode, 401);

  const crossRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/units', 'GET', { userId: 'admin-99', email: 'admin@example.test' }), crossRes, '/api/dissections/d_test-sample-1/units');
  assert.equal(crossRes.statusCode, 404);

  const page1Res = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/units?limit=2'), page1Res, '/api/dissections/d_test-sample-1/units');
  assert.equal(page1Res.statusCode, 200);
  assert.equal(page1Res.body.items.length, 2);
  assert.equal(page1Res.body.items[0].id, 'u_1');
  assert.equal(page1Res.body.items[0].char_count, 3000);
  assert.equal(page1Res.body.items[1].id, 'u_2');
  assert.equal(page1Res.body.next, 2);

  const page2Res = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/units?limit=2&cursor=2'), page2Res, '/api/dissections/d_test-sample-1/units');
  assert.equal(page2Res.statusCode, 200);
  assert.equal(page2Res.body.items.length, 2);
  assert.equal(page2Res.body.items[0].id, 'u_3');
  assert.equal(page2Res.body.items[1].id, 'u_4');
  assert.equal(page2Res.body.next, 4);

  const page3Res = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/units?limit=2&cursor=4'), page3Res, '/api/dissections/d_test-sample-1/units');
  assert.equal(page3Res.statusCode, 200);
  assert.equal(page3Res.body.items.length, 1);
  assert.equal(page3Res.body.items[0].id, 'u_5');
  assert.equal(page3Res.body.next, '');

  const allItems = [...page1Res.body.items, ...page2Res.body.items, ...page3Res.body.items];
  const allIds = allItems.map(it => it.id);
  assert.equal(new Set(allIds).size, 5);

  const manyUnits = Array.from({ length: 250 }, (_, i) => ({
    source_table: 'dissection_units',
    document: { id: `u_${i + 1}`, ordinal: i + 1, title: `第${i + 1}章` }
  }));
  const hMany = harness({ dissectionRows: manyUnits });
  const cappedRes = createMockResponse();
  await hMany.service.dispatch(hMany.req('/api/dissections/d_test-sample-1/units?limit=500'), cappedRes, '/api/dissections/d_test-sample-1/units');
  assert.equal(cappedRes.statusCode, 200);
  assert.equal(cappedRes.body.items.length, 200);
  assert.equal(cappedRes.body.next, 200);

  const badH = harness({ dissectionRows: null });
  const badRes = createMockResponse();
  await badH.service.dispatch(badH.req('/api/dissections/d_test-sample-1/units'), badRes, '/api/dissections/d_test-sample-1/units');
  assert.equal(badRes.statusCode, 500);
  assert.equal(badRes.body.code, 'invalid_rows_format');
});

test('GET /api/dissections/:id/entities: composite base64url cursor and legacy numeric cursor, pagination no duplicate items, limit capped at 200', async () => {
  const entityRows = [
    { source_table: 'dissection_entities', document: { id: 'ent_1', canonical_name: '林凡', entity_type: 'character', mention_count: 50, status: 'confirmed' } },
    { source_table: 'dissection_entities', document: { id: 'ent_2', canonical_name: '萧炎', entity_type: 'character', mention_count: 50, status: 'confirmed' } },
    { source_table: 'dissection_entities', document: { id: 'ent_3', canonical_name: '药老', entity_type: 'character', mention_count: 30, status: 'confirmed' } },
    { source_table: 'dissection_entities', document: { id: 'ent_4', canonical_name: '美杜莎', entity_type: 'character', mention_count: 20, status: 'candidate' } },
    { source_table: 'dissection_entities', document: { id: 'ent_5', canonical_name: '海波东', entity_type: 'character', mention_count: 10, status: 'confirmed' } }
  ];
  const h = harness({ dissectionRows: entityRows });

  const anonRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/entities', 'GET', null), anonRes, '/api/dissections/d_test-sample-1/entities');
  assert.equal(anonRes.statusCode, 401);

  const crossRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/entities', 'GET', { userId: 'admin-99', email: 'admin@example.test' }), crossRes, '/api/dissections/d_test-sample-1/entities');
  assert.equal(crossRes.statusCode, 404);

  const page1Res = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/entities?limit=2'), page1Res, '/api/dissections/d_test-sample-1/entities');
  assert.equal(page1Res.statusCode, 200);
  assert.equal(page1Res.body.items.length, 2);
  assert.equal(page1Res.body.items[0].canonical_name, '林凡');
  assert.equal(page1Res.body.items[1].canonical_name, '萧炎');
  assert.ok(page1Res.body.next);

  const page2Res = createMockResponse();
  await h.service.dispatch(h.req(`/api/dissections/d_test-sample-1/entities?limit=2&cursor=${page1Res.body.next}`), page2Res, '/api/dissections/d_test-sample-1/entities');
  assert.equal(page2Res.statusCode, 200);
  assert.equal(page2Res.body.items.length, 2);
  assert.equal(page2Res.body.items[0].canonical_name, '药老');
  assert.equal(page2Res.body.items[1].canonical_name, '美杜莎');
  assert.ok(page2Res.body.next);

  const page3Res = createMockResponse();
  await h.service.dispatch(h.req(`/api/dissections/d_test-sample-1/entities?limit=2&cursor=${page2Res.body.next}`), page3Res, '/api/dissections/d_test-sample-1/entities');
  assert.equal(page3Res.statusCode, 200);
  assert.equal(page3Res.body.items.length, 1);
  assert.equal(page3Res.body.items[0].canonical_name, '海波东');
  assert.equal(page3Res.body.next, '');

  const allItems = [...page1Res.body.items, ...page2Res.body.items, ...page3Res.body.items];
  const allIds = allItems.map(it => it.id);
  assert.equal(new Set(allIds).size, 5);

  const legacyCursorRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/entities?cursor=30'), legacyCursorRes, '/api/dissections/d_test-sample-1/entities');
  assert.equal(legacyCursorRes.statusCode, 200);
  assert.equal(legacyCursorRes.body.items.length, 3);
  assert.equal(legacyCursorRes.body.items[0].canonical_name, '药老');
  assert.equal(legacyCursorRes.body.items[1].canonical_name, '美杜莎');
  assert.equal(legacyCursorRes.body.items[2].canonical_name, '海波东');

  const manyEntities = Array.from({ length: 250 }, (_, i) => ({
    source_table: 'dissection_entities',
    document: { id: `ent_${i + 1}`, canonical_name: `角色_${i + 1}`, mention_count: 500 - i }
  }));
  const hMany = harness({ dissectionRows: manyEntities });
  const cappedRes = createMockResponse();
  await hMany.service.dispatch(hMany.req('/api/dissections/d_test-sample-1/entities?limit=500'), cappedRes, '/api/dissections/d_test-sample-1/entities');
  assert.equal(cappedRes.statusCode, 200);
  assert.equal(cappedRes.body.items.length, 200);
  assert.ok(cappedRes.body.next);
});

test('GET /api/dissections/:id/entities: multi-page pagination with mixed names and ids has no omissions or duplicates', async () => {
  const mixedEntities = [
    { source_table: 'dissection_entities', document: { id: 'e_10_ch_b', canonical_name: '萧炎', mention_count: 50 } },
    { source_table: 'dissection_entities', document: { id: 'e_01_num', canonical_name: '123木头人', mention_count: 100 } },
    { source_table: 'dissection_entities', document: { id: 'e_08_ch_a2', canonical_name: '林凡', mention_count: 50 } },
    { source_table: 'dissection_entities', document: { id: 'e_02_sym_hash', canonical_name: '#队长', mention_count: 100 } },
    { source_table: 'dissection_entities', document: { id: 'e_05_upper', canonical_name: 'BOB', mention_count: 80 } },
    { source_table: 'dissection_entities', document: { id: 'e_04_lower', canonical_name: 'alex', mention_count: 80 } },
    { source_table: 'dissection_entities', document: { id: 'e_07_ch_a1', canonical_name: '林凡', mention_count: 50 } },
    { source_table: 'dissection_entities', document: { id: 'e_06_lower', canonical_name: 'bob', mention_count: 80 } },
    { source_table: 'dissection_entities', document: { id: 'e_03_upper', canonical_name: 'Alex', mention_count: 80 } },
    { source_table: 'dissection_entities', document: { id: 'e_12_sym_under', canonical_name: '_shadow', mention_count: 10 } },
    { source_table: 'dissection_entities', document: { id: 'e_11_ch_c', canonical_name: '药老', mention_count: 20 } },
    { source_table: 'dissection_entities', document: { id: 'e_09_ch_a3', canonical_name: '林凡', mention_count: 50 } }
  ];
  const h = harness({ dissectionRows: mixedEntities });
  const collected = [];
  let cursor = '';

  while (true) {
    const url = cursor
      ? `/api/dissections/d_test-sample-1/entities?limit=3&cursor=${cursor}`
      : '/api/dissections/d_test-sample-1/entities?limit=3';
    const res = createMockResponse();
    await h.service.dispatch(h.req(url), res, '/api/dissections/d_test-sample-1/entities');
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.items));
    for (const item of res.body.items) {
      collected.push(item);
    }
    if (!res.body.next) break;
    cursor = res.body.next;
  }

  assert.equal(collected.length, 12);
  const collectedIds = collected.map(item => item.id);
  assert.equal(new Set(collectedIds).size, 12);

  const originalIds = mixedEntities.map(r => r.document.id).sort();
  assert.deepEqual([...collectedIds].sort(), originalIds);

  for (let i = 0; i < collected.length - 1; i++) {
    const a = collected[i];
    const b = collected[i + 1];
    if (a.mention_count !== b.mention_count) {
      assert.ok(a.mention_count > b.mention_count);
    } else if (a.canonical_name !== b.canonical_name) {
      assert.ok(a.canonical_name < b.canonical_name);
    } else {
      assert.ok(a.id < b.id);
    }
  }
});

test('GET /api/dissections/:id/foreshadows: real PG rows, status filter, result fallback on empty, error rejection, pagination, confidence retention', async () => {
  const foreshadowRows = [
    { source_table: 'dissection_foreshadows', document: { id: 'f_1', title: '神秘残玉', status: 'open', strength: 'strong', setup_chapter: 1, payoff_chapter: null, related_entity_ids: ['ent_1'], evidence_ids: ['ev_1'], confidence: 0.95 } },
    { source_table: 'dissection_foreshadows', document: { id: 'f_2', title: '三年之约', status: 'resolved', strength: 'subtle', setup_chapter: 3, payoff_chapter: 30, related_entity_ids: ['ent_1', 'ent_2'], evidence_ids: [], confidence: 0.88 } },
    { source_table: 'dissection_foreshadows', document: { id: 'f_3', title: '退婚之辱', status: 'resolved', strength: 'strong', setup_chapter: 2, payoff_chapter: 25, related_entity_ids: ['ent_2'], evidence_ids: [], confidence: 0.9 } },
    { source_table: 'dissection_foreshadows', document: { id: 'f_zero', title: '零置信度', status: 'open', strength: 'subtle', setup_chapter: 4, payoff_chapter: null, confidence: 0 } },
    { source_table: 'dissection_foreshadows', document: { id: 'f_missing', title: '缺置信度', status: 'open', strength: 'subtle', setup_chapter: 5, payoff_chapter: null } }
  ];
  const h = harness({ dissectionRows: foreshadowRows });

  const anonRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/foreshadows', 'GET', null), anonRes, '/api/dissections/d_test-sample-1/foreshadows');
  assert.equal(anonRes.statusCode, 401);

  const crossRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/foreshadows', 'GET', { userId: 'admin-99', email: 'admin@example.test' }), crossRes, '/api/dissections/d_test-sample-1/foreshadows');
  assert.equal(crossRes.statusCode, 404);

  const allRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/foreshadows?limit=2&cursor=0'), allRes, '/api/dissections/d_test-sample-1/foreshadows');
  assert.equal(allRes.statusCode, 200);
  assert.equal(allRes.body.total, 5);
  assert.equal(allRes.body.items.length, 2);
  assert.equal(allRes.body.items[0].id, 'f_1');
  assert.deepEqual(allRes.body.items[0].relatedEntityIds, ['ent_1']);
  assert.deepEqual(allRes.body.items[0].evidenceIds, ['ev_1']);
  assert.equal(allRes.body.items[0].confidence, 0.95);
  assert.equal(allRes.body.next, 2);

  const filterRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/foreshadows?status=resolved'), filterRes, '/api/dissections/d_test-sample-1/foreshadows');
  assert.equal(filterRes.statusCode, 200);
  assert.equal(filterRes.body.total, 2);
  assert.equal(filterRes.body.items.length, 2);
  assert.equal(filterRes.body.items[0].id, 'f_2');
  assert.equal(filterRes.body.items[1].id, 'f_3');

  const openRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/foreshadows?status=open'), openRes, '/api/dissections/d_test-sample-1/foreshadows');
  assert.equal(openRes.statusCode, 200);
  assert.equal(openRes.body.total, 3);
  assert.equal(openRes.body.items.length, 3);
  assert.equal(openRes.body.items[0].id, 'f_1');
  assert.equal(openRes.body.items[0].confidence, 0.95);
  assert.equal(openRes.body.items[1].id, 'f_zero');
  assert.equal(openRes.body.items[1].confidence, 0);
  assert.equal(openRes.body.items[2].id, 'f_missing');
  assert.equal(openRes.body.items[2].confidence, null);

  const emptyH = harness({ dissectionRows: [] });
  const fallbackRes = createMockResponse();
  await emptyH.service.dispatch(emptyH.req('/api/dissections/d_test-sample-1/foreshadows'), fallbackRes, '/api/dissections/d_test-sample-1/foreshadows');
  assert.equal(fallbackRes.statusCode, 200);
  assert.equal(fallbackRes.body.total, 1);
  assert.equal(fallbackRes.body.items[0].id, 'f_result_1');
  assert.equal(fallbackRes.body.items[0].title, '旧结果伏笔');

  const errH = harness({ rowsError: Object.assign(new Error('PG query error'), { status: 500, code: 'pg_query_error' }) });
  const errRes = createMockResponse();
  await errH.service.dispatch(errH.req('/api/dissections/d_test-sample-1/foreshadows'), errRes, '/api/dissections/d_test-sample-1/foreshadows');
  assert.equal(errRes.statusCode, 500);
  assert.equal(errRes.body.code, 'pg_query_error');
});

test('GET /api/dissections/:id/summaries: respects source_row_no, filters type, result fallback on empty, error rejection, pagination', async () => {
  const summaryRows = [
    { source_table: 'dissection_summaries', source_row_no: 2, document: { id: 'sum_vol_2', summary_type: 'volume', owner_id: 'vol_2', title: '第二卷总结', key_points: ['突破'] } },
    { source_table: 'dissection_summaries', source_row_no: 1, document: { id: 'sum_vol_1', summary_type: 'volume', owner_id: 'vol_1', title: '第一卷总结', key_points: ['出山'] } },
    { source_table: 'dissection_summaries', source_row_no: 3, document: { id: 'sum_ch_1', summary_type: 'chapter', owner_id: 'ch_1', title: '第一章小结', key_points: ['启程'] } }
  ];
  const h = harness({ dissectionRows: summaryRows });

  const anonRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/summaries', 'GET', null), anonRes, '/api/dissections/d_test-sample-1/summaries');
  assert.equal(anonRes.statusCode, 401);

  const crossRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/summaries', 'GET', { userId: 'admin-99', email: 'admin@example.test' }), crossRes, '/api/dissections/d_test-sample-1/summaries');
  assert.equal(crossRes.statusCode, 404);

  const volRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/summaries?type=volume'), volRes, '/api/dissections/d_test-sample-1/summaries');
  assert.equal(volRes.statusCode, 200);
  assert.equal(volRes.body.type, 'volume');
  assert.equal(volRes.body.total, 2);
  assert.equal(volRes.body.items[0].id, 'sum_vol_1');
  assert.equal(volRes.body.items[1].id, 'sum_vol_2');

  const chRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/summaries?type=chapter'), chRes, '/api/dissections/d_test-sample-1/summaries');
  assert.equal(chRes.statusCode, 200);
  assert.equal(chRes.body.type, 'chapter');
  assert.equal(chRes.body.total, 1);
  assert.equal(chRes.body.items[0].id, 'sum_ch_1');

  const emptyH = harness({ dissectionRows: [] });
  const fallbackChRes = createMockResponse();
  await emptyH.service.dispatch(emptyH.req('/api/dissections/d_test-sample-1/summaries?type=chapter'), fallbackChRes, '/api/dissections/d_test-sample-1/summaries');
  assert.equal(fallbackChRes.statusCode, 200);
  assert.equal(fallbackChRes.body.total, 1);
  assert.equal(fallbackChRes.body.items[0].id, 's_res_ch1');

  const fallbackVolRes = createMockResponse();
  await emptyH.service.dispatch(emptyH.req('/api/dissections/d_test-sample-1/summaries?type=volume'), fallbackVolRes, '/api/dissections/d_test-sample-1/summaries');
  assert.equal(fallbackVolRes.statusCode, 200);
  assert.equal(fallbackVolRes.body.total, 1);
  assert.equal(fallbackVolRes.body.items[0].id, 's_res_vol1');

  const errH = harness({ rowsError: Object.assign(new Error('PG error on summaries'), { status: 500, code: 'pg_summary_err' }) });
  const errRes = createMockResponse();
  await errH.service.dispatch(errH.req('/api/dissections/d_test-sample-1/summaries'), errRes, '/api/dissections/d_test-sample-1/summaries');
  assert.equal(errRes.statusCode, 500);
  assert.equal(errRes.body.code, 'pg_summary_err');
});

test('GET /api/dissections/:id/search: literal substring match on unit text with Chinese/quotes/wildcards, <2 chars empty, capped at 30, ordinal ordering', async () => {
  const searchUnits = [
    { source_table: 'dissection_units', document: { id: 'u_10', ordinal: 10, title: '第十章', unit_type: 'scene', text: '少年在深山偶得一枚“神秘残玉”，散发微光。' } },
    { source_table: 'dissection_units', document: { id: 'u_2', ordinal: 2, title: '第二章', unit_type: 'scene', text: '前方出现了一座残破石碑，碑上有字。' } },
    { source_table: 'dissection_units', document: { id: 'u_5', ordinal: 5, title: '第五章', unit_type: 'scene', text: '他催动体内剑气，斩破了%foo_bar%阵法符号。' } },
    { source_table: 'dissection_units', document: { id: 'u_1', ordinal: 1, title: '第一章', unit_type: 'scene', text: '林凡立于山巅，迎着狂风修炼剑气与石碑秘术。' } }
  ];
  const h = harness({ dissectionRows: searchUnits });

  const anonRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/search?q=剑气', 'GET', null), anonRes, '/api/dissections/d_test-sample-1/search');
  assert.equal(anonRes.statusCode, 401);

  const crossRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/search?q=剑气', 'GET', { userId: 'admin-99', email: 'admin@example.test' }), crossRes, '/api/dissections/d_test-sample-1/search');
  assert.equal(crossRes.statusCode, 404);

  const shortRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/search?q=剑'), shortRes, '/api/dissections/d_test-sample-1/search');
  assert.equal(shortRes.statusCode, 200);
  assert.equal(shortRes.body.ok, true);
  assert.deepEqual(shortRes.body.items, []);
  assert.equal(shortRes.body.query, '剑');

  const chineseRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/search?q=残破石碑'), chineseRes, '/api/dissections/d_test-sample-1/search');
  assert.equal(chineseRes.statusCode, 200);
  assert.equal(chineseRes.body.items.length, 1);
  assert.equal(chineseRes.body.items[0].ordinal, 2);
  assert.equal(chineseRes.body.items[0].unitType, 'scene');
  assert.equal(chineseRes.body.items[0].title, '第二章');
  assert.ok(chineseRes.body.items[0].snippet.includes('[残破石碑]'));

  const quotesRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/search?q=“神秘残玉”'), quotesRes, '/api/dissections/d_test-sample-1/search');
  assert.equal(quotesRes.statusCode, 200);
  assert.equal(quotesRes.body.items.length, 1);
  assert.equal(quotesRes.body.items[0].ordinal, 10);
  assert.ok(quotesRes.body.items[0].snippet.includes('[“神秘残玉”]'));

  const wildcardRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/search?q=%foo_bar%'), wildcardRes, '/api/dissections/d_test-sample-1/search');
  assert.equal(wildcardRes.statusCode, 200);
  assert.equal(wildcardRes.body.items.length, 1);
  assert.equal(wildcardRes.body.items[0].ordinal, 5);
  assert.ok(wildcardRes.body.items[0].snippet.includes('[%foo_bar%]'));

  const multipleRes = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/search?q=剑气'), multipleRes, '/api/dissections/d_test-sample-1/search');
  assert.equal(multipleRes.statusCode, 200);
  assert.equal(multipleRes.body.items.length, 2);
  assert.equal(multipleRes.body.items[0].ordinal, 1);
  assert.equal(multipleRes.body.items[0].title, '第一章');
  assert.equal(multipleRes.body.items[1].ordinal, 5);

  const thirtyFiveUnits = Array.from({ length: 35 }, (_, i) => ({
    source_table: 'dissection_units',
    document: { id: `u_${i + 1}`, ordinal: i + 1, title: `第${i + 1}章`, unit_type: 'scene', text: `通用的修行正文内容第${i + 1}节` }
  }));
  const hMany = harness({ dissectionRows: thirtyFiveUnits });
  const cappedRes = createMockResponse();
  await hMany.service.dispatch(hMany.req('/api/dissections/d_test-sample-1/search?q=修行正文'), cappedRes, '/api/dissections/d_test-sample-1/search');
  assert.equal(cappedRes.statusCode, 200);
  assert.equal(cappedRes.body.items.length, 30);
  assert.equal(cappedRes.body.items[0].ordinal, 1);
  assert.equal(cappedRes.body.items[29].ordinal, 30);
});

test('Foreshadow confidence rejects malformed or out-of-range evidence', async () => {
  const values = ['', ' ', [], {}, true, -1, 2, 'Infinity', null, undefined, 0, '0.5'];
  const h = harness({ dissectionRows: values.map((confidence, index) => ({
    source_table: 'dissection_foreshadows',
    document: { id: `confidence_${index}`, confidence }
  })) });
  const res = createMockResponse();
  await h.service.dispatch(h.req('/api/dissections/d_test-sample-1/foreshadows'), res, '/api/dissections/d_test-sample-1/foreshadows');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items.map(item => item.confidence), [...Array(10).fill(null), 0, 0.5]);
});

test('Exact routing: non-GET write requests to subroutes pass through without interception', async () => {
  const h = harness();
  const res = createMockResponse();
  const subroutes = ['coverage', 'units', 'entities', 'foreshadows', 'summaries', 'validation', 'search'];
  for (const sub of subroutes) {
    const url = `/api/dissections/d_test-sample-1/${sub}`;
    assert.equal(await h.service.dispatch(h.req(url, 'POST'), res, url), false);
    assert.equal(await h.service.dispatch(h.req(url, 'PATCH'), res, url), false);
    assert.equal(await h.service.dispatch(h.req(url, 'DELETE'), res, url), false);
  }
  assert.equal(h.writeCalls.length, 0);
});
