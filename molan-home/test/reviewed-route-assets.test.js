'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BOOKS, VERSION, parseBook } = require('../lib/xuanhuan-reading');
const { buildReviewedRouteAssets, loadReviewedRouteAssets, buildReviewedLessonsBlock } = require('../lib/reviewed-route-assets');
const engine = require('../lib/genre-engine');

function fixture(routeId = 'jianzhu') {
  const sourceBuffer = Buffer.from('第一章 返家\n\n她把冷了的饭又热了一遍，站在门口等人回来。\n\n第二章 借伞\n\n他没有认出门外的来客，先叫邻居一起出来看看。\n', 'utf8');
  const book = parseBook(sourceBuffer, BOOKS.find(item => item.id === routeId), 2);
  const stages = {};
  for (const chapter of book.chapters) {
    const claims = Array.from({ length: 6 }, (_, index) => ({
      id: `claim-${index}`, kind: index === 0 ? 'fact' : 'inference', topic: '关系反馈',
      statement: '人物关心是否有人平安回来', reasoning: '对话和动作共同改变下一步选择',
      alternative: '也可能只是出于礼貌', application: `通过关系反馈推进人物选择${index}`,
      limits: '不是每个场景都需要怀疑陌生人',
      evidence: [{ paragraphId: chapter.paragraphs[0].id, quote: chapter.paragraphs[0].text }]
    }));
    const notes = { summary: '人物先从已有经验出发，再根据当场的回应调整下一步选择。', claims };
    stages[`${chapter.id}:synthesis`] = structuredClone(notes);
    stages[`${chapter.id}:review`] = {
      checks: claims.map(claim => ({ claimId: claim.id, verdict: 'supported', reason: '引文与判断对应' })),
      notes
    };
  }
  return { sourceBuffer, job: { id: 'test-job', owner: 'reader-a', version: VERSION, status: 'completed', activated: true, books: [book], stages } };
}

test('reviewed route assets use revised notes and retain application limits and citations', () => {
  const { job, sourceBuffer } = fixture();
  job.stages['jianzhu-c1:synthesis'].claims[1].application = '不应采用的旧结论';
  job.stages['jianzhu-c1:review'].checks[1].verdict = 'revised';
  const assets = buildReviewedRouteAssets(job, { routeId: 'jianzhu', owner: 'reader-a', sourceBuffer });
  assert.equal(assets.status, 'ready');
  assert.equal(assets.sourceTitle, '剑烛大荒');
  assert.equal(assets.lessons.length, 4);
  assert.ok(assets.lessons.every(lesson => lesson.chapterId.startsWith('jianzhu-') && lesson.limits && lesson.evidence.length));
  assert.doesNotMatch(buildReviewedLessonsBlock(assets), /不应采用的旧结论/);
  assert.match(buildReviewedLessonsBlock(assets), /不是逐条完成的写作任务/);
});

test('reviewed route assets reject wrong owner, source, stale text and invalid citations', () => {
  const { job, sourceBuffer } = fixture();
  assert.equal(buildReviewedRouteAssets(job, { routeId: 'jianzhu', owner: 'reader-b', sourceBuffer }).status, 'not_activated');
  assert.equal(buildReviewedRouteAssets(job, { routeId: 'yuanshi', owner: 'reader-a', sourceBuffer }).status, 'source_missing');
  assert.equal(buildReviewedRouteAssets(job, { routeId: 'jianzhu', owner: 'reader-a', sourceBuffer: Buffer.concat([sourceBuffer, Buffer.from('改动')]) }).status, 'source_changed');
  job.stages['jianzhu-c1:review'].notes.claims[1].evidence[0].quote = '这是并不出现在原文中的伪造证据';
  const rejected = buildReviewedRouteAssets(job, { routeId: 'jianzhu', owner: 'reader-a', sourceBuffer });
  assert.equal(rejected.status, 'invalid_review');
  assert.deepEqual(rejected.lessons, []);
});

test('uncertain, inactive and incomplete notes cannot silently become active writing instructions', () => {
  const { job, sourceBuffer } = fixture();
  const options = { routeId: 'jianzhu', owner: 'reader-a', sourceBuffer };
  job.stages['jianzhu-c1:review'].checks[1].verdict = 'uncertain';
  const assets = buildReviewedRouteAssets(job, options);
  assert.ok(!assets.lessons.some(lesson => lesson.chapterId === 'jianzhu-c1' && lesson.claimId === 'claim-1'));
  job.activated = false;
  assert.equal(buildReviewedRouteAssets(job, options).status, 'not_activated');
  job.activated = true;
  delete job.stages['jianzhu-c2:review'];
  assert.equal(buildReviewedRouteAssets(job, options).status, 'review_incomplete');
});

