'use strict';

const crypto = require('node:crypto');

const DEFAULT_TEMPERATURES = [0.82, 0.95, 1.05];
const DEFAULT_REWRITE_ROUNDS = 2;
const DEFAULT_SEGMENT_REPAIR_ROUNDS = 3;
const DEFAULT_REWRITE_TEMPERATURE = 1.0;

function parseTemperatures(raw) {
  const source = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const list = source.map(value => Number(value)).filter(n => Number.isFinite(n) && n > 0 && n <= 2);
  return list.length ? list.slice(0, 6) : DEFAULT_TEMPERATURES.slice();
}

function parseRounds(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(4, Math.floor(n))) : DEFAULT_REWRITE_ROUNDS;
}

function parseSegmentRepairRounds(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.floor(n))) : DEFAULT_SEGMENT_REPAIR_ROUNDS;
}

function makeRequestId(base, label) {
  const seed = `${String(base || '').trim()}|${label}|${crypto.randomBytes(16).toString('hex')}`;
  return 'req_' + crypto.createHash('sha256').update(seed).digest('hex').slice(0, 40);
}

function summarize(report) {
  if (!report || !report.ok) return { status: report && report.status, error: report && report.error };
  return {
    greenRatio: report.greenRatio,
    aiScore: report.aiScore,
    riskConfidence: report.riskConfidence,
    segments: Array.isArray(report.segments) ? report.segments.map(segment => ({
      label: segment.label,
      aigc: segment.aigc,
      chars: segment.text ? segment.text.length : 0
    })) : []
  };
}

