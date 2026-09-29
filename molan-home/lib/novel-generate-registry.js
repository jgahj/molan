/**
 * @file novel-generate-registry.js
 * 统一小说 Generate 蓝图与规格注册中心 (Universal Novel Generate Registry)
 * 统一管理 1,205 部小说的 Generate 规格配置，动态映射文风基因与叙事管线
 */

const fs = require('fs');
const path = require('path');
const { STYLE_ARCHETYPES } = require('./style-archetypes');
const { detectNovelStyle } = require('./style-detector');

const INDEX_FILE = path.join(__dirname, '../data/pipelines/library-index.json');

class NovelGenerateRegistry {
  constructor() {
    this.indexData = null;
    this.novelMap = new Map();
    this._loadIndex();
  }

  _loadIndex() {
    try {
      if (fs.existsSync(INDEX_FILE)) {
        const raw = fs.readFileSync(INDEX_FILE, 'utf8');
        this.indexData = JSON.parse(raw);
        for (const item of this.indexData.pipelines || []) {
          this.novelMap.set(item.bookId, item);
          this.novelMap.set(item.bookTitle, item);
        }
      }
    } catch (err) {
      console.warn('[NovelGenerateRegistry] Failed to load library index:', err.message);
    }
  }

  /**
   * 根据书名或 ID 获取专属 Generate 规范
   * @param {string} bookIdOrTitle 书名或 ID
   * @param {Object} [overrideContext] 可选覆盖参数
   * @returns {Object} 结构化 Generate 规格
   */
  getNovelGenerateSpec(bookIdOrTitle, overrideContext = {}) {
    const novelEntry = this.novelMap.get(bookIdOrTitle);
    const title = novelEntry ? novelEntry.bookTitle : String(bookIdOrTitle || '未命名小说');
    const category = novelEntry ? novelEntry.category : (overrideContext.category || '通用');
    const family = novelEntry ? novelEntry.family : (overrideContext.family || '通用现实');

    // 结合大纲和书名智能识别文风大类
    const queryInput = overrideContext.queryText || overrideContext.prompt || overrideContext.outline || title;
    const detected = detectNovelStyle(queryInput, {
      bookTitle: title,
      category,
      genreFamily: family
    });

    return {
      bookId: novelEntry ? novelEntry.bookId : null,
      bookTitle: title,
      category,
      family,
      pipelinePath: novelEntry ? novelEntry.pipelinePath : null,
      styleArchetype: detected.styleArchetype,
      styleArchetypeDef: detected.styleArchetypeDef,
      tone: detected.tone,
      voiceSpec: detected.voiceSpec,
      narrativeDirectives: detected.narrativeDirectives,
      wordBounds: detected.wordBounds
    };
  }

  /**
   * 根据题材子类与文风获取通用 Generate 规范
   */
  getGenreGenerateSpec(family, subcategory, styleArchetypeKey) {
    const archetype = STYLE_ARCHETYPES[styleArchetypeKey] || STYLE_ARCHETYPES.workplace_inversion || Object.values(STYLE_ARCHETYPES)[0];
    return {
      family: family || '通用现实',
      subcategory: subcategory || '通用',
      styleArchetype: archetype.id,
      styleArchetypeDef: archetype,
      tone: archetype.tone,
      voiceSpec: archetype.voiceSpec,
      narrativeDirectives: archetype.narrativeDirectives,
      wordBounds: archetype.defaultWordBounds
    };
  }
}

const globalRegistry = new NovelGenerateRegistry();

module.exports = {
  NovelGenerateRegistry,
  globalRegistry
};