test('readonly asset loader and scene preparation isolate owners and inject only the bound book', async () => {
  const { createReadingLab } = require('../lib/xuanhuan-reading');
  const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
  const { JsonLabJobRepository } = require('../lib/repositories/json-lab-job-repository');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-route-assets-'));
  let fileRepository;
  let readingLab;
  try {
    const { job, sourceBuffer } = fixture();
    fs.writeFileSync(path.join(directory, BOOKS.find(book => book.id === 'jianzhu').filename), sourceBuffer);
    const storeDirectory = path.join(directory, 'native-lab-jobs');
    fileRepository = new JsonFileRepository(storeDirectory);
    let updatedAt = 1;
    const storedJobs = new JsonLabJobRepository(fileRepository, { now: () => updatedAt++ });
    await storedJobs.save({ owner: job.owner, kind: 'reading', job, expectedRevision: 0 });
    const latestJob = structuredClone(job);
    latestJob.id = 'latest-test-job';
    latestJob.stages['jianzhu-c1:review'].notes.claims[1].application = '较新任务的复核方法';
    await storedJobs.save({ owner: job.owner, kind: 'reading', job: latestJob, expectedRevision: 0 });

    const listInputs = [];
    let recoveryCalls = 0;
    readingLab = createReadingLab({ dataDir: directory, sourceDirectory: directory, repository: {
      list: input => { listInputs.push(input); return storedJobs.list(input); },
      recover: async () => { recoveryCalls++; throw new Error('read-only lookup must not recover jobs'); }
    } });
    const readingJobs = await readingLab.listOwnerJobs({ owner: job.owner, actorUserId: 'usr_reader_a' });
    assert.deepEqual(listInputs, [{ owner: job.owner, actorUserId: 'usr_reader_a', kind: 'reading', limit: 40 }]);
    assert.deepEqual(readingJobs.map(item => item.id), ['latest-test-job', 'test-job']);
    assert.equal(recoveryCalls, 0);

    const storeFiles = () => fs.readdirSync(path.join(storeDirectory, 'novels')).sort()
      .map(name => [name, fs.readFileSync(path.join(storeDirectory, 'novels', name))]);
    const before = storeFiles();
    const options = { routeId: 'jianzhu', owner: job.owner, readingJobs, sourceDirectory: directory };
    const loaded = loadReviewedRouteAssets(options);
    assert.equal(loaded.status, 'ready');
    assert.equal(loaded.jobId, 'latest-test-job');
    assert.ok(loaded.lessons.some(lesson => lesson.application === '较新任务的复核方法'));
    assert.equal(loadReviewedRouteAssets({ ...options, owner: 'reader-b' }).status, 'not_activated');
    const context = engine.prepareGenreSceneContext({ ...options, genre: '玄幻', query: '借伞回家' });
    assert.equal(context.referenceStatus, 'ready');
    assert.ok(context.scenePlan.referenceTechniques.every(item => item.sourceBook === '剑烛大荒'));
    assert.match(context.writingSystem, /已复核精读方法/);
    assert.doesNotMatch(context.writingSystem, /不应采用的旧结论|严格控制在0至2处/);
    assert.deepEqual(storeFiles(), before);
    assert.equal(loadReviewedRouteAssets({ routeId: 'jianzhu' }).status, 'unverified-builtin');
  } finally {
    if (readingLab) await readingLab.close();
    if (fileRepository) await fileRepository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('route retrieval never falls back to another novel and prompts contain methods instead of source plot', () => {
  for (const [routeId, title] of [['jianzhu', '剑烛大荒'], ['yuanshi', '元始法则']]) {
    const scenes = engine.retrieveCorpusScenes('xuanhuan', '完全不匹配的矿站任务', 2, { sourceTitle: title });
    assert.ok(scenes.length > 0);
    assert.ok(scenes.every(scene => scene.title === title));
    assert.doesNotMatch(engine.NARRATIVE_ROUTES[routeId].generationPrompt, /李唯一|赵勐|道祖太极鱼|定江府|古老黑矛|2~5|0~2/);
  }
  assert.deepEqual(engine.retrieveCorpusScenes('xuanhuan', '小说', 2, { sourceTitle: '不存在的书目' }), []);
});
