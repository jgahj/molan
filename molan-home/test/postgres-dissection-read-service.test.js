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
  assert.equal(await h.service.dispatch(h.req('/api/dissections/d_test-1/units', 'GET'), res, '/api/dissections/d_test-1/units'), false);
  assert.equal(await h.service.dispatch(h.req('/api/dissections/shared', 'GET'), res, '/api/dissections/shared'), false);
  assert.equal(h.writeCalls.length, 0);
});
