'use strict';

/**
 * genre-registry.js
 * ---------------------------------------------------------------------------
 * 统一题材母类注册表 (Unified Genre Registry)
 *
 * 遵循第九、十、十二条规范：
 * 1. 唯一题材真理源 (Single Source of Truth)，统一包含 9 大母类（含通用现实）；
 * 2. 路由名称与范文解耦为“可计算的写作机制”，拒绝将作者/作品名作为硬编码依赖；
 * 3. 前端与后端均从本源获取，消除 GENRE_FAMILY_MAP 漂移。
 * ---------------------------------------------------------------------------
 */

const GENRE_CATALOG = Object.freeze({
  xuanhuan: {
    id: 'xuanhuan',
    title: '玄幻修真',
    description: '宗门秩序、资源争夺、天道代偿与升级体系',
    subcategories: ['玄幻', '传统玄幻', '玄幻脑洞', '东方仙侠', '仙侠', '都市修真', '武侠'],
    defaultRoute: 'cautious_survival',
    routes: [
      {
        value: 'cautious_survival',
        legacyValue: 'fanren',
        label: '散修生计与谨慎藏拙 · 资源约束型生存',
        mechanism: 'low_profile_cultivation, resource_economy, risk_first_decision'
      },
      {
        value: 'clan_lineage_sacrifice',
        legacyValue: 'xuanjian',
        label: '宗族谱系与族运牺牲 · 家族群像因果',
        mechanism: 'dynasty_ancestry, collective_destiny, generation_debt'
      },
      {
        value: 'industrial_cultivation',
        legacyValue: 'yuanshi',
        label: '重型战舰与修真工业 · 超凡技术集成',
        mechanism: 'heavy_formation_engineering, institutional_mobilization'
      },
      {
        value: 'ancient_market_mechanic',
        legacyValue: 'jianzhu',
        label: '大荒机关与市井互嵌 · 烟火生存质感',
        mechanism: 'folk_craftsmanship, daily_economy, localized_friction'
      }
    ]
  },
  urban_martial: {
    id: 'urban_martial',
    title: '都市高武',
    description: '官方规制、行会考核、现代治安与实战攻防',
    subcategories: ['都市高武', '都市', '都市脑洞', '都市日常', '都市种田', '战神赘婿'],
    defaultRoute: 'urban_grind',
    routes: [
      {
        value: 'official_regulation_tactics',
        legacyValue: 'urban_grind',
        label: '官方规制与实战攻防 · 治安体系内成长',
        mechanism: 'institutional_audit, street_combat_tactics, law_pressure'
      },
      {
        value: 'coastal_harvest_fieldwork',
        legacyValue: 'yucun_1982',
        label: '沿海捕捞与潮汐考据 · 生活流与年代经济',
        mechanism: 'ecological_chronicle, empirical_trade, family_labor'
      },
      {
        value: 'heavy_industry_pioneering',
        legacyValue: 'daguo_junken',
        label: '重工拓荒与集体纪律 · 组织动员与意志承压',
        mechanism: 'collective_discipline, environmental_conquest'
      }
    ]
  },
  scifi_apocalypse: {
    id: 'scifi_apocalypse',
    title: '科幻末世',
    description: '避难所工业、魔导工业化、深空尺度与技术代偿',
    subcategories: ['科幻', '科幻末世', '星光璀璨'],
    defaultRoute: 'hard_survival',
    routes: [
      {
        value: 'wasteland_industrial_recovery',
        legacyValue: 'hard_survival',
        label: '废土避难所工业复苏 · 硬核物资与生产自救',
        mechanism: 'shelter_resource_grid, engineering_bottleneck, tech_decay'
      },
      {
        value: 'magic_industrial_enlightenment',
        legacyValue: 'dawn_blade',
        label: '魔导工业化与深空神明去魅 · 生产力重塑文明',
        mechanism: 'industrial_demystification, civil_engineering, godhead_logic'
      },
      {
        value: 'genetic_deep_space_scale',
        legacyValue: 'swallow_star',
        label: '基因武者考核与深空尺度 · 战力量化与宏大跨越',
        mechanism: 'biological_breakthrough, cosmic_hierarchy'
      }
    ]
  },
  suspense: {
    id: 'suspense',
    title: '悬疑惊悚',
    description: '民俗禁忌、认知反转、空间规则与心理递进',
    subcategories: ['悬疑灵异', '悬疑脑洞', '女频悬疑', '悬疑', '推理'],
    defaultRoute: 'folklore_investigation',
    routes: [
      {
        value: 'folklore_investigation',
        legacyValue: 'folklore_investigation',
        label: '民俗异闻与心理递进 · 地方志式怪异调查',
        mechanism: 'regional_taboo, progressive_dread, evidence_chain'
      },
      {
        value: 'river_folk_secrets',
        legacyValue: 'laoshiren',
        label: '江湖捞尸门道与民俗禁忌 · 行业规矩与亡者印记',
        mechanism: 'occupational_rules, water_domain_physics, karma_token'
      },
      {
        value: 'spatial_rule_horror',
        legacyValue: 'rule_horror',
        label: '空间规则怪谈与心理压榨 · 严苛机制与逻辑死局',
        mechanism: 'strict_boundary_rules, psychological_compression'
      }
    ]
  },
  history: {
    id: 'history',
    title: '历史古代',
    description: '军团大阵、天下大势、隐蔽战线与文书制度',
    subcategories: ['历史', '历史古代', '历史脑洞', '抗战谍战', '军事'],
    defaultRoute: 'dynasty_friction',
    routes: [
      {
        value: 'dynasty_legion_grand_strategy',
        legacyValue: 'dynasty_friction',
        label: '军团大阵与天下大势 · 宏观博弈与制度摩擦',
        mechanism: 'grain_logistics, factional_friction, campaign_scale'
      },
      {
        value: 'covert_cipher_camouflage',
        legacyValue: 'spy_years',
        label: '隐蔽战线密电破译与伪装 · 细节考据与命悬一线',
        mechanism: 'intelligence_clashing, information_delay, dual_identity'
      }
    ]
  },
  western_fantasy: {
    id: 'western_fantasy',
    title: '西方奇幻',
    description: '序列魔药、智械军团、异界规则与契约代价',
    subcategories: ['奇幻', '西方奇幻', '诸天无限', '游戏', '游戏体育', '轻小说', '动漫衍生', '男频衍生', '女频衍生'],
    defaultRoute: 'sequence_cost',
    routes: [
      {
        value: 'potion_sequence_order_cost',
        legacyValue: 'sequence_cost',
        label: '秩序隐秘与魔药代价 · 规则契约与疯狂抵御',
        mechanism: 'order_mystery, madness_barrier, potion_digestion'
      },
      {
        value: 'machinist_blueprint_forging',
        legacyValue: 'super_mechanic',
        label: '机械图纸锻造与智械军团 · 产线扩张与技术矩阵',
        mechanism: 'blueprint_iteration, drone_swarm_production'
      },
      {
        value: 'hunter_contract_combat',
        legacyValue: 'reincarnation_paradise',
        label: '猎杀者契约与刀术搏杀 · 纯粹生死与极致锋芒',
        mechanism: 'blade_mastery, world_settlement, lethal_risk'
      }
    ]
  },
  ancient_romance: {
    id: 'ancient_romance',
    title: '古言世情',
    description: '内宅生计、账目周旋、宗法礼教与势均力敌情感',
    subcategories: ['古言脑洞', '古风世情', '宫斗宅斗', '民国言情', '年代', '玄幻言情'],
    defaultRoute: 'mansion_secrets',
    routes: [
      {
        value: 'mansion_financial_survival',
        legacyValue: 'mansion_secrets',
        label: '月例账目与内宅生存策略 · 宗法礼教下的利益博弈',
        mechanism: 'household_accounting, etiquette_constraint, subtle_retaliation'
      }
    ]
  },
  modern_romance: {
    id: 'modern_romance',
    title: '现代言情',
    description: '职场对赌、投行博弈、生活细节与情感拉扯',
    subcategories: ['豪门总裁', '现言脑洞', '青春甜宠', '职场婚恋', '快穿', '种田', '体育'],
    defaultRoute: 'urban_emotion',
    routes: [
      {
        value: 'corporate_duel_subtle_romance',
        legacyValue: 'urban_emotion',
        label: '投行对赌与势均力敌情感 · 职场博弈中的心理防线',
        mechanism: 'corporate_due_diligence, emotional_subtext, professional_boundaries'
      }
    ]
  },
  universal: {
    id: 'universal',
    title: '通用现实',
    description: '现实生活流、纯文学叙事、跨题材中立戏剧结构',
    subcategories: ['通用', '剧情', '现实', '文学', '无题材', '其他'],
    defaultRoute: 'neutral_dramatic',
    routes: [
      {
        value: 'neutral_dramatic_realism',
        legacyValue: 'neutral_dramatic',
        label: '现实情境与戏剧阻力 · 遵循生活本相的克制叙事',
        mechanism: 'human_texture, behavioral_hesitation, grounded_observation'
      }
    ]
  }
});