function createZhuqueClosedLoopService({
  compileDraftPrompt,
  buildDraftRequest,
  buildHumanizePassMessages,
  detectZhuque,
  zhuqueGateReached,
  defaultModelId = 'gpt-6-luna'
}) {
  async function run({ authToken, user, input = {}, callModel, env = {} }) {
    if (typeof callModel !== 'function') throw new Error('缺少模型调用能力');
    // seedText 模式：以用户粘贴的已有文本为起点做改写，跳过从零生成候选的阶段。
    // 用于「去 AI 味改写」的朱雀深度模式——把待改写正文当成一个候选直接进入
    // 检测 → humanize 改写 → 定点修补循环，省掉多温度生成阶段的模型调用。
    const seedText = String(input.seedText || '').trim();
    const seedMode = Boolean(seedText);
    const request = {
      modelId: String(input.modelId || defaultModelId).trim(),
      novelGenre: String(input.novelGenre || input.genre || '通用文学').trim(),
      targetChars: Number(input.targetChars) > 0 ? Math.floor(Number(input.targetChars)) : (seedMode ? seedText.length : 1600),
      disableLivingExemplars: true,
      useCompositionV3: false,
      userInstruction: String(input.userInstruction || input.prompt || '').trim() || (seedMode ? '改写下面的文本。' : '写一段小说正文。')
    };
    const context = String(input.context || '').trim();
    const temperatures = parseTemperatures(input.temperatures || env.MOLAN_ZHUQUE_CANDIDATE_TEMPERATURES);
    const rewriteRounds = parseRounds(input.rewriteRounds != null ? input.rewriteRounds : env.MOLAN_ZHUQUE_REWRITE_ROUNDS);
    const segmentRepairRounds = parseSegmentRepairRounds(input.segmentRepairRounds != null ? input.segmentRepairRounds : env.MOLAN_ZHUQUE_SEGMENT_REPAIR_ROUNDS);
    const rewriteTemperature = Number(input.rewriteTemperature || env.MOLAN_ZHUQUE_REWRITE_TEMPERATURE) || DEFAULT_REWRITE_TEMPERATURE;
    const allGreenThreshold = {
      minGreenRatio: Number(env.MOLAN_ZHUQUE_MIN_GREEN_RATIO) || 0.99,
      maxSegmentAigc: Number(env.MOLAN_ZHUQUE_MAX_SEGMENT_AIGC) || 0.5
    };

    const candidates = [];
    if (seedMode) {
      // 用户粘贴的文本直接作为唯一候选，检测后进入改写循环。
      const report = await detectZhuque(seedText, { env });
      candidates.push({
        phase: 'seed',
        temperature: 0,
        text: seedText,
        report,
        aiScore: report && report.ok ? report.aiScore : 100,
        summary: summarize(report),
        usage: null
      });
    } else {
      for (const temperature of temperatures) {
        const compiled = compileDraftPrompt({ request, context });
        const draftReq = buildDraftRequest({ request, compiled, temperature });
        const output = await callModel(authToken, user, {
          modelId: request.modelId,
          requestId: makeRequestId(input.requestId, `candidate_${temperature}`),
          messages: draftReq.renderedPromptPackage.messages,
          temperature,
          maxTokens: draftReq.maxTokens || 3200,
          stage: 'writing',
          requireComplete: true,
          disableBenchmarkProtocol: true,
          targetChars: request.targetChars,
          genre: request.novelGenre,
          twoPassHumanize: false,
          forceHumanizePass: false,
          precompiledPrompt: true,
          presencePenalty: 0,
          frequencyPenalty: 0
        });
        const text = String(output && output.text || '').trim();
        if (!text) continue;
        const report = await detectZhuque(text, { env });
        candidates.push({
          phase: 'candidate',
          temperature,
          text,
          report,
          aiScore: report && report.ok ? report.aiScore : 100,
          summary: summarize(report),
          usage: output && output.usage || null
        });
      }
    }
    if (!candidates.length) throw new Error('所有候选生成失败');
    candidates.sort((a, b) => a.aiScore - b.aiScore);
    let best = candidates[0];

    const rewrites = [];
    for (let round = 0; round < rewriteRounds; round += 1) {
      if (zhuqueGateReached(best.report, allGreenThreshold)) break;
      const messages = buildHumanizePassMessages(best.text, {
        genre: request.novelGenre,
        aiFlavorReport: null,
        zhuqueReport: best.report,
        correctionScan: null,
        textureReport: null,
        includeLivingExemplars: false
      });
      const output = await callModel(authToken, user, {
        modelId: request.modelId,
        requestId: makeRequestId(input.requestId, `rewrite_${round + 1}`),
        messages,
        temperature: rewriteTemperature,
        maxTokens: 3200,
        stage: 'humanizer',
        requireComplete: true,
        disableBenchmarkProtocol: true,
        targetChars: request.targetChars,
        genre: request.novelGenre,
        twoPassHumanize: false,
        forceHumanizePass: false,
        presencePenalty: 0,
        frequencyPenalty: 0
      });
      const text = String(output && output.text || '').trim();
      if (!text) break;
      const report = await detectZhuque(text, { env });
      const entry = {
        phase: 'rewrite',
        round: round + 1,
        temperature: rewriteTemperature,
        text,
        report,
        aiScore: report && report.ok ? report.aiScore : 100,
        summary: summarize(report),
        usage: output && output.usage || null
      };
      rewrites.push(entry);
      if (entry.aiScore < best.aiScore) best = entry;
      if (zhuqueGateReached(best.report, allGreenThreshold)) break;
    }

    const segmentRepairs = [];
    for (let round = 0; round < segmentRepairRounds; round += 1) {
      if (zhuqueGateReached(best.report, allGreenThreshold)) break;
      const badSegments = (best.report && Array.isArray(best.report.segments) ? best.report.segments : [])
        .filter(segment => !segment.green || Number(segment.aigc) > allGreenThreshold.maxSegmentAigc);
      if (!badSegments.length || !Array.isArray(badSegments[0].position)) break;
      const bad = badSegments[0];
      const startAbs = Math.max(0, Number(bad.position[0]) || 0);
      const length = Math.max(1, Number(bad.position[1]) || (bad.text ? bad.text.length : 0));
      const windowStart = Math.max(0, startAbs - 220);
      const windowEnd = Math.min(best.text.length, startAbs + length + 220);
      const windowText = best.text.slice(windowStart, windowEnd);
      if (windowText.length < 350) break;
      const focusedReport = {
        ...best.report,
        segments: [{
          ...bad,
          position: [startAbs - windowStart, length]
        }]
      };
      const messages = buildHumanizePassMessages(windowText, {
        genre: request.novelGenre,
        aiFlavorReport: null,
        zhuqueReport: focusedReport,
        correctionScan: null,
        textureReport: null,
        includeLivingExemplars: false
      });
      const output = await callModel(authToken, user, {
        modelId: request.modelId,
        requestId: makeRequestId(input.requestId, `segment_${round + 1}`),
        messages,
        temperature: rewriteTemperature,
        maxTokens: 2400,
        stage: 'humanizer',
        requireComplete: true,
        disableBenchmarkProtocol: true,
        targetChars: windowText.length,
        genre: request.novelGenre,
        twoPassHumanize: false,
        forceHumanizePass: false,
        presencePenalty: 0,
        frequencyPenalty: 0
      });
      const fixed = String(output && output.text || '').trim();
      if (fixed.length < 300) continue;
      const candidateText = best.text.slice(0, windowStart) + fixed + best.text.slice(windowEnd);
      const candidateReport = await detectZhuque(candidateText, { env });
      const candidateScore = candidateReport && candidateReport.ok ? candidateReport.aiScore : 100;
      const entry = {
        round: round + 1,
        position: [windowStart, windowEnd],
        aiScore: candidateScore,
        summary: summarize(candidateReport)
      };
      segmentRepairs.push(entry);
      if (candidateScore < best.aiScore) {
        best = {
          phase: 'segment-repair',
          round: round + 1,
          temperature: rewriteTemperature,
          text: candidateText,
          report: candidateReport,
          aiScore: candidateScore,
          usage: output && output.usage || null
        };
      }
      if (zhuqueGateReached(best.report, allGreenThreshold)) break;
    }

    return {
      ok: true,
      mode: seedMode ? 'seed' : 'generate',
      text: best.text,
      allGreen: zhuqueGateReached(best.report, allGreenThreshold),
      selected: { phase: best.phase, temperature: best.temperature, round: best.round || 0, aiScore: best.aiScore },
      report: summarize(best.report),
      candidates: candidates.map(candidate => ({ phase: candidate.phase, temperature: candidate.temperature, aiScore: candidate.aiScore, summary: candidate.summary })),
      rewrites: rewrites.map(rewrite => ({ round: rewrite.round, aiScore: rewrite.aiScore, summary: rewrite.summary })),
      segmentRepairs,
      usage: best.usage || null
    };
  }

  return { run };
}

module.exports = {
  DEFAULT_TEMPERATURES,
  DEFAULT_REWRITE_ROUNDS,
  parseTemperatures,
  parseRounds,
  parseSegmentRepairRounds,
  createZhuqueClosedLoopService
};
