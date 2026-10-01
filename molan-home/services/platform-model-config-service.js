'use strict';
const { assertPlatformConfigPromotion } = require('../lib/evolution/platform-config-gate');

function createPlatformModelConfigService({ fs, path, PLATFORM_CONFIG_FILE, normalizeConfiguredModel, findPlatformModel, normalizeModelCreditRate, getModelPolicy, setModelPolicy }) {
  function readPlatformConfig() {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(PLATFORM_CONFIG_FILE, 'utf-8'));
    } catch (_) {
      throw new Error('平台模型配置文件不可用');
    }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('平台模型配置文件格式错误');
    return cfg;
  }
  
  function writePlatformConfig(cfg) {
    if (!fs.existsSync(path.dirname(PLATFORM_CONFIG_FILE))) fs.mkdirSync(path.dirname(PLATFORM_CONFIG_FILE), { recursive: true });
    const tmp = PLATFORM_CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8');
    fs.renameSync(tmp, PLATFORM_CONFIG_FILE);
  }
  
  function saveModelPolicy(defaultModel, qualityEvidence) {
    const nextDefaultModel = normalizeConfiguredModel(defaultModel);
    if (!nextDefaultModel) throw new Error('平台尚未配置可用模型');
    assertPlatformConfigPromotion({ kind: 'default-model', proposed: nextDefaultModel, evidence: qualityEvidence });
    const cfg = readPlatformConfig();
    cfg.modelPolicy = { ...(cfg.modelPolicy || {}), defaultModel: nextDefaultModel };
    writePlatformConfig(cfg);
    setModelPolicy({ ...getModelPolicy(), defaultModel: nextDefaultModel });
    return nextDefaultModel;
  }
  
  function savePlatformModelRates(rates) {
    if (!Array.isArray(rates) || rates.length === 0) throw new Error('至少需要提交一个模型积分费率');
    const updates = [];
    const seen = new Set();
    for (const item of rates) {
      const modelId = String(item && item.modelId || '').trim();
      if (!modelId || seen.has(modelId)) throw new Error('模型积分费率列表包含无效或重复模型');
      const model = findPlatformModel(modelId);
      if (!model) throw new Error('模型不存在或未配置');
      seen.add(modelId);
      updates.push({
        modelId,
        creditsPer1k: normalizeModelCreditRate(item.creditsPer1k),
        previousCreditsPer1k: model.creditsPer1k
      });
    }
  
    const cfg = readPlatformConfig();
    if (!Array.isArray(cfg.platformModels)) throw new Error('平台模型配置文件中没有模型列表');
    const updateMap = new Map(updates.map(item => [item.modelId, item.creditsPer1k]));
    const found = new Set();
    const nextPlatformModels = cfg.platformModels.map(item => {
      const modelId = item && String(item.id || '');
      if (!updateMap.has(modelId)) return item;
      found.add(modelId);
      return { ...item, creditsPer1k: updateMap.get(modelId) };
    });
    if (found.size !== updates.length) throw new Error('模型不存在或未配置');
  
    // 所有倍率都校验成功后才写入，避免批量修改出现半成功状态。
    writePlatformConfig({ ...cfg, platformModels: nextPlatformModels });
    for (const update of updates) {
      const model = findPlatformModel(update.modelId);
      if (model) model.creditsPer1k = update.creditsPer1k;
    }
    return updates;
  }
  
  function savePlatformModelRate(modelId, value) {
    const updated = savePlatformModelRates([{ modelId, creditsPer1k: value }]);
    return { modelId: updated[0].modelId, creditsPer1k: updated[0].creditsPer1k };
  }
  return { saveModelPolicy, savePlatformModelRates, savePlatformModelRate };
}

module.exports = { createPlatformModelConfigService };