/**
 * 获取全量题材目录 (供后端 API 与前端界面直接渲染)
 */
function getGenreCatalog() {
  return GENRE_CATALOG;
}

/**
 * 根据母类 ID 获取题材配置
 */
function getGenreFamily(familyId) {
  const key = String(familyId || '').trim();
  return GENRE_CATALOG[key] || null;
}

/**
 * 将任意子分类或用户输入名称解析为标准母类 ID
 */
function resolveGenreFamilyId(inputGenre = '') {
  const raw = String(inputGenre || '').trim().toLowerCase();
  if (!raw) return 'universal';

  // 1. 直接命中母类 key
  if (GENRE_CATALOG[raw]) return raw;

  // 2. 匹配中文 title 或子类别
  for (const [key, family] of Object.entries(GENRE_CATALOG)) {
    if (family.title.toLowerCase() === raw) return key;
    if (family.subcategories.some(sub => sub.toLowerCase() === raw || raw.includes(sub.toLowerCase()))) {
      return key;
    }
  }

  return 'universal';
}

/**
 * 校验并规范化路由标识 (支持新机制 ID 与旧版 legacy 别名双向兼容)
 */
function normalizeGenreRoute(familyId, routeId) {
  const family = getGenreFamily(familyId) || GENRE_CATALOG.universal;
  const targetRoute = String(routeId || '').trim();

  if (!targetRoute || targetRoute === 'auto') return 'auto';

  for (const r of family.routes) {
    if (r.value === targetRoute || r.legacyValue === targetRoute) {
      return r.value;
    }
  }

  return family.defaultRoute;
}

module.exports = {
  GENRE_CATALOG,
  getGenreCatalog,
  getGenreFamily,
  resolveGenreFamilyId,
  normalizeGenreRoute
};
