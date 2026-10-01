'use strict';

function createCharacterMaterialReviewService({ DYNAMIC_PROMPT_MARKER, safeJsonParse, callMolanChat }) {
  function characterMaterialReviewContext(messages, request) {
    const source = request && typeof request === 'object' ? request : {};
    const characters = Array.isArray(source.characters) ? source.characters.map(character => ({
      name: String(character && character.name || ''),
      archetype: String(character && character.archetype || ''),
      source: String(character && character.archetypeSource || '')
    })).filter(character => character.name || character.archetype).slice(0, 12) : [];
    const userTask = (Array.isArray(messages) ? messages : [])
      .filter(message => message && message.role === 'user')
      .map(message => String(message.content || '').replace(DYNAMIC_PROMPT_MARKER, '').trim())
      .filter(Boolean)
      .slice(-3)
      .join('\n\n');
    return [
      '人物类型：' + (source.primaryArchetype || source.archetypes?.join('、') || '未指定'),
      '描写维度：' + (Array.isArray(source.dimensions) ? source.dimensions.join('、') : ''),
      '人物卡：' + (characters.length ? JSON.stringify(characters) : '无'),
      '场景与素材检索要求：' + (source.query || '无'),
      '当前用户任务：' + (userTask || '无')
    ].join('\n').slice(0, 6000);
  }

  /** Parse one strict model verdict for a strong character-material sample. */
  function parseCharacterMaterialSampleReview(result) {
    const payload = result && result.json && typeof result.json === 'object'
      ? result.json
      : safeJsonParse(result && result.text || '') || {};
    const review = payload && payload.review && typeof payload.review === 'object' ? payload.review : payload;
    const issues = Array.isArray(review && review.issues) ? review.issues.map(String).filter(Boolean).slice(0, 8) : [];
    const pass = review && review.pass === true && review.suitable === true && review.errorFree === true && issues.length === 0;
    return {
      passed: pass,
      suitable: review && review.suitable === true,
      errorFree: review && review.errorFree === true,
      issues,
      reason: String(review && review.reason || (pass ? '符合当前语境且未发现明显错误' : '模型未确认样本同时符合语境且无明显错误')).slice(0, 500)
    };
  }

  /** Review every strong sample with the selected model before it can enter the writing prompt. */
  async function reviewCharacterMaterialSamples(authToken, user, materialResult, messages, modelId) {
    const samples = materialResult && Array.isArray(materialResult.samples) ? materialResult.samples : [];
    const request = materialResult && materialResult.request || {};
    if (request.mode !== 'strong' || !samples.length) {
      return {
        approvedIds: [],
        audit: { required: false, status: 'not_required', checkedCount: 0, passedCount: 0, rejectedCount: 0, calls: [] }
      };
    }
    const context = characterMaterialReviewContext(messages, request);
    const approvedIds = [];
    const calls = [];
    for (const sample of samples) {
      const prompt = [
        '当前写作上下文：',
        context,
        '',
        '待审匿名原文样本：',
        `样本 ID：${sample.id}`,
        `样本人物类型：${sample.archetype || '未标注'}`,
        `样本描写维度：${sample.dimension || '未标注'}`,
        `样本文本：${sample.text}`,
        '',
        '请重点逐条检查：',
        '1. 是否能服务当前人物类型、描写维度和写作语境；',
        '2. 是否存在错别字、病句、指代不明、标点不闭合、抓取截断、匿名化占位符破坏语法或其他明显文本错误；',
        '3. 是否含有不应进入通用素材的敏感表达、原作专属术语或与当前任务冲突的内容；',
        '4. 只有同时适配语境且确认没有明显错误才通过，不确定必须不通过。',
        '只返回 JSON：{"review":{"pass":true,"suitable":true,"errorFree":true,"issues":[],"reason":""}}。不要改写或复述样本。'
      ].join('\n');
      let reviewUsage = null;
      try {
        const result = await callMolanChat(authToken, user, {
      thinking: false, reasoningEffort: 'none',
          system: '你是墨阑 strong 原文样本引用审校器。你的任务是决定一条匿名化文学样本能否在当前写作任务中被引用。必须严格检查语境适配性和文本错误，结论不确定时拒绝。',
          userPrompt: prompt,
          maxTokens: 420,
          jsonMode: true,
          modelId,
          stage: 'single',
          timeoutMs: 120000,
          temperature: 0.1,
          promptVersion: 'character-material-review-v1'
        });
        const usage = result && result.usage;
        reviewUsage = usage || null;
        if (!usage || typeof usage.totalTokens !== 'number' || !Number.isFinite(usage.totalTokens) || usage.totalTokens < 0 ||
            typeof usage.creditCost !== 'number' || !Number.isFinite(usage.creditCost) || usage.creditCost < 0 ||
            !['exact', 'settled'].includes(String(usage.billingStatus || '').toLowerCase())) {
          throw new Error('样本复核用量或费用未确认，禁止采纳');
        }
        const verdict = parseCharacterMaterialSampleReview(result);
        if (verdict.passed) approvedIds.push(String(sample.id));
        calls.push({
          sampleId: String(sample.id),
          status: verdict.passed ? 'passed' : 'rejected',
          suitable: verdict.suitable,
          errorFree: verdict.errorFree,
          issues: verdict.issues,
          reason: verdict.reason,
          requestId: result.usage && result.usage.requestId || '',
          totalTokens: usage.totalTokens,
          creditCost: usage.creditCost,
          billingStatus: usage.billingStatus
        });
      } catch (error) {
        calls.push({ sampleId: String(sample.id), status: 'unavailable', suitable: false, errorFree: false, issues: [],
          providerUsage: reviewUsage, reason: '样本引用前模型复核失败：' + String(error && error.message || error).slice(0, 400) });
      }
    }
    const passedCount = calls.filter(call => call.status === 'passed').length;
    return {
      approvedIds,
      audit: {
        required: true,
        status: calls.some(call => call.status === 'unavailable') ? 'partial' : 'completed',
        version: 'character-material-review-v1',
        modelId,
        checkedCount: calls.length,
        passedCount,
        rejectedCount: calls.filter(call => call.status === 'rejected').length,
        unavailableCount: calls.filter(call => call.status === 'unavailable').length,
        calls
      }
    };
  }
  return { characterMaterialReviewContext, parseCharacterMaterialSampleReview, reviewCharacterMaterialSamples };
}

module.exports = { createCharacterMaterialReviewService };
