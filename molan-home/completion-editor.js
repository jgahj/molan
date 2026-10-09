  const GENRE_FAMILY_MAP = {
    xuanhuan_xianxia: {
      title: '玄幻仙侠',
      archetypes: [
        { value: 'yandere_harem_cultivation', label: '病娇反差 / 多女主修罗场与破防流' },
        { value: 'classical_gritty_xianxia', label: '古典仙侠 / 天崩开局与实感求生流' },
        { value: 'peerless_slaughter_tower', label: '传统玄幻 / 丹田被废与神塔逆袭流' }
      ]
    },
    urban_martial: {
      title: '都市高武',
      archetypes: [
        { value: 'supernatural_tactics_order', label: '官方规制 / 历史超凡与战术攻防流' },
        { value: 'street_calculating_martial', label: '低武市井 / 门派拜馆与冷硬算计流' }
      ]
    },
    urban_life: {
      title: '都市现实',
      archetypes: [
        { value: 'reformed_restaurant_era', label: '年代生活 / 破产餐馆与市井烟火流' },
        { value: 'sports_tactics_legend', label: '竞技体坛 / 职业球探与逆风蜕变流' }
      ]
    },
    scifi_apocalypse: {
      title: '科幻末世',
      archetypes: [
        { value: 'planetary_gene_academy', label: '高维深空 / 基因考核与宇宙尺度流' },
        { value: 'esports_goat_datacrush', label: '电竞游戏 / 数据复盘与战队崛起流' }
      ]
    },
    suspense_mystery: {
      title: '悬疑惊悚',
      archetypes: [
        { value: 'folk_yinyang_memoir', label: '中式民俗 / 阴阳行当与水旱禁忌流' },
        { value: 'tomb_exploration_secrets', label: '秘境古墓 / 九门迷局与血脉契约流' },
        { value: 'infinite_rule_insanity', label: '规则怪谈 / 精神病反卷与空间压榨流' }
      ]
    },
    history_military: {
      title: '历史军事',
      archetypes: [
        { value: 'imposter_court_official', label: '历史权谋 / 冒名入仕与官场生存流' },
        { value: 'dynasty_grand_narrative', label: '王朝争霸 / 运河关隘与沙盘推演流' },
        { value: 'military_industrial_overhaul', label: '抗战兵工 / 车间机床与技术拓荒流' }
      ]
    },
    ancient_romance: {
      title: '古言世情',
      archetypes: [
        { value: 'rebirth_noble_vengeance', label: '高门重生 / 摄政王契约与清醒夺权流' },
        { value: 'empress_court_heir', label: '女帝掌朝 / 皇权博弈与帝姬谋略流' }
      ]
    },
    modern_romance: {
      title: '现言职场',
      archetypes: [
        { value: 'capital_circle_sensual_duel', label: '京圈权贵 / 纯欲对弈与极限拉扯流' },
        { value: 'gloomy_ghost_magnet', label: '病娇阴湿 / 极致占有与反向驯服流' }
      ]
    },
    light_novel: {
      title: '轻小说衍生',
      archetypes: [
        { value: 'corporate_magical_girl', label: '社畜反差 / 疲惫中年与魔法非日常流' },
        { value: 'anime_reincarnation_overlord', label: '诸天扮演 / 满级大号与降维碾压流' }
      ]
    },
    western_fantasy: {
      title: '西方奇幻',
      archetypes: [
        { value: 'sequence_order_mystery', label: '诡秘秩序 / 魔药代价与隐秘低语流' },
        { value: 'fake_lord_domain_conquest', label: '异界领主 / 领地经营与帝国博弈流' }
      ]
    }
  };

  // 小说题材分组字典（7大主流大类 + 垂直赛道）
  const NOVEL_GENRE_GROUPS = [
    {
      group: '幻想类（虚构世界观体系）',
      items: [
        { value: 'xuanhuan', label: '玄幻 (东方武道 / 灵气宗门 / 突破争霸)' },
        { value: 'xianxia', label: '仙侠 (长生求道 / 渡劫飞升 / 道法因果)' },
        { value: 'qihuan', label: '奇幻 (西方魔幻 / 魔法骑士 / 种族战争)' },
        { value: 'scifi', label: '科幻 (硬核猜想 / 星际文明 / 智脑跃迁)' },
        { value: 'infinite', label: '无限流 (副本穿梭 / 规则求生 / 团队协作)' },
        { value: 'apocalypse', label: '末世/末日 (废土生存 / 资源争夺 / 废土基建)' },
        { value: 'horror', label: '灵异/惊悚 (中式民俗 / 鬼怪凶宅 / 禁忌探秘)' }
      ]
    },
    {
      group: '现实向类（依托真实世界框架）',
      items: [
        { value: 'urban', label: '都市 (现代商战 / 异能重生 / 职场生活)' },
        { value: 'campus', label: '校园 (青春成长 / 学业竞赛 / 青涩暗恋)' },
        { value: 'era', label: '年代文 (改革潮头 / 家庭经营 / 烟火致富)' },
        { value: 'realism', label: '现实题材 (市井烟火 / 乡土民情 / 人物困境)' }
      ]
    },
    {
      group: '古代背景类',
      items: [
        { value: 'ancient_romance', label: '古言 (古代闺阁 / 后宅生杀 / 家族权谋)' },
        { value: 'history', label: '历史 (真实朝代 / 沙盘争霸 / 治世安民)' },
        { value: 'farming', label: '种田文 (买田置产 / 兴旺家族 / 慢节奏发育)' }
      ]
    },
    {
      group: '情感言情类',
      items: [
        { value: 'modern_romance', label: '现言甜宠/虐恋 (破镜重圆 / 豪门对弈)' },
        { value: 'ancient_romance_sub', label: '古风言情 (世家深闺 / 先婚后爱)' },
        { value: 'republic_romance', label: '民国言情 (烽火军阀 / 乱世家国情仇)' }
      ]
    },
    {
      group: '悬疑推理类',
      items: [
        { value: 'deduction_pure', label: '本格推理 (密室杀人 / 机械诡计 / 逻辑至上)' },
        { value: 'social_deduction', label: '社会派推理 (人性剖析 / 犯罪动机 / 社会议题)' },
        { value: 'criminal_investigation', label: '刑侦探案 (警方一线 / 法医物证 / 证据链)' },
        { value: 'folk_suspense', label: '民俗悬疑 (山野怪谈 / 宗族旧案 / 中式恐怖)' }
      ]
    },
    {
      group: '武侠类',
      items: [
        { value: 'traditional_wuxia', label: '传统武侠 (名门恩怨 / 正邪抗衡 / 侠义骨气)' },
        { value: 'new_wuxia', label: '新武侠 (底层游侠 / 市井刀客 / 快意恩仇)' },
        { value: 'chivalric_court', label: '江湖权谋 (朝堂暗桩 / 锦衣谍影 / 庙堂江湖)' }
      ]
    },
    {
      group: '特色小众与垂直赛道',
      items: [
        { value: 'gaming', label: '游戏竞技 (电竞职业 / 网游开荒 / 战术操作)' },
        { value: 'gourmet', label: '美食文 (厨艺比拼 / 食材白描 / 治愈经营)' },
        { value: 'folk_urban_legend', label: '民俗怪谈 (东北出马 / 湘西赶尸 / 禁忌规矩)' },
        { value: 'rule_weird', label: '规则怪谈 (不可直视 / 认知污染 / 密闭求生)' },
        { value: 'lovecraft_cthulhu', label: '克苏鲁/诡秘 (魔药序列 / 理智SAN值 / 古神低语)' },
        { value: 'cyber_steampunk', label: '蒸汽/赛博朋克 (霓虹义体 / 齿轮反差 / 反乌托邦)' },
        { value: 'industry_pro', label: '行业文 (专业医生/律师/刑警硬核考据)' },
        { value: 'treasure_tomb', label: '鉴宝盗墓 (古玩捡漏 / 地宫机关 / 分金定穴)' }
      ]
    }
  ];

  // 写作风格分组字典（通俗流行、叙事质感、情绪表达、网文专属、名作实测）
  const WRITING_STYLE_GROUPS = [
    {
      group: '通俗流行类（网文主流）',
      items: [
        { value: 'cool_paced', label: '爽文文风 (直白干脆 / 冲突极速 / 即时满足)' },
        { value: 'accessible_direct', label: '小白文风 (通俗易懂 / 零认知门槛 / 心理直观)' },
        { value: 'light_novel', label: '轻小说文风 (日系对话 / 密集吐槽 / 轻快日常)' }
      ]
    },
    {
      group: '叙事质感类',
      items: [
        { value: 'realistic_restrained', label: '写实文风 (克制内敛 / 生活逻辑 / 细节刻画)' },
        { value: 'rustic_folk', label: '质朴乡土风 (接地气方言 / 泥土芳香 / 市井烟火)' },
        { value: 'gorgeous_rhetoric', label: '华丽辞藻风 (辞藻古雅 / 景物造境 / 声韵诗意)' },
        { value: 'cold_minimalist', label: '清冷极简风 (高度克制 / 短句留白 / 孤傲疏离)' },
        { value: 'heavy_epic', label: '厚重史诗风 (沉稳大气 / 宏大格局 / 群像调度)' }
      ]
    },
    {
      group: '情绪表达类',
      items: [
        { value: 'humorous_roast', label: '幽默诙谐/吐槽风 (喜剧反差 / 玩梗自嘲 / 爆笑搞笑)' },
        { value: 'dark_oppressive', label: '压抑暗黑风 (绝望宿命 / 人性残酷 / 代价沉重)' },
        { value: 'poetic_prose', label: '诗意散文风 (意象抒情 / 漫思从容 / 文学韵味)' },
        { value: 'dramatic_high_conflict', label: '戏剧强冲突风 (对白见血 / 情绪如火 / 矛盾激化)' }
      ]
    },
    {
      group: '网文专属细分文风',
      items: [
        { value: 'veteran_composed', label: '老白文风 (逻辑严密 / 拒绝降智 / 因果深长)' },
        { value: 'badass_reversal', label: '装逼流文风 (低调行事 / 侧面震惊 / 反差拉满)' },
        { value: 'fragmented_short', label: '碎片化短句风 (全短句 / 高频分段 / 疾速阅读)' },
        { value: 'delicate_lingering', label: '缱绻细腻风 (微表情动作 / 呼吸暗涌 / 极致拉扯)' },
        { value: 'hardcore_verified', label: '硬核干货风 (行业术语 / 设定考据 / 真实壁垒)' },
        { value: 'parody_meme', label: '戏仿/玩梗风 (解构经典 / 脑洞爆笑 / 反套路)' }
      ]
    },
    {
      group: '名作实测经典原型',
      items: [
        { value: 'yandere_harem_cultivation', label: '病娇反差 / 多女主修罗场与破防流' },
        { value: 'classical_gritty_xianxia', label: '古典仙侠 / 天崩开局与实感求生流' },
        { value: 'supernatural_tactics_order', label: '官方规制 / 历史超凡与战术攻防流' },
        { value: 'street_calculating_martial', label: '低武市井 / 门派拜馆与冷硬算计流' },
        { value: 'reformed_restaurant_era', label: '年代生活 / 破产餐馆与市井烟火流' },
        { value: 'sequence_order_mystery', label: '诡秘秩序 / 魔药代价与隐秘低语流' },
        { value: 'folk_yinyang_memoir', label: '中式民俗 / 阴阳行当与水旱禁忌流' },
        { value: 'rebirth_noble_vengeance', label: '高门重生 / 摄政王契约与清醒夺权流' }
      ]
    }
  ];

  // 章节功能分类字典（7大功能 + 黄金三章 + 结尾钩子）
  const CHAPTER_FUNCTION_GROUPS = [
    {
      group: '黄金三章与开篇破局',
      items: [
        { value: 'golden_ch1_hook', label: '黄金第1章·破局钩子章 (交代身份+抛出核心困境+留悬念)' },
        { value: 'golden_ch2_goldfinger', label: '黄金第2章·金手指落地章 (亮出外挂+明确目标+首个小冲突)' },
        { value: 'golden_ch3_first_cool', label: '黄金第3章·首秀爽点章 (首次破局+打出爽点+完成开篇闭环)' },
        { value: 'character_debut', label: '人物登场章 (引出新角色+鲜明性格+建立关系网)' },
        { value: 'worldview_setup', label: '世界观铺陈章 (结合剧情带出设定+避免说明文)' }
      ]
    },
    {
      group: '剧情推进类（故事主干）',
      items: [
        { value: 'conflict_push', label: '冲突推进章 (矛盾对抗推进 / 谈判博弈 / 局势升级)' },
        { value: 'mission_execution', label: '任务执行章 (落地行动 / 调查闯关 / 按计划执行)' },
        { value: 'info_reveal', label: '信息揭露章 (引爆伏笔 / 揭开真相 / 解密长线悬念)' },
        { value: 'plot_twist', label: '转折章 (局势突变反转 / 顺风遇险 / 绝境转机)' },
        { value: 'crucial_choice', label: '抉择章 (道德利益两难 / 走向分歧 / 人格弧光)' }
      ]
    },
    {
      group: '成长爽点类（核心情绪价值）',
      items: [
        { value: 'harvest_reward', label: '收获章 (宝物灵石入账 / 战利品清点 / 势力收编)' },
        { value: 'breakthrough_upgrade', label: '突破升级章 (境界跃迁 / 实力质变 / 解锁新技能)' },
        { value: 'face_slap', label: '打脸章 (先抑后扬 / 强势反制对手 / 兑现爽感)' }
      ]
    },
    {
      group: '过渡铺垫类（蓄力备战）',
      items: [
        { value: 'daily_foreshadow', label: '日常铺垫章 (休整复盘 / 暗藏伏笔 / 严防水文)' },
        { value: 'dialogue_intel', label: '对话信息章 (密谈商议 / 交换情报 / 商定战略)' },
        { value: 'time_skip', label: '时间跳跃章 (春秋笔法掠过 / 岁月沉淀 / 呈现新貌)' }
      ]
    },
    {
      group: '人物情感类（人物深度）',
      items: [
        { value: 'emotional_interaction', label: '情感互动章 (感情升温 / 产生误会 / 和解交心)' },
        { value: 'character_inner', label: '人物内心章 (心理独白 / 创伤剖析 / 深化弧光)' },
        { value: 'flashback_memory', label: '回忆闪回章 (往事穿插 / 前世今生 / 因果解释)' }
      ]
    },
    {
      group: '高潮收尾与结尾钩子',
      items: [
        { value: 'minor_climax', label: '小高潮章 (阶段决战 / 局部爆发 / 解决核心敌手)' },
        { value: 'major_climax', label: '大高潮章 (终极决战 / 所有阵营卷入 / 终极真相)' },
        { value: 'resolution_aftermath', label: '收尾解决章 (战后善后 / 利益分配 / 抚恤疗伤)' },
        { value: 'cliffhanger_hook', label: '悬念留尾章 (5大结尾钩子 / 危机反转断章 / 迫不及待追读)' },
        { value: 'volume_conclusion', label: '卷末收尾章 (全卷收束 / 人物沉淀 / 埋下卷引子)' },
        { value: 'story_ending', label: '全书结局章 (终局落幕 / 人物归宿 / 史诗余韵)' }
      ]
    },
    {
      group: '特殊结构章节',
      items: [
        { value: 'interlude', label: '插叙章 (跳出主角视角 / 幕后势力密谋)' },
        { value: 'side_story', label: '支线独立章 (核心配角遭遇 / 丰满群像)' },
        { value: 'episodic_unit', label: '单元剧章节 (独立单元故事 / 小结闭环)' }
      ]
    }
  ];

  // 该章侧重点选项
  const CHAPTER_FOCUS_OPTIONS = [
    { value: 'balanced', label: '综合推进 (剧情推进 / 节奏均衡)' },
    { value: 'dialogue', label: '对话博弈 (机锋对白 / 试探底线 / 信息差)' },
    { value: 'action', label: '动作战斗 (物理对抗 / 拳拳到肉 / 招式破坏)' },
    { value: 'environment', label: '环境氛围 (空间冷硬 / 感官沉浸 / 气氛压迫)' },
    { value: 'psychological', label: '心理暗涌 (反差内心 / 算计隐忍 / 情绪波澜)' },
    { value: 'tactics', label: '智斗谋略 (布局设套 / 借刀杀人 / 博弈推演)' },
    { value: 'suspense', label: '悬念破局 (伏笔收束 / 线索反转 / 危机迫近)' },
    { value: 'emotional', label: '情感拉扯 (羁绊旧事 / 外壳碎裂 / 傲娇暧昧)' },
    { value: 'farming', label: '种田经营 (资源核算 / 势力发育 / 功法参悟)' }
  ];

  function buildGenreFamilyOptions(state) {
    const curGenre = (state && (state.novelGenre || state.genreFamily || state.genre)) || 'all';
    const allOpt = `<option value="all" ${curGenre === 'all' || !curGenre ? 'selected' : ''}>全部 / 智能匹配 (auto)</option>`;
    const groupsHtml = NOVEL_GENRE_GROUPS.map(g => {
      const itemsHtml = g.items.map(item =>
        `<option value="${item.value}" ${curGenre === item.value ? 'selected' : ''}>${item.label}</option>`
      ).join('');
      return `<optgroup label="${g.group}">${itemsHtml}</optgroup>`;
    }).join('');
    return allOpt + groupsHtml;
  }

  function buildWritingStyleOptions(state) {
    const curStyle = (state && (state.writingStyle || state.archetypeOverride || state.styleArchetype)) || '';
    const autoOpt = `<option value="" ${!curStyle ? 'selected' : ''}>(自动匹配提示词 / 智能识别)</option>`;
    const groupsHtml = WRITING_STYLE_GROUPS.map(g => {
      const itemsHtml = g.items.map(item =>
        `<option value="${item.value}" ${curStyle === item.value ? 'selected' : ''}>${item.label}</option>`
      ).join('');
      return `<optgroup label="${g.group}">${itemsHtml}</optgroup>`;
    }).join('');
    return autoOpt + groupsHtml;
  }

  function buildChapterFunctionOptions(state) {
    const curFunc = (state && (state.chapterFunction || state.chapterPurpose)) || '';
    const autoOpt = `<option value="" ${!curFunc ? 'selected' : ''}>综合推进 (根据剧情自然推进)</option>`;
    const groupsHtml = CHAPTER_FUNCTION_GROUPS.map(g => {
      const itemsHtml = g.items.map(item =>
        `<option value="${item.value}" ${curFunc === item.value ? 'selected' : ''}>${item.label}</option>`
      ).join('');
      return `<optgroup label="${g.group}">${itemsHtml}</optgroup>`;
    }).join('');
    return autoOpt + groupsHtml;
  }

  function buildChapterFocusOptions(state) {
    const curFocus = (state && (state.chapterFocus || state.focus)) || 'balanced';
    return CHAPTER_FOCUS_OPTIONS.map(opt =>
      `<option value="${opt.value}" ${curFocus === opt.value ? 'selected' : ''}>${opt.label}</option>`
    ).join('');
  }

  const ENDING_HOOK_OPTIONS = [
    { value: '', label: '自然收束 (根据剧情自然落地)' },
    { value: 'crisis', label: '危机钩 (突发致命危机 / 生死一线 / 强敌迫近)' },
    { value: 'suspense', label: '悬念钩 (认知颠覆悬念 / 诡异物证 / 巨大问号)' },
    { value: 'twist', label: '反转钩 (局势惊天逆转 / 胜算化为圈套 / 攻守易位)' },
    { value: 'anticipation', label: '期待钩 (预告决战大比 / 底牌蓄势待发 / 期待打脸)' },
    { value: 'emotional', label: '情感钩 (防线失守动容 / 震撼告白决绝 / 情感引爆)' }
  ];

  function buildEndingHookOptions(state) {
    const curHook = (state && (state.endingHook || state.hook)) || '';
    return ENDING_HOOK_OPTIONS.map(opt =>
      `<option value="${opt.value}" ${curHook === opt.value ? 'selected' : ''}>${opt.label}</option>`
    ).join('');
  }

  function buildArchetypeSelectOptions(state, explicitFamily) {
    return buildWritingStyleOptions(state);
  }

  function parseEditorWordBudget(text, options = {}) {
    const s = String(text || '');
    const numMap = { '零':0, '一':1, '二':2, '两':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9 };
    const parseCn = str => {
      if (!str) return 0;
      if (/^[0-9]+$/.test(str)) return parseInt(str, 10);
      let t = 0, cur = 0;
      for (const ch of str) {
        if (numMap[ch] !== undefined) cur = numMap[ch];
        else if (ch === '千') { t += (cur || 1) * 1000; cur = 0; }
        else if (ch === '百') { t += (cur || 1) * 100; cur = 0; }
        else if (ch === '十') { t += (cur || 1) * 10; cur = 0; }
        else if (ch === '万') { t = (t + cur) * 10000; cur = 0; }
      }
      return t + cur;
    };
    const rangeMatch = s.match(/(?:字数约?|篇幅约?|目标约?|控制在约?)?\s*([0-9]{3,5}|[一二两三四五六七八九千百]+)\s*(?:[-—~～至到]|到\s*)\s*([0-9]{3,5}|[一二两三四五六七八九千百]+)\s*字/);
    if (rangeMatch) {
      const min = parseCn(rangeMatch[1]);
      const max = parseCn(rangeMatch[2]);
      if (min > 0 && max > 0 && min <= max && min >= 300) {
        return { hasUserInstruction: true, min, max, target: Math.round((min + max) / 2), summary: `用户指定篇幅：${min} ~ ${max} 字（目标约 ${Math.round((min + max) / 2)} 字）` };
      }
    }
    const atLeastMatch = s.match(/(?:不少于|至少|起码|大于)\s*([0-9]{3,5}|[一二两三四五六七八九千百]+)\s*字/);
    if (atLeastMatch) {
      const min = parseCn(atLeastMatch[1]);
      if (min >= 300) return { hasUserInstruction: true, min, max: Math.round(min * 1.25), target: Math.round(min * 1.1), summary: `用户指定篇幅：不少于 ${min} 字` };
    }
    const atMostMatch = s.match(/(?:不超过|至多|少于|小于)\s*([0-9]{3,5}|[一二两三四五六七八九千百]+)\s*字|([0-9]{3,5}|[一二两三四五六七八九千百]+)\s*字(?:以内|以下)/);
    if (atMostMatch) {
      const max = parseCn(atMostMatch[1] || atMostMatch[2]);
      if (max >= 300) return { hasUserInstruction: true, min: Math.round(max * 0.75), max, target: Math.round(max * 0.9), summary: `用户指定篇幅：不超过 ${max} 字` };
    }
    const singleMatch = s.match(/(?:写|扩写|续写|字数|篇幅|约|大约|目标)?\s*([0-9]{3,5}|[一二两三四五六七八九千百]+)\s*字(?:左右|上下)?/);
    if (singleMatch) {
      const val = parseCn(singleMatch[1]);
      const isChap = new RegExp('第\\s*' + singleMatch[1] + '\\s*[章节回]').test(s);
      if (val >= 300 && val <= 30000 && !isChap) {
        return { hasUserInstruction: true, min: Math.round(val * 0.85), max: Math.round(val * 1.15), target: val, summary: `用户指定篇幅：约 ${val} 字` };
      }
    }
    if (options && (options.targetWords || options.targetChars)) {
      const val = Number(options.targetWords || options.targetChars);
      if (val > 0 && val !== 3000) {
        return { hasUserInstruction: true, min: Math.round(val * 0.85), max: Math.round(val * 1.15), target: val, summary: `配置指定篇幅：约 ${val} 字` };
      }
    }
    return { hasUserInstruction: false, min: 2500, max: 3500, target: 3000, summary: '默认章节篇幅：2500 ~ 3500 字一章（基准约 3000 字）' };
  }

  // 保持兼容旧调用的存根函数
  function buildGenreRouteOptions(state, explicitFamily) {
    return buildChapterFocusOptions(state);
  }
(function () {
  'use strict';

  const EDITOR_SCRIPT_URL = document.currentScript && document.currentScript.src || '';

  const runtime = {
    installed: false,
    originalRenderPage: null,
    editorSaveTimer: 0,
    editorScheduledSaveOptions: null,
    editorSavePromise: null,
    editorSaveQueued: false,
    editorSaveQueuedOptions: null,
    editorChangeVersion: 0,
    editorWal: null,
    editorWalLoadPromise: null,
    editorWalRecovery: new Map(),
    editorWalBaselines: new Map(),
    editorWalLocalVersions: new Map(),
    editorWalOperationVersions: new Map(),
    editorWalLatest: new Map(),
    editorWalSuperseded: new Map(),
    editorWalConflicts: new Set(),
    editorWalTabId: '',
    editorWalTimer: 0,
    editorWalUnsubscribe: null,
    editorSearchLoadPromise: null,
    editorSearchApi: null,
    editorSearchWorker: null,
    editorSearchFallback: null,
    editorSearchDocuments: [],
    editorSearchTimer: 0,
    editorSearchSession: 0,
    editorSearchUndoStack: [],
    editorGenerationRunsLoadPromise: null,
    editorGenerationRunsClient: null,
    editorGenerationCapabilities: null,
    editorGenerationCapabilitiesAt: 0,
    editorGenerationRunObservers: new Map(),
    editorGenerationCancelPending: false,
    editorGenerationCancelRequested: false,
    editorBusy: false,
    modalConfirmCleanup: null,
    pendingResults: [],
    knowledgeSelected: new Set(),
    knowledgeQuery: '',
    knowledgeFilter: 'all',
    knowledgeSort: 'updated',
    knowledgeCategory: '',
    knowledgeCollapsed: new Set(),
    selectedEntityId: '',
    outlineTab: 'book',
    aiOpen: false,
    navOpen: false,
    activeGenerationRun: null,
    activeGenerationState: null,
    activeRequestController: null,
    generationPauseRequested: false,
    creationHydrationKey: '',
    creationHydrationPromise: null
  };

  const COMPLETION_AI_HISTORY_LIMIT = 30;
  const DYNAMIC_CONTEXT_MARKER = '<!-- molan-dynamic-context-v2 -->';
  const EDITOR_ONLY_SKILL_ID = 'write-high-tension-fiction';

  const CHARACTER_ARCHETYPES = Object.freeze([
    '豪爽侠义型', '冷静理智型', '温柔内敛型', '活泼开朗型', '阴郁腹黑型',
    '霸道强势型', '天真烂漫型', '市侩圆滑型', '高傲冷峻型', '热血冲动型'
  ]);

  const CHARACTER_ARCHETYPE_KEYWORDS = Object.freeze({
    '豪爽侠义型': ['豪爽', '侠义', '仗义', '直爽', '洒脱', '义气', '大方'],
    '冷静理智型': ['冷静', '理智', '克制', '淡漠', '审慎'],
    '温柔内敛型': ['温柔', '含蓄', '内敛', '体贴', '柔和'],
    '活泼开朗型': ['活泼', '开朗', '乐观', '跳脱', '爱笑'],
    '阴郁腹黑型': ['阴沉', '腹黑', '算计', '偏执', '危险'],
    '霸道强势型': ['霸道', '强势', '掌控', '专横', '命令', '果断'],
    '天真烂漫型': ['天真', '单纯', '烂漫', '懵懂', '好奇'],
    '市侩圆滑型': ['市侩', '圆滑', '精明', '世故', '会算', '逐利'],
    '高傲冷峻型': ['高傲', '冷峻', '孤傲', '骄傲', '不屑', '疏离'],
    '热血冲动型': ['热血', '冲动', '直率', '暴躁', '好战']
  });

  const CHARACTER_DIMENSION_HINTS = Object.freeze([
    ['appearance', /外貌|外形|长相|衣着|身形/],
    ['expression', /神态|表情|眼神|情绪|脸色/],
    ['action', /动作|行为|姿势|举止|反应/],
    ['dialogue', /语言|对白|说话|台词|声音/],
    ['catchphrase', /口头禅|语气|口吻|说话习惯/],
    ['psychology', /心理|内心|想法|念头|情绪变化/]
  ]);

  /** Normalize a client-side archetype value against the fixed material catalog. */
  function normalizeCharacterArchetype(value) {
    const normalized = text(value).trim();
    return CHARACTER_ARCHETYPES.includes(normalized) ? normalized : '';
  }

  /** Infer a standard archetype from exact tags and bounded character-card text. */
  function inferCharacterArchetype(entity) {
    const source = entity && typeof entity === 'object' ? entity : {};
    const explicit = normalizeCharacterArchetype(source.archetype);
    if (explicit) {
      const sourceType = source.archetypeSource === 'inferred' ? 'inferred' : 'explicit';
      return { archetype: explicit, source: sourceType, confidence: sourceType === 'explicit' ? 1 : Number(source.archetypeConfidence) || 0.65 };
    }
    const tags = Array.isArray(source.tags) ? source.tags.map(value => text(value).trim().toLowerCase()).filter(Boolean) : [];
    const attrs = Array.isArray(source.attrs) ? source.attrs.map(item => typeof item === 'string' ? item : `${item && (item.key || item.k || item.name || '')} ${item && (item.value || item.v || item.text || '')}`) : [];
    const body = [source.name, source.personality, source.notes, source.intro, source.description, ...attrs].map(value => text(value).toLowerCase()).join(' ');
    const scores = CHARACTER_ARCHETYPES.map(archetype => {
      let score = 0;
      (CHARACTER_ARCHETYPE_KEYWORDS[archetype] || []).forEach(keyword => {
        const term = keyword.toLowerCase();
        if (tags.some(tag => tag === term)) score += 6;
        else if (tags.some(tag => tag.includes(term))) score += 4;
        let offset = 0;
        let hits = 0;
        while (offset < body.length && hits < 3) {
          const found = body.indexOf(term, offset);
          if (found < 0) break;
          hits += 1;
          offset = found + term.length;
        }
        score += hits * 1.25;
      });
      return { archetype, score };
    }).sort((left, right) => right.score - left.score);
    const top = scores[0];
    const second = scores[1];
    if (!top || top.score < 2 || (second && second.score > 0 && top.score - second.score < 1.5)) return { archetype: '', source: 'none', confidence: 0 };
    return { archetype: top.archetype, source: 'inferred', confidence: Number(Math.min(0.94, Math.max(0.5, top.score / (top.score + (second ? second.score : 0) + 1))).toFixed(2)) };
  }

  /** Persist an explicit or inferred archetype on a character entity before saving it. */
  function applyCharacterArchetype(entity, explicitValue, sourceHint) {
    if (!entity || entity.type !== 'character') {
      if (entity) { delete entity.archetype; delete entity.archetypeSource; delete entity.archetypeConfidence; }
      return entity;
    }
    const explicit = normalizeCharacterArchetype(explicitValue || entity.archetype);
    if (explicit && explicitValue && sourceHint === 'inferred') {
      entity.archetype = explicit;
      entity.archetypeSource = 'inferred';
      entity.archetypeConfidence = Number(entity.archetypeConfidence) || 0.65;
      return entity;
    }
    if (explicit && explicitValue) {
      entity.archetype = explicit;
      entity.archetypeSource = 'explicit';
      entity.archetypeConfidence = 1;
      return entity;
    }
    const inferred = inferCharacterArchetype({ ...entity, archetype: '' });
    entity.archetype = inferred.archetype;
    entity.archetypeSource = inferred.archetype ? 'inferred' : 'none';
    entity.archetypeConfidence = inferred.confidence;
    return entity;
  }

  /** Return the effective archetype and a user-facing source label for a character card. */
  function characterArchetypeDisplay(entity) {
    const inferred = inferCharacterArchetype(entity);
    const source = inferred.source === 'explicit' ? '用户指定' : inferred.source === 'inferred' ? '根据人物卡关键词推断' : '未能判断，使用通用规则';
    return { ...inferred, sourceLabel: source };
  }

  /** Toggle the character-only archetype field and update its source hint in the editor form. */
  function updateKnowledgeArchetypeField() {
    const typeSelect = document.getElementById('completionEntityType');
    const field = document.getElementById('completionEntityArchetypeField');
    const type = typeSelect && typeSelect.value;
    if (field) field.hidden = type !== 'character';
    const select = document.getElementById('completionEntityArchetype');
    const hint = document.getElementById('completionEntityArchetypeHint');
    if (!select || !hint) return;
    const preview = characterArchetypeDisplay({ type: 'character', archetype: select.value });
    const source = select.value && select.dataset.source === 'inferred' && select.dataset.userChanged !== 'true' ? '根据人物卡关键词推断' : select.value ? '用户指定' : preview.archetype ? preview.sourceLabel : '未能判断，使用通用规则';
    hint.textContent = `来源：${source}`;
  }

  /** Build the explicit character-material request passed to prose generation calls. */
  function buildCharacterMaterialRequest(state, context, prompt, options = {}) {
    const settings = state && state.settings || {};
    const mode = options.mode || settings.characterMaterialMode || 'raw';
    const characters = Array.isArray(context && context.characters) ? context.characters : [];
    const dimensions = CHARACTER_DIMENSION_HINTS.filter(([, pattern]) => pattern.test(text(prompt))).map(([id]) => id);
    const current = context && context.current || {};
    const novel = getPreview().novel || {};
    return {
      enabled: mode !== 'off',
      mode: mode === 'strong' ? 'strong' : mode === 'off' ? 'off' : 'raw',
      novelId: completionNovelKey(state),
      archetypes: characters.filter(item => item.archetypeSource === 'explicit').map(item => normalizeCharacterArchetype(item.archetype)).filter(Boolean),
      characters: characters.map(item => ({
        id: text(item.id), name: text(item.name), tags: Array.isArray(item.tags) ? item.tags : [], notes: text(item.notes), attrs: Array.isArray(item.attrs) ? item.attrs : [], archetype: normalizeCharacterArchetype(item.archetype), archetypeSource: item.archetypeSource, archetypeConfidence: item.archetypeConfidence,
        voice: item.voice || (item.habit || item.taboo ? { habit: item.habit, taboo: item.taboo, samples: item.samples } : undefined)
      })),
      dimensions,
      query: [prompt, current.scene && current.scene.name, context && context.outline].filter(Boolean).join('；'),
      genre: text(state && (state.genre || state.type) || novel.genre || novel.type),
      proseTask: mode !== 'off' && options.proseTask !== false
    };
  }

  function refObject(name) {
    try {
      if (name === 'renderers') return renderers;
      if (name === 'previewState') return previewState;
      if (name === 'backendState') return backendState;
      if (name === 'stage') return stage;
    } catch (_) {}
    return window[name];
  }

  function refFunction(name) {
    try {
      if (name === 'renderPage') return renderPage;
      if (name === 'mountIcons') return mountIcons;
      if (name === 'showToast') return showToast;
      if (name === 'openActionModal') return openActionModal;
      if (name === 'closeModal') return closeModal;
      if (name === 'ensurePreviewNovelState') return ensurePreviewNovelState;
      if (name === 'saveCurrentNovel') return saveCurrentNovel;
      if (name === 'requestChatText') return requestChatText;
      if (name === 'currentUnifiedModel') return currentUnifiedModel;
      if (name === 'populateModelSelect') return populateModelSelect;
      if (name === 'backendDate') return backendDate;
      if (name === 'escapeBackendHtml') return escapeBackendHtml;
      if (name === 'icon') return icon;
    } catch (_) {}
    return typeof window[name] === 'function' ? window[name] : null;
  }

  function getStage() {
    return refObject('stage') || document.getElementById('pageStage');
  }

  function getPreview() {
    return refObject('previewState') || {};
  }

  function getBackend() {
    return refObject('backendState') || {};
  }

  function currentPageName() {
    try { if (typeof currentPage === 'string') return currentPage; } catch (_) {}
    return String(window.currentPage || 'overview');
  }

  function esc(value) {
    const fn = refFunction('escapeBackendHtml');
    return fn ? fn(String(value == null ? '' : value)) : String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ico(name, className) {
    const fn = refFunction('icon');
    return fn ? fn(name, className || 'icon') : `<i data-lucide="${esc(name)}" class="${esc(className || 'icon')}"></i>`;
  }

  function toast(message) {
    const fn = refFunction('showToast');
    if (fn) fn(message);
  }

  async function readImportedText(file) {
    const importer = window.MolanCompletionImport;
    if (importer && typeof importer.readTextFile === 'function') return (await importer.readTextFile(file)).text;
    return String(await file.text()).replace(/\uFEFF/g, '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  }

  function mountIconsSafe() {
    const fn = refFunction('mountIcons');
    if (fn) fn();
  }

  function uid(prefix) {
    return `${prefix || 'id'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function text(value) {
    return String(value == null ? '' : value).replace(/\u0000/g, '');
  }

  function sanitizeAiFlavor(raw) {
    if (typeof raw !== 'string' || !raw) return '';
    let result = raw
      // 0. 清除思考碎片与元指令独白
      .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
      .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
      .replace(/^\s*\*Draft\s*\d+[\s\S]*?\n(?=[一-龥“])/gm, '')
      .replace(/(?:心(?:头|中)|暗自)(?:飞速|急速|飞快|微)?(?:转过|闪过|掠过|升起|涌起)(?:一个|数个|一丝|几分)?(?:阴毒|阴沉|狠厉|复杂|算计|冰冷|怨毒)?的?念头[：:](?:“|‘)?([^”’\n]{2,100})(?:”|’)?/g, '心中暗忖：$1')
      .replace(/(?:心(?:头|中)|暗自)(?:暗想|寻思|默念)[：:](?:“|‘)([^”’\n]{2,100})(?:”|’)/g, '心底盘算：$1')
      // 1. 净化真实受力与内伤套话 (R-37)
      .replace(/(?:喉头|喉咙)(?:一甜|泛起(?:一[丝抹点])?腥甜)|(?:体内)?气血翻涌/g, '胸口如遭重锤，腥气直冲齿缝')
      .replace(/(?:震得|震得那?)(?:脚底|双脚|双腿|脚掌|虎口|手腕|手臂|五脏|耳膜|整个人)(?:发麻|发木|发酸|生疼|嗡嗡作响)/g, '掌中生铁剧烈震荡')
      // 2. 净化神态与骨节套话 (R-14, R-42)
      .replace(/(?:嘴角|唇角)[^。！？\n]{0,8}(?:勾起|扯起|挑起|扬起|微微勾起|缓缓勾起|浮现|挂着|掀起)[^。！？\n]{0,8}(?:一抹)?[^。！？\n]{0,8}(?:弧度|笑意|笑容|冷笑|阴狠|玩味|意味难明|讥诮)/g, '眼角微抬，冷冷吐出半句话')
      .replace(/唇角/g, '嘴角')
      .replace(/(?:指节|指头|指尖|骨节|指骨|关节|手指|手背)[^，。\n]{0,8}(?:泛白|发白|变白|毫无血色|失去血色|硌得发白|捏得发白|攥得发白)/g, '右手死死扣住生铁护手')
      // 3. 瞳孔与神经反射 (R-36, R-40)
      .replace(/瞳孔(?:骤然|猛然|急速|猛地)?(?:收缩|放大|骤缩)/g, '视线瞬间压低')
      .replace(/心跳(?:骤然|猛然)?漏了一拍|心跳漏了半拍/g, '胸口骤然一紧')
      .replace(/呼吸(?:骤然|猛然|不由得)?一滞|呼吸(?:一紧|骤停)/g, '气息猛地顿住')
      .replace(/下颌(?:线)?(?:骤然)?(?:绷紧|收紧)|面色紧绷/g, '面色沉如铁石')
      .replace(/后颈(?:发凉|一凉|汗毛倒竖)|一股凉气从脚底/g, '后心渗出一层寒意')
      .replace(/手心(?:全是冷汗|满是冷汗|冒冷汗|冷汗)/g, '掌心黏湿')
      .replace(/牙关紧咬|牙关咬得咯咯作响/g, '咬紧牙关')
      .replace(/(?:倒吸|深吸)一口凉气/g, '下意识屏住呼吸')
      // 4. 视线游走与局部主体化 (R-13)
      .replace(/(?:目光|视线)在(?:屋[内里]|四周|场中|众人身上)转了一圈/g, '视线扫过屋内各处')
      .replace(/目光如刀(?:削)?|目光锐利如刀/g, '冷冷看着对方眉心')
      .replace(/死一般的寂静|像一潭死水/g, '屋内落针可闻')
      .replace(/面沉如水/g, '面无表情')
      .replace(/如断线风筝(?:般)?(?:倒飞|跌落)?/g, '身躯失控砸翻两张木桌')
      // 5. 净化隐性翻译腔与句式僵化
      .replace(/在这一刻显得格外/g, '此时格外')
      .replace(/无不在昭示着/g, '无不显露出')
      .replace(/带着一种不容置疑的/g, '带着不容置疑的')
      .replace(/试图去寻找/g, '试图寻找')
      .replace(/不得不承认的是/g, '平心而论');

    // 结尾闭合防截断
    const hasTerminal = /[。！？……”’]$/.test(result.trim());
    if (!hasTerminal && result.length > 200) {
      const lastPunct = Math.max(result.lastIndexOf('。'), result.lastIndexOf('！'), result.lastIndexOf('？'), result.lastIndexOf('”'));
      if (lastPunct > result.length - 80 && lastPunct > 100) {
        result = result.slice(0, lastPunct + 1);
      } else {
        result = result + '。';
      }
    }
    return result;
  }

  function foreshadowDisplayId(item, index) {
    const raw = text(item && (item.displayId || item.code || '')).trim();
    return /^F-\d{1,4}$/i.test(raw)
      ? raw.toUpperCase()
      : `F-${String(index + 1).padStart(3, '0')}`;
  }

  function cloneValue(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }

  function createCompletionChapter(title) {
    return { id: uid('chapter'), title: text(title || '第1章'), sub: '', scenes: [{ id: uid('scene'), name: '场景一', content: '' }] };
  }

  function trimCompletionHistory(messages) {
    if (!Array.isArray(messages)) return [];
    if (messages.length > COMPLETION_AI_HISTORY_LIMIT) messages.splice(0, messages.length - COMPLETION_AI_HISTORY_LIMIT);
    return messages;
  }

  function completionNovelKey(state) {
    const preview = getPreview();
    return text(preview.novelId || preview.novel && preview.novel.id || state && state.id || 'current');
  }

  /** 以账户和作品稳定标识隔离浏览器中的正文 WAL。 */
  function editorWalProjectId(state) {
    const backend = getBackend();
    const identity = backend.user && (backend.user.userId || backend.user.email) || 'guest';
    return `${encodeURIComponent(String(identity).trim().toLowerCase())}:${encodeURIComponent(completionNovelKey(state))}`;
  }

  /** 根据场景引用生成用于 IndexedDB 和跨标签协作的文档键。 */
  function editorWalDocument(state, sceneRef) {
    const current = activeRefs(state);
    let chapter = current.chapter;
    let scene = current.scene;
    if (sceneRef && sceneRef !== scene) {
      const located = (state.volumes || []).flatMap(volume => volume.chapters || [])
        .map(item => ({ chapter: item, scene: (item.scenes || []).find(candidate => candidate === sceneRef) }))
        .find(item => item.scene);
      if (located) { chapter = located.chapter; scene = located.scene; }
    }
    if (!chapter || !scene) return null;
    const projectId = editorWalProjectId(state);
    return {
      projectId,
      chapterId: String(chapter.id),
      sceneId: String(scene.id),
      scene,
      docKey: `${projectId}|${encodeURIComponent(chapter.id)}|${encodeURIComponent(scene.id)}`
    };
  }

  /** 为当前浏览器标签生成独立的写入者标识。 */
  function editorWalTabId() {
    if (runtime.editorWalTabId) return runtime.editorWalTabId;
    const cryptoApi = window.crypto;
    runtime.editorWalTabId = cryptoApi && typeof cryptoApi.randomUUID === 'function'
      ? cryptoApi.randomUUID()
      : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return runtime.editorWalTabId;
  }

  /** 加载浏览器端 IndexedDB WAL 模块并建立通知通道。 */
  function loadEditorWalModule() {
    if (window.MolanLocalWal) {
      if (!runtime.editorWal) {
        runtime.editorWal = window.MolanLocalWal.create();
        installEditorWalNotifications();
      }
      return Promise.resolve(window.MolanLocalWal);
    }
    if (runtime.editorWalLoadPromise) return runtime.editorWalLoadPromise;
    if (!document.createElement || !document.head) return Promise.reject(new Error('IndexedDB WAL 模块不可用'));
    const sourceUrl = EDITOR_SCRIPT_URL || window.location && window.location.href || '';
    const scriptUrl = sourceUrl ? new URL('./lib/client/local-wal.js', sourceUrl).href : './lib/client/local-wal.js';
    runtime.editorWalLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.onload = () => window.MolanLocalWal ? resolve(window.MolanLocalWal) : reject(new Error('IndexedDB WAL 模块加载失败'));
      script.onerror = () => reject(new Error('IndexedDB WAL 模块加载失败'));
      document.head.appendChild(script);
    }).then(api => {
      runtime.editorWal = api.create();
      installEditorWalNotifications();
      return api;
    });
    return runtime.editorWalLoadPromise;
  }


  /** 按稳定章节和场景 ID 定位待恢复的正文节点。 */
  function locateEditorWalScene(state, chapterId, sceneId) {
    if (!state || !Array.isArray(state.volumes)) return null;
    for (const volume of state.volumes) {
      for (const chapter of Array.isArray(volume.chapters) ? volume.chapters : []) {
        if (String(chapter.id) !== String(chapterId)) continue;
        const scene = (Array.isArray(chapter.scenes) ? chapter.scenes : []).find(item => String(item.id) === String(sceneId));
        return scene ? { chapter, scene } : null;
      }
    }
    return null;
  }

  /** 判断当前作品是否仍有未解决的跨标签冲突。 */
  function editorWalProjectHasConflict(state) {
    const prefix = `${editorWalProjectId(state)}|`;
    return Array.from(runtime.editorWalConflicts).some(docKey => docKey.startsWith(prefix));
  }

  /** 在异步读取 IndexedDB 前记录当前正文基线，避免恢复覆盖新输入。 */
  function seedEditorWalBaselines(state) {
    if (!state || !Array.isArray(state.volumes)) return;
    const projectId = editorWalProjectId(state);
    const revision = Number(getPreview().novelRevision) || 0;
    state.volumes.forEach(volume => (volume.chapters || []).forEach(chapter => (chapter.scenes || []).forEach(scene => {
      const docKey = `${projectId}|${encodeURIComponent(chapter.id)}|${encodeURIComponent(scene.id)}`;
      if (!runtime.editorWalBaselines.has(docKey)) {
        runtime.editorWalBaselines.set(docKey, { content: String(scene.content || ''), revision });
      }
    })));
  }

  /** 收到同场景的其他标签写入时阻止旧状态覆盖。 */
  function installEditorWalNotifications() {
    if (!runtime.editorWal || runtime.editorWalUnsubscribe) return;
    runtime.editorWalUnsubscribe = runtime.editorWal.subscribe(message => {
      const state = editorState(false);
      if (!state || message.projectId !== editorWalProjectId(state) || message.tabId === editorWalTabId()) return;
      runtime.editorWalConflicts.add(message.docKey);
      const current = editorWalDocument(state);
      if (current && current.docKey === message.docKey) {
        setSaveStatus(message.type === 'synced' ? '其他标签页已保存，当前场景需重新载入' : '其他标签页有未合并修改');
      }
    });
  }

  /** 按基线校验并重放当前作品中唯一且未冲突的正文 WAL。 */
  async function ensureEditorWalRecovery(state) {
    if (!state) return;
    seedEditorWalBaselines(state);
    const projectId = editorWalProjectId(state);
    if (runtime.editorWalRecovery.has(projectId)) return runtime.editorWalRecovery.get(projectId);
    const recovery = (async () => {
      const api = await loadEditorWalModule();
      const wal = runtime.editorWal;
      if (!wal) return;
      const records = await wal.readProject(projectId);
      const groups = new Map();
      records.forEach(record => {
        const group = groups.get(record.docKey) || [];
        group.push(record);
        groups.set(record.docKey, group);
      });
      let recovered = false;
      for (const [docKey, pending] of groups) {
        const latest = pending[pending.length - 1];
        const head = await wal.getHead(docKey);
        runtime.editorWalLocalVersions.set(docKey, Number(head.version) || Number(latest.localVersion) || 0);
        const location = locateEditorWalScene(state, latest.chapterId, latest.sceneId);
        if (!location) {
          runtime.editorWalConflicts.add(docKey);
          continue;
        }
        if (pending.length !== 1 || latest.conflicted) {
          runtime.editorWalConflicts.add(docKey);
          continue;
        }
        const baseline = runtime.editorWalBaselines.get(docKey) || { content: String(location.scene.content || ''), revision: Number(getPreview().novelRevision) || 0 };
        const baseHash = await api.hashText(baseline.content, window.crypto);
        if (baseHash !== latest.baseHash) {
          runtime.editorWalConflicts.add(docKey);
          continue;
        }
        try {
          const restoredContent = api.applySplices(baseline.content, latest.operations);
          if (latest.contentHash && await api.hashText(restoredContent, window.crypto) !== latest.contentHash) {
            runtime.editorWalConflicts.add(docKey);
            continue;
          }
          location.scene.content = restoredContent;
          runtime.editorWalBaselines.set(docKey, {
            content: baseline.content,
            revision: Number(getPreview().novelRevision) || Number(latest.baseRevision) || 0
          });
          runtime.editorWalOperationVersions.set(latest.opId, Number(latest.operationVersion) || 0);
          runtime.editorWalLatest.set(latest.opId, { record: latest, content: location.scene.content });
          runtime.editorWalSuperseded.set(docKey, pending.slice());
          recovered = true;
        } catch (_) {
          runtime.editorWalConflicts.add(docKey);
        }
      }
      if (recovered && currentPageName() === 'editor' && editorWalProjectId(editorState(false)) === projectId) {
        const current = editorWalDocument(editorState(false));
        if (current) getPreview().editorBody = current.scene.content;
        renderEditorSurface();
      }
      if (runtime.editorWalConflicts.size) setSaveStatus('发现跨标签或版本冲突，草稿已保留');
    })();
    const trackedRecovery = recovery.catch(error => {
      if (runtime.editorWalRecovery.get(projectId) === trackedRecovery) runtime.editorWalRecovery.delete(projectId);
      throw error;
    });
    runtime.editorWalRecovery.set(projectId, trackedRecovery);
    return trackedRecovery;
  }

  /** 将当前场景与已确认正文之间的差量先写入 IndexedDB。 */
  async function writeEditorWal(state, sceneRef) {
    const preview = getPreview();
    if (!state || !isServerNovelId(preview.novelId)) return null;
    await ensureEditorWalRecovery(state);
    const api = await loadEditorWalModule();
    const doc = editorWalDocument(state, sceneRef);
    if (!doc) return null;
    if (runtime.editorWalConflicts.has(doc.docKey)) throw new Error('当前场景存在跨标签版本冲突，草稿已保留');
    const baseline = runtime.editorWalBaselines.get(doc.docKey) || {
      content: String(doc.scene.content || ''), revision: Number(preview.novelRevision) || 0
    };
    const content = String(doc.scene.content || '');
    const operation = api.makeSplice(baseline.content, content);
    const opId = `scene:${editorWalTabId()}:${doc.docKey}`;
    if (!operation) {
      const pending = [runtime.editorWalLatest.get(opId), ...(runtime.editorWalSuperseded.get(doc.docKey) || []).map(record => ({ record }))]
        .filter(Boolean);
      for (const item of pending) await runtime.editorWal.remove(item.record.opId, item.record.operationVersion);
      pending.forEach(item => {
        runtime.editorWalLatest.delete(item.record.opId);
        runtime.editorWalOperationVersions.delete(item.record.opId);
      });
      runtime.editorWalSuperseded.delete(doc.docKey);
      return null;
    }
    const baseHash = await api.hashText(baseline.content, window.crypto);
    let expectedVersion = runtime.editorWalLocalVersions.get(doc.docKey);
    if (expectedVersion == null) expectedVersion = (await runtime.editorWal.getHead(doc.docKey)).version;
    const existing = runtime.editorWalLatest.get(opId);
    const result = await runtime.editorWal.put({
      opId,
      projectId: doc.projectId,
      docKey: doc.docKey,
      tabId: editorWalTabId(),
      chapterId: doc.chapterId,
      sceneId: doc.sceneId,
      baseRevision: Number(baseline.revision) || 0,
      baseHash,
      contentHash: await api.hashText(content, window.crypto),
      operations: [operation],
      createdAt: Number(existing && existing.record.createdAt) || Date.now(),
      updatedAt: Date.now()
    }, expectedVersion);
    runtime.editorWalLocalVersions.set(doc.docKey, result.version);
    runtime.editorWalOperationVersions.set(opId, result.record.operationVersion);
    runtime.editorWalLatest.set(opId, { record: result.record, content });
    if (result.conflict) {
      runtime.editorWalConflicts.add(doc.docKey);
      setSaveStatus('本地草稿已保存，但检测到其他标签页修改');
      throw Object.assign(new Error('当前场景存在跨标签版本冲突，草稿已保留'), { walConflict: true });
    }
    setSaveStatus('正文已写入本地 WAL，等待同步');
    return { record: result.record, content, baseline, doc };
  }

  /** 将正文本地落盘延迟 250ms，与云端同步计时器分离。 */
  function scheduleEditorWalSave(sceneRef) {
    const state = editorState(false);
    const preview = getPreview();
    if (!state || !isServerNovelId(preview.novelId)) return;
    window.clearTimeout(runtime.editorWalTimer);
    runtime.editorWalTimer = window.setTimeout(() => {
      void writeEditorWal(state, sceneRef).catch(error => {
        setSaveStatus(error && error.message && error.message.includes('冲突') ? '跨标签冲突，WAL 草稿已保留' : '本地 WAL 保存失败');
      });
    }, 250);
  }

  /** 整本保存确认后清理已包含在该快照中的 WAL，并重基较新的本地编辑。 */
  async function acknowledgeEditorWalPut(state, sceneSnapshot, revision) {
    if (!runtime.editorWal || !isServerNovelId(getPreview().novelId) || !Number.isInteger(Number(revision))) return true;
    try {
      const api = await loadEditorWalModule();
      const projectId = editorWalProjectId(state);
      const records = await runtime.editorWal.readProject(projectId);
      let cleanupPending = false;
      state.volumes.forEach(volume => (volume.chapters || []).forEach(chapter => (chapter.scenes || []).forEach(scene => {
        const docKey = `${projectId}|${encodeURIComponent(chapter.id)}|${encodeURIComponent(scene.id)}`;
        if (sceneSnapshot.has(docKey)) runtime.editorWalBaselines.set(docKey, { content: sceneSnapshot.get(docKey), revision: Number(revision) });
      })));
      for (const record of records) {
        if (record.conflicted) {
          runtime.editorWalConflicts.add(record.docKey);
          cleanupPending = true;
          continue;
        }
        const sentContent = sceneSnapshot.get(record.docKey);
        if (sentContent == null) {
          await runtime.editorWal.remove(record.opId, record.operationVersion, {
            projectId, docKey: record.docKey, tabId: editorWalTabId(), revision: Number(revision), contentHash: ''
          });
          continue;
        }
        const sentHash = await api.hashText(sentContent, window.crypto);
        if (sentHash === record.contentHash) {
          const removed = await runtime.editorWal.remove(record.opId, record.operationVersion, {
            projectId,
            docKey: record.docKey,
            tabId: editorWalTabId(),
            revision: Number(revision),
            contentHash: sentHash
          });
          if (removed) {
            runtime.editorWalLatest.delete(record.opId);
            runtime.editorWalOperationVersions.delete(record.opId);
          } else {
            cleanupPending = true;
            const currentRecord = (await runtime.editorWal.readProject(projectId)).find(item => item.opId === record.opId);
            const location = locateEditorWalScene(state, record.chapterId, record.sceneId);
            if (currentRecord && currentRecord.tabId === editorWalTabId() && location && !runtime.editorWalConflicts.has(record.docKey)) {
              await writeEditorWal(state, location.scene);
            } else if (currentRecord) {
              runtime.editorWalConflicts.add(record.docKey);
            }
          }
          continue;
        }
        const location = locateEditorWalScene(state, record.chapterId, record.sceneId);
        if (record.tabId === editorWalTabId() && location && !runtime.editorWalConflicts.has(record.docKey)) {
          cleanupPending = true;
          await writeEditorWal(state, location.scene);
        } else {
          runtime.editorWalConflicts.add(record.docKey);
          cleanupPending = true;
        }
      }
      return !cleanupPending && (records.length === 0 || !Array.from(runtime.editorWalConflicts).some(docKey => docKey.startsWith(`${projectId}|`)));
    } catch (_) {
      return false;
    }
  }

  /** 覆盖式保存前确认请求快照包含其他标签待同步的正文。 */
  async function editorWalHasUnrepresentedDraft(state, sceneSnapshot) {
    if (!isServerNovelId(getPreview().novelId)) return false;
    await ensureEditorWalRecovery(state);
    const api = await loadEditorWalModule();
    const projectId = editorWalProjectId(state);
    if (!runtime.editorWal) return false;
    const records = await runtime.editorWal.readProject(projectId);
    for (const record of records) {
      if (record.conflicted) {
        runtime.editorWalConflicts.add(record.docKey);
        return true;
      }
      const sentContent = sceneSnapshot.get(record.docKey);
      if (sentContent == null) return true;
      if (record.tabId !== editorWalTabId() || runtime.editorWalConflicts.has(record.docKey)) {
        const sentHash = await api.hashText(sentContent, window.crypto);
        if (sentHash !== record.contentHash) {
          runtime.editorWalConflicts.add(record.docKey);
          return true;
        }
      }
    }
    return false;
  }

  function isServerNovelId(value) {
    return /^n_[A-Za-z0-9]{1,30}$/.test(String(value || ''));
  }

  function editorSessionKey() {
    const backend = getBackend();
    const identity = backend.user && (backend.user.userId || backend.user.email);
    const userKey = identity ? encodeURIComponent(String(identity).trim().toLowerCase()) : 'guest';
    return `${Number(backend.sessionVersion) || 0}:${userKey}:${backend.token || ''}`;
  }

  /** 为版本冲突暂存未同步草稿，范围绑定稳定用户和当前作品。 */
  function editorConflictDraftKey(state) {
    const backend = getBackend();
    const identity = backend.user && (backend.user.userId || backend.user.email);
    const userKey = encodeURIComponent(String(identity || 'guest').trim().toLowerCase());
    return `molan_editor_conflict_${userKey}_${encodeURIComponent(completionNovelKey(state))}`;
  }

  /** 保存冲突草稿但不自动覆盖服务端新版本，交给作者显式合并。 */
  function persistEditorConflictDraft(state, expectedRevision) {
    if (!state || !isServerNovelId(getPreview().novelId)) return;
    try {
      localStorage.setItem(editorConflictDraftKey(state), JSON.stringify({
        novelId: String(getPreview().novelId),
        expectedRevision: Number(expectedRevision) || 0,
        savedAt: Date.now(),
        state: cloneValue(state)
      }));
    } catch (_) {}
  }

  /** 成功同步后清除同一作品的旧冲突草稿。 */
  function clearEditorConflictDraft(state) {
    try { localStorage.removeItem(editorConflictDraftKey(state)); } catch (_) {}
  }

  function completionTarget(state, sessionId) {
    const current = activeRefs(state);
    return {
      novelId: completionNovelKey(state),
      volumeId: current.volume && current.volume.id || '',
      chapterId: current.chapter && current.chapter.id || '',
      sceneId: current.scene && current.scene.id || '',
      sessionId: text(sessionId || getPreview().editorChatSessionId || '')
    };
  }

  function completionTargetMatches(target, state, sessionId) {
    if (!target || !state) return false;
    const current = completionTarget(state, sessionId);
    const sameChapter = target.novelId === current.novelId && target.volumeId === current.volumeId &&
      target.chapterId === current.chapterId && target.sceneId === current.sceneId;
    // 会话 id 仅用于聊天分组；页面刷新会产生新会话，不应阻止作者采纳正文结果。
    return sameChapter;
  }

  function wordCount(value) {
    return text(value).replace(/<[^>]*>/g, '').replace(/\s/g, '').length;
  }

  function plainText(value) {
    const holder = document.createElement('div');
    holder.innerHTML = text(value);
    return holder.textContent || '';
  }

  function sanitizeHtml(value) {
    const template = document.createElement('template');
    template.innerHTML = text(value);
    const allowedTags = new Set(['P', 'DIV', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'HR', 'A', 'SPAN', 'CODE', 'PRE', 'SUB', 'SUP']);
    const removedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SVG', 'MATH', 'VIDEO', 'AUDIO', 'SOURCE', 'TRACK', 'CANVAS', 'TEMPLATE', 'LINK', 'META', 'BASE']);
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
    const elements = [];
    let node;
    while ((node = walker.nextNode())) elements.push(node);
    elements.reverse().forEach(element => {
      if (removedTags.has(element.tagName)) {
        element.remove();
        return;
      }
      if (!allowedTags.has(element.tagName)) {
        const parent = element.parentNode;
        if (!parent) return;
        while (element.firstChild) parent.insertBefore(element.firstChild, element);
        element.remove();
        return;
      }
      const href = element.tagName === 'A' ? String(element.getAttribute('href') || '').trim() : '';
      [...element.attributes].forEach(attribute => element.removeAttribute(attribute.name));
      if (element.tagName === 'A') {
        if (/^(https?:|mailto:|#|\/)/i.test(href) && !/^\/\//.test(href) && !/^\/\\/.test(href)) {
          element.setAttribute('href', href);
          element.setAttribute('rel', 'noopener noreferrer');
          element.setAttribute('target', '_blank');
        } else {
          element.replaceWith(...element.childNodes);
        }
      }
    });
    return template.innerHTML;
  }

  function textToHtml(value) {
    const source = text(value).replace(/\r\n?/g, '\n').trim();
    if (!source) return '';
    return source.split(/\n{2,}/).map(block => {
      const line = block.trim();
      if (/^#{1,3}\s+/.test(line)) return `<h3>${esc(line.replace(/^#{1,3}\s+/, ''))}</h3>`;
      return `<p>${esc(line).replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }

  function readWorkspace(kind, fallback) {
    const reader = refFunction('readWorkspaceList');
    if (reader) {
      try { return reader(kind); } catch (_) {}
    }
    const preview = getPreview();
    const backendUser = getBackend().user;
    const account = backendUser && (backendUser.userId || backendUser.email) ? (backendUser.userId || backendUser.email) : 'guest';
    const novel = preview.novelId || (preview.novel && preview.novel.title) || 'default';
    try {
      const value = JSON.parse(localStorage.getItem(`molan_${kind}_${account}_${novel}`) || 'null');
      return Array.isArray(value) ? value : (fallback || []);
    } catch (_) { return fallback || []; }
  }

  function writeWorkspace(kind, value) {
    const writer = refFunction('saveWorkspaceList');
    if (writer) {
      writer(kind, Array.isArray(value) ? value : []);
      return;
    }
    const preview = getPreview();
    const backendUser = getBackend().user;
    const account = backendUser && (backendUser.userId || backendUser.email) ? (backendUser.userId || backendUser.email) : 'guest';
    const novel = preview.novelId || (preview.novel && preview.novel.title) || 'default';
    try { localStorage.setItem(`molan_${kind}_${account}_${novel}`, JSON.stringify(Array.isArray(value) ? value : [])); } catch (_) {}
  }

  function pageShell(key, eyebrow, title, subtitle, tools, body, extra) {
    return `<div class="page-shell ${esc(extra || '')}"><div class="page-header"><div><div class="eyebrow">${esc(eyebrow)}</div><h1 class="page-title">${esc(title)}</h1><p class="page-subtitle">${esc(subtitle)}</p></div><div class="header-tools">${tools || ''}</div></div>${body}</div>`;
  }

  function backendDateSafe(value) {
    const fn = refFunction('backendDate');
    return fn ? fn(value) : (value ? new Date(Number(value)).toLocaleString() : '未记录');
  }

  function editorState(create) {
    const preview = getPreview();
    if (!preview.novelState) {
      if (!create) return null;
      preview.novelState = {
        title: preview.novel && preview.novel.title || '未命名小说',
        volumes: [],
        outline: { book: { title: preview.novel && preview.novel.title || '未命名小说', oneLine: '', themes: [] }, volume: { title: '第一卷', synopsis: '', target: '', done: 0, total: 0 }, chapters: [] },
        knowledge: { entities: {}, edges: [], version: 1 },
        foreshadows: [],
        history: [],
        workspace: {},
        chapterContracts: {},
      generationRuns: [],
        settings: { think: false, reasoningEffort: '', characterMaterialMode: 'raw' },
        creationBookId: '', creationBibleVersion: 0, creationStateVersion: 0, creationContext: null, creationPlan: null, creationBookLinked: false, editorCanonSnapshot: null
      };
    }
    const state = preview.novelState;
    state.workspace = state.workspace && typeof state.workspace === 'object' ? state.workspace : {};
    state.volumes = Array.isArray(state.volumes) ? state.volumes : [];
    if (!state.volumes.length) state.volumes.push({ id: uid('volume'), title: '第一卷', chapters: [] });
    state.volumes.forEach((volume, volumeIndex) => {
      volume.id = text(volume.id || uid('volume'));
      volume.title = text(volume.title || `第${volumeIndex + 1}卷`).trim() || `第${volumeIndex + 1}卷`;
      volume.chapters = Array.isArray(volume.chapters) ? volume.chapters : [];
      volume.chapters.forEach((chapter, chapterIndex) => {
        chapter.id = text(chapter.id || uid('chapter'));
        chapter.title = text(chapter.title || `第${chapterIndex + 1}章`).trim() || `第${chapterIndex + 1}章`;
        chapter.sub = text(chapter.sub || '');
        chapter.scenes = Array.isArray(chapter.scenes) ? chapter.scenes : [];
        if (!chapter.scenes.length) chapter.scenes.push({ id: uid('scene'), name: '场景一', content: '' });
        chapter.scenes.forEach((scene, sceneIndex) => {
          scene.id = text(scene.id || uid('scene'));
          scene.name = text(scene.name || `场景${sceneIndex + 1}`).trim() || `场景${sceneIndex + 1}`;
          scene.content = normalizeSceneContent(scene.content, chapter.title);
        });
      });
    });
    if (!state.outline || typeof state.outline !== 'object') state.outline = {};
    if (!state.outline.book) state.outline.book = { title: state.title || '未命名小说', oneLine: '', themes: [] };
    state.title = text(state.title || (getPreview().novel && getPreview().novel.title) || '未命名小说');
    state.outline.book.title = state.title;
    state.settings = state.settings && typeof state.settings === 'object' ? state.settings : {};
    state.settings.think = state.settings.think === true;
    state.settings.reasoningEffort = text(state.settings.reasoningEffort || '').toLowerCase();
    state.settings.characterMaterialMode = ['raw', 'strong', 'off'].includes(state.settings.characterMaterialMode) ? state.settings.characterMaterialMode : 'raw';
    syncOutline(state);
    if (!state.knowledge || typeof state.knowledge !== 'object') state.knowledge = { entities: {}, edges: [], version: 1 };
    if (!state.knowledge.entities || Array.isArray(state.knowledge.entities)) state.knowledge.entities = {};
    if (!Array.isArray(state.knowledge.edges)) state.knowledge.edges = [];
    if (!Array.isArray(state.foreshadows)) state.foreshadows = [];
    if (!Array.isArray(state.history)) state.history = [];
    state.searchChangeSets = Array.isArray(state.searchChangeSets) ? state.searchChangeSets.slice(0, 20) : [];
    state.chapterContracts = state.chapterContracts && typeof state.chapterContracts === 'object' && !Array.isArray(state.chapterContracts) ? state.chapterContracts : {};
    state.generationRuns = Array.isArray(state.generationRuns) ? state.generationRuns : [];
    state.creationBookId = text(state.creationBookId || state.workspace && state.workspace.creationBrief && state.workspace.creationBrief.creationBookId || '');
    state.creationBibleVersion = Math.max(0, Number(state.creationBibleVersion) || 0);
    state.creationStateVersion = Math.max(0, Number(state.creationStateVersion) || 0);
    state.creationContext = state.creationContext && typeof state.creationContext === 'object' ? state.creationContext : null;
    state.creationPlan = state.creationPlan && typeof state.creationPlan === 'object' ? state.creationPlan : state.workspace && state.workspace.creationBrief && state.workspace.creationBrief.plan || null;
    state.creationBookLinked = state.creationBookLinked === true;
    state.editorCanonSnapshot = state.editorCanonSnapshot && typeof state.editorCanonSnapshot === 'object' && !Array.isArray(state.editorCanonSnapshot)
      ? state.editorCanonSnapshot
      : null;
    state.factLedger = normalizeFactLedger(state.factLedger);
    return state;
  }

  function creationRequest(path, options) {
    const request = refFunction('backendRequest');
    const backend = getBackend();
    if (!request || !backend.token) return Promise.reject(new Error('当前账户未连接创作书服务'));
    const requestOptions = { ...(options || {}) };
    const onStart = requestOptions.onStart;
    const onFinish = requestOptions.onFinish;
    const controller = requestOptions.signal ? null : new AbortController();
    if (controller) requestOptions.signal = controller.signal;
    delete requestOptions.onStart;
    delete requestOptions.onFinish;
    if (typeof onStart === 'function') {
      try { onStart(controller); } catch (_) {}
    }
    return Promise.resolve().then(() => request(path, requestOptions)).catch(error => {
      if (error && error.name === 'AbortError' && !error.code) {
        error.code = 'REQUEST_ABORTED';
        error.partialText = '';
      }
      throw error;
    }).finally(() => {
      if (typeof onFinish === 'function') {
        try { onFinish(controller); } catch (_) {}
      }
    });
  }

  function creationChapterNo(state, chapterId) {
    let number = 0;
    chapterSequence(state).some(item => {
      number += 1;
      return item.chapter.id === chapterId;
    });
    return number || 1;
  }

  async function hydrateCreationContext(state) {
    const id = text(state && state.creationBookId);
    if (!id || !getBackend().token) return null;
    const current = activeRefs(state);
    const key = `${id}:${current.chapter && current.chapter.id || ''}`;
    if (runtime.creationHydrationKey === key) return state.creationContext;
    if (runtime.creationHydrationPromise) return runtime.creationHydrationPromise;
    runtime.creationHydrationKey = key;
    runtime.creationHydrationPromise = creationRequest(`/api/creation-books/${encodeURIComponent(id)}/state?chapterNo=${creationChapterNo(state, current.chapter && current.chapter.id)}`, {}).then(data => {
      if (!data || !data.bible) throw new Error('创作圣经尚未准备好');
      state.creationContext = { book: data.book || {}, bible: data.bible, snapshots: Array.isArray(data.snapshots) ? data.snapshots : [] };
      state.creationBibleVersion = Number(data.bible.version) || Number(state.creationBibleVersion) || 0;
      state.creationStateVersion = Number(data.book && data.book.currentStateVersion) || Number(state.creationStateVersion) || 0;
      state.creationPlan = data.book && data.book.plan || state.creationPlan;
      renderCreationCost(state);
      return state.creationContext;
    }).catch(error => {
      runtime.creationHydrationKey = '';
      toast(error && error.message || '创作圣经读取失败');
      return null;
    }).finally(() => { runtime.creationHydrationPromise = null; });
    return runtime.creationHydrationPromise;
  }

  function normalizeSceneContent(content, chapterTitle) {
    const value = text(content).trim();
    if (!value) return '';
    const html = sanitizeHtml(value);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    holder.querySelectorAll('.editor-paper-meta').forEach(node => node.remove());
    const firstHeading = holder.querySelector('h1,h2');
    if (firstHeading && (!chapterTitle || firstHeading.textContent.trim() === chapterTitle.trim())) firstHeading.remove();
    return holder.innerHTML.trim();
  }

  function sceneHasText(chapter) {
    return !!(chapter && Array.isArray(chapter.scenes) && chapter.scenes.some(scene => plainText(scene.content).trim()));
  }

  function chapterWords(chapter) {
    return chapter && Array.isArray(chapter.scenes) ? chapter.scenes.reduce((sum, scene) => sum + wordCount(scene.content), 0) : 0;
  }

  function getVolumeOutline(state, volume, create = true) {
    if (!state || !volume) return { title: '', synopsis: '', target: '', done: 0, total: 0, chapters: [] };
    state.outline = state.outline && typeof state.outline === 'object' ? state.outline : {};
    state.outline.volumes = state.outline.volumes && typeof state.outline.volumes === 'object' && !Array.isArray(state.outline.volumes) ? state.outline.volumes : {};
    let outline = state.outline.volumes[volume.id];
    if (!outline && create) {
      const legacy = volume === state.volumes[0] ? state.outline.volume : volume.outline;
      const legacyChapters = Array.isArray(legacy && legacy.chapters) ? legacy.chapters : volume === state.volumes[0] && Array.isArray(state.outline.chapters) ? state.outline.chapters : [];
      outline = { ...(legacy && typeof legacy === 'object' ? legacy : {}), title: volume.title, chapters: cloneValue(legacyChapters) };
      state.outline.volumes[volume.id] = outline;
    }
    if (!outline) return { title: volume.title, synopsis: '', target: '', done: 0, total: 0, chapters: [] };
    outline.title = text(outline.title || volume.title) || volume.title;
    outline.synopsis = text(outline.synopsis || '');
    outline.target = text(outline.target || '');
    outline.chapters = Array.isArray(outline.chapters) ? outline.chapters : [];
    return outline;
  }

  function firstScene(state) {
    return state && state.volumes[0] && state.volumes[0].chapters[0] && state.volumes[0].chapters[0].scenes[0];
  }

  function activeRefs(state) {
    if (!state || !state.volumes.length) return { volume: null, chapter: null, scene: null };
    let volume = state.volumes.find(item => item.id === state.currentVolumeId) || state.volumes[0];
    let chapter = volume.chapters.find(item => item.id === state.currentChapterId);
    if (!chapter) chapter = volume.chapters[0] || null;
    let scene = chapter && chapter.scenes.find(item => item.id === state.currentSceneId);
    if (!scene) scene = chapter && chapter.scenes[0] || null;
    if (volume) state.currentVolumeId = volume.id;
    if (chapter) state.currentChapterId = chapter.id;
    if (scene) state.currentSceneId = scene.id;
    return { volume, chapter, scene };
  }

  function activeScene(state) {
    return activeRefs(state).scene;
  }

  function syncOutline(state) {
    if (!state || !Array.isArray(state.volumes)) return;
    state.outline = state.outline || {};
    state.outline.book = state.outline.book || {};
    state.outline.book.title = state.title;
    state.outline.volumes = state.outline.volumes && typeof state.outline.volumes === 'object' && !Array.isArray(state.outline.volumes) ? state.outline.volumes : {};
    state.volumes.forEach(volume => {
      const outline = getVolumeOutline(state, volume);
      const previousById = new Map(outline.chapters.filter(item => item && item.chapterId).map(item => [item.chapterId, item]));
      const previousByNum = new Map(outline.chapters.filter(item => item && item.num).map(item => [item.num, item]));
      outline.chapters = volume.chapters.map((chapter, index) => {
        const current = previousById.get(chapter.id) || previousByNum.get(chapter.title) || outline.chapters[index] || {};
        return {
          ...current,
          chapterId: chapter.id,
          num: chapter.title,
          title: text(current.title || chapter.sub || ''),
          synopsis: text(current.synopsis || ''),
          wordCount: chapterWords(chapter),
          status: sceneHasText(chapter) ? (current.status === 'writing' ? 'writing' : 'done') : (current.status || 'todo')
        };
      });
      outline.title = volume.title;
      outline.total = volume.chapters.length;
      outline.done = outline.chapters.filter(item => item.status === 'done' || item.status === 'writing').length;
    });
    const first = state.volumes[0];
    const firstOutline = first ? getVolumeOutline(state, first) : { title: '', chapters: [] };
    state.outline.volume = firstOutline;
    state.outline.chapters = firstOutline.chapters;
  }

  function knowledgeType(value) {
    const raw = text(value).trim();
    const map = {
      location: 'location', 地点: 'location', 场所: 'location',
      faction: 'faction', 势力: 'faction', 宗门: 'faction', 组织: 'faction',
      character: 'character', 人物: 'character', 角色: 'character',
      itemCategory: 'itemCategory', 物品类别: 'itemCategory', 物品分类: 'itemCategory',
      itemRank: 'itemRank', 品级: 'itemRank', 物品品级: 'itemRank',
      item: 'item', 物品: 'item', event: 'event', 事件: 'event'
    };
    return map[raw] || (['location', 'faction', 'character', 'itemCategory', 'itemRank', 'item', 'event'].includes(raw) ? raw : 'item');
  }

  function knowledgeLabel(type) {
    return { location: '地点', faction: '势力', character: '人物', itemCategory: '物品类别', itemRank: '物品品级', item: '物品', event: '事件' }[type] || '设定';
  }

  const DOSSIER_MATERIAL_TYPES = Object.freeze({
    items: { label: '道具', icon: 'package', fields: [['name', '名称'], ['description', '效果 / 说明'], ['owner', '当前持有者'], ['location', '当前所在地'], ['status', '状态']] },
    abilities: { label: '技能', icon: 'wand-sparkles', fields: [['name', '名称'], ['effect', '效果'], ['conditions', '使用条件'], ['cost', '代价'], ['limit', '限制']] },
    worldRules: { label: '世界规则', icon: 'scale', fields: [['name', '规则名称'], ['rule', '规则内容'], ['scope', '适用范围'], ['limit', '限制'], ['cost', '违反代价'], ['exception', '例外']] },
    cultures: { label: '社会文化', icon: 'landmark', fields: [['name', '文化条目'], ['kind', '分类'], ['description', '风俗 / 律法 / 货币 / 语言 / 信仰 / 阶级说明'], ['place', '适用地区'], ['period', '适用时期']] },
    historyEvents: { label: '历史事件', icon: 'history', fields: [['name', '事件名称'], ['storyTime', '故事内年代'], ['description', '事件经过'], ['consequence', '历史后果'], ['source', '史料 / 设定来源']] },
    powerSystems: { label: '能力体系', icon: 'zap', fields: [['name', '体系名称'], ['levels', '境界 / 等级'], ['upperLimit', '能力上限'], ['restrictions', '限制与代价'], ['exceptions', '例外规则']] },
    sceneMaterials: { label: '场景素材', icon: 'image', fields: [['name', '素材名称'], ['place', '适用地点'], ['conditions', '天气 / 时间 / 视角条件'], ['text', '环境描写素材']] },
    highlights: { label: '名场面 / 台词', icon: 'quote', fields: [['text', '台词或场面'], ['speaker', '说话者 / 相关人物'], ['scene', '关联场景'], ['usageStatus', '使用状态']] },
    terms: { label: '术语', icon: 'book-marked', fields: [['name', '正名'], ['aliases', '别名（用顿号分隔）'], ['definition', '定义'], ['scope', '适用时代 / 地区 / 体系'], ['notes', '歧义与禁混说明']] }
  });

  /** 确保作品资料中心拥有单一可维护的定位和专项素材容器。 */
  function ensureProjectDossier(state) {
    if (!state) return { profile: {}, assets: {} };
    const assets = state.creationAssets && typeof state.creationAssets === 'object' && !Array.isArray(state.creationAssets)
      ? state.creationAssets
      : {};
    state.creationAssets = assets;
    const outlineBook = state.outline && state.outline.book && typeof state.outline.book === 'object' ? state.outline.book : {};
    const profile = state.projectProfile && typeof state.projectProfile === 'object' && !Array.isArray(state.projectProfile)
      ? state.projectProfile
      : assets.projectProfile && typeof assets.projectProfile === 'object' && !Array.isArray(assets.projectProfile)
        ? assets.projectProfile
        : {};
    state.projectProfile = {
      ...profile,
      title: text(profile.title || state.title || outlineBook.title || ''),
      subtitle: text(profile.subtitle || outlineBook.subtitle || ''),
      penName: text(profile.penName || outlineBook.penName || ''),
      primaryGenre: text(profile.primaryGenre || state.type || outlineBook.themes && outlineBook.themes[0] || ''),
      genreTags: Array.isArray(profile.genreTags) ? profile.genreTags : Array.isArray(state.creationPlan && state.creationPlan.lines) ? [] : [],
      theme: text(profile.theme || outlineBook.theme || ''),
      tone: text(profile.tone || outlineBook.tone || ''),
      audience: text(profile.audience || ''),
      sellingPoints: Array.isArray(profile.sellingPoints) ? profile.sellingPoints : Array.isArray(outlineBook.sellingPoints) ? outlineBook.sellingPoints : [],
      shortSynopsis: text(profile.shortSynopsis || outlineBook.shortSynopsis || outlineBook.oneLine || state.description || ''),
      longSynopsis: text(profile.longSynopsis || outlineBook.longSynopsis || ''),
      marketingCopy: Array.isArray(profile.marketingCopy) ? profile.marketingCopy : []
    };
    Object.keys(DOSSIER_MATERIAL_TYPES).forEach(typeName => {
      if (!Array.isArray(assets[typeName])) assets[typeName] = [];
    });
    return { profile: state.projectProfile, assets };
  }

  /** 将作品定位和专项资料压缩成正文生成可引用的只读上下文。 */
  function projectDossierContextText(state) {
    const dossier = ensureProjectDossier(state);
    const assets = Object.fromEntries(Object.entries(dossier.assets).map(([kind, items]) => [
      kind,
      (Array.isArray(items) ? items : []).slice(0, 40).map(item => cloneValue(item))
    ]));
    return JSON.stringify({ profile: cloneValue(dossier.profile), assets });
  }

  /** 为导出和导入移除认证、会话及其他不可携带的敏感字段。 */
  function sanitizeDossierExport(value) {
    if (Array.isArray(value)) return value.map(sanitizeDossierExport);
    if (!value || typeof value !== 'object') return value;
    const blocked = /^(?:token|accessToken|refreshToken|password|pwd|salt|apiKey|authorization|cookie|session|secret|credential|privateKey)$/i;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !blocked.test(key)).map(([key, item]) => [key, sanitizeDossierExport(item)]));
  }

  /** 将资料包中的结构化数组按稳定ID合并到当前作品，不覆盖现有同ID记录。 */
  function mergeDossierPackage(state, packageData) {
    const dossier = ensureProjectDossier(state);
    const data = packageData && packageData.data && typeof packageData.data === 'object' ? packageData.data : packageData;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('资料包格式不正确');
    if (data.projectId && getPreview().novelId && String(data.projectId) !== String(getPreview().novelId)) throw new Error('资料包属于其他作品，已拒绝合并');
    if (data.projectProfile && typeof data.projectProfile === 'object') {
      dossier.profile = { ...dossier.profile, ...Object.fromEntries(Object.entries(data.projectProfile).filter(([, value]) => value !== '' && value != null)) };
      state.projectProfile = dossier.profile;
    }
    const sourceAssets = data.creationAssets && typeof data.creationAssets === 'object' ? data.creationAssets : data.assets;
    if (sourceAssets && typeof sourceAssets === 'object') {
      Object.keys(DOSSIER_MATERIAL_TYPES).forEach(typeName => {
        const incoming = Array.isArray(sourceAssets[typeName]) ? sourceAssets[typeName] : [];
        const existingIds = new Set(dossier.assets[typeName].map(item => String(item && item.id || '')));
        incoming.forEach((item, index) => {
          const source = item && typeof item === 'object' ? sanitizeDossierExport(item) : { name: String(item || '') };
          const id = String(source.id || `${typeName}-${index + 1}`);
          if (!existingIds.has(id)) {
            dossier.assets[typeName].push({ ...source, id });
            existingIds.add(id);
          }
        });
      });
    }
    if (data.timeline && Array.isArray(data.timeline)) {
      const existingIds = new Set((state.timeline || []).map(item => String(item && item.id || '')));
      state.timeline = Array.isArray(state.timeline) ? state.timeline : [];
      data.timeline.forEach((item, index) => {
        const source = item && typeof item === 'object' ? sanitizeDossierExport(item) : { title: String(item || '') };
        const id = String(source.id || `event-${index + 1}`);
        if (!existingIds.has(id)) { state.timeline.push({ ...source, id }); existingIds.add(id); }
      });
    }
    return dossier;
  }

  /** 导出当前作品的完整本地资料包，不携带认证和账户数据。 */
  async function exportProjectDossier() {
    const state = editorState(false);
    if (!state) { toast('请先打开一本作品'); return; }
    const dossier = ensureProjectDossier(state);
    const remoteId = String(getPreview().novelId || '');
    const backend = getBackend();
    const request = refFunction('backendRequest');
    if (backend && backend.token && request && isServerNovelId(remoteId)) {
      try {
        const response = await request(`/api/novels/${encodeURIComponent(remoteId)}/package`);
        const packageValue = response && response.package;
        if (!packageValue) throw new Error('服务端未返回资料包');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([JSON.stringify(packageValue, null, 2)], { type: 'application/json;charset=utf-8' }));
        link.download = `${text(dossier.profile.title || state.title || '小说资料')}-资料包.json`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        toast('完整小说资料包已导出');
        return;
      } catch (error) {
        if ([401, 403, 404].includes(Number(error && error.status))) {
          toast('当前账户没有导出该作品资料包的权限');
          return;
        }
        toast(error && error.message || '服务端资料包导出失败');
        return;
      }
    }
    const data = sanitizeDossierExport({
      projectId: remoteId,
      projectProfile: dossier.profile,
      creationPlan: state.creationPlan || {},
      creationAssets: state.creationAssets || {},
      outline: state.outline || {},
      volumes: state.volumes || [],
      knowledge: state.knowledge || {},
      timeline: state.timeline || state.workspace && state.workspace.timeline || [],
      foreshadows: state.foreshadows || [],
      manuscriptHistory: state.history || [],
      exportedAt: new Date().toISOString()
    });
    const serialized = JSON.stringify(data);
    const packageData = {
      schemaVersion: 'molan-local-project-package-v1',
      manifest: {
        projectId: remoteId,
        encoding: 'UTF-8',
        bodyHash: await hashText(serialized),
        dataKeys: Object.keys(data)
      },
      data
    };
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(packageData, null, 2)], { type: 'application/json;charset=utf-8' }));
    link.download = `${text(dossier.profile.title || state.title || '小说资料')}-资料包.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast('完整小说资料包已导出');
  }

  /** 从本地资料包合并定位、专项素材和时间线，失败时不修改当前作品。 */
  function importProjectDossier() {
    openImportFileChooser('导入小说资料包', '.json', '仅导入本地资料包。会校验作品范围并按稳定ID合并，不覆盖当前同ID资料，不读取凭据。', async files => {
      const state = editorState(true);
      let imported = 0;
      for (const file of files) {
        const raw = await readImportedText(file);
        let packageData;
        try { packageData = JSON.parse(raw); } catch (_) { toast('资料包 JSON 无法解析'); continue; }
        if (packageData && packageData.manifest && packageData.manifest.format === 'molan-project-package') {
          const stateFile = packageData.files && packageData.files['data/state.json'];
          if (!stateFile || typeof stateFile.content !== 'string') { toast('服务端资料包缺少作品状态文件'); continue; }
          let importedState;
          try { importedState = JSON.parse(stateFile.content); } catch (_) { toast('服务端资料包状态无法解析'); continue; }
          packageData = { schemaVersion: 'molan-local-project-package-v1', data: { ...importedState, projectId: packageData.manifest.scope && packageData.manifest.scope.projectId } };
        }
        if (!packageData || packageData.schemaVersion !== 'molan-local-project-package-v1' || !packageData.data) { toast('资料包版本不受支持'); continue; }
        const serialized = JSON.stringify(packageData.data);
        if (packageData.manifest && packageData.manifest.bodyHash && await hashText(serialized) !== packageData.manifest.bodyHash) { toast('资料包哈希校验失败'); continue; }
        mergeDossierPackage(state, packageData);
        imported += 1;
      }
      if (!imported) return;
      markEditorDirty(true);
      toast(`已合并 ${imported} 个资料包，当前同ID资料未被覆盖`);
    });
  }

  /** 渲染作品定位编辑器和专项资料入口。 */
  function openProjectDossier() {
    const state = editorState(true);
    const dossier = ensureProjectDossier(state);
    const profile = dossier.profile;
    const materialButtons = Object.entries(DOSSIER_MATERIAL_TYPES).map(([typeName, meta]) =>
      `<button class="button" type="button" data-completion-dossier-action="materials" data-dossier-kind="${esc(typeName)}">${ico(meta.icon)}${meta.label}（${dossier.assets[typeName].length}）</button>`).join('');
    const body = `<div class="notice"><span>这是当前作品的统一资料入口。保存后会跟随作品状态保存；专项资料按稳定ID合并，不再依赖正文中的名称字符串。</span></div><div class="form-grid" style="margin-top:12px"><div class="field"><label for="dossierTitle">书名</label><input id="dossierTitle" value="${esc(profile.title)}"></div><div class="field"><label for="dossierSubtitle">副标题</label><input id="dossierSubtitle" value="${esc(profile.subtitle)}"></div><div class="field"><label for="dossierPenName">笔名</label><input id="dossierPenName" value="${esc(profile.penName)}"></div><div class="field"><label for="dossierGenre">主题材 / 类型</label><input id="dossierGenre" value="${esc(profile.primaryGenre)}"></div><div class="field"><label for="dossierTags">复合题材标签</label><input id="dossierTags" value="${esc((profile.genreTags || []).join('、'))}" placeholder="例如：都市、悬疑、轻喜剧"></div><div class="field"><label for="dossierAudience">目标读者</label><input id="dossierAudience" value="${esc(profile.audience)}"></div><div class="field"><label for="dossierTone">作品基调</label><input id="dossierTone" value="${esc(profile.tone)}" placeholder="轻松、暗黑、治愈等"></div><div class="field"><label for="dossierTheme">核心主题 / 立意</label><textarea id="dossierTheme">${esc(profile.theme)}</textarea></div><div class="field"><label for="dossierSellingPoints">核心卖点</label><textarea id="dossierSellingPoints">${esc((profile.sellingPoints || []).join('\n'))}</textarea></div><div class="field"><label for="dossierShortSynopsis">短简介</label><textarea id="dossierShortSynopsis">${esc(profile.shortSynopsis)}</textarea></div><div class="field"><label for="dossierLongSynopsis">长简介</label><textarea id="dossierLongSynopsis">${esc(profile.longSynopsis)}</textarea></div><div class="field"><label for="dossierMarketingCopy">平台宣传文案</label><textarea id="dossierMarketingCopy">${esc((profile.marketingCopy || []).join('\n'))}</textarea></div></div><div class="section-title" style="margin-top:16px">专项资料</div><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px">${materialButtons}</div><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:13px"><button class="button" type="button" data-completion-dossier-action="import">${ico('upload')}导入资料包</button><button class="button" type="button" data-completion-dossier-action="export">${ico('download')}导出完整资料包</button></div>`;
    openEditorForm('作品资料中心', body, '保存定位', () => {
      const tags = document.getElementById('dossierTags').value.split(/[、,，\s]+/).map(item => item.trim()).filter(Boolean);
      profile.title = document.getElementById('dossierTitle').value.trim() || state.title || '未命名小说';
      profile.subtitle = document.getElementById('dossierSubtitle').value.trim();
      profile.penName = document.getElementById('dossierPenName').value.trim();
      profile.primaryGenre = document.getElementById('dossierGenre').value.trim();
      profile.genreTags = tags;
      profile.audience = document.getElementById('dossierAudience').value.trim();
      profile.tone = document.getElementById('dossierTone').value.trim();
      profile.theme = document.getElementById('dossierTheme').value.trim();
      profile.sellingPoints = document.getElementById('dossierSellingPoints').value.split(/\n+/).map(item => item.trim()).filter(Boolean);
      profile.shortSynopsis = document.getElementById('dossierShortSynopsis').value.trim();
      profile.longSynopsis = document.getElementById('dossierLongSynopsis').value.trim();
      profile.marketingCopy = document.getElementById('dossierMarketingCopy').value.split(/\n+/).map(item => item.trim()).filter(Boolean);
      state.title = profile.title;
      state.description = profile.shortSynopsis;
      state.type = profile.primaryGenre;
      state.outline = state.outline || {};
      state.outline.book = { ...(state.outline.book || {}), title: profile.title, subtitle: profile.subtitle, penName: profile.penName, oneLine: profile.shortSynopsis, shortSynopsis: profile.shortSynopsis, longSynopsis: profile.longSynopsis, theme: profile.theme, tone: profile.tone, themes: profile.genreTags, sellingPoints: profile.sellingPoints };
      markEditorDirty(false);
      closeExistingModal();
      toast('作品定位资料已保存');
    });
  }

  /** 打开指定专项资料列表，允许新增、编辑和归档删除。 */
  function openDossierMaterials(kind) {
    const state = editorState(true);
    const dossier = ensureProjectDossier(state);
    const meta = DOSSIER_MATERIAL_TYPES[kind];
    if (!meta) return;
    const rows = dossier.assets[kind].length
      ? dossier.assets[kind].map((item, index) => `<div class="task-row"><span class="task-icon">${ico(meta.icon)}</span><div class="task-copy"><div class="task-title">${esc(item.name || item.text || `第${index + 1}项`)}</div><div class="task-meta">${esc(item.description || item.effect || item.definition || item.text || item.detail || '')}</div></div><button class="button" type="button" data-completion-dossier-action="edit" data-dossier-kind="${esc(kind)}" data-dossier-index="${index}">编辑</button><button class="button" type="button" data-completion-dossier-action="delete" data-dossier-kind="${esc(kind)}" data-dossier-index="${index}">移除</button></div>`).join('')
      : '<div class="empty"><div class="empty-icon">—</div><p>还没有资料。</p></div>';
    openEditorForm(`${meta.label}资料`, `<div class="task-list">${rows}</div><button class="button primary" type="button" style="margin-top:12px" data-completion-dossier-action="add" data-dossier-kind="${esc(kind)}">${ico('plus')}新增${meta.label}</button>`, '关闭', closeExistingModal);
  }

  /** 打开专项资料单条编辑器并保留未使用字段。 */
  function editDossierMaterial(kind, index) {
    const state = editorState(true);
    const dossier = ensureProjectDossier(state);
    const meta = DOSSIER_MATERIAL_TYPES[kind];
    if (!meta) return;
    const current = index >= 0 ? dossier.assets[kind][index] : {};
    const fields = meta.fields.map(([field, label]) => {
      const value = Array.isArray(current[field]) ? current[field].join('、') : String(current[field] || '');
      const multiline = ['description', 'effect', 'conditions', 'definition', 'text', 'notes', 'rule', 'exception', 'consequence', 'levels', 'restrictions'].includes(field);
      return `<div class="field"><label for="dossierMaterial-${esc(field)}">${esc(label)}</label>${multiline ? `<textarea id="dossierMaterial-${esc(field)}">${esc(value)}</textarea>` : `<input id="dossierMaterial-${esc(field)}" value="${esc(value)}">`}</div>`;
    }).join('');
    openEditorForm(`${index >= 0 ? '编辑' : '新增'}${meta.label}`, `<div class="form-grid">${fields}</div>`, '保存', () => {
      const next = { ...current, id: String(current.id || uid(`dossier-${kind}`)), updatedAt: Date.now() };
      meta.fields.forEach(([field]) => {
        const value = document.getElementById(`dossierMaterial-${field}`).value.trim();
        next[field] = field === 'aliases' ? value.split(/[、,，\s]+/).map(item => item.trim()).filter(Boolean) : value;
      });
      if (index >= 0) dossier.assets[kind][index] = next; else dossier.assets[kind].push(next);
      markEditorDirty(false);
      closeExistingModal();
      openDossierMaterials(kind);
    });
  }

  function ensureKnowledge(state) {
    if (!state) return { entities: [], edges: [] };
    state.knowledge = state.knowledge || { entities: {}, edges: [], version: 1 };
    if (!state.knowledge.entities || Array.isArray(state.knowledge.entities)) state.knowledge.entities = {};
    if (!Array.isArray(state.knowledge.edges)) state.knowledge.edges = [];
    const existingIds = new Set(Object.keys(state.knowledge.entities));
    if (!existingIds.size) {
      const legacy = readWorkspace('knowledge', []);
      legacy.forEach(item => {
        const id = text(item.id || uid('entity'));
        state.knowledge.entities[id] = {
          id,
          type: knowledgeType(item.type),
          name: text(item.name || '未命名设定'),
          aliases: Array.isArray(item.aliases) ? item.aliases.map(text) : [],
          tags: Array.isArray(item.tags) ? item.tags.map(text) : [],
          archetype: normalizeCharacterArchetype(item.archetype),
          archetypeSource: item.archetypeSource === 'explicit' || item.archetypeSource === 'inferred' ? item.archetypeSource : 'none',
          archetypeConfidence: Number(item.archetypeConfidence) || 0,
          parentId: text(item.parentId || ''),
          notes: text(item.notes || item.intro || ''),
          status: text(item.status || ''),
          archived: !!item.archived,
          currentLocation: text(item.currentLocation || ''),
          owner: text(item.owner || ''),
          attrs: Array.isArray(item.attrs) ? item.attrs : [],
          createdAt: Number(item.createdAt) || Date.now(),
          updatedAt: Number(item.updatedAt) || Date.now()
        };
      });
    }
    const entities = Object.values(state.knowledge.entities);
    const byRef = new Map();
    entities.forEach(entity => {
      entity.id = text(entity.id || uid('entity'));
      entity.type = knowledgeType(entity.type);
      entity.name = text(entity.name || '未命名设定').trim() || '未命名设定';
      entity.aliases = Array.isArray(entity.aliases) ? entity.aliases.map(text).filter(Boolean) : [];
      entity.tags = Array.isArray(entity.tags) ? entity.tags.map(text).filter(Boolean) : [];
      entity.archetype = normalizeCharacterArchetype(entity.archetype);
      entity.archetypeSource = entity.archetypeSource === 'explicit' || entity.archetypeSource === 'inferred' ? entity.archetypeSource : 'none';
      entity.archetypeConfidence = Number(entity.archetypeConfidence) || 0;
      entity.attrs = Array.isArray(entity.attrs) ? entity.attrs : [];
      entity.notes = text(entity.notes || entity.intro || '');
      entity.status = text(entity.status || '待确认');
      entity.archived = !!entity.archived;
      entity.updatedAt = Number(entity.updatedAt) || Date.now();
      [entity.id, entity.name, ...entity.aliases].forEach(ref => byRef.set(text(ref).toLowerCase(), entity.id));
    });
    state.knowledge.edges = state.knowledge.edges.map(edge => {
      const from = byRef.get(text(edge.from || edge.source).toLowerCase()) || text(edge.from || '');
      const to = byRef.get(text(edge.to || edge.target).toLowerCase()) || text(edge.to || '');
      return { ...edge, id: text(edge.id || uid('relation')), from, to, label: text(edge.label || edge.description || ''), relationType: text(edge.relationType || edge.type || 'related') };
    }).filter(edge => edge.from && edge.to && edge.from !== edge.to);
    return { entities, edges: state.knowledge.edges, byRef };
  }

  function knowledgeProjection(state) {
    const data = ensureKnowledge(state);
    return data.entities.map(entity => ({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      aliases: entity.aliases,
      tags: entity.tags,
      archetype: entity.archetype,
      archetypeSource: entity.archetypeSource,
      archetypeConfidence: entity.archetypeConfidence,
      parentId: entity.parentId,
      notes: entity.notes,
      intro: entity.notes,
      status: entity.status,
      archived: entity.archived,
      attrs: entity.attrs,
      updatedAt: entity.updatedAt
    }));
  }

  function syncKnowledgeWorkspace(state) {
    const list = knowledgeProjection(state);
    state.workspace = state.workspace || {};
    state.workspace.knowledge = list;
    writeWorkspace('knowledge', list);
  }

  function resolveEntity(state, ref) {
    const data = ensureKnowledge(state);
    const value = text(ref).toLowerCase();
    return data.entities.find(entity => entity.id === ref) || data.entities.find(entity => entity.name.toLowerCase() === value || entity.aliases.some(alias => alias.toLowerCase() === value)) || null;
  }

  function entityParent(state, entity) {
    return entity && entity.parentId ? resolveEntity(state, entity.parentId) : null;
  }

  function entityPath(state, entity) {
    const chain = [];
    const seen = new Set();
    let current = entity;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.unshift(current.name);
      current = entityParent(state, current);
    }
    return [knowledgeLabel(entity && entity.type), ...chain].join(' / ');
  }

  function citationStats(state, entity) {
    const needles = [entity.name, ...(entity.aliases || [])].filter(Boolean).map(value => text(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!needles.length) return { count: 0, chapters: [] };
    const pattern = new RegExp(needles.join('|'), 'g');
    const chapters = [];
    let count = 0;
    state.volumes.forEach(volume => volume.chapters.forEach(chapter => {
      const body = chapter.scenes.map(scene => plainText(scene.content)).join('\n');
      const hits = body.match(pattern);
      if (hits && hits.length) { count += hits.length; chapters.push(chapter.title); }
    }));
    return { count, chapters };
  }

  function relationRows(state, entity) {
    const data = ensureKnowledge(state);
    return data.edges.filter(edge => edge.from === entity.id || edge.to === entity.id).map(edge => {
      const other = resolveEntity(state, edge.from === entity.id ? edge.to : edge.from);
      return { edge, other };
    }).filter(row => row.other);
  }

  function stateTrash(state) {
    state.workspace = state.workspace || {};
    state.workspace.editorTrash = Array.isArray(state.workspace.editorTrash) ? state.workspace.editorTrash : readWorkspace('editor-trash', []);
    return state.workspace.editorTrash;
  }

  function stateTimeline(state) {
    state.workspace = state.workspace || {};
    if (Array.isArray(state.timeline)) state.workspace.timeline = state.timeline;
    else state.workspace.timeline = Array.isArray(state.workspace.timeline) ? state.workspace.timeline : readWorkspace('timeline', []);
    state.timeline = state.workspace.timeline;
    return state.workspace.timeline;
  }

  function syncWorkspaceCollections(state) {
    state.workspace = state.workspace || {};
    state.workspace.editorTrash = stateTrash(state);
    state.workspace.timeline = stateTimeline(state);
    state.workspace.outline = readWorkspace('outline', state.workspace.outline || []);
    writeWorkspace('editor-trash', state.workspace.editorTrash);
    writeWorkspace('timeline', state.workspace.timeline);
    writeWorkspace('outline', state.workspace.outline);
  }

  function setSaveStatus(value) {
    const node = getStage() && getStage().querySelector('[data-completion-save-status]');
    if (node) node.textContent = value;
  }

  function scheduleSave(options) {
    const saveOptions = options || {};
    runtime.editorScheduledSaveOptions = saveOptions;
    // 延迟分层：WAL 本地毫秒级（250ms）快速落地防护崩溃，云端异步持久化保持 700ms 防抖
    if (saveOptions.sceneRef) {
      scheduleEditorWalSave(saveOptions.sceneRef);
    } else if (saveOptions.patchSave) {
      const current = activeRefs(editorState(false));
      if (current && current.scene) scheduleEditorWalSave(current.scene);
    }
    window.clearTimeout(runtime.editorSaveTimer);
    runtime.editorSaveTimer = window.setTimeout(() => {
      runtime.editorScheduledSaveOptions = null;
      void persistNovel(saveOptions);
    }, 700);
    setSaveStatus('有未保存更改');
  }

  /** 先确保 WAL 已持久化，再用 revision/baseHash 对单个场景正文做 CAS PATCH。 */
  async function persistNovelScenePatch(options) {
    const state = editorState(false);
    const preview = getPreview();
    const backend = getBackend();
    const request = refFunction('backendRequest');
    if (!state || !isServerNovelId(preview.novelId) || !backend.token || !request) return null;
    if (runtime.editorSavePromise) {
      runtime.editorSaveQueued = true;
      runtime.editorSaveQueuedOptions = options || { patchSave: true };
      return runtime.editorSavePromise;
    }
    const saveVersion = runtime.editorChangeVersion;
    const requestSessionKey = editorSessionKey();
    let saveScene = options && options.sceneRef;
    let saveChapter = null;
    if (saveScene) {
      for (const volume of state.volumes || []) {
        saveChapter = (volume.chapters || []).find(chapter => (chapter.scenes || []).includes(saveScene));
        if (saveChapter) break;
      }
    } else {
      const current = activeRefs(state);
      saveScene = current.scene;
      saveChapter = current.chapter;
    }
    if (!saveScene || !saveChapter) return null;
    runtime.editorSavePromise = (async () => {
      setSaveStatus('正在保护并同步正文…');
      let savedWal = null;
      try {
        const doc = editorWalDocument(state, saveScene);
        if (!doc) return null;
        if (editorWalProjectHasConflict(state) || runtime.editorWalConflicts.has(doc.docKey)) {
          throw Object.assign(new Error('当前作品存在跨标签版本冲突，草稿已保留'), { walConflict: true });
        }
        savedWal = await writeEditorWal(state, saveScene);
        if (!savedWal) {
          setSaveStatus('正文没有新的待同步差异');
          return null;
        }
        const savedContent = savedWal.content;
        if (requestSessionKey !== editorSessionKey()) return null;
        const data = await request(`/api/novels/${encodeURIComponent(String(preview.novelId))}/scenes/${encodeURIComponent(doc.sceneId)}`, {
          method: 'PATCH',
          body: {
            chapterId: doc.chapterId,
            revision: savedWal.record.baseRevision,
            baseHash: savedWal.record.baseHash,
            operations: savedWal.record.operations
          }
        });
        if (requestSessionKey !== editorSessionKey()) return null;
        if (!data || !Number.isInteger(Number(data.revision))) throw new Error('云端未确认正文版本，WAL 已保留');
        const api = await loadEditorWalModule();
        const contentHash = await api.hashText(savedContent, window.crypto);
        if (data.contentHash && String(data.contentHash) !== contentHash) {
          throw Object.assign(new Error('云端正文校验不一致，WAL 已保留'), { walConflict: true });
        }
        preview.novelRevision = Number(data.revision);
        runtime.editorWalBaselines.forEach(baseline => {
          if (Number(baseline.revision) <= Number(data.revision)) baseline.revision = Number(data.revision);
        });
        runtime.editorWalBaselines.set(doc.docKey, { content: savedContent, revision: Number(data.revision) });
        const removed = await runtime.editorWal.remove(savedWal.record.opId, savedWal.record.operationVersion, {
          projectId: doc.projectId,
          docKey: doc.docKey,
          tabId: editorWalTabId(),
          revision: Number(data.revision),
          contentHash
        });
        const superseded = runtime.editorWalSuperseded.get(doc.docKey) || [];
        for (const record of superseded) {
          if (record.opId === savedWal.record.opId) continue;
          await runtime.editorWal.remove(record.opId, record.operationVersion, {
            projectId: doc.projectId,
            docKey: doc.docKey,
            tabId: editorWalTabId(),
            revision: Number(data.revision),
            contentHash
          });
          runtime.editorWalLatest.delete(record.opId);
          runtime.editorWalOperationVersions.delete(record.opId);
        }
        runtime.editorWalSuperseded.delete(doc.docKey);
        if (removed) {
          runtime.editorWalLatest.delete(savedWal.record.opId);
          runtime.editorWalOperationVersions.delete(savedWal.record.opId);
        }
        setSaveStatus(removed ? '当前场景已同步' : '正文新改动已写入本地 WAL，等待继续同步');
        window.dispatchEvent(new CustomEvent('molan:novel-saved', {
          detail: { localId: '', remoteId: String(preview.novelId), sessionKey: requestSessionKey, revision: Number(data.revision) }
        }));
        if (String(saveScene.content || '') !== savedContent) {
          scheduleSave({ patchSave: true, sceneRef: saveScene });
        }
        return data;
      } catch (error) {
        if (requestSessionKey !== editorSessionKey()) return null;
        if (error && (error.status === 409 || error.walConflict)) {
          const doc = editorWalDocument(state, saveScene);
          if (doc) runtime.editorWalConflicts.add(doc.docKey);
          persistEditorConflictDraft(state, preview.novelRevision);
          setSaveStatus('版本冲突，WAL 草稿已保留');
          toast('云端或其他标签页已更新正文，当前 WAL 草稿已保留；请重新读取并手动合并');
        } else {
          setSaveStatus(savedWal ? '正文已保存在本地，等待云端同步' : '本地 WAL 未确认，正文未同步');
          toast(error && error.message || (savedWal ? '正文云端同步失败，本地 WAL 已保留' : '本地 WAL 保存失败，正文未同步'));
        }
        return null;
      } finally {
        runtime.editorSavePromise = null;
        if (runtime.editorSaveQueued || runtime.editorChangeVersion > saveVersion) {
          const queuedOptions = runtime.editorSaveQueuedOptions || runtime.editorScheduledSaveOptions ||
            (options && options.patchSave ? { patchSave: true, sceneRef: saveScene } : {});
          runtime.editorSaveQueued = false;
          runtime.editorSaveQueuedOptions = null;
          scheduleSave(queuedOptions);
        }
      }
    })();
    return runtime.editorSavePromise;
  }

  async function persistNovel(options) {
    const state = editorState(false);
    if (!state) return null;
    const preview = getPreview();
    const backend = getBackend();
    const request = refFunction('backendRequest');
    if (options && options.patchSave && !options.snapshot && backend.token && request && isServerNovelId(preview.novelId)) {
      return persistNovelScenePatch(options);
    }
    if (runtime.editorSavePromise) {
      runtime.editorSaveQueued = true;
      runtime.editorSaveQueuedOptions = options || {};
      return runtime.editorSavePromise;
    }
    const saveVersion = runtime.editorChangeVersion;
    syncOutline(state);
    syncKnowledgeWorkspace(state);
    syncWorkspaceCollections(state);
    state.updatedAt = Date.now();
    if (options && options.snapshot) captureVersion(state);
    const requestSessionKey = editorSessionKey();
    const localNovelId = String(preview._libraryLocalId || (!isServerNovelId(preview.novelId) ? preview.novelId || '' : ''));
    const sceneSnapshot = new Map();
    if (isServerNovelId(preview.novelId)) {
      const projectId = editorWalProjectId(state);
      (state.volumes || []).forEach(volume => (volume.chapters || []).forEach(chapter => (chapter.scenes || []).forEach(scene => {
        sceneSnapshot.set(`${projectId}|${encodeURIComponent(chapter.id)}|${encodeURIComponent(scene.id)}`, String(scene.content || ''));
      })));
    }
    runtime.editorSavePromise = (async () => {
      setSaveStatus('正在保存…');
      try {
        if (backend.token && request) {
          const serverNovelId = isServerNovelId(preview.novelId) ? String(preview.novelId) : '';
          if (serverNovelId && (editorWalProjectHasConflict(state) || await editorWalHasUnrepresentedDraft(state, sceneSnapshot))) {
            throw Object.assign(new Error('其他标签页的场景草稿仍待合并，已阻止覆盖式保存'), { walConflict: true });
          }
          const endpoint = serverNovelId ? `/api/novels/${encodeURIComponent(serverNovelId)}` : '/api/novels';
          const data = await request(endpoint, {
            method: serverNovelId ? 'PUT' : 'POST',
            body: serverNovelId
              ? { state, title: preview.novel && preview.novel.title || state.title, revision: preview.novelRevision }
              : { state, title: preview.novel && preview.novel.title || state.title, workspaceId: preview.workspaceId || '' }
          });
          if (requestSessionKey !== editorSessionKey()) return;
           if (data && data.id) preview.novelId = data.id;
           if (data && data.id && localNovelId && localNovelId !== String(data.id)) preview._libraryLocalId = '';
           if (data && Number.isInteger(data.revision)) preview.novelRevision = data.revision;
           const walClean = await acknowledgeEditorWalPut(state, sceneSnapshot, data && data.revision);
           clearEditorConflictDraft(state);
           if (state.creationBookId && data && data.id && !state.creationBookLinked) {
             try {
               await request(`/api/creation-books/${encodeURIComponent(state.creationBookId)}/link-novel`, { method: 'POST', body: { novelId: String(data.id) } });
               state.creationBookLinked = true;
             } catch (linkError) {
               toast(linkError && linkError.message || '创作书与小说尚未完成关联，已保留待同步状态');
             }
           }
           setSaveStatus(walClean ? '已保存到后端' : '作品已保存，仍有本地 WAL 草稿待处理');
          window.dispatchEvent(new CustomEvent('molan:novel-saved', { detail: { localId: localNovelId, remoteId: String(data && data.id || preview.novelId || ''), sessionKey: requestSessionKey } }));
        } else {
          try { localStorage.setItem('molan_guest_novel_state', JSON.stringify({ novel: preview.novel, state })); } catch (_) { throw new Error('本地保存失败，浏览器存储空间不足'); }
          setSaveStatus('已保存到本地浏览器');
          window.dispatchEvent(new CustomEvent('molan:novel-saved', { detail: { localId: localNovelId, remoteId: '', sessionKey: requestSessionKey } }));
        }
      } catch (error) {
        if (requestSessionKey !== editorSessionKey()) return null;
        setSaveStatus('保存失败');
        if (error && (error.status === 409 || error.walConflict)) {
          const doc = editorWalDocument(state);
          if (doc) runtime.editorWalConflicts.add(doc.docKey);
          persistEditorConflictDraft(state, preview.novelRevision);
          setSaveStatus('版本冲突，草稿已暂存');
          toast('云端版本已更新，未保存修改已暂存；请重新读取后手动合并，系统不会覆盖他人修改');
        } else {
          toast(error && error.message || '作品保存失败');
        }
        throw error;
      } finally {
        runtime.editorSavePromise = null;
        if (runtime.editorSaveQueued || runtime.editorChangeVersion > saveVersion) {
          const queuedOptions = runtime.editorSaveQueuedOptions || runtime.editorScheduledSaveOptions || {};
          runtime.editorSaveQueued = false;
          runtime.editorSaveQueuedOptions = null;
          scheduleSave(queuedOptions);
        }
      }
    })();
    const promise = runtime.editorSavePromise;
    try { await promise; } catch (_) {}
    return promise;
  }

  function captureVersion(state) {
    const current = activeRefs(state);
    if (!current.scene) return;
    state.history = Array.isArray(state.history) ? state.history : [];
    const snapshot = {
      id: uid('version'),
      t: Date.now(),
      chapter: current.chapter.title,
      scene: current.scene.name,
      chapterId: current.chapter.id,
      sceneId: current.scene.id,
      text: plainText(current.scene.content),
      words: wordCount(current.scene.content),
      excerpt: plainText(current.scene.content).slice(0, 180)
    };
    const previous = state.history[0];
    if (previous && previous.chapterId === snapshot.chapterId && previous.sceneId === snapshot.sceneId && previous.text === snapshot.text) return;
    state.history.unshift(snapshot);
    state.history = state.history.slice(0, 50);
  }

  function renderAddChapterButton(volume) {
    return `<button class="button completion-add-chapter" style="width:calc(100% - 12px);margin:4px 6px 10px;min-height:29px;padding:0 7px;font-size:10px" data-completion-action="add-chapter" data-volume-id="${esc(volume.id)}" aria-label="在${esc(volume.title)}新增章节">${ico('plus')}新增章节</button>`;
  }

  const EDITOR_TREE_ROW_HEIGHT = 36;
  const EDITOR_TREE_OVERSCAN = 8;

  function buildEditorTreeRows(state) {
    const rows = [];
    (state.volumes || []).forEach((volume, volumeIndex) => {
      rows.push({ key: 'volume:' + volume.id, kind: 'volume', volume, volumeIndex });
      (volume.chapters || []).forEach((chapter, chapterIndex) => {
        rows.push({ key: 'chapter:' + chapter.id, kind: 'chapter', volume, chapter, chapterIndex });
        (chapter.scenes || []).forEach((scene, sceneIndex) => {
          rows.push({ key: 'scene:' + scene.id, kind: 'scene', volume, chapter, scene, sceneIndex });
        });
        rows.push({ key: 'add-scene:' + chapter.id, kind: 'add-scene', volume, chapter });
      });
      rows.push({ key: 'add-chapter:' + volume.id, kind: 'add-chapter', volume });
    });
    return rows;
  }

  function renderEditorTreeRow(row, state) {
    const fixedRow = 'box-sizing:border-box;height:34px;min-height:34px;max-height:34px;margin:0 0 2px;overflow:hidden';
    if (row.kind === 'volume') {
      return '<div class="tree-heading completion-tree-row" style="' + fixedRow + ';padding:4px 5px"><span>' + ico('folder') +
        '</span><strong style="margin-left:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(row.volume.title) +
        '</strong><button class="icon-button" data-completion-action="add-chapter" data-volume-id="' + esc(row.volume.id) +
        '" aria-label="在此卷新增章节" title="在此卷新增章节">' + ico('plus') + '</button></div>';
    }
    if (row.kind === 'chapter') {
      return '<div class="editor-chapter completion-tree-row ' + (row.chapter.id === state.currentChapterId ? 'active' : '') +
        '" style="' + fixedRow + '" data-completion-select-chapter="' + esc(row.chapter.id) + '" data-volume-id="' +
        esc(row.volume.id) + '" role="button" tabindex="0"><small>' + String(row.chapterIndex + 1).padStart(3, '0') +
        '</small><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(row.chapter.title) +
        '</span><i class="' + (sceneHasText(row.chapter) ? 'done' : '') + '"></i></div>';
    }
    if (row.kind === 'scene') {
      return '<div class="editor-chapter completion-tree-row completion-scene-row ' +
        (row.scene.id === state.currentSceneId ? 'active' : '') + '" style="' + fixedRow +
        ';padding-left:18px" data-completion-select-scene="' + esc(row.scene.id) + '" data-chapter-id="' +
        esc(row.chapter.id) + '" data-volume-id="' + esc(row.volume.id) +
        '" role="button" tabindex="0"><small>' + (row.sceneIndex + 1) +
        '</small><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(row.scene.name) + '</span></div>';
    }
    if (row.kind === 'add-scene') {
      return '<div class="completion-tree-row" style="' + fixedRow +
        ';display:flex;align-items:center"><button class="button" style="box-sizing:border-box;width:calc(100% - 12px);height:28px;min-height:28px;margin:0 6px;padding:0 7px;font-size:10px" data-completion-action="add-scene" data-chapter-id="' +
        esc(row.chapter.id) + '" data-volume-id="' + esc(row.volume.id) +
        '" aria-label="新增场景" title="新增场景">' + ico('plus') + '新增场景</button></div>';
    }
    return '<div class="completion-tree-row" style="' + fixedRow +
      ';display:flex;align-items:center"><button class="button completion-add-chapter" style="box-sizing:border-box;width:calc(100% - 12px);height:28px;min-height:28px;margin:0 6px;padding:0 7px;font-size:10px" data-completion-action="add-chapter" data-volume-id="' +
      esc(row.volume.id) + '" aria-label="在' + esc(row.volume.title) + '新增章节">' + ico('plus') + '新增章节</button></div>';
  }

  function renderEditorTreeWindow(nav, cache) {
    const top = nav.querySelector('[data-completion-tree-top]');
    const windowNode = nav.querySelector('[data-completion-tree-window]');
    const bottom = nav.querySelector('[data-completion-tree-bottom]');
    if (!top || !windowNode || !bottom || !cache) return;
    const paddingTop = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(nav).paddingTop) || 0 : 0;
    const localScroll = Math.max(0, nav.scrollTop - paddingTop);
    const visibleStart = Math.floor(localScroll / EDITOR_TREE_ROW_HEIGHT);
    const visibleCount = Math.max(1, Math.ceil(Math.max(nav.clientHeight, EDITOR_TREE_ROW_HEIGHT) / EDITOR_TREE_ROW_HEIGHT));
    const start = Math.max(0, visibleStart - EDITOR_TREE_OVERSCAN);
    const end = Math.min(cache.rows.length, visibleStart + visibleCount + EDITOR_TREE_OVERSCAN);
    if (nav.dataset.treeWindowStart === String(start) && nav.dataset.treeWindowEnd === String(end)) return;
    top.style.height = (start * EDITOR_TREE_ROW_HEIGHT) + 'px';
    windowNode.innerHTML = cache.rows.slice(start, end).map(row => renderEditorTreeRow(row, cache.state)).join('');
    bottom.style.height = (Math.max(0, cache.rows.length - end) * EDITOR_TREE_ROW_HEIGHT) + 'px';
    nav.dataset.treeWindowStart = String(start);
    nav.dataset.treeWindowEnd = String(end);
    mountIconsSafe();
  }

  function renderEditorPage() {
    const preview = getPreview();
    const state = editorState(false);
    const title = preview.novel && preview.novel.title || state && state.title || '未命名小说';
    const tools = `<button class="button" data-completion-action="editor-save">${ico('save')}保存</button><button class="button" data-completion-action="open-memory-workbench" style="color:var(--blue);border-color:var(--blue);font-weight:600">${ico('brain')}长篇记忆与文风</button><button class="button" data-completion-action="open-materials-seven" style="font-weight:600">${ico('folder-kanban')}全套资料(七大板块)</button><button class="button" data-completion-action="editor-import">${ico('upload')}导入文本</button><button class="button" data-completion-action="editor-export" data-feature="NOVEL_EXPORT" data-action="novel-export">${ico('download')}导出</button><button class="button" data-completion-action="create-from-dissection">${ico('scan-text')}拆书创书</button><button class="button primary" data-completion-action="editor-ai-focus">${ico('sparkles')}AI 助手</button>`;
    // P1-1：账号下有作品但当前未打开时，自动打开最近编辑的第一本（refreshData 完成后会重渲染触发）
    if (!state && !preview.novelId) {
      const backend = getBackend();
      const novels = (backend && backend.novelsLoaded && Array.isArray(backend.novels) && backend.novels.length) ? backend.novels : null;
      const opener = window.openBackendNovel || (typeof openBackendNovel !== 'undefined' ? openBackendNovel : null);
      if (novels && opener) {
        void opener(novels[0].id || novels[0].nid);
        return pageShell('editor', 'EDITOR', '小说编辑器', '正在打开你最近编辑的作品…', tools, '<div class="panel empty" style="padding:48px"><div class="empty-icon">—</div><h3>正在打开作品</h3><p>正在加载你最近编辑的小说，请稍候。</p></div>', 'editor-page');
      }
    }
    if (!state) return pageShell('editor', 'EDITOR', '小说编辑器', '打开作品后，正文、章节、设定和 AI 协作会共享同一份作品状态。', tools, '<div class="panel empty" style="padding:48px;max-width:560px;margin:40px auto;text-align:center"><div class="empty-icon">—</div><h3>还没有可编辑的作品</h3><p style="color:var(--muted);margin:8px 0 20px">打开已有小说或创建新书后，编辑器将自动加载正文、卷章与 AI 协同工作区。</p><div style="display:flex;gap:12px;justify-content:center"><button class="button primary" data-completion-page="novels">打开我的小说</button><button class="button" data-completion-action="create-from-dissection">' + ico('scan-text') + '从拆书创书</button></div></div>', 'editor-page');
    const active = activeRefs(state);
    if (active.scene) preview.editorBody = active.scene.content;
    const volumes = '<div data-completion-tree-top style="height:0"></div><div data-completion-tree-window style="display:flow-root"></div><div data-completion-tree-bottom style="height:0"></div>';
    const modelSelect = '<select class="ai-select" data-completion-model data-model-select aria-label="选择模型"></select>';
    const skillSelect = `<select class="ai-select" data-completion-skill aria-label="固定写作 Skill" disabled title="AI 编辑器固定使用指定的高张力写作 Skill"><option value="${EDITOR_ONLY_SKILL_ID}">固定：高张力写作 Skill</option></select>`;
    const history = '<select class="ai-select" data-completion-history aria-label="选择历史会话"><option value="">当前会话</option></select>';
    const thinkingControl = '<label class="ai-control-field" data-completion-thinking-field><span class="ai-control-field__label">思考强度</span><select class="ai-select" data-completion-thinking-control aria-label="选择思考强度" title="当前模型的官方思考强度"><option value="">正在读取模型能力…</option></select></label>';
    const genreFamilySelect = `<label class="ai-control-field" data-completion-family-field title="选择小说题材所属分类"><span class="ai-control-field__label">小说题材</span><select class="ai-select" data-completion-genre-family aria-label="选择小说题材">${buildGenreFamilyOptions(state)}</select></label>`;
    const chapterFunctionSelect = `<label class="ai-control-field" data-completion-function-field title="选择本章承担的功能定位（黄金三章/推进/打脸/铺垫/高潮等）"><span class="ai-control-field__label">本章功能</span><select class="ai-select" data-completion-chapter-function aria-label="选择本章功能">${buildChapterFunctionOptions(state)}</select></label>`;
      const chapterFocusSelect = `<label class="ai-control-field" data-completion-focus-field title="选择本章镜头侧重点（对话/战斗/环境/心理/智斗/情感等）"><span class="ai-control-field__label">该章侧重点</span><select class="ai-select" data-completion-chapter-focus aria-label="选择该章侧重点">${buildChapterFocusOptions(state)}</select></label>`;
    const endingHookSelect = `<label class="ai-control-field" data-completion-hook-field title="选择章末结尾断章钩子（危机/悬念/反转/期待/情感等）"><span class="ai-control-field__label">结尾钩子</span><select class="ai-select" data-completion-ending-hook aria-label="选择结尾钩子">${buildEndingHookOptions(state)}</select></label>`;
    const styleDetectorControl = `<div class="ai-control-field" data-completion-style-detector-box style="display:flex;flex-direction:column;gap:3px;padding:4px 10px;background:rgba(0,0,0,0.02);border-radius:6px;margin:2px 0">
      <div style="display:flex;align-items:center;justify-content:space-between;font-size:10px">
        <span style="display:flex;align-items:center;gap:3px;color:var(--text-secondary,#666)">写作风格</span>
        <span data-completion-style-badge style="font-weight:600;color:var(--accent,#4f46e5);font-size:10px">自动匹配</span>
      </div>
      <select class="ai-select" data-completion-archetype-override style="height:24px;font-size:10px;padding:0 4px" aria-label="选择写作风格">
        ${buildWritingStyleOptions(state)}
      </select>
    </div>`;
    const creationCost = state.creationBookId ? '<div data-completion-creation-cost class="section-note" style="padding:4px 12px 0;font-size:10px">创作书预算正在读取…</div>' : '';
    const paramsDrawer = `<details class="ai-params-drawer" data-completion-params-drawer><summary class="ai-params-summary"><span class="ai-params-summary-title">创作参数</span><span class="ai-params-summary-hint" data-completion-params-hint>题材·风格·功能·侧重点·钩子</span><span class="ai-params-toggle-text">展开 ▾</span></summary><div class="ai-params-body"><label class="ai-control-field" style="margin-top:2px"><span class="ai-control-field__label">写作预设</span>${skillSelect}</label><label class="ai-control-field"><span class="ai-control-field__label">历史会话</span>${history}</label>${thinkingControl}${genreFamilySelect}${styleDetectorControl}${chapterFunctionSelect}${chapterFocusSelect}${endingHookSelect}${creationCost}</div></details>`;
    return pageShell('editor', 'EDITOR', '小说编辑器', `${esc(title)} · 正文、卷章、场景和 AI 协作`, tools, `<button class="editor-rail-toggle" id="editorRailToggle" aria-label="收起工作台导航" title="收起工作台导航">${ico('panel-left-close')}</button><div class="editor-preview ai-open" id="editorPreview" data-completion-root="editor"><div class="editor-nav-scrim" data-completion-action="close-nav" aria-hidden="true"></div><aside class="editor-nav"><div class="editor-nav-head"><div class="editor-nav-title-row"><strong>${esc(title)}</strong><button class="editor-back-button" type="button" data-completion-page="novels" aria-label="返回我的小说" title="返回我的小说">${ico('arrow-left')}<span>返回</span></button></div><span>${state.volumes.reduce((sum, volume) => sum + volume.chapters.length, 0)} 章 · ${state.outline.volume && state.outline.volume.done || 0} 章已完成</span></div><div class="editor-chapters completion-editor-tree">${volumes || '<div class="empty"><p>当前作品还没有章节。</p></div>'}<button class="button" style="width:calc(100% - 12px);margin:12px 6px;min-height:29px;font-size:10px" data-completion-action="add-volume" aria-label="新增卷" title="新增卷">${ico('plus')}新增卷</button></div></aside><section class="editor-main"><div class="editor-bar"><div class="toolbar"><button class="editor-toolbar-button" data-completion-action="toggle-nav" aria-label="章节导航" title="展开/收起章节目录">${ico('list')}</button><button class="editor-toolbar-button" data-completion-action="undo" aria-label="撤销" title="撤销 (Ctrl+Z)">${ico('undo-2')}</button><button class="editor-toolbar-button" data-completion-action="redo" aria-label="重做" title="重做 (Ctrl+Y)">${ico('redo-2')}</button><button class="editor-toolbar-button" data-completion-action="format" data-format="bold" aria-label="加粗" title="加粗">${ico('bold')}</button><button class="editor-toolbar-button" data-completion-action="format" data-format="italic" aria-label="斜体" title="斜体">${ico('italic')}</button><button class="editor-toolbar-button" data-completion-action="format" data-format="formatBlock" data-format-value="h3" aria-label="标题" title="设置为小标题">${ico('heading-3')}</button><button class="editor-toolbar-button" data-completion-action="format" data-format="insertUnorderedList" aria-label="无序列表" title="无序列表">${ico('list')}</button><button class="editor-toolbar-button" data-completion-action="search-replace" aria-label="搜索替换" title="查找与替换">${ico('search')}</button><button class="editor-toolbar-button" data-completion-action="history" aria-label="版本历史" title="版本历史记录">${ico('history')}</button><button class="editor-toolbar-button" data-completion-action="open-memory-workbench" aria-label="故事记忆与文风" title="故事记忆、人物认知与文风稳定工作台">${ico('brain')}</button><button class="editor-toolbar-button" data-completion-action="open-materials-seven" aria-label="全套创作资料" title="小说创作全套资料库（七大板块）">${ico('folder-kanban')}</button><button class="editor-toolbar-button" data-completion-action="audit-summary" aria-label="本章审计" title="本章审计">${ico('shield-check')}</button><button class="editor-toolbar-button" data-completion-action="prose-health-check" aria-label="正文质检" title="正文健康度与合规质检">${ico('activity')}</button><button class="editor-toolbar-button" data-completion-action="trash" aria-label="回收站" title="回收站">${ico('trash-2')}</button></div><div style="display:flex;align-items:center;gap:5px;color:var(--muted);font-size:10px;flex-shrink:0"><button class="editor-toolbar-button" data-completion-action="editor-save" aria-label="保存" title="保存作品">${ico('save')}</button><button class="editor-toolbar-button" data-completion-action="editor-import" aria-label="导入正文" title="导入正文">${ico('upload')}</button><button class="editor-toolbar-button" data-completion-action="editor-export" data-feature="NOVEL_EXPORT" data-action="novel-export" aria-label="导出正文" title="导出正文">${ico('download')}</button><button class="editor-toolbar-button editor-toolbar-dissection" data-completion-action="create-from-dissection" aria-label="拆书创书" title="拆书创书">${ico('scan-text')}<span>拆书创书</span></button><span>${ico('check')}<span data-completion-save-status>已加载</span></span><button class="editor-toolbar-button" data-action="theme" aria-label="切换浅色/深色主题" title="切换浅色/深色主题">${ico('sun')}</button><button class="editor-toolbar-button" data-completion-page="overview" aria-label="返回控制台" title="返回主控制台">${ico('layout-dashboard')}</button><button class="editor-toolbar-button" data-completion-action="editor-ai-focus" aria-label="打开 AI 助手" title="打开/收起 AI 助手">${ico('message-square')}</button></div></div><div class="editor-scroll"><article class="editor-paper" contenteditable="false" spellcheck="false" data-completion-paper></article></div></section><aside class="editor-ai"><div class="ai-head"><div class="ai-name"><span class="ai-mark">${ico('sparkles')}</span>AI 创作助手</div><div style="display:flex;align-items:center;gap:4px"><button class="icon-button" data-completion-action="new-ai-session" aria-label="新建 AI 会话" title="新建 AI 会话">${ico('plus')}</button><button class="icon-button" data-completion-action="close-ai" aria-label="关闭 AI 助手" title="关闭 AI 助手">${ico('x')}</button></div></div>${modelSelect}${paramsDrawer}<div class="chat-scroll" id="completionEditorChat"></div><div class="chat-thinking" data-completion-thinking aria-live="polite">正在整理上下文</div><div class="chat-composer"><div class="chat-quick-chips"><button type="button" class="chat-chip" data-completion-action="assemble-final-prompt" style="color:var(--accent,#4f46e5);font-weight:600;background:rgba(79,70,229,0.06);border-color:rgba(79,70,229,0.3)" title="组装当前选择的题材+文风+章节目标+侧重点+钩子及输入指令，生成结构化最终提示词">🔍 组装最终提示词</button><button type="button" class="chat-chip" data-completion-action="quick-chip" data-chip-text="续写当前场景，推进故事情节">续写下文</button><button type="button" class="chat-chip" data-completion-action="quick-chip" data-chip-text="润色当前正文，加强人物微表情与心理拉扯">精修对白</button><button type="button" class="chat-chip" data-completion-action="quick-chip" data-chip-text="在此处制造突发冲突，打破当前平衡节奏">制造冲突</button><button type="button" class="chat-chip" data-completion-action="quick-chip" data-chip-text="增加环境白描与感官细节，营造压迫感">环境渲染</button></div><div class="chat-input-box"><textarea data-completion-prompt placeholder="描述你想让 AI 完成的创作任务…（Enter 发送，Shift + Enter 换行）"></textarea><div class="chat-send-actions"><button class="chat-send" data-completion-action="ai-send" data-feature="AI_GENERATE" data-action="ai-generate" aria-label="发送" title="发送">${ico('arrow-up')}</button><button class="chat-send chat-stop" data-completion-action="ai-stop" data-feature="AI_STOP" data-action="ai-stop" aria-label="暂停生成" title="暂停生成" hidden>${ico('pause')}</button></div></div></div></aside></div>`, 'editor-page');
    }

  function renderEditorNav() {
    const stageNode = getStage();
    const state = editorState(false);
    if (!stageNode || !state) return;
    const nav = stageNode.querySelector('.completion-editor-tree');
    if (!nav) return;
    const existingAddVolume = nav.querySelector('[data-completion-action="add-volume"]');
    const novelKey = completionNovelKey(state);
    const initialized = nav.dataset.treeNovelKey === novelKey;
    const previous = runtime.editorTreeCache;
    const paddingTop = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(nav).paddingTop) || 0 : 0;
    let anchorKey = '';
    let anchorOffset = 0;
    if (initialized && previous && previous.novelKey === novelKey && previous.rows.length) {
      const oldIndex = Math.max(0, Math.min(previous.rows.length - 1,
        Math.floor(Math.max(0, nav.scrollTop - paddingTop) / EDITOR_TREE_ROW_HEIGHT)));
      anchorKey = previous.rows[oldIndex].key;
      anchorOffset = Math.max(0, nav.scrollTop - paddingTop - oldIndex * EDITOR_TREE_ROW_HEIGHT);
    }
    const rows = buildEditorTreeRows(state);
    if (!nav.querySelector('[data-completion-tree-window]')) {
      const addVolumeMarkup = existingAddVolume ? existingAddVolume.outerHTML
        : '<button class="button" style="width:calc(100% - 12px);margin:12px 6px;min-height:29px;font-size:10px" data-completion-action="add-volume" aria-label="新增卷" title="新增卷">' + ico('plus') + '新增卷</button>';
      nav.innerHTML = '<div data-completion-tree-top style="height:0"></div><div data-completion-tree-window style="display:flow-root"></div><div data-completion-tree-bottom style="height:0"></div>' + addVolumeMarkup;
    }
    let scrollTop = nav.scrollTop;
    if (!initialized) {
      const activeKey = state.currentSceneId ? 'scene:' + state.currentSceneId : 'chapter:' + state.currentChapterId;
      const activeIndex = rows.findIndex(row => row.key === activeKey);
      scrollTop = paddingTop + Math.max(0, activeIndex) * EDITOR_TREE_ROW_HEIGHT;
    } else if (anchorKey) {
      const anchorIndex = rows.findIndex(row => row.key === anchorKey);
      if (anchorIndex >= 0) scrollTop = paddingTop + anchorIndex * EDITOR_TREE_ROW_HEIGHT + anchorOffset;
    }
    const activeKey = state.currentSceneId ? 'scene:' + state.currentSceneId : 'chapter:' + state.currentChapterId;
    const activeIndex = rows.findIndex(row => row.key === activeKey);
    const selectionKey = String(state.currentChapterId || '') + ':' + String(state.currentSceneId || '');
    const selectionChanged = nav.dataset.treeSelection !== selectionKey;
    const viewportRows = Math.max(1, Math.ceil(Math.max(nav.clientHeight, EDITOR_TREE_ROW_HEIGHT) / EDITOR_TREE_ROW_HEIGHT));
    const visibleStart = Math.floor(Math.max(0, scrollTop - paddingTop) / EDITOR_TREE_ROW_HEIGHT);
    if (selectionChanged && activeIndex >= 0 &&
      (activeIndex < visibleStart || activeIndex >= visibleStart + viewportRows)) {
      scrollTop = paddingTop + activeIndex * EDITOR_TREE_ROW_HEIGHT;
    }
    nav.scrollTop = Math.max(0, scrollTop);
    nav.dataset.treeNovelKey = novelKey;
    nav.dataset.treeSelection = selectionKey;
    runtime.editorTreeCache = { novelKey, rows, state };
    renderEditorTreeWindow(nav, runtime.editorTreeCache);
  }

  function renderEditorPaper() {
    const stageNode = getStage();
    const state = editorState(false);
    const paper = stageNode && stageNode.querySelector('[data-completion-paper]');
    if (!paper || !state) return;
    const current = activeRefs(state);
    if (!current.chapter || !current.scene) {
      paper.innerHTML = '<div class="empty"><div class="empty-icon">—</div><p>当前作品还没有章节，请先新增一章。</p></div>';
      return;
    }
    const content = sanitizeHtml(current.scene.content);
    const count = wordCount(content);
    paper.innerHTML = `<div class="editor-paper-meta" contenteditable="false"><span>${esc(current.volume.title)} · ${esc(current.chapter.title)} · ${esc(current.scene.name)}</span><span>${count.toLocaleString()} 字</span></div><h2 data-completion-chapter-title contenteditable="true" spellcheck="false">${esc(current.chapter.title)}</h2><div class="completion-editor-content" contenteditable="true" spellcheck="false">${content || '<p class="editor-empty-copy">从这里开始输入当前场景正文。</p>'}</div>`;
    const empty = paper.querySelector('.editor-empty-copy');
    if (empty) empty.dataset.placeholder = 'true';
    getPreview().editorBody = current.scene.content;
  }

  function reconcileEditorChatRecords(records) {
    if (runtime.editorBusy || runtime.activeGenerationRun) return false;
    const state = editorState(false);
    restoreGenerationV2Projections(state, records);
    const pendingStages = ['in_progress', 'planning', 'preparing', 'extracting', 'drafting', 'auditing', 'revising', 'resuming'];
    let changed = false;
    records.forEach(item => {
      if (!item || item.kind !== 'assistant' || (!pendingStages.includes(item.status) && !pendingStages.includes(item.workflowStage))) return;
      const run = (state?.generationRuns || []).find(record => record && record.id === item.workflowRunId);
      if (run && run.generationV2) {
        item.generationV2 = true;
        item.remoteRunId = run.remoteRunId;
        item.serverState = run.serverState || item.serverState || 'created';
        const status = generationV2Status(item.serverState);
        item.status = status.itemStatus;
        item.workflowStage = status.workflowStage;
        if (run.finalText) {
          item.text = run.finalText;
          item.resultId = item.resultId || uid('ai-result');
          item.audit = cloneValue(run.audit || item.audit);
        }
        if (['provider_unknown', 'cancelled', 'committed'].includes(item.serverState)) item.retryPrompt = '';
        item.errorNotice = item.serverState === 'provider_unknown'
          ? '供应商结果未知；系统已停止自动重试，请查询任务状态。'
          : item.serverState === 'cancelled' ? '生成已取消；未写入正文。' : item.errorNotice || '';
        changed = true;
        return;
      }
      if (run?.pendingCommit) {
        item.status = run.status;
        item.workflowStage = run.status;
        changed = true;
        return;
      }
      const isPlaceholder = /^(正在|生成被页面刷新|生成未完成|请求未完成)/.test(text(item.text));
      if (isPlaceholder && run?.finalText) item.text = run.finalText;
      const hasProse = Boolean(text(item.text).trim()) && !/^(正在|生成被页面刷新|生成未完成|请求未完成)/.test(text(item.text)) && !/^\s*[[{]/.test(text(item.text));
      const audit = normalizeAudit(run?.audit);
      const sameTarget = run && item.target?.chapterId === run.chapterId && item.target?.sceneId === run.sceneId;
      const passed = run && ['awaiting_confirmation', 'accepted'].includes(run.status) &&
        sameTarget && audit.passed && run.finalText === item.text &&
        Boolean(run.resultContentHash) && run.resultContentHash === audit.contentHash;
      item.status = passed ? 'ready' : hasProse ? 'needs_review' : 'interrupted';
      item.workflowStage = item.status;
      item.audit = passed ? cloneValue(audit) : {
        ...audit, passed: false, status: 'incomplete',
        summary: '生成会话已结束，未找到与当前正文匹配的完整通过记录'
      };
      item.errorNotice = passed ? '' : hasProse
        ? '已保留正文，但审校未确认完成。可复制或手动重新生成，不会自动重试。'
        : '上次生成已中断，请手动重新生成，不会自动重试。';
      if (hasProse) {
        item.resultId = item.resultId || uid('ai-result');
        runtime.pendingResults = Array.isArray(runtime.pendingResults) ? runtime.pendingResults : [];
        if (!runtime.pendingResults.some(result => result && result.id === item.resultId)) {
          runtime.pendingResults.push({ id: item.resultId, text: item.text, createdAt: Date.now() });
        }
      } else if (isPlaceholder) {
        item.text = '生成未完成：上次会话已中断，请手动重新生成。';
      }
      changed = true;
    });
    return changed;
  }

  function chatRecords() {
    const preview = getPreview();
    if (!preview.editorChatSessionId) {
      try {
        const activeId = sessionStorage.getItem('molan_active_chat_session_id');
        if (activeId) preview.editorChatSessionId = activeId;
      } catch (_) {}
    }
    if (!Array.isArray(preview.editorChat)) {
      const stored = readWorkspace('editor-chat', []);
      preview.editorChat = stored.filter(item => item && item.kind && item.text).map((item, index, all) => {
        let textVal = text(item.text);
        let statusVal = text(item.status);
        let workflowStageVal = text(item.workflowStage);
        let retryPromptVal = ['provider_unknown', 'cancelled', 'committed'].includes(text(item.serverState))
          ? '' : text(item.retryPrompt || item.prompt || '');
        const errorNoticeVal = text(item.errorNotice || '');

        if (!retryPromptVal && !['provider_unknown', 'cancelled', 'committed'].includes(text(item.serverState))) {
          const prevUser = all.slice(0, index).reverse().find(m => m && m.kind === 'user');
          if (prevUser) retryPromptVal = text(prevUser.text);
        }

        const isRawJson = /^\s*[[{]/.test(textVal) || /"(canon|chapterContract|characters|relations|relation|identity|factions|worldRules|evidence)"/.test(textVal);
        const hasProse = Boolean(textVal) && !textVal.startsWith('正在') && !textVal.startsWith('生成被页面刷新') && !textVal.startsWith('请求未完成') && !textVal.startsWith('生成未完成') && !isRawJson;
        const isCleanProse = statusVal !== 'in_progress' && hasProse;
        const resultIdVal = isCleanProse ? (text(item.resultId) || uid('ai-result')) : '';
        if (isCleanProse && !statusVal) statusVal = 'ready';

        let auditVal = item.audit && typeof item.audit === 'object' ? cloneValue(item.audit) : null;
        if (!auditVal && statusVal === 'ready' && isCleanProse) {
          auditVal = { passed: true, status: 'passed', summary: '已就绪' };
        }

        if (resultIdVal) {
          runtime.pendingResults = Array.isArray(runtime.pendingResults) ? runtime.pendingResults : [];
          if (!runtime.pendingResults.some(r => r && r.id === resultIdVal)) {
            runtime.pendingResults.push({ id: resultIdVal, text: textVal, createdAt: Date.now() });
          }
        }

        const targetVal = item.target && typeof item.target === 'object' ? cloneValue(item.target) : completionTarget(editorState(false), preview.editorChatSessionId);

        return {
          kind: item.kind === 'user' ? 'user' : 'assistant',
          text: textVal,
          resultId: resultIdVal,
          target: targetVal,
          workflowStage: workflowStageVal,
          workflowRunId: text(item.workflowRunId),
          generationV2: item.generationV2 === true,
          remoteRunId: text(item.remoteRunId),
          serverState: text(item.serverState),
          status: statusVal,
          audit: auditVal,
          retryPrompt: retryPromptVal,
          errorNotice: errorNoticeVal
        };
      });
    }
    trimCompletionHistory(preview.editorChat);
    if (reconcileEditorChatRecords(preview.editorChat)) writeWorkspace('editor-chat', preview.editorChat);
    void recoverGenerationRuns(editorState(false), preview.editorChat);
    return preview.editorChat;
  }

  function editorChatHistoryRecords() {
    return readWorkspace('editor-chat-history', []).map(record => ({
      id: text(record && record.id),
      title: text(record && record.title),
      createdAt: Number(record && record.createdAt) || 0,
      updatedAt: Number(record && record.updatedAt) || 0,
      modelId: text(record && record.modelId),
      skillId: text(record && record.skillId),
      messages: Array.isArray(record && record.messages) ? record.messages.filter(item => item && item.kind && item.text).map(item => ({
        kind: item.kind === 'user' ? 'user' : 'assistant', text: text(item.text), resultId: text(item.resultId), target: item.target && typeof item.target === 'object' ? cloneValue(item.target) : null,
        workflowStage: text(item.workflowStage), workflowRunId: text(item.workflowRunId), generationV2: item.generationV2 === true,
        remoteRunId: text(item.remoteRunId), serverState: text(item.serverState), status: text(item.status), audit: item.audit && typeof item.audit === 'object' ? cloneValue(item.audit) : null,
        retryPrompt: text(item.retryPrompt || (item.kind === 'assistant' ? item.prompt : '')), errorNotice: text(item.errorNotice)
      })) : []
    })).filter(record => record.id && record.messages.some(item => item.kind === 'user'))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function editorChatHistoryTitle(messages) {
    const firstUser = messages.find(item => item.kind === 'user');
    const value = text(firstUser && firstUser.text).replace(/\s+/g, ' ').trim();
    return value.length > 32 ? value.slice(0, 32) + '…' : value || '未命名会话';
  }

  function persistEditorChatSession() {
    const preview = getPreview();
    const messages = chatRecords();
    const validMessages = messages.filter(item => item && item.kind && text(item.text));
    messages.splice(0, messages.length, ...validMessages);
    trimCompletionHistory(messages);
    preview.editorChat = messages;
    if (!messages.some(item => item.kind === 'user')) return;
    const now = Date.now();
    const id = text(preview.editorChatSessionId) || uid('ai-session');
    const records = editorChatHistoryRecords();
    const existing = records.find(record => record.id === id);
    const record = {
      id,
      title: editorChatHistoryTitle(messages),
      createdAt: existing && existing.createdAt || now,
      updatedAt: now,
      modelId: text(preview.editorModel),
      skillId: text(preview.editorSkillId),
      messages
    };
    preview.editorChatSessionId = id;
    writeWorkspace('editor-chat', messages);
    writeWorkspace('editor-chat-history', [record, ...records.filter(item => item.id !== id)].slice(0, 30));
    try { sessionStorage.setItem('molan_active_chat_session_id', id); } catch (_) {}
  }

  function loadEditorChatHistory(id) {
    if (runtime.editorBusy) { toast('生成完成后再切换历史会话'); return; }
    const record = editorChatHistoryRecords().find(item => item.id === text(id));
    if (!record) { toast('这条历史会话已不存在'); populateCompletionSelectors(); return; }
    persistEditorChatSession();
    const preview = getPreview();
    preview.editorChat = record.messages.map(item => ({ ...item }));
    preview.editorChatSessionId = record.id;
    preview.editorSkillId = record.skillId;
    preview.editorModel = record.modelId;
    writeWorkspace('editor-chat', preview.editorChat);
    renderEditorSurface();
    toast(`已载入历史会话：${record.title}`);
  }

  function newEditorChatSession() {
    if (runtime.editorBusy) { toast('生成完成后再新建会话'); return; }
    persistEditorChatSession();
    const preview = getPreview();
    preview.editorChat = [];
    preview.editorChatSessionId = '';
    writeWorkspace('editor-chat', []);
    renderEditorSurface();
    toast('已新建 AI 会话');
  }

  function isRealGenerationV2Run(run, item) {
    if (!run || typeof run !== 'object') return false;
    if (!item || typeof item !== 'object') return false;
    if (item.legacyBenchmark === true) return false;
    if (run.generationV2 !== true || item.generationV2 !== true) return false;
    if (typeof run.remoteRunId !== 'string' || !run.remoteRunId.trim()) return false;
    if (!run.commitBase || typeof run.commitBase !== 'object') return false;
    return true;
  }

  function renderEditorChat() {
    const stageNode = getStage();
    const chat = stageNode && stageNode.querySelector('#completionEditorChat');
    if (!chat) return;
    const records = chatRecords();
    const workflowLabels = {
      extracting: '正在从已有内容抽取事实',
      planning: '正在建立章节执行卡',
      drafting: '正在生成正文',
      auditing: '正在审计正文',
      revising: '正在按审计修订',
      paused: '已暂停生成',
      ready: '章节流程已完成审计',
      commit_pending: '正文已保存，等待确认提交',
      commit_unknown: '提交结果未知 · 正文已保留，请再次确认提交',
      commit_conflict: '服务端已提交不同正文 · 请核对',
      needs_review: 'needs_review · 未通过完整审计，仅供查看或复制',
      interrupted: '网络连接中断',
      failed: '生成未完成'
    };
    const items = records.map((item, index) => {
      const run = (editorState(false)?.generationRuns || []).find(record => record && record.id === item.workflowRunId);
      const isRealV2 = isRealGenerationV2Run(run, item);
      const pendingCommit = run && run.pendingCommit;
      const reviewBlocked = ['needs_review', 'failed', 'interrupted', 'paused', 'commit_conflict'].includes(item.status) || run && ['needs_review', 'commit_conflict'].includes(run.status);
      const isNeedsReview = item.status === 'needs_review' || (run && run.status === 'needs_review');
      const workflowStage = pendingCommit ? run.status : run && run.status === 'accepted' ? 'ready' : item.workflowStage;
      const generationPending = item.status === 'in_progress' || ['extracting', 'planning', 'drafting', 'auditing', 'revising'].includes(workflowStage);
      const stageLabel = workflowStage ? `<div style="margin-bottom:6px;color:var(--muted);font-size:9px">${esc(workflowLabels[workflowStage] || workflowStage)}</div>` : '';
      const statusBadge = item.kind === 'assistant' && item.status === 'failed'
        ? '<span class="badge gray" style="display:inline-block;margin-bottom:4px">生成未完成</span>'
        : (item.kind === 'assistant' && item.status === 'in_progress'
          ? '<span class="badge blue" style="display:inline-block;margin-bottom:4px">正在生成…</span>'
          : (item.kind === 'assistant' && item.status === 'interrupted'
            ? (item.resultId ? '<span class="badge amber" style="display:inline-block;margin-bottom:4px">已保留正文</span>' : '<span class="badge gray" style="display:inline-block;margin-bottom:4px">未完成</span>')
            : (item.kind === 'assistant' && (item.text || '').indexOf('请求未完成') === 0
              ? '<span class="badge gray" style="display:inline-block;margin-bottom:4px">生成未完成</span>'
              : '')));
      const hasAudit = Boolean(item.audit && (item.audit.summary || (Array.isArray(item.audit.issues) && item.audit.issues.length)));
      const adoptBtn = '';
      const reviseBtn = hasAudit ? `<button class="button" style="min-height:25px;padding:0 7px;font-size:9px" data-completion-ai-revise="${index}" data-feature="AI_AUDIT" data-action="audit-revise">按建议优化</button>` : '';
      const retryBtn = item.retryPrompt ? `<button class="button" style="min-height:25px;padding:0 7px;font-size:9px" data-completion-ai-retry="${index}">重新生成</button>` : '';
      const notice = item.errorNotice ? `<div style="margin-bottom:6px;color:var(--amber,#f59e0b);font-size:9px">${esc(item.errorNotice)}</div>` : '';

      const hasActionableProse = item.kind === 'assistant' && item.text &&
        !['extracting', 'planning', 'preparing'].includes(workflowStage) &&
        !item.text.startsWith('正在') &&
        !item.text.startsWith('生成被页面刷新') &&
        !item.text.startsWith('请求未完成') &&
        !item.text.startsWith('生成未完成') &&
        !/^\s*[[{]/.test(item.text);
      const hasResult = Boolean(item.resultId || hasActionableProse);
      if (hasResult && !item.resultId && !generationPending) {
        item.resultId = uid('ai-result');
        runtime.pendingResults = Array.isArray(runtime.pendingResults) ? runtime.pendingResults : [];
        if (!runtime.pendingResults.some(resultRecord => resultRecord && resultRecord.id === item.resultId)) {
          runtime.pendingResults.push({ id: item.resultId, text: item.text, createdAt: Date.now() });
        }
      }

      const effectiveAudit = pendingCommit ? run?.audit : (item.audit || run?.audit);
      const auditPassed = effectiveAudit ? normalizeAudit(effectiveAudit).passed : (item.status === 'ready' || !reviewBlocked);
      const badgeText = generationPending ? '生成 / 审校中 · 可复制' : (!isRealV2 && hasActionableProse) ? '历史草稿 · 可复制' : isNeedsReview ? '审校建议 · 可优化' : reviewBlocked ? '未完成 · 仅供查看或复制' : pendingCommit ? '正文已保留 · 待确认提交' : run && run.status === 'accepted' ? '已采纳' : '待确认落点';
      const badgeClass = isNeedsReview || reviewBlocked || pendingCommit ? 'amber' : 'blue';
      const auditIssuesHtml = (item.audit && Array.isArray(item.audit.issues) && item.audit.issues.length)
        ? `<details style="margin-top:4px;font-size:9px;color:var(--muted)"><summary style="cursor:pointer;user-select:none">查看 ${item.audit.issues.length} 条审校建议 ▾</summary><div style="margin-top:4px;line-height:1.6;padding:4px 6px;background:var(--card,var(--paper-warm,#f9f8f6));border:1px solid var(--line);border-radius:3px">${item.audit.issues.slice(0, 6).map(issueItem => `<div>• ${esc(issueItem.problem || issueItem.detail || issueItem)}${issueItem.fix ? ` <span style="color:var(--ink-light,var(--muted))">（建议：${esc(issueItem.fix)}）</span>` : ''}</div>`).join('')}</div></details>`
        : '';

      const applyTargets = item.generationV2 ? ['body'] : ['body', 'setting', 'outline', 'foreshadow'];
      const applyButtons = applyTargets.map(target => {
        if (target === 'body') {
          const isCommitAction = Boolean(pendingCommit);
          const buttonLabel = isCommitAction ? '确认提交' : '写入正文';
          const isBlocked = !isRealV2 || generationPending || reviewBlocked;
          const buttonClass = (!isBlocked && !pendingCommit) ? 'primary' : '';
          const disabledAttr = isBlocked ? ' disabled' : '';
          const titleAttr = !isRealV2 ? ' title="非正式 Generation V2 任务禁止正式采纳正文，可复制或重新生成"' : '';
          const featureAttr = isRealV2 ? ' data-feature="AI_COMMIT" data-action="ai-commit"' : '';
          return `<button class="button ${buttonClass}" style="min-height:25px;padding:0 7px;font-size:9px" data-completion-ai-apply="${target}" data-result-index="${index}"${featureAttr}${titleAttr}${disabledAttr}>${buttonLabel}</button>`;
        }
        return `<button class="button" style="min-height:25px;padding:0 7px;font-size:9px" data-completion-ai-apply="${target}" data-result-index="${index}"${generationPending || reviewBlocked || (pendingCommit && target !== 'body') ? ' disabled' : ''}>${target === 'setting' ? '保存设定' : target === 'outline' ? '保存大纲' : '记录伏笔'}</button>`;
      }).join('');
      const actionRow = hasResult ? `<div style="margin-top:8px;border-top:1px solid var(--line);padding-top:7px"><span class="badge ${badgeClass}">${badgeText}</span>${item.audit ? `<div style="margin-top:6px;color:var(--muted);font-size:9px">审计 ${esc(normalizeAudit(item.audit).status)}${item.audit.summary ? `：${esc(item.audit.summary)}` : ''}</div>` : ''}${auditIssuesHtml}${run ? `<div class="chat-usage-meta">${esc(generationUsageSummary(run))}</div>` : ''}<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px">${applyButtons}<button class="button" style="min-height:25px;padding:0 7px;font-size:9px" data-completion-ai-copy data-result-index="${index}">复制</button><button class="button" style="min-height:25px;padding:0 7px;font-size:9px;color:var(--blue);border-color:var(--blue)" data-completion-ai-memory-extract="${index}" title="从本段提取候选事实与认知变化">${ico('scan')}提取记忆变更</button><button class="button" style="min-height:25px;padding:0 7px;font-size:9px" data-completion-ai-style-audit="${index}" title="检测本段文风套话与节奏">${ico('activity')}文风质检</button>${adoptBtn}${reviseBtn}${retryBtn}</div></div>` : (retryBtn ? `<div style="margin-top:6px">${retryBtn}</div>` : '');
      return `<div class="chat-message ${item.kind === 'user' ? 'user' : ''}"><span class="chat-avatar">${item.kind === 'user' ? '你' : '墨'}</span><div class="chat-bubble">${stageLabel}${statusBadge}${notice}${esc(item.text).replace(/\n/g, '<br>')}${actionRow}</div></div>`;
    }).join('');
    chat.innerHTML = items || '<div class="empty"><div class="empty-icon">—</div><p>当前章节还没有 AI 对话记录。</p></div>';
    chat.scrollTop = chat.scrollHeight;
  }

  function populateCompletionSelectors() {
    const stageNode = getStage();
    if (!stageNode) return;
    const modelSelect = stageNode.querySelector('[data-completion-model]');
    const populate = refFunction('populateModelSelect');
    if (modelSelect && populate) populate(modelSelect);
    const preview = getPreview();
    const materialField = stageNode.querySelector('[data-completion-material-field]');
    if (materialField) materialField.remove();
    if (modelSelect && preview.editorModel && Array.from(modelSelect.options).some(option => option.value === preview.editorModel)) modelSelect.value = preview.editorModel;
    const promptInput = stageNode.querySelector('[data-completion-prompt]');
    if (promptInput && !promptInput.value) {
      try {
        const draft = sessionStorage.getItem('molan_editor_prompt_draft');
        if (draft) promptInput.value = draft;
      } catch (_) {}
    }
    renderCompletionThinkingSelector();
    const skill = stageNode.querySelector('[data-completion-skill]');
    if (skill) {
      skill.innerHTML = `<option value="${EDITOR_ONLY_SKILL_ID}">固定：高张力写作 Skill</option>`;
      skill.value = EDITOR_ONLY_SKILL_ID;
      skill.disabled = true;
      skill.title = 'AI 编辑器固定使用指定的高张力写作 Skill';
      preview.editorSkillId = EDITOR_ONLY_SKILL_ID;
    }
    const history = stageNode.querySelector('[data-completion-history]');
    if (history) {
      const previous = editorChatHistoryRecords().filter(record => record.id !== text(preview.editorChatSessionId));
      history.innerHTML = '<option value="">' + (previous.length ? '当前会话' : '暂无历史记录') + '</option>' + previous.map(record => `<option value="${esc(record.id)}">${esc(record.title)} · ${esc(backendDateSafe(record.updatedAt))}</option>`).join('');
      history.value = '';
      history.disabled = !previous.length;
      history.title = previous.length ? '选择并恢复历史 AI 会话' : '完成一次 AI 对话后，这里会保存可恢复的历史会话';
    }
  }

  const COMPLETION_REASONING_LABELS = {
    none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最大'
  };
  const COMPLETION_OFFICIAL_REASONING = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

  function completionModelMeta(modelId) {
    const backend = getBackend();
    const found = Array.isArray(backend.models) ? backend.models.find(model => model && String(model.id) === String(modelId)) || null : null;
    if (found) return found;
    const normalized = text(modelId).toLowerCase();
    if (/gpt-6-luna/.test(normalized)) return { id: modelId, model: modelId, supportsReasoning: true, reasoningEfforts: COMPLETION_OFFICIAL_REASONING.slice() };
    if (/gpt-5\.6/.test(normalized)) return { id: modelId, model: modelId, supportsReasoning: true, reasoningEfforts: COMPLETION_OFFICIAL_REASONING.slice() };
    if (/gpt-5\.(2|4|5)/.test(normalized)) return { id: modelId, model: modelId, supportsReasoning: true, reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'] };
    if (/gemini.*(3\.[1678]|pro|flash)|3\.[1678]f|3\.1pro/i.test(normalized)) return { id: modelId, model: modelId, supportsReasoning: true, reasoningEfforts: ['none', 'low', 'medium', 'high'] };
    if (/deepseek.*(v4|r1|reason|think)/.test(normalized)) return { id: modelId, model: modelId, supportsThinking: true };
    return null;
  }

  function completionReasoningOptions(model) {
    if (!model || !model.supportsReasoning) return [];
    if (Array.isArray(model.reasoningEfforts) && model.reasoningEfforts.length) {
      return model.reasoningEfforts.map(value => text(value).toLowerCase()).filter(value => COMPLETION_OFFICIAL_REASONING.includes(value));
    }
    const name = text(model.model || model.id).toLowerCase();
    if (/gpt-6-luna/.test(name)) return COMPLETION_OFFICIAL_REASONING.slice();
    if (/gpt-5\.6/.test(name)) return COMPLETION_OFFICIAL_REASONING.slice();
    if (/gpt-5\.(2|4|5)/.test(name)) return ['none', 'low', 'medium', 'high', 'xhigh'];
    if (/gemini/i.test(name)) return ['none', 'low', 'medium', 'high'];
    return ['none', 'low', 'medium', 'high'];
  }

  function renderCompletionThinkingSelector() {
    const stageNode = getStage();
    const selector = stageNode && stageNode.querySelector('[data-completion-thinking-control]');
    const state = editorState(false);
    if (!selector || !state) return;
    const modelSelect = stageNode.querySelector('[data-completion-model]');
    const currentModel = modelSelect && modelSelect.value || (refFunction('currentUnifiedModel') || (() => ''))();
    const model = completionModelMeta(currentModel);
    state.settings = state.settings && typeof state.settings === 'object' ? state.settings : {};
    if (model && model.supportsReasoning) {
      const options = completionReasoningOptions(model);
      const saved = text(state.settings.reasoningEffort || '').toLowerCase();
      const preferred = /gpt-6-luna/.test(text(model.model || model.id).toLowerCase()) ? 'max' : 'medium';
      const current = options.includes(saved) ? saved : (options.includes(preferred) ? preferred : options[0] || 'none');
      state.settings.reasoningEffort = current;
      selector.dataset.mode = 'reasoning';
      selector.disabled = false;
      selector.title = '当前模型的官方思考强度';
      selector.innerHTML = options.map(value => `<option value="${esc(value)}">思考强度 · ${esc(COMPLETION_REASONING_LABELS[value] || value)}</option>`).join('');
      selector.value = current;
      updateCompletionParamsHint();
      return;
    }
    if (model && model.supportsThinking) {
      selector.dataset.mode = 'thinking';
      selector.disabled = false;
      selector.title = 'DeepSeek 思考模式';
      selector.innerHTML = '<option value="off">思考模式 · 关闭</option><option value="on">思考模式 · 开启</option>';
      selector.value = state.settings.think === true ? 'on' : 'off';
      updateCompletionParamsHint();
      return;
    }
    selector.dataset.mode = 'none';
    selector.disabled = true;
    selector.title = '当前模型不支持思考控制';
    selector.innerHTML = '<option value="">当前模型不支持思考控制</option>';
    updateCompletionParamsHint();
  }

  function updateCompletionParamsHint() {
    const stageNode = getStage();
    const hintNode = stageNode && stageNode.querySelector('[data-completion-params-hint]');
    if (!hintNode) return;
    const familySelect = stageNode.querySelector('[data-completion-genre-family]');
    const styleSelect = stageNode.querySelector('[data-completion-archetype-override]');
    const funcSelect = stageNode.querySelector('[data-completion-chapter-function]');
    const focusSelect = stageNode.querySelector('[data-completion-chapter-focus]');
    const hookSelect = stageNode.querySelector('[data-completion-ending-hook]');
    const familyText = familySelect && familySelect.value !== 'all' ? (familySelect.options[familySelect.selectedIndex]?.text?.split('(')[0]?.trim() || '定制题材') : '全题材';
    const styleText = styleSelect && styleSelect.value ? (styleSelect.options[styleSelect.selectedIndex]?.text?.split('(')[0]?.trim() || '定制风格') : '智能风格';
    const funcText = funcSelect && funcSelect.value ? (funcSelect.options[funcSelect.selectedIndex]?.text?.split('(')[0]?.trim() || '特定功能') : '自然推进';
    const focusText = focusSelect && focusSelect.options[focusSelect.selectedIndex]?.text?.split('(')[0]?.trim() || '综合推进';
    const hookText = hookSelect && hookSelect.value ? (hookSelect.options[hookSelect.selectedIndex]?.text?.split('(')[0]?.trim() || '特定钩子') : '自然收束';
    hintNode.textContent = `${familyText} · ${styleText} · ${funcText} · ${focusText} · ${hookText}`;
  }

  function renderCreationCost(state) {
    const node = getStage() && getStage().querySelector('[data-completion-creation-cost]');
    if (!node || !state || !state.creationBookId) return;
    const book = state.creationContext && state.creationContext.book || {};
    const plan = state.creationPlan || {};
    const budget = Number(book.budgetLimit != null ? book.budgetLimit : plan.budgetLimit) || 0;
    const spent = Number(book.spentCost) || 0;
    const remaining = budget > 0 ? Math.max(0, budget - spent) : null;
    const ratio = budget > 0 ? spent / budget : 0;
    const status = budget > 0 && ratio >= 1 ? ' · 已达到预算上限' : budget > 0 && ratio >= 0.8 ? ' · 已达到预算 80%，后续提交会被严格校验' : '';
    node.textContent = `已消耗 ${Number.isFinite(spent) ? spent.toFixed(2) : '待结算'} 积分 · ${budget > 0 ? `预算 ${budget.toFixed(2)} · 剩余 ${remaining.toFixed(2)}` : '未设置预算上限'}${status}`;
  }

  function renderEditorSurface() {
    const stageNode = getStage();
    if (!stageNode || currentPageName() !== 'editor') return;
    const state = editorState(false);
    if (state && state.creationBookId) void hydrateCreationContext(state);
    renderEditorNav();
    renderEditorPaper();
    renderEditorChat();
    populateCompletionSelectors();
    renderCreationCost(state);
    ensureEditorUtilityActions();
    mountIconsSafe();
    renderGenerationControl();
  }

  /** 在沉浸式编辑器的可见工具栏补齐资料、大纲和知识库入口。 */
  function ensureEditorUtilityActions() {
    if (typeof document === 'undefined') return;
    const stageNode = getStage();
    const group = stageNode && stageNode.querySelector('#editorPreview .editor-bar > div:last-child');
    if (!group) return;
    const actions = [
      ['dossier-open', 'library', '作品资料中心'],
      ['open-outline', 'milestone', '大纲与时间线'],
      ['open-knowledge', 'network', '设定集与知识库']
    ];
    const dissection = group.querySelector('[data-completion-action="create-from-dissection"]');
    actions.forEach(([action, iconName, label]) => {
      if (group.querySelector(`[data-completion-action="${action}"]`)) return;
      const button = document.createElement('button');
      button.className = 'editor-toolbar-button';
      button.type = 'button';
      button.dataset.completionAction = action;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = ico(iconName);
      if (dissection) group.insertBefore(button, dissection);
      else group.appendChild(button);
    });
  }

  function chapterSequence(state) {
    const rows = [];
    (state && state.volumes || []).forEach(volume => (volume.chapters || []).forEach(chapter => rows.push({ volume, chapter })));
    return rows;
  }

  function chapterOutline(state, ref) {
    if (!state || !ref || !ref.volume || !ref.chapter) return null;
    const outline = getVolumeOutline(state, ref.volume, false);
    return outline && outline.chapters.find(item => item.chapterId === ref.chapter.id || item.num === ref.chapter.title) || null;
  }

  function compactChapter(state, ref) {
    if (!ref || !ref.chapter) return null;
    const outline = chapterOutline(state, ref);
    const body = ref.chapter.scenes.map(scene => plainText(scene.content)).join('\n\n');
    return {
      volume: ref.volume.title,
      title: ref.chapter.title,
      outline: outline ? `${outline.title || ''} ${outline.synopsis || ''}`.trim() : '',
      ending: body.slice(-2400)
    };
  }

  function currentContext(state) {
    const current = activeRefs(state);
    const data = ensureKnowledge(state);
    const sequence = chapterSequence(state);
    const currentIndex = sequence.findIndex(item => item.chapter.id === current.chapter?.id);
    const previousRef = currentIndex > 0 ? sequence[currentIndex - 1] : null;
    const nextRef = currentIndex >= 0 ? sequence[currentIndex + 1] : null;
    const body = current.chapter ? current.chapter.scenes.map(scene => plainText(scene.content)).join('\n\n') : '';
    const lowerBody = body.toLowerCase();
    const names = data.entities.filter(entity => {
      const refs = [entity.name, ...(entity.aliases || [])].filter(Boolean).map(value => text(value).toLowerCase());
      return !body || refs.some(value => lowerBody.includes(value));
    }).slice(0, 24);
    const foreshadows = state.foreshadows.filter(item => item.status !== 'resolved').slice(0, 12);
    const currentOutline = chapterOutline(state, current);
    const contract = current.chapter && state.chapterContracts[current.chapter.id] || null;
    const characters = data.entities.filter(entity => entity.type === 'character' && (!body || [entity.name, ...(entity.aliases || [])].some(value => lowerBody.includes(text(value).toLowerCase())))).slice(0, 16).map(entity => {
      const resolved = characterArchetypeDisplay(entity);
      return {
        id: entity.id,
        name: entity.name,
        tags: entity.tags,
        notes: entity.notes,
        attrs: entity.attrs,
        archetype: resolved.archetype,
        archetypeSource: resolved.source,
        archetypeConfidence: resolved.confidence
      };
    });
    const creation = state.creationContext && state.creationContext.bible && state.creationContext.bible.payload || {};
    const creationPlan = state.creationPlan || creation.creationPlan || {};
    const dossierText = projectDossierContextText(state);
    const creationLines = Array.isArray(creationPlan.lines) ? creationPlan.lines : [];
    const creationBible = state.creationBookId ? {
      premise: creation.bookPremise || {},
      worldRules: Array.isArray(creation.worldRules) ? creation.worldRules.slice(0, 20) : [],
      characters: Array.isArray(creation.characters) ? creation.characters.slice(0, 24) : [],
      map: creation.map || { nodes: [], edges: [] },
      relationships: Array.isArray(creation.relationships) ? creation.relationships.slice(0, 30) : [],
      goldenFinger: creation.goldenFinger || {},
      openForeshadows: Array.isArray(creation.foreshadowLedger) ? creation.foreshadowLedger.filter(item => item && item.status !== 'paid_off').slice(0, 20) : [],
      retentionRules: Array.isArray(creation.retentionRules) ? creation.retentionRules : [],
      linePriority: creationLines,
      forbiddenCopy: creation.forbiddenCopy || {}
    } : null;
    const styleKit = buildStyleKitText(creation);
    const globalLedger = buildGlobalLedgerText(creation);
    const history = state.history.slice(0, 12).map(item => ({
      chapter: text(item && item.chapter),
      scene: text(item && item.scene),
      text: text(item && item.text).slice(-1600),
      t: Number(item && item.t) || 0
    })).filter(item => item.chapter || item.text);
    return {
      current,
      chapterNo: Math.max(1, currentIndex + 1),
      previous: compactChapter(state, previousRef),
      next: compactChapter(state, nextRef),
      body: body.slice(-9000),
      entities: names.map(entity => {
        const attrs = Array.isArray(entity.attrs) && entity.attrs.length ? `；属性：${entity.attrs.slice(0, 6).map(item => typeof item === 'string' ? item : `${item.key || item.k || item.name || ''}=${item.value || item.v || item.text || ''}`).join('、')}` : '';
        const archetype = entity.type === 'character' ? characterArchetypeDisplay(entity).archetype : '';
        return `${knowledgeLabel(entity.type)}：${entity.name}${archetype ? `【人物类型：${archetype}】` : ''}${entity.notes ? `（${entity.notes.slice(0, 160)}）` : ''}${attrs}`;
      }).join('\n'),
      characters,
      outline: currentOutline ? `${currentOutline.title || ''} ${currentOutline.synopsis || ''}`.trim() : '',
      foreshadows: foreshadows.map(item => `${item.id || ''} ${item.title}：${item.description || ''}`).join('\n'),
      contract: contract ? cloneValue(contract) : null,
      canonSnapshot: state.editorCanonSnapshot ? cloneValue(state.editorCanonSnapshot) : null,
      history,
      styleKit,
      globalLedger,
      dossier: dossierText,
      factLedger: buildFactLedgerText(state.factLedger, characters.map(item => item.name)),
      characterPerfBrief: buildCharacterPerfBrief(creation, characters.map(item => item.name), (() => {
        const planEntry = (Array.isArray(creation.chapterPlan) ? creation.chapterPlan : []).find(item => Number(item.chapterNo) === Math.max(1, currentIndex + 1));
        return Number(planEntry && planEntry.emotionIntensity);
      })()),
      creationBible: creationBible ? JSON.stringify(creationBible).slice(0, 16000) : '',
      creationPlan: creationPlan,
      creationStateVersion: Number(state.creationStateVersion) || 0,
      creationBibleVersion: Number(state.creationBibleVersion) || 0
    };
  }

  function parseStructuredJSON(value) {
    const source = text(value).trim();
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = (fenced && fenced[1] || source).trim();
    try { return JSON.parse(candidate); } catch (_) {}
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)); } catch (_) {}
    }
    return null;
  }

  function contractValue(source, keys, fallback) {
    for (const key of keys) if (source && source[key] != null && text(source[key]).trim()) return source[key];
    return fallback;
  }

  function contractList(source, keys, fallback) {
    const value = contractValue(source, keys, fallback);
    if (Array.isArray(value)) return value.map(item => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') return text(item.term || item.description || item.desc || item.reason || item.name || '').trim();
      return text(item).trim();
    }).filter(Boolean);
    return text(value).split(/[\n；;、]/).map(item => item.trim()).filter(Boolean);
  }

  function clipContextText(value, limit) {
    const source = text(value).replace(/\r\n?/g, '\n').trim();
    const max = Math.max(80, Number(limit) || 1200);
    if (source.length <= max) return source;
    const head = Math.min(500, Math.floor(max * 0.35));
    return source.slice(0, head) + '\n...（中段省略）...\n' + source.slice(-(max - head - 18));
  }

  // ★ 长篇防漂移三件套：文风工坊（拆书量化指纹+模板）、全局规则账（不靠圣经裁剪碰运气）、
  // 事实账本（按出场实体检索历史事实）。近 12 章窗口管"现在"，这三样管"全书"。
  function normalizeFactLedger(value) {
    const ledger = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const list = v => Array.isArray(v) ? v : [];
    return {
      schemaVersion: 1,
      rules: list(ledger.rules),
      promises: list(ledger.promises),
      byEntity: ledger.byEntity && typeof ledger.byEntity === 'object' && !Array.isArray(ledger.byEntity) ? ledger.byEntity : {},
      lastFactChapter: Number(ledger.lastFactChapter) || 0
    };
  }

  function buildStyleKitText(bible) {
    const style = bible && typeof bible === 'object' ? bible.styleProfile : null;
    if (!style || typeof style !== 'object') return '';
    const parts = [];
    const fingerprint = style.sentenceFingerprint;
    if (fingerprint && typeof fingerprint === 'object' && Object.keys(fingerprint).length) {
      parts.push('量化文风基线（句式配比按此控制）:' + JSON.stringify(fingerprint).slice(0, 600));
    }
    const templates = style.reusableTemplates;
    if (templates && typeof templates === 'object') {
      if (Array.isArray(templates.openingTemplate) && templates.openingTemplate.length) parts.push('开篇模板:' + JSON.stringify(templates.openingTemplate).slice(0, 400));
      if (templates.sceneTemplate) parts.push('场景模板:' + String(templates.sceneTemplate).slice(0, 200));
      if (templates.conflictEscalationTemplate) parts.push('冲突升级模板:' + String(templates.conflictEscalationTemplate).slice(0, 200));
      if (Array.isArray(templates.avoidList) && templates.avoidList.length) parts.push('避雷清单（必须避开）:' + JSON.stringify(templates.avoidList).slice(0, 500));
    }
    if (Array.isArray(style.reversalPatterns) && style.reversalPatterns.length) {
      parts.push('反转套路参考:' + JSON.stringify(style.reversalPatterns.slice(0, 8)).slice(0, 500));
    }
    return parts.join('\n').slice(0, 2600);
  }

  function buildGlobalLedgerText(bible) {
    const parts = [];
    const rules = Array.isArray(bible && bible.worldRules) ? bible.worldRules : [];
    if (rules.length) {
      parts.push('世界规则（全部生效，违反即连续性错误）:\n' + rules.map(rule => '- ' + [rule && rule.rule, rule && rule.limit, rule && rule.consequence].filter(Boolean).join('｜')).join('\n').slice(0, 1800));
    }
    const foreshadows = Array.isArray(bible && bible.openForeshadows) ? bible.openForeshadows
      : (Array.isArray(bible && bible.foreshadowLedger) ? bible.foreshadowLedger.filter(item => item && String(item.status || 'planned') !== 'paid_off') : []);
    if (foreshadows.length) {
      parts.push('未回收伏笔（plantIn 已过仍未回收的优先处理）:\n' + foreshadows.slice(0, 20).map(item => '- [' + (item.id || '') + '] ' + String(item.desc || '').slice(0, 80) + '（埋于' + (item.plantIn || '?') + '，计划回收' + (item.payoffIn || '?') + '）').join('\n').slice(0, 1400));
    }
    return parts.join('\n').slice(0, 3200);
  }

  function buildFactLedgerText(ledger, entityNames) {
    const safe = normalizeFactLedger(ledger);
    const parts = [];
    const rules = safe.rules.filter(item => item && item.status !== 'superseded');
    if (rules.length) {
      parts.push('全局规则/代价（违反即连续性错误）:\n' + rules.slice(0, 30).map(item => '- ' + String(item.text || '').slice(0, 120) + (item.chapterNo ? '（第' + item.chapterNo + '章确立）' : '')).join('\n').slice(0, 1600));
    }
    const promises = safe.promises.filter(item => item && item.status === 'open');
    if (promises.length) {
      parts.push('未兑现承诺（读者在等回报）:\n' + promises.slice(0, 12).map(item => '- ' + String(item.text || '').slice(0, 100) + '（第' + (item.plantIn || '?') + '章许下）').join('\n').slice(0, 900));
    }
    const names = (Array.isArray(entityNames) ? entityNames : []).filter(Boolean);
    let entityParts = [];
    if (names.length) {
      names.forEach(name => {
        const bucket = Array.isArray(safe.byEntity[name]) ? safe.byEntity[name] : [];
        const facts = bucket.filter(item => item && item.status !== 'superseded').slice(-12);
        if (facts.length) entityParts.push(name + ':\n' + facts.map(item => '- ' + String(item.text || '').slice(0, 120) + (item.chapterNo ? '（第' + item.chapterNo + '章）' : '')).join('\n'));
      });
    } else {
      // 无实体名单时按最近章节取最活跃的 20 组实体
      entityParts = Object.entries(safe.byEntity)
        .map(([name, facts]) => ({ name, facts: Array.isArray(facts) ? facts : [], latest: Math.max(0, ...facts.map(item => Number(item && item.chapterNo) || 0)) }))
        .sort((left, right) => right.latest - left.latest)
        .slice(0, 20)
        .map(({ name, facts }) => name + ':\n' + facts.filter(item => item && item.status !== 'superseded').slice(-8).map(item => '- ' + String(item.text || '').slice(0, 110) + (item.chapterNo ? '（第' + item.chapterNo + '章）' : '')).join('\n'));
    }
    if (entityParts.length) parts.push('出场对象历史事实:\n' + entityParts.join('\n').slice(0, 2400));
    return parts.join('\n\n').slice(0, 3600);
  }

  /** 裁剪与约束发送至起草/审计的账本结构，避免无界全书实体冲爆上下文预算 */
  function scopeFactLedger(ledger, entityNames) {
    if (!ledger || typeof ledger !== 'object') return null;
    const safe = normalizeFactLedger(ledger);
    const activeNames = new Set((Array.isArray(entityNames) ? entityNames : []).filter(Boolean));
    const scopedByEntity = {};
    Object.keys(safe.byEntity || {}).forEach(name => {
      if (activeNames.size === 0 || activeNames.has(name)) {
        scopedByEntity[name] = (safe.byEntity[name] || []).slice(-12);
      }
    });
    const entityKeys = Object.keys(scopedByEntity);
    if (entityKeys.length > 15) {
      entityKeys.slice(15).forEach(k => delete scopedByEntity[k]);
    }
    return {
      rules: (safe.rules || []).slice(-20),
      promises: (safe.promises || []).filter(p => p && p.status === 'open').slice(-10),
      byEntity: scopedByEntity
    };
  }

  /** 章级人物演绎简报：voice/tell/wound/stance + 本章情绪轨迹（由章纲 intensity 推导）。 */
  function buildCharacterPerfBrief(bible, presentNames, intensity) {
    const cards = Array.isArray(bible && bible.characters) ? bible.characters : [];
    if (!cards.length) return '';
    const names = (presentNames || []).filter(Boolean);
    const picked = (names.length ? cards.filter(card => names.includes(String(card.name))) : cards.slice(0, 4)).slice(0, 5);
    if (!picked.length) return '';
    const safeText = (value, limit = 60) => text(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
    const listValues = (limit, maxItems, ...values) => {
      const value = values.find(item => Array.isArray(item) ? item.length > 0 : item != null && safeText(item, limit).length > 0);
      const list = Array.isArray(value) ? value : value == null ? [] : [value];
      return [...new Set(list.map(item => safeText(item, limit)).filter(Boolean))].slice(0, maxItems);
    };
    const parts = picked.map(card => {
      const name = safeText(card.name, 40) || '未命名角色';
      const role = safeText(card.role, 40);
      const lines = [name.replace(/[【】]/g, '') + (role ? '（' + role.replace(/[【】]/g, '') + '）' : '')];
      const rawVoice = card.voice_contract || card.voiceContract || card.voice;
      const voice = rawVoice && typeof rawVoice === 'object' && !Array.isArray(rawVoice) ? rawVoice : {};
      const pref = safeText(
        voice.turnLengthPref || voice.turn_length_pref || voice.sentenceLengthPreference || voice.sentence_length_preference ||
        card.turnLengthPref || card.turn_length_pref || 'medium_long',
        40
      );
      const prefKey = pref.toLowerCase().replace(/[\s_–—]/g, '-');
      const lengthLabel = ['short', 'short-turn', 'brief', '短句', '短'].includes(prefKey)
        ? '偏好 8~15 字'
        : ['long', 'long-turn', '长句', '长'].includes(prefKey)
          ? '偏好 25~45 字'
          : ['medium', 'medium-long', '15-30', '15~30', '15-30字', '15~30字', '中等', '常态', '中长'].includes(prefKey)
            ? '偏好 15~30 字'
            : '偏好 ' + JSON.stringify(pref);
      lines.push('单轮台词长度' + lengthLabel + '（软约束；允许短促应答，单轮不得超过 50 字，不为凑长度重复信息）');
      lines.push('声音契约只提供有限风格偏好，服从本章事实、审计与通用纠错规则。');
      if (card.emotionStyle) lines.push('情绪表达：' + card.emotionStyle);
      const habits = listValues(60, 5, voice.styleHabits, voice.style_habits, voice.verbalHabits, voice.verbal_habits, voice.habits, voice.habit, card.styleHabits, card.habit, typeof rawVoice === 'string' ? rawVoice : null);
      const tabooWords = listValues(60, 8, voice.tabooWords, voice.taboo_words, voice.tabooPhrases, voice.taboo_phrases, voice.taboos, voice.taboo, card.tabooWords, card.taboo);
      const samples = listValues(120, 3, voice.samples, voice.voiceSamples, voice.voice_samples, card.samples);
      const responsePattern = safeText(voice.responsePattern || voice.response_pattern || voice.pattern || '', 80);
      if (responsePattern) lines.push('交锋偏好（仅作参考）：' + JSON.stringify(responsePattern));
      if (habits.length) lines.push('口吻习惯（仅作参考，不照抄）：' + JSON.stringify(habits));
      if (tabooWords.length) lines.push('言语禁忌（不得出现）：' + JSON.stringify(tabooWords));
      if (samples.length) lines.push('台词样本（仅观察，不复用）：' + JSON.stringify(samples));
      if (Array.isArray(card.tell) && card.tell.length) lines.push('外露方式：' + card.tell.map(t => (t.when || '') + '→' + (t.how || '')).join('；'));
      if (card.wound) lines.push('软肋（一提即痛）：' + card.wound);
      if (Array.isArray(card.stance) && card.stance.length) lines.push('立场：' + card.stance.map(st => (st.toward || '') + '（' + (st.current || '') + '）').join('；'));
      return lines.join('\n');
    });
    if (Number.isFinite(intensity)) parts.push('本章情绪强度目标：' + intensity + '/10 —— 主角情绪必须到达该强度，并至少一处按其表达风格外露（破口）。');
    return parts.join('\n\n').slice(0, 2600);
  }

  /** 把审计返回的事实增量合并进账本：只追加/更新状态，不删除历史。 */
  function mergeFactLedgerDelta(ledger, delta, chapterNo, contentHash) {
    const pending = [ledger, delta];
    const seen = new WeakSet();
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      Object.keys(value).forEach(key => {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`事实账本包含禁止键：${key}`);
        pending.push(value[key]);
      });
    }
    const safe = normalizeFactLedger(cloneValue(ledger));
    if (!delta || typeof delta !== 'object') return safe;
    const chapter = Math.max(1, Number(chapterNo) || safe.lastFactChapter || 1);
    const sourceContentHash = String(contentHash || '');
    const pushFact = (list, fact) => {
      if (!fact || !String(fact.text || '').trim()) return;
      list.push({
        ...cloneValue(fact),
        id: String(fact.id || 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
        text: String(fact.text),
        chapterNo: Math.max(1, Number(fact.chapterNo) || chapter),
        kind: String(fact.kind || '状态'),
        evidence: cloneValue(fact.evidence ?? ''),
        status: String(fact.status || 'active'),
        sourceContentHash
      });
    };
    (Array.isArray(delta.newRules) ? delta.newRules : []).forEach(fact => pushFact(safe.rules, fact));
    (Array.isArray(delta.newPromises) ? delta.newPromises : []).forEach(fact => pushFact(safe.promises, { ...fact, status: 'open' }));
    const entities = delta.byEntity && typeof delta.byEntity === 'object' && !Array.isArray(delta.byEntity) ? delta.byEntity : {};
    Object.entries(entities).forEach(([name, facts]) => {
      if (!name) return;
      const bucket = Array.isArray(safe.byEntity[name]) ? safe.byEntity[name] : [];
      (Array.isArray(facts) ? facts : []).forEach(fact => pushFact(bucket, fact));
      safe.byEntity[name] = bucket;
    });
    (Array.isArray(delta.updates) ? delta.updates : []).forEach(update => {
      if (!update || !update.id) return;
      [safe.rules, safe.promises, ...Object.values(safe.byEntity)].forEach(list => {
        if (!Array.isArray(list)) return;
        list.forEach(item => {
          if (!item || item.id !== update.id) return;
          const status = String(update.status || 'superseded');
          item.statusHistory = Array.isArray(item.statusHistory) ? item.statusHistory : item.statusHistory == null ? [] : [item.statusHistory];
          item.statusHistory.push({ ...cloneValue(update), previousStatus: item.status, status, chapterNo: chapter, sourceContentHash });
          item.status = status;
        });
      });
    });
    safe.lastFactChapter = Math.max(safe.lastFactChapter, chapter);
    return safe;
  }
  // ★ 范文对齐：与 scripts/build-style-fingerprints.mjs 的指纹口径完全同构，
  //   用于把生成正文与题材基线做量化对比（文风距离）。
  function computeTextFingerprint(text) {
    const acc = {
      totalChars: 0, sentenceCount: 0, sentenceLenSum: 0, sentenceLenSumSq: 0, pendingSentenceLen: 0,
      paragraphCount: 0, paragraphLenSum: 0, paragraphLenSumSq: 0, currentParagraphLen: 0,
      inDialogue: false, currentTurnLen: 0, dialogueCharCount: 0, dialogueTurnCount: 0, dialogueTurnLenSum: 0,
      commaCount: 0, periodCount: 0, simileHitCount: 0, bigramTotal: 0, bigramTypes: new Set(), pendingBigramChar: ''
    };
    const recordSentence = length => { acc.sentenceCount += 1; acc.sentenceLenSum += length; acc.sentenceLenSumSq += length * length; };
    const recordParagraph = length => { acc.paragraphCount += 1; acc.paragraphLenSum += length; acc.paragraphLenSumSq += length * length; };
    const lines = String(text || '').split('\n');
    for (const line of lines) {
      const compact = String(line ?? '').replace(/\s+/gu, '');
      if (!compact) {
        if (acc.currentParagraphLen > 0) { recordParagraph(acc.currentParagraphLen); acc.currentParagraphLen = 0; }
        continue;
      }
      acc.totalChars += compact.length;
      acc.currentParagraphLen += compact.length;
      for (const fragment of compact.split(/(?<=[。！？])/u)) {
        if (!fragment) continue;
        if (/[。！？]$/u.test(fragment)) { recordSentence(acc, acc.pendingSentenceLen + fragment.length); acc.pendingSentenceLen = 0; }
        else acc.pendingSentenceLen += fragment.length;
      }
      acc.commaCount += (compact.match(/，/gu) || []).length;
      acc.periodCount += (compact.match(/。/gu) || []).length;
      const simileHits = compact.match(/像|仿佛|宛如|如同|好似|恍若/gu);
      if (simileHits) acc.simileHitCount += simileHits.length;
      for (let index = 0; index < compact.length; index += 1) {
        const ch = compact.charAt(index);
        if (ch === '“') { acc.inDialogue = true; acc.currentTurnLen = 0; }
        else if (ch === '”') {
          if (acc.inDialogue) { acc.dialogueTurnCount += 1; acc.dialogueTurnLenSum += acc.currentTurnLen; acc.dialogueCharCount += acc.currentTurnLen; acc.inDialogue = false; acc.currentTurnLen = 0; }
        } else if (acc.inDialogue) acc.currentTurnLen += 1;
      }
      const filtered = compact.replace(/[\p{P}\p{S}]/gu, '');
      let previous = acc.pendingBigramChar;
      for (let index = 0; index < filtered.length; index += 1) {
        const ch = filtered.charAt(index);
        if (previous) { acc.bigramTotal += 1; acc.bigramTypes.add(previous + ch); }
        previous = ch;
      }
      acc.pendingBigramChar = filtered.charAt(filtered.length - 1) || '';
    }
    if (acc.currentParagraphLen > 0) recordParagraph(acc.currentParagraphLen);
    const sentenceMean = acc.sentenceCount > 0 ? acc.sentenceLenSum / acc.sentenceCount : 0;
    const sentenceStd = acc.sentenceCount > 1 ? Math.sqrt(Math.max(0, acc.sentenceLenSumSq / acc.sentenceCount - sentenceMean * sentenceMean)) : 0;
    const paragraphMean = acc.paragraphCount > 0 ? acc.paragraphLenSum / acc.paragraphCount : 0;
    const paragraphStd = acc.paragraphCount > 1 ? Math.sqrt(Math.max(0, acc.paragraphLenSumSq / acc.paragraphCount - paragraphMean * paragraphMean)) : 0;
    const roundTo = (value, digits = 4) => Number((Number(value) || 0).toFixed(digits));
    return {
      sentenceLenMean: roundTo(sentenceMean), sentenceLenStd: roundTo(sentenceStd),
      paragraphLenMean: roundTo(paragraphMean), paragraphLenStd: roundTo(paragraphStd),
      dialogueRatio: acc.totalChars > 0 ? roundTo(acc.dialogueCharCount / acc.totalChars, 6) : 0,
      dialogueTurnMean: acc.dialogueTurnCount > 0 ? roundTo(acc.dialogueTurnLenSum / acc.dialogueTurnCount, 4) : 0,
      commaPeriodRatio: acc.periodCount > 0 ? roundTo(acc.commaCount / acc.periodCount, 4) : null,
      ttr: acc.bigramTotal > 0 ? roundTo(acc.bigramTypes.size / acc.bigramTotal, 6) : 0,
      similePerKilo: acc.totalChars > 0 ? roundTo(acc.simileHitCount * 1000 / acc.totalChars, 4) : 0
    };
  }

  /** 文风距离：逐字段相对基线均值的偏差（用基线标准差归一），输出 0-100 分与逐项明细。 */
  function computeStyleDistance(fingerprint, baseline) {
    if (!fingerprint || !baseline || typeof baseline !== 'object') return null;
    const perField = {};
    let devSum = 0;
    let counted = 0;
    Object.entries(baseline).forEach(([field, stat]) => {
      const mean = Number(stat && stat.mean);
      const stdDev = Number(stat && stat.stdDev);
      const value = Number(fingerprint && fingerprint[field]);
      if (!Number.isFinite(mean) || !Number.isFinite(value)) return;
      const denom = Math.max(Math.abs(mean), stdDev > 0 ? stdDev : Math.abs(mean) * 0.15, 0.05);
      const deviation = Math.min(3, Math.abs(value - mean) / denom);
      perField[field] = { value, mean, deviation: Number(deviation.toFixed(3)) };
      devSum += deviation;
      counted += 1;
    });
    if (!counted) return null;
    const avgDeviation = devSum / counted;
    return { score: Math.max(0, Math.round(100 - avgDeviation * 45)), perField };
  }

  const SCENE_TYPE_RULES = [
    { type: '打脸', pattern: /打脸|震惊|哗然|倒吸|不敢相信|目瞪口呆|鸦雀无声/g, hits: 2 },
    { type: '对峙', pattern: /冷笑|讽刺|嘲讽|不屑|质问|怒|呵斥|针锋相对|寸步不让/g, hits: 2 },
    { type: '危机', pattern: /危险|爆炸|攻来|血|杀|袭|崩塌|毒|逃生|命悬/g, hits: 3 },
    { type: '修炼', pattern: /修炼|灵气|真气|吐纳|经脉|突破|境界|功法|丹药|炼化/g, hits: 2 },
    { type: '情感', pattern: /温柔|泪水|思念|心动|愧疚|牵挂|拥抱|鼻尖一酸/g, hits: 2 }
  ];

  function deriveSceneType(source) {
    const text = String(source || '');
    for (const rule of SCENE_TYPE_RULES) {
      const hits = (text.match(rule.pattern) || []).length;
      if (hits >= rule.hits) return rule.type;
    }
    if ((text.match(/“/gu) || []).length / Math.max(1, text.length) > 0.2) return '对峙';
    return '日常';
  }

  function buildStyleAlignmentBlock(pack) {
    if (!pack || !Array.isArray(pack.samples) || !pack.samples.length) return '';
    const parts = pack.samples.map(sample => '（场景类型：' + (sample.sceneType || '日常') + ' · 维度：' + (sample.dimension || 'action') + ' · 对白比 ' + (sample.dialogueRatio ?? '—') + '）\n' + sample.text);
    return '【范文对位——这是同题材顶级作品的写作质感基准。只学习它的写法、节奏、镜头感、情绪落点与段落呼吸；严禁复述任何情节、人名、地名、专有名词或原句。】\n' + parts.join('\n———\n');
  }

  async function fetchStylePack(state, sceneSource, modelId) {
    const request = refFunction('backendRequest');
    if (!request) return null;
    const genreCandidates = [
      state && state.creationContext && state.creationContext.bible && state.creationContext.bible.payload && state.creationContext.bible.payload.taskConstraints && state.creationContext.bible.payload.taskConstraints.genre,
      state && state.outline && state.outline.book && state.outline.book.type,
      state && (state.novelType || state.type),
      state && state.novel && state.novel.type
    ].map(value => String(value || '').trim()).filter(Boolean);
    const sceneType = deriveSceneType(sceneSource || '');
    const primaryGenre = genreCandidates[0] || '通用';
    const selectedRoute = (state && (state.genreRoute || state.xuanhuanRoute || (state.outline && state.outline.book && state.outline.book.xuanhuanRoute))) || '';
    let effectiveRoute = selectedRoute;
    if (!effectiveRoute || effectiveRoute === 'auto') {
      if (/凡人|长春功|灵根|修仙|修真|仙侠|散修|药园|练气|筑基|金丹|灵气|口诀|丹药|采药|七玄门|神手谷/i.test(sceneSource)) {
        effectiveRoute = 'fanren';
      }
    }
    try {
      const pack = await request('/api/genre-lab/prepare', {
        method: 'POST',
        body: { genre: primaryGenre, query: String(sceneSource || '').slice(0, 14000), modelId, route: effectiveRoute || selectedRoute }
      });
      if (pack && pack.ok) {
        return { ...pack, sceneType, bucket: pack.familyName || primaryGenre, route: pack.routeId || effectiveRoute || selectedRoute, genre: primaryGenre };
      }
    } catch (_) {}
    if (genreCandidates.some(genre => /玄幻/.test(genre))) {
      try {
        const pack = await request('/api/xuanhuan-lab/prepare', { method: 'POST', body: { query: String(sceneSource || '').slice(0, 14000), modelId, route: selectedRoute || 'yuanshi' } });
        return { ...pack, sceneType, bucket: '玄幻精选场景库', route: selectedRoute || 'yuanshi' };
      } catch (_) {}
    }
    for (const genre of genreCandidates.length ? genreCandidates : ['']) {
      try {
        const params = new URLSearchParams({ bucket: genre, sceneType, limit: '3' });
        const samplesResponse = await request('/api/local-style/samples?' + params.toString());
        const baselineResponse = await request('/api/local-style/baseline?' + new URLSearchParams({ bucket: genre }).toString());
        const samples = samplesResponse && samplesResponse.samples || [];
        const baseline = baselineResponse && baselineResponse.baseline || null;
        if (samples.length || baseline) return { samples, baseline, bucket: samplesResponse.bucket || genre, sceneType, matchedBooks: baselineResponse && baselineResponse.matchedBooks || 0 };
      } catch (_) { /* 本地样式服务不可用时静默降级 */ }
    }
    return null;
  }



  function chapterPlainText(chapter) {
    return chapter && Array.isArray(chapter.scenes)
      ? chapter.scenes.map(scene => plainText(scene && scene.content)).join('\n\n').trim()
      : '';
  }

  function chapterSourceExcerpt(chapter) {
    const body = chapterPlainText(chapter);
    if (!body) return '';
    return body.length > 2400 ? body.slice(0, 520) + '\n...（本章中段省略）...\n' + body.slice(-1840) : body;
  }

  /** Build a bounded source pack from the novel itself; it does not require a dissection. */
  function buildNovelExtractionSource(state, context) {
    const sequence = chapterSequence(state);
    const currentId = context && context.current && context.current.chapter && context.current.chapter.id;
    const currentIndex = Math.max(0, sequence.findIndex(item => item.chapter && item.chapter.id === currentId));
    const chapterStart = Math.max(0, currentIndex - 11);
    const chapterRows = sequence
      .slice(chapterStart, currentIndex + 1)
      .map((item, offset) => ({ item, index: chapterStart + offset, body: chapterSourceExcerpt(item.chapter) }))
      .filter(row => row.body);
    const chaptersText = chapterRows.map(row => {
      const outline = chapterOutline(state, row.item);
      return `第${row.index + 1}章《${text(row.item.chapter.title)}${row.item.chapter.sub ? '·' + text(row.item.chapter.sub) : ''}》\n` +
        (outline && outline.synopsis ? '章节规划：' + clipContextText(outline.synopsis, 700) + '\n' : '') + row.body;
    }).join('\n\n');
    const outlineStart = Math.max(0, currentIndex - 11);
    const outlineRows = sequence.slice(outlineStart, currentIndex + 5).map((item, offset) => {
      const outline = chapterOutline(state, item);
      return outline && (outline.title || outline.synopsis)
        ? `${outlineStart + offset + 1}. ${text(outline.num || item.chapter.title)} ${text(outline.title)}：${clipContextText(outline.synopsis, 700)}`
        : '';
    }).filter(Boolean).join('\n');
    const data = ensureKnowledge(state);
    const entitiesText = data.entities.slice(0, 80).map(entity => JSON.stringify({
      type: entity.type,
      name: entity.name,
      aliases: entity.aliases,
      status: entity.status,
      location: entity.currentLocation,
      owner: entity.owner,
      personality: entity.personality,
      notes: clipContextText(entity.notes, 260),
      attrs: entity.attrs
    })).join('\n');
    const historyText = (state.history || []).slice(0, 12).map(item => {
      return `${text(item && item.chapter)} / ${text(item && item.scene)}：${clipContextText(item && item.text, 900)}`;
    }).filter(item => item.trim() !== '/：').join('\n');
    const creationBible = context && context.creationBible ? clipContextText(context.creationBible, 12000) : '';
    const dossier = context && context.dossier ? clipContextText(context.dossier, 9000) : projectDossierContextText(state);
    return [
      `书名：《${text(state.title || '未命名小说')}》`,
      `当前章节：${text(context && context.current && context.current.chapter && context.current.chapter.title)}；当前场景：${text(context && context.current && context.current.scene && context.current.scene.name)}`,
      `用户本次任务：${clipContextText(context && context.prompt || '', 1000)}`,
      `当前章节规划：${clipContextText(context && context.outline || '', 1400) || '暂无'}`,
      `已有章节正文（只允许从这些内容抽取事实）：\n${clipContextText(chaptersText, 28000) || '暂无已写正文'}`,
      `邻近章节大纲：\n${clipContextText(outlineRows, 9000) || '暂无大纲'}`,
      `上一章结尾：${clipContextText(context && context.previous && context.previous.ending || '', 2600) || '暂无'}`,
      `下一章接口参考：${clipContextText(context && context.next && [context.next.title, context.next.outline, context.next.ending].filter(Boolean).join('；') || '', 1800) || '暂无'}`,
      `已有设定实体：\n${clipContextText(entitiesText, 12000) || '暂无设定实体'}`,
      `作品资料中心（定位、专项素材，只读引用）：\n${dossier || '暂无作品资料'}`,
      `未回收伏笔：\n${clipContextText(context && context.foreshadows || '', 5000) || '暂无伏笔'}`,
      `历史版本快照：\n${clipContextText(historyText, 7000) || '暂无历史版本'}`,
      `现有创作圣经（只读，若有）：\n${creationBible || '暂无创作圣经'}`
    ].join('\n\n');
  }

  function listObjects(value, fallback, limit) {
    const source = Array.isArray(value) ? value : [];
    const normalized = source.map(item => {
      if (typeof item === 'string') return text(item).trim();
      return item && typeof item === 'object' ? cloneValue(item) : null;
    }).filter(item => typeof item === 'string' ? item : item && Object.keys(item).length);
    return (normalized.length ? normalized : (Array.isArray(fallback) ? cloneValue(fallback) : [])).slice(0, Number(limit) || 40);
  }

  function lastContextSentence(value) {
    const source = text(value).replace(/\s+/g, ' ').trim();
    if (!source) return '';
    const parts = source.split(/[。！？!?；;\n]/).map(item => item.trim()).filter(item => item.length >= 4);
    return clipContextText(parts[parts.length - 1] || source, 140);
  }

  function contractFallbacks(context, prompt) {
    const goal = clipContextText(context && context.outline || prompt || '推进当前章节并处理前文遗留问题', 520);
    const anchor = lastContextSentence(context && context.body || context && context.previous && context.previous.ending || '') || '前文已经发生的变化';
    return {
      goal,
      protagonistAction: `主角围绕“${goal}”从“${anchor}”出发，采取一项可观察的主动行动`,
      opposition: `前文尚未解决的冲突、期限或规则约束阻止主角直接完成“${goal}”`,
      informationChange: `主角从“${anchor}”中确认一条会改变下一步选择的新信息`,
      escalation: `阻力具体升级，主角可用的时间、资源或安全范围进一步收缩`,
      irreversibleResult: `本章结束时主角为推进“${goal}”作出不可撤回的选择，局势或关系至少改变一项`,
      obstacle: `前文尚未解决的冲突、期限或规则约束`,
      opponentGoal: `阻止主角完成“${goal}”并避免自身损失`,
      informationGap: `主角与阻力方各掌握部分事实，关键差异集中在“${anchor}”之后的真实意图`,
      leverage: anchor,
      cost: '推进目标会消耗一项已有资源或暴露一条已有信息',
      requiredProgress: ['让当前冲突产生可验证的信息变化', '在章末固定一项不可逆结果'],
      reversalCondition: '已出现的规则、物品、证据或伤势迫使对手改变选择',
      nextChapterInterface: `承接本章不可逆结果，下一章必须处理“${goal}”带来的新压力`
    };
  }

  function normalizeExtractedCanon(raw, state, context) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const extracted = source.canon && typeof source.canon === 'object' ? source.canon
      : source.canonSnapshot && typeof source.canonSnapshot === 'object' ? source.canonSnapshot : {};
    const existing = context && context.canonSnapshot && typeof context.canonSnapshot === 'object' ? context.canonSnapshot : {};
    const data = ensureKnowledge(state);
    const existingEntities = data.entities.slice(0, 80).map(entity => ({
      type: entity.type, name: entity.name, aliases: entity.aliases, status: entity.status,
      location: entity.currentLocation, owner: entity.owner, notes: entity.notes, attrs: entity.attrs
    }));
    const existingForeshadows = (state.foreshadows || []).filter(item => item && item.status !== 'resolved').slice(0, 30).map(item => ({
      id: item.id, title: item.title, description: item.description, status: item.status, targetChapterId: item.targetChapterId
    }));
    const bodyAnchor = lastContextSentence(context && context.body || context && context.previous && context.previous.ending || '');
    const bookOneLine = state.outline && state.outline.book && state.outline.book.oneLine || '';
    return {
      version: 1,
      source: 'editor-existing-content',
      extractedAt: Date.now(),
      chapterNo: Math.max(1, Number(context && context.chapterNo) || 1),
      chaptersRead: Number(extracted.chaptersRead) || undefined,
      premise: text(extracted.premise || extracted.summary || existing.premise || bookOneLine || '').trim(),
      mainline: text(extracted.mainline || extracted.storyline || existing.mainline || bookOneLine || context && context.outline || '').trim(),
      worldRules: listObjects(extracted.worldRules || extracted.rules, existing.worldRules, 40),
      characters: listObjects(extracted.characters, existing.characters || existingEntities.filter(item => item.type === 'character'), 40),
      factions: listObjects(extracted.factions || extracted.organizations, existing.factions || existingEntities.filter(item => item.type === 'faction'), 30),
      locations: listObjects(extracted.locations, existing.locations || existingEntities.filter(item => item.type === 'location'), 30),
      items: listObjects(extracted.items, existing.items || existingEntities.filter(item => ['item', 'itemCategory', 'itemRank'].includes(item.type)), 40),
      timeline: listObjects(extracted.timeline || extracted.events, existing.timeline, 50),
      currentState: text(extracted.currentState || extracted.currentSituation || existing.currentState || bodyAnchor || '').trim(),
      openForeshadows: listObjects(extracted.openForeshadows || extracted.foreshadows, existing.openForeshadows || existingForeshadows, 40),
      evidence: listObjects(extracted.evidence || extracted.evidenceRefs, existing.evidence && existing.evidence.length ? existing.evidence : bodyAnchor ? [bodyAnchor] : [], 60)
    };
  }

  function normalizeContract(raw, context, prompt) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const chapter = context.current.chapter;
    const defaults = contractFallbacks(context, prompt);
    const canonCharacters = context.canonSnapshot && Array.isArray(context.canonSnapshot.characters) ? context.canonSnapshot.characters : [];
    const viewpointFallback = canonCharacters[0] && typeof canonCharacters[0] === 'object' ? text(canonCharacters[0].name || canonCharacters[0].role) : text(canonCharacters[0]);
    return {
      ...cloneValue(source),
      version: 1,
      chapterId: chapter && chapter.id || '',
      // 创作书审计使用服务端合同字段；同时保留编辑器旧字段供正文提示兼容。
      chapterNo: Math.max(1, Number(source.chapterNo) || Number(context.chapterNo) || 1),
      viewpoint: text(contractValue(source, ['viewpoint', '视角人物'], viewpointFallback || context.current.scene && context.current.scene.name || '当前视角人物')),
      goal: text(contractValue(source, ['goal', 'currentGoal', '目标'], defaults.goal)),
      protagonistAction: text(contractValue(source, ['protagonistAction', '主角行动'], defaults.protagonistAction)),
      opposition: text(contractValue(source, ['opposition', '主要阻力'], defaults.opposition)),
      informationChange: text(contractValue(source, ['informationChange', '信息变化'], defaults.informationChange)),
      escalation: text(contractValue(source, ['escalation', '升级压力'], defaults.escalation)),
      irreversibleResult: text(contractValue(source, ['irreversibleResult', '不可逆结果'], defaults.irreversibleResult)),
      obstacle: text(contractValue(source, ['obstacle', 'primaryObstacle', '主要阻力', 'opposition'], defaults.obstacle)),
      opponentGoal: text(contractValue(source, ['opponentGoal', '对手目标'], defaults.opponentGoal)),
      informationGap: text(contractValue(source, ['informationGap', '双方信息差', 'informationChange'], defaults.informationGap)),
      leverage: text(contractValue(source, ['leverage', '筹码', '主角筹码'], defaults.leverage)),
      constraints: contractList(source, ['constraints', 'limitations', '限制', '资源与限制'], ['遵循现有作品事实']),
      cost: text(contractValue(source, ['cost', '代价'], defaults.cost)),
      requiredProgress: contractList(source, ['requiredProgress', 'mustProgress', '必须推进'], defaults.requiredProgress),
      forbiddenReveal: contractList(source, ['forbiddenReveal', 'mustNotReveal', '禁止揭示'], []),
      reversalCondition: text(contractValue(source, ['reversalCondition', '反转条件'], defaults.reversalCondition)),
      irreversibleChange: text(contractValue(source, ['irreversibleChange', '不可逆变化', 'irreversibleResult'], defaults.irreversibleResult)),
      nextChapterInterface: text(contractValue(source, ['nextChapterInterface', 'nextChapterHook', '下一章接口'], defaults.nextChapterInterface)),
      // ★ 局面变化合同（P2 规划期状态约束）：本章确实改变的局面、谁对谁的认识变了、三栏认知表、状态表。
      stageChange: text(contractValue(source, ['stageChange', '局面变化'], '')),
      relationShift: text(contractValue(source, ['relationShift', '关系变化'], '')),
      knowledgeTable: normalizeKnowledgeTable(source.knowledgeTable || source['认知表']),
      stateTable: Array.isArray(source.stateTable) ? cloneValue(source.stateTable) : [],
      characterStateChanges: Array.isArray(source.characterStateChanges) ? cloneValue(source.characterStateChanges).slice(0, 30) : [],
      foreshadowActions: Array.isArray(source.foreshadowActions) ? cloneValue(source.foreshadowActions).slice(0, 30) : [],
      continuityInputs: contractList(source, ['continuityInputs', '承接输入'], context.previous && context.previous.ending ? [context.previous.ending] : []),
      continuityOutputs: contractList(source, ['continuityOutputs', '承接输出'], [defaults.nextChapterInterface]),
      mustAvoid: contractList(source, ['mustAvoid', '禁止事项'], ['不得改变已有正文事实、人物状态、能力边界和物品归属']),
      task: text(prompt),
      updatedAt: Date.now()
    };
  }

  function mergeContractWithExtraction(primary, extracted, context, prompt) {
    const left = primary && typeof primary === 'object' ? primary : {};
    const right = extracted && typeof extracted === 'object' ? extracted : {};
    const merged = { ...right, ...left };
    ['goal', 'protagonistAction', 'opposition', 'informationChange', 'escalation', 'irreversibleResult', 'obstacle', 'opponentGoal', 'informationGap', 'leverage', 'cost', 'reversalCondition', 'nextChapterInterface', 'stageChange', 'relationShift'].forEach(key => {
      if (!text(left[key]).trim() && text(right[key]).trim()) merged[key] = right[key];
    });
    ['constraints', 'requiredProgress', 'forbiddenReveal', 'characterStateChanges', 'foreshadowActions', 'continuityInputs', 'continuityOutputs', 'mustAvoid', 'stateTable'].forEach(key => {
      if ((!Array.isArray(left[key]) || !left[key].length) && Array.isArray(right[key]) && right[key].length) merged[key] = right[key];
    });
    if (!hasKnowledgeTable(left.knowledgeTable) && hasKnowledgeTable(right.knowledgeTable)) merged.knowledgeTable = right.knowledgeTable;
    return normalizeContract(merged, context, prompt);
  }

  /** 三栏认知表归一化：人物已知 / 读者已知 / 待证实，各项限 12 条短句。 */
  function normalizeKnowledgeTable(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const list = value => (Array.isArray(value) ? value : []).map(item => text(typeof item === 'string' ? item : item && (item.text || item.fact || item.statement) || '')).filter(Boolean).slice(0, 12);
    return {
      characterKnown: list(source.characterKnown || source['人物已知']),
      readerKnown: list(source.readerKnown || source['读者已知']),
      unverified: list(source.unverified || source['待证实'])
    };
  }

  /** 认知表是否有任一栏内容。 */
  function hasKnowledgeTable(table) {
    return !!(table && typeof table === 'object' && ['characterKnown', 'readerKnown', 'unverified'].some(key => Array.isArray(table[key]) && table[key].length));
  }

  /** 局面变化合同文本块：注入起草与审稿，只读。 */
  function buildStagePlanText(contract) {
    if (!contract) return '';
    const lines = [];
    if (text(contract.stageChange).trim()) lines.push('本章必须真实改变的局面：' + contract.stageChange);
    if (text(contract.relationShift).trim()) lines.push('谁对谁的认识发生变化：' + contract.relationShift);
    const table = contract.knowledgeTable || {};
    if (hasKnowledgeTable(table)) {
      lines.push('认知三栏（写作时不得越界）：');
      if (table.characterKnown && table.characterKnown.length) lines.push('  · 视角人物已知：' + table.characterKnown.join('；'));
      if (table.readerKnown && table.readerKnown.length) lines.push('  · 读者已知但人物未知：' + table.readerKnown.join('；'));
      if (table.unverified && table.unverified.length) lines.push('  · 尚待证实（只能作为猜测出现）：' + table.unverified.join('；'));
    }
    if (Array.isArray(contract.stateTable) && contract.stateTable.length) {
      lines.push('状态表（人员位置/工具与物品/能量供电/伤势受力/时间顺序，章内变化必须有过程）：');
      contract.stateTable.forEach(item => {
        const row = typeof item === 'string' ? item : [item.subject || item.name, item.state || item.value, item.note].filter(Boolean).join('：');
        if (text(row).trim()) lines.push('  · ' + row);
      });
    }
    return lines.join('\n');
  }

  /** 题材分层起草硬指令：依据题材族动态调整宏大/生活化开局与方言要求，统一规范人物牵挂与动作白描。 */
  function buildScopedWritingDirectives(genreFamily = 'unknown') {
    const isAncientOrDisaster = genreFamily === 'ancient_cultivation' || genreFamily === 'disaster_exploration';
    const isCultivationOrRomance = genreFamily === 'ancient_cultivation' || genreFamily === 'romance_fantasy';

    const directives = [
      isAncientOrDisaster
        ? '开篇遵循本章任务：宏观奇观与具体生计均可作为入口，规模服从人物处境，不因题材强制宏大开局。'
        : '切身处境与自然切入：从人物即时处境、切身利益与具体场景自然切入，允许生活化、职场、校园或日常对白起笔，拒绝假大空宏大口号。',
      !isCultivationOrRomance
        ? '市井烟火与自然口语：对白符合人物社会身份与地域特征，保留生活化口语声调与市井质感，避免文绉绉的假书面语。'
        : '架空语境用语符合已确定的时代、阶层与人物，允许乡土口语；不凭题材标签禁止自然表达。',
      '出场人物携带具体牵挂：所有登场人物必须携带即时牵挂（后顾之忧、利益算计、牵挂的人或物、生存代价），拒绝毫无动机的纸片工具人。',
      '拒绝每句藏机锋与微动作：严禁每句话追加“挑眉、眼神微动、摩挲指节、话里有话”的刻意微动作表演，普通交互直接利落，动作服务现场真实目标。',
      '主谓宾丰富与文气呼吸：长短句自然交织，严禁连续多句使用“主角名+单字动词”的发报机流水账，动词与环境物理因果深度绑定。',
      '情绪落地与物理真实：禁止在动作后追加“写满心疼/神色复杂”等情绪复述标签，伤势与受力必须落在具体部位与环境破损上，严禁神经反射式受击套话。',
      '证据边界与信息克制：线索不足时不替证据下方向性结论，区分观察、怀疑与铁证，不让旁白越权做主观价值惊叹与感悟。'
    ];

    let output = '【章节起草基础硬指令】';
    directives.forEach((d, idx) => {
      output += `\n${idx + 1}. ${d}`;
    });
    return output;
  }

  /** 从作品元数据与选定路线解析题材，未知时不强行套用玄幻规则。 */
  function resolveEditorGenre(state, stylePack, promptText = '') {
    const source = state || {};
    const explicit = source.genre || source.novelType || source.category || source.creationContext?.bible?.payload?.genre || stylePack?.genre;
    if (typeof explicit === 'string' && explicit.trim() && explicit.trim().toLowerCase() !== 'auto') {
      const clean = explicit.trim();
      if (['玄幻', '都市高武', '悬疑脑洞', '青春甜宠', '历史脑洞', '科幻末世', '通用', '通用现实'].includes(clean)) return clean;
    }
    const route = source.genreRoute || source.xuanhuanRoute || '';
    const groups = {
      玄幻: ['yuanshi', 'jianzhu', 'xuanjian', 'fanren'],
      都市高武: ['urban_grind', 'swallow_star', 'yucun_1982', 'daguo_junken'],
      悬疑脑洞: ['laoshiren', 'rule_horror', 'folklore_investigation', 'sequence_cost'],
      青春甜宠: ['urban_emotion', 'modern_romance'],
      历史脑洞: ['dynasty_friction', 'spy_years', 'history'],
      科幻末世: ['hard_survival', 'dawn_blade', 'super_mechanic'],
      通用: ['neutral_dramatic']
    };
    if (route && route !== 'auto') {
      const matched = Object.keys(groups).find(genre => groups[genre].includes(route));
      if (matched) return matched;
    }
    // 智能识别 (auto) 兜底：从任务提示词、书名、大纲关键词智能识别
    const combined = [
      source.title, source.name, source.novel && (source.novel.title || source.novel.name),
      source.outline && (source.outline.title || source.outline.name || (source.outline.book && source.outline.book.name)),
      promptText, source.outline && source.outline.summary
    ].filter(Boolean).join(' ');
    if (/凡人|长春功|灵根|修仙|修真|仙侠|散修|药园|练气|筑基|金丹|灵气|口诀|丹药|采药|七玄门|神手谷|宗门|道友|法宝|元婴|玄幻|斗气|武魂|仙契|仙路|仙剑|圣煞|离火|炼功/i.test(combined)) return '玄幻';
    if (/怪谈|规则|诡异|解密|民俗|惊悚|循环|不可名状|老宅|缝尸|捞尸/i.test(combined)) return '悬疑脑洞';
    if (/赛博|星舰|深空|跃迁|智脑|机甲|机械义体|废土|辐射|避难所|末世|丧尸|星际/i.test(combined)) return '科幻末世';
    if (/朝廷|大明|大秦|边军|锦衣卫|皇帝|科举|漕运|藩王|历史|军垦/i.test(combined)) return '历史脑洞';
    if (/甜宠|校草|学霸|暗恋|总裁|婚恋|恋爱|女频|校园/i.test(combined)) return '青春甜宠';
    if (/商战|资本|重仓|并购|职场|名利|首富|金融|重生|武馆|气血|基因|高武|都市/i.test(combined)) return '都市高武';
    return '通用';
  }

  async function requestExistingContentExtraction({ state, context, prompt, stageNode }) {
    const request = refFunction('requestChatText');
    if (!request) throw new Error('当前页面未加载 AI 请求接口');
    const extractionContext = buildNovelExtractionSource(state, { ...context, prompt });
    const result = await request([
      {
        role: 'system',
        content: '你是小说项目事实抽取与章节合同整理器。只处理输入中已经写出的正文、历史版本、现有大纲、设定、伏笔和创作圣经，不写正文，不补造世界观，不引用输入之外的人名或事件。即使没有拆书、没有大纲或没有知识库，也必须从已有正文抽取能确认的最小事实，并为当前章节填写可执行合同。所有不确定内容用空字符串或空数组；合同五个字段 goal、protagonistAction、opposition、informationChange、irreversibleResult 必须有具体人物、行动、阻力或后果，不能写“主角变强”“发生冲突”等套话。另外必须填写局面变化合同：stageChange（本章确实改变的一个局面，一句话）、relationShift（哪个人物对主角的认识因本章行动发生了什么变化）、knowledgeTable（三栏：characterKnown 视角人物此刻已知、readerKnown 读者已知但人物未知、unverified 仍待证实只能作猜测）、stateTable（人员位置/工具物品持有/供电能量/伤势/时间顺序的起始状态，每项 {subject,state}）。只返回合法 JSON，不要 Markdown。格式：{"canon":{"premise":"","mainline":"","worldRules":[],"characters":[],"factions":[],"locations":[],"items":[],"timeline":[],"currentState":"","openForeshadows":[],"evidence":[]},"chapterContract":{"chapterNo":1,"viewpoint":"","goal":"","protagonistAction":"","opposition":"","informationChange":"","escalation":"","irreversibleResult":"","stageChange":"","relationShift":"","knowledgeTable":{"characterKnown":[],"readerKnown":[],"unverified":[]},"stateTable":[{"subject":"","state":""}],"characterStateChanges":[],"foreshadowActions":[],"continuityInputs":[],"continuityOutputs":[],"mustAvoid":[]}}'
      },
      {
        role: 'user',
        content: `当前任务：${clipContextText(prompt, 1000)}\n\n${DYNAMIC_CONTEXT_MARKER}\n${extractionContext}\n\n请先完成事实抽取，再填写当前章节合同。只依据上面的已有内容。`
      }
    ], editorRequestOptions(stageNode, { maxTokens: 1800, jsonMode: true, returnUsage: true, requireUsage: true }));
    const parsed = parseStructuredJSON(responseText(result));
    const rawContract = parsed && (parsed.chapterContract || parsed.contract || parsed.chapter) || {};
    const canon = normalizeExtractedCanon(parsed, state, context);
    const contract = normalizeContract(rawContract, { ...context, canonSnapshot: canon }, prompt);
    return { canon, contract, usage: result && result.usage || null, sourceLength: extractionContext.length };
  }

  function normalizeAudit(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const issues = Array.isArray(source.issues) ? source.issues.map(item => ({
      // 服务端审计用 category（continuity/experience/lineedit…），客户端用 type：都收
      type: text(item && (item.type || item.category) || 'logic'),
      severity: text(item && item.severity || 'medium').toLowerCase(),
      problem: text(item && (item.problem || item.issue || item.description) || '') + (item && item.quote ? '（原文：「' + String(item.quote).slice(0, 30) + '」）' : ''),
      fix: text(item && (item.fix || item.suggestion) || '')
    })).filter(item => item.problem) : [];
    const passed = source.serverVerified === true
      ? source.passed === true && source.status === 'passed' && Boolean(source.contentHash)
      : source.passed === true && (!source.status || source.status === 'passed') &&
        !source.error && !(source.incompleteReasons || []).length &&
        !source.noStageChange && source.usage?.complete !== false &&
        !(Array.isArray(source.issues) ? source.issues : []).some(item => ['blocker', 'high', 'medium'].includes(text(item && item.severity || 'medium').toLowerCase()));
    return {
      ...cloneValue(source),
      passed,
      status: passed ? 'passed' : source.status && source.status !== 'passed' ? source.status : 'needs_review',
      summary: text(source.summary || source.conclusion || (passed ? '审计通过' : '审计未通过或未完成')),
      issues
    };
  }

  function markRunNeedsReview(run, message) {
    run.status = 'needs_review';
    const audit = normalizeAudit(run.audit);
    run.audit = { ...audit, passed: false, status: audit.status === 'passed' ? 'needs_review' : audit.status, summary: text(message) };
    run.pendingFactLedgerDelta = null;
    run.pendingFactLedgerHash = '';
  }

  async function bindRunAudit(run, rawAudit, content) {
    const audit = normalizeAudit(rawAudit);
    const contentHash = await hashText(content);
    run.audit = audit;
    if (!audit.passed || audit.contentHash !== contentHash) {
      markRunNeedsReview(run, audit.contentHash !== contentHash ? '审计正文 hash 不匹配或缺失，需重新审计' : audit.summary);
      return false;
    }
    run.pendingFactLedgerDelta = cloneValue(audit.factLedgerDelta || null);
    run.pendingFactLedgerHash = contentHash;
    return true;
  }

  async function requestFinalContentAudit(state, run, content, stageNode) {
    const endpoint = state.creationBookId
      ? `/api/creation-books/${encodeURIComponent(state.creationBookId)}/audit`
      : '/api/benchmark/audit';
    run.usage = run.usage || {};
    const auditIndex = Object.keys(run.usage).filter(key => key.startsWith('finalAudit')).length + 1;
    run.usage[`finalAudit${auditIndex}`] = null;
    const result = await creationRequest(endpoint, trackedGenerationOptions({ method: 'POST', body: {
      chapterNo: creationChapterNo(state, run.chapterId), content, contract: run.contract,
      genre: run.genre || resolveEditorGenre(state), targetWords: run.targetWords,
      modelId: run.modelId || (stageNode && stageNode.querySelector('[data-completion-model]') || {}).value || undefined,
      factLedger: state.factLedger || null, previousEnding: run.context && run.context.previous && run.context.previous.ending || ''
    } }));
    run.usage[`finalAudit${auditIndex}`] = result && (result.usage || result.audit && result.audit.usage) || null;
    if (!result || result.ok === false || !result.audit) throw new Error(result && result.error || '正文审计未返回结果');
    if (state.creationBookId) run.creationAudit = cloneValue(result.audit);
    const valid = await bindRunAudit(run, result.audit, content);
    if (!run.usage[`finalAudit${auditIndex}`] || (result.status && result.status !== 'passed') || result.usage?.complete === false ||
      result.audit.usage?.complete === false || (result.calls || []).some(call => !call || call.status !== 'completed')) {
      markRunNeedsReview(run, '正文审计未完成，不能写入正文');
      return false;
    }
    return valid;
  }

  function editorRequestOptions(stageNode, extras) {
    const genreFamily = (stageNode && stageNode.querySelector('[data-completion-genre-family]') || {}).value;
    const writingStyle = (stageNode && stageNode.querySelector('[data-completion-archetype-override]') || {}).value;
    const chapterFunction = (stageNode && stageNode.querySelector('[data-completion-chapter-function]') || {}).value;
    const focusValue = (stageNode && stageNode.querySelector('[data-completion-chapter-focus]') || {}).value;
    const endingHookValue = (stageNode && stageNode.querySelector('[data-completion-ending-hook]') || {}).value;
    const promptValue = (extras && extras.prompt) || (stageNode && stageNode.querySelector('[data-completion-prompt]') || {}).value || '';
    const wordBudget = typeof parseEditorWordBudget === 'function'
      ? parseEditorWordBudget(promptValue, extras)
      : {
          target: (extras && (extras.targetWords || extras.wordTarget)) || 2000,
          min: Math.round(((extras && (extras.targetWords || extras.wordTarget)) || 2000) * 0.85),
          max: Math.round(((extras && (extras.targetWords || extras.wordTarget)) || 2000) * 1.15),
          summary: `目标篇幅约 ${(extras && (extras.targetWords || extras.wordTarget)) || 2000} 字`
        };
    const preview = getPreview();
    const requestOptions = {
      model: (stageNode.querySelector('[data-completion-model]') || {}).value || undefined,
      stage: 'writing',
      projectId: isServerNovelId(preview.novelId) ? String(preview.novelId) : undefined,
      genre: resolveEditorGenre(editorState(false)),
      genreFamily: (genreFamily && genreFamily !== 'all') ? genreFamily : undefined,
      novelGenre: (genreFamily && genreFamily !== 'all') ? genreFamily : undefined,
      writingStyle: writingStyle || undefined,
      styleArchetype: writingStyle || undefined,
      chapterFunction: chapterFunction || undefined,
      chapterFocus: focusValue || 'balanced',
      endingHook: endingHookValue || undefined,
      targetWords: wordBudget.target,
      targetChars: wordBudget.target,
      wordBudget,
      disableClientTimeout: true,
      correctionPolicy: true,
      ...(extras || {}),
      editorOnly: true
    };
    const thinkingControl = stageNode.querySelector('[data-completion-thinking-control]');
    if (thinkingControl && thinkingControl.dataset.mode === 'reasoning') requestOptions.reasoningEffort = thinkingControl.value;
    if (thinkingControl && thinkingControl.dataset.mode === 'thinking') requestOptions.thinking = thinkingControl.value === 'on';
    return trackedGenerationOptions(requestOptions);
  }

  function usageCredit(usage) {
    if (!usage || usage.creditCost == null) return null;
    const value = Number(usage && usage.creditCost);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function generationActualCost(run) {
    const values = Object.values(run && run.usage || {}).map(usageCredit).filter(value => value !== null);
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100 : null;
  }

  function generationUsageSummary(run) {
    return Object.entries(run && run.usage || {}).map(([stage, usage]) => {
      const status = !usage ? 'unavailable' : usage.complete === false ? 'incomplete' : usage.status || (usage.complete === true ? 'completed' : 'reported');
      return `${stage}: ${status} · Token ${usage && (usage.totalTokens ?? usage.total_tokens) != null ? usage.totalTokens ?? usage.total_tokens : '未知'} · 积分 ${usageCredit(usage) ?? '未知'}`;
    }).join('；');
  }

  async function hashText(value) {
    const source = text(value);
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      const buffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
      return Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
    return `fallback-${(hash >>> 0).toString(16)}`;
  }

  function responseText(result) {
    return typeof result === 'string' ? result : text(result && result.text);
  }

  function loadGenerationRunsModule() {
    if (window.MolanGenerationRuns) return Promise.resolve(window.MolanGenerationRuns);
    if (runtime.editorGenerationRunsLoadPromise) return runtime.editorGenerationRunsLoadPromise;
    const sourceUrl = EDITOR_SCRIPT_URL || window.location && window.location.href || '';
    const scriptUrl = sourceUrl ? new URL('./lib/client/generation-runs.js', sourceUrl).href : './lib/client/generation-runs.js';
    runtime.editorGenerationRunsLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.onload = () => window.MolanGenerationRuns ? resolve(window.MolanGenerationRuns) : reject(new Error('Generation Run 模块加载失败'));
      script.onerror = () => reject(new Error('Generation Run 模块加载失败'));
      document.head.appendChild(script);
    });
    return runtime.editorGenerationRunsLoadPromise;
  }

  async function generationRunsClient() {
    if (runtime.editorGenerationRunsClient) return runtime.editorGenerationRunsClient;
    const api = await loadGenerationRunsModule();
    runtime.editorGenerationRunsClient = api.createGenerationRunClient({ request: (path, options) => creationRequest(path, options) });
    return runtime.editorGenerationRunsClient;
  }

  async function generationV2Capabilities(forceRefresh) {
    if (!forceRefresh && runtime.editorGenerationCapabilities && Date.now() - runtime.editorGenerationCapabilitiesAt < 20000) {
      return runtime.editorGenerationCapabilities;
    }
    let response;
    try {
      response = await creationRequest('/api/generation-runs/capabilities', {});
    } catch (error) {
      if (error && error.code === 'generation_v2_disabled') {
        runtime.editorGenerationCapabilities = { generationV2: false, disabled: true, code: 'generation_v2_disabled' };
        runtime.editorGenerationCapabilitiesAt = Date.now();
        return runtime.editorGenerationCapabilities;
      }
      throw error;
    }
    if (response && response.code === 'generation_v2_disabled') {
      runtime.editorGenerationCapabilities = { ...response, generationV2: false, disabled: true };
      runtime.editorGenerationCapabilitiesAt = Date.now();
      return runtime.editorGenerationCapabilities;
    }
    if (!response || response.generationV2 !== true) {
      throw new Error('Generation V2 能力响应无效；已停止生成，未切换到旧生成链');
    }
    if (response.commit !== true || response.recovery !== true) {
      throw new Error('Generation V2 缺少正式提交或任务恢复能力；已停止生成，未切换到旧生成链');
    }
    runtime.editorGenerationCapabilities = response;
    runtime.editorGenerationCapabilitiesAt = Date.now();
    return response;
  }

  function generationV2Status(state) {
    const key = String(state || 'created');
    const statuses = {
      created: ['in_progress', 'planning'], request_validated: ['in_progress', 'planning'],
      genre_resolved: ['in_progress', 'planning'], style_resolved: ['in_progress', 'planning'],
      context_built: ['in_progress', 'planning'], contract_validated: ['in_progress', 'planning'],
      pre_generation_guard: ['in_progress', 'auditing'], scene_planning: ['in_progress', 'planning'],
      generating: ['in_progress', 'drafting'], draft_received: ['in_progress', 'auditing'],
      deterministic_audit: ['in_progress', 'auditing'], semantic_audit: ['in_progress', 'auditing'],
      quality_audit: ['in_progress', 'auditing'], revision: ['in_progress', 'revising'],
      committing: ['in_progress', 'commit_pending'], cancel_requested: ['in_progress', 'cancel_requested'],
      waiting_author: ['ready', 'ready'], needs_human: ['needs_review', 'needs_review'],
      committed: ['ready', 'ready'], cancelled: ['cancelled', 'cancelled'],
      failed: ['failed', 'failed'], provider_unknown: ['unknown', 'unknown'], rejected: ['needs_review', 'needs_review'],
      paused: ['in_progress', 'paused']
    };
    const pair = statuses[key] || ['in_progress', 'planning'];
    return { itemStatus: pair[0], workflowStage: pair[1] };
  }

  function generationV2Audit(result, state) {
    const primary = result && result.audit && typeof result.audit === 'object' ? result.audit : {};
    const semanticValue = result && result.semanticAudit;
    const semantic = semanticValue && semanticValue.audit && typeof semanticValue.audit === 'object'
      ? semanticValue.audit
      : semanticValue && typeof semanticValue === 'object' ? semanticValue : {};
    const issues = [
      ...(Array.isArray(primary.issues) ? primary.issues : []),
      ...(Array.isArray(semantic.issues) ? semantic.issues : [])
    ].map(item => ({
      ...cloneValue(item),
      type: text(item && (item.type || item.category) || 'logic'),
      problem: text(item && (item.problem || item.detail || item.description) || ''),
      fix: text(item && (item.fix || item.fixHint || item.suggestion) || '')
    }));
    const passed = String(state || '') === 'waiting_author' || String(state || '') === 'committed';
    return {
      ...cloneValue(primary),
      issues,
      passed,
      status: passed ? 'passed' : 'needs_review',
      serverVerified: passed,
      contentHash: text(result && result.outputHash || primary.contentHash),
      summary: text(primary.summary || semantic.summary || (passed ? '服务端审计通过，等待作者确认' : '服务端审计需要人工复核'))
    };
  }

  async function applyGenerationV2Snapshot(state, run, item, remote, stages) {
    if (!run || !remote) return false;
    const nextState = text(remote.state || '');
    const priorState = run.serverState;
    const result = remote.result && typeof remote.result === 'object' ? remote.result : {};
    const draft = text(result.draft || result.text || '');
    const outputHash = text(result.outputHash || remote.manifest && remote.manifest.outputHash || '');
    run.generationV2 = true;
    run.remoteRunId = text(remote.id || run.remoteRunId);
    run.serverState = nextState;
    run.serverUpdatedAt = Number(remote.updatedAt) || Date.now();
    run.serverEventCursor = Math.max(Number(run.serverEventCursor) || 0, Number(remote.lastEventSequence) || 0);
    run.serverStages = (Array.isArray(stages) ? stages : []).map(stage => ({
      stage: text(stage && stage.stage), status: text(stage && stage.status),
      attemptNo: Number(stage && stage.attemptNo) || 1, errorCode: text(stage && stage.errorCode)
    }));
    run.serverResult = {
      outputHash,
      audit: cloneValue(result.audit || null),
      semanticAudit: cloneValue(result.semanticAudit || null),
      quality: cloneValue(result.quality || null),
      contract: cloneValue(result.contract || null),
      revisionRound: Number(result.revisionRound) || 0,
      contextHash: text(result.contextHash || '')
    };
    run.revisionRound = Number(result.revisionRound) || 0;
    if (nextState === 'committed' && result.commitReceipt && typeof result.commitReceipt === 'object') {
      run.commitReceipt = { ...cloneValue(result.commitReceipt), bookId: state.creationBookId || '' };
      run.appliedContentHash = outputHash || run.commitReceipt.contentHash || run.appliedContentHash;
      run.acceptedAt = Number(run.acceptedAt) || Date.now();
      run.pendingCommit = null;
      syncCreationCommitReceipt(state, run);
    }
    run.errorCode = text(remote.error && remote.error.code || remote.errorCode || '');
    run.lastServerMessage = text(remote.lastEvent && remote.lastEvent.message || run.lastServerMessage || '');
    run.status = nextState === 'waiting_author' ? 'awaiting_confirmation'
      : nextState === 'committed' ? 'accepted'
        : nextState === 'provider_unknown' ? 'provider_unknown'
          : nextState === 'cancelled' ? 'cancelled'
            : nextState === 'failed' ? 'failed'
              : nextState === 'needs_human' ? 'needs_review'
                : nextState === 'cancel_requested' ? 'cancel_requested'
                  : nextState;
    if (draft) {
      run.finalText = draft;
      run.draft = draft;
      run.resultContentHash = outputHash || await hashText(draft);
      run.pendingFactLedgerHash = run.resultContentHash;
      const semantic = result.semanticAudit && (result.semanticAudit.audit || result.semanticAudit) || {};
      run.pendingFactLedgerDelta = semantic.factLedgerDelta || result.audit && result.audit.factLedgerDelta || null;
      run.audit = generationV2Audit(result, nextState);
      run.outputHash = run.resultContentHash;
    }
    if (item) {
      const status = generationV2Status(nextState);
      item.generationV2 = true;
      item.remoteRunId = run.remoteRunId;
      item.serverState = nextState;
      item.workflowRunId = run.id;
      item.workflowStage = status.workflowStage;
      item.status = status.itemStatus;
      if (draft) {
        item.text = draft;
        item.audit = cloneValue(run.audit);
        item.resultId = item.resultId || uid('ai-result');
      } else if (run.lastServerMessage && status.itemStatus === 'in_progress') {
        item.text = run.lastServerMessage;
      }
      item.retryPrompt = ['provider_unknown', 'cancelled', 'committed'].includes(nextState) ? '' : run.prompt || item.retryPrompt || '';
      item.errorNotice = nextState === 'provider_unknown'
        ? '供应商结果未知；系统已停止自动重试，请查询任务状态。'
        : nextState === 'needs_human' || nextState === 'rejected'
          ? run.lastServerMessage || '审计需要人工复核；正文已保留。'
          : nextState === 'cancelled' ? '生成已取消；未写入正文。'
            : nextState === 'failed' ? text(remote.error && remote.error.message || run.lastServerMessage || '生成未完成。')
              : '';
    }
    if (priorState !== nextState) persistGenerationRun(state, run);
    return priorState !== nextState;
  }

  function generationV2StageForEvent(event) {
    const state = text(event && (event.state || event.event && event.event.state) || '');
    return generationV2Status(state).workflowStage;
  }

  async function observeGenerationRun(state, run, item, options) {
    if (!run || !run.remoteRunId) return { outcome: 'unavailable' };
    const existing = runtime.editorGenerationRunObservers.get(run.remoteRunId);
    if (existing) return existing;
    const settings = options || {};
    const observer = (async () => {
      const capabilities = settings.capabilities || await generationV2Capabilities();
      if (!capabilities.generationV2 || capabilities.recovery !== true) {
        if (item) {
          item.status = 'unknown';
          item.workflowStage = 'unknown';
          item.errorNotice = '服务端未提供任务恢复能力，稿件与任务编号已保留。';
          renderEditorChat();
        }
        return { outcome: 'unavailable', run: null };
      }
      const client = await generationRunsClient();
      if (settings.ownBusy !== false) {
        runtime.activeGenerationRun = run;
        runtime.activeGenerationState = state;
        runtime.editorBusy = true;
        renderGenerationControl();
      }
      const result = await client.observe(run.remoteRunId, {
        after: Number(run.serverEventCursor) || 0,
        signal: settings.signal,
        onEvent: event => {
          const sequence = Number(event && event.sequence) || 0;
          run.serverEventCursor = Math.max(Number(run.serverEventCursor) || 0, sequence);
          run.serverState = text(event && event.state || run.serverState);
          run.lastServerMessage = text(event && (event.message || event.event && event.event.message) || run.lastServerMessage);
          if (item) {
            item.serverState = run.serverState;
            item.workflowStage = generationV2StageForEvent(event);
            if (run.lastServerMessage && item.status === 'in_progress') item.text = run.lastServerMessage;
            renderEditorChat();
          }
          persistGenerationRun(state, run);
        },
        onRun: (remote, stages) => {
          void applyGenerationV2Snapshot(state, run, item, remote, stages).then(changed => {
            if (changed && item) renderEditorChat();
          });
        }
      });
      if (result && result.run) await applyGenerationV2Snapshot(state, run, item, result.run, result.stages);
      if (item) {
        writeWorkspace('editor-chat', chatRecords());
        renderEditorChat();
      }
      return result;
    })().catch(error => {
      if (error && error.code === 'generation_v2_disabled') {
        if (item) {
          item.status = 'unknown';
          item.workflowStage = 'unknown';
          item.errorNotice = 'Generation V2 已关闭，暂时无法读取此任务；任务编号和草稿已保留。';
          renderEditorChat();
        }
        return { outcome: 'unavailable', error };
      }
      if (item) {
        item.status = 'unknown';
        item.workflowStage = 'unknown';
        item.errorNotice = '暂时无法确认服务端任务状态；已保留任务编号与稿件，不会自动重新生成。';
        renderEditorChat();
      }
      return { outcome: 'unknown', error };
    }).finally(() => {
      runtime.editorGenerationRunObservers.delete(run.remoteRunId);
      if (runtime.activeGenerationRun === run) {
        runtime.activeGenerationRun = null;
        runtime.activeGenerationState = null;
        runtime.editorBusy = false;
        runtime.editorGenerationCancelPending = false;
        renderGenerationControl();
        const thinking = getStage() && getStage().querySelector('[data-completion-thinking]');
        thinking && thinking.classList.remove('visible');
      }
    });
    runtime.editorGenerationRunObservers.set(run.remoteRunId, observer);
    return observer;
  }

  function restoreGenerationV2Projections(state, records) {
    if (!state) return;
    state.generationRuns = Array.isArray(state.generationRuns) ? state.generationRuns : [];
    const stored = readWorkspace('generation-run-projection', []);
    stored.filter(item => item && item.novelId === completionNovelKey(state) && item.run).forEach(item => {
      const existing = state.generationRuns.find(run => run && run.id === item.run.id);
      if (!existing) state.generationRuns.push(cloneValue(item.run));
    });
    (records || []).forEach(item => {
      if (!item || !item.generationV2 || !item.remoteRunId) return;
      let run = state.generationRuns.find(candidate => candidate && candidate.id === item.workflowRunId);
      if (!run) {
        run = { id: item.workflowRunId || item.remoteRunId, generationV2: true, remoteRunId: item.remoteRunId, prompt: item.retryPrompt || '', chapterId: item.target && item.target.chapterId || '', sceneId: item.target && item.target.sceneId || '', serverState: item.serverState || 'created' };
        state.generationRuns.unshift(run);
      }
      run.generationV2 = true;
      run.remoteRunId = item.remoteRunId;
      if (item.serverState && !run.serverState) run.serverState = item.serverState;
    });
  }

  async function recoverGenerationRuns(state, records) {
    if (!state || runtime.editorBusy) return;
    restoreGenerationV2Projections(state, records);
    const pendingCreate = (state.generationRuns || []).find(run => run && run.generationV2 &&
      !run.remoteRunId && run.idempotencyKey && run.createRequest && run.serverState === 'unknown');
    if (pendingCreate) {
      const item = (records || []).find(record => record && record.workflowRunId === pendingCreate.id);
      void recoverGenerationV2Create(state, pendingCreate, item);
      return;
    }
    const candidate = (records || []).slice().reverse().find(item => {
      const run = (state.generationRuns || []).find(value => value && value.id === item.workflowRunId);
      return item && run && run.generationV2 && run.remoteRunId &&
        ['created', 'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated', 'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit', 'semantic_audit', 'quality_audit', 'revision', 'cancel_requested', 'waiting_author', 'needs_human', 'committing'].includes(run.serverState);
    });
    if (!candidate) return;
    const run = (state.generationRuns || []).find(value => value && value.id === candidate.workflowRunId);
    void observeGenerationRun(state, run, candidate, { ownBusy: true });
  }

  /** 用已保存的幂等键取回创建响应未知的任务，不生成第二个 Run。 */
  async function recoverGenerationV2Create(state, run, item) {
    if (!state || !run || !run.idempotencyKey || !run.createRequest || runtime.editorBusy) return;
    runtime.editorBusy = true;
    runtime.activeGenerationRun = run;
    runtime.activeGenerationState = state;
    renderGenerationControl();
    try {
      const capabilities = await generationV2Capabilities();
      if (!capabilities.generationV2 || capabilities.recovery !== true) throw new Error('Generation V2 查询能力当前不可用');
      const created = await (await generationRunsClient()).create(run.createRequest, run.idempotencyKey);
      const remote = created && created.run;
      if (!created || created.ok !== true || !remote || !remote.id) throw new Error('服务端仍未确认此 Idempotency-Key 对应的任务');
      run.remoteRunId = String(remote.id);
      run.serverState = text(remote.state || 'created');
      run.createRequest = null;
      run.status = run.serverState;
      if (item) {
        item.generationV2 = true;
        item.remoteRunId = run.remoteRunId;
        item.serverState = run.serverState;
      }
      persistGenerationRun(state, run);
      await applyGenerationV2Snapshot(state, run, item, remote, []);
      if (item) writeWorkspace('editor-chat', chatRecords());
      await observeGenerationRun(state, run, item, { capabilities, ownBusy: true });
    } catch (error) {
      run.status = 'unknown';
      run.serverState = run.remoteRunId ? run.serverState : 'unknown';
      run.lastServerMessage = text(error && error.message || '任务状态暂时无法确认');
      if (item) {
        item.status = 'unknown';
        item.workflowStage = 'unknown';
        item.errorNotice = '服务端任务状态暂时无法确认；Idempotency-Key 已保留，未创建新的生成请求。';
        renderEditorChat();
      }
      persistGenerationRun(state, run);
    } finally {
      if (runtime.activeGenerationRun === run && runtime.editorBusy) {
        runtime.activeGenerationRun = null;
        runtime.activeGenerationState = null;
        runtime.editorBusy = false;
        renderGenerationControl();
      }
    }
  }

  /** 仅针对当前服务端已验证 issue 做局部修订，并以最新 outputHash 执行 CAS。 */
  async function reviseGenerationV2Item(index) {
    if (runtime.editorBusy || runtime.aiApplyBusy) { toast('当前任务仍在处理，请稍后修订'); return false; }
    const records = chatRecords();
    const item = records[Number(index)];
    const state = editorState(false);
    const run = state && (state.generationRuns || []).find(record => record && record.id === item?.workflowRunId);
    if (!item || !run || !run.generationV2 || !run.remoteRunId) { toast('Generation V2 任务编号不可用，无法安全修订'); return false; }
    runtime.editorBusy = true;
    runtime.activeGenerationRun = run;
    runtime.activeGenerationState = state;
    run.status = 'revising';
    if (item) { item.status = 'in_progress'; item.workflowStage = 'revising'; item.errorNotice = ''; }
    renderGenerationControl();
    renderEditorChat();
    try {
      const capabilities = await generationV2Capabilities();
      if (!capabilities.generationV2 || capabilities.recovery !== true) throw new Error('Generation V2 修订或任务查询能力不可用');
      const client = await generationRunsClient();
      const snapshot = await client.get(run.remoteRunId);
      if (!snapshot || !snapshot.run) throw new Error('服务端未返回可验证的生成任务状态');
      await applyGenerationV2Snapshot(state, run, item, snapshot.run, snapshot.stages || []);
      if (!['waiting_author', 'needs_human'].includes(run.serverState)) {
        throw new Error('服务端任务当前状态不允许修订');
      }
      if (await hashText(item.text) !== run.outputHash) throw new Error('当前稿件与服务端审计 hash 不一致，不能修订');
      const attempted = new Set();
      let appliedCount = 0;
      while (appliedCount < 2 && Number(run.serverResult && run.serverResult.revisionRound || 0) < 2) {
        const issues = Array.isArray(item.audit && item.audit.issues) ? item.audit.issues : [];
        const issue = issues.find(candidate => {
          const key = `${text(candidate && candidate.category)}|${text(candidate && candidate.quote)}|${text(candidate && candidate.problem)}`;
          return candidate && candidate.status === 'verified' && text(candidate.issueId) &&
            text(candidate.quote).trim().length >= 6 && !attempted.has(key);
        });
        if (!issue) break;
        const key = `${text(issue.category)}|${text(issue.quote)}|${text(issue.problem)}`;
        attempted.add(key);
        const replacementWindow = generationV2ReplacementWindow(item.text, issue.quote);
        if (!replacementWindow) continue;
        const response = await client.revise(run.remoteRunId, {
          issueId: String(issue.issueId),
          quote: String(issue.quote),
          replacementWindow,
          replacement: '',
          preservedFacts: [],
          outputHash: String(run.outputHash)
        });
        if (!response || response.ok !== true || !response.run) throw new Error('服务端未确认局部修订结果');
        await applyGenerationV2Snapshot(state, run, item, response.run, response.stages || []);
        appliedCount += 1;
        if (run.serverState !== 'waiting_author') break;
      }
      if (!appliedCount) {
        toast('当前服务端审计没有可唯一定位的已验证原文证据');
        return false;
      }
      item.status = run.serverState === 'waiting_author' ? 'ready' : generationV2Status(run.serverState).itemStatus;
      item.workflowStage = generationV2Status(run.serverState).workflowStage;
      item.errorNotice = run.serverState === 'needs_human' ? '修订后仍需人工复核；正文已保留。' : '';
      writeWorkspace('editor-chat', records);
      renderEditorChat();
      toast(run.serverState === 'waiting_author' ? `服务端局部修订并复审完成（${appliedCount} 轮）` : '服务端修订需要人工复核，正文已保留');
      return run.serverState === 'waiting_author';
    } catch (error) {
      item.status = 'unknown';
      item.workflowStage = 'unknown';
      item.errorNotice = `修订结果尚未确认；稿件与 Run 已保留，请先查询状态。${text(error && error.message || '')}`;
      run.status = 'unknown';
      run.lastServerMessage = text(error && error.message || '服务端修订响应未确认');
      persistGenerationRun(state, run);
      writeWorkspace('editor-chat', records);
      renderEditorChat();
      toast(run.lastServerMessage);
      return false;
    } finally {
      if (runtime.activeGenerationRun === run) {
        runtime.activeGenerationRun = null;
        runtime.activeGenerationState = null;
      }
      runtime.editorBusy = false;
      runtime.editorGenerationCancelPending = false;
      renderGenerationControl();
    }
  }

  function setEditorThinking(node, message) {
    if (node) node.textContent = message;
  }

  function renderGenerationControl() {
    const stageNode = getStage();
    const send = stageNode && stageNode.querySelector('[data-completion-action="ai-send"]');
    const stop = stageNode && stageNode.querySelector('[data-completion-action="ai-stop"]');
    const busy = runtime.editorBusy === true;
    if (send) {
      send.hidden = busy;
      send.disabled = busy;
    }
    if (stop) {
      stop.hidden = !busy;
      const generationV2 = Boolean(runtime.activeGenerationRun && runtime.activeGenerationRun.generationV2);
      stop.disabled = !busy || generationV2 && runtime.editorGenerationCancelPending;
      stop.setAttribute('aria-label', generationV2 ? '取消生成' : '暂停生成');
      stop.title = generationV2 ? '取消生成' : '暂停生成';
      stop.innerHTML = ico(generationV2 ? 'x' : 'pause');
    }
  }

  function beginGenerationRequest(controller) {
    runtime.activeRequestController = controller || null;
    if (runtime.generationPauseRequested && controller && typeof controller.abort === 'function') {
      try { controller.abort(); } catch (_) {}
    }
    renderGenerationControl();
  }

  function finishGenerationRequest(controller) {
    if (controller && runtime.activeRequestController === controller) runtime.activeRequestController = null;
    renderGenerationControl();
  }

  function trackedGenerationOptions(options) {
    const requestOptions = { ...(options || {}) };
    const onStart = requestOptions.onStart;
    const onFinish = requestOptions.onFinish;
    requestOptions.onStart = controller => {
      beginGenerationRequest(controller);
      if (typeof onStart === 'function') onStart(controller);
    };
    requestOptions.onFinish = controller => {
      finishGenerationRequest(controller);
      if (typeof onFinish === 'function') onFinish(controller);
    };
    return requestOptions;
  }

  function pausedGenerationError(partialText) {
    const error = new Error('AI 生成已暂停');
    error.code = 'GENERATION_PAUSED';
    error.partialText = text(partialText);
    return error;
  }

  function ensureGenerationActive(partialText) {
    if (runtime.generationPauseRequested) throw pausedGenerationError(partialText);
  }

  function pauseEditorAI() {
    if (!runtime.editorBusy) return;
    if (runtime.activeGenerationRun && runtime.activeGenerationRun.generationV2) {
      void cancelActiveGenerationV2();
      return;
    }
    runtime.generationPauseRequested = true;
    const controller = runtime.activeRequestController;
    if (controller && typeof controller.abort === 'function') {
      try { controller.abort(); } catch (_) {}
    }
    setEditorThinking(getStage() && getStage().querySelector('[data-completion-thinking]'), '正在暂停生成…');
    renderGenerationControl();
  }

  async function cancelActiveGenerationV2() {
    const run = runtime.activeGenerationRun;
    if (!run || !run.generationV2) return;
    runtime.editorGenerationCancelPending = true;
    runtime.editorGenerationCancelRequested = true;
    const thinking = getStage() && getStage().querySelector('[data-completion-thinking]');
    if (thinking) setEditorThinking(thinking, '正在请求取消任务…');
    renderGenerationControl();
    if (!run.remoteRunId) {
      run.lastServerMessage = '已请求取消；尚未创建服务端任务。';
      return;
    }
    try {
      const client = await generationRunsClient();
      let snapshot;
      try {
        snapshot = await client.cancel(run.remoteRunId);
      } catch (error) {
        if (error && error.code === 'generation_v2_disabled') throw error;
        snapshot = await client.get(run.remoteRunId);
      }
      await applyGenerationV2Snapshot(runtime.activeGenerationState || editorState(false), run, null, snapshot.run || snapshot, snapshot.stages || []);
      if (thinking) setEditorThinking(thinking, run.serverState === 'cancelled' ? '任务已取消' : '已请求取消，正在等待服务端确认…');
      toast(run.serverState === 'cancelled' ? '生成已取消' : '已向服务端请求取消');
    } catch (error) {
      if (thinking) setEditorThinking(thinking, '取消结果未确认，正在查询任务状态…');
      try {
        const client = await generationRunsClient();
        const snapshot = await client.get(run.remoteRunId);
        await applyGenerationV2Snapshot(runtime.activeGenerationState || editorState(false), run, null, snapshot.run || snapshot, snapshot.stages || []);
      } catch (_) {
        toast('取消结果尚未确认；任务不会自动重新生成。');
      }
    } finally {
      runtime.editorGenerationCancelPending = false;
      renderGenerationControl();
    }
  }

  function persistGenerationRun(state, run) {
    state.generationRuns = Array.isArray(state.generationRuns) ? state.generationRuns : [];
    const index = state.generationRuns.findIndex(item => item && item.id === run.id);
    if (index >= 0) state.generationRuns[index] = run;
    else state.generationRuns.unshift(run);
    state.generationRuns = state.generationRuns.slice(0, 30);
    if (run.generationV2) {
      const novelId = completionNovelKey(state);
      const projections = readWorkspace('generation-run-projection', []).filter(item =>
        item && !(item.novelId === novelId && item.run && item.run.id === run.id));
      projections.unshift({ novelId, updatedAt: Date.now(), run: cloneValue(run) });
      writeWorkspace('generation-run-projection', projections.slice(0, 30));
      return;
    }
    scheduleSave({ snapshot: false });
  }

  function isBodyTask(prompt) {
    const t = text(prompt).trim();
    if (!t) return false;
    if (/^(解释|什么是|定义|如何设定|帮我想个名字|取名|起名|这本小说|总结上一章|总结前文|查询|查一下|找一下)/.test(t)) return false;
    if (/(正文|续写|继续写|接着写|写下去|扩写|补写|改写正文|重写正文|写一段|场景|幕[一二三四五六七八九十0-9]|大纲|细化|本章|章节|剧幕|剧情|情节|冲突|对话|描写|开篇|高潮|转折|结局|故事)/.test(t)) return true;
    if (t.includes('\n') || /[：:].*?[，。]/.test(t)) return true;
    if (t.length >= 35 && !/[？?]$/.test(t)) return true;
    return false;
  }

  /** Identify prose-oriented assistant requests that can benefit from character material. */
  function isCharacterMaterialTask(prompt) {
    return /(正文|续写|改写|重写|扩写|补写|写一段|描写|外貌|神态|动作|心理|对白|口头禅|润色)/.test(text(prompt)) || isBodyTask(prompt);
  }

  async function runChapterWorkflow({ state, prompt, stageNode, records, assistantIndex, target, context }) {
    const current = context.current;
    if (!current.chapter) throw new Error('当前没有可执行的章节');
    ensureGenerationActive();
    const run = {
      id: uid('generation-run'),
      chapterId: current.chapter && current.chapter.id || '',
      sceneId: current.scene && current.scene.id || '',
      chapterTitle: current.chapter && current.chapter.title || '',
      sceneName: current.scene && current.scene.name || '',
      prompt,
      createdAt: Date.now(),
      status: 'planning',
      context: cloneValue({ previous: context.previous, next: context.next, body: context.body, entities: context.entities, outline: context.outline, foreshadows: context.foreshadows, history: context.history, canonSnapshot: context.canonSnapshot, creationBible: context.creationBible, creationPlan: context.creationPlan, dossier: context.dossier }),
      sourceExtraction: null,
      contract: null,
      draft: '',
      audit: null,
      revised: false,
      usage: {}
    };
    runtime.activeGenerationRun = run;
    runtime.activeGenerationState = state;
    state.generationRuns.unshift(run);
    state.generationRuns = state.generationRuns.slice(0, 30);
    records[assistantIndex].workflowStage = 'planning';
    records[assistantIndex].workflowRunId = run.id;
    renderEditorChat();
    persistGenerationRun(state, run);

    records[assistantIndex].workflowStage = 'extracting';
    records[assistantIndex].text = '正在从当前小说已有内容抽取事实并补齐章节合同…';
    renderEditorChat();
    const extraction = await requestExistingContentExtraction({ state, context, prompt, stageNode });
    ensureGenerationActive(records[assistantIndex].text);
    context.canonSnapshot = extraction.canon;
    context.extractedContract = extraction.contract;
    state.editorCanonSnapshot = cloneValue(extraction.canon);
    run.sourceExtraction = { canon: cloneValue(extraction.canon), contract: cloneValue(extraction.contract), sourceLength: extraction.sourceLength, extractedAt: extraction.canon.extractedAt };
    run.usage.extraction = extraction.usage || null;
    run.context = cloneValue({ previous: context.previous, next: context.next, body: context.body, entities: context.entities, outline: context.outline, foreshadows: context.foreshadows, history: context.history, canonSnapshot: context.canonSnapshot, creationBible: context.creationBible, creationPlan: context.creationPlan, dossier: context.dossier });
    records[assistantIndex].workflowStage = 'planning';
    records[assistantIndex].text = '已有内容抽取完成，正在使用 Canon 快照建立章节执行卡…';
    renderEditorChat();
    scheduleSave({ snapshot: false });

    const canonJson = context.canonSnapshot ? JSON.stringify(context.canonSnapshot) : '';
    const contextText = `当前章节：${current.chapter ? current.chapter.title : '未选择'} · 当前场景：${current.scene ? current.scene.name : '未选择'}\n当前章节大纲：${clipContextText(context.outline || '暂无', 1500)}\n上一章结尾：${context.previous ? clipContextText(`${context.previous.title}\n${context.previous.ending || '暂无'}`, 1200) : '暂无'}\n下一章接口参考：${context.next ? clipContextText(`${context.next.title}\n${context.next.outline || '暂无'}`, 800) : '暂无'}\n相关设定：\n${clipContextText(context.entities || '暂无', 2500)}\n作品资料中心（定位、专项素材，只读引用）：\n${clipContextText(context.dossier || '暂无', 2500)}\n未回收伏笔：\n${clipContextText(context.foreshadows || '暂无', 1000)}\n历史版本快照：\n${(context.history || []).slice(-3).map(item => `${item.chapter || ''}/${item.scene || ''}：${clipContextText(item.text, 400)}`).join('\n') || '暂无'}\n抽取后的 Canon（只读事实）：\n${clipContextText(canonJson, 3000) || '暂无'}\n创作圣经（只读事实）：\n${clipContextText(context.creationBible || '当前作品未接入创作圣经，使用已有内容抽取结果', 2500)}\n风格工坊（量化指标/模板/避雷，写作时遵循）：\n${clipContextText(context.styleKit || '暂无', 1000)}\n全局规则与长线伏笔（只读，违反即连续性错误）：\n${clipContextText(context.globalLedger || '暂无', 1200)}\n全书事实账本（按出场对象检索的历史事实，与近章冲突时须核对）：\n${clipContextText(context.factLedger || '暂无', 1500)}\n当前正文（仅用于衔接）：\n${clipContextText(context.body || '暂无正文', 1500)}`;

    if (!state.creationBookId && state.id && typeof getBackend === 'function' && getBackend() && getBackend().token) {
      try {
        const bookTitle = text(state.title || '未命名小说');
        const bookGenre = text(state.genre || state.genreRoute || '通用');
        const bookPlan = text(state.outline && state.outline.oneLine || prompt || '');
        const creationData = await creationRequest('/api/creation-books', {
          method: 'POST',
          body: {
            title: bookTitle,
            genre: bookGenre,
            plan: bookPlan,
            novelId: String(state.id),
            generated: true
          }
        });
        if (creationData && (creationData.creationBookId || (creationData.creationBook && creationData.creationBook.id))) {
          state.creationBookId = creationData.creationBookId || creationData.creationBook.id;
          state.creationBookLinked = true;
          scheduleSave({ snapshot: false });
        }
      } catch (_) {}
    }
    let contract;
    if (state.creationBookId) {
      ensureGenerationActive(records[assistantIndex].text);
      const contractResult = await creationRequest(`/api/creation-books/${encodeURIComponent(state.creationBookId)}/chapter-contract`, trackedGenerationOptions({ method: 'POST', body: { chapterNo: creationChapterNo(state, current.chapter && current.chapter.id), previousEnding: context.previous && context.previous.ending || '', prompt, modelId: (stageNode.querySelector('[data-completion-model]') || {}).value || undefined } }));
      if (!contractResult || contractResult.ok === false || !contractResult.contract) throw new Error(contractResult && contractResult.error || '创作书章节合同生成失败');
      contract = mergeContractWithExtraction(contractResult.contract, extraction.contract, context, prompt);
      run.usage.planning = contractResult.usage || null;
    } else {
      contract = mergeContractWithExtraction(context.contract, extraction.contract, context, prompt);
    }
    if (!current.chapter) throw new Error('当前没有可执行的章节');
    state.chapterContracts[current.chapter.id] = contract;
    run.contract = cloneValue(contract);
    run.status = 'drafting';
    records[assistantIndex].workflowStage = 'drafting';
    renderEditorChat();
    persistGenerationRun(state, run);

    // ★ 范文对位：起草前按（题材/场景类型）检索本地范文样本，注入风格基准
    records[assistantIndex].text = '正在检索同题材范文基准…';
    renderEditorChat();
    const stylePack = await fetchStylePack(state, [prompt, JSON.stringify(contract || {}), String(context.outline || '').slice(0, 8000)].join('\n'), (stageNode.querySelector('[data-completion-model]') || {}).value || undefined);
    if (stylePack?.xuanhuan) { run.scenePlan = stylePack.scenePlan; run.usage.scenePlanning = stylePack.usage; }
    const styleAlignmentBlock = buildStyleAlignmentBlock(stylePack);
    // ★ G0 因果债务注入：从服务端读取本书未兑现的承诺/代价账本（≤1800 字），作为只读区块进入起草上下文。
    let causalDebtBlock = '';
    if (state.creationBookId) {
      try {
        const debtChapterNo = creationChapterNo(state, current.chapter && current.chapter.id);
        const debtResult = await creationRequest(`/api/creation-books/${encodeURIComponent(state.creationBookId)}/debts?chapterNo=${encodeURIComponent(debtChapterNo)}`, trackedGenerationOptions({ method: 'GET' }));
        if (debtResult && debtResult.ok && debtResult.block) { causalDebtBlock = String(debtResult.block); run.causalDebts = { active: (debtResult.active || []).length, matured: (debtResult.matured || []).length }; }
      } catch (_) { /* 债务账本不可用时静默降级 */ }
    }
    const bibleTargetWords = Number(state.creationContext?.bible?.payload?.taskConstraints?.chapterWordTarget);
    const creationBookTarget = state.creationBookId
      ? (Number.isFinite(bibleTargetWords) && bibleTargetWords > 0 ? bibleTargetWords : 2000)
      : undefined;
    const fallbackTarget = creationBookTarget || (contract && (contract.targetWords || contract.wordTarget)) || 2000;
    const userBudget = typeof parseEditorWordBudget === 'function'
      ? parseEditorWordBudget(prompt, {
          targetWords: creationBookTarget || (contract && (contract.targetWords || contract.wordTarget))
        })
      : {
          target: fallbackTarget,
          min: Math.round(fallbackTarget * 0.85),
          max: Math.round(fallbackTarget * 1.15),
          summary: `目标篇幅约 ${fallbackTarget} 字`
        };
    const draftTargetChars = userBudget.target;
    run.targetWords = draftTargetChars;
    run.wordBudget = userBudget;
    run.modelId = (stageNode.querySelector('[data-completion-model]') || {}).value || undefined;

    // ★ 题材基线：服务端按题材返回节奏目标块与题材族，起草硬指令据此分层（lib/genre-rule-scope）。
    const editorGenre = resolveEditorGenre(state, stylePack, prompt);
    let baselinePack = null;
    try {
      const backend = refFunction('backendRequest');
      if (backend) baselinePack = await backend('/api/benchmark/baseline?' + new URLSearchParams({ genre: editorGenre }).toString());
    } catch (_) { baselinePack = null; }
    const genreFamily = (baselinePack && baselinePack.family) || 'unknown';
    run.genre = editorGenre;
    run.genreFamily = genreFamily;
    const styleBaseline = baselinePack && baselinePack.baseline || stylePack && stylePack.baseline || null;
    run.assetStatus = {
      sourceCorpus: stylePack && stylePack.sourceCorpusStatus || { available: false, reason: 'status_unavailable' },
      reviewedRoute: stylePack && stylePack.referenceStatus || 'not_reported',
      genreEvidence: baselinePack && baselinePack.runtime && baselinePack.runtime.status || 'not_reported',
      styleBaseline: styleBaseline ? 'pending' : 'unavailable'
    };
    const baseWritingDirectives = buildScopedWritingDirectives(genreFamily);
    const stagePlanBlock = buildStagePlanText(contract);
    const baselineTargetBlock = [baselinePack && baselinePack.targetBlock || '', baselinePack && baselinePack.runtime && baselinePack.runtime.writingBlock || ''].filter(Boolean).join('\n');
    // ★ 注入预算制（字数近似 token）：范文 ≤1500 字、演绎简报 ≤1200 字、题材规则 ≤900 字、局面合同 ≤1200 字，超预算按优先级裁剪。
    const budgeted = {
      style: clipContextText(styleAlignmentBlock, 1500),
      perf: clipContextText(context.characterPerfBrief || '', 1200),
      genreRules: baselineTargetBlock,
      stagePlan: stagePlanBlock,
      debts: causalDebtBlock
    };
    run.injection = { genre: editorGenre, genreFamily, styleChars: budgeted.style.length, perfBriefChars: budgeted.perf.length, genreRuleChars: budgeted.genreRules.length, stagePlanChars: budgeted.stagePlan.length, debtChars: budgeted.debts.length, contextChars: contextText.length, directiveCount: (baseWritingDirectives.match(/\n\d+\. /g) || []).length };

    const genreOverlay = (stylePack && stylePack.writingSystem)
      ? `\n\n【题材专项驱动与名家机理层】\n${stylePack.writingSystem}`
      : '';

    let writingSystem = `${baseWritingDirectives}${genreOverlay}

${DYNAMIC_CONTEXT_MARKER}

章节执行卡：
${JSON.stringify(contract, null, 2)}
${budgeted.stagePlan ? '\n【局面变化合同（本章只读约束）】\n' + budgeted.stagePlan + '\n' : ''}
${contextText}${budgeted.genreRules ? '\n\n' + budgeted.genreRules : ''}${budgeted.style ? '\n\n' + budgeted.style : ''}${budgeted.perf ? '\n\n【人物演绎指南】\n' + budgeted.perf : ''}${budgeted.debts ? '\n\n' + budgeted.debts : ''}

【篇幅】${userBudget.summary}；写完自检字数，超出先删过渡句与重复状态描写。`;
    ensureGenerationActive(records[assistantIndex].text);
    if (writingSystem.length + prompt.length > 28000) {
      writingSystem = writingSystem.replace(/历史版本快照：[\s\S]*?(?=\n抽取后的 Canon)/, '历史版本快照：暂无\n');
    }
    if (writingSystem.length + prompt.length > 28000) {
      writingSystem = writingSystem.replace(/作品资料中心（定位、专项素材，只读引用）：[\s\S]*?(?=\n未回收伏笔)/, '作品资料中心：已按预算精简\n');
    }
    if (writingSystem.length + prompt.length > 32000) throw new Error('章节上下文超过预算，请缩小历史范围或整理账本；未静默删除关键设定。');
    const reasoningControl = stageNode.querySelector('[data-completion-thinking-control]');
    const scopedLedger = scopeFactLedger(state.factLedger, (context.characters || []).map(item => item && item.name));
    const creationCharacters = state.creationContext && state.creationContext.bible && state.creationContext.bible.payload &&
      Array.isArray(state.creationContext.bible.payload.characters) ? state.creationContext.bible.payload.characters : [];
    const requestCharacters = (context.characters || []).slice(0, 16).map(character => {
      const entity = state.knowledge && state.knowledge.entities && state.knowledge.entities[character.id] || {};
      const bibleCharacter = creationCharacters.find(item => item && String(item.name || '') === String(character.name || ''));
      const sourceVoice = character.voice_contract || character.voiceContract || character.voice ||
        entity.voice_contract || entity.voiceContract || entity.voice ||
        bibleCharacter && (bibleCharacter.voice_contract || bibleCharacter.voiceContract || bibleCharacter.voice) ||
        ((entity.turnLengthPref || entity.turn_length_pref || entity.styleHabits || entity.tabooWords)
          ? entity
          : (bibleCharacter && (bibleCharacter.turnLengthPref || bibleCharacter.styleHabits || bibleCharacter.tabooWords) ? bibleCharacter : null));
      const voice = sourceVoice && typeof sourceVoice === 'object' && !Array.isArray(sourceVoice)
        ? sourceVoice
        : sourceVoice ? { styleHabits: [sourceVoice] } : {};
      const firstList = (...values) => values.find(value => Array.isArray(value) ? value.length > 0 : value != null && String(value).trim()) || [];
      return {
        ...character,
        voice_contract: {
          ...voice,
          turnLengthPref: voice.turnLengthPref || voice.turn_length_pref || voice.sentenceLengthPreference || voice.sentence_length_preference || 'medium_long',
          styleHabits: firstList(voice.styleHabits, voice.style_habits, voice.verbalHabits, voice.verbal_habits, voice.habits, voice.habit),
          tabooWords: firstList(voice.tabooWords, voice.taboo_words, voice.tabooPhrases, voice.taboo_phrases, voice.taboos, voice.taboo)
        }
      };
    });
    const draftResult = await creationRequest('/api/benchmark/generate', trackedGenerationOptions({ method: 'POST', body: {
      requestId: run.id, prompt, writingSystem, genre: editorGenre, targetWords: draftTargetChars, contract,
      novelId: state.id || '', creationBookId: state.creationBookId || '',
      modelId: (stageNode.querySelector('[data-completion-model]') || {}).value || undefined,
      reasoningEffort: reasoningControl && reasoningControl.dataset.mode === 'reasoning' ? reasoningControl.value : undefined,
      characters: requestCharacters, factLedger: scopedLedger || null, previousEnding: context.previous && context.previous.ending || '', maxRounds: 2
    } }));
    const draftRaw = text(draftResult && draftResult.text);
    const draft = typeof sanitizeAiFlavor === 'function' ? sanitizeAiFlavor(draftRaw) : draftRaw;
    run.usage.generation = draftResult && draftResult.usage || null;
    run.calls = cloneValue(draftResult && draftResult.calls || []);
    run.candidates = cloneValue(draftResult && draftResult.candidates || []);
    run.rounds = cloneValue(draftResult && draftResult.rounds || []);
    run.revised = run.rounds.some(round => round.accepted === true);
    run.humanReviewStatus = draftResult && draftResult.humanReviewStatus || 'pending';
    run.generationStatus = draftResult && draftResult.status || 'needs_review';
    run.draft = draft;
    run.finalText = draft;
    run.resultContentHash = await hashText(draft);
    if (!draft.trim()) {
      const reasons = draftResult && draftResult.audit && Array.isArray(draftResult.audit.incompleteReasons) ? draftResult.audit.incompleteReasons.join(', ') : '';
      throw new Error('正文阶段未返回可用内容' + (reasons ? `（${reasons}）` : ''));
    }
    run.status = 'auditing';
    records[assistantIndex].text = draft;
    records[assistantIndex].workflowStage = 'auditing';
    records[assistantIndex].status = 'in_progress';
    records[assistantIndex].workflowRunId = run.id;
    renderEditorChat();
    persistGenerationRun(state, run);

    let passed = await bindRunAudit(run, draftResult && draftResult.audit, draft);
    passed = passed && draftResult.ok !== false && draftResult.status === 'passed' &&
      !!draftResult.usage && draftResult.usage.complete !== false &&
      run.calls.every(call => call && call.status === 'completed');
    if (state.creationBookId) {
      ensureGenerationActive(draft);
      const creationPassed = await requestFinalContentAudit(state, run, draft, stageNode);
      passed = creationPassed && passed;
    }
    let checks;
    try {
      checks = await creationRequest('/api/genre-lab/inspect', trackedGenerationOptions({ method: 'POST', body: { text: draft, genre: editorGenre } }));
    } catch (error) {
      checks = {
        available: false,
        passed: false,
        status: 'incomplete',
        reason: 'inspection_unavailable',
        message: text(error && error.message || '题材原文重合检查服务不可用')
      };
    }
    const sourceCheckPassed = checks && checks.available === true && checks.status === 'passed' && checks.passed === true;
    const sourceCheck = checks && typeof checks === 'object'
      ? {
        ...checks,
        available: checks.available === true,
        passed: sourceCheckPassed,
        status: sourceCheckPassed ? 'passed' : checks.status === 'incomplete' || checks.available !== true ? 'incomplete' : 'needs_review'
      }
      : { available: false, passed: false, status: 'incomplete', reason: 'invalid_inspection_response' };
    run.sourceOverlapCheck = sourceCheck;
    if (run.assetStatus) {
      run.assetStatus.sourceCorpus = {
        available: sourceCheck.available,
        reason: sourceCheck.reason || '',
        sceneCount: Number(sourceCheck.sceneCount) || 0
      };
    }
    if (!sourceCheckPassed) {
      passed = false;
      const message = sourceCheck.message
        ? `题材原文重合检查未完成：${sourceCheck.message}；正文已保留，需人工复核`
        : sourceCheck.reason === 'source_corpus_unavailable'
          ? '题材原文语料不可用，重合检查未执行；正文已保留，需人工复核'
          : sourceCheck.status === 'incomplete'
            ? '题材原文重合检查未完成，正文已保留，需人工复核'
            : '正文与题材原文重合检查未通过，需人工复核';
      markRunNeedsReview(run, message);
    }
    try { run.styleDistance = computeStyleDistance(computeTextFingerprint(draft), styleBaseline); } catch (_) { run.styleDistance = null; }
    run.assetStatus.styleBaseline = run.styleDistance ? 'ready' : styleBaseline ? 'no_usable_metrics' : 'unavailable';
    if (passed) run.status = 'awaiting_confirmation';
    else markRunNeedsReview(run, run.audit && !run.audit.passed ? run.audit.summary : '生成或审稿未完整通过，需人工复核');
    toast(passed ? '终稿审计通过，点击「插入正文」确认采纳' : '终稿 needs_review：可查看或复制，不能写入正文');
    run.completedAt = Date.now();
    records[assistantIndex] = { kind: 'assistant', text: draft, resultId: uid('ai-result'), target: cloneValue(target), ...(passed ? { workflowStage: 'ready', status: 'ready' } : { workflowStage: 'needs_review', status: 'needs_review' }), workflowRunId: run.id, audit: cloneValue(run.audit), retryPrompt: prompt };
    runtime.pendingResults.push({ id: records[assistantIndex].resultId, text: draft, createdAt: Date.now() });
    persistGenerationRun(state, run);
    runtime.activeGenerationRun = null;
    runtime.activeGenerationState = null;
    return draft;
  }

  /** 生成服务的局部修订使用固定段落窗口；客户端按同一规则提交证据。 */
  function generationV2ReplacementWindow(sourceText, quote) {
    const source = String(sourceText || '');
    const target = String(quote || '');
    if (!target) return null;
    const first = source.indexOf(target);
    if (first < 0 || source.indexOf(target, first + target.length) >= 0) return null;
    const paragraphs = source.split(/(?<=\n\s*\n)/);
    let offset = 0;
    const index = paragraphs.findIndex(paragraph => {
      const start = offset;
      offset += paragraph.length;
      return first >= start && first < offset;
    });
    if (index < 0) return null;
    return {
      before: paragraphs.slice(Math.max(0, index - 2), index).join(''),
      target,
      after: paragraphs.slice(index + 1, Math.min(paragraphs.length, index + 3)).join('')
    };
  }

  /** 新建或补齐 Generation V2 所需的创作书，并先持久化小说关联。 */
  async function ensureGenerationV2CreationBook(state, prompt) {
    const preview = getPreview();
    const backend = getBackend();
    const novelId = String(preview.novelId || state.id || '');
    if (!state.creationBookId) {
      if (!novelId || !backend.token) throw new Error('Generation V2 正式提交需要已登录的服务器作品和创作书');
      const creationData = await creationRequest('/api/creation-books', {
        method: 'POST',
        body: {
          title: text(state.title || preview.novel && preview.novel.title || '未命名小说'),
          genre: text(state.projectProfile && state.projectProfile.primaryGenre || state.genre || state.type || state.genreRoute || ''),
          plan: text(state.outline && state.outline.oneLine || prompt || ''),
          novelId,
          generated: true
        }
      });
      state.creationBookId = text(creationData && (creationData.creationBookId || creationData.creationBook && creationData.creationBook.id));
      if (!state.creationBookId) throw new Error(creationData && creationData.error || '创作书创建未确认，已停止 Generation V2');
      state.creationBookLinked = true;
      await persistAppliedNovel({ snapshot: false });
    } else if (novelId && !state.creationBookLinked) {
      await creationRequest(`/api/creation-books/${encodeURIComponent(state.creationBookId)}/link-novel`, {
        method: 'POST', body: { novelId }
      });
      state.creationBookLinked = true;
      await persistAppliedNovel({ snapshot: false });
    }
    const context = await hydrateCreationContext(state);
    if (!context || !context.bible || !Number.isInteger(Number(state.creationStateVersion)) ||
      !Number.isInteger(Number(state.creationBibleVersion))) {
      throw new Error('创作书状态或创作圣经未能读取，Generation V2 尚不能安全提交');
    }
    return context;
  }

  /** 通过服务端 Generation Run 执行正式正文生成并观察可恢复状态。 */
  async function runChapterWorkflowV2({ state, prompt, stageNode, records, assistantIndex, target, context, capabilities }) {
    const current = context.current;
    const chapter = current && current.chapter;
    const scene = current && current.scene;
    if (!chapter || !scene) throw new Error('Generation V2 需要明确的当前章节和场景');
    await ensureGenerationV2CreationBook(state, prompt);
    context = currentContext(state);
    const preview = getPreview();
    const projectId = String(preview.novelId || state.id || '');
    const expectedRevision = Number(preview.novelRevision);
    const baseStateVersion = Number(state.creationStateVersion);
    const baseBibleVersion = Number(state.creationBibleVersion);
    if (!projectId || !Number.isInteger(expectedRevision) || expectedRevision < 0 ||
      !Number.isInteger(baseStateVersion) || baseStateVersion < 0 ||
      !Number.isInteger(baseBibleVersion) || baseBibleVersion < 1) {
      throw new Error('Generation V2 缺少有效的作品 revision、故事状态或创作圣经版本');
    }
    const baseContent = String(scene.content == null ? '' : scene.content);
    const baseHash = await hashText(baseContent);
    if (!/^[a-f0-9]{64}$/i.test(baseHash)) throw new Error('当前环境不能计算 SHA-256，已停止 Generation V2');
    const modelId = text((stageNode.querySelector('[data-completion-model]') || {}).value || getPreview().editorModel || '');
    const contract = context.contract || state.chapterContracts && state.chapterContracts[chapter.id] || null;
    const storyContext = {
      stateVersion: baseStateVersion,
      baseStateVersion,
      baseRevision: expectedRevision,
      baseHash,
      contentHash: baseHash,
      previousEnding: text(context.previous && context.previous.ending || ''),
      planText: clipContextText(context.outline || '', 3000),
      factLedger: cloneValue(state.factLedger || null),
      characters: cloneValue(context.characters || []),
      continuity: {
        chapterTitle: text(chapter.title),
        sceneName: text(scene.name),
        currentBody: clipContextText(plainText(baseContent), 9000),
        outline: clipContextText(context.outline || '', 3000),
        nextChapter: context.next ? { title: text(context.next.title), outline: clipContextText(context.next.outline || '', 1600) } : null,
        entities: clipContextText(context.entities || '', 5000),
        openForeshadows: clipContextText(context.foreshadows || '', 2500),
        dossier: clipContextText(context.dossier || '', 5000),
        canonSnapshot: cloneValue(context.canonSnapshot || null),
        creationBible: clipContextText(context.creationBible || '', 9000),
        styleKit: clipContextText(context.styleKit || '', 2500),
        globalLedger: clipContextText(context.globalLedger || '', 3000),
        history: cloneValue((context.history || []).slice(-4))
      }
    };
    const targetWords = Number(state.creationContext && state.creationContext.bible &&
      state.creationContext.bible.payload && state.creationContext.bible.payload.taskConstraints &&
      state.creationContext.bible.payload.taskConstraints.chapterWordTarget) ||
      Number(contract && (contract.targetWords || contract.wordTarget)) || 0;
    const requestPayload = {
      projectId,
      novelId: projectId,
      creationBookId: String(state.creationBookId),
      chapterId: String(chapter.id),
      sceneId: String(scene.id),
      modelId: modelId || undefined,
      genre: text(state.projectProfile && state.projectProfile.primaryGenre || state.genre || state.type || state.genreRoute || ''),
      style: text(state.stylePreset || state.settings && (state.settings.stylePreset || state.settings.style) || ''),
      userInstruction: prompt,
      prompt,
      messages: [{ role: 'user', content: prompt }],
      contract: contract ? cloneValue(contract) : undefined,
      chapterContract: contract ? cloneValue(contract) : undefined,
      storyContext,
      factLedger: cloneValue(state.factLedger || null),
      previousEnding: storyContext.previousEnding,
      planText: storyContext.planText,
      characters: cloneValue(context.characters || []),
      targetWords,
      writingSystem: clipContextText([context.styleKit || '', context.globalLedger || ''].filter(Boolean).join('\n\n'), 12000)
    };
    const idempotencyKey = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID() : uid('generation-idempotency');
    const run = {
      id: uid('generation-run'), generationV2: true, idempotencyKey,
      projectId,
      chapterId: String(chapter.id), sceneId: String(scene.id), chapterTitle: text(chapter.title), sceneName: text(scene.name),
      prompt, createdAt: Date.now(), status: 'creating', serverState: 'created',
      commitBase: { expectedRevision, baseStateVersion, baseBibleVersion, baseHash, chapterNo: creationChapterNo(state, chapter.id) },
      createRequest: requestPayload, context: cloneValue({ outline: context.outline, previous: context.previous, next: context.next })
    };
    runtime.activeGenerationRun = run;
    runtime.activeGenerationState = state;
    persistGenerationRun(state, run);
    records[assistantIndex].workflowStage = 'planning';
    records[assistantIndex].workflowRunId = run.id;
    records[assistantIndex].generationV2 = true;
    records[assistantIndex].idempotencyKey = idempotencyKey;
    records[assistantIndex].status = 'in_progress';
    records[assistantIndex].text = '正在创建服务端生成任务…';
    writeWorkspace('editor-chat', records);
    renderEditorChat();

    let created;
    try {
      created = await (await generationRunsClient()).create(requestPayload, idempotencyKey);
    } catch (error) {
      const rejected = error && error.status >= 400 && error.status < 500 && error.status !== 408;
      run.status = rejected ? 'failed' : 'unknown';
      run.serverState = rejected ? 'failed' : 'unknown';
      run.errorCode = text(error && error.code || '');
      run.lastServerMessage = text(error && error.message || '创建任务响应未确认');
      if (rejected) run.createRequest = null;
      records[assistantIndex].status = rejected ? 'failed' : 'unknown';
      records[assistantIndex].workflowStage = rejected ? 'failed' : 'unknown';
      records[assistantIndex].errorNotice = rejected
        ? run.lastServerMessage
        : '创建结果尚未确认；任务请求和 Idempotency-Key 已保留，不会切换到旧生成链。';
      records[assistantIndex].text = rejected ? `生成未完成：${run.lastServerMessage}` : '正在确认服务端生成任务状态…';
      persistGenerationRun(state, run);
      writeWorkspace('editor-chat', records);
      throw error;
    }
    const remote = created && created.run;
    if (!created || created.ok !== true || !remote || !remote.id) {
      run.status = 'unknown';
      run.serverState = 'unknown';
      run.lastServerMessage = '服务端未返回可验证的 Generation Run 编号';
      records[assistantIndex].status = 'unknown';
      records[assistantIndex].workflowStage = 'unknown';
      records[assistantIndex].errorNotice = `${run.lastServerMessage}；任务请求和 Idempotency-Key 已保留，不会切换到旧生成链。`;
      records[assistantIndex].text = '正在确认服务端生成任务状态…';
      persistGenerationRun(state, run);
      writeWorkspace('editor-chat', records);
      throw new Error(run.lastServerMessage);
    }
    run.remoteRunId = String(remote.id);
    run.serverState = text(remote.state || 'created');
    run.createRequest = null;
    run.status = run.serverState;
    records[assistantIndex].remoteRunId = run.remoteRunId;
    records[assistantIndex].serverState = run.serverState;
    records[assistantIndex].idempotencyKey = idempotencyKey;
    persistGenerationRun(state, run);
    await applyGenerationV2Snapshot(state, run, records[assistantIndex], remote, []);
    writeWorkspace('editor-chat', records);
    await observeGenerationRun(state, run, records[assistantIndex], { capabilities, ownBusy: true });
    return run.finalText || '';
  }

  async function sendEditorAI() {
    const overridePrompt = arguments[0];
    const options = arguments[1];
    if (runtime.editorBusy || runtime.aiApplyBusy) return;
    const stageNode = getStage();
    const input = stageNode && stageNode.querySelector('[data-completion-prompt]');
    const thinking = stageNode && stageNode.querySelector('[data-completion-thinking]');
    const resumeMode = options && typeof options.resumeIndex === 'number';
    const prompt = text(overridePrompt || (input && input.value) || '').trim();
    if (!prompt) { toast('请先描述要完成的创作任务'); input && input.focus(); return; }
    const state = editorState(false);
    if (!state) { toast('请先打开一本作品'); return; }
    const request = refFunction('requestChatText');
    const routeSelect = stageNode && stageNode.querySelector && stageNode.querySelector('[data-completion-xuanhuan-route]');
    const activeRoute = (routeSelect && routeSelect.value) || (state && (state.genreRoute || state.xuanhuanRoute)) || 'auto';
    if (state) state.genreRoute = activeRoute;
    const preview = getPreview();
    const target = completionTarget(state, preview.editorChatSessionId);
    let records = chatRecords();
    let targetIndex;
    if (resumeMode && options.resumeIndex >= 0 && options.resumeIndex < records.length && records[options.resumeIndex]?.kind === 'assistant') {
      targetIndex = options.resumeIndex;
      records[targetIndex].text = '正在继续为您生成正文…';
      records[targetIndex].retryPrompt = prompt;
      records[targetIndex].status = 'in_progress';
      records[targetIndex].workflowStage = isBodyTask(prompt) ? 'planning' : '';
      records[targetIndex].errorNotice = '';
      records[targetIndex].resultId = '';
    } else {
      records.push({ kind: 'user', text: prompt });
      persistEditorChatSession();
      records = chatRecords();
      writeWorkspace('editor-chat', records);
      try { sessionStorage.removeItem('molan_editor_prompt_draft'); } catch (_) {}
      if (input) input.value = '';
      records.push({ kind: 'assistant', text: '正在生成…' });
      records[records.length - 1].retryPrompt = prompt;
      records[records.length - 1].status = 'in_progress';
      records[records.length - 1].workflowStage = isBodyTask(prompt) ? 'planning' : '';
      trimCompletionHistory(records);
      const assistantIndex = records.length - 1;
      targetIndex = assistantIndex;
    }
    const assistantIndex = targetIndex;
    runtime.editorBusy = true;
    runtime.activeRequestController = null;
    runtime.generationPauseRequested = false;
    renderGenerationControl();
    if (thinking) {
      thinking.classList.add('visible');
      setEditorThinking(thinking, resumeMode ? '正在继续生成正文…' : '正在建立章节执行卡');
    }
    writeWorkspace('editor-chat', records);
    persistEditorChatSession();
    renderEditorChat();
    try {
      ensureGenerationActive(records[assistantIndex].text);
      const context = currentContext(state);
      if (isBodyTask(prompt)) {
        const capabilities = await generationV2Capabilities();
        const v2Unavailable = !capabilities ||
          capabilities.generationV2 !== true ||
          capabilities.code === 'generation_v2_disabled' ||
          capabilities.disabled === true ||
          capabilities.commit !== true ||
          capabilities.recovery !== true;
        if (v2Unavailable) {
          const blockerNotice = 'Generation V2 正式正文生成能力当前未开启或不可用，已阻断生成；不会回退到旧章节工作流。';
          if (thinking) thinking.classList.remove('visible');
          records[assistantIndex] = {
            kind: 'assistant',
            text: blockerNotice,
            status: 'failed',
            workflowStage: 'failed',
            errorNotice: blockerNotice,
            retryPrompt: ''
          };
          runtime.editorBusy = false;
          renderGenerationControl();
          writeWorkspace('editor-chat', records);
          persistEditorChatSession();
          renderEditorChat();
          toast(blockerNotice);
          return;
        }
        setEditorThinking(thinking, '正在创建服务端生成任务');
        await runChapterWorkflowV2({ state, prompt, stageNode, records, assistantIndex, target, context, capabilities });
      } else {
        if (!request) throw new Error('当前页面未加载 AI 请求接口');
        setEditorThinking(thinking, '正在整理上下文');
         const system = `你是墨阑小说编辑器中的创作助手。必须严格遵守当前作品事实，不得擅自新增人物、地点、势力、物品或伏笔。根据用户任务直接给出可执行结果；如果用户要求正文，输出可以直接进入小说的正文，不要解释。\n\n${DYNAMIC_CONTEXT_MARKER}\n\n当前章节：${context.current.chapter ? context.current.chapter.title : '未选择'} · 当前场景：${context.current.scene ? context.current.scene.name : '未选择'}\n上一章结尾：${context.previous ? clipContextText(context.previous.ending || '暂无', 1000) : '暂无'}\n下一章接口：${context.next ? `${context.next.title}：${clipContextText(context.next.outline || '暂无', 600)}` : '暂无'}\n章节大纲：${clipContextText(context.outline || '暂无', 1500)}\n相关设定：\n${clipContextText(context.entities || '暂无动态召回设定', 2000)}\n作品资料中心（定位、专项素材，只读引用）：\n${clipContextText(context.dossier || '暂无', 2200)}\n创作圣经（只读事实）：\n${clipContextText(context.creationBible || '当前作品未接入创作圣经', 2000)}\n风格工坊（遵循）：\n${clipContextText(context.styleKit || '暂无', 1000)}\n全局规则与长线伏笔（只读）：\n${clipContextText(context.globalLedger || '暂无', 1200)}\n全书事实账本（检索）：\n${clipContextText(context.factLedger || '暂无', 1500)}\n未回收伏笔：\n${clipContextText(context.foreshadows || '暂无', 1000)}\n当前正文（仅用于衔接）：\n${clipContextText(context.body || '暂无正文', 1500)}${context.contract ? `\n\n当前章节执行卡：\n${JSON.stringify(context.contract, null, 2)}` : ''}`;
         const history = records.filter(item => item && item.text).slice(-8).map(item => ({ role: item.kind === 'user' ? 'user' : 'assistant', content: item.text }));
         ensureGenerationActive(records[assistantIndex].text);
         const answer = await request([{ role: 'system', content: system }, ...history, { role: 'user', content: prompt }], editorRequestOptions(stageNode, {
          maxTokens: 1600,
          onDelta: (_delta, fullText) => { records[assistantIndex].text = fullText; renderEditorChat(); }
        }));
        const rawFinal = responseText(answer).trim();
        const finalText = typeof sanitizeAiFlavor === 'function' ? sanitizeAiFlavor(rawFinal) : rawFinal;
        records[assistantIndex] = { kind: 'assistant', text: finalText, resultId: uid('ai-result'), target: cloneValue(target), status: 'ready', retryPrompt: prompt };
        runtime.pendingResults.push({ id: records[assistantIndex].resultId, text: finalText, createdAt: Date.now() });
        toast('AI 结果已生成，请确认写入位置');
      }
    } catch (error) {
      const activeRun = runtime.activeGenerationRun && runtime.activeGenerationState === state ? runtime.activeGenerationRun : null;
      const paused = runtime.generationPauseRequested || error && ['REQUEST_ABORTED', 'GENERATION_PAUSED'].includes(error.code);
      const currentText = text(records[assistantIndex] && records[assistantIndex].text || '');
      const isStatusProgress = (t) => /^(正在|已有内容抽取|当前正由)/.test(t) || t.endsWith('…');
      const isJsonLike = (t) => /^\s*[[{]/.test(t) || /"(canon|chapterContract|characters|relations|relation|identity|factions|worldRules|evidence)"/.test(t);
      const isPrepStage = ['extracting', 'planning', 'preparing'].includes(records[assistantIndex]?.workflowStage) || (activeRun && ['planning', 'extracting'].includes(activeRun.status));
      const rawPartial = text(error && error.partialText || (isStatusProgress(currentText) ? '' : currentText)).trim();
      const isProse = !isPrepStage && !isJsonLike(rawPartial) && rawPartial.length > 0;
      const partialText = isProse ? rawPartial : '';
      if (activeRun && activeRun.generationV2) {
        const item = records[assistantIndex];
        const status = generationV2Status(activeRun.serverState || 'unknown');
        activeRun.status = activeRun.serverState === 'unknown' ? 'unknown' : activeRun.status;
        activeRun.lastServerMessage = text(error && error.message || activeRun.lastServerMessage || '服务端任务状态暂时无法确认');
        if (item) {
          item.generationV2 = true;
          item.workflowRunId = activeRun.id;
          item.remoteRunId = activeRun.remoteRunId || '';
          item.serverState = activeRun.serverState || 'unknown';
          item.status = activeRun.serverState === 'unknown' ? 'unknown' : status.itemStatus;
          item.workflowStage = activeRun.serverState === 'unknown' ? 'unknown' : status.workflowStage;
          item.text = activeRun.finalText || (item.status === 'in_progress' ? activeRun.lastServerMessage : item.text);
          item.audit = cloneValue(activeRun.audit || item.audit || null);
          item.errorNotice = item.status === 'unknown'
            ? '服务端任务状态暂时无法确认；任务编号与稿件已保留，不会自动重新生成。'
            : activeRun.lastServerMessage;
        }
        persistGenerationRun(state, activeRun);
        if (item) writeWorkspace('editor-chat', records);
        toast(activeRun.lastServerMessage);
        if (runtime.activeGenerationRun === activeRun) {
          runtime.activeGenerationRun = null;
          runtime.activeGenerationState = null;
        }
      } else if (paused) {
        if (activeRun) {
          const previousStatus = activeRun.status;
          activeRun.status = 'paused';
          activeRun.pausedFrom = previousStatus;
          activeRun.partialText = partialText;
          activeRun.pausedAt = Date.now();
          persistGenerationRun(state, activeRun);
          runtime.activeGenerationRun = null;
          runtime.activeGenerationState = null;
        }
        records[assistantIndex] = {
          kind: 'assistant',
          text: partialText || '已暂停生成，尚未收到模型内容。',
          workflowStage: 'paused',
          workflowRunId: activeRun && activeRun.id || records[assistantIndex] && records[assistantIndex].workflowRunId || '',
          status: 'paused',
          retryPrompt: prompt
        };
      } else {
        if (activeRun) {
          markRunNeedsReview(activeRun, text(error && error.message || 'AI 请求失败'));
          activeRun.error = text(error && error.message || 'AI 请求失败');
          activeRun.completedAt = Date.now();
          persistGenerationRun(state, activeRun);
          runtime.activeGenerationRun = null;
          runtime.activeGenerationState = null;
        }
        if (partialText) {
          const resultId = uid('ai-result');
          records[assistantIndex] = {
            kind: 'assistant',
            text: partialText,
            resultId,
            target: cloneValue(target),
            workflowStage: 'needs_review',
            workflowRunId: activeRun && activeRun.id || records[assistantIndex] && records[assistantIndex].workflowRunId || '',
            status: 'needs_review',
            audit: activeRun && cloneValue(activeRun.audit) || null,
            retryPrompt: prompt,
            errorNotice: error && error.message || '网络连接中断，已保留当前已生成正文'
          };
          runtime.pendingResults = Array.isArray(runtime.pendingResults) ? runtime.pendingResults : [];
          runtime.pendingResults.push({ id: resultId, text: partialText, createdAt: Date.now() });
          toast(error && error.message || '网络连接中断，已保留当前已生成正文');
        } else {
          const runStatus = activeRun ? 'needs_review' : 'interrupted';
          records[assistantIndex] = {
            kind: 'assistant',
            text: `生成未完成：${error && error.message || '模型连接超时'}（已保留创作任务，点击下方按钮即可继续生成）`,
            workflowStage: runStatus,
            workflowRunId: activeRun && activeRun.id || records[assistantIndex] && records[assistantIndex].workflowRunId || '',
            status: runStatus,
            retryPrompt: prompt,
            errorNotice: error && error.message || '已保留创作任务'
          };
          toast(error && error.message || 'AI 请求失败');
        }
      }
    } finally {
      runtime.editorBusy = false;
      runtime.activeRequestController = null;
      runtime.generationPauseRequested = false;
      renderGenerationControl();
      if (thinking) thinking.classList.remove('visible');
      writeWorkspace('editor-chat', records);
      persistEditorChatSession();
      renderEditorChat();
    }
  }

  function resultAt(index) {
    const records = chatRecords();
    const item = records[Number(index)];
    if (!item) return null;
    if (!item.resultId && item.kind === 'assistant' && item.text && item.status !== 'in_progress') {
      item.resultId = uid('ai-result');
      runtime.pendingResults = Array.isArray(runtime.pendingResults) ? runtime.pendingResults : [];
      if (!runtime.pendingResults.some(r => r && r.id === item.resultId)) {
        runtime.pendingResults.push({ id: item.resultId, text: item.text, createdAt: Date.now() });
      }
    }
    return item && (item.resultId || item.text) ? item : null;
  }

  async function copyAIResult(index) {
    const item = resultAt(index);
    if (!item) { toast('该 AI 结果已不存在'); return; }
    const textToCopy = item.text || '';
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      toast('AI 结果已复制到剪贴板');
    } catch (error) {
      toast('复制失败：' + (error && error.message || '浏览器不支持'));
    }
  }

  function prepareCreationCommit(state, run, scene, body) {
    const generationV2 = Boolean(run && run.generationV2);
    const legacyState = {};
    if (!generationV2) {
      const current = activeRefs(state);
      const data = ensureKnowledge(state);
      const latestSnapshot = state.creationContext && Array.isArray(state.creationContext.snapshots) ? state.creationContext.snapshots[0] : null;
      Object.assign(legacyState, {
        actualCost: generationActualCost(run),
        characterStates: data.entities.slice(0, 80).map(entity => ({ id: entity.id, name: entity.name, status: entity.status, location: entity.currentLocation || '' })),
        relationshipStates: data.edges.slice(0, 120),
        worldStates: state.creationContext && state.creationContext.bible && state.creationContext.bible.payload && state.creationContext.bible.payload.worldRules || [],
        timeline: stateTimeline(state).slice(-120),
        openForeshadows: state.foreshadows.filter(item => item.status !== 'resolved').slice(0, 80),
        recentFacts: [{ chapterNo: creationChapterNo(state, run.chapterId), title: current.chapter && current.chapter.title || '', ending: body.slice(-1000), previousSnapshotId: latestSnapshot && latestSnapshot.id || '' }]
      });
    }
    return cloneValue({
      bookId: state.creationBookId,
      chapterId: run.chapterId,
      sceneId: scene.id,
      createdAt: Date.now(),
      body: {
        chapterNo: creationChapterNo(state, run.chapterId),
        baseStateVersion: Number(state.creationStateVersion) || 0,
        bibleVersion: Number(run.audit.bibleVersion) || 0,
        stateVersion: Number(run.audit.stateVersion) || 0,
        planHash: text(run.audit.planHash),
        contextHash: text(run.audit.contextHash),
        deltaHash: text(run.audit.deltaHash),
        contentHash: run.audit.contentHash,
        content: body,
        contentRef: `${completionNovelKey(state)}#${run.chapterId}#${scene.id}`,
        auditStatus: 'passed',
        ...legacyState
      }
    });
  }

  async function commitCreationChapter(state, item, scene, content) {
    const run = (state.generationRuns || []).find(record => record && record.id === item.workflowRunId);
    const pending = run && run.pendingCommit;
    const generationV2 = Boolean(run && run.generationV2);
    const body = generationV2 ? String(content == null ? '' : content) : plainText(content);
    const contentHash = await hashText(body);
    if (!pending || pending.bookId !== state.creationBookId || pending.chapterId !== run.chapterId ||
      pending.sceneId !== scene.id || !pending.body || pending.body.content !== body ||
      pending.body.contentHash !== contentHash || !normalizeAudit(run.audit).passed ||
      run.audit.contentHash !== contentHash || run.pendingFactLedgerHash !== contentHash ||
      (!generationV2 && scene.content !== content) || editorState(false) !== state ||
      !completionTargetMatches(item.target, state, getPreview().editorChatSessionId)) {
      return { outcome: 'rejected', error: '提交正文与持久化请求或审计 hash 不匹配，不能提交' };
    }
    let result;
    try {
      if (generationV2) {
        if (!run.remoteRunId || !run.commitBase || run.outputHash !== contentHash) {
          return { outcome: 'rejected', code: 'STATE_CONFLICT', error: 'Generation V2 缺少原始 Run、基线或服务端输出 hash，不能提交' };
        }
        const client = await generationRunsClient();
        const snapshot = await client.get(run.remoteRunId);
        const remote = snapshot && snapshot.run;
        if (!remote) return { outcome: 'unknown', error: '服务端未返回可验证的 Generation Run 状态' };
        if (remote.state === 'committed') {
          result = { ok: true, run: remote, receipt: remote.result && remote.result.commitReceipt };
        } else {
          if (remote.state !== 'waiting_author') {
            return { outcome: remote.state === 'committing' ? 'unknown' : 'rejected', code: 'STATE_CONFLICT', error: 'Generation V2 任务当前状态不允许提交' };
          }
          const currentSceneHash = await hashText(String(scene.content == null ? '' : scene.content));
          if (currentSceneHash !== run.commitBase.baseHash ||
            Number(getPreview().novelRevision) !== Number(run.commitBase.expectedRevision)) {
            return { outcome: 'rejected', code: 'STATE_CONFLICT', status: 409, error: '作品或场景已在生成后发生变化，草稿已保留；请重新载入并核对后再操作' };
          }
          const expectedRevision = Number(run.commitBase.expectedRevision);
          const baseStateVersion = Number(run.commitBase.baseStateVersion);
          const commitPayload = {
            creationBookId: pending.bookId,
            projectId: String(getPreview().novelId || state.id || ''),
            chapterId: pending.chapterId,
            sceneId: pending.sceneId,
            chapterNo: Number(pending.body.chapterNo),
            expectedRevision,
            baseStateVersion,
            baseHash: String(run.commitBase.baseHash),
            bibleVersion: Number(run.commitBase.baseBibleVersion),
            stateVersion: baseStateVersion,
            contentHash,
            content: body,
            contentRef: String(pending.body.contentRef || ''),
            planHash: String(pending.body.planHash || ''),
            contextHash: String(pending.body.contextHash || ''),
            deltaHash: String(pending.body.deltaHash || ''),
            auditStatus: 'passed'
          };
          result = await client.commit(run.remoteRunId, {
            projectId: commitPayload.projectId,
            expectedRevision,
            baseStateVersion,
            text: body,
            outputHash: run.outputHash,
            contentRef: commitPayload.contentRef,
            payload: commitPayload
          });
        }
      } else {
        result = await creationRequest(`/api/creation-books/${encodeURIComponent(pending.bookId)}/commit`, { method: 'POST', body: cloneValue(pending.body) });
      }
    } catch (error) {
      const rejected = error && error.status >= 400 && error.status < 500 && error.status !== 408;
      return { outcome: rejected ? 'rejected' : 'unknown', status: Number(error && error.status) || 0, code: error && error.code, error: error && error.message || '提交响应未确认' };
    }
    if (generationV2) {
      const remote = result && result.run;
      const receipt = result && result.receipt || remote && remote.result && remote.result.commitReceipt;
      if (!result || result.ok !== true || !remote || remote.state !== 'committed' || !receipt || receipt.committed !== true ||
        !receipt.snapshotId || !Number.isInteger(Number(receipt.stateVersion)) || Number(receipt.stateVersion) < 1 ||
        text(receipt.contentHash) !== contentHash || Number(receipt.chapterNo) !== Number(pending.body.chapterNo)) {
        return { outcome: 'unknown', error: 'Generation V2 提交回包不完整或与原稿不匹配，尚未确认结果' };
      }
      const confirmed = {
        ...cloneValue(receipt),
        bookId: pending.bookId,
        chapterNo: pending.body.chapterNo,
        contentHash,
        projectRevision: Number(receipt.projectRevision || receipt.currentProjectRevision) || Number(run.commitBase.expectedRevision) + 1
      };
      run.serverState = 'committed';
      run.status = 'accepted';
      run.appliedContentHash = contentHash;
      run.acceptedAt = Date.now();
      run.commitReceipt = confirmed;
      run.pendingCommit = null;
      persistGenerationRun(state, run);
      return { outcome: 'committed', receipt: run.commitReceipt };
    }
    if (result && result.ok === false && result.code === 'committed_content_conflict') {
      return { outcome: 'rejected', code: result.code, error: result.error || '该章已提交不同正文，请核对服务端状态' };
    }
    if (!result || result.ok !== true || !result.snapshotId || !Number.isInteger(Number(result.stateVersion)) || Number(result.stateVersion) < 1 ||
      (result.contentHash != null && result.contentHash !== contentHash) ||
      (result.chapterNo != null && Number(result.chapterNo) !== pending.body.chapterNo)) {
      return { outcome: 'unknown', error: '提交回包不完整或与请求不匹配，尚未确认结果' };
    }
    run.appliedContentHash = contentHash;
    run.acceptedAt = Date.now();
    run.status = 'awaiting_ledger_save';
    run.commitReceipt = { ...cloneValue(result), bookId: pending.bookId, chapterNo: pending.body.chapterNo, contentHash };
    run.pendingCommit = null;
    return { outcome: 'committed', receipt: run.commitReceipt };
  }

  function syncCreationCommitReceipt(state, run) {
    const receipt = run.commitReceipt;
    if (!receipt) return;
    const previousVersion = Number(state.creationStateVersion) || 0;
    const currentVersion = Math.max(Number(receipt.stateVersion) || 0, Number(receipt.currentStateVersion) || 0);
    state.creationStateVersion = Math.max(previousVersion, currentVersion);
    state.creationContext = state.creationContext || {};
    const book = state.creationContext.book;
    if (book) book.currentStateVersion = Math.max(Number(book.currentStateVersion) || 0, state.creationStateVersion);
    const preview = getPreview();
    const projectRevision = Number(receipt.projectRevision || receipt.currentProjectRevision) ||
      Number(run.commitBase && run.commitBase.expectedRevision) + 1;
    if (Number.isInteger(projectRevision) && projectRevision >= 0) preview.novelRevision = Math.max(Number(preview.novelRevision) || 0, projectRevision);
    const spentCost = receipt.spentCost == null ? NaN : Number(receipt.spentCost);
    if (book && Number.isFinite(spentCost) && spentCost >= 0 && currentVersion >= previousVersion) book.spentCost = spentCost;
    const snapshots = (state.creationContext.snapshots || []).filter(snapshot => snapshot && snapshot.id !== receipt.snapshotId);
    snapshots.push({ id: receipt.snapshotId, chapterNo: receipt.chapterNo, stateVersion: Number(receipt.stateVersion), contentHash: receipt.contentHash, auditStatus: 'passed' });
    state.creationContext.snapshots = snapshots.sort((left, right) => (Number(right.stateVersion) || 0) - (Number(left.stateVersion) || 0)).slice(0, 20);
    runtime.creationHydrationKey = '';
  }

  function renderBodyApplication(state, message) {
    try {
      renderCreationCost(state);
      renderEditorSurface();
      renderEditorChat();
    } catch (_) {
      message += '（界面刷新失败，请重新打开编辑器）';
    }
    try { toast(message); } catch (_) {}
  }

  async function persistAppliedNovel(options) {
    while (runtime.editorSavePromise) await runtime.editorSavePromise;
    window.clearTimeout(runtime.editorSaveTimer);
    await persistNovel(options);
  }

  async function mergeAcceptedLedger(state, run) {
    const contentHash = run.appliedContentHash;
    if (!contentHash || run.pendingFactLedgerHash !== contentHash || !normalizeAudit(run.audit).passed ||
      run.audit.contentHash !== contentHash) throw new Error('采纳正文与事实增量 hash 不匹配');
    if (run.factLedgerMergedHash === contentHash) return;
    const previousLedger = state.factLedger;
    const previousMarker = run.factLedgerMergedHash;
    const previousStatus = run.status;
    state.factLedger = mergeFactLedgerDelta(previousLedger, run.pendingFactLedgerDelta, creationChapterNo(state, run.chapterId), run.audit.contentHash);
    run.factLedgerMergedHash = contentHash;
    run.status = 'accepted';
    try {
      markEditorDirty(false);
      await persistAppliedNovel({ snapshot: false });
    } catch (error) {
      state.factLedger = previousLedger;
      run.factLedgerMergedHash = previousMarker;
      run.status = previousStatus;
      throw error;
    }
  }

  async function applyReviewedBody(state, item, scene, mode) {
    if (runtime.aiApplyBusy || runtime.editorBusy) { toast('正在处理正文，请稍后再采纳'); return false; }
    const run = (state && Array.isArray(state.generationRuns) ? state.generationRuns : []).find(record => record && record.id === item.workflowRunId);
    if (!isRealGenerationV2Run(run, item)) {
      toast('非正式 Generation V2 任务禁止正式采纳为正文；已为您保留草稿与历史记录，可复制内容或使用 Generation V2 重新生成');
      return false;
    }
    const generationV2 = true;
    const recovering = !!(run && (run.pendingCommit || run.appliedContentHash));
    if (['needs_review', 'commit_conflict'].includes(run.status) || !normalizeAudit(run.audit).passed ||
      (!recovering && (['needs_review', 'failed', 'interrupted', 'paused'].includes(item.status) || !normalizeAudit(item.audit).passed))) {
      toast('结果 needs_review：请完成审计后再写入正文，仍可查看或复制');
      return false;
    }
    runtime.aiApplyBusy = true;
    const previousContent = scene.content;
    let nextContent;
    let bodySaved = false;
    let commitResult = null;
    const matchesTarget = () => editorState(false) === state &&
      completionTargetMatches(item.target, state, getPreview().editorChatSessionId) && activeScene(state) === scene;
    try {
      if (!matchesTarget()) throw new Error('当前编辑位置已变化，请切回结果发起位置');
      if (run.appliedContentHash) {
        const currentBody = generationV2 ? String(scene.content == null ? '' : scene.content) : plainText(scene.content);
        if (await hashText(currentBody) !== run.appliedContentHash) throw new Error('已采纳正文发生变化，不能重复入账');
        if (!matchesTarget()) throw new Error('当前编辑位置已变化，未合并账本');
        syncCreationCommitReceipt(state, run);
        await mergeAcceptedLedger(state, run);
        item.status = 'ready';
        item.workflowStage = 'ready';
        item.audit = cloneValue(run.audit);
        item.errorNotice = '';
        renderBodyApplication(state, '该稿件已采纳，未重复写入或合并账本');
        return true;
      }
      if (run.pendingCommit) {
        nextContent = generationV2 ? String(run.finalText || item.text || '') : scene.content;
      } else {
        const sourceHash = await hashText(item.text);
        if (sourceHash !== run.resultContentHash || generationV2 && sourceHash !== run.outputHash) throw new Error('稿件已改变或缺少原稿 hash，不能沿用旧审计');
        if (item.audit.contentHash !== sourceHash || run.audit.contentHash !== sourceHash ||
          run.pendingFactLedgerHash !== sourceHash) throw new Error('稿件与审计 hash 不匹配，请重新审计');
        let body;
        if (generationV2) {
          if (mode !== 'replace') throw new Error('Generation V2 只允许提交原始服务端审计稿；请通过已验证的审计问题执行局部修订');
          if (item.text !== run.finalText || !state.creationBookId || await hashText(item.text) !== run.outputHash) {
            throw new Error('Generation V2 正文必须与服务端已审计原稿完全一致');
          }
          nextContent = String(run.finalText);
          body = nextContent;
          if (!body.trim()) throw new Error('待写入正文为空');
          if (await hashText(body) !== run.audit.contentHash) throw new Error('待写入正文 hash 校验失败');
        } else {
          const addition = textToHtml(item.text);
          nextContent = mode === 'replace' ? addition : `${normalizeSceneContent(previousContent)}${addition ? `${previousContent ? '\n' : ''}${addition}` : ''}`;
          body = plainText(nextContent);
          if (!body.trim()) throw new Error('待写入正文为空');
          if (!await requestFinalContentAudit(state, run, body, getStage())) throw new Error(run.audit.summary);
          item.audit = cloneValue(run.audit);
          if (await hashText(body) !== run.audit.contentHash) throw new Error('待写入正文 hash 校验失败');
        }
        if (!matchesTarget() || scene.content !== previousContent || item.text !== run.finalText) throw new Error('审计期间正文或编辑位置已变化，请重新审计');
        if (state.creationBookId) {
          run.pendingCommit = prepareCreationCommit(state, run, scene, body);
          if (generationV2) {
            run.pendingCommit.body.baseStateVersion = Number(run.commitBase.baseStateVersion);
            run.pendingCommit.body.stateVersion = Number(run.commitBase.baseStateVersion);
            run.pendingCommit.body.bibleVersion = Number(run.commitBase.baseBibleVersion);
          }
          run.status = 'commit_pending';
          persistGenerationRun(state, run);
        }
        if (!generationV2) {
          scene.content = nextContent;
          markEditorDirty(true);
          await persistAppliedNovel({ snapshot: true });
          bodySaved = true;
          if (!matchesTarget() || scene.content !== nextContent) throw new Error('保存期间正文或编辑位置已变化，未提交账本');
        }
      }
      if (state.creationBookId || run.pendingCommit) {
        commitResult = await commitCreationChapter(state, item, scene, nextContent);
        if (commitResult.outcome !== 'committed') throw new Error(commitResult.error);
        if (generationV2) scene.content = nextContent;
        item.status = 'ready';
        item.workflowStage = 'ready';
        item.errorNotice = '';
        syncCreationCommitReceipt(state, run);
      } else {
        run.appliedContentHash = run.audit.contentHash;
        run.acceptedAt = Date.now();
        run.status = 'awaiting_ledger_save';
      }
      if (!matchesTarget() || scene.content !== nextContent) throw new Error('提交期间正文或编辑位置已变化，未合并账本');
      await mergeAcceptedLedger(state, run);
      item.status = 'ready';
      item.workflowStage = 'ready';
      item.audit = cloneValue(run.audit);
      item.errorNotice = '';
      renderBodyApplication(state, state.creationBookId ? 'AI 结果已确认提交创作状态' : 'AI 结果已审计、保存并合并事实账本');
      return true;
    } catch (error) {
      const conflict = commitResult && (commitResult.code === 'committed_content_conflict' ||
        generationV2 && (commitResult.status === 409 || commitResult.code === 'STATE_CONFLICT'));
      const v2CommitFailure = generationV2 && commitResult && commitResult.outcome !== 'committed';
      if (!run.appliedContentHash && (recovering || conflict || commitResult && commitResult.outcome === 'unknown' || v2CommitFailure)) {
        run.status = conflict ? 'commit_conflict' : 'commit_unknown';
        item.status = run.status;
        item.workflowStage = run.status;
        item.audit = cloneValue(run.audit);
        item.errorNotice = conflict
          ? '作品或场景版本已变化；稿件与原始提交请求已保留，请重新载入并核对。'
          : commitResult && commitResult.outcome === 'rejected'
            ? `服务端拒绝了提交：${commitResult.error || error && error.message || '请检查任务权限与状态'}；稿件和 Run 已保留。`
            : '提交结果尚未确认；正文稿件和原始提交请求已保留，请查询任务状态后重放同一请求，不会重新生成。';
        try {
          if (matchesTarget() && !generationV2) await persistAppliedNovel({ snapshot: false });
          else if (generationV2) {
            persistGenerationRun(state, run);
            writeWorkspace('editor-chat', chatRecords());
          }
        } catch (_) { item.errorNotice += '；恢复状态尚未保存，请保留页面'; }
      } else if (!run.appliedContentHash) {
        run.pendingCommit = null;
        if (nextContent !== undefined && scene.content === nextContent) {
          scene.content = previousContent;
          if (bodySaved && matchesTarget()) {
            markEditorDirty(false);
            try { await persistAppliedNovel({ snapshot: false }); } catch (_) { toast('正文恢复尚未保存，请手动保存'); }
          }
        }
        markRunNeedsReview(run, error && error.message || '采纳审计未完成');
        item.audit = cloneValue(run.audit);
        item.status = 'needs_review';
        item.workflowStage = 'needs_review';
        persistGenerationRun(state, run);
      }
      renderBodyApplication(state, run.appliedContentHash ? '正文提交已确认，后续同步尚未完成；请再次采纳恢复同步' : item.errorNotice || error && error.message || '采纳失败，未合并事实账本');
      return false;
    } finally {
      runtime.aiApplyBusy = false;
    }
  }

  async function applyAIResult(target, index) {
    const item = resultAt(index);
    if (!item) { toast('该 AI 结果已不存在'); return; }
    if (item.generationV2 && target !== 'body') { toast('Generation V2 结果只能通过服务端 Run 提交到正文'); return; }
    if (item.status === 'in_progress' || ['extracting', 'planning', 'drafting', 'auditing', 'revising'].includes(item.workflowStage)) { toast('生成或审校尚未完成，可先复制，完成后再写入'); return; }
    if (['failed', 'interrupted', 'paused', 'commit_conflict'].includes(item.status)) { toast('生成未完成，暂无法写入'); return; }
    if (target === 'body') {
      const state = editorState(false);
      const run = (state && Array.isArray(state.generationRuns) ? state.generationRuns : []).find(record => record && record.id === item.workflowRunId);
      if (!isRealGenerationV2Run(run, item)) {
        toast('非正式 Generation V2 任务禁止正式采纳为正文；已为您保留草稿与历史记录，可复制内容或使用 Generation V2 重新生成');
        return false;
      }
      if (!completionTargetMatches(item.target, state, getPreview().editorChatSessionId)) { toast('当前编辑位置已变化，请重新生成或切回结果发起位置'); return false; }
      const scene = activeScene(state);
      if (!scene) return false;
      if (run && (run.pendingCommit || run.appliedContentHash)) return applyReviewedBody(state, item, scene, 'replace');
      const existingChars = scene.content ? plainText(scene.content).replace(/\s/g, '').length : 0;
      if (existingChars > 0) {
        const body = '<div class="notice"><span>Generation V2 的服务端审计绑定原稿。确认后会由服务端以 revision 和场景基线校验替换当前场景；追加需要先通过服务端局部修订与复审。</span></div>';
        openEditorForm('采纳 AI 结果', body, '确认替换并提交', async () => {
          return applyReviewedBody(state, item, scene, 'replace');
        });
        return;
      }
      return await applyReviewedBody(state, item, scene, 'replace');
    }
    const title = target === 'setting' ? '保存 AI 结果为设定' : target === 'outline' ? '保存 AI 结果为大纲' : '记录 AI 结果为伏笔';
    const fields = target === 'setting'
      ? `<div class="form-grid"><div class="field"><label for="completionAIName">设定名称</label><input id="completionAIName" value="${esc(item.text.split(/\n|。/)[0].slice(0, 30))}"></div><div class="field"><label for="completionAIType">类型</label><select id="completionAIType"><option value="character">人物</option><option value="location">地点</option><option value="faction">势力</option><option value="item">物品</option><option value="event">事件</option></select></div><div class="field"><label for="completionAINotes">设定内容</label><textarea id="completionAINotes">${esc(item.text)}</textarea></div></div>`
      : target === 'outline'
        ? `<div class="form-grid"><div class="field"><label for="completionAIOutlineTitle">节点标题</label><input id="completionAIOutlineTitle" value="${esc(activeRefs(editorState(false)).chapter && activeRefs(editorState(false)).chapter.title || '')}"></div><div class="field"><label for="completionAIOutlineText">大纲内容</label><textarea id="completionAIOutlineText">${esc(item.text)}</textarea></div></div>`
        : `<div class="form-grid"><div class="field"><label for="completionAIForeshadowTitle">伏笔标题</label><input id="completionAIForeshadowTitle" value="${esc(item.text.split(/\n|。/)[0].slice(0, 30))}"></div><div class="field"><label for="completionAIForeshadowText">伏笔描述</label><textarea id="completionAIForeshadowText">${esc(item.text)}</textarea></div><div class="field"><label for="completionAIForeshadowTarget">预计回收章节</label><select id="completionAIForeshadowTarget"><option value="">暂不设置</option>${editorState(false).volumes.flatMap(volume => volume.chapters).map(chapter => `<option value="${esc(chapter.id)}">${esc(chapter.title)}</option>`).join('')}</select></div></div>`;
    const open = refFunction('openActionModal');
    if (!open) return;
    open({ title, body: fields, confirmText: '确认保存', cancelText: '取消', onConfirm: () => {
      const state = editorState(false);
      if (item.target && (!completionTargetMatches(item.target, state, getPreview().editorChatSessionId) || target === 'setting' && item.target.novelId !== completionNovelKey(state))) { toast('当前编辑位置已变化，请切回结果发起位置后再保存'); return; }
      if (target === 'setting') {
        const data = ensureKnowledge(state);
        const entity = { id: uid('entity'), type: knowledgeType(document.getElementById('completionAIType').value), name: document.getElementById('completionAIName').value.trim() || '未命名设定', aliases: [], tags: [], parentId: '', notes: document.getElementById('completionAINotes').value.trim(), status: '待确认', archived: false, attrs: [], createdAt: Date.now(), updatedAt: Date.now() };
        applyCharacterArchetype(entity);
        state.knowledge.entities[entity.id] = entity;
        syncKnowledgeWorkspace(state);
        markEditorDirty(false);
        closeExistingModal();
        toast(`已保存设定：${entity.name}`);
      } else if (target === 'outline') {
        const current = activeRefs(state);
        if (item.target && !completionTargetMatches(item.target, state, getPreview().editorChatSessionId)) { toast('当前编辑位置已变化，请切回结果发起的章节后再保存大纲'); return; }
        const volumeOutline = getVolumeOutline(state, current.volume);
        const itemOutline = volumeOutline.chapters.find(chapter => chapter.num === current.chapter.title) || volumeOutline.chapters[0];
        if (itemOutline) { itemOutline.title = document.getElementById('completionAIOutlineTitle').value.trim(); itemOutline.synopsis = document.getElementById('completionAIOutlineText').value.trim(); itemOutline.status = 'writing'; }
        markEditorDirty(false);
        closeExistingModal();
        toast('AI 结果已保存到当前章节大纲');
      } else {
        const current = activeRefs(state);
        state.foreshadows.unshift({ id: uid('fs'), title: document.getElementById('completionAIForeshadowTitle').value.trim() || '未命名伏笔', description: document.getElementById('completionAIForeshadowText').value.trim(), status: 'planned', strength: 'medium', plantedChapterId: current.chapter && current.chapter.id || '', targetChapterId: document.getElementById('completionAIForeshadowTarget').value, resolvedChapterId: '', clues: [], relatedEntityIds: [], notes: '由 AI 对话生成，待作者确认。', createdAt: Date.now(), updatedAt: Date.now() });
        markEditorDirty(false);
        closeExistingModal();
        toast('AI 结果已记录为待回收伏笔');
      }
      renderEditorSurface();
    } });
  }

  async function adoptNeedsReviewBody(index) {
    if (runtime.aiApplyBusy || runtime.editorBusy) { toast('正在处理正文，请稍后再采纳'); return false; }
    const item = resultAt(index);
    if (!item || !item.text) { toast('该 AI 结果已不存在或正文为空'); return false; }
    const state = editorState(false);
    const run = (state && Array.isArray(state.generationRuns) ? state.generationRuns : []).find(record => record && record.id === item.workflowRunId);
    if (!isRealGenerationV2Run(run, item)) {
      toast('非正式 Generation V2 任务禁止正式采纳为正文；已为您保留草稿与历史记录，可复制内容或使用 Generation V2 重新生成');
      return false;
    }
    toast('Generation V2 结果需先通过服务端复审，不能直接采纳 needs_review 稿件');
    return false;
  }

  function closeExistingModal() {
    const fn = refFunction('closeModal');
    if (runtime.modalConfirmCleanup) runtime.modalConfirmCleanup();
    if (fn) {
      fn();
      return;
    }
    document.getElementById('modalBackdrop')?.classList.remove('open');
  }

  function markEditorDirty(snapshot, options) {
    const state = editorState(false);
    if (!state) return;
    syncOutline(state);
    syncKnowledgeWorkspace(state);
    if (snapshot) captureVersion(state);
    runtime.editorChangeVersion += 1;
    if (options && options.patchSave) {
      scheduleEditorWalSave(options.sceneRef);
      scheduleSave({ patchSave: true, sceneRef: options.sceneRef });
    } else {
      scheduleSave({ snapshot: false });
    }
  }

  function openEditorForm(title, body, confirmText, callback) {
    const backdrop = document.getElementById('modalBackdrop');
    const titleNode = document.getElementById('modalTitle');
    const bodyNode = backdrop && backdrop.querySelector('.modal-body');
    const cancelButton = document.getElementById('cancelModal');
    const confirmButton = document.getElementById('confirmModal');
    const closeButton = document.getElementById('closeModal');
    if (!backdrop || !titleNode || !bodyNode || !cancelButton || !confirmButton || !closeButton) return;
    if (runtime.modalConfirmCleanup) runtime.modalConfirmCleanup();
    titleNode.textContent = title;
    bodyNode.innerHTML = body;
    cancelButton.textContent = '取消';
    confirmButton.textContent = confirmText || '保存';
    const onConfirm = async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const result = typeof callback === 'function' ? await callback() : true;
      if (result !== false && runtime.modalConfirmCleanup) runtime.modalConfirmCleanup();
    };
    const onCancel = () => runtime.modalConfirmCleanup && runtime.modalConfirmCleanup();
    const onBackdrop = event => { if (event.target === backdrop) onCancel(); };
    const onClose = onCancel;
    const onEscape = event => { if (event.key === 'Escape') onCancel(); };
    confirmButton.addEventListener('click', onConfirm, true);
    cancelButton.addEventListener('click', onCancel, true);
    closeButton.addEventListener('click', onClose, true);
    backdrop.addEventListener('click', onBackdrop, true);
    document.addEventListener('keydown', onEscape, true);
    runtime.modalConfirmCleanup = () => {
      confirmButton.removeEventListener('click', onConfirm, true);
      cancelButton.removeEventListener('click', onCancel, true);
      closeButton.removeEventListener('click', onClose, true);
      backdrop.removeEventListener('click', onBackdrop, true);
      document.removeEventListener('keydown', onEscape, true);
      runtime.modalConfirmCleanup = null;
    };
    backdrop.classList.add('open');
    confirmButton.focus();
  }

  function addVolume() {
    const state = editorState(true);
    openEditorForm('新增卷', '<div class="field"><label for="completionVolumeTitle">卷名</label><input id="completionVolumeTitle" placeholder="例如：第一卷·归来"></div>', '新增', () => {
      const value = document.getElementById('completionVolumeTitle').value.trim();
      if (!value) { toast('请填写卷名'); return false; }
      state.volumes.push({ id: uid('volume'), title: value, chapters: [] });
      markEditorDirty(true);
      closeExistingModal();
      renderEditorSurface();
      toast(`已新增卷：${value}`);
    });
  }

  function addChapter(volumeId) {
    const state = editorState(true);
    const volume = state.volumes.find(item => item.id === volumeId) || state.volumes[0];
    openEditorForm('新增章节', `<div class="form-grid"><div class="field"><label for="completionChapterTitle">章节标题</label><input id="completionChapterTitle" placeholder="例如：雨夜试锋"></div><div class="field"><label for="completionChapterSub">章纲副标题</label><input id="completionChapterSub" placeholder="可选"></div></div>`, '新增章节', () => {
      const title = document.getElementById('completionChapterTitle').value.trim() || `第${volume.chapters.length + 1}章`;
      const chapter = { id: uid('chapter'), title, sub: document.getElementById('completionChapterSub').value.trim(), scenes: [{ id: uid('scene'), name: '场景一', content: '' }] };
      volume.chapters.push(chapter);
      state.currentVolumeId = volume.id; state.currentChapterId = chapter.id; state.currentSceneId = chapter.scenes[0].id;
      syncOutline(state); markEditorDirty(true); closeExistingModal(); renderEditorSurface(); toast(`已新增章节：${title}`);
    });
  }

  function addScene(volumeId, chapterId) {
    const state = editorState(true);
    const volume = state.volumes.find(item => item.id === volumeId) || state.volumes[0];
    const chapter = volume.chapters.find(item => item.id === chapterId);
    if (!chapter) return;
    openEditorForm('新增场景', '<div class="field"><label for="completionSceneName">场景名称</label><input id="completionSceneName" placeholder="例如：祠堂对话"></div>', '新增场景', () => {
      const name = document.getElementById('completionSceneName').value.trim() || `场景${chapter.scenes.length + 1}`;
      const scene = { id: uid('scene'), name, content: '' };
      chapter.scenes.push(scene); state.currentVolumeId = volume.id; state.currentChapterId = chapter.id; state.currentSceneId = scene.id;
      markEditorDirty(true); closeExistingModal(); renderEditorSurface(); toast(`已新增场景：${name}`);
    });
  }

  function selectChapter(volumeId, chapterId) {
    const state = editorState(false);
    const volume = state && state.volumes.find(item => item.id === volumeId);
    const chapter = volume && volume.chapters.find(item => item.id === chapterId);
    if (!chapter) return;
    state.currentVolumeId = volume.id; state.currentChapterId = chapter.id; state.currentSceneId = chapter.scenes[0] && chapter.scenes[0].id;
    getPreview().editorBody = chapter.scenes[0] && chapter.scenes[0].content || '';
    renderEditorSurface();
    toast(`已切换到${chapter.title}`);
  }

  function selectScene(volumeId, chapterId, sceneId) {
    const state = editorState(false);
    const volume = state && state.volumes.find(item => item.id === volumeId);
    const chapter = volume && volume.chapters.find(item => item.id === chapterId);
    const scene = chapter && chapter.scenes.find(item => item.id === sceneId);
    if (!scene) return;
    state.currentVolumeId = volume.id; state.currentChapterId = chapter.id; state.currentSceneId = scene.id;
    getPreview().editorBody = scene.content;
    renderEditorSurface();
    toast(`已切换到${scene.name}`);
  }

  function deleteChapter(volumeId, chapterId) {
    const state = editorState(false);
    const volume = state && state.volumes.find(item => item.id === volumeId);
    const index = volume && volume.chapters.findIndex(item => item.id === chapterId);
    if (!volume || index < 0) return;
    const chapter = volume.chapters[index];
    openEditorForm('移入回收站', `<p class="section-note">确定将「${esc(chapter.title)}」及其全部场景移入回收站吗？</p>`, '移入回收站', () => {
      stateTrash(state).unshift({ id: uid('trash'), kind: 'chapter', volumeId: volume.id, index, payload: chapter, deletedAt: Date.now() });
      volume.chapters.splice(index, 1);
      if (!volume.chapters.length && state.volumes.length > 1) state.volumes.splice(state.volumes.indexOf(volume), 1);
      const next = activeRefs(state);
      if (next.chapter) { state.currentVolumeId = next.volume.id; state.currentChapterId = next.chapter.id; state.currentSceneId = next.scene && next.scene.id; }
      markEditorDirty(true); closeExistingModal(); renderEditorSurface(); toast('章节已移入回收站');
    });
  }

  function deleteScene(volumeId, chapterId, sceneId) {
    const state = editorState(false);
    const volume = state && state.volumes.find(item => item.id === volumeId);
    const chapter = volume && volume.chapters.find(item => item.id === chapterId);
    const index = chapter && chapter.scenes.findIndex(item => item.id === sceneId);
    if (!chapter || index < 0) return;
    if (chapter.scenes.length <= 1) { toast('至少保留一个场景'); return; }
    const scene = chapter.scenes[index];
    openEditorForm('移入回收站', `<p class="section-note">确定将场景「${esc(scene.name)}」移入回收站吗？</p>`, '移入回收站', () => {
      stateTrash(state).unshift({ id: uid('trash'), kind: 'scene', volumeId: volume.id, chapterId: chapter.id, index, payload: scene, deletedAt: Date.now() });
      chapter.scenes.splice(index, 1);
      if (state.currentSceneId === scene.id) state.currentSceneId = chapter.scenes[Math.max(0, index - 1)].id;
      markEditorDirty(true); closeExistingModal(); renderEditorSurface(); toast('场景已移入回收站');
    });
  }

  function renameChapter(chapterId) {
    const state = editorState(false);
    const current = activeRefs(state);
    const chapter = state.volumes.flatMap(volume => volume.chapters).find(item => item.id === chapterId) || current.chapter;
    if (!chapter) return;
    openEditorForm('编辑章节标题', `<div class="field"><label for="completionRenameChapter">章节标题</label><input id="completionRenameChapter" value="${esc(chapter.title)}"></div>`, '保存标题', () => {
      const value = document.getElementById('completionRenameChapter').value.trim();
      if (!value) { toast('章节标题不能为空'); return false; }
      chapter.title = value; syncOutline(state); markEditorDirty(false); closeExistingModal(); renderEditorSurface();
    });
  }

  function renameScene(volumeId, chapterId, sceneId) {
    const state = editorState(false);
    const volume = state.volumes.find(item => item.id === volumeId);
    const chapter = volume && volume.chapters.find(item => item.id === chapterId);
    const scene = chapter && chapter.scenes.find(item => item.id === sceneId);
    if (!scene) return;
    openEditorForm('编辑场景名称', `<div class="field"><label for="completionRenameScene">场景名称</label><input id="completionRenameScene" value="${esc(scene.name)}"></div>`, '保存名称', () => {
      const value = document.getElementById('completionRenameScene').value.trim();
      if (!value) { toast('场景名称不能为空'); return false; }
      scene.name = value; markEditorDirty(false); closeExistingModal(); renderEditorSurface();
    });
  }

  function importFileKey(file) {
    return `${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified || 0}`;
  }

  function appendImportFiles(target, fileList) {
    const keys = new Set(target.map(importFileKey));
    Array.from(fileList || []).forEach(file => {
      const key = importFileKey(file);
      if (!keys.has(key)) { target.push(file); keys.add(key); }
    });
  }

  function renderImportFileList(listNode, files) {
    if (!listNode) return;
    if (!files.length) {
      listNode.innerHTML = '<div class="empty"><p>尚未选择文件。可以重复添加文件或文件夹。</p></div>';
      return;
    }
    listNode.innerHTML = `<div class="section-note" style="margin-bottom:6px;">已选 ${files.length} 个文件</div>` +
      files.map(file => `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.7;" title="${esc(file.webkitRelativePath || file.name)}">${esc(file.webkitRelativePath || file.name)}</div>`).join('');
  }

  function openImportFileChooser(title, accept, hint, onImport) {
    const selectedFiles = [];
    const body = `<p class="section-note">${hint}</p>` +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">' +
        `<label class="tv-btn tv-btn--ghost" style="cursor:pointer;">选择多个文件<input id="completionImportFiles" type="file" multiple accept="${accept}" hidden></label>` +
        `<label class="tv-btn tv-btn--ghost" style="cursor:pointer;">选择文件夹<input id="completionImportFolder" type="file" webkitdirectory directory multiple accept="${accept}" hidden></label>` +
        '<button class="tv-btn tv-btn--ghost" id="completionImportClear" type="button">清空清单</button>' +
      '</div>' +
      '<div id="completionImportList" style="max-height:150px;overflow:auto;margin-top:10px;padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:var(--paper-warm);"></div>';
    openEditorForm(title, body, '开始导入', async () => {
      if (!selectedFiles.length) { toast('请先选择文件或文件夹'); return false; }
      const files = selectedFiles.slice();
      closeExistingModal();
      await onImport(files);
    });
    const backdrop = document.getElementById('modalBackdrop');
    if (!backdrop) return;
    const listNode = backdrop.querySelector('#completionImportList');
    const add = fileList => { appendImportFiles(selectedFiles, fileList); renderImportFileList(listNode, selectedFiles); };
    backdrop.querySelector('#completionImportFiles')?.addEventListener('change', event => { add(event.target.files); event.target.value = ''; });
    backdrop.querySelector('#completionImportFolder')?.addEventListener('change', event => { add(event.target.files); event.target.value = ''; });
    backdrop.querySelector('#completionImportClear')?.addEventListener('click', () => { selectedFiles.length = 0; renderImportFileList(listNode, selectedFiles); });
    renderImportFileList(listNode, selectedFiles);
  }

  async function importNovelFiles(files) {
    const state = editorState(true);
    const volume = state.volumes[0] || (state.volumes.push({ id: uid('volume'), title: '第一卷', chapters: [] }), state.volumes[0]);
    let added = 0;
    for (const file of files) {
      if (!/\.(txt|md|markdown|text)$/i.test(file.name)) continue;
      const raw = await readImportedText(file);
      if (!raw) continue;
      const chunks = splitImportedChapters(raw, file.name);
      chunks.forEach(chunk => {
        const chapter = { id: uid('chapter'), title: chunk.title, sub: '', scenes: [{ id: uid('scene'), name: '场景一', content: textToHtml(chunk.body) }] };
        volume.chapters.push(chapter); added += 1;
      });
    }
    if (!added) { toast('没有读取到支持的文本文件'); return; }
    const active = volume.chapters[volume.chapters.length - added];
    state.currentVolumeId = volume.id; state.currentChapterId = active.id; state.currentSceneId = active.scenes[0].id;
    const resources = readWorkspace('resources', []);
    files.filter(file => /\.(txt|md|markdown|text)$/i.test(file.name)).forEach(file => resources.push({ id: uid('resource'), name: file.webkitRelativePath || file.name, type: '正文', source: '本地导入', status: '已读取', size: file.size, updatedAt: Date.now(), wordCount: 0 }));
    writeWorkspace('resources', resources);
    markEditorDirty(true); renderEditorSurface(); toast(`已导入 ${added} 个章节`);
  }

  function importTextFiles() {
    openImportFileChooser('导入正文', '.txt,.md,.markdown,.text', '支持单个文件、多选文件或整个文件夹。文件夹中的 TXT/MD 会按章节标题切分，没有标题时按文件生成章节。', importNovelFiles);
  }

  function splitImportedChapters(raw, fileName) {
    const lines = text(raw).replace(/\r\n?/g, '\n').split('\n');
    const heading = /^(#{1,3}\s+.+|第\s*[0-9一二三四五六七八九十百千万零]+\s*[章节卷].*|[卷章节]\s*[0-9一二三四五六七八九十百千万零]+.*)$/;
    const chunks = []; let current = null;
    lines.forEach(line => {
      if (heading.test(line.trim())) {
        if (current && current.body.trim()) chunks.push(current);
        current = { title: line.replace(/^#{1,3}\s+/, '').trim(), body: '' };
      } else if (current) current.body += `${line}\n`;
      else if (line.trim()) current = { title: fileName.replace(/\.[^.]+$/, ''), body: `${line}\n` };
    });
    if (current && current.body.trim()) chunks.push(current);
    return chunks.length ? chunks : [{ title: fileName.replace(/\.[^.]+$/, ''), body: raw }];
  }

  async function downloadNovelExport(format, scope, fromChapter, toChapter) {
    const backend = getBackend();
    if (!backend.token) throw new Error('请登录后导出作品');
    await persistNovel();
    const state = editorState(false);
    const preview = getPreview();
    const novelId = String(preview.novelId || state && state.id || '');
    if (!isServerNovelId(novelId)) throw new Error('作品尚未保存到云端，请先保存后重试');
    const params = new URLSearchParams({ format });
    if (scope === 'range') {
      params.set('fromChapter', String(fromChapter));
      params.set('toChapter', String(toChapter));
    }
    const apiBase = window.location.protocol === 'file:' || window.location.protocol === 'about:' ? 'http://127.0.0.1:3000' : '';
    const response = await fetch(`${apiBase}/api/novels/${encodeURIComponent(novelId)}/export?${params.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${backend.token}` },
      cache: 'no-store'
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data && data.error || `导出失败（${response.status}）`);
    }
    const extension = { txt: 'txt', epub: 'epub', docx: 'docx' }[format];
    let filename = `${text(preview.novel && preview.novel.title || state && state.title || '小说')}.${extension}`;
    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (encodedFilename) {
      try { filename = decodeURIComponent(encodedFilename[1]); } catch (_) {}
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openNovelExportModal() {
    const state = editorState(false);
    if (!state) { toast('请先打开一本作品'); return; }
    const chapters = chapterSequence(state);
    const currentIndex = chapters.findIndex(item => item.chapter.id === activeRefs(state).chapter?.id);
    const initialChapter = Math.max(1, currentIndex + 1);
    const chapterCount = chapters.length;
    const chapterName = index => {
      const item = chapters[index - 1];
      return item ? `${index}. ${item.chapter.title}` : '超出作品章节范围';
    };
    const rangeDisabled = chapterCount ? '' : ' disabled';
    const html = '<div class="form-grid">' +
      '<div class="field"><label for="completionExportFormat">文件格式</label><select id="completionExportFormat"><option value="txt">TXT</option><option value="epub">EPUB</option><option value="docx">DOCX</option></select></div>' +
      '<div class="field"><label for="completionExportScope">导出范围</label><select id="completionExportScope"><option value="book">整本作品</option><option value="range"' + rangeDisabled + '>章节范围</option></select></div>' +
      '<div id="completionExportRange" class="form-grid" hidden>' +
      '<div class="field"><label for="completionExportFrom">起始章序</label><input id="completionExportFrom" type="number" min="1" max="' + chapterCount + '" step="1" value="' + initialChapter + '"' + rangeDisabled + '></div>' +
      '<div class="field"><label for="completionExportTo">结束章序</label><input id="completionExportTo" type="number" min="1" max="' + chapterCount + '" step="1" value="' + initialChapter + '"' + rangeDisabled + '></div>' +
      '</div><div id="completionExportStatus" role="status" class="section-note">导出前会先保存当前作品。</div></div>';
    openEditorForm('导出小说', html, '导出', async () => {
      const format = document.getElementById('completionExportFormat')?.value || 'txt';
      const scope = document.getElementById('completionExportScope')?.value || 'book';
      const fromChapter = Number(document.getElementById('completionExportFrom')?.value);
      const toChapter = Number(document.getElementById('completionExportTo')?.value);
      const status = document.getElementById('completionExportStatus');
      const confirmButton = document.getElementById('confirmModal');
      if (scope === 'range' && (!Number.isSafeInteger(fromChapter) || !Number.isSafeInteger(toChapter) ||
        fromChapter < 1 || toChapter < fromChapter || toChapter > chapterCount)) {
        const message = `请输入 1 至 ${chapterCount} 之间且结束章不早于起始章的整数序号`;
        if (status) status.textContent = message;
        toast(message);
        return false;
      }
      if (confirmButton) { confirmButton.disabled = true; confirmButton.textContent = '正在导出…'; }
      if (status) status.textContent = '正在保存作品并生成文件…';
      try {
        await downloadNovelExport(format, scope, fromChapter, toChapter);
        closeExistingModal();
        toast('导出文件已开始下载');
        return true;
      } catch (error) {
        const message = error && error.message || '导出失败，请重试';
        if (status) status.textContent = message;
        toast(message);
        return false;
      } finally {
        if (confirmButton && document.getElementById('modalBackdrop')?.classList.contains('open')) {
          confirmButton.disabled = false;
          confirmButton.textContent = '导出';
        }
      }
    });
    const scopeInput = document.getElementById('completionExportScope');
    const formatInput = document.getElementById('completionExportFormat');
    const fromInput = document.getElementById('completionExportFrom');
    const toInput = document.getElementById('completionExportTo');
    const rangePanel = document.getElementById('completionExportRange');
    const status = document.getElementById('completionExportStatus');
    const updatePreview = () => {
      const range = scopeInput && scopeInput.value === 'range';
      if (rangePanel) rangePanel.hidden = !range;
      if (!status) return;
      const format = formatInput && formatInput.value.toUpperCase() || 'TXT';
      if (!range) { status.textContent = `${format} · 整本作品`; return; }
      const from = Number(fromInput && fromInput.value);
      const to = Number(toInput && toInput.value);
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from || to > chapterCount) {
        status.textContent = `请输入 1 至 ${chapterCount} 之间且结束章不早于起始章的整数序号`;
        return;
      }
      status.textContent = `${format} · ${chapterName(from)} 至 ${chapterName(to)}`;
    };
    [scopeInput, formatInput].forEach(input => input && input.addEventListener('change', updatePreview));
    [fromInput, toInput].forEach(input => input && input.addEventListener('input', updatePreview));
    updatePreview();
  }

  function editorSearchDocKey(chapterId, sceneId) {
    return String(chapterId) + '\u0000' + String(sceneId);
  }

  function loadEditorSearchModule() {
    if (window.MolanSearchIndex) return Promise.resolve(window.MolanSearchIndex);
    if (runtime.editorSearchLoadPromise) return runtime.editorSearchLoadPromise;
    const sourceUrl = EDITOR_SCRIPT_URL || window.location && window.location.href || '';
    const scriptUrl = sourceUrl ? new URL('./lib/client/search-index.js', sourceUrl).href : './lib/client/search-index.js';
    runtime.editorSearchLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.onload = () => window.MolanSearchIndex ? resolve(window.MolanSearchIndex) : reject(new Error('搜索索引模块加载失败'));
      script.onerror = () => reject(new Error('搜索索引模块加载失败'));
      document.head.appendChild(script);
    }).then(api => {
      runtime.editorSearchApi = api;
      return api;
    }).catch(error => {
      runtime.editorSearchLoadPromise = null;
      throw error;
    });
    return runtime.editorSearchLoadPromise;
  }

  async function buildEditorSearchIndex(documents) {
    const api = await loadEditorSearchModule();
    runtime.editorSearchDocuments = documents;
    if (typeof Worker === 'function') {
      try {
        if (!runtime.editorSearchWorker) {
          const sourceUrl = EDITOR_SCRIPT_URL || window.location && window.location.href || '';
          const workerUrl = sourceUrl ? new URL('./lib/client/search-worker.js', sourceUrl).href : './lib/client/search-worker.js';
          runtime.editorSearchWorker = api.createWorkerClient(new Worker(workerUrl));
        }
        await runtime.editorSearchWorker.build(documents);
        return;
      } catch (_) {
        try { runtime.editorSearchWorker && runtime.editorSearchWorker.terminate(); } catch (_) {}
        runtime.editorSearchWorker = null;
      }
    }
    runtime.editorSearchFallback = api.createSearchIndex(documents);
  }

  async function queryEditorSearchIndex(query, options) {
    if (runtime.editorSearchWorker) {
      try { return await runtime.editorSearchWorker.search(query, options); }
      catch (_) {
        try { runtime.editorSearchWorker.terminate(); } catch (_) {}
        runtime.editorSearchWorker = null;
      }
    }
    if (!runtime.editorSearchFallback) {
      const api = await loadEditorSearchModule();
      runtime.editorSearchFallback = api.createSearchIndex(runtime.editorSearchDocuments);
    }
    return runtime.editorSearchFallback.search(query, options);
  }

  function editorSearchRevision(state, chapterId, sceneId) {
    const preview = getPreview();
    const projectId = editorWalProjectId(state);
    const docKey = projectId + '|' + encodeURIComponent(chapterId) + '|' + encodeURIComponent(sceneId);
    const baseline = runtime.editorWalBaselines.get(docKey);
    return baseline ? Number(baseline.revision) || 0 : Number(preview.novelRevision) || 0;
  }

  function collectEditorSearchDocuments(state) {
    const documents = [];
    (state.volumes || []).forEach(volume => (volume.chapters || []).forEach(chapter => (chapter.scenes || []).forEach(scene => {
      const rawContent = String(scene.content || '');
      const safeContent = sanitizeHtml(rawContent);
      documents.push({
        key: editorSearchDocKey(chapter.id, scene.id),
        kind: 'manuscript',
        chapterId: String(chapter.id),
        chapterTitle: String(chapter.title || ''),
        sceneId: String(scene.id),
        sceneTitle: String(scene.name || ''),
        revision: editorSearchRevision(state, chapter.id, scene.id),
        text: plainText(safeContent),
        baseContent: rawContent,
        baseText: plainText(safeContent),
        target: scene
      });
    })));
    ensureKnowledge(state).entities.forEach(entity => {
      const notes = String(entity.notes || '');
      documents.push({
        key: editorSearchDocKey('__knowledge__', entity.id),
        kind: 'knowledge',
        chapterId: '__knowledge__',
        chapterTitle: '设定资料',
        sceneId: String(entity.id),
        sceneTitle: String(entity.name || '未命名设定'),
        revision: Number(entity.updatedAt) || 0,
        text: notes,
        baseContent: notes,
        baseText: notes,
        target: entity
      });
    });
    return documents;
  }

  function scopedEditorSearchDocuments(documents, scope, state) {
    const active = activeRefs(state);
    if (scope === 'knowledge') return documents.filter(item => item.kind === 'knowledge');
    if (scope === 'scene') {
      return documents.filter(item => item.kind === 'manuscript' && active.chapter && active.scene &&
        item.chapterId === String(active.chapter.id) && item.sceneId === String(active.scene.id));
    }
    if (scope === 'chapter') {
      return documents.filter(item => item.kind === 'manuscript' && active.chapter && item.chapterId === String(active.chapter.id));
    }
    return documents.filter(item => item.kind === 'manuscript');
  }

  function editorContentFingerprint(value) {
    const source = String(value == null ? '' : value);
    let first = 2166136261;
    let second = 0x9e3779b9;
    for (let index = 0; index < source.length; index += 1) {
      const code = source.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second + code, 2246822519);
      second ^= second >>> 13;
    }
    return source.length + ':' + (first >>> 0).toString(16) + ':' + (second >>> 0).toString(16);
  }

  function applySearchTextOperations(value, operations) {
    let result = String(value == null ? '' : value);
    const ordered = (operations || []).slice().sort((left, right) => right.start - left.start || right.end - left.end);
    ordered.forEach(operation => {
      const start = Number(operation.start);
      const end = Number(operation.end);
      const before = String(operation.before == null ? '' : operation.before);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > result.length ||
        result.slice(start, end) !== before) throw new Error('目标正文已变化，请重新搜索');
      result = result.slice(0, start) + String(operation.after == null ? '' : operation.after) + result.slice(end);
    });
    return result;
  }

  function applySearchOperationsToRichText(html, operations) {
    const template = document.createElement('template');
    template.innerHTML = sanitizeHtml(html);
    const ordered = (operations || []).slice().sort((left, right) => right.start - left.start || right.end - left.end);
    ordered.forEach(operation => {
      const start = Number(operation.start);
      const end = Number(operation.end);
      const root = template.content;
      const sourceText = root.textContent || '';
      const before = String(operation.before == null ? '' : operation.before);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > sourceText.length ||
        sourceText.slice(start, end) !== before) throw new Error('目标正文已变化，请重新搜索');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let node;
      let offset = 0;
      while ((node = walker.nextNode())) {
        nodes.push({ node, start: offset });
        offset += node.data.length;
      }
      let startPoint = null;
      let endPoint = null;
      nodes.forEach((item, index) => {
        const next = item.start + item.node.data.length;
        if (!startPoint && start >= item.start && start < next) startPoint = { node: item.node, offset: start - item.start, index };
        if (!endPoint && end > item.start && end <= next) endPoint = { node: item.node, offset: end - item.start, index };
      });
      if (!startPoint || !endPoint) throw new Error('搜索命中无法映射回富文本正文');
      const replacement = String(operation.after == null ? '' : operation.after);
      if (startPoint.index === endPoint.index) {
        startPoint.node.data = startPoint.node.data.slice(0, startPoint.offset) + replacement + startPoint.node.data.slice(endPoint.offset);
      } else {
        startPoint.node.data = startPoint.node.data.slice(0, startPoint.offset) + replacement;
        for (let index = startPoint.index + 1; index < endPoint.index; index += 1) nodes[index].node.data = '';
        endPoint.node.data = endPoint.node.data.slice(endPoint.offset);
      }
    });
    return template.innerHTML;
  }

  function inverseSearchOperations(operations) {
    let delta = 0;
    const inverse = (operations || []).slice().sort((left, right) => left.start - right.start).map(operation => {
      const start = Number(operation.start) + delta;
      const after = String(operation.after == null ? '' : operation.after);
      const before = String(operation.before == null ? '' : operation.before);
      delta += after.length - (Number(operation.end) - Number(operation.start));
      return { start, end: start + after.length, before: after, after: before };
    });
    return inverse.sort((left, right) => right.start - left.start);
  }

  function searchChangeSetOperator() {
    const user = getBackend().user || {};
    return String(user.userId || user.email || 'local-author');
  }

  function buildEditorSearchChangeSet(result, documents, values) {
    const documentMap = new Map(documents.map(item => [item.key, item]));
    const grouped = new Map();
    result.matches.forEach(match => {
      const key = editorSearchDocKey(match.chapterId, match.sceneId);
      const document = documentMap.get(key);
      if (!document) return;
      const before = document.baseText.slice(match.start, match.end);
      if (before === values.replacement) return;
      let change = grouped.get(key);
      if (!change) {
        change = {
          kind: document.kind,
          chapterId: document.chapterId,
          chapter: document.chapterTitle,
          sceneId: document.sceneId,
          scene: document.sceneTitle,
          revision: document.revision,
          beforeHash: editorContentFingerprint(document.baseContent),
          afterHash: '',
          operations: []
        };
        grouped.set(key, change);
      }
      change.operations.push({
        start: match.start,
        end: match.end,
        before,
        after: values.replacement,
        context: match.snippet && match.snippet.text || before
      });
    });
    const changes = Array.from(grouped.values());
    const count = changes.reduce((sum, change) => sum + change.operations.length, 0);
    return {
      id: uid('search-change-set'),
      query: values.query,
      replacement: values.replacement,
      scope: values.scope,
      caseSensitive: values.caseSensitive,
      operator: searchChangeSetOperator(),
      timestamp: Date.now(),
      totalMatches: count,
      changes
    };
  }

  function selectEditorSearchRange(root, start, end) {
    if (!root || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let offset = 0;
    let node;
    while ((node = walker.nextNode())) {
      const next = offset + node.data.length;
      nodes.push({ node, start: offset, end: next });
      offset = next;
    }
    let startPoint = null;
    let endPoint = null;
    nodes.forEach(item => {
      if (!startPoint && start >= item.start && start < item.end) startPoint = { node: item.node, offset: start - item.start };
      if (!endPoint && end > item.start && end <= item.end) endPoint = { node: item.node, offset: end - item.start };
    });
    if (!startPoint || !endPoint) return false;
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    const selection = window.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    startPoint.node.parentElement && startPoint.node.parentElement.scrollIntoView({ block: 'center' });
    return true;
  }

  function navigateToEditorSearchHit(state, match) {
    const ref = chapterSequence(state).find(item => String(item.chapter.id) === String(match.chapterId) &&
      (item.chapter.scenes || []).some(scene => String(scene.id) === String(match.sceneId)));
    const scene = ref && ref.chapter.scenes.find(item => String(item.id) === String(match.sceneId));
    if (!ref || !scene) {
      toast('搜索结果已变化，请重新搜索');
      return false;
    }
    state.currentVolumeId = ref.volume.id;
    state.currentChapterId = ref.chapter.id;
    state.currentSceneId = scene.id;
    getPreview().editorBody = scene.content;
    runtime.editorSearchSession += 1;
    window.clearTimeout(runtime.editorSearchTimer);
    closeExistingModal();
    renderEditorSurface();
    window.setTimeout(() => {
      const editor = getStage() && getStage().querySelector('.completion-editor-content');
      if (!editor) return;
      editor.focus();
      if (!selectEditorSearchRange(editor, Number(match.start), Number(match.end))) {
        toast('搜索命中已变化，请重新搜索');
        return;
      }
      toast(`已定位到${ref.chapter.title} · ${scene.name}`);
    }, 0);
    return true;
  }

  function renderEditorSearchHits(result, documentMap) {
    if (!result || !result.matches.length) return '<div class="empty"><p>没有找到匹配内容。</p></div>';
    return result.matches.map((match, index) => {
      const document = documentMap.get(editorSearchDocKey(match.chapterId, match.sceneId));
      const interactive = document && document.kind === 'manuscript';
      const tagName = interactive ? 'button' : 'div';
      const attributes = interactive ? ' type="button" data-editor-search-hit="' + index + '" aria-label="定位到' + esc(match.chapterTitle || '未命名章节') + '，' + esc(match.sceneTitle || '未命名场景') + '"' : '';
      const snippet = match.snippet || { text: '', matchStart: 0, matchEnd: 0 };
      const textValue = String(snippet.text || '');
      const before = textValue.slice(0, snippet.matchStart);
      const hit = textValue.slice(snippet.matchStart, snippet.matchEnd);
      const after = textValue.slice(snippet.matchEnd);
      return '<' + tagName + attributes + ' style="width:100%;padding:8px 0;border:0;border-bottom:1px solid var(--line);background:transparent;text-align:left;' + (interactive ? 'cursor:pointer;' : '') + 'display:grid;gap:3px">' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px"><strong>' + esc(match.chapterTitle || '未命名章节') +
        '</strong><span>' + esc(match.sceneTitle || '未命名场景') + '</span><span style="color:var(--muted)">revision ' + Number(match.revision || 0) + '</span></div>' +
        '<div style="font-size:12px;line-height:1.6;color:var(--text-secondary,#555)">' + esc(before) + '<mark>' + esc(hit) + '</mark>' + esc(after) + '</div></' + tagName + '>';
    }).join('');
  }

  function renderEditorSearchReview(changeSet) {
    const rows = [];
    changeSet.changes.forEach(change => change.operations.forEach(operation => {
      rows.push('<div style="padding:8px 0;border-bottom:1px solid var(--line);display:grid;gap:4px">' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px"><strong>' + esc(change.chapter || change.scene) +
        '</strong><span>' + esc(change.scene) + '</span><span style="color:var(--muted)">revision ' + Number(change.revision || 0) + '</span></div>' +
        '<div style="font-size:12px;line-height:1.6"><del style="color:#a24b4b">' + esc(operation.before) + '</del><span style="padding:0 7px;color:var(--muted)">→</span><ins style="color:#2d7b57;text-decoration:none">' +
        (operation.after ? esc(operation.after) : '（删除）') + '</ins></div><div style="font-size:11px;color:var(--muted)">' + esc(operation.context) + '</div></div>');
    }));
    return '<div><div class="section-note" style="margin-bottom:8px">共 ' + changeSet.totalMatches + ' 处 · ' + changeSet.changes.length + ' 个文档</div>' +
      '<div style="max-height:360px;overflow:auto" aria-label="替换变更预览">' + rows.join('') + '</div>' +
      '<button class="button" type="button" data-editor-search-back style="margin-top:10px">返回搜索</button></div>';
  }

  function currentEditorSearchContent(state, change) {
    if (change.kind === 'knowledge') {
      const entity = Object.values(ensureKnowledge(state).entities).find(item => String(item.id) === String(change.sceneId));
      return entity ? { target: entity, content: String(entity.notes || ''), revision: Number(entity.updatedAt) || 0 } : null;
    }
    const location = locateEditorWalScene(state, change.chapterId, change.sceneId);
    if (!location) return null;
    const doc = editorWalDocument(state, location.scene);
    return {
      target: location.scene,
      content: String(location.scene.content || ''),
      text: plainText(sanitizeHtml(location.scene.content || '')),
      revision: editorSearchRevision(state, change.chapterId, change.sceneId),
      docKey: doc && doc.docKey
    };
  }

  function prepareEditorSearchApply(state, changeSet, documentMap) {
    if (editorState(false) !== state) throw new Error('编辑器状态已切换，请重新搜索');
    const prepared = [];
    changeSet.changes.forEach(change => {
      const source = documentMap.get(editorSearchDocKey(change.chapterId, change.sceneId));
      const current = currentEditorSearchContent(state, change);
      if (!source || !current || current.content !== source.baseContent || current.revision !== change.revision ||
        (change.kind === 'manuscript' && (current.text !== source.baseText || runtime.editorWalConflicts.has(current.docKey)))) {
        throw new Error('命中正文或版本已变化，未应用替换；请重新搜索');
      }
      const nextText = applySearchTextOperations(source.baseText, change.operations);
      const nextContent = change.kind === 'manuscript' ? applySearchOperationsToRichText(current.content, change.operations) : nextText;
      const verifiedText = change.kind === 'manuscript' ? plainText(sanitizeHtml(nextContent)) : nextContent;
      if (verifiedText !== nextText) throw new Error('替换结果与预览不一致，未应用任何修改');
      change.afterHash = editorContentFingerprint(nextContent);
      prepared.push({ change, target: current.target, afterContent: nextContent });
    });
    return prepared;
  }

  function canUndoEditorSearchChangeSet(state, record) {
    if (!state || !record || !Array.isArray(record.changes)) return false;
    return record.changes.every(change => {
      const current = currentEditorSearchContent(state, change);
      return current && editorContentFingerprint(current.content) === change.afterHash;
    });
  }

  function markEditorSearchDirty(state, sceneRefs) {
    syncOutline(state);
    syncKnowledgeWorkspace(state);
    captureVersion(state);
    runtime.editorChangeVersion += 1;
    const uniqueScenes = Array.from(new Set((sceneRefs || []).filter(Boolean)));
    if (!uniqueScenes.length || !isServerNovelId(getPreview().novelId)) {
      scheduleSave({ snapshot: false });
      return;
    }
    window.clearTimeout(runtime.editorSaveTimer);
    runtime.editorScheduledSaveOptions = null;
    const backend = getBackend();
    const request = refFunction('backendRequest');
    void (async () => {
      for (const scene of uniqueScenes) await writeEditorWal(state, scene);
      if (!backend.token || !request) {
        setSaveStatus('正文已写入本地 WAL，联网后自动同步');
        return;
      }
      for (const scene of uniqueScenes) {
        const ack = await persistNovelScenePatch({ patchSave: true, sceneRef: scene });
        if (!ack) throw new Error('部分场景仍在本地 WAL 中，待联网或冲突处理后继续同步');
      }
      const saved = await persistNovel({ snapshot: false });
      if (!saved) throw new Error('正文已同步，替换记录尚未同步');
    })().catch(error => {
      setSaveStatus('替换已保留在本地 WAL，云端同步待重试');
      toast(error && error.message || '全书替换已保存在本地，云端同步失败');
    });
    setSaveStatus('替换已写入本地 WAL，正在逐场景同步');
  }

  async function undoEditorSearchChangeSet() {
    const state = editorState(false);
    const record = runtime.editorSearchUndoStack[0] || (state && state.searchChangeSets || []).find(item => item && !item.undoneAt);
    if (!state || !record || !canUndoEditorSearchChangeSet(state, record)) return false;
    const targets = [];
    try {
      record.changes.forEach(change => {
        const current = currentEditorSearchContent(state, change);
        if (!current || editorContentFingerprint(current.content) !== change.afterHash) throw new Error('正文已继续修改，不能安全撤销这组替换');
        const restored = change.kind === 'manuscript'
          ? applySearchOperationsToRichText(current.content, inverseSearchOperations(change.operations))
          : applySearchTextOperations(current.content, inverseSearchOperations(change.operations));
        targets.push({ change, target: current.target, content: restored });
      });
      targets.forEach(item => {
        if (item.change.kind === 'manuscript') item.target.content = item.content;
        else { item.target.notes = item.content; item.target.updatedAt = Date.now(); }
      });
      record.undoneAt = Date.now();
      runtime.editorSearchUndoStack.shift();
      markEditorSearchDirty(state, targets.filter(item => item.change.kind === 'manuscript').map(item => item.target));
      closeExistingModal();
      renderEditorSurface();
      toast('已撤销最近一组搜索替换');
      return true;
    } catch (error) {
      toast(error && error.message || '无法安全撤销搜索替换');
      return false;
    }
  }

  async function flushEditorWalDrafts(state) {
    const preview = getPreview();
    const backend = getBackend();
    const request = refFunction('backendRequest');
    if (!state || !isServerNovelId(preview.novelId) || !backend.token || !request) return false;
    await ensureEditorWalRecovery(state);
    if (!runtime.editorWal) return false;
    const records = await runtime.editorWal.readProject(editorWalProjectId(state));
    const sceneKeys = new Set();
    for (const record of records) {
      if (record.conflicted || runtime.editorWalConflicts.has(record.docKey)) continue;
      const key = String(record.chapterId) + '\u0000' + String(record.sceneId);
      if (sceneKeys.has(key)) continue;
      sceneKeys.add(key);
      const location = locateEditorWalScene(state, record.chapterId, record.sceneId);
      if (!location) continue;
      const ack = await persistNovelScenePatch({ patchSave: true, sceneRef: location.scene });
      if (!ack) return false;
    }
    if (records.length && !runtime.editorWalConflicts.size) return !!(await persistNovel({ snapshot: false }));
    return records.length === 0;
  }

  function openSearchReplace() {
    const state = editorState(false);
    if (!state) { toast('请先打开一本作品'); return; }
    const sessionId = ++runtime.editorSearchSession;
    window.clearTimeout(runtime.editorSearchTimer);
    const allDocuments = collectEditorSearchDocuments(state);
    const documentMap = new Map(allDocuments.map(item => [item.key, item]));
    let phase = 'search';
    let currentMatches = null;
    let searchSignature = '';
    let indexedScope = '';
    let changeSet = null;
    const backdrop = document.getElementById('modalBackdrop');
    const bodyNode = backdrop && backdrop.querySelector('.modal-body');
    const confirmButton = document.getElementById('confirmModal');

    const formHtml = values => '<div class="form-grid">' +
      '<div class="field"><label for="completionSearchText">搜索内容</label><input id="completionSearchText" value="' + esc(values.query || '') + '"></div>' +
      '<div class="field"><label for="completionReplaceText">替换为</label><input id="completionReplaceText" value="' + esc(values.replacement || '') + '"></div>' +
      '<div class="field"><label for="completionSearchScope">范围</label><select id="completionSearchScope">' +
      '<option value="scene"' + (values.scope === 'scene' ? ' selected' : '') + '>当前场景</option>' +
      '<option value="chapter"' + (values.scope === 'chapter' ? ' selected' : '') + '>当前章节全部场景</option>' +
      '<option value="book"' + (values.scope === 'book' ? ' selected' : '') + '>全书正文</option>' +
      '<option value="knowledge"' + (values.scope === 'knowledge' ? ' selected' : '') + '>设定资料</option></select></div>' +
      '<label class="check"><input id="completionCaseSensitive" type="checkbox"' + (values.caseSensitive ? ' checked' : '') + '>区分大小写</label></div>' +
      '<div id="completionSearchSummary" role="status" style="margin:8px 0;font-size:11px;color:var(--muted)">输入搜索内容</div>' +
      '<div id="completionSearchResults" style="max-height:340px;overflow:auto"></div>';

    const readValues = () => ({
      query: document.getElementById('completionSearchText') && document.getElementById('completionSearchText').value || '',
      replacement: document.getElementById('completionReplaceText') && document.getElementById('completionReplaceText').value || '',
      scope: document.getElementById('completionSearchScope') && document.getElementById('completionSearchScope').value || 'book',
      caseSensitive: !!(document.getElementById('completionCaseSensitive') && document.getElementById('completionCaseSensitive').checked)
    });
    const signatureFor = values => JSON.stringify([values.query, values.replacement, values.scope, values.caseSensitive]);
    const sessionActive = () => runtime.editorSearchSession === sessionId && backdrop && backdrop.classList.contains('open');

    function scheduleSearch() {
      if (phase !== 'search') return;
      window.clearTimeout(runtime.editorSearchTimer);
      if (confirmButton) confirmButton.disabled = true;
      runtime.editorSearchTimer = window.setTimeout(() => { void refreshSearch(); }, 180);
    }

    async function refreshSearch() {
      const values = readValues();
      const signature = signatureFor(values);
      const summary = document.getElementById('completionSearchSummary');
      const resultsNode = document.getElementById('completionSearchResults');
      if (!values.query.trim()) {
        currentMatches = null;
        searchSignature = '';
        if (summary) summary.textContent = '输入搜索内容';
        if (resultsNode) resultsNode.innerHTML = '';
        if (confirmButton) confirmButton.disabled = true;
        return;
      }
      if (summary) summary.textContent = '正在检索';
      if (resultsNode) resultsNode.innerHTML = '';
      if (confirmButton) confirmButton.disabled = true;
      const scopeDocuments = scopedEditorSearchDocuments(allDocuments, values.scope, state);
      const scopeKey = values.scope + ':' + scopeDocuments.length + ':' +
        (values.scope === 'scene' ? scopeDocuments[0] && scopeDocuments[0].sceneId : values.scope === 'chapter' ? scopeDocuments[0] && scopeDocuments[0].chapterId : '');
      try {
        if (indexedScope !== scopeKey) {
          await buildEditorSearchIndex(scopeDocuments.map(item => ({
            chapterId: item.chapterId,
            chapterTitle: item.chapterTitle,
            sceneId: item.sceneId,
            sceneTitle: item.sceneTitle,
            revision: item.revision,
            text: item.text
          })));
          indexedScope = scopeKey;
        }
        const result = await queryEditorSearchIndex(values.query, { caseSensitive: values.caseSensitive, limit: 1000 });
        if (!sessionActive() || signatureFor(readValues()) !== signature) return;
        currentMatches = result;
        searchSignature = signature;
        if (summary) summary.textContent = result.totalMatches + ' 处命中 · ' + scopeDocuments.length + ' 个文档' +
          (result.truncated ? ' · 超过 1000 处，请缩小范围后预览' : '');
        if (resultsNode) {
          resultsNode.innerHTML = renderEditorSearchHits(result, documentMap);
          resultsNode.querySelectorAll('[data-editor-search-hit]').forEach(button => {
            button.addEventListener('click', () => {
              const match = result.matches[Number(button.dataset.editorSearchHit)];
              if (match) navigateToEditorSearchHit(state, match);
            });
          });
        }
        if (confirmButton) {
          confirmButton.textContent = '生成替换预览';
          confirmButton.disabled = !result.matches.length || result.truncated;
        }
      } catch (error) {
        if (summary) summary.textContent = error && error.message || '搜索索引不可用';
        if (resultsNode) resultsNode.innerHTML = '';
        if (confirmButton) confirmButton.disabled = true;
      }
    }

    function bindSearchInputs() {
      ['completionSearchText', 'completionReplaceText'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.addEventListener('input', scheduleSearch);
      });
      ['completionSearchScope', 'completionCaseSensitive'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.addEventListener('change', scheduleSearch);
      });
    }

    function bindReviewBack() {
      const button = bodyNode && bodyNode.querySelector('[data-editor-search-back]');
      if (!button) return;
      button.addEventListener('click', () => {
        phase = 'search';
        bodyNode.innerHTML = formHtml(changeSet);
        if (confirmButton) confirmButton.textContent = '生成替换预览';
        bindSearchInputs();
        void refreshSearch();
      });
    }

    openEditorForm('搜索与替换', formHtml({ scope: 'book' }), '生成替换预览', async () => {
      if (!sessionActive()) return false;
      if (phase === 'search') {
        const values = readValues();
        if (!values.query.trim()) { toast('请输入搜索内容'); return false; }
        if (!currentMatches || searchSignature !== signatureFor(values)) { toast('搜索结果正在更新，请稍候'); return false; }
        if (currentMatches.truncated) { toast('命中结果超过预览上限，请缩小搜索范围'); return false; }
        changeSet = buildEditorSearchChangeSet(currentMatches, scopedEditorSearchDocuments(allDocuments, values.scope, state), values);
        if (!changeSet.totalMatches) { toast('替换内容与现有正文相同，无需修改'); return false; }
        phase = 'review';
        bodyNode.innerHTML = renderEditorSearchReview(changeSet);
        if (confirmButton) confirmButton.textContent = '确认应用 ' + changeSet.totalMatches + ' 处';
        bindReviewBack();
        return false;
      }
      try {
        const prepared = prepareEditorSearchApply(state, changeSet, documentMap);
        prepared.forEach(item => {
          if (item.change.kind === 'manuscript') item.target.content = item.afterContent;
          else { item.target.notes = item.afterContent; item.target.updatedAt = Date.now(); }
        });
        state.searchChangeSets.unshift(cloneValue(changeSet));
        state.searchChangeSets = state.searchChangeSets.slice(0, 20);
        runtime.editorSearchUndoStack.unshift(changeSet);
        runtime.editorSearchUndoStack = runtime.editorSearchUndoStack.slice(0, 20);
        const scenes = prepared.filter(item => item.change.kind === 'manuscript').map(item => item.target);
        markEditorSearchDirty(state, scenes);
        closeExistingModal();
        renderEditorSurface();
        toast('已应用 ' + changeSet.totalMatches + ' 处替换，可用 Ctrl+Z 撤销');
        return true;
      } catch (error) {
        toast(error && error.message || '搜索替换未应用');
        return false;
      }
    });
    bindSearchInputs();
    if (confirmButton) confirmButton.disabled = true;
  }

  function diffLines(before, after) {
    const a = text(before).split(/(?<=[。！？\n])/).filter(item => item.trim());
    const b = text(after).split(/(?<=[。！？\n])/).filter(item => item.trim());
    const rows = []; const max = Math.max(a.length, b.length);
    for (let index = 0; index < max; index += 1) {
      if (a[index] === b[index]) rows.push(`<div style="padding:4px 7px">&nbsp;&nbsp;${esc(a[index] || '')}</div>`);
      else { if (a[index]) rows.push(`<div style="padding:4px 7px;color:#a24b4b;background:rgba(180,70,70,.08)">- ${esc(a[index])}</div>`); if (b[index]) rows.push(`<div style="padding:4px 7px;color:#2d7b57;background:rgba(45,123,87,.08)">+ ${esc(b[index])}</div>`); }
    }
    return rows.join('') || '<div class="empty"><p>没有可比较的文本。</p></div>';
  }

  /** 本章审计摘要：三视角问题分组 + 文风距离明细（读最近一次生成运行）。 */
  function openAuditSummary() {
    const state = editorState(false);
    const run = state && Array.isArray(state.generationRuns) ? state.generationRuns[0] : null;
    if (!run) { openEditorForm('本章审计', '<div class="empty"><p>还没有生成运行记录。</p></div>', '关闭', null); return; }
    const audit = run.audit || run.creationAudit || {};
    const issues = Array.isArray(audit.issues) ? audit.issues : [];
    const groups = {};
    issues.forEach(item => { const cat = String(item.type || item.category || 'other'); (groups[cat] = groups[cat] || []).push(item); });
    const groupRows = Object.entries(groups).map(([cat, list]) => '<div style="margin-top:10px"><b style="font-size:12px">' + esc(cat) + '（' + list.length + '）</b>' + list.map(item => '<div style="margin-top:5px;font-size:11px;line-height:1.6"><span class="badge ' + ((item.severity === 'blocker' || item.severity === 'high') ? 'red' : 'gray') + '">' + esc(item.severity || '') + '</span> ' + esc(item.problem || item.description || '') + (item.fix ? '<div style="color:var(--muted)">建议：' + esc(item.fix) + '</div>' : '') + '</div>').join('') + '</div>').join('') || '<div class="section-note">' + (normalizeAudit(audit).passed ? '未发现阻断问题。' : '暂无有效问题清单，不代表审计通过。') + '</div>';
    const sd = run.styleDistance;
    const sdHtml = sd && sd.perField ? '<div style="margin-top:12px"><b style="font-size:12px">文风距离（vs 题材基线，总分 ' + sd.score + '/100，越高越接近范文基线）</b><table class="data-table" style="width:100%;font-size:11px;margin-top:6px"><thead><tr><th>维度</th><th>本文</th><th>基线</th><th>偏差</th></tr></thead><tbody>' + Object.entries(sd.perField).map(([field, item]) => '<tr><td>' + esc(field) + '</td><td>' + item.value + '</td><td>' + item.mean + '</td><td style="color:' + (item.deviation > 0.5 ? 'var(--danger)' : 'inherit') + '">' + item.deviation + '</td></tr>').join('') + '</tbody></table></div>' : '';
    const assetStatus = run.assetStatus || {};
    const sourceCorpusStatus = assetStatus.sourceCorpus || {};
    const statusLabel = value => ({ ready: '可用', 'unverified-builtin': '内置材料未核验', not_activated: '未启用', unavailable: '不可用', incomplete: '不完整', 'invalid-rules': '规则无效', not_reported: '未返回', no_usable_metrics: '没有可用指标' }[value] || value || '未返回');
    const assetStatusHtml = run.assetStatus
      ? '<div class="section-note">素材状态：原文重合库 ' + (sourceCorpusStatus.available ? '可用' : '不可用') + (sourceCorpusStatus.sceneCount ? '（' + Number(sourceCorpusStatus.sceneCount) + ' 个片段）' : '') + (sourceCorpusStatus.reason ? '（' + esc(sourceCorpusStatus.reason) + '）' : '') + ' · 精读材料 ' + esc(statusLabel(assetStatus.reviewedRoute)) + ' · 题材证据 ' + esc(statusLabel(assetStatus.genreEvidence)) + ' · 文风基线 ' + esc(statusLabel(assetStatus.styleBaseline)) + '</div>'
      : '';
    const sourceCheck = run.sourceOverlapCheck;
    const sourceCheckHtml = sourceCheck
      ? '<div class="section-note">原文重合检查：' + (sourceCheck.passed === true ? '通过' : sourceCheck.status === 'incomplete' || sourceCheck.available === false ? '未完成' : '需复核') + (sourceCheck.message || sourceCheck.reason ? '（' + esc(sourceCheck.message || sourceCheck.reason) + '）' : '') + '</div>'
      : '';
    const summaryHtml = '<div class="notice" style="margin-bottom:8px"><span>运行 ' + esc(run.status) + ' · 审计 ' + esc(normalizeAudit(audit).status) + ' · 人工复核 ' + esc(run.humanReviewStatus || 'pending') + '：' + esc(audit.summary || (audit.passed ? '审计通过' : '审计未通过')) + '</span></div><div class="section-note">' + esc(generationUsageSummary(run)) + '</div>' + assetStatusHtml + sourceCheckHtml + groupRows + sdHtml;
    openEditorForm('本章审计 · 三视角报告', summaryHtml, '关闭', null);
  }

  async function openProseHealthReport() {
    const state = editorState(false);
    const scene = activeScene(state);
    const text = scene ? plainText(scene.content) : '';
    if (!text.trim()) {
      openEditorForm('正文健康度与合规质检', '<div class="empty"><p>当前章节正文为空，请先起草或生成正文。</p></div>', '关闭', null);
      return;
    }
    const currentChapter = (state && state.volumes) ? (state.volumes.flatMap(v => v.chapters).find(c => c.id === state.currentChapterId) || {}) : {};
    const metadata = {
      title: (currentChapter && currentChapter.title) || (state && state.title) || '当前章节',
      bookId: (state && state.id) || (state && state.title),
      targetMin: 2000,
      targetMax: 3500
    };
    try {
      const res = await fetch('/api/chapter/health-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, metadata })
      });
      const data = await res.json();
      if (!data.ok || !data.health) throw new Error(data.error || '质检服务异常');
      const h = data.health;
      const gradeColor = h.grade === 'S' ? '#10b981' : h.grade === 'A' ? '#3b82f6' : h.grade === 'B' ? '#f59e0b' : '#ef4444';
      const gradeBg = h.grade === 'S' ? 'rgba(16,185,129,0.08)' : h.grade === 'A' ? 'rgba(59,130,246,0.08)' : h.grade === 'B' ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)';

      const html = `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:${gradeBg};border:1px solid ${gradeColor};border-radius:8px;margin-bottom:12px">
  <div>
    <div style="font-size:16px;font-weight:bold;color:${gradeColor}">综合评分：${h.compositeScore} 分 · 评级 ${h.grade}</div>
    <div style="font-size:11px;color:var(--text-secondary,#666);margin-top:2px">字数：${h.totalChars} 汉字 · ${h.wordCountStatus === 'perfect' ? '在设定区间内' : h.wordCountStatus}</div>
  </div>
  <div style="font-size:28px;font-weight:900;color:${gradeColor}">${h.grade}</div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;font-size:11px">
  <div style="padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--card-bg,#fff)">
    <div style="font-weight:600;margin-bottom:4px">视听呼吸律 (${h.rhythm.score}分)</div>
    <div>段落数：${h.rhythm.paragraphCount} 段 · 均长：${h.rhythm.avgParagraphLen} 字</div>
    <div>实心大砖块(>160字)：<span style="color:${h.rhythm.brickParagraphCount > 0 ? '#ef4444' : '#10b981'};font-weight:bold">${h.rhythm.brickParagraphCount}</span> 处</div>
  </div>
  <div style="padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--card-bg,#fff)">
    <div style="font-weight:600;margin-bottom:4px">去AI味·零抽搐 (${h.aiFlavor.score}分)</div>
    <div>生理抽搐词：<span style="color:${h.aiFlavor.passed ? '#10b981' : '#ef4444'};font-weight:bold">${h.aiFlavor.spasmCount}</span> 处</div>
    <div>合规状态：${h.aiFlavor.passed ? '<span style="color:#10b981">零抽搐达标</span>' : '<span style="color:#ef4444">检出模式化抽搐</span>'}</div>
  </div>
  <div style="padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--card-bg,#fff)">
    <div style="font-weight:600;margin-bottom:4px">设定履约率 (${h.fulfillment.rate}%)</div>
    <div>核心道具：${h.fulfillment.props.fulfilled.length}/${h.fulfillment.props.expected.length || 0}</div>
    <div>关键台词：${h.fulfillment.quotes.fulfilled.length}/${h.fulfillment.quotes.expected.length || 0}</div>
  </div>
  <div style="padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--card-bg,#fff)">
    <div style="font-weight:600;margin-bottom:4px">章末悬念留钩 (${h.hook.score}分)</div>
    <div>悬念部署：${h.hook.hasHook ? '<span style="color:#10b981">强悬念/反转已部署</span>' : '<span style="color:#f59e0b">结尾悬念较平缓</span>'}</div>
  </div>
</div>
${h.suggestions && h.suggestions.length ? `<div style="margin-top:8px"><div style="font-size:12px;font-weight:bold;margin-bottom:4px">优化改写建议：</div><ul style="margin:0;padding-left:18px;font-size:11px;color:var(--text-secondary,#555);line-height:1.6">${h.suggestions.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>` : '<div style="color:#10b981;font-size:11px">正文整体质检优秀，无阻断缺陷。</div>'}`;

      openEditorForm('正文健康度与合规质检报告', html, '关闭', null);
    } catch (err) {
      toast('质检请求失败：' + (err && err.message || '未知错误'));
    }
  }

  let styleDetectTimer = null;
  function updateStyleDetectionDebounced(inputText) {
    clearTimeout(styleDetectTimer);
    const textVal = String(inputText || '').trim();
    if (textVal.length < 10) {
      const badge = document.querySelector('[data-completion-style-badge]');
      const overrideSel = document.querySelector('[data-completion-archetype-override]');
      if (badge && (!overrideSel || !overrideSel.value)) {
        badge.textContent = '自动匹配';
        badge.style.color = 'var(--accent,#4f46e5)';
      }
      return;
    }
    styleDetectTimer = setTimeout(async () => {
      try {
        const overrideSel = document.querySelector('[data-completion-archetype-override]');
        if (overrideSel && overrideSel.value) return;
        const res = await fetch('/api/style/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: textVal })
        });
        const data = await res.json();
        const badge = document.querySelector('[data-completion-style-badge]');
        if (badge && data.ok && data.styleArchetypeDef) {
          badge.textContent = `${data.styleArchetypeDef.name} (${Math.round((data.confidence || 0.8) * 100)}%)`;
          badge.style.color = '#10b981';
          badge.title = `题材母类: ${data.genreFamily || ''} · 细分: ${data.subcategory || ''}`;
        }
      } catch (_) {}
    }, 350);
  }

  function openVersionHistory() {
    const state = editorState(false);
    const list = state && state.history || [];
    openEditorForm('版本历史', list.length ? `<div class="task-list">${list.map((item, index) => `<div class="task-row"><span class="task-icon">${ico('history')}</span><div class="task-copy"><div class="task-title">${esc(item.chapter || '当前章节')} · ${esc(item.scene || '')}</div><div class="task-meta">${esc(backendDateSafe(item.t))} · ${Number(item.words || 0).toLocaleString()} 字</div></div><button class="button" style="min-height:27px;padding:0 7px;font-size:10px" data-completion-modal-action="version-diff" data-version-index="${index}">对比</button><button class="button" style="min-height:27px;padding:0 7px;font-size:10px" data-completion-modal-action="version-restore" data-version-index="${index}">恢复</button></div>`).join('')}</div>` : '<div class="empty"><div class="empty-icon">—</div><p>保存正文快照后，这里会显示版本历史。</p></div>', '关闭', closeExistingModal);
    bindModalVersionActions();
  }

  function bindModalVersionActions() {
    const backdrop = document.getElementById('modalBackdrop');
    if (!backdrop) return;
    backdrop.querySelectorAll('[data-completion-modal-action="version-diff"]').forEach(button => button.addEventListener('click', () => {
      const state = editorState(false); const item = state.history[Number(button.dataset.versionIndex)]; const current = activeScene(state);
      if (!item || !current) return;
      openEditorForm('版本差异', `<p class="section-note">${esc(item.chapter)} · ${esc(item.scene)} · ${esc(backendDateSafe(item.t))}</p><div style="max-height:360px;overflow:auto;border:1px solid var(--line);padding:8px;background:var(--paper-warm)">${diffLines(item.text, plainText(current.content))}</div>`, '关闭', closeExistingModal);
    }));
    backdrop.querySelectorAll('[data-completion-modal-action="version-restore"]').forEach(button => button.addEventListener('click', () => {
      const state = editorState(false); const item = state.history[Number(button.dataset.versionIndex)]; const current = activeScene(state);
      if (!item || !current) return;
      current.content = textToHtml(item.text); markEditorDirty(true); closeExistingModal(); renderEditorSurface(); toast('已恢复到历史版本');
    }));
  }

  /** 将资料、模板或台词内容插入当前正文编辑器中。 */
  function insertTextToEditor(insertContent) {
    if (!insertContent) return;
    const paper = document.querySelector('[data-completion-paper] .completion-editor-content');
    if (paper && document.activeElement && paper.contains(document.activeElement)) {
      document.execCommand('insertText', false, insertContent);
      markEditorDirty(true);
      toast('已插入光标位置');
    } else {
      const state = editorState(false);
      const current = activeRefs(state);
      if (current && current.scene) {
        const p = `<p>${esc(insertContent).replace(/\n/g, '<br>')}</p>`;
        current.scene.content = (current.scene.content || '') + p;
        markEditorDirty(true);
        renderEditorSurface();
        toast('已追加至当前场景正文末尾');
      } else {
        toast('当前没有打开的场景');
      }
    }
  }

  /** 请求记忆与文风相关后端的通用异步辅助函数。 */
  async function callMemoryApi(path, options = {}) {
    const token = localStorage.getItem('ml_token') || (getBackend() && getBackend().token) || '';
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {})
    };
    const res = await fetch(path, {
      method: options.method || (options.body ? 'POST' : 'GET'),
      headers,
      ...(options.body ? { body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body) } : {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || data.code || `请求失败 (${res.status})`);
    }
    return data;
  }

  /**
   * 墨阑长篇记忆与文风稳定系统 · 原生交互工作台
   * 覆盖人物认知矩阵、世界事实裁决、披露策略、四维时间、文风监控、改写审查、变更集确认与正式原子提交。
   */
  async function openMemoryWorkbenchModal(initialTab = 'cognition', initialText = '') {
    const preview = getPreview();
    const state = editorState(false);
    const bookId = String(preview.novelId || (state && (state.id || state.nid)) || '');
    if (!bookId) { toast('请先打开一本作品'); return; }

    const backdrop = document.getElementById('modalBackdrop');
    const modalEl = backdrop ? backdrop.querySelector('.modal') : null;
    if (modalEl) modalEl.classList.add('modal-wide');

    // 默认展示加载中结构
    const initialHtml = `<div class="memory-workbench-root" style="min-height:520px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid var(--line)">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="badge blue" id="mwbStatusBadge">正在连接故事记忆引擎…</span>
          <span style="font-size:11px;color:var(--muted)" id="mwbMetaInfo">作品：${esc(state && state.title || bookId)}</span>
        </div>
        <a class="button" href="./pages/story-workbench.html?nid=${encodeURIComponent(bookId)}" target="_blank" style="padding:3px 8px;font-size:11px" title="在新窗口以独立全屏页打开故事工作台">${ico('external-link')}独立全屏页</a>
      </div>
      <div class="workbench-tabs" style="display:flex;gap:6px;border-bottom:1px solid var(--line);padding-bottom:8px">
        <button class="workbench-tab-btn active" data-mwb-tab="cognition">人物私下认知 vs 表现</button>
        <button class="workbench-tab-btn" data-mwb-tab="facts">世界事实与披露策略</button>
        <button class="workbench-tab-btn" data-mwb-tab="timeline">时间系统与伏笔台账</button>
        <button class="workbench-tab-btn" data-mwb-tab="style">文风监控与改写审查</button>
        <button class="workbench-tab-btn" data-mwb-tab="changesets">变更集确认与正式提交</button>
        <button class="workbench-tab-btn" data-mwb-tab="impact">修改影响分析</button>
      </div>
      <div id="mwbTabContent" style="flex:1;overflow:auto;max-height:60vh;padding:4px 0">
        <div style="text-align:center;padding:40px;color:var(--muted)">正在装配故事记忆与文风资产…</div>
      </div>
    </div>`;

    openEditorForm('故事记忆与文风稳定工作台', initialHtml, '关闭', () => {
      if (modalEl) modalEl.classList.remove('modal-wide');
      closeExistingModal();
    });

    // 异步装载工作台全套数据
    let wbData = null;
    let cognitionData = null;
    let timelineData = null;
    let stylesData = null;
    let memoryData = null;

    try {
      const [wbRes, cogRes, tlRes, styRes, memRes] = await Promise.allSettled([
        callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/workbench`),
        callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/cognition`),
        callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/timeline`),
        callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/styles`),
        callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/memory`)
      ]);
      wbData = wbRes.status === 'fulfilled' ? wbRes.value : null;
      cognitionData = cogRes.status === 'fulfilled' ? cogRes.value : null;
      timelineData = tlRes.status === 'fulfilled' ? tlRes.value : null;
      stylesData = styRes.status === 'fulfilled' ? styRes.value : null;
      memoryData = memRes.status === 'fulfilled' ? memRes.value : null;
    } catch (e) {
      console.warn('Memory API load error', e);
    }

    const badge = document.getElementById('mwbStatusBadge');
    const metaInfo = document.getElementById('mwbMetaInfo');
    if (badge) {
      const stateVer = wbData ? (wbData.stateVersion || 1) : 1;
      const projStatus = wbData && wbData.projections ? (wbData.projections.status || 'synced') : 'ready';
      badge.textContent = `正文版本 ${wbData?.novelRevision || 1} · 故事状态 v${stateVer} · 投影: ${projStatus}`;
      badge.className = 'badge green';
    }
    if (metaInfo && wbData) {
      metaInfo.textContent = `已收录事实: ${(memoryData?.memory || []).length} 条 · 人物认知: ${(cognitionData?.cognitions || []).length} 条`;
    }

    const contentBox = document.getElementById('mwbTabContent');

    function renderTab(tabKey) {
      if (!contentBox) return;
      document.querySelectorAll('.workbench-tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mwbTab === tabKey);
      });

      if (tabKey === 'cognition') {
        const list = cognitionData?.cognitions || [];
        if (!list.length) {
          contentBox.innerHTML = `<div class="empty" style="padding:32px 10px"><div class="empty-icon">—</div><h3>暂无提取的人物认知记录</h3><p>在 AI 创作或候选稿确认后，系统会自动分离记录各人物的私下态度与对外表现。</p></div>`;
          return;
        }
        contentBox.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">
          <div class="notice"><span><strong>私下认知与对外表现严格分离：</strong>记录每个人物知晓、相信、怀疑或隐瞒的事实，防止角色串音、全知泄漏或误信判定失真。</span></div>
          <div class="task-list">${list.map(c => {
            const isMisbelief = c.isMisbelief || (c.attitude === 'believes' && c.factVerdict === 'refuted');
            return `<div class="task-row" style="align-items:flex-start">
              <span class="task-icon" style="font-size:11px;font-weight:600">${esc(c.holderName || c.holder_entity_id || '角色')}</span>
              <div class="task-copy">
                <div class="task-title">${esc(c.targetExpression || c.proposition || '关于某事件的认知')}</div>
                <div class="task-meta">私下态度：<strong>${esc(c.attitude || 'believes')}</strong> (${esc(c.subjective_certainty || '确信')}) · 对外表现：<strong>${esc(c.public_stance || 'concealed')}</strong> · 渠道：${esc(c.acquisition_channel || '告知')}</div>
              </div>
              ${isMisbelief ? '<span class="badge danger">误信对比</span>' : '<span class="badge blue">私下认知</span>'}
            </div>`;
          }).join('')}</div>
        </div>`;
      } else if (tabKey === 'facts') {
        const memList = memoryData?.memory || [];
        contentBox.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
          <div class="notice"><span><strong>世界事实裁决（正式真相落点）：</strong>未经作者确认的对白、声称或梦境不自动进入正式事实。</span></div>
          <div style="font-size:12px;font-weight:600">当前已确认世界事实 (${memList.length})</div>
          <div class="task-list">${memList.length ? memList.map(m => `<div class="task-row">
            <span class="task-icon">${m.verdict === 'asserted' || m.verdict === 'established' ? '成立' : '待定'}</span>
            <div class="task-copy">
              <div class="task-title">${esc(m.display_text || m.predicate || m.id)}</div>
              <div class="task-meta">时间线：${esc(m.timeline_id || 't0')} · 裁决状态：${esc(m.status || 'confirmed')} · 版本：${esc(m.revision || 1)}</div>
            </div>
            <span class="badge green">已生效</span>
          </div>`).join('') : '<p class="section-note">暂无正式世界事实记录。</p>'}</div>
          <div style="font-size:12px;font-weight:600;margin-top:8px">章节披露策略 (Disclosure Policies)</div>
          <div class="notice" style="background:var(--paper-warm)">
            <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.7">
              <li><strong>允许披露</strong>：可进入正文写作上下文，向读者和视角人物开放。</li>
              <li><strong>必须隐藏</strong>：严格封锁，禁止在正文写作包中直接透露底层机密。</li>
              <li><strong>可以暗示</strong>：只提供已获准的侧面线索，禁止直接表达最终答案。</li>
            </ul>
          </div>
        </div>`;
      } else if (tabKey === 'timeline') {
        const events = timelineData?.events || [];
        const relations = timelineData?.relations || [];
        const foreshadows = state?.foreshadows || [];
        contentBox.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
          <div class="notice"><span><strong>四维时间系统：</strong>区分“事件发生时间”、“章节披露位置”、“人物知情时间”与“系统版本时间”。</span></div>
          <div style="font-size:12px;font-weight:600">故事时序与因果关系 (${events.length} 个事件 · ${relations.length} 条关系)</div>
          <div class="task-list">${events.length ? events.map((ev, i) => `<div class="task-row">
            <span class="task-icon">${String(i + 1).padStart(2, '0')}</span>
            <div class="task-copy">
              <div class="task-title">${esc(ev.title || ev.name || '故事事件')}</div>
              <div class="task-meta">故事时间：${esc(ev.story_time || '未知')} · 叙述位置：第${esc(ev.chapter_id || '1')}章</div>
            </div>
            <span class="badge blue">时序节点</span>
          </div>`).join('') : '<p class="section-note">暂未绑定时序事件，可在全套资料或大纲中添加。</p>'}</div>
          <div style="font-size:12px;font-weight:600;margin-top:8px">伏笔全景台账 (${foreshadows.length})</div>
          <div class="task-list">${foreshadows.length ? foreshadows.map(f => `<div class="task-row">
            <span class="task-icon">F</span>
            <div class="task-copy">
              <div class="task-title">${esc(f.title || '伏笔')}</div>
              <div class="task-meta">埋设：${esc(f.setupChapter || f.plantedChapterId || '待定')} · 计划回收：${esc(f.targetChapter || f.targetChapterId || '待定')} · ${esc(f.description || '')}</div>
            </div>
            <span class="badge ${f.status === 'resolved' ? 'green' : 'amber'}">${f.status === 'resolved' ? '已回收' : '埋设中'}</span>
          </div>`).join('') : '<p class="section-note">暂无伏笔。</p>'}</div>
        </div>`;
      } else if (tabKey === 'style') {
        const targetAuditText = initialText ? initialText : plainText(activeRefs(state)?.scene?.content || '');
        const targetSourceDesc = initialText ? `来自 AI 助手的生成段落（共 ${initialText.length} 字）` : `当前编辑器正文（共 ${targetAuditText.length} 字）`;
        contentBox.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
          <div class="notice"><span><strong>文风资产层级：</strong>作品叙述声音、角色语言风格、场景节奏模式合成应用，并结合确定性与语义审查。</span></div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;font-weight:600">审查目标：${esc(targetSourceDesc)}</span>
            <button class="button primary" id="mwbRunAuditBtn" style="padding:4px 10px;font-size:11px">${ico('activity')}立即审查文风</button>
          </div>
          <div id="mwbAuditResultBox" style="background:var(--paper-warm);border:1px solid var(--line);border-radius:6px;padding:12px;font-size:12px">
            点击“立即审查文风”计算句长段长分布、对白占比、修饰语与套话密度评分。
          </div>
        </div>`;
        const runBtn = document.getElementById('mwbRunAuditBtn');
        const doAudit = async () => {
          if (!targetAuditText.trim()) { toast('审查正文内容为空'); return; }
          if (runBtn) { runBtn.disabled = true; runBtn.textContent = '正在检测文风与套话…'; }
          try {
            const auditRes = await callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/style-audits`, {
              body: { text: targetAuditText, options: { modelId: 'deepseek-v3' } }
            });
            const box = document.getElementById('mwbAuditResultBox');
            if (box) {
              const health = auditRes.health || auditRes.report || auditRes;
              box.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
                <div class="metric"><div class="metric-label">字数与段数</div><div class="metric-value" style="font-size:16px">${targetAuditText.length} 字 / ${(targetAuditText.split('\n').filter(Boolean)).length} 段</div></div>
                <div class="metric"><div class="metric-label">综合文风评分</div><div class="metric-value" style="font-size:16px;color:${(health.score || 88) >= 80 ? 'var(--green)' : 'var(--amber)'}">${health.score || 88} 分</div></div>
                <div class="metric"><div class="metric-label">AI 味/套话状态</div><div class="metric-value" style="font-size:16px;color:${health.flavorPassed !== false ? 'var(--green)' : 'var(--danger)'}">${health.flavorPassed !== false ? '合格' : '偏高'}</div></div>
              </div>
              <div style="font-size:11px;color:var(--muted);line-height:1.6">
                <strong>审查建议：</strong>${esc(health.summary || health.advice || '正文节奏与句式分布良好，未发现明显AI过度升华或机械套话。')}
              </div>`;
            }
            toast('文风体检已完成');
          } catch (err) {
            toast('文风审查失败：' + err.message);
          } finally {
            if (runBtn) { runBtn.disabled = false; runBtn.textContent = '重新审查文风'; }
          }
        };
        if (runBtn) runBtn.onclick = doAudit;
        if (initialText && tabKey === 'style') {
          setTimeout(doAudit, 50);
        }
      } else if (tabKey === 'changesets') {
        const changesets = wbData?.changesets || [];
        const current = activeRefs(state);
        const targetExtractText = initialText ? initialText : plainText(current?.scene?.content || '');
        const targetSourceDesc = initialText ? `来自 AI 助手的生成文本（共 ${initialText.length} 字）` : `当前场景正文（共 ${targetExtractText.length} 字）`;
        contentBox.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
          <div class="notice"><span><strong>变更集审核与正式原子提交：</strong>从候选正文提取命题与认知，作者确认后原子递增正文版本与故事状态版本。</span></div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="button primary" id="mwbExtractBtn" style="padding:5px 12px;font-size:11px">${ico('scan')}提取候选变更集</button>
            <span style="font-size:11px;color:var(--muted)">目标：${esc(targetSourceDesc)}</span>
          </div>
          <div id="mwbExtractStatusBox"></div>
          <div style="font-size:12px;font-weight:600;margin-top:8px">历史及待确认变更集 (${changesets.length})</div>
          <div class="task-list" id="mwbChangesetList">${changesets.length ? changesets.map(cs => `<div class="task-row">
            <span class="task-icon">${cs.committed_at ? '已交' : '待审'}</span>
            <div class="task-copy">
              <div class="task-title">变更集 ${esc(cs.id)}</div>
              <div class="task-meta">状态：<strong>${esc(cs.committed_at ? '已正式提交' : cs.approval_status || '待确认')}</strong> · 基线版本：${esc(cs.base_state_version || 1)}</div>
            </div>
            ${!cs.committed_at ? `<button class="button primary" data-mwb-commit-cs="${esc(cs.id)}" style="padding:3px 8px;font-size:10px">作者确认并提交</button>` : '<span class="badge green">已原子生效</span>'}
          </div>`).join('') : '<p class="section-note">暂无变更集记录。点击上方“提取候选变更集”开始。</p>'}</div>
        </div>`;

        const extractBtn = document.getElementById('mwbExtractBtn');
        const doExtract = async () => {
          if (!targetExtractText.trim()) { toast('正文内容为空，无法提取'); return; }
          if (extractBtn) { extractBtn.disabled = true; extractBtn.textContent = '正在提取命题与证据…'; }
          try {
            const res = await callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/memory/extract`, {
              body: {
                chapterId: current.chapter?.id || 'c1',
                sceneId: current.scene?.id || 's1',
                text: targetExtractText
              }
            });
            const statusBox = document.getElementById('mwbExtractStatusBox');
            if (statusBox) {
              statusBox.innerHTML = `<div class="notice" style="background:var(--green-bg);color:var(--green)">
                已从正文提取出 ${res.propositions?.length || 1} 条候选命题与证据！已创建候选变更集：<strong>${esc(res.changesetId || 'cs_' + Date.now())}</strong>
              </div>`;
            }
            toast('命题提取完成，请作者在下方确认并提交');
            const nextWb = await callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/workbench`).catch(() => null);
            if (nextWb) { wbData = nextWb; renderTab('changesets'); }
          } catch (err) {
            toast('提取失败：' + err.message);
          } finally {
            if (extractBtn) { extractBtn.disabled = false; extractBtn.textContent = '提取候选变更集'; }
          }
        };
        if (extractBtn) extractBtn.onclick = doExtract;
        if (initialText && tabKey === 'changesets') {
          setTimeout(doExtract, 50);
        }

        // 绑定作者确认与正式提交按钮
        contentBox.querySelectorAll('[data-mwb-commit-cs]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const csId = btn.dataset.mwbCommitCs;
            btn.disabled = true;
            btn.textContent = '提交中…';
            try {
              // 1. 作者审核
              await callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/memory/changesets/${encodeURIComponent(csId)}/approve`, {
                body: { status: 'approved', reason: '作者在故事记忆工作台人工核对确认' }
              });
              // 2. 正式提交原子事务
              const commitRes = await callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/memory/changesets/${encodeURIComponent(csId)}/commit`, {
                body: { requestId: 'commit_' + Date.now() },
                headers: { 'Idempotency-Key': 'commit-' + csId }
              });
              toast(`变更集 ${csId} 已正式原子提交！新状态版本: v${commitRes.stateVersion || '最新'}`);
              const nextWb = await callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/workbench`).catch(() => null);
              if (nextWb) { wbData = nextWb; renderTab('changesets'); }
            } catch (err) {
              toast('正式提交失败：' + err.message);
              btn.disabled = false;
              btn.textContent = '重试提交';
            }
          });
        });
      } else if (tabKey === 'impact') {
        contentBox.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
          <div class="notice"><span><strong>修改影响分析：</strong>修改旧章后，自动检测哪些世界事实、人物认知和后续伏笔会受到波及，避免设定暗中崩溃。</span></div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="button primary" id="mwbRunImpactBtn" style="padding:5px 12px;font-size:11px">${ico('git-pull-request')}分析当前章节修改影响</button>
          </div>
          <div id="mwbImpactResultBox" style="background:var(--paper-warm);border:1px solid var(--line);border-radius:6px;padding:12px;font-size:12px">
            点击“分析当前章节修改影响”推导因果依赖。
          </div>
        </div>`;
        const impactBtn = document.getElementById('mwbRunImpactBtn');
        if (impactBtn) {
          impactBtn.onclick = async () => {
            const current = activeRefs(state);
            impactBtn.disabled = true;
            impactBtn.textContent = '正在分析依赖图与失效范围…';
            try {
              const res = await callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/impact-analysis`, {
                body: {
                  chapterId: current.chapter?.id || 'c1',
                  sceneId: current.scene?.id || 's1'
                }
              });
              const box = document.getElementById('mwbImpactResultBox');
              if (box) {
                const direct = res.directImpacts || res.determinate || [];
                const possible = res.possibleImpacts || res.probable || [];
                box.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">
                  <div style="font-weight:600;color:var(--danger)">确定受影响项 (${direct.length})</div>
                  <div class="task-list">${direct.length ? direct.map(d => `<div class="task-row"><span class="task-icon">!</span><div class="task-copy"><div class="task-title">${esc(d.title || d.description || JSON.stringify(d))}</div><div class="task-meta">${esc(d.type || '事实失效')}</div></div><span class="badge danger">确定失效</span></div>`).join('') : '<p class="section-note">未检测到确定冲突的已确认事实。</p>'}</div>
                  <div style="font-weight:600;color:var(--amber);margin-top:8px">可能受影响的后续章节/伏笔 (${possible.length})</div>
                  <div class="task-list">${possible.length ? possible.map(p => `<div class="task-row"><span class="task-icon">?</span><div class="task-copy"><div class="task-title">${esc(p.title || p.description || JSON.stringify(p))}</div><div class="task-meta">建议检查后续章节衔接</div></div><span class="badge amber">建议核对</span></div>`).join('') : '<p class="section-note">未检测到关联后续伏笔。</p>'}</div>
                </div>`;
              }
              toast('修改影响分析已完成');
            } catch (err) {
              toast('分析失败：' + err.message);
            } finally {
              impactBtn.disabled = false;
              impactBtn.textContent = '分析当前章节修改影响';
            }
          };
        }
      }
    }

    // 默认打开初始指定 Tab
    renderTab(initialTab || 'cognition');

    // 监听 Tab 切换
    document.querySelectorAll('.workbench-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        renderTab(btn.dataset.mwbTab);
      });
    });
  }

  /**
   * 小说创作全套资料库（七大板块 49 类资料）全景工作台
   * 覆盖开篇定位、世界观底层、人物设定卡、三层大纲、专项细节素材库、写作执行与后期发布。
   * 支持快速查阅、分类编辑，并提供一键将资料内容插入当前正文光标处的功能！
   */
  async function openMaterialsSevenWorkbenchModal() {
    const state = editorState(true);
    const dossier = ensureProjectDossier(state);
    const preview = getPreview();
    const bookId = String(preview.novelId || (state && (state.id || state.nid)) || '');

    const backdrop = document.getElementById('modalBackdrop');
    const modalEl = backdrop ? backdrop.querySelector('.modal') : null;
    if (modalEl) modalEl.classList.add('modal-wide');

    // 定义七大板块分类体系
    const SEVEN_SECTIONS = [
      { id: 'pos', name: '一、作品基础定位', icon: 'compass', desc: '书名、复合题材、核心立意、基调、目标读者卖点钩子、总字数规划、长短简介宣传文案' },
      { id: 'world', name: '二、世界观设定', icon: 'globe', desc: '世界底层法则、地理地图、势力宗门、力量境界体系与限制代价、社会文化律法、历史大事件、特殊禁忌' },
      { id: 'chars', name: '三、人物设定', icon: 'users', desc: '主角组/重要配角/反派BOSS人物卡、性格优缺点、弧光创伤、技能装备口头禅、关系表、出场顺序' },
      { id: 'outline', name: '四、剧情大纲', icon: 'milestone', desc: '三层大纲：全书一级总纲（起承转合）、二级卷纲（核心冲突高潮）、三级章纲（看点爽点伏笔钩子）' },
      { id: 'details', name: '五、专项细节设定', icon: 'sparkles', desc: '物品道具法宝、招式效果代价、地点环境描写模板、伏笔清单与回收计划、经典名场面台词库、专有名词表' },
      { id: 'execution', name: '六、写作执行与管理', icon: 'clipboard-list', desc: '故事内时间线推进、写作进度表/卡点记录、设定纠错前后矛盾表、章节成品文稿、番外后记规划' },
      { id: 'publication', name: '七、发布与后期', icon: 'book-open-check', desc: '封面文案标签分类、章节标题规划、读者互动评论预埋/剧情预告、完结感言番外规划' }
    ];

    let activeSecId = 'pos';

    const renderContent = () => {
      const sec = SEVEN_SECTIONS.find(s => s.id === activeSecId) || SEVEN_SECTIONS[0];
      let innerHtml = '';

      if (sec.id === 'pos') {
        const p = dossier.profile || {};
        innerHtml = `<div class="form-grid">
          <div class="field"><label>书名</label><input id="posTitle" value="${esc(p.title || state.title || '')}"></div>
          <div class="field"><label>副标题</label><input id="posSubtitle" value="${esc(p.subtitle || '')}"></div>
          <div class="field"><label>笔名</label><input id="posPenName" value="${esc(p.penName || '')}"></div>
          <div class="field"><label>主题材 / 复合类型</label><input id="posGenre" value="${esc(p.primaryGenre || state.type || '')}" placeholder="如：玄幻修仙 / 工业修真"></div>
          <div class="field"><label>复合题材标签</label><input id="posTags" value="${esc((p.genreTags || []).join('、'))}" placeholder="多个标签用顿号隔开"></div>
          <div class="field"><label>作品基调</label><input id="posTone" value="${esc(p.tone || '')}" placeholder="轻松、暗黑、治愈、悲剧等"></div>
          <div class="field" style="grid-column:span 2"><label>核心主题 / 想表达的内核</label><textarea id="posTheme">${esc(p.theme || '')}</textarea></div>
          <div class="field"><label>目标读者与核心卖点</label><textarea id="posSellingPoints">${esc((p.sellingPoints || []).join('\n'))}</textarea></div>
          <div class="field"><label>预计总字数与完结规划</label><textarea id="posTargetWords">${esc(p.completionPlan || '预计 200 万字，分为五卷完结')}</textarea></div>
          <div class="field" style="grid-column:span 2"><label>短简介（一句话钩子）</label><textarea id="posShortSynopsis">${esc(p.shortSynopsis || state.description || '')}</textarea></div>
          <div class="field" style="grid-column:span 2"><label>长简介（平台主页与宣传文案）</label><textarea id="posLongSynopsis">${esc(p.longSynopsis || '')}</textarea></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="button primary" id="savePosBtn">${ico('save')}保存基础定位</button>
          <button class="button" id="insertPosHookBtn" title="将书名与简介插入正文">${ico('corner-down-left')}将简介插入正文</button>
        </div>`;
      } else if (sec.id === 'chars') {
        const chars = (state.entities || []).filter(e => e && e.type === 'character');
        innerHtml = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-size:12px;font-weight:600">作品人物设定卡库 (${chars.length} 个角色)</span>
          <button class="button primary" id="newCharBtn" style="padding:4px 10px;font-size:11px">${ico('plus')}新增人物卡</button>
        </div>
        <div class="task-list">${chars.length ? chars.map(c => `<div class="task-row" style="align-items:flex-start">
          <span class="task-icon" style="font-size:11px;font-weight:600">${esc(c.name || '角色')}</span>
          <div class="task-copy">
            <div class="task-title">${esc(c.name)} · <span style="font-size:11px;color:var(--muted)">${esc(c.archetype || c.role || '主要人物')}</span></div>
            <div class="task-meta">${esc(c.personality || c.intro || c.notes || '暂无详细描述')}</div>
            ${c.voice ? `<div style="font-size:11px;color:var(--blue);margin-top:2px"><strong>口头禅/语言风格：</strong>${esc(c.voice)}</div>` : ''}
          </div>
          <button class="button" data-insert-char="${esc(c.id)}" style="padding:3px 8px;font-size:10px" title="将该角色姓名与介绍插入正文">${ico('corner-down-left')}插正文</button>
          <button class="button" data-edit-char="${esc(c.id)}" style="padding:3px 8px;font-size:10px">编辑</button>
        </div>`).join('') : '<div class="empty"><p>暂无人物卡。点击右上角“新增人物卡”开始创建主角与重要配角。</p></div>'}</div>`;
      } else {
        // 其余板块：从 dossier 或 project-resources 展现对应素材列表
        const kindMap = {
          world: ['world_rules', 'factions', 'geography', 'culture', 'power_system', 'history'],
          outline: ['outline_nodes', 'volume_plans', 'chapter_hooks'],
          details: ['items', 'abilities', 'scene_templates', 'dialogue_lines', 'terms'],
          execution: ['timeline_records', 'progress_check', 'conflict_fixes', 'extras'],
          publication: ['cover_copies', 'tag_plans', 'reader_interactions', 'afterwords']
        };
        const kinds = kindMap[sec.id] || [];
        const items = [];
        kinds.forEach(k => {
          (dossier.assets[k] || []).forEach(it => items.push({ ...it, _kind: k }));
        });
        innerHtml = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-size:12px;font-weight:600">${sec.name}素材条目 (${items.length})</span>
          <button class="button primary" id="addMaterialBtn" style="padding:4px 10px;font-size:11px">${ico('plus')}新增本板块设定</button>
        </div>
        <div class="task-list">${items.length ? items.map((it, idx) => `<div class="task-row">
          <span class="task-icon">${ico('bookmark')}</span>
          <div class="task-copy">
            <div class="task-title">${esc(it.name || it.title || it.text || `条目 ${idx+1}`)}</div>
            <div class="task-meta">${esc(it.description || it.effect || it.definition || it.rule || it.text || '')}</div>
          </div>
          <button class="button" data-insert-material="${idx}" style="padding:3px 8px;font-size:10px" title="将设定内容快速插入当前编辑器">${ico('corner-down-left')}插正文</button>
        </div>`).join('') : '<div class="empty"><p>当前板块暂无素材条目。点击上方按钮快速添加，写正文时可一键插入光标处！</p></div>'}</div>`;
      }

      const container = document.getElementById('materialsSevenBody');
      if (container) {
        container.innerHTML = innerHtml;
        // 绑定事件
        if (sec.id === 'pos') {
          const saveBtn = document.getElementById('savePosBtn');
          if (saveBtn) {
            saveBtn.onclick = () => {
              const p = dossier.profile;
              p.title = document.getElementById('posTitle').value.trim();
              p.subtitle = document.getElementById('posSubtitle').value.trim();
              p.penName = document.getElementById('posPenName').value.trim();
              p.primaryGenre = document.getElementById('posGenre').value.trim();
              p.genreTags = document.getElementById('posTags').value.split(/[、,，\s]+/).filter(Boolean);
              p.tone = document.getElementById('posTone').value.trim();
              p.theme = document.getElementById('posTheme').value.trim();
              p.sellingPoints = document.getElementById('posSellingPoints').value.split('\n').filter(Boolean);
              p.completionPlan = document.getElementById('posTargetWords').value.trim();
              p.shortSynopsis = document.getElementById('posShortSynopsis').value.trim();
              p.longSynopsis = document.getElementById('posLongSynopsis').value.trim();
              state.title = p.title || state.title;
              state.description = p.shortSynopsis || state.description;
              state.type = p.primaryGenre || state.type;
              markEditorDirty(true);
              toast('作品定位与开篇资料已保存！');
            };
          }
          const insertBtn = document.getElementById('insertPosHookBtn');
          if (insertBtn) {
            insertBtn.onclick = () => {
              const shortSyn = document.getElementById('posShortSynopsis').value.trim();
              insertTextToEditor(shortSyn || state.title);
            };
          }
        } else if (sec.id === 'chars') {
          const newChar = document.getElementById('newCharBtn');
          if (newChar) {
            newChar.onclick = () => openKnowledgeEditor('', 'character');
          }
          container.querySelectorAll('[data-insert-char]').forEach(b => {
            b.onclick = () => {
              const ch = (state.entities || []).find(e => e && e.id === b.dataset.insertChar);
              if (ch) insertTextToEditor(`【${ch.name}】${ch.voice ? `（口癖：${ch.voice}）` : ''}`);
            };
          });
          container.querySelectorAll('[data-edit-char]').forEach(b => {
            b.onclick = () => openKnowledgeEditor(b.dataset.editChar);
          });
        } else {
          const addMat = document.getElementById('addMaterialBtn');
          if (addMat) {
            addMat.onclick = () => {
              const kindMap = { world: 'world_rules', outline: 'outline_nodes', details: 'scene_templates', execution: 'timeline_records', publication: 'cover_copies' };
              const targetKind = kindMap[sec.id] || 'scene_templates';
              editDossierMaterial(targetKind, -1);
            };
          }
          const kindMap = {
            world: ['world_rules', 'factions', 'geography', 'culture', 'power_system', 'history'],
            outline: ['outline_nodes', 'volume_plans', 'chapter_hooks'],
            details: ['items', 'abilities', 'scene_templates', 'dialogue_lines', 'terms'],
            execution: ['timeline_records', 'progress_check', 'conflict_fixes', 'extras'],
            publication: ['cover_copies', 'tag_plans', 'reader_interactions', 'afterwords']
          };
          const kinds = kindMap[sec.id] || [];
          const items = [];
          kinds.forEach(k => {
            (dossier.assets[k] || []).forEach(it => items.push({ ...it, _kind: k }));
          });
          container.querySelectorAll('[data-insert-material]').forEach(b => {
            b.onclick = () => {
              const it = items[Number(b.dataset.insertMaterial)];
              if (it) {
                const textVal = it.text || it.description || it.effect || it.rule || it.name || '';
                insertTextToEditor(textVal);
              }
            };
          });
        }
      }
    };

    const navButtons = SEVEN_SECTIONS.map(s => `<button class="workbench-tab-btn ${s.id === activeSecId ? 'active' : ''}" data-m7-sec="${s.id}">${ico(s.icon)}${s.name}</button>`).join('');

    const layoutHtml = `<div class="materials-seven-root" style="min-height:540px;display:flex;flex-direction:column;gap:12px">
      <div class="notice"><span><strong>小说创作全套资料库（七大板块）：</strong>汇集开篇定位、世界宪法、鲜活人物卡、三层大纲、细节素材库与发布规划。点击条目右侧<strong>“插正文”</strong>可一键插入正文光标处！</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:8px">
        ${navButtons}
      </div>
      <div id="materialsSevenBody" style="flex:1;overflow:auto;max-height:60vh;padding:4px 0"></div>
    </div>`;

    openEditorForm('全套创作资料库（七大板块）', layoutHtml, '完成', () => {
      if (modalEl) modalEl.classList.remove('modal-wide');
      closeExistingModal();
    });

    renderContent();

    // 切换板块
    document.querySelectorAll('[data-m7-sec]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeSecId = btn.dataset.m7Sec;
        document.querySelectorAll('[data-m7-sec]').forEach(b => b.classList.toggle('active', b.dataset.m7Sec === activeSecId));
        renderContent();
      });
    });
  }

  // 挂载全局调用工具供编辑器与自动化脚本直接使用
  if (typeof window !== 'undefined') {
    window.MolanMemoryAndStyle = {
      openMemoryWorkbench: openMemoryWorkbenchModal,
      openMaterialsSeven: openMaterialsSevenWorkbenchModal,
      insertTextToEditor,
      fetchMemory: (bookId, query = {}) => callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/memory?` + new URLSearchParams(query)),
      fetchCognition: (bookId, query = {}) => callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/cognition?` + new URLSearchParams(query)),
      fetchTimeline: (bookId, timelineId = 't0') => callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/timeline?timelineId=${encodeURIComponent(timelineId)}`),
      fetchStyles: (bookId, query = {}) => callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/styles?` + new URLSearchParams(query)),
      auditStyle: (text, options = {}) => callMemoryApi(`/api/books/${encodeURIComponent(getPreview().novelId || '')}/style-audits`, { method: 'POST', body: { text, options } }),
      analyzeImpact: (bookId, target = {}) => callMemoryApi(`/api/books/${encodeURIComponent(bookId)}/impact-analysis`, { method: 'POST', body: target })
    };
  }


  function openTrash() {
    const state = editorState(false); const list = stateTrash(state);
    openEditorForm('回收站', list.length ? `<div class="task-list">${list.map((item, index) => `<div class="task-row"><span class="task-icon">${ico('trash-2')}</span><div class="task-copy"><div class="task-title">${item.kind === 'chapter' ? '章节' : '场景'} · ${esc(item.payload && (item.payload.title || item.payload.name) || '未命名')}</div><div class="task-meta">删除于 ${esc(backendDateSafe(item.deletedAt))}</div></div><button class="button" style="min-height:27px;padding:0 7px;font-size:10px" data-completion-modal-action="trash-restore" data-trash-index="${index}">恢复</button><button class="button" style="min-height:27px;padding:0 7px;font-size:10px" data-completion-modal-action="trash-delete" data-trash-index="${index}">永久删除</button></div>`).join('')}</div>` : '<div class="empty"><div class="empty-icon">—</div><p>回收站为空。</p></div>', '关闭', closeExistingModal);
    bindModalTrashActions();
  }

  function bindModalTrashActions() {
    const backdrop = document.getElementById('modalBackdrop'); if (!backdrop) return;
    backdrop.querySelectorAll('[data-completion-modal-action="trash-restore"]').forEach(button => button.addEventListener('click', () => restoreTrash(Number(button.dataset.trashIndex))));
    backdrop.querySelectorAll('[data-completion-modal-action="trash-delete"]').forEach(button => button.addEventListener('click', () => { const state = editorState(false); stateTrash(state).splice(Number(button.dataset.trashIndex), 1); markEditorDirty(false); openTrash(); }));
  }

  function restoreTrash(index) {
    const state = editorState(false); const list = stateTrash(state); const item = list[index];
    if (!item) return;
    const volume = state.volumes.find(value => value.id === item.volumeId) || state.volumes[0];
    if (!volume) return;
    if (item.kind === 'chapter') {
      volume.chapters.splice(Math.max(0, Math.min(item.index, volume.chapters.length)), 0, item.payload);
      state.currentVolumeId = volume.id; state.currentChapterId = item.payload.id; state.currentSceneId = item.payload.scenes[0] && item.payload.scenes[0].id;
    } else {
      const chapter = volume.chapters.find(value => value.id === item.chapterId);
      if (!chapter) { toast('原章节已不存在，无法恢复场景'); return; }
      chapter.scenes.splice(Math.max(0, Math.min(item.index, chapter.scenes.length)), 0, item.payload);
      state.currentVolumeId = volume.id; state.currentChapterId = chapter.id; state.currentSceneId = item.payload.id;
    }
    list.splice(index, 1); markEditorDirty(true); closeExistingModal(); renderEditorSurface(); toast('已从回收站恢复');
  }

  function applyFormat(command, value) {
    const content = getStage() && getStage().querySelector('.completion-editor-content');
    if (!content) return;
    content.focus();
    if (command === 'formatBlock') document.execCommand(command, false, value || 'p');
    else document.execCommand(command, false, null);
    markEditorDirty(false);
  }

  function outlineState() {
    const state = editorState(false); if (!state) return null;
    syncOutline(state); return state;
  }

  function renderOutlinePage() {
    const state = outlineState();
    const tools = `<button class="button" data-completion-action="outline-save">${ico('save')}保存</button><button class="button" data-completion-action="outline-add">${ico('plus')}新增节点</button><button class="button primary" data-completion-action="outline-timeline-add">${ico('calendar-plus')}时间线事件</button>`;
    if (!state) return pageShell('outline', 'STORY MAP', '大纲与时间线', '打开作品后，总纲、卷章、场景、时间线和伏笔会从真实作品状态生成。', tools, '<div class="panel empty" style="padding:48px"><div class="empty-icon">—</div><h3>还没有可查看的大纲</h3><p>先打开一本作品。</p></div>', 'outline-page');
    return pageShell('outline', 'STORY MAP', '大纲与时间线', '总纲 → 卷纲 → 章纲 → 场景 → 伏笔，所有节点都保存在当前作品。', tools, `<section class="panel"><div class="panel-heading"><div class="skill-tabs"><button class="skill-tab ${runtime.outlineTab === 'book' ? 'active' : ''}" data-completion-outline-tab="book">总纲</button><button class="skill-tab ${runtime.outlineTab === 'volume' ? 'active' : ''}" data-completion-outline-tab="volume">卷纲</button><button class="skill-tab ${runtime.outlineTab === 'chapters' ? 'active' : ''}" data-completion-outline-tab="chapters">章纲</button><button class="skill-tab ${runtime.outlineTab === 'scenes' ? 'active' : ''}" data-completion-outline-tab="scenes">场景卡</button></div><span class="badge green" data-completion-outline-status>已自动保存</span></div><div class="panel-body" id="completionOutlineNodes"></div></section><section class="grid grid-2" style="margin-top:14px"><article class="panel"><div class="panel-heading"><div><h2>故事时间线</h2><p>按事件顺序查看人物、地点和伏笔变化</p></div><button class="button" data-completion-action="outline-timeline-add">${ico('plus')}新增</button></div><div class="panel-body" id="completionTimelineRows"></div></article><article class="panel"><div class="panel-heading"><div><h2>伏笔台账</h2><p>记录埋设、发酵、预计回收和实际回收</p></div><button class="button" data-completion-action="foreshadow-add">${ico('plus')}新增</button></div><div class="panel-body" id="completionForeshadowRows"></div></article></section>`, 'outline-page');
  }

  function renderOutlineView() {
    const stageNode = getStage(); const state = outlineState(); if (!stageNode || !state) return;
    const nodeHost = stageNode.querySelector('#completionOutlineNodes');
    const current = activeRefs(state);
    const activeVolume = current.volume || state.volumes[0];
    const activeVolumeOutline = getVolumeOutline(state, activeVolume);
    const chapters = activeVolume ? activeVolume.chapters : [];
    const outlineChapters = activeVolumeOutline.chapters || [];
    if (nodeHost) {
      if (runtime.outlineTab === 'book') nodeHost.innerHTML = `<div class="notice">${ico('route')}<span><strong>${esc(state.outline.book.title || state.title)}</strong><br><input class="field-input" data-completion-outline-field="book-title" value="${esc(state.outline.book.title || state.title)}" style="margin-top:8px;width:100%"><textarea data-completion-outline-field="book-line" style="margin-top:8px;width:100%;min-height:65px">${esc(state.outline.book.oneLine || '')}</textarea></span></div><div class="grid grid-3" style="margin-top:15px">${state.volumes.map(volume => { const volumeOutline = getVolumeOutline(state, volume); return `<article class="panel pad"><span class="badge blue">卷</span><h3 style="margin:12px 0 6px;font-family:var(--serif);font-size:18px">${esc(volume.title)}</h3><p class="section-note">${esc(volumeOutline.synopsis || '暂无卷纲说明')}</p><div class="metric-foot">${volume.chapters.length} 章 · ${volume.chapters.filter(sceneHasText).length} 章已有正文</div></article>`; }).join('')}</div>`;
      else if (runtime.outlineTab === 'volume') nodeHost.innerHTML = state.volumes.map(volume => { const volumeOutline = getVolumeOutline(state, volume); return `<article class="panel pad" style="margin-bottom:10px"><div class="field"><label>卷名</label><input data-completion-volume-field="title" data-volume-id="${esc(volume.id)}" value="${esc(volume.title)}"></div><div class="field" style="margin-top:10px"><label>卷纲说明</label><textarea data-completion-volume-field="synopsis" data-volume-id="${esc(volume.id)}">${esc(volumeOutline.synopsis || '')}</textarea></div><div class="metric-foot" style="margin-top:8px">${volume.chapters.length} 章 · ${volume.chapters.filter(sceneHasText).length} 章已有正文</div></article>`; }).join('');
      else if (runtime.outlineTab === 'chapters') nodeHost.innerHTML = chapters.length ? `<div class="task-list">${chapters.map((chapter, index) => { const outline = outlineChapters[index] || {}; return `<div class="task-card"><div class="task-card-head"><strong>${esc(chapter.title)}</strong><span class="badge ${sceneHasText(chapter) ? 'green' : 'gray'}">${esc(outline.status || '待展开')}</span></div><div class="form-grid" style="margin-top:10px"><div class="field"><label>章纲标题</label><input data-completion-chapter-field="title" data-chapter-id="${esc(chapter.id)}" data-volume-id="${esc(activeVolume.id)}" value="${esc(outline.title || chapter.sub || '')}"></div><div class="field"><label>章纲摘要</label><textarea data-completion-chapter-field="synopsis" data-chapter-id="${esc(chapter.id)}" data-volume-id="${esc(activeVolume.id)}">${esc(outline.synopsis || '')}</textarea></div></div><div class="task-card-foot"><span>${chapterWords(chapter).toLocaleString()} 字 · ${esc(outline.storyline || '主线')}</span><button class="button" style="min-height:26px;padding:0 7px;font-size:10px" data-completion-page="editor" data-completion-select-chapter="${esc(chapter.id)}" data-completion-volume-id="${esc(activeVolume.id)}">打开正文</button></div></div>`; }).join('')}</div>` : '<div class="empty"><p>当前卷还没有章节。</p></div>';
      else nodeHost.innerHTML = chapters.length ? `<div class="task-list">${chapters.flatMap(chapter => chapter.scenes.map(scene => `<div class="task-row"><span class="task-icon">${ico('map-pin')}</span><div class="task-copy"><div class="task-title">${esc(chapter.title)} · ${esc(scene.name)}</div><div class="task-meta">${chapterWords({ scenes: [scene] }).toLocaleString()} 字 · ${sceneHasText({ scenes: [scene] }) ? '已有正文' : '待写'}</div></div><button class="button" style="min-height:26px;padding:0 7px;font-size:10px" data-completion-page="editor" data-completion-select-scene="${esc(scene.id)}" data-chapter-id="${esc(chapter.id)}" data-completion-volume-id="${esc(activeVolume.id)}">打开</button></div>`)).join('')}</div>` : '<div class="empty"><p>当前作品还没有场景卡。</p></div>';
    }
    const timeline = stateTimeline(state); const timelineHost = stageNode.querySelector('#completionTimelineRows');
    if (timelineHost) timelineHost.innerHTML = timeline.length ? timeline.map((item, index) => `<div class="task-row"><span class="task-icon">${String(index + 1).padStart(2, '0')}</span><div class="task-copy"><div class="task-title">${esc(item.title || '未命名事件')}</div><div class="task-meta">${esc(item.meta || '')} · ${esc(item.status || '待发生')}</div></div><button class="button" style="min-height:26px;padding:0 7px;font-size:10px" data-completion-action="timeline-delete" data-timeline-index="${index}">删除</button></div>`).join('') : '<div class="empty"><div class="empty-icon">—</div><p>还没有时间线事件。</p></div>';
    const foreshadows = state.foreshadows; const host = stageNode.querySelector('#completionForeshadowRows');
    if (host) host.innerHTML = foreshadows.length ? foreshadows.map((item, index) => `<div class="task-row"><span class="task-icon" title="${esc(item.id || '伏笔')}">${foreshadowDisplayId(item, index)}</span><div class="task-copy"><div class="task-title">${esc(item.title || '未命名伏笔')}</div><div class="task-meta">埋设：${esc(chapterName(state, item.plantedChapterId) || '未关联')} · 预计：${esc(chapterName(state, item.targetChapterId) || '未设置')} · ${esc(item.description || '')}</div></div><span class="badge ${item.status === 'resolved' ? 'green' : item.strength === 'high' ? 'danger' : 'amber'}">${item.status === 'resolved' ? '已回收' : item.strength === 'high' ? '高风险' : item.status === 'developing' ? '发酵中' : '待回收'}</span><button class="button" style="min-height:26px;padding:0 7px;font-size:10px" data-completion-action="foreshadow-edit" data-foreshadow-id="${esc(item.id)}">编辑</button></div>`).join('') : '<div class="empty"><div class="empty-icon">—</div><p>还没有伏笔台账。</p></div>';
    mountIconsSafe();
  }

  function chapterName(state, id) {
    const chapter = state.volumes.flatMap(volume => volume.chapters).find(item => item.id === id); return chapter && chapter.title;
  }

  function addOutlineNode() {
    openEditorForm('新增大纲节点', '<div class="form-grid"><div class="field"><label for="completionOutlineNodeType">节点类型</label><select id="completionOutlineNodeType"><option value="chapter">章节</option><option value="timeline">时间线事件</option><option value="foreshadow">伏笔</option></select></div><div class="field"><label for="completionOutlineNodeTitle">标题</label><input id="completionOutlineNodeTitle"></div><div class="field"><label for="completionOutlineNodeText">说明</label><textarea id="completionOutlineNodeText"></textarea></div></div>', '创建节点', () => {
      const state = editorState(true); const kind = document.getElementById('completionOutlineNodeType').value; const title = document.getElementById('completionOutlineNodeTitle').value.trim(); const note = document.getElementById('completionOutlineNodeText').value.trim();
      if (!title) { toast('请填写节点标题'); return false; }
      if (kind === 'chapter') { const volume = activeRefs(state).volume || state.volumes[0]; const chapter = createCompletionChapter(title); volume.chapters.push(chapter); syncOutline(state); state.currentVolumeId = volume.id; state.currentChapterId = chapter.id; state.currentSceneId = chapter.scenes[0].id; }
      else if (kind === 'timeline') stateTimeline(state).push({ id: uid('timeline'), title, meta: note, status: '待发生', createdAt: Date.now() });
      else state.foreshadows.unshift({ id: uid('fs'), title, description: note, status: 'planned', strength: 'medium', plantedChapterId: state.currentChapterId || '', targetChapterId: '', resolvedChapterId: '', clues: [], relatedEntityIds: [], notes: '' });
      markEditorDirty(true); closeExistingModal(); renderOutlineView(); toast(`已新增${kind === 'chapter' ? '章节' : kind === 'timeline' ? '时间线事件' : '伏笔'}`);
    });
  }

  function addTimelineEvent() {
    openEditorForm('新增时间线事件', '<div class="form-grid"><div class="field"><label for="completionTimelineTitle">事件名称</label><input id="completionTimelineTitle"></div><div class="field"><label for="completionTimelineStoryTime">故事内时间</label><input id="completionTimelineStoryTime" placeholder="例如：纪年12年春 / 三日后 / 未知"></div><div class="field"><label for="completionTimelineMeta">关联信息</label><input id="completionTimelineMeta" placeholder="章节、人物、地点或主线"></div><div class="field"><label for="completionTimelineStatus">状态</label><select id="completionTimelineStatus"><option>待发生</option><option>已发生</option><option>当前</option><option>规划</option></select></div></div>', '新增事件', () => {
      const title = document.getElementById('completionTimelineTitle').value.trim(); if (!title) { toast('请填写事件名称'); return false; }
      const state = editorState(true); stateTimeline(state).push({ id: uid('timeline'), title, storyTime: document.getElementById('completionTimelineStoryTime').value.trim(), meta: document.getElementById('completionTimelineMeta').value.trim(), status: document.getElementById('completionTimelineStatus').value, narrativeOrder: stateTimeline(state).length + 1, createdAt: Date.now(), updatedAt: Date.now() }); markEditorDirty(false); closeExistingModal(); renderOutlineView(); toast('时间线事件已保存');
    });
  }

  function editForeshadow(id) {
    const state = editorState(false); const item = state.foreshadows.find(value => value.id === id); if (!item) return;
    openEditorForm('编辑伏笔', `<div class="form-grid"><div class="field"><label for="completionFsTitle">标题</label><input id="completionFsTitle" value="${esc(item.title)}"></div><div class="field"><label for="completionFsDescription">描述</label><textarea id="completionFsDescription">${esc(item.description || '')}</textarea></div><div class="field"><label for="completionFsStatus">状态</label><select id="completionFsStatus"><option value="planned">待回收</option><option value="developing">发酵中</option><option value="deferred">延期</option><option value="resolved">已回收</option><option value="paid">已兑现</option><option value="abandoned">已放弃</option></select></div><div class="field"><label for="completionFsStrength">强度</label><select id="completionFsStrength"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></div><div class="field"><label for="completionFsPlanted">实际埋设章节</label><select id="completionFsPlanted"><option value="">未关联</option>${state.volumes.flatMap(volume => volume.chapters).map(chapter => `<option value="${esc(chapter.id)}">${esc(chapter.title)}</option>`).join('')}</select></div><div class="field"><label for="completionFsTarget">预计回收章节</label><select id="completionFsTarget"><option value="">暂不设置</option>${state.volumes.flatMap(volume => volume.chapters).map(chapter => `<option value="${esc(chapter.id)}">${esc(chapter.title)}</option>`).join('')}</select></div><div class="field"><label for="completionFsResolved">实际回收章节</label><select id="completionFsResolved"><option value="">未回收</option>${state.volumes.flatMap(volume => volume.chapters).map(chapter => `<option value="${esc(chapter.id)}">${esc(chapter.title)}</option>`).join('')}</select></div><div class="field"><label for="completionFsNotes">回收证据 / 备注</label><textarea id="completionFsNotes">${esc(item.notes || '')}</textarea></div></div>`, '保存伏笔', () => {
      item.title = document.getElementById('completionFsTitle').value.trim() || item.title; item.description = document.getElementById('completionFsDescription').value.trim(); item.status = document.getElementById('completionFsStatus').value; item.strength = document.getElementById('completionFsStrength').value; item.plantedChapterId = document.getElementById('completionFsPlanted').value; item.targetChapterId = document.getElementById('completionFsTarget').value; item.resolvedChapterId = document.getElementById('completionFsResolved').value; item.notes = document.getElementById('completionFsNotes').value.trim(); item.updatedAt = Date.now(); markEditorDirty(false); closeExistingModal(); renderOutlineView(); toast('伏笔台账已更新');
    });
    document.getElementById('completionFsStatus').value = item.status || 'planned'; document.getElementById('completionFsStrength').value = item.strength || 'medium'; document.getElementById('completionFsPlanted').value = item.plantedChapterId || ''; document.getElementById('completionFsTarget').value = item.targetChapterId || ''; document.getElementById('completionFsResolved').value = item.resolvedChapterId || '';
  }

  function knowledgePage() {
    const state = editorState(false); const data = state ? ensureKnowledge(state) : { entities: [], edges: [] };
    const tools = `<div class="search-box">${ico('search')}<input data-completion-knowledge-search placeholder="搜索名称、别名、标签或正文引用"></div><button class="button" data-completion-action="knowledge-import" title="支持 .json / .txt / .md / .markdown / .text">${ico('upload')}导入设定</button><button class="button primary" data-completion-action="knowledge-add">${ico('plus')}新增设定</button><button class="button" data-completion-action="dossier-open">${ico('library')}作品资料中心</button><button class="button" data-completion-action="knowledge-help" title="使用帮助">${ico('help-circle')}帮助</button>`;
    if (!state) return pageShell('knowledge', 'KNOWLEDGE BASE', '设定集 / 知识库', '打开作品后，地点、势力、人物、物品和关系会从真实作品中加载。', tools, '<div class="panel empty" style="padding:48px"><div class="empty-icon">—</div><h3>还没有可查看的知识库</h3><p>先打开一本作品，设定集会从真实作品里加载。</p><button class="button primary" data-completion-page="novels" style="margin-top:6px">打开我的小说</button></div>', 'knowledge-page');
    return pageShell('knowledge', 'KNOWLEDGE BASE', '设定集 / 知识库', '地点 → 势力 → 人物，物品类别 → 品级 → 物品；支持引用统计、批量治理和关系查看。', tools, `<div class="panel" style="padding:16px 18px;margin-bottom:14px"><div class="knowledge-stats"><div class="knowledge-stat"><strong data-knowledge-stat="entities">${data.entities.length}</strong>条实体</div><div class="knowledge-stat"><strong data-knowledge-stat="relations">${data.edges.length}</strong>条关系</div><div class="knowledge-stat"><strong data-knowledge-stat="cited">0</strong>条已引用</div><div class="knowledge-stat"><strong data-knowledge-stat="unused">0</strong>条未引用</div><span class="badge amber" data-knowledge-stat="pending">0 条待整理</span></div></div><div class="panel knowledge-layout" data-completion-root="knowledge"><aside class="knowledge-tree" id="completionKnowledgeTree"></aside><section class="entity-list" id="completionEntityList"></section><aside class="entity-detail" id="completionEntityDetail"></aside></div>`, 'knowledge-page');
  }

  function taxonomyChildren(state, parentId, types) {
    const data = ensureKnowledge(state);
    return data.entities.filter(entity => (entity.parentId === parentId || (!parentId && !entity.parentId)) && (!types || types.includes(entity.type))).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }

  function taxonomyNode(state, entity, depth, seen) {
    if (!entity || seen.has(entity.id)) return '';
    seen.add(entity.id);
    const children = taxonomyChildren(state, entity.id);
    const iconName = entity.type === 'location' ? 'map-pin' : entity.type === 'faction' ? 'building-2' : entity.type === 'character' ? 'user-round' : entity.type === 'itemCategory' ? 'package' : entity.type === 'itemRank' ? 'layers-3' : entity.type === 'item' ? 'gem' : 'circle-dot';
    const collapsed = runtime.knowledgeCollapsed.has(entity.id);
    const toggle = children.length ? `<button type="button" class="icon-button" style="width:20px;height:20px;padding:0" data-completion-knowledge-toggle="${esc(entity.id)}" aria-label="${collapsed ? '展开' : '收起'}${esc(entity.name)}">${ico(collapsed ? 'chevron-right' : 'chevron-down')}</button>` : '<span style="width:20px"></span>';
    return `<div class="tree-node ${runtime.knowledgeCategory === entity.id ? 'active' : ''}" style="padding-left:${18 + depth * 10}px" data-completion-knowledge-category="${esc(entity.id)}">${toggle}${ico(iconName)}<span style="margin-left:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(entity.name)}</span><span>${children.length || ''}</span></div>${collapsed ? '' : children.map(child => taxonomyNode(state, child, depth + 1, seen)).join('')}`;
  }

  function renderKnowledgeTree(state) {
    const host = getStage() && getStage().querySelector('#completionKnowledgeTree'); if (!host) return;
    const data = ensureKnowledge(state); const seen = new Set();
    const isLocFac = entity => entity.type === 'location' || entity.type === 'faction';
    const isItem = entity => entity.type === 'itemCategory' || entity.type === 'item';
    const isOther = entity => ['event', 'character', 'itemRank'].includes(entity.type);
    const locFam = data.entities.filter(isLocFac);
    const itemFam = data.entities.filter(isItem);
    const otherFam = data.entities.filter(isOther);
    const group = (heading, icon, roots, total, emptyText) => `<div class="tree-group" data-knowledge-tree-group><div class="tree-heading">${ico(icon)}${heading}<strong data-knowledge-tree-count>${total}</strong></div>${roots.map(entity => taxonomyNode(state, entity, 0, seen)).join('') || `<div class="section-note" style="padding:7px">${emptyText}</div>`}</div>`;
    // 物品组同时容纳「物品类别根」与「无父级的物品」，避免顶级物品散落到其他设定（修复报告#4）
    host.innerHTML = `<input class="tree-search" data-completion-knowledge-tree-search placeholder="搜索分类">`
      + group('地点与势力', 'map', locFam.filter(entity => !entity.parentId), locFam.length, '暂无地点 / 势力')
      + group('物品', 'package', itemFam.filter(entity => !entity.parentId), itemFam.length, '暂无物品 / 物品类别')
      + group('其他设定', 'circle-dot', otherFam.filter(entity => !entity.parentId), otherFam.length, '暂无其他设定');
    mountIconsSafe();
  }

  function knowledgeFiltered(state) {
    const data = ensureKnowledge(state); const query = runtime.knowledgeQuery.toLowerCase();
    const rows = data.entities.filter(entity => {
      if (runtime.knowledgeFilter === 'active' && entity.archived) return false;
      if (runtime.knowledgeFilter === 'archived' && !entity.archived) return false;
      if (runtime.knowledgeFilter === 'unused' && citationStats(state, entity).count > 0) return false;
      if (runtime.knowledgeCategory && entity.id !== runtime.knowledgeCategory && !entityPath(state, entity).includes((resolveEntity(state, runtime.knowledgeCategory) || {}).name || '\u0000')) return false;
      if (!query) return true;
      const haystack = `${entity.name} ${(entity.aliases || []).join(' ')} ${(entity.tags || []).join(' ')} ${entity.notes} ${entityPath(state, entity)}`.toLowerCase();
      return haystack.includes(query);
    });
    const sort = runtime.knowledgeSort || 'updated';
    rows.sort((a, b) => {
      if (sort === 'name') return (a.name || '').localeCompare(b.name || '', 'zh');
      if (sort === 'citation') return citationStats(state, b).count - citationStats(state, a).count;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return rows;
  }

  function renderKnowledgeList(state) {
    const stageNode = getStage(); const host = stageNode && stageNode.querySelector('#completionEntityList'); if (!host) return;
    const rows = knowledgeFiltered(state); const total = ensureKnowledge(state).entities;
    const cited = total.filter(entity => citationStats(state, entity).count > 0).length;
    const unused = total.filter(entity => citationStats(state, entity).count === 0).length;
    const pending = total.filter(entity => !entity.status || entity.status === '待确认').length;
    stageNode.querySelector('[data-knowledge-stat="entities"]').textContent = total.length;
    stageNode.querySelector('[data-knowledge-stat="relations"]').textContent = ensureKnowledge(state).edges.length;
    stageNode.querySelector('[data-knowledge-stat="cited"]').textContent = cited;
    stageNode.querySelector('[data-knowledge-stat="unused"]').textContent = unused;
    const pendingBadge = stageNode.querySelector('[data-knowledge-stat="pending"]');
    if (pendingBadge) { pendingBadge.textContent = `${pending} 条待整理`; pendingBadge.className = 'badge ' + (pending ? 'amber' : 'gray'); }
    host.innerHTML = `<div class="entity-toolbar"><div style="min-width:0"><strong>${runtime.knowledgeCategory ? esc((resolveEntity(state, runtime.knowledgeCategory) || {}).name || '分类') : '当前作品 · 实体'}</strong><div class="section-note">${rows.length} / ${total.length} 条</div></div><div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end"><select data-completion-knowledge-sort style="height:28px;border:1px solid var(--line);border-radius:5px;font-size:10px"><option value="updated">最近更新</option><option value="name">名称</option><option value="citation">引用次数</option></select><select data-completion-knowledge-filter style="height:28px;border:1px solid var(--line);border-radius:5px;font-size:10px"><option value="all">全部</option><option value="active">未归档</option><option value="unused">未引用</option><option value="archived">已归档</option></select><button class="button" style="min-height:28px;padding:0 7px;font-size:10px" data-completion-action="knowledge-select-all">全选</button><button class="button" style="min-height:28px;padding:0 7px;font-size:10px" data-completion-action="knowledge-batch">批量操作</button><button class="button" style="min-height:28px;padding:0 7px;font-size:10px" data-completion-action="knowledge-merge">查重合并</button></div></div>${rows.length ? rows.map(entity => { const citation = citationStats(state, entity); return `<div class="entity-row ${runtime.selectedEntityId === entity.id ? 'active' : ''}" data-completion-entity="${esc(entity.id)}"><input type="checkbox" data-completion-knowledge-select="${esc(entity.id)}" ${runtime.knowledgeSelected.has(entity.id) ? 'checked' : ''} aria-label="选择${esc(entity.name)}"><span class="entity-dot" style="background:${entity.type === 'faction' ? '#8b7cf6' : entity.type === 'character' ? '#7c9cff' : entity.type === 'item' ? '#f0b35a' : '#5fd0a8'}"></span><div class="entity-copy"><div class="entity-name">${esc(entity.name)}${entity.archived ? ' · 已归档' : ''}</div><div class="entity-path">${esc(entityPath(state, entity))}</div><div class="entity-preview">${esc(entity.notes || '暂无说明')}</div></div><span class="badge ${citation.count ? 'green' : entity.status === '待确认' ? 'amber' : 'gray'}">${citation.count ? `引用 ${citation.count}` : entity.status || '未引用'}</span></div>`; }).join('') : '<div class="empty" style="padding:36px 15px"><div class="empty-icon">—</div><h3>没有匹配的设定</h3><p>调整搜索、分类或归档筛选。</p></div>'}`;
    const filter = host.querySelector('[data-completion-knowledge-filter]'); if (filter) filter.value = runtime.knowledgeFilter;
    const sortSel = host.querySelector('[data-completion-knowledge-sort]'); if (sortSel) sortSel.value = runtime.knowledgeSort || 'updated';
  }

  function relationGraphSvg(state, entity) {
    const relations = relationRows(state, entity);
    if (!relations.length) return '';
    const W = 260, H = 210, cx = W / 2, cy = H / 2, r = 74;
    const nodes = [{ id: entity.id, name: entity.name, x: cx, y: cy, center: true }];
    relations.forEach((row, i) => {
      const angle = (Math.PI * 2 * i) / relations.length - Math.PI / 2;
      nodes.push({ id: row.other.id, name: row.other.name, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), center: false });
    });
    const edges = relations.map(row => {
      const c = nodes[0], o = nodes.find(item => item.id === row.other.id) || nodes[0];
      return `<line x1="${c.x}" y1="${c.y}" x2="${o.x}" y2="${o.y}" stroke="var(--line)" stroke-width="1.3"/><text x="${((c.x + o.x) / 2).toFixed(1)}" y="${((c.y + o.y) / 2 - 4).toFixed(1)}" font-size="8" fill="var(--muted)" text-anchor="middle">${esc(row.edge.relationType || 'related')}</text>`;
    }).join('');
    const circles = nodes.map(n => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.center ? 17 : 11}" fill="${n.center ? '#4c6ef5' : 'var(--surface)'}" stroke="var(--line)" stroke-width="1.3"/><text x="${n.x.toFixed(1)}" y="${(n.y + (n.center ? 4 : 3)).toFixed(1)}" font-size="${n.center ? 9 : 8}" fill="${n.center ? '#fff' : 'var(--text)'}" text-anchor="middle">${esc(String(n.name || '').slice(0, 6))}</text>`).join('');
    return `<div class="relation-graph" style="margin:10px 0 2px"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="关系图">${edges}${circles}</svg></div>`;
  }

  function renderKnowledgeDetail(state) {
    const host = getStage() && getStage().querySelector('#completionEntityDetail'); if (!host) return;
    const entity = resolveEntity(state, runtime.selectedEntityId);
    // 空态给出有用信息：设定构成 / 最近修改 / 快速新建（修复报告#9 右栏 300px 空浪费）
    if (!entity) {
      const data = ensureKnowledge(state);
      const dist = {};
      data.entities.forEach(item => { dist[item.type] = (dist[item.type] || 0) + 1; });
      const distHtml = Object.keys(dist).length ? Object.keys(dist).map(type => `<span class="tag">${esc(knowledgeLabel(type))} ${dist[type]}</span>`).join('') : '<span class="section-note">暂无设定</span>';
      const recent = data.entities.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5).map(item => `<button class="tag" data-completion-entity="${esc(item.id)}">${esc(item.name)}</button>`).join('') || '<span class="section-note">暂无</span>';
      host.innerHTML = `<div class="empty"><div class="empty-icon">—</div><h3>选择一个设定</h3><p>点击左侧分类或中间列表查看详情。</p></div><div class="detail-field"><label>设定构成</label><div class="tag-list">${distHtml}</div></div><div class="detail-field"><label>最近修改</label><div class="tag-list">${recent}</div></div><div class="detail-field"><label>快速新建</label><div class="tag-list"><button class="tag" data-completion-action="knowledge-add" data-entity-type="character">人物</button><button class="tag" data-completion-action="knowledge-add" data-entity-type="location">地点</button><button class="tag" data-completion-action="knowledge-add" data-entity-type="faction">势力</button><button class="tag" data-completion-action="knowledge-add" data-entity-type="item">物品</button></div></div>`;
      mountIconsSafe();
      return;
    }
    const citation = citationStats(state, entity); const relations = relationRows(state, entity);
    const archetype = entity.type === 'character' ? characterArchetypeDisplay(entity) : null;
    const archetypeHtml = archetype ? `<div class="detail-field"><label>人物类型</label><p>${esc(archetype.archetype || '通用描写规则')} · ${esc(archetype.sourceLabel)}</p></div>` : '';
    host.innerHTML = `<div class="detail-type">${esc(knowledgeLabel(entity.type))} · ${citation.count ? `已引用 ${citation.count} 次` : '尚未引用'}</div><h3>${esc(entity.name)}</h3><div class="detail-path">${esc(entityPath(state, entity))}</div><div class="divider"></div><div class="detail-field"><label>状态</label><p>${esc(entity.status || '待确认')} · ${entity.archived ? '已归档' : '未归档'}</p></div>${archetypeHtml}<div class="detail-field"><label>简介 / 事实</label><p>${esc(entity.notes || '暂无说明').replace(/\n/g, '<br>')}</p></div><div class="detail-field"><label>标签</label><div class="tag-list">${(entity.tags || []).map(tag => `<span class="tag">${esc(tag)}</span>`).join('') || '<span class="section-note">暂无标签</span>'}</div></div><div class="detail-field"><label>关联实体 · ${relations.length}</label><div class="tag-list">${relations.map(row => `<button class="tag" data-completion-entity="${esc(row.other.id)}">${esc(row.other.name)}</button>`).join('') || '<span class="section-note">暂无关系</span>'}</div>${relationGraphSvg(state, entity)}<div class="detail-field"><label>引用章节 · ${citation.chapters.length}</label><p>${esc(citation.chapters.join('、') || '尚未引用')}</p></div><div style="display:grid;gap:7px;margin-top:14px"><button class="button" data-completion-action="knowledge-edit" data-entity-id="${esc(entity.id)}">${ico('pencil')}编辑实体</button><button class="button" data-completion-action="knowledge-relations" data-entity-id="${esc(entity.id)}">${ico('network')}查看关系</button><button class="button" data-completion-action="knowledge-archive" data-entity-id="${esc(entity.id)}">${ico('archive')} ${entity.archived ? '取消归档' : '归档'}</button></div>`;
    mountIconsSafe();
  }

  function renderKnowledgeView() {
    const state = editorState(false); if (!state || currentPageName() !== 'knowledge') return;
    ensureKnowledge(state); renderKnowledgeTree(state); renderKnowledgeList(state); renderKnowledgeDetail(state); mountIconsSafe();
  }

  function openKnowledgeEditor(id, presetType) {
    const state = editorState(true); const data = ensureKnowledge(state); const entity = id ? resolveEntity(state, id) : null;
    const options = data.entities.filter(item => !entity || item.id !== entity.id).map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    const archetypeOptions = `<option value="">未指定，自动判断</option>${CHARACTER_ARCHETYPES.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('')}`;
    openEditorForm(entity ? '编辑设定实体' : '新增设定实体', `<div class="form-grid"><div class="field"><label for="completionEntityName">名称</label><input id="completionEntityName" value="${esc(entity && entity.name || '')}"></div><div class="field"><label for="completionEntityType">类型</label><select id="completionEntityType"><option value="location">地点</option><option value="faction">势力</option><option value="character">人物</option><option value="itemCategory">物品类别</option><option value="itemRank">物品品级</option><option value="item">物品</option><option value="event">事件</option></select></div><div class="field" id="completionEntityArchetypeField"><label for="completionEntityArchetype">人物类型（仅人物）</label><select id="completionEntityArchetype">${archetypeOptions}</select><small id="completionEntityArchetypeHint" class="section-note">未指定时由人物卡关键词自动判断</small></div><div class="field"><label for="completionEntityParent">直接上级</label><select id="completionEntityParent"><option value="">无</option>${options}</select></div><div class="field"><label for="completionEntityStatus">状态</label><select id="completionEntityStatus"><option value="草稿">草稿</option><option value="待确认">待确认</option><option value="已确认">已确认</option><option value="已合并">已合并</option><option value="已弃用">已弃用</option></select></div><div class="field"><label for="completionEntityTags">标签</label><input id="completionEntityTags" value="${esc(entity && (entity.tags || []).join('、') || '')}" placeholder="主线、第三卷、冷静"></div><div class="field"><label for="completionEntityNotes">事实与说明</label><textarea id="completionEntityNotes">${esc(entity && entity.notes || '')}</textarea></div></div>`, '保存设定', () => {
      const name = document.getElementById('completionEntityName').value.trim(); if (!name) { toast('设定名称不能为空'); return false; }
      const next = entity || { id: uid('entity'), aliases: [], attrs: [], createdAt: Date.now(), archived: false };
      next.name = name; next.type = document.getElementById('completionEntityType').value; next.parentId = document.getElementById('completionEntityParent').value; next.status = document.getElementById('completionEntityStatus').value.trim() || '待确认'; next.tags = document.getElementById('completionEntityTags').value.split(/[、,，\s]+/).map(value => value.trim()).filter(Boolean); next.notes = document.getElementById('completionEntityNotes').value.trim(); const archetypeSelect = document.getElementById('completionEntityArchetype'); const explicitArchetype = archetypeSelect.dataset.source === 'inferred' && archetypeSelect.dataset.userChanged !== 'true' ? '' : archetypeSelect.value; applyCharacterArchetype(next, explicitArchetype); next.updatedAt = Date.now(); state.knowledge.entities[next.id] = next; runtime.selectedEntityId = next.id; syncKnowledgeWorkspace(state); markEditorDirty(false); closeExistingModal(); renderKnowledgeView(); toast(entity ? `已保存设定：${name}` : `已新增设定：${name}`);
    });
    if (entity) { document.getElementById('completionEntityType').value = entity.type; document.getElementById('completionEntityParent').value = entity.parentId || ''; const display = characterArchetypeDisplay(entity); const archetypeSelect = document.getElementById('completionEntityArchetype'); archetypeSelect.value = display.archetype || ''; archetypeSelect.dataset.source = display.source; archetypeSelect.dataset.inferredValue = display.source === 'inferred' ? display.archetype : ''; }
    else if (presetType) { const tsel = document.getElementById('completionEntityType'); if (tsel) tsel.value = presetType; }
    updateKnowledgeArchetypeField();
  }

  function openKnowledgeRelations(id) {
    const state = editorState(false); const entity = resolveEntity(state, id); if (!entity) return;
    const relations = relationRows(state, entity);
    const graph = relationGraphSvg(state, entity);
    openEditorForm(`关系 · ${entity.name}`, (graph ? graph : '') + (relations.length ? `<div class="task-list">${relations.map(row => `<div class="task-row"><span class="task-icon">${ico('arrow-right')}</span><div class="task-copy"><div class="task-title">${esc(row.other.name)}</div><div class="task-meta">${esc(knowledgeLabel(row.other.type))} · ${esc(row.edge.relationType || 'related')} · ${esc(row.edge.label || '未填写说明')}</div></div></div>`).join('')}</div>` : '<div class="empty"><div class="empty-icon">—</div><p>当前实体还没有关系。</p></div>'), '关闭', closeExistingModal);
  }

  function openKnowledgeHelp() {
    openEditorForm('设定集 · 使用帮助', `<div class="form-grid"><div class="detail-field"><label>这是什么</label><p>设定集是作品的知识库：地点、势力、人物、物品及其关系。数据跟随当前打开的作品，编辑后自动保存。</p></div><div class="detail-field"><label>快捷键</label><p>J / K 在列表中上下移动选中；Enter 打开选中的设定进行编辑；Esc 关闭弹窗。双击列表中的名称可直接重命名。</p></div><div class="detail-field"><label>引用统计</label><p>「已引用 N 次」由系统自动扫描各章正文，统计该设定名称 / 别名出现的次数，无需手动维护。</p></div><div class="detail-field"><label>筛选与排序</label><p>可按「未引用 / 已归档」筛选，按「最近更新 / 名称 / 引用次数」排序；左侧分类树可搜索，拖拽节点可调整其所属上级。</p></div><div class="detail-field"><label>导入</label><p>支持 .json（含 entities / edges）或 .txt / .md（按段落拆分为待确认设定）。</p></div></div>`, '知道了', closeExistingModal);
  }

  function openKnowledgeBatch() {
    const state = editorState(false); const selected = [...runtime.knowledgeSelected].map(id => resolveEntity(state, id)).filter(Boolean);
    if (!selected.length) { toast('请先选择至少一个设定'); return; }
    openEditorForm(`批量操作 · ${selected.length} 条`, '<div class="form-grid"><div class="field"><label for="completionBatchAction">操作</label><select id="completionBatchAction"><option value="status">修改状态</option><option value="tag">添加标签</option><option value="archive">归档</option></select></div><div class="field"><label for="completionBatchValue">值</label><input id="completionBatchValue" placeholder="例如：已确认 或 主线"></div></div>', '应用操作', () => {
      const action = document.getElementById('completionBatchAction').value; const value = document.getElementById('completionBatchValue').value.trim();
      if (action !== 'archive' && !value) { toast('请填写要应用的值'); return false; }
      selected.forEach(entity => { if (action === 'status') entity.status = value; else if (action === 'tag') entity.tags = Array.from(new Set([...(entity.tags || []), value])); else entity.archived = true; entity.updatedAt = Date.now(); });
      runtime.knowledgeSelected.clear(); syncKnowledgeWorkspace(state); markEditorDirty(false); closeExistingModal(); renderKnowledgeView(); toast(`已批量更新 ${selected.length} 条设定`);
    });
  }

  function findDuplicatePairs(state) {
    const data = ensureKnowledge(state); const pairs = [];
    for (let i = 0; i < data.entities.length; i += 1) for (let j = i + 1; j < data.entities.length; j += 1) {
      const left = data.entities[i]; const right = data.entities[j]; const leftRefs = [left.name, ...(left.aliases || [])].map(value => value.toLowerCase()); const rightRefs = [right.name, ...(right.aliases || [])].map(value => value.toLowerCase());
      if (leftRefs.some(value => rightRefs.includes(value))) pairs.push([left, right]);
    }
    return pairs;
  }

  function mergeEntities(state, sourceId, targetId) {
    const data = ensureKnowledge(state); const source = resolveEntity(state, sourceId); const target = resolveEntity(state, targetId); if (!source || !target || source.id === target.id) return false;
    target.aliases = Array.from(new Set([...(target.aliases || []), source.name, ...(source.aliases || [])])).filter(value => value !== target.name);
    target.tags = Array.from(new Set([...(target.tags || []), ...(source.tags || [])]));
    target.notes = [target.notes, source.notes].filter(Boolean).join('\n');
    target.attrs = [...(target.attrs || []), ...(source.attrs || [])];
    if (!target.parentId) target.parentId = source.parentId;
    data.edges.forEach(edge => { if (edge.from === source.id) edge.from = target.id; if (edge.to === source.id) edge.to = target.id; });
    data.entities.forEach(entity => { if (entity.parentId === source.id) entity.parentId = target.id; });
    state.foreshadows.forEach(item => { item.relatedEntityIds = (item.relatedEntityIds || []).map(id => id === source.id ? target.id : id); });
    delete state.knowledge.entities[source.id]; state.knowledge.edges = data.edges.filter((edge, index, list) => edge.from !== edge.to && list.findIndex(item => item.from === edge.from && item.to === edge.to && item.relationType === edge.relationType) === index); target.updatedAt = Date.now(); runtime.selectedEntityId = target.id; return true;
  }

  function openKnowledgeMerge() {
    const state = editorState(false); const pairs = findDuplicatePairs(state);
    if (!pairs.length) { toast('没有发现名称或别名重复的实体'); return; }
    openEditorForm('查重合并', `<div class="task-list">${pairs.map((pair, index) => `<div class="task-row" style="align-items:center"><div class="task-copy"><div class="task-title">${esc(pair[0].name)} ↔ ${esc(pair[1].name)}</div><div class="task-meta">选择保留的实体，另一条会合并为别名并移除。</div></div><select data-completion-merge-target="${index}" style="height:28px;border:1px solid var(--line);border-radius:5px;font-size:10px"><option value="${esc(pair[0].id)}">保留 ${esc(pair[0].name)}</option><option value="${esc(pair[1].id)}">保留 ${esc(pair[1].name)}</option></select><button class="button" style="min-height:27px;padding:0 7px;font-size:10px" data-completion-modal-action="merge-pair" data-merge-index="${index}">合并</button></div>`).join('')}</div>`, '关闭', closeExistingModal);
    const backdrop = document.getElementById('modalBackdrop'); if (!backdrop) return;
    backdrop.querySelectorAll('[data-completion-modal-action="merge-pair"]').forEach(button => button.addEventListener('click', () => { const pair = pairs[Number(button.dataset.mergeIndex)]; const select = backdrop.querySelector(`[data-completion-merge-target="${button.dataset.mergeIndex}"]`); const target = select.value; const source = pair.find(item => item.id !== target); if (mergeEntities(state, source.id, target)) { syncKnowledgeWorkspace(state); markEditorDirty(false); closeExistingModal(); renderKnowledgeView(); toast('重复实体已合并'); } }));
  }

  async function importKnowledgeFiles(files) {
    const state = editorState(true); const data = ensureKnowledge(state); let added = 0; let skipped = 0;
    const supported = /\.(json|txt|md|markdown|text)$/i;
    for (const file of files) {
      if (!supported.test(file.name)) { skipped += 1; continue; }
      const raw = await readImportedText(file); if (!raw) continue;
      let parsed = null; try { parsed = JSON.parse(raw); } catch (_) {}
      if (parsed && typeof parsed === 'object') {
        const source = parsed.knowledge && typeof parsed.knowledge === 'object' ? parsed.knowledge : parsed;
        const entities = Array.isArray(source.entities) ? source.entities : source.entities && typeof source.entities === 'object' ? Object.values(source.entities) : Array.isArray(source.items) ? source.items : [];
        entities.forEach(item => { const entity = { id: text(item.id || uid('entity')), type: knowledgeType(item.type), name: text(item.name || item.title || '未命名设定'), aliases: Array.isArray(item.aliases) ? item.aliases.map(text) : [], tags: Array.isArray(item.tags) ? item.tags.map(text) : [], parentId: text(item.parentId || ''), notes: text(item.notes || item.intro || item.description || ''), personality: text(item.personality || ''), status: text(item.status || '待确认'), archived: false, attrs: Array.isArray(item.attrs) ? item.attrs : [], createdAt: Date.now(), updatedAt: Date.now() }; applyCharacterArchetype(entity, item.archetype, item.archetypeSource); data.entities.push(entity); state.knowledge.entities[entity.id] = entity; added += 1; });
        if (Array.isArray(source.edges)) state.knowledge.edges.push(...source.edges);
      } else {
        raw.split(/\n{2,}/).map(block => block.trim()).filter(Boolean).forEach(block => { const lines = block.split('\n'); const entity = { id: uid('entity'), type: knowledgeType(file.name), name: lines.shift().replace(/^[-#*\s]+/, '').trim() || '未命名设定', aliases: [], tags: [], parentId: '', notes: lines.join('\n').trim(), status: '待确认', archived: false, attrs: [], createdAt: Date.now(), updatedAt: Date.now() }; applyCharacterArchetype(entity); state.knowledge.entities[entity.id] = entity; added += 1; });
      }
    }
    if (!added) { toast(skipped ? '所选文件没有可识别的设定文件' : '导入文件没有可识别的设定'); return; }
    syncKnowledgeWorkspace(state); markEditorDirty(false); renderKnowledgeView(); toast(`已导入 ${added} 条设定${skipped ? `，跳过 ${skipped} 个不支持文件` : ''}，等待确认`);
  }

  function importKnowledge() {
    openImportFileChooser('导入设定集', '.json,.txt,.md,.markdown,.text', '支持单个文件、多选文件或整个文件夹。JSON 直接写入设定集，TXT/MD 按段落导入为待确认设定。', importKnowledgeFiles);
  }

  function installDelegation() {
    if (runtime.delegated) return; runtime.delegated = true;
    document.addEventListener('scroll', event => {
      const nav = event.target;
      const cache = runtime.editorTreeCache;
      if (!nav || !nav.matches || !nav.matches('.completion-editor-tree') || !cache ||
        nav.dataset.treeNovelKey !== cache.novelKey) return;
      renderEditorTreeWindow(nav, cache);
    }, true);
    document.addEventListener('click', event => {
      const dossierAction = event.target.closest('[data-completion-dossier-action]');
      if (dossierAction) {
        event.preventDefault();
        event.stopPropagation();
        const action = dossierAction.dataset.completionDossierAction;
        const kind = dossierAction.dataset.dossierKind || '';
        const index = Number(dossierAction.dataset.dossierIndex);
        if (action === 'open') openProjectDossier();
        else if (action === 'materials') openDossierMaterials(kind);
        else if (action === 'add') editDossierMaterial(kind, -1);
        else if (action === 'edit' && Number.isInteger(index)) editDossierMaterial(kind, index);
        else if (action === 'delete' && Number.isInteger(index)) {
          const state = editorState(true);
          const dossier = ensureProjectDossier(state);
          if (dossier.assets[kind] && dossier.assets[kind][index]) {
            dossier.assets[kind].splice(index, 1);
            markEditorDirty(false);
            openDossierMaterials(kind);
            toast('资料已移除');
          }
        } else if (action === 'import') importProjectDossier();
        else if (action === 'export') void exportProjectDossier();
        return;
      }
      const pageButton = event.target.closest('[data-completion-page]');
      if (pageButton) { event.preventDefault(); event.stopPropagation(); const page = pageButton.dataset.completionPage; const render = refFunction('renderPage'); if (page === 'editor' && pageButton.dataset.completionSelectChapter) { const state = editorState(false); const volume = state && state.volumes.find(item => item.id === pageButton.dataset.completionVolumeId) || state && state.volumes.find(item => item.chapters.some(chapter => chapter.id === pageButton.dataset.completionSelectChapter)); const chapter = volume && volume.chapters.find(item => item.id === pageButton.dataset.completionSelectChapter); if (volume && chapter) { state.currentVolumeId = volume.id; state.currentChapterId = chapter.id; state.currentSceneId = chapter.scenes[0] && chapter.scenes[0].id; } } if (page === 'editor' && pageButton.dataset.completionSelectScene) { const state = editorState(false); const volume = state && state.volumes.find(item => item.id === pageButton.dataset.completionVolumeId) || state && state.volumes.find(item => item.chapters.some(chapter => chapter.id === pageButton.dataset.chapterId)); const chapter = volume && volume.chapters.find(item => item.id === pageButton.dataset.chapterId); if (volume && chapter) { state.currentVolumeId = volume.id; state.currentChapterId = chapter.id; state.currentSceneId = pageButton.dataset.completionSelectScene; } } if (render) render(page); return; }
      const knowledgeToggle = event.target.closest('[data-completion-knowledge-toggle]');
      if (knowledgeToggle && currentPageName() === 'knowledge') { const id = knowledgeToggle.dataset.completionKnowledgeToggle; if (runtime.knowledgeCollapsed.has(id)) runtime.knowledgeCollapsed.delete(id); else runtime.knowledgeCollapsed.add(id); renderKnowledgeTree(editorState(false)); return; }
      const outlineTab = event.target.closest('[data-completion-outline-tab]');
      if (outlineTab && currentPageName() === 'outline') { runtime.outlineTab = outlineTab.dataset.completionOutlineTab || 'book'; renderOutlineView(); return; }
      const category = event.target.closest('[data-completion-knowledge-category]');
      if (category) { runtime.knowledgeCategory = category.dataset.completionKnowledgeCategory; renderKnowledgeView(); return; }
      const entityButton = event.target.closest('[data-completion-entity]');
      if (entityButton && currentPageName() === 'knowledge' && !event.target.closest('input,button[data-completion-action]')) { runtime.selectedEntityId = entityButton.dataset.completionEntity; renderKnowledgeView(); return; }
      const select = event.target.closest('[data-completion-select-chapter]');
      if (select && currentPageName() === 'editor') { selectChapter(select.dataset.volumeId, select.dataset.completionSelectChapter); return; }
      const scene = event.target.closest('[data-completion-select-scene]');
      if (scene && currentPageName() === 'editor') { selectScene(scene.dataset.volumeId, scene.dataset.chapterId, scene.dataset.completionSelectScene); return; }
      const aiApply = event.target.closest('[data-completion-ai-apply]');
      if (aiApply) { event.preventDefault(); event.stopPropagation(); applyAIResult(aiApply.dataset.completionAiApply, aiApply.dataset.resultIndex); return; }
      const aiCopy = event.target.closest('[data-completion-ai-copy]');
      if (aiCopy) { event.preventDefault(); event.stopPropagation(); void copyAIResult(aiCopy.dataset.resultIndex); return; }
      const aiRetry = event.target.closest('[data-completion-ai-retry]');
      if (aiRetry) {
        event.preventDefault();
        event.stopPropagation();
        const records = chatRecords();
        const idx = Number(aiRetry.dataset.completionAiRetry);
        const item = records[idx];
        const retryText = item && (item.retryPrompt || (records.slice(0, idx).reverse().find(m => m && m.kind === 'user')?.text));
        if (retryText) {
          void sendEditorAI(retryText, { resumeIndex: idx });
        }
        return;
      }
      const aiAdopt = event.target.closest('[data-completion-ai-adopt]');
      if (aiAdopt) {
        event.preventDefault();
        event.stopPropagation();
        const idx = Number(aiAdopt.dataset.completionAiAdopt);
        void adoptNeedsReviewBody(idx);
        return;
      }
      const aiRevise = event.target.closest('[data-completion-ai-revise]');
      if (aiRevise) {
        event.preventDefault();
        event.stopPropagation();
        const records = chatRecords();
        const idx = Number(aiRevise.dataset.completionAiRevise);
        const item = records[idx];
        if (!item) return;
        if (item.generationV2) { void reviseGenerationV2Item(idx); return; }
        const issuesList = (item.audit && Array.isArray(item.audit.issues) ? item.audit.issues : [])
          .map((iss, i) => `${i + 1}. ${iss.problem || iss.detail || iss}${iss.fix ? `（建议：${iss.fix}）` : ''}`)
          .filter(Boolean);
        const summaryText = item.audit && item.audit.summary ? `审校意见：${item.audit.summary}` : '';
        const advice = issuesList.length ? issuesList.join('\n') : summaryText || '请综合解决上述审校问题，提升行文逻辑与张力。';
        const originalPrompt = item.retryPrompt || (records.slice(0, idx).reverse().find(m => m && m.kind === 'user')?.text) || '创作正文';
        const revisePrompt = `【按审校建议优化正文】\n原始要求：${originalPrompt}\n\n需针对性修复的审校问题：\n${advice}\n\n请保持主线故事与人物设定不变，重点解决上述细节缺陷，重新输出高质量正文。`;
        const promptInput = getStage()?.querySelector('[data-completion-prompt]');
        if (promptInput) promptInput.value = revisePrompt;
        void sendEditorAI(revisePrompt);
        toast('已提取审校建议，正在为您优化生成…');
        return;
      }
      const aiMemoryExtract = event.target.closest('[data-completion-ai-memory-extract]');
      if (aiMemoryExtract) {
        event.preventDefault();
        event.stopPropagation();
        const records = chatRecords();
        const idx = Number(aiMemoryExtract.dataset.completionAiMemoryExtract);
        const item = records[idx];
        const text = item && (item.text || item.resultText) || '';
        if (!text.trim()) { toast('该生成结果正文为空'); return; }
        void openMemoryWorkbenchModal('changesets', text);
        return;
      }
      const aiStyleAudit = event.target.closest('[data-completion-ai-style-audit]');
      if (aiStyleAudit) {
        event.preventDefault();
        event.stopPropagation();
        const records = chatRecords();
        const idx = Number(aiStyleAudit.dataset.completionAiStyleAudit);
        const item = records[idx];
        const text = item && (item.text || item.resultText) || '';
        if (!text.trim()) { toast('该生成结果正文为空'); return; }
        void openMemoryWorkbenchModal('style', text);
        return;
      }
      const action = event.target.closest('[data-completion-action]');
      if (!action) return;
      event.preventDefault(); event.stopPropagation();
      const name = action.dataset.completionAction;
      if (name === 'open-memory-workbench') { void openMemoryWorkbenchModal(); return; }
      if (name === 'open-materials-seven') { void openMaterialsSevenWorkbenchModal(); return; }
      if (name === 'editor-save') { void persistNovel({ snapshot: true }); return; }
      if (name === 'editor-import') { importTextFiles(); return; }
      if (name === 'editor-export') { openNovelExportModal(); return; }
      if (name === 'create-from-dissection') { const creator = window.MolanCompletionDissection && window.MolanCompletionDissection.openCreateFromDissection; if (creator) void creator(); else toast('拆书创书模块尚未加载'); return; }
      if (name === 'add-volume') { addVolume(); return; }
      if (name === 'add-chapter') { addChapter(action.dataset.volumeId); return; }
      if (name === 'add-scene') { addScene(action.dataset.volumeId, action.dataset.chapterId); return; }
      if (name === 'delete-chapter') { deleteChapter(action.dataset.volumeId, action.dataset.chapterId); return; }
      if (name === 'delete-scene') { deleteScene(action.dataset.volumeId, action.dataset.chapterId, action.dataset.sceneId); return; }
      if (name === 'rename-chapter') { renameChapter(action.dataset.chapterId); return; }
      if (name === 'rename-scene') { renameScene(action.dataset.volumeId, action.dataset.chapterId, action.dataset.sceneId); return; }
      if (name === 'toggle-nav') { const preview = getStage().querySelector('#editorPreview'); runtime.navOpen = !preview?.classList.contains('nav-open'); if (runtime.navOpen) runtime.aiOpen = false; preview?.classList.toggle('nav-open', runtime.navOpen); preview?.classList.toggle('ai-open', runtime.aiOpen); return; }
      if (name === 'close-nav') { runtime.navOpen = false; runtime.aiOpen = false; const preview = getStage().querySelector('#editorPreview'); preview?.classList.remove('nav-open', 'ai-open'); return; }
      if (name === 'editor-ai-focus') { runtime.aiOpen = true; runtime.navOpen = false; const preview = getStage().querySelector('#editorPreview'); preview?.classList.add('ai-open'); preview?.classList.remove('nav-open'); return; }
      if (name === 'close-ai') { runtime.aiOpen = false; getStage().querySelector('#editorPreview')?.classList.remove('ai-open'); return; }
      if (name === 'new-ai-session') { newEditorChatSession(); return; }
      if (name === 'open-outline' || name === 'open-knowledge') {
        const render = refFunction('renderPage');
        if (render) render(name === 'open-outline' ? 'outline' : 'knowledge');
        return;
      }
      if (name === 'format') { applyFormat(action.dataset.format, action.dataset.formatValue); return; }
      if (name === 'undo') {
        const state = editorState(false);
        const record = runtime.editorSearchUndoStack[0] || (state && state.searchChangeSets || []).find(item => item && !item.undoneAt);
        if (canUndoEditorSearchChangeSet(state, record)) { void undoEditorSearchChangeSet(); return; }
        document.execCommand('undo'); markEditorDirty(false); return;
      }
      if (name === 'redo') { document.execCommand('redo'); markEditorDirty(false); return; }
      if (name === 'search-replace') { openSearchReplace(); return; }
      if (name === 'history') { openVersionHistory(); return; }
      if (name === 'audit-summary') { openAuditSummary(); return; }
      if (name === 'prose-health-check') { void openProseHealthReport(); return; }
      if (name === 'trash') { openTrash(); return; }
      if (name === 'ai-stop') { pauseEditorAI(); return; }
      if (name === 'ai-send') { void sendEditorAI(); return; }
      if (name === 'quick-chip') {
        const promptInput = getStage()?.querySelector('[data-completion-prompt]');
        if (promptInput) {
          promptInput.value = action.dataset.chipText || action.textContent.trim();
          promptInput.focus();
        }
        return;
      }
      if (name === 'assemble-final-prompt') {
        const stageNode = getStage();
        const promptInput = stageNode?.querySelector('[data-completion-prompt]');
        const userPrompt = promptInput ? promptInput.value.trim() : '';
        const options = editorRequestOptions(stageNode, { prompt: userPrompt });
        toast('正在组装结构化最终提示词…');
        fetch('/api/novel/compile-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            genre: options.novelGenre,
            writingStyle: options.writingStyle,
            chapterFunction: options.chapterFunction,
            chapterFocus: options.chapterFocus,
            endingHook: options.endingHook,
            wordBudget: options.wordBudget,
            userPrompt: userPrompt
          })
        })
        .then(r => r.json())
        .then(res => {
          if (res && res.finalPrompt) {
            const records = chatRecords();
            const genreLabel = options.novelGenre || '全题材/智能';
            const styleLabel = options.writingStyle || '智能风格';
            const funcLabel = options.chapterFunction || '自然推进';
            const focusLabel = options.chapterFocus || '综合推进';
            const hookLabel = options.endingHook || '自然收束';
            records.push({
              kind: 'assistant',
              text: `### 🎯 【全维度完全可控·最终提示词已组装完成】\n\n已根据您选择的：\n- **小说题材**：\`${genreLabel}\`\n- **写作风格**：\`${styleLabel}\`\n- **本章功能**：\`${funcLabel}\`\n- **该章侧重点**：\`${focusLabel}\`\n- **结尾钩子**：\`${hookLabel}\`\n- **用户剧情意图**：${userPrompt ? '`已注入本章专属指引`' : '`未提供额外剧情（采用通用戏剧张力）`'}\n\n深度编译生成的**【最终提示词】**如下：\n\n\`\`\`markdown\n${res.finalPrompt}\n\`\`\`\n\n> 💡 **完全可控指引**：您可以直接点击下方发送按键开始生成；也可在输入框微调剧情后再次点击【🔍 组装最终提示词】。`
            });
            writeWorkspace('editor-chat', records);
            persistEditorChatSession();
            renderEditorChat();
            toast('最终提示词组装成功，已展示在会话中！');
          } else {
            toast('组装失败：' + (res && res.error || '未知错误'));
          }
        })
        .catch(err => {
          toast('组装请求失败：' + err.message);
        });
        return;
      }
      if (name === 'outline-save') { void persistNovel({ snapshot: true }); return; }
      if (name === 'outline-add') { addOutlineNode(); return; }
      if (name === 'outline-timeline-add') { addTimelineEvent(); return; }
      if (name === 'timeline-delete') { const state = editorState(false); stateTimeline(state).splice(Number(action.dataset.timelineIndex), 1); markEditorDirty(false); renderOutlineView(); return; }
      if (name === 'foreshadow-add') { editForeshadow(uid('new-foreshadow')); const state = editorState(false); const item = { id: uid('fs'), title: '未命名伏笔', description: '', status: 'planned', strength: 'medium', plantedChapterId: state.currentChapterId || '', targetChapterId: '', resolvedChapterId: '', clues: [], relatedEntityIds: [], notes: '' }; state.foreshadows.unshift(item); closeExistingModal(); editForeshadow(item.id); return; }
      if (name === 'foreshadow-edit') { editForeshadow(action.dataset.foreshadowId); return; }
      if (name === 'knowledge-import') { importKnowledge(); return; }
      if (name === 'knowledge-add') { openKnowledgeEditor('', action.dataset.entityType); return; }
      if (name === 'dossier-open') { openProjectDossier(); return; }
      if (name === 'knowledge-help') { openKnowledgeHelp(); return; }
      if (name === 'knowledge-edit') { openKnowledgeEditor(action.dataset.entityId); return; }
      if (name === 'knowledge-relations') { openKnowledgeRelations(action.dataset.entityId); return; }
      if (name === 'knowledge-archive') { const state = editorState(false); const entity = resolveEntity(state, action.dataset.entityId); if (entity) { entity.archived = !entity.archived; entity.updatedAt = Date.now(); syncKnowledgeWorkspace(state); markEditorDirty(false); renderKnowledgeView(); toast(entity.archived ? '设定已归档' : '设定已取消归档'); } return; }
      if (name === 'knowledge-select-all') { const rows = knowledgeFiltered(editorState(false)); const allSelected = rows.length && rows.every(item => runtime.knowledgeSelected.has(item.id)); rows.forEach(item => allSelected ? runtime.knowledgeSelected.delete(item.id) : runtime.knowledgeSelected.add(item.id)); renderKnowledgeView(); return; }
      if (name === 'knowledge-batch') { openKnowledgeBatch(); return; }
      if (name === 'knowledge-merge') { openKnowledgeMerge(); return; }
    });
    document.addEventListener('toggle', event => {
      const drawer = event.target.closest('[data-completion-params-drawer]');
      if (!drawer) return;
      const toggleText = drawer.querySelector('.ai-params-toggle-text');
      if (toggleText) toggleText.textContent = drawer.open ? '收起 ▴' : '展开 ▾';
    }, true);
    document.addEventListener('change', event => {
      const checkbox = event.target.closest('[data-completion-knowledge-select]');
      if (checkbox) { if (checkbox.checked) runtime.knowledgeSelected.add(checkbox.dataset.completionKnowledgeSelect); else runtime.knowledgeSelected.delete(checkbox.dataset.completionKnowledgeSelect); return; }
      const filter = event.target.closest('[data-completion-knowledge-filter]');
      if (filter) { runtime.knowledgeFilter = filter.value; renderKnowledgeView(); return; }
      const sortSel = event.target.closest('[data-completion-knowledge-sort]');
      if (sortSel) { runtime.knowledgeSort = sortSel.value; renderKnowledgeView(); return; }
      const model = event.target.closest('[data-completion-model]');
      if (model) { getPreview().editorModel = model.value; renderCompletionThinkingSelector(); toast(`已切换模型：${model.options[model.selectedIndex]?.text || model.value}`); return; }
      const genreFamily = event.target.closest('[data-completion-genre-family]');
      if (genreFamily) {
        const state = editorState(false);
        if (state) {
          state.genreFamily = genreFamily.value;
          state.novelGenre = genreFamily.value;
          markEditorDirty(false);
          const selText = genreFamily.options[genreFamily.selectedIndex]?.text || genreFamily.value;
          toast('已切换小说题材：' + selText);
          updateCompletionParamsHint();
        }
        return;
      }
      const chapterFunction = event.target.closest('[data-completion-chapter-function]');
      if (chapterFunction) {
        const state = editorState(false);
        if (state) {
          state.chapterFunction = chapterFunction.value;
          markEditorDirty(false);
          const selText = chapterFunction.options[chapterFunction.selectedIndex]?.text || chapterFunction.value;
          toast('已设置本章功能：' + selText);
          updateCompletionParamsHint();
        }
        return;
      }
      const chapterFocus = event.target.closest('[data-completion-chapter-focus]') || event.target.closest('[data-completion-xuanhuan-route]');
      if (chapterFocus) {
        const state = editorState(false);
        if (state) {
          state.chapterFocus = chapterFocus.value;
          state.focus = chapterFocus.value;
          markEditorDirty(false);
          const selText = chapterFocus.options[chapterFocus.selectedIndex]?.text || chapterFocus.value;
          toast('已切换该章侧重点：' + selText);
          updateCompletionParamsHint();
        }
        return;
      }
      const endingHook = event.target.closest('[data-completion-ending-hook]');
      if (endingHook) {
        const state = editorState(false);
        if (state) {
          state.endingHook = endingHook.value;
          state.hook = endingHook.value;
          markEditorDirty(false);
          const selText = endingHook.options[endingHook.selectedIndex]?.text || endingHook.value;
          toast('已设置结尾钩子：' + selText);
          updateCompletionParamsHint();
        }
        return;
      }
      const thinkingControl = event.target.closest('[data-completion-thinking-control]');
      if (thinkingControl) {
        const state = editorState(false);
        if (state && thinkingControl.dataset.mode === 'reasoning') state.settings.reasoningEffort = text(thinkingControl.value).toLowerCase();
        if (state && thinkingControl.dataset.mode === 'thinking') state.settings.think = thinkingControl.value === 'on';
        if (state) markEditorDirty(false);
        renderCompletionThinkingSelector();
        toast(thinkingControl.dataset.mode === 'reasoning' ? `已设置思考强度：${thinkingControl.options[thinkingControl.selectedIndex]?.text || thinkingControl.value}` : `已${thinkingControl.value === 'on' ? '开启' : '关闭'}思考模式`);
        return;
      }
      const skill = event.target.closest('[data-completion-skill]');
      if (skill) { getPreview().editorSkillId = EDITOR_ONLY_SKILL_ID; writeWorkspace('editor-skill', [EDITOR_ONLY_SKILL_ID]); persistEditorChatSession(); return; }
      const materialMode = event.target.closest('[data-completion-material-mode]');
      if (materialMode) { const state = editorState(false); if (state) { state.settings.characterMaterialMode = ['raw', 'strong', 'off'].includes(materialMode.value) ? materialMode.value : 'raw'; markEditorDirty(false); } toast(`人物素材模式：${materialMode.options[materialMode.selectedIndex]?.text || materialMode.value}`); return; }
      const history = event.target.closest('[data-completion-history]');
      if (history && history.value) { loadEditorChatHistory(history.value); return; }
      const entityType = event.target.closest('#completionEntityType');
      if (entityType) { updateKnowledgeArchetypeField(); return; }
      const entityArchetype = event.target.closest('#completionEntityArchetype');
      if (entityArchetype) { entityArchetype.dataset.userChanged = 'true'; entityArchetype.dataset.source = entityArchetype.value ? 'explicit' : 'none'; updateKnowledgeArchetypeField(); return; }
      const archetypeOverrideSel = event.target.closest('[data-completion-archetype-override]');
      if (archetypeOverrideSel) {
        const state = editorState(false);
        if (state) {
          state.archetypeOverride = archetypeOverrideSel.value;
          state.writingStyle = archetypeOverrideSel.value;
          markEditorDirty(false);
        }
        const badge = document.querySelector('[data-completion-style-badge]');
        if (badge) {
          if (archetypeOverrideSel.value) {
            badge.textContent = `已锁定: ${archetypeOverrideSel.options[archetypeOverrideSel.selectedIndex]?.text?.split('(')[0]?.trim() || archetypeOverrideSel.value}`;
            badge.style.color = '#f59e0b';
          } else {
            badge.textContent = '自动匹配';
            badge.style.color = 'var(--accent,#4f46e5)';
          }
        }
        toast(archetypeOverrideSel.value ? `已手动指定文风原型：${archetypeOverrideSel.options[archetypeOverrideSel.selectedIndex]?.text}` : '已恢复自动匹配文风');
        return;
      }
      const exportScope = event.target.closest('input[name="completionExportScope"]'); if (exportScope) { exportScope.closest('.segment')?.parentElement.querySelectorAll('.segment').forEach(node => node.classList.toggle('active', node.contains(exportScope))); }
    });
    document.addEventListener('input', event => {
      const target = event.target;
      const promptDraftInput = target && target.closest && target.closest('[data-completion-prompt]');
      if (promptDraftInput) {
        try { sessionStorage.setItem('molan_editor_prompt_draft', promptDraftInput.value); } catch (_) {}
        updateStyleDetectionDebounced(promptDraftInput.value);
      }
      const paper = target.closest('[data-completion-paper]');
      if (paper && currentPageName() === 'editor') {
        const state = editorState(false); const current = activeRefs(state); if (!current.chapter || !current.scene) return;
        if (target.matches('[data-completion-chapter-title]')) { current.chapter.title = target.textContent.trim() || current.chapter.title; syncOutline(state); }
        const sceneContentChanged = target.matches('.completion-editor-content');
        if (sceneContentChanged) { current.scene.content = normalizeSceneContent(target.innerHTML, ''); const meta = paper.querySelector('.editor-paper-meta span:last-child'); if (meta) meta.textContent = `${wordCount(current.scene.content).toLocaleString()} 字`; }
        getPreview().editorBody = current.scene.content;
        markEditorDirty(false, sceneContentChanged ? { patchSave: true, sceneRef: current.scene } : null);
        return;
      }
      const search = target.closest('[data-completion-knowledge-search]'); if (search) { runtime.knowledgeQuery = search.value.trim(); renderKnowledgeList(editorState(false)); return; }
      const treeSearch = target.closest('[data-completion-knowledge-tree-search]'); if (treeSearch) {
        const query = treeSearch.value.trim().toLowerCase();
        getStage().querySelectorAll('#completionKnowledgeTree .tree-group').forEach(group => {
          let visible = 0;
          group.querySelectorAll('.tree-node').forEach(node => { const show = !query || node.textContent.toLowerCase().includes(query); node.style.display = show ? '' : 'none'; if (show) visible += 1; });
          const cnt = group.querySelector('[data-knowledge-tree-count]'); if (cnt) cnt.textContent = visible;
        });
        return;
      }
      const book = target.closest('[data-completion-outline-field]'); if (book) { const state = editorState(false); if (book.dataset.completionOutlineField === 'book-title') state.outline.book.title = book.value.trim() || state.title; else state.outline.book.oneLine = book.value; markEditorDirty(false); return; }
      const volume = target.closest('[data-completion-volume-field]'); if (volume) { const state = editorState(false); const item = state.volumes.find(value => value.id === volume.dataset.volumeId); if (item) { if (volume.dataset.completionVolumeField === 'title') item.title = volume.value; else getVolumeOutline(state, item).synopsis = volume.value; syncOutline(state); markEditorDirty(false); } return; }
      const chapterField = target.closest('[data-completion-chapter-field]'); if (chapterField) { const state = editorState(false); const volume = state.volumes.find(value => value.id === chapterField.dataset.volumeId) || state.volumes.find(value => value.chapters.some(item => item.id === chapterField.dataset.chapterId)); const chapter = volume && volume.chapters.find(value => value.id === chapterField.dataset.chapterId); const outline = volume && chapter && getVolumeOutline(state, volume).chapters.find(item => item.chapterId === chapter.id || item.num === chapter.title); if (outline) outline[chapterField.dataset.completionChapterField] = chapterField.value; markEditorDirty(false); }
    });
    document.addEventListener('keydown', event => {
      const promptInput = event.target && event.target.closest && event.target.closest('[data-completion-prompt]');
      if (promptInput && event.key === 'Enter') {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.shiftKey || event.ctrlKey || event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        void sendEditorAI();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && currentPageName() === 'editor') {
        const state = editorState(false);
        const record = runtime.editorSearchUndoStack[0] || (state && state.searchChangeSets || []).find(item => item && !item.undoneAt);
        if (canUndoEditorSearchChangeSet(state, record)) {
          event.preventDefault();
          event.stopPropagation();
          void undoEditorSearchChangeSet();
          return;
        }
      }
      if (event.key === 'Enter' && event.target.closest('[data-completion-select-chapter],[data-completion-select-scene]')) { event.preventDefault(); event.target.click(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && currentPageName() === 'editor') { event.preventDefault(); void persistNovel({ snapshot: true }); }
      // 知识库键盘导航（报告#13）：J/K 上下、Enter 编辑、Esc 已由弹窗处理
      const kbBackdrop = document.getElementById('modalBackdrop');
      if (currentPageName() === 'knowledge' && (!kbBackdrop || !kbBackdrop.classList.contains('open')) && !(event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable))) {
        const state = editorState(false); if (state) {
          const rows = knowledgeFiltered(state);
          if (event.key === 'j' || event.key === 'k') {
            event.preventDefault();
            if (!rows.length) return;
            let idx = rows.findIndex(item => item.id === runtime.selectedEntityId);
            if (idx < 0) idx = event.key === 'j' ? -1 : 0;
            idx = Math.max(0, Math.min(rows.length - 1, idx + (event.key === 'j' ? 1 : -1)));
            runtime.selectedEntityId = rows[idx].id; renderKnowledgeView();
          } else if (event.key === 'Enter' && runtime.selectedEntityId) { event.preventDefault(); openKnowledgeEditor(runtime.selectedEntityId); }
        }
      }
    });
    // 知识库：双击列表名称内联重命名（报告#14）
    document.addEventListener('dblclick', event => {
      if (currentPageName() !== 'knowledge') return;
      const nameEl = event.target.closest && event.target.closest('.entity-name'); if (!nameEl) return;
      const row = nameEl.closest('[data-completion-entity]'); if (!row) return;
      const id = row.dataset.completionEntity; const state = editorState(false); const entity = resolveEntity(state, id); if (!entity) return;
      event.preventDefault();
      nameEl.setAttribute('contenteditable', 'true'); nameEl.focus();
      const finish = () => {
        const val = (nameEl.textContent || '').trim(); nameEl.removeAttribute('contenteditable'); nameEl.removeEventListener('blur', finish);
        if (val && val !== entity.name) { entity.name = val; entity.updatedAt = Date.now(); syncKnowledgeWorkspace(state); markEditorDirty(false); }
        renderKnowledgeView();
      };
      nameEl.addEventListener('blur', finish);
      nameEl.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); } });
    });
    // 知识库：分类树拖拽调整上级（报告#15）
    document.addEventListener('dragstart', event => {
      const node = event.target.closest && event.target.closest('#completionKnowledgeTree .tree-node');
      if (node) { event.dataTransfer.setData('text/plain', node.dataset.completionKnowledgeCategory); event.dataTransfer.effectAllowed = 'move'; }
    });
    document.addEventListener('dragover', event => {
      const node = event.target.closest && event.target.closest('#completionKnowledgeTree .tree-node');
      if (node) { event.preventDefault(); node.style.outline = '1px dashed #4c6ef5'; }
    });
    document.addEventListener('dragleave', event => {
      const node = event.target.closest && event.target.closest('#completionKnowledgeTree .tree-node');
      if (node) node.style.outline = '';
    });
    document.addEventListener('drop', event => {
      const node = event.target.closest && event.target.closest('#completionKnowledgeTree .tree-node');
      if (!node) return;
      event.preventDefault(); node.style.outline = '';
      const id = event.dataTransfer.getData('text/plain'); if (!id || id === node.dataset.completionKnowledgeCategory) return;
      const state = editorState(false); const entity = resolveEntity(state, id); const target = resolveEntity(state, node.dataset.completionKnowledgeCategory);
      if (!entity || !target) return;
      if (!['location', 'faction', 'itemCategory'].includes(target.type)) { toast('只能拖到「地点 / 势力 / 物品类别」节点下'); return; }
      entity.parentId = target.id; entity.updatedAt = Date.now(); syncKnowledgeWorkspace(state); markEditorDirty(false); renderKnowledgeView(); toast(`已将「${entity.name}」移动到「${target.name}」下`);
    });
  }

  function mountCurrentPage() {
    const page = currentPageName();
    if (page === 'editor') {
      const state = editorState(false);
      if (state) void ensureEditorWalRecovery(state).catch(() => setSaveStatus('本地 WAL 恢复失败'));
      renderEditorSurface();
      const preview = getStage()?.querySelector('#editorPreview');
      preview?.classList.toggle('ai-open', runtime.aiOpen);
      preview?.classList.toggle('nav-open', runtime.navOpen);
    }
    if (page === 'outline') { renderOutlineView(); }
    if (page === 'knowledge') { renderKnowledgeView(); }
  }

  function install() {
    if (runtime.installed) return;
    runtime.installed = true;
    const rendererMap = refObject('renderers');
    if (!rendererMap) return;
    rendererMap.editor = renderEditorPage;
    rendererMap.outline = renderOutlinePage;
    rendererMap.knowledge = knowledgePage;
    installDelegation();
    window.addEventListener('molan:auth-changed', () => {
      populateCompletionSelectors();
    });
    window.populateCompletionSelectors = populateCompletionSelectors;
    window.addEventListener('online', () => {
      const state = editorState(false);
      void flushEditorWalDrafts(state).catch(() => setSaveStatus('本地 WAL 草稿仍待同步'));
    });
    const render = refFunction('renderPage');
    if (render && !runtime.originalRenderPage) {
      runtime.originalRenderPage = render;
      const wrapped = function (page, options) {
        const result = runtime.originalRenderPage(page, options);
        mountCurrentPage();
        return result;
      };
      window.renderPage = wrapped;
    }
    if (runtime.originalRenderPage) runtime.originalRenderPage(currentPageName(), { fromHistory: true });
    mountCurrentPage();
  }

  window.MolanCompletionEditor = { install };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
}());
