import { createHash } from 'node:crypto';

export const RICH_SCHEMA_VERSION = 'corpus-v3.1-rich-1';
export const SAMPLE_MIN_CHARS = 12;
export const SAMPLE_MAX_CHARS = 140;
export const HARD_OVERLAP_LENGTH = 12;
export const FOUR_GRAM_SIZE = 4;
export const FOUR_GRAM_JACCARD_THRESHOLD = 0.85;

export const DIMENSION_WHITELIST = Object.freeze([
  'appearance',
  'expression',
  'action',
  'dialogue',
  'catchphrase',
  'psychology',
]);

export const DIMENSIONS = DIMENSION_WHITELIST;

export const SCENE_WHITELIST = Object.freeze([
  '日常',
  '闲聊',
  '独处',
  '重逢',
  '离别',
  '冲突',
  '争吵',
  '谈判',
  '试探',
  '安慰',
  '关心',
  '拒绝',
  '告白',
  '暧昧',
  '吃醋',
  '误解',
  '和解',
  '失败',
  '胜利',
  '危机',
  '战斗',
  '战后',
  '公开场合',
  '私下场合',
]);

export const RELATIONSHIP_WHITELIST = Object.freeze([
  '陌生人',
  '普通朋友',
  '亲密朋友',
  '恋人',
  '暧昧对象',
  '夫妻',
  '家人',
  '父子',
  '母子',
  '兄弟姐妹',
  '师徒',
  '上下级',
  '同僚',
  '竞争者',
  '敌对',
  '陌生但有利益关系',
]);

export const EMOTIONAL_STATE_WHITELIST = Object.freeze([
  '平静',
  '紧张',
  '尴尬',
  '防备',
  '期待',
  '失望',
  '委屈',
  '羞耻',
  '得意',
  '心虚',
  '担忧',
  '嘴硬',
  '压抑',
  '兴奋',
  '疲惫',
  '走神',
]);

export const SUBTEXT_WHITELIST = Object.freeze([
  '试探',
  '掩饰关心',
  '掩饰生气',
  '掩饰害怕',
  '欲言又止',
  '拒绝但挽留',
  '嘴硬',
  '缓解尴尬',
  '转移话题',
  '避免承认',
  '寻求确认',
  '争取主动',
  '维持体面',
  '保护自尊',
  '故意冷淡',
  '故意开玩笑',
]);

export const HTL_WHITELIST = Object.freeze([
  'hesitation',
  'pause',
  'self_correction',
  'unfinished_thought',
  'uncertainty',
  'avoidance',
  'deflection',
  'misdirection',
  'withholding',
  'topic_shift',
  'fragment',
  'repetition',
  'interruption',
  'repair',
  'vague_reference',
  'casual_filler',
  'self_contradiction',
  'emotion_vs_action',
  'speech_vs_action',
  'public_private_difference',
  'want_but_refuse',
  'habitual_gesture',
  'object_habit',
  'body_habit',
  'speech_habit',
  'avoidance_habit',
  'save_face',
  'politeness_mask',
  'status_awareness',
  'social_pressure',
  'reading_the_room',
  'sensory_anchor',
  'object_anchor',
  'spatial_anchor',
  'body_detail',
  'environment_detail',
  'underreaction',
  'overreaction',
  'delayed_reaction',
  'misplaced_attention',
  'unexpected_focus',
  'implicit_emotion',
  'reader_inference',
  'unexplained_reaction',
  'silent_response',
]);

export const HUMAN_TEXTURE_SIGNALS = HTL_WHITELIST;

export const ARCHETYPE_WHITELIST = Object.freeze([
  '豪爽侠义型',
  '冷静理智型',
  '温柔内敛型',
  '活泼开朗型',
  '阴郁腹黑型',
  '霸道强势型',
  '天真烂漫型',
  '市侩圆滑型',
  '高傲冷峻型',
  '热血冲动型',
]);

export const ARCHETYPES = ARCHETYPE_WHITELIST;

export const WHITELISTS = Object.freeze({
  dimensions: DIMENSION_WHITELIST,
  scene: SCENE_WHITELIST,
  relationship: RELATIONSHIP_WHITELIST,
  emotionalState: EMOTIONAL_STATE_WHITELIST,
  subtext: SUBTEXT_WHITELIST,
  HTL: HTL_WHITELIST,
  archetype: ARCHETYPE_WHITELIST,
});

export const V31_WHITELISTS = WHITELISTS;
export const SIX_DIMENSIONS = DIMENSION_WHITELIST;
export const SCENES = SCENE_WHITELIST;
export const RELATIONSHIPS = RELATIONSHIP_WHITELIST;
export const EMOTIONAL_STATES = EMOTIONAL_STATE_WHITELIST;
export const SUBTEXTS = SUBTEXT_WHITELIST;
export const HTL = HTL_WHITELIST;

export const CANDIDATE_RECALL_KINDS = Object.freeze([
  ...DIMENSION_WHITELIST,
  'lifeTexture',
]);

export const LIFE_TEXTURE_CUES = Object.freeze([
  '吃',
  '喝',
  '睡',
  '醒',
  '走神',
  '整理',
  '摸口袋',
  '找东西',
  '犯困',
  '忘记',
  '迟到',
  '打哈欠',
  '收拾',
]);

const FORBIDDEN_TERM_LAYERS = Object.freeze([
  'coreTerms',
  'localTerms',
  'globalRiskTerms',
]);

const TRADITIONAL_TO_SIMPLIFIED = new Map([
  ['萬', '万'],
  ['與', '与'],
  ['專', '专'],
  ['業', '业'],
  ['東', '东'],
  ['絲', '丝'],
  ['丟', '丢'],
  ['兩', '两'],
  ['嚴', '严'],
  ['喪', '丧'],
  ['個', '个'],
  ['臨', '临'],
  ['為', '为'],
  ['麗', '丽'],
  ['舉', '举'],
  ['麼', '么'],
  ['義', '义'],
  ['烏', '乌'],
  ['樂', '乐'],
  ['喬', '乔'],
  ['習', '习'],
  ['鄉', '乡'],
  ['書', '书'],
  ['買', '买'],
  ['亂', '乱'],
  ['爭', '争'],
  ['於', '于'],
  ['虧', '亏'],
  ['雲', '云'],
  ['亞', '亚'],
  ['產', '产'],
  ['畝', '亩'],
  ['親', '亲'],
  ['億', '亿'],
  ['僅', '仅'],
  ['從', '从'],
  ['仇', '仇'],
  ['倉', '仓'],
  ['儀', '仪'],
  ['價', '价'],
  ['眾', '众'],
  ['優', '优'],
  ['會', '会'],
  ['傳', '传'],
  ['傷', '伤'],
  ['倫', '伦'],
  ['偽', '伪'],
  ['體', '体'],
  ['餘', '余'],
  ['佛', '佛'],
  ['來', '来'],
  ['侖', '仑'],
  ['個', '个'],
  ['俠', '侠'],
  ['側', '侧'],
  ['偵', '侦'],
  ['傑', '杰'],
  ['傾', '倾'],
  ['儘', '尽'],
  ['兒', '儿'],
  ['兌', '兑'],
  ['兩', '两'],
  ['內', '内'],
  ['全', '全'],
  ['冊', '册'],
  ['寫', '写'],
  ['軍', '军'],
  ['農', '农'],
  ['冠', '冠'],
  ['冬', '冬'],
  ['淨', '净'],
  ['凍', '冻'],
  ['減', '减'],
  ['湊', '凑'],
  ['凱', '凯'],
  ['別', '别'],
  ['劃', '划'],
  ['劇', '剧'],
  ['勸', '劝'],
  ['務', '务'],
  ['動', '动'],
  ['勵', '励'],
  ['勞', '劳'],
  ['勢', '势'],
  ['區', '区'],
  ['醫', '医'],
  ['華', '华'],
  ['協', '协'],
  ['卻', '却'],
  ['廠', '厂'],
  ['厭', '厌'],
  ['參', '参'],
  ['雙', '双'],
  ['發', '发'],
  ['變', '变'],
  ['叢', '丛'],
  ['臺', '台'],
  ['葉', '叶'],
  ['號', '号'],
  ['嘆', '叹'],
  ['嘗', '尝'],
  ['嚇', '吓'],
  ['聽', '听'],
  ['啟', '启'],
  ['吳', '吴'],
  ['員', '员'],
  ['唄', '呗'],
  ['唸', '念'],
  ['嘯', '啸'],
  ['喚', '唤'],
  ['喲', '哟'],
  ['嘩', '哗'],
  ['圍', '围'],
  ['園', '园'],
  ['國', '国'],
  ['圖', '图'],
  ['圓', '圆'],
  ['場', '场'],
  ['塊', '块'],
  ['堅', '坚'],
  ['壇', '坛'],
  ['壞', '坏'],
  ['壓', '压'],
  ['壯', '壮'],
  ['聲', '声'],
  ['處', '处'],
  ['備', '备'],
  ['復', '复'],
  ['夢', '梦'],
  ['夠', '够'],
  ['夾', '夹'],
  ['奪', '夺'],
  ['奮', '奋'],
  ['婦', '妇'],
  ['媽', '妈'],
  ['姊', '姐'],
  ['姍', '姗'],
  ['娛', '娱'],
  ['嬌', '娇'],
  ['學', '学'],
  ['孫', '孙'],
  ['寧', '宁'],
  ['寶', '宝'],
  ['實', '实'],
  ['審', '审'],
  ['寫', '写'],
  ['對', '对'],
  ['導', '导'],
  ['小', '小'],
  ['屆', '届'],
  ['屬', '属'],
  ['岡', '冈'],
  ['島', '岛'],
  ['峽', '峡'],
  ['崗', '岗'],
  ['嶺', '岭'],
  ['嶽', '岳'],
  ['巖', '岩'],
  ['巔', '巅'],
  ['幣', '币'],
  ['幹', '干'],
  ['庫', '库'],
  ['廬', '庐'],
  ['廳', '厅'],
  ['廢', '废'],
  ['廣', '广'],
  ['廟', '庙'],
  ['廠', '厂'],
  ['開', '开'],
  ['異', '异'],
  ['張', '张'],
  ['強', '强'],
  ['彈', '弹'],
  ['彌', '弥'],
  ['彎', '弯'],
  ['彥', '彦'],
  ['後', '后'],
  ['徑', '径'],
  ['從', '从'],
  ['復', '复'],
  ['徹', '彻'],
  ['志', '志'],
  ['恆', '恒'],
  ['恥', '耻'],
  ['悅', '悦'],
  ['悵', '怅'],
  ['悶', '闷'],
  ['惡', '恶'],
  ['惱', '恼'],
  ['愛', '爱'],
  ['慘', '惨'],
  ['慣', '惯'],
  ['慘', '惨'],
  ['慮', '虑'],
  ['憂', '忧'],
  ['懷', '怀'],
  ['懶', '懒'],
  ['懸', '悬'],
  ['戰', '战'],
  ['戶', '户'],
  ['扇', '扇'],
  ['掃', '扫'],
  ['揚', '扬'],
  ['擴', '扩'],
  ['擁', '拥'],
  ['攜', '携'],
  ['攝', '摄'],
  ['攔', '拦'],
  ['擔', '担'],
  ['據', '据'],
  ['拋', '抛'],
  ['拯', '拯'],
  ['掛', '挂'],
  ['採', '采'],
  ['揀', '拣'],
  ['拚', '拼'],
  ['揮', '挥'],
  ['捨', '舍'],
  ['擇', '择'],
  ['撐', '撑'],
  ['撲', '扑'],
  ['擋', '挡'],
  ['擾', '扰'],
  ['撥', '拨'],
  ['掙', '挣'],
  ['摯', '挚'],
  ['摟', '搂'],
  ['損', '损'],
  ['搖', '摇'],
  ['搶', '抢'],
  ['攤', '摊'],
  ['摑', '掴'],
  ['斬', '斩'],
  ['斷', '断'],
  ['無', '无'],
  ['舊', '旧'],
  ['時', '时'],
  ['曉', '晓'],
  ['暫', '暂'],
  ['顯', '显'],
  ['曆', '历'],
  ['書', '书'],
  ['機', '机'],
  ['權', '权'],
  ['條', '条'],
  ['來', '来'],
  ['極', '极'],
  ['構', '构'],
  ['槍', '枪'],
  ['樣', '样'],
  ['標', '标'],
  ['樹', '树'],
  ['橋', '桥'],
  ['樓', '楼'],
  ['歡', '欢'],
  ['歸', '归'],
  ['歐', '欧'],
  ['殘', '残'],
  ['殺', '杀'],
  ['殼', '壳'],
  ['歷', '历'],
  ['淚', '泪'],
  ['濤', '涛'],
  ['潔', '洁'],
  ['潑', '泼'],
  ['澀', '涩'],
  ['滅', '灭'],
  ['滿', '满'],
  ['漸', '渐'],
  ['潛', '潜'],
  ['濃', '浓'],
  ['瀾', '澜'],
  ['灣', '湾'],
  ['漢', '汉'],
  ['燈', '灯'],
  ['燦', '灿'],
  ['爐', '炉'],
  ['爭', '争'],
  ['牆', '墙'],
  ['狀', '状'],
  ['獨', '独'],
  ['獲', '获'],
  ['獸', '兽'],
  ['獻', '献'],
  ['現', '现'],
  ['環', '环'],
  ['畫', '画'],
  ['異', '异'],
  ['療', '疗'],
  ['瘋', '疯'],
  ['發', '发'],
  ['盤', '盘'],
  ['盡', '尽'],
  ['監', '监'],
  ['睜', '睁'],
  ['瞞', '瞒'],
  ['瞭', '了'],
  ['矚', '瞩'],
  ['礙', '碍'],
  ['祕', '秘'],
  ['禮', '礼'],
  ['禍', '祸'],
  ['離', '离'],
  ['種', '种'],
  ['積', '积'],
  ['穩', '稳'],
  ['窮', '穷'],
  ['窺', '窥'],
  ['窩', '窝'],
  ['競', '竞'],
  ['筆', '笔'],
  ['節', '节'],
  ['範', '范'],
  ['築', '筑'],
  ['簡', '简'],
  ['籌', '筹'],
  ['糾', '纠'],
  ['紅', '红'],
  ['純', '纯'],
  ['紙', '纸'],
  ['紛', '纷'],
  ['絕', '绝'],
  ['統', '统'],
  ['絲', '丝'],
  ['絹', '绢'],
  ['綠', '绿'],
  ['維', '维'],
  ['綱', '纲'],
  ['線', '线'],
  ['緊', '紧'],
  ['編', '编'],
  ['緩', '缓'],
  ['練', '练'],
  ['縱', '纵'],
  ['縣', '县'],
  ['績', '绩'],
  ['織', '织'],
  ['繞', '绕'],
  ['繼', '继'],
  ['續', '续'],
  ['纖', '纤'],
  ['缷', '卸'],
  ['罷', '罢'],
  ['羅', '罗'],
  ['羨', '羡'],
  ['翹', '翘'],
  ['聖', '圣'],
  ['聞', '闻'],
  ['聯', '联'],
  ['聰', '聪'],
  ['聲', '声'],
  ['腦', '脑'],
  ['腳', '脚'],
  ['臉', '脸'],
  ['臨', '临'],
  ['與', '与'],
  ['興', '兴'],
  ['舉', '举'],
  ['舊', '旧'],
  ['艱', '艰'],
  ['藝', '艺'],
  ['莊', '庄'],
  ['華', '华'],
  ['萬', '万'],
  ['葉', '叶'],
  ['著', '著'],
  ['蒼', '苍'],
  ['蓋', '盖'],
  ['藍', '蓝'],
  ['蘇', '苏'],
  ['處', '处'],
  ['虛', '虚'],
  ['號', '号'],
  ['螢', '萤'],
  ['衛', '卫'],
  ['補', '补'],
  ['裝', '装'],
  ['複', '复'],
  ['襯', '衬'],
  ['覺', '觉'],
  ['視', '视'],
  ['覽', '览'],
  ['觀', '观'],
  ['觸', '触'],
  ['訂', '订'],
  ['訃', '讣'],
  ['計', '计'],
  ['訊', '讯'],
  ['訣', '诀'],
  ['訥', '讷'],
  ['註', '注'],
  ['詠', '咏'],
  ['詞', '词'],
  ['該', '该'],
  ['詳', '详'],
  ['誇', '夸'],
  ['認', '认'],
  ['誠', '诚'],
  ['話', '话'],
  ['誤', '误'],
  ['說', '说'],
  ['誰', '谁'],
  ['課', '课'],
  ['調', '调'],
  ['談', '谈'],
  ['請', '请'],
  ['論', '论'],
  ['諷', '讽'],
  ['諾', '诺'],
  ['謂', '谓'],
  ['謙', '谦'],
  ['證', '证'],
  ['識', '识'],
  ['譜', '谱'],
  ['警', '警'],
  ['譯', '译'],
  ['護', '护'],
  ['讀', '读'],
  ['變', '变'],
  ['讓', '让'],
  ['財', '财'],
  ['貢', '贡'],
  ['貧', '贫'],
  ['貨', '货'],
  ['販', '贩'],
  ['貪', '贪'],
  ['貴', '贵'],
  ['買', '买'],
  ['費', '费'],
  ['賀', '贺'],
  ['賊', '贼'],
  ['賓', '宾'],
  ['賞', '赏'],
  ['賠', '赔'],
  ['賣', '卖'],
  ['賤', '贱'],
  ['賦', '赋'],
  ['質', '质'],
  ['賭', '赌'],
  ['賽', '赛'],
  ['贈', '赠'],
  ['趕', '赶'],
  ['趙', '赵'],
  ['跡', '迹'],
  ['踐', '践'],
  ['躍', '跃'],
  ['車', '车'],
  ['軋', '轧'],
  ['軟', '软'],
  ['較', '较'],
  ['載', '载'],
  ['輕', '轻'],
  ['輝', '辉'],
  ['輪', '轮'],
  ['輯', '辑'],
  ['輸', '输'],
  ['辦', '办'],
  ['辭', '辞'],
  ['農', '农'],
  ['邊', '边'],
  ['達', '达'],
  ['遷', '迁'],
  ['選', '选'],
  ['遺', '遗'],
  ['邁', '迈'],
  ['還', '还'],
  ['邏', '逻'],
  ['鄰', '邻'],
  ['鄭', '郑'],
  ['鄧', '邓'],
  ['針', '针'],
  ['鈴', '铃'],
  ['鉤', '钩'],
  ['銳', '锐'],
  ['鋒', '锋'],
  ['錢', '钱'],
  ['錯', '错'],
  ['鍋', '锅'],
  ['鍵', '键'],
  ['鎖', '锁'],
  ['鏡', '镜'],
  ['鐘', '钟'],
  ['鐵', '铁'],
  ['鑰', '钥'],
  ['長', '长'],
  ['門', '门'],
  ['閉', '闭'],
  ['閃', '闪'],
  ['閒', '闲'],
  ['間', '间'],
  ['闊', '阔'],
  ['闖', '闯'],
  ['關', '关'],
  ['陣', '阵'],
  ['陰', '阴'],
  ['陽', '阳'],
  ['隨', '随'],
  ['難', '难'],
  ['雜', '杂'],
  ['雙', '双'],
  ['雖', '虽'],
  ['靜', '静'],
  ['靠', '靠'],
  ['響', '响'],
  ['頁', '页'],
  ['頂', '顶'],
  ['頃', '顷'],
  ['順', '顺'],
  ['須', '须'],
  ['頑', '顽'],
  ['頓', '顿'],
  ['預', '预'],
  ['頗', '颇'],
  ['領', '领'],
  ['頭', '头'],
  ['顏', '颜'],
  ['額', '额'],
  ['顧', '顾'],
  ['顫', '颤'],
  ['風', '风'],
  ['飛', '飞'],
  ['飄', '飘'],
  ['餓', '饿'],
  ['飯', '饭'],
  ['飲', '饮'],
  ['養', '养'],
  ['駕', '驾'],
  ['駛', '驶'],
  ['騎', '骑'],
  ['驚', '惊'],
  ['驗', '验'],
  ['髮', '发'],
  ['鬧', '闹'],
  ['鬍', '胡'],
  ['魯', '鲁'],
  ['魚', '鱼'],
  ['鳥', '鸟'],
  ['鳴', '鸣'],
  ['鴨', '鸭'],
  ['鷹', '鹰'],
  ['鹹', '咸'],
  ['麥', '麦'],
  ['黃', '黄'],
  ['黨', '党'],
  ['黴', '霉'],
  ['齊', '齐'],
  ['齒', '齿'],
  ['龍', '龙'],
  ['龐', '庞'],
]);

const DIMENSION_CUES = Object.freeze({
  appearance: [
    /脸|面容|脸颊|眼睛|双眼|眼眸|目光|眉|眉头|嘴角|嘴唇|唇|鼻|耳朵|头发|发梢|皮肤|身材|肩膀|手臂|手腕|手指|身高|衣服|长发|短发/gu,
  ],
  expression: [
    /看|盯|望|瞥|移开视线|垂下眼|抿唇|呼吸|停顿|脸色|喉结|指尖|握紧|松开|皱眉|笑|叹气|沉默|咬牙/gu,
  ],
  action: [
    /站|坐|走|转身|抬|低头|伸|拿|放|推|拉|靠|抓|松|拍|敲|回头|起身|躲|避|退|迎|抱|捡|翻|整理|摸|找|吃|喝|睡|醒|打|写|擦|递|收|打开|关上|穿|脱|掏|塞|抽|踢|撞|跑|停/gu,
  ],
  dialogue: [/[“「『"]|”」』/gu],
  psychology: [
    /想|觉得|意识到|记得|犹豫|想到|不愿|却|可是|只是|担心|害怕|希望|明白|以为|怀疑|决定|不想|愿意/gu,
  ],
});

const LIFE_TEXTURE_REGEX = /吃|喝|睡|醒|走神|整理|摸口袋|找东西|犯困|忘记|迟到|打哈欠|收拾/gu;
const SENTENCE_BOUNDARY = /[^。！？!?；;\n]+(?:[。！？!?；;]|$)/gu;
const QUOTE_PATTERNS = [
  /“([^”]{1,160})”/gu,
  /「([^」]{1,160})」/gu,
  /『([^』]{1,160})』/gu,
  /‘([^’]{1,160})’/gu,
  /"([^"]{1,160})"/gu,
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function mergeObjects(...values) {
  return Object.assign({}, ...values.filter(isObject));
}

function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function uniqueStable(values, key = (value) => value) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const marker = key(value);
    if (seen.has(marker)) continue;
    seen.add(marker);
    result.push(value);
  }
  return result;
}

export function normalizeSampleText(value) {
  return String(value ?? '')
    .replace(/\uFEFF/gu, '')
    .replace(/[\u200B-\u200D\u2060]/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/\s+/gu, ' ')
    .trim();
}

export const normalizeText = normalizeSampleText;

export function canonicalizeText(value) {
  const text = normalizeSampleText(value).normalize('NFKC').toLocaleLowerCase();
  return Array.from(text, (character) => TRADITIONAL_TO_SIMPLIFIED.get(character) ?? character).join('');
}

export const canonicalize = canonicalizeText;

export function characterCount(value) {
  return Array.from(normalizeSampleText(value)).length;
}

function isRuntimeLength(value) {
  const count = characterCount(value);
  return count >= SAMPLE_MIN_CHARS && count <= SAMPLE_MAX_CHARS;
}

export function normalizedTextHash(value) {
  return createHash('sha256').update(canonicalizeText(value), 'utf8').digest('hex');
}

export const hashNormalizedText = normalizedTextHash;

export function fourGrams(value) {
  const chars = Array.from(canonicalizeText(value));
  if (chars.length < FOUR_GRAM_SIZE) return chars.length ? [chars.join('')] : [];
  const grams = [];
  for (let index = 0; index <= chars.length - FOUR_GRAM_SIZE; index += 1) {
    grams.push(chars.slice(index, index + FOUR_GRAM_SIZE).join(''));
  }
  return uniqueStable(grams);
}

export function fourGramJaccard(left, right) {
  const leftSet = new Set(fourGrams(left));
  const rightSet = new Set(fourGrams(right));
  if (leftSet.size === 0 && rightSet.size === 0) return canonicalizeText(left) === canonicalizeText(right) ? 1 : 0;
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let intersection = 0;
  for (const gram of leftSet) if (rightSet.has(gram)) intersection += 1;
  return intersection / new Set([...leftSet, ...rightSet]).size;
}

function longestContinuousOverlap(left, right) {
  const leftChars = Array.from(canonicalizeText(left));
  const rightChars = Array.from(canonicalizeText(right));
  let best = { length: 0, text: '', leftStart: -1, rightStart: -1 };
  for (let leftIndex = 0; leftIndex < leftChars.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < rightChars.length; rightIndex += 1) {
      if (leftChars[leftIndex] !== rightChars[rightIndex]) continue;
      let length = 0;
      while (
        leftIndex + length < leftChars.length &&
        rightIndex + length < rightChars.length &&
        leftChars[leftIndex + length] === rightChars[rightIndex + length]
      ) {
        length += 1;
      }
      if (length > best.length) {
        best = {
          length,
          text: leftChars.slice(leftIndex, leftIndex + length).join(''),
          leftStart: leftIndex,
          rightStart: rightIndex,
        };
      }
    }
  }
  return best;
}

function referenceText(reference) {
  if (typeof reference === 'string') return reference;
  if (!isObject(reference)) return '';
  return firstNonEmpty(
    reference.text,
    reference.safeText,
    reference.sample?.safeText,
    reference.sample?.text,
    reference.rawText,
    reference.sample?.rawText,
  ) ?? '';
}

function referenceId(reference, index) {
  if (!isObject(reference)) return `reference-${index + 1}`;
  return firstNonEmpty(reference.id, reference.sampleId, reference.sourceWorkId) ?? `reference-${index + 1}`;
}

function normalizeOverlapArguments(references, options) {
  if (isObject(references)) {
    const nested = firstDefined(references.references, references.referenceTexts, references.existingSamples, references.samples);
    if (nested !== undefined) return { references: asArray(nested), options: { ...references, ...options } };
  }
  return { references: asArray(references), options: options ?? {} };
}

function makeOverlapReport(matches, metadata) {
  const report = matches.slice();
  Object.defineProperties(report, {
    matches: { value: report, enumerable: false },
    overlaps: { value: report, enumerable: false },
    hardMatches: { value: matches.filter((match) => match.hardGateHit), enumerable: false },
    blocked: { value: Boolean(metadata.blocked), enumerable: false },
    pass: { value: !metadata.blocked, enumerable: false },
    hardGate: { value: !metadata.hardOverlap, enumerable: false },
    hardOverlap: { value: Boolean(metadata.hardOverlap), enumerable: false },
    exactDuplicate: { value: Boolean(metadata.exactDuplicate), enumerable: false },
    fourGramDuplicate: { value: Boolean(metadata.fourGramDuplicate), enumerable: false },
    normalizedTextHash: { value: metadata.normalizedTextHash, enumerable: false },
    maxContinuousOverlap: { value: metadata.maxContinuousOverlap, enumerable: false },
    toJSON: {
      value: () => ({
        matches: report.map((match) => ({ ...match })),
        blocked: report.blocked,
        pass: report.pass,
        hardGate: report.hardGate,
        hardOverlap: report.hardOverlap,
        exactDuplicate: report.exactDuplicate,
        fourGramDuplicate: report.fourGramDuplicate,
        normalizedTextHash: report.normalizedTextHash,
        maxContinuousOverlap: report.maxContinuousOverlap,
      }),
      enumerable: false,
    },
  });
  return report;
}

function makeMergedTermList(merged) {
  const terms = merged.all.slice();
  Object.defineProperties(terms, {
    coreTerms: { value: merged.coreTerms.slice(), enumerable: false },
    localTerms: { value: merged.localTerms.slice(), enumerable: false },
    globalRiskTerms: { value: merged.globalRiskTerms.slice(), enumerable: false },
    all: { value: terms, enumerable: false },
  });
  return terms;
}

export function scanTextOverlap(text, references = [], options = {}) {
  const normalizedArguments = normalizeOverlapArguments(references, options);
  const configured = normalizedArguments.options ?? {};
  const minimum = Number.isInteger(configured.minRunLength) ? configured.minRunLength : HARD_OVERLAP_LENGTH;
  const jaccardThreshold = typeof configured.fourGramThreshold === 'number'
    ? configured.fourGramThreshold
    : FOUR_GRAM_JACCARD_THRESHOLD;
  const currentText = normalizeSampleText(text);
  const currentHash = normalizedTextHash(currentText);
  const matches = [];
  let exactDuplicate = false;
  let fourGramDuplicate = false;
  let hardOverlap = false;
  let maxContinuousOverlap = 0;

  normalizedArguments.references.forEach((reference, index) => {
    const otherText = normalizeSampleText(referenceText(reference));
    if (!otherText) return;
    const otherHash = normalizedTextHash(otherText);
    const exact = currentHash === otherHash;
    const continuous = longestContinuousOverlap(currentText, otherText);
    const jaccard = fourGramJaccard(currentText, otherText);
    const hard = continuous.length >= minimum;
    const nearDuplicate = jaccard >= jaccardThreshold;
    if (exact) exactDuplicate = true;
    if (nearDuplicate) fourGramDuplicate = true;
    if (hard) hardOverlap = true;
    if (continuous.length > maxContinuousOverlap) maxContinuousOverlap = continuous.length;
    if (!hard && !exact && !nearDuplicate) return;
    matches.push({
      referenceId: referenceId(reference, index),
      sourceWorkId: isObject(reference) ? reference.sourceWorkId ?? reference.source?.sourceWorkId ?? null : null,
      exactDuplicate: exact,
      fourGramJaccard: jaccard,
      fourGramDuplicate: nearDuplicate,
      continuousLength: continuous.length,
      hardGateHit: hard,
      overlapText: continuous.length >= minimum ? continuous.text.slice(0, continuous.length) : '',
      leftStart: continuous.leftStart,
      rightStart: continuous.rightStart,
    });
  });

  return makeOverlapReport(matches, {
    blocked: matches.length > 0,
    exactDuplicate,
    fourGramDuplicate,
    hardOverlap,
    normalizedTextHash: currentHash,
    maxContinuousOverlap,
  });
}

function termsFromInput(input, layers) {
  if (input === undefined || input === null) return;
  if (typeof input === 'string') {
    if (input.trim()) layers.localTerms.push(input.trim());
    return;
  }
  if (Array.isArray(input)) {
    for (const term of input) termsFromInput(term, layers);
    return;
  }
  if (!isObject(input)) return;

  if (input.forbiddenTerms !== undefined) termsFromInput(input.forbiddenTerms, layers);
  if (input.terms !== undefined) termsFromInput(input.terms, layers);
  if (input.core !== undefined) termsFromLayer(input.core, layers.coreTerms, layers);
  if (input.local !== undefined) termsFromLayer(input.local, layers.localTerms, layers);
  if (input.global !== undefined) termsFromLayer(input.global, layers.globalRiskTerms, layers);
  if (input.globalRisk !== undefined) termsFromLayer(input.globalRisk, layers.globalRiskTerms, layers);
  if (input.globalRiskTerms !== undefined) termsFromLayer(input.globalRiskTerms, layers.globalRiskTerms, layers);
  if (input.coreTerms !== undefined) termsFromLayer(input.coreTerms, layers.coreTerms, layers);
  if (input.localTerms !== undefined) termsFromLayer(input.localTerms, layers.localTerms, layers);
  if (input.layers !== undefined) termsFromInput(input.layers, layers);
  if (input.forbiddenTermLayers !== undefined) termsFromInput(input.forbiddenTermLayers, layers);
}

function termsFromLayer(input, target, layers) {
  if (input === undefined || input === null) return;
  if (Array.isArray(input)) {
    for (const term of input) {
      if (typeof term === 'string' && term.trim()) target.push(term.trim());
      else if (isObject(term)) termsFromInput(term, layers);
    }
    return;
  }
  if (typeof input === 'string' && input.trim()) target.push(input.trim());
}

export function mergeForbiddenTerms(...inputs) {
  const layers = {
    coreTerms: [],
    localTerms: [],
    globalRiskTerms: [],
  };
  for (const input of inputs) termsFromInput(input, layers);
  for (const layer of FORBIDDEN_TERM_LAYERS) {
    layers[layer] = uniqueStable(layers[layer], (term) => canonicalizeText(term));
  }
  const all = uniqueStable(
    FORBIDDEN_TERM_LAYERS.flatMap((layer) => layers[layer]),
    (term) => canonicalizeText(term),
  );
  return {
    ...layers,
    all,
    terms: all,
  };
}

export const mergeForbiddenTermLayers = mergeForbiddenTerms;

function extractTerms(forbiddenTerms) {
  if (isObject(forbiddenTerms) && Array.isArray(forbiddenTerms.all)) return forbiddenTerms.all;
  return mergeForbiddenTerms(forbiddenTerms).all;
}

export function scanResidualTerms(text, forbiddenTerms, options = {}) {
  const terms = extractTerms(firstDefined(options.forbiddenTerms, forbiddenTerms));
  const sourceText = String(text ?? '');
  const canonicalText = canonicalizeText(sourceText);
  const found = [];
  const seen = new Set();
  for (const term of terms) {
    const originalTerm = normalizeSampleText(term);
    const canonicalTerm = canonicalizeText(originalTerm);
    if (!canonicalTerm || seen.has(canonicalTerm)) continue;
    if (sourceText.indexOf(originalTerm) >= 0 || canonicalText.indexOf(canonicalTerm) >= 0) {
      found.push(originalTerm);
      seen.add(canonicalTerm);
    }
  }
  return found;
}

function validLabels(value, whitelist) {
  const values = [];
  const invalid = [];
  for (const item of asArray(value)) {
    if (item === undefined || item === null || String(item).trim() === '') continue;
    const label = String(item).trim();
    if (whitelist.includes(label)) values.push(label);
    else invalid.push(label);
  }
  return {
    values: uniqueStable(values),
    invalid: uniqueStable(invalid),
  };
}

function extractLabel(value, fields = ['label', 'value', 'name', 'type']) {
  if (!isObject(value)) return value;
  return firstDefined(...fields.map((field) => value[field]));
}

function evidenceItems(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') {
    const normalized = normalizeSampleText(value);
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => evidenceItems(item));
  if (isObject(value)) {
    if (value.evidence !== undefined) return evidenceItems(value.evidence);
    if (value.text !== undefined || value.quote !== undefined || value.excerpt !== undefined) {
      const text = firstNonEmpty(value.text, value.quote, value.excerpt);
      return text ? [normalizeSampleText(text)] : [];
    }
    return [cloneValue(value)];
  }
  return [];
}

function hasEvidence(value) {
  return evidenceItems(value).length > 0;
}

function mergeEvidenceLists(...values) {
  return uniqueStable(
    values.flatMap((value) => evidenceItems(value)),
    (item) => (typeof item === 'string' ? canonicalizeText(item) : JSON.stringify(item)),
  );
}

function evidenceMapFromInput(input) {
  if (!isObject(input)) return {};
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (!HTL_WHITELIST.includes(key)) continue;
    const evidence = evidenceItems(value);
    if (evidence.length) result[key] = evidence;
  }
  return result;
}

function parseHtlAnnotations(input, explicitEvidence) {
  const signals = [];
  const evidence = {};
  const add = (signal, signalEvidence) => {
    if (!HTL_WHITELIST.includes(signal)) return;
    if (!signals.includes(signal)) signals.push(signal);
    const items = evidenceItems(signalEvidence);
    if (items.length) evidence[signal] = mergeEvidenceLists(evidence[signal], items);
  };

  if (typeof input === 'string') add(input, explicitEvidence);
  else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string') add(item, undefined);
      else if (isObject(item)) add(extractLabel(item, ['signal', 'label', 'value', 'name']), item.evidence);
    }
  } else if (isObject(input)) {
    const listed = firstDefined(input.signals, input.labels, input.values);
    if (listed !== undefined) {
      const genericEvidence = input.evidence;
      for (const item of asArray(listed)) {
        if (typeof item === 'string') add(item, genericEvidence);
        else if (isObject(item)) add(extractLabel(item, ['signal', 'label', 'value', 'name']), item.evidence ?? genericEvidence);
      }
    }
    for (const [key, value] of Object.entries(input)) {
      if (HTL_WHITELIST.includes(key)) add(key, value === true ? undefined : value);
    }
    for (const [key, value] of Object.entries(evidenceMapFromInput(input.evidenceBySignal))) {
      evidence[key] = mergeEvidenceLists(evidence[key], value);
    }
  }

  if (isObject(explicitEvidence) && !Array.isArray(explicitEvidence)) {
    for (const [key, value] of Object.entries(explicitEvidence)) {
      if (HTL_WHITELIST.includes(key)) evidence[key] = mergeEvidenceLists(evidence[key], value);
    }
  } else if (explicitEvidence !== undefined) {
    for (const signal of signals) evidence[signal] = mergeEvidenceLists(evidence[signal], explicitEvidence);
  }

  return { signals, evidence };
}

function normalizeSource(row, annotations) {
  const rowSource = isObject(row?.source) ? row.source : {};
  const annotationSource = isObject(annotations?.source) ? annotations.source : {};
  const get = (key, ...aliases) => firstDefined(
    annotationSource[key],
    ...aliases.map((alias) => annotations?.[alias]),
    rowSource[key],
    row?.[key],
  );
  const provenance = mergeObjects(
    row?.evidence,
    rowSource.provenance,
    row?.provenance,
    annotationSource.provenance,
    annotations?.provenance,
  );
  const source = {
    sourceWorkId: get('sourceWorkId', 'workId'),
    canonicalWorkId: get('canonicalWorkId'),
    platform: get('platform'),
    title: get('title'),
    author: get('author'),
    completionStatus: get('completionStatus'),
    rawGenres: uniqueStable(asArray(firstDefined(annotationSource.rawGenres, annotations?.rawGenres, rowSource.rawGenres, row?.rawGenres)).filter((item) => hasText(String(item))).map((item) => String(item).trim())),
    primaryGenre: get('primaryGenre'),
    genreBucket: get('genreBucket'),
    audience: get('audience'),
    rankType: get('rankType'),
    rank: get('rank'),
    wordNumber: get('wordNumber'),
  };
  const copyFirst = (key, ...values) => {
    const value = firstDefined(...values);
    if (value !== undefined && value !== null && String(value).trim() !== '') source[key] = cloneValue(value);
  };
  copyFirst('authorization', annotationSource.authorization, annotations?.authorization, rowSource.authorization, row?.authorization, provenance.authorization);
  for (const key of [
    'contentHash', 'sourceContentHash', 'sourceTextHash', 'fileSha256',
    'filePath', 'sourceFilePath', 'chapterId', 'chapterIndex', 'chapterTitle', 'chapterUrl',
    'charStart', 'charEnd', 'startOffset', 'endOffset', 'offsetUnit', 'candidateTextSha256',
    'completionEvidenceRef', 'completionEvidenceSha256', 'completionEvidenceVerified',
    'fullWorkEvidenceRef', 'fullWorkEvidenceSha256', 'fullWorkEvidenceVerified'
  ]) {
    copyFirst(
      key,
      annotationSource[key],
      annotations?.[key],
      rowSource[key],
      row?.[key],
      provenance[key]
    );
  }
  if (Object.keys(provenance).length) source.provenance = provenance;
  return source;
}

function normalizeDistribution(input) {
  if (!isObject(input)) return {};
  const entries = [];
  for (const [key, value] of Object.entries(input)) {
    if (!ARCHETYPE_WHITELIST.includes(key)) continue;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) continue;
    entries.push([key, number]);
  }
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return {};
  return Object.fromEntries(entries.map(([key, value]) => [key, Number((value / total).toFixed(6))]));
}

function normalizePerson(row, annotations) {
  const rowPerson = isObject(row?.person) ? row.person : {};
  const annotationPerson = isObject(annotations?.person) ? annotations.person : {};
  const get = (key, ...aliases) => firstDefined(
    annotationPerson[key],
    ...aliases.map((alias) => annotations?.[alias]),
    rowPerson[key],
    row?.[key],
  );
  const distribution = normalizeDistribution(get('archetypeDistribution'));
  const requestedPrimary = get('primaryArchetype', 'archetype');
  const primaryArchetype = ARCHETYPE_WHITELIST.includes(requestedPrimary)
    ? requestedPrimary
    : Object.entries(distribution).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  const stateArchetype = cloneValue(get('stateArchetype'));
  return {
    personId: get('personId'),
    canonicalName: get('canonicalName', 'name'),
    primaryArchetype,
    archetypeDistribution: distribution,
    stateArchetype: stateArchetype ?? [],
  };
}

function archetypeInputErrors(row, annotations) {
  const rowPerson = isObject(row?.person) ? row.person : {};
  const annotationPerson = isObject(annotations?.person) ? annotations.person : {};
  const requested = firstDefined(
    annotationPerson.primaryArchetype,
    annotations?.primaryArchetype,
    annotationPerson.archetype,
    annotations?.archetype,
    rowPerson.primaryArchetype,
    rowPerson.archetype,
    row?.primaryArchetype,
    row?.archetype,
  );
  const distribution = firstDefined(
    annotationPerson.archetypeDistribution,
    annotations?.archetypeDistribution,
    rowPerson.archetypeDistribution,
    row?.archetypeDistribution,
  );
  const invalid = requested && !ARCHETYPE_WHITELIST.includes(requested) ? [String(requested)] : [];
  if (isObject(distribution)) {
    for (const key of Object.keys(distribution)) {
      if (!ARCHETYPE_WHITELIST.includes(key)) invalid.push(key);
    }
  }
  return uniqueStable(invalid);
}

function normalizeEvidenceCoordinates(row, annotations) {
  const annotationEvidence = isObject(annotations?.evidence) ? annotations.evidence : {};
  const rowEvidence = isObject(row?.evidence) ? row.evidence : {};
  const evidence = {
    ...cloneValue(rowEvidence),
    ...cloneValue(annotationEvidence),
  };
  const chapterIndexes = uniqueStable([
    ...asArray(row?.chapters),
    ...asArray(annotations?.chapters),
    firstDefined(rowEvidence.chapterIndex, annotationEvidence.chapterIndex),
  ].filter((value) => value !== undefined && value !== null));
  if (chapterIndexes.length) evidence.chapters = chapterIndexes;
  const chapterEvidence = firstDefined(annotations?.chapterEvidence, row?.chapterEvidence);
  if (chapterEvidence !== undefined) evidence.chapterEvidence = cloneValue(asArray(chapterEvidence));
  return evidence;
}

function getNestedField(row, annotations, key) {
  return firstDefined(
    annotations?.[key],
    annotations?.sample?.[key],
    row?.[key],
    row?.sample?.[key],
  );
}

function normalizedStringList(value) {
  return uniqueStable(asArray(value).map((item) => normalizeSampleText(item)).filter(Boolean));
}

function normalizeMicroPatterns(value) {
  const references = [];
  const details = [];
  for (const item of asArray(value)) {
    if (typeof item === 'string') {
      const reference = normalizeSampleText(item);
      if (reference) references.push(reference);
      continue;
    }
    if (!isObject(item)) continue;
    const dimensionResult = validLabels(item.dimension, DIMENSION_WHITELIST);
    const sceneResult = validLabels(item.scene, SCENE_WHITELIST);
    const relationshipResult = validLabels(item.relationship, RELATIONSHIP_WHITELIST);
    const signalsResult = validLabels(item.signals, HTL_WHITELIST);
    const pattern = normalizedStringList(firstDefined(item.pattern, item.steps, item.structure));
    const id = normalizeSampleText(item.id ?? `mp-${String(details.length + 1).padStart(3, '0')}`);
    const invalidLabels = mergeLabelErrors(
      dimensionResult.invalid,
      sceneResult.invalid,
      relationshipResult.invalid,
      signalsResult.invalid,
    );
    const invalidFields = [];
    if (!Array.isArray(firstDefined(item.pattern, item.steps, item.structure))) invalidFields.push('pattern must be an array of structural steps');
    if (Object.prototype.hasOwnProperty.call(item, 'template') || Object.prototype.hasOwnProperty.call(item, 'sentence')) {
      invalidFields.push('fixed sentence templates are not allowed');
    }
    const detail = {
      id,
      dimension: dimensionResult.values[0] ?? null,
      scene: sceneResult.values,
      relationship: relationshipResult.values,
      signals: signalsResult.values,
      pattern,
      whyItWorks: normalizeSampleText(item.whyItWorks ?? ''),
      antiPattern: normalizeSampleText(item.antiPattern ?? ''),
      invalidLabels,
      invalidFields,
    };
    details.push(detail);
    references.push(id);
  }
  return {
    references: uniqueStable(references),
    details,
  };
}

function normalizeSubtext(row, annotations) {
  const input = getNestedField(row, annotations, 'subtext');
  const inputObject = isObject(input) ? input : {};
  const requested = firstDefined(
    inputObject.label,
    inputObject.value,
    inputObject.type,
    typeof input === 'string' ? input : undefined,
  );
  const subtext = SUBTEXT_WHITELIST.includes(requested) ? requested : null;
  const evidence = mergeEvidenceLists(
    annotations?.subtextEvidence,
    annotations?.sample?.subtextEvidence,
    inputObject.evidence,
    row?.subtextEvidence,
    row?.sample?.subtextEvidence,
    annotations?.evidence?.subtext,
    row?.evidence?.subtext,
  );
  const surfaceIntent = normalizeSampleText(firstDefined(
    annotations?.surfaceIntent,
    annotations?.sample?.surfaceIntent,
    inputObject.surfaceIntent,
    row?.surfaceIntent,
    row?.sample?.surfaceIntent,
  ));
  const confidence = firstDefined(
    annotations?.subtextConfidence,
    annotations?.sample?.subtextConfidence,
    inputObject.confidence,
    row?.subtextConfidence,
  );
  return {
    subtext,
    evidence,
    surfaceIntent: surfaceIntent || null,
    confidence: typeof confidence === 'number' && Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    invalid: requested && !subtext ? [String(requested)] : [],
  };
}

function mergeLabelErrors(...groups) {
  return uniqueStable(groups.flatMap((group) => asArray(group).filter(Boolean).map(String)));
}

function collectReferences(row, annotations) {
  return asArray(firstDefined(
    annotations?.referenceTexts,
    annotations?.existingSamples,
    annotations?.references,
    row?.referenceTexts,
    row?.existingSamples,
    row?.references,
  )).map(cloneValue);
}

function estimateConfidence(sample, safety) {
  const checks = [
    Boolean(sample.evidence && Object.keys(sample.evidence).length),
    sample.scene.length > 0,
    sample.relationship.length > 0,
    Boolean(sample.subtext && sample.subtextEvidence.length),
    sample.humanTextureSignals.length > 0,
    Object.keys(safety.forbiddenTermLayers).some((key) => safety.forbiddenTermLayers[key].length > 0),
  ];
  return Number((0.45 + (checks.filter(Boolean).length / checks.length) * 0.5).toFixed(2));
}

function sourceMetadataComplete(source) {
  return [
    source.sourceWorkId,
    source.canonicalWorkId,
    source.platform,
    source.title,
    source.author,
    source.completionStatus,
  ].every((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function isEvidenceMapComplete(signals, evidence) {
  return Array.isArray(signals) && signals.every((signal) => hasEvidence(evidence?.[signal]));
}

export function gradeCandidate(candidate, options = {}) {
  return gradeCandidateDetails(candidate, options).grade;
}

export function gradeCandidateDetails(candidate, options = {}) {
  const sample = isObject(candidate?.sample) ? candidate.sample : candidate ?? {};
  const safety = isObject(candidate?.safety) ? candidate.safety : {};
  const text = firstNonEmpty(sample.safeText, sample.text, candidate?.safeText, candidate?.text) ?? '';
  const residual = scanResidualTerms(text, firstDefined(safety.forbiddenTermLayers, safety.forbiddenTerms, candidate?.forbiddenTerms));
  const references = firstDefined(options.references, safety.referenceTexts, candidate?.referenceTexts, []);
  const overlap = scanTextOverlap(text, references, options);
  const dimensionValid = DIMENSION_WHITELIST.includes(sample.dimension ?? candidate?.dimension);
  const subtext = extractLabel(sample.subtext, ['label', 'value', 'type']) ?? sample.subtext;
  const subtextEvidence = firstDefined(sample.subtextEvidence, sample.subtext?.evidence, sample.evidence?.subtext);
  const signals = validLabels(firstDefined(sample.humanTextureSignals, sample.htl, candidate?.humanTextureSignals), HTL_WHITELIST).values;
  const htlEvidence = firstDefined(sample.humanTextureEvidence, sample.htlEvidence, candidate?.humanTextureEvidence, candidate?.htlEvidence, {});
  const hardFailures = [];
  if (!isRuntimeLength(text)) hardFailures.push('sample length must be 12-140 characters');
  if (!dimensionValid) hardFailures.push('dimension is outside the six-dimension whitelist');
  if (residual.length) hardFailures.push('residual forbidden terms remain');
  if (overlap.blocked) hardFailures.push('hash/4-gram/12-character overlap gate failed');
  if (safety.textOverlap?.blocked) hardFailures.push('stored hash/4-gram/12-character overlap gate failed');
  if (subtext && !hasEvidence(subtextEvidence)) hardFailures.push('subtext evidence is required');
  if (signals.length && !isEvidenceMapComplete(signals, htlEvidence)) hardFailures.push('HTL evidence is required for every signal');
  if (options.requireSource && !sourceMetadataComplete(candidate?.source ?? {})) hardFailures.push('source metadata is incomplete');
  if (hardFailures.length) {
    return {
      grade: 'D',
      reasons: hardFailures,
      criteriaMet: [],
      residualTerms: residual,
      overlap,
    };
  }

  const criteria = [
    ['specific', Boolean(sample.specificity ?? candidate?.specificity ?? true)],
    ['context', asArray(sample.scene).length > 0],
    ['relationship', asArray(sample.relationship).length > 0],
    ['behaviorEvidence', Boolean(sample.evidence && Object.keys(sample.evidence).length)],
    ['subtext', Boolean(subtext && hasEvidence(subtextEvidence))],
    ['humanTexture', signals.length > 0 && isEvidenceMapComplete(signals, htlEvidence)],
    ['transferable', options.transferable !== false && candidate?.transferable !== false],
    ['microPattern', asArray(sample.microPatterns ?? candidate?.microPatterns).length > 0],
  ];
  const criteriaMet = criteria.filter(([, present]) => present).map(([name]) => name);
  let grade = 'C';
  if (criteriaMet.length >= 7) grade = 'S';
  else if (criteriaMet.length >= 5) grade = 'A';
  else if (criteriaMet.length >= 3) grade = 'B';
  return {
    grade,
    reasons: criteriaMet,
    criteriaMet,
    residualTerms: residual,
    overlap,
  };
}

export function annotateCandidate(row = {}, annotations = {}) {
  row = isObject(row) ? row : {};
  annotations = isObject(annotations) ? annotations : {};
  const source = normalizeSource(row, annotations);
  const person = normalizePerson(row, annotations);
  const sampleInput = isObject(annotations.sample) ? annotations.sample : {};
  const rowSample = isObject(row.sample) ? row.sample : {};
  const rawText = normalizeSampleText(firstNonEmpty(
    annotations.rawText,
    sampleInput.rawText,
    row.rawText,
    rowSample.rawText,
    row.text,
    rowSample.text,
  ) ?? '');
  const safeText = normalizeSampleText(firstNonEmpty(
    annotations.safeText,
    sampleInput.safeText,
    row.safeText,
    rowSample.safeText,
    rawText,
  ) ?? '');
  const auditText = normalizeSampleText(firstNonEmpty(
    annotations.auditText,
    sampleInput.auditText,
    row.auditText,
    rowSample.auditText,
    safeText,
  ) ?? '');

  const dimensionResult = validLabels(getNestedField(row, annotations, 'dimension'), DIMENSION_WHITELIST);
  const secondaryDimensionResult = validLabels(
    firstDefined(annotations.secondaryDimensions, sampleInput.secondaryDimensions, row.secondaryDimensions, rowSample.secondaryDimensions),
    DIMENSION_WHITELIST,
  );
  const sceneResult = validLabels(getNestedField(row, annotations, 'scene'), SCENE_WHITELIST);
  const relationshipResult = validLabels(getNestedField(row, annotations, 'relationship'), RELATIONSHIP_WHITELIST);
  const emotionResult = validLabels(getNestedField(row, annotations, 'emotionalState'), EMOTIONAL_STATE_WHITELIST);
  const subtextResult = normalizeSubtext(row, annotations);
  const htlResult = parseHtlAnnotations(
    firstDefined(
      annotations.humanTextureSignals,
      annotations.htl,
      annotations.HTL,
      sampleInput.humanTextureSignals,
      sampleInput.htl,
      row.humanTextureSignals,
      rowSample.humanTextureSignals,
    ),
    firstDefined(
      annotations.humanTextureEvidence,
      annotations.htlEvidence,
      annotations.HTLEvidence,
      sampleInput.humanTextureEvidence,
      sampleInput.htlEvidence,
      row.humanTextureEvidence,
      rowSample.humanTextureEvidence,
    ),
  );
  const forbidden = mergeForbiddenTerms(
    annotations.forbiddenTerms,
    annotations.safety?.forbiddenTerms,
    annotations.safety?.forbiddenTermLayers,
    row.forbiddenTerms,
    row.safety?.forbiddenTerms,
    row.safety?.forbiddenTermLayers,
    {
      coreTerms: firstDefined(annotations.coreTerms, annotations.safety?.coreTerms, row.coreTerms),
      localTerms: firstDefined(annotations.localTerms, annotations.safety?.localTerms, row.localTerms),
      globalRiskTerms: firstDefined(annotations.globalRiskTerms, annotations.safety?.globalRiskTerms, row.globalRiskTerms),
    },
  );
  const residualSafe = scanResidualTerms(safeText, forbidden);
  const residualAudit = scanResidualTerms(auditText, forbidden);
  const residualTerms = uniqueStable([...residualSafe, ...residualAudit], (term) => canonicalizeText(term));
  const references = collectReferences(row, annotations);
  const overlap = scanTextOverlap(safeText, references, annotations);
  const overlapSummary = overlap.toJSON();
  const evidence = normalizeEvidenceCoordinates(row, annotations);
  const subtextEvidence = subtextResult.evidence;
  const microPatternResult = normalizeMicroPatterns(firstDefined(
    annotations.microPatterns,
    annotations.microPattern,
    sampleInput.microPatterns,
    row.microPatterns,
    rowSample.microPatterns,
  ));
  const microPatterns = microPatternResult.references;
  const antiPatterns = normalizedStringList(firstDefined(annotations.antiPatterns, sampleInput.antiPatterns, row.antiPatterns, rowSample.antiPatterns));
  const sample = {
    rawText,
    safeText,
    auditText,
    dimension: dimensionResult.values[0] ?? null,
    secondaryDimensions: secondaryDimensionResult.values,
    scene: sceneResult.values,
    relationship: relationshipResult.values,
    emotionalState: emotionResult.values,
    surfaceIntent: subtextResult.surfaceIntent,
    subtext: subtextResult.subtext,
    subtextEvidence,
    subtextConfidence: subtextResult.confidence,
    humanTextureSignals: htlResult.signals,
    humanTextureEvidence: htlResult.evidence,
    htlEvidence: cloneValue(htlResult.evidence),
    microPatterns,
    microPatternDetails: microPatternResult.details,
    antiPatterns,
    evidence,
    phrase: firstNonEmpty(annotations.phrase, sampleInput.phrase, row.phrase, rowSample.phrase) ?? null,
    context: firstNonEmpty(annotations.context, sampleInput.context, row.context, rowSample.context) ?? null,
    normalizedTextHash: normalizedTextHash(safeText),
    fourGramSignature: fourGrams(safeText),
  };
  const safety = {
    forbiddenTerms: makeMergedTermList(forbidden),
    forbiddenTermLayers: {
      coreTerms: forbidden.coreTerms,
      localTerms: forbidden.localTerms,
      globalRiskTerms: forbidden.globalRiskTerms,
    },
    residualTerms,
    residualTermsByTrack: {
      safeText: residualSafe,
      auditText: residualAudit,
    },
    anonymizationScore: typeof annotations.anonymizationScore === 'number'
      ? Math.max(0, Math.min(1, annotations.anonymizationScore))
      : (residualTerms.length === 0 ? 1 : 0),
    textOverlap: overlapSummary,
  };
  const qualityInput = isObject(annotations.quality) ? annotations.quality : {};
  const gradeDetails = gradeCandidateDetails({ source, person, sample, safety }, {
    references,
    ...annotations,
  });
  const labelErrors = mergeLabelErrors(
    dimensionResult.invalid,
    secondaryDimensionResult.invalid,
    sceneResult.invalid,
    relationshipResult.invalid,
    emotionResult.invalid,
    subtextResult.invalid,
    microPatternResult.details.flatMap((detail) => [...detail.invalidLabels, ...detail.invalidFields]),
    archetypeInputErrors(row, annotations),
  );
  const quality = {
    confidence: typeof firstDefined(qualityInput.confidence, annotations.confidence, row.confidence) === 'number'
      ? Math.max(0, Math.min(1, firstDefined(qualityInput.confidence, annotations.confidence, row.confidence)))
      : estimateConfidence(sample, safety),
    grade: gradeDetails.grade,
    criteriaMet: gradeDetails.criteriaMet,
    reasons: gradeDetails.reasons,
    labelErrors,
    requestedGrade: qualityInput.grade ?? null,
  };

  return {
    schemaVersion: RICH_SCHEMA_VERSION,
    source,
    person,
    sample,
    safety,
    quality,
  };
}

function splitChapterUnits(input, options = {}) {
  if (Array.isArray(input)) {
    return input.flatMap((item, index) => splitChapterUnits(item, {
      ...options,
      chapterIndex: isObject(item) ? firstDefined(item.chapterIndex, item.index, index + 1) : firstDefined(options.chapterIndex, index + 1),
    }));
  }
  if (isObject(input) && Array.isArray(input.chapters)) return splitChapterUnits(input.chapters, options);
  if (isObject(input)) {
    return [{
      text: String(firstNonEmpty(input.text, input.content, input.chapterText) ?? ''),
      chapterIndex: firstDefined(input.chapterIndex, input.index, options.chapterIndex),
      paragraphIndex: input.paragraphIndex,
      charOffset: Number.isInteger(input.charOffset) ? input.charOffset : 0,
      sourceWorkId: firstDefined(input.sourceWorkId, options.sourceWorkId),
    }];
  }
  return [{
    text: String(input ?? ''),
    chapterIndex: options.chapterIndex,
    paragraphIndex: options.paragraphIndex,
    charOffset: Number.isInteger(options.charOffset) ? options.charOffset : 0,
    sourceWorkId: options.sourceWorkId,
  }];
}

function sentenceSpans(text) {
  const spans = [];
  SENTENCE_BOUNDARY.lastIndex = 0;
  let match;
  while ((match = SENTENCE_BOUNDARY.exec(text)) !== null) {
    const raw = match[0];
    const leading = raw.search(/\S/u);
    if (leading < 0) continue;
    const start = match.index + leading;
    const end = match.index + raw.length;
    spans.push({ start, end, text: text.slice(start, end) });
  }
  if (!spans.length && text.trim()) {
    const leading = text.search(/\S/u);
    spans.push({ start: leading < 0 ? 0 : leading, end: text.length, text: text.trim() });
  }
  return spans;
}

function quoteSpans(text) {
  const result = [];
  for (const pattern of QUOTE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      result.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[1],
        fullText: match[0],
      });
    }
  }
  return result.sort((left, right) => left.start - right.start || left.end - right.end);
}

function spanContains(span, point) {
  return span.start <= point && point < span.end;
}

function paragraphIndexAt(text, position) {
  return text.slice(0, position).split(/\n/gu).length;
}

function containsCue(text, patterns) {
  const comparableText = canonicalizeText(text);
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
    pattern.lastIndex = 0;
    return pattern.test(comparableText);
  });
}

function canonicalPhrase(value) {
  return canonicalizeText(value).replace(/[“”「」『』"‘’'，。！？!?；;、：:（）()\[\]【】]/gu, '');
}

function catchphraseSet(text, quotes, options) {
  const counts = new Map();
  for (const quote of quotes) {
    const key = canonicalPhrase(quote.text);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const phrase of asArray(options.catchphrases)) {
    const key = canonicalPhrase(phrase);
    if (key) counts.set(key, Math.max(2, counts.get(key) ?? 0));
  }
  return counts;
}

function trimSpan(text, start, end) {
  let left = start;
  let right = end;
  while (left < right && /\s/u.test(text[left])) left += 1;
  while (right > left && /\s/u.test(text[right - 1])) right -= 1;
  return { start: left, end: right, text: text.slice(left, right) };
}

function expandShortSpan(spans, index, sourceText) {
  const current = spans[index];
  if (characterCount(current.text) >= SAMPLE_MIN_CHARS) return current;
  const next = spans[index + 1];
  if (next && characterCount(sourceText.slice(current.start, next.end)) <= SAMPLE_MAX_CHARS) {
    return trimSpan(sourceText, current.start, next.end);
  }
  const previous = spans[index - 1];
  if (previous && characterCount(sourceText.slice(previous.start, current.end)) <= SAMPLE_MAX_CHARS) {
    return trimSpan(sourceText, previous.start, current.end);
  }
  return current;
}

function capSpan(span) {
  const chars = Array.from(span.text);
  if (chars.length <= SAMPLE_MAX_CHARS) return span;
  return {
    ...span,
    text: chars.slice(0, SAMPLE_MAX_CHARS).join(''),
    end: span.start + chars.slice(0, SAMPLE_MAX_CHARS).join('').length,
  };
}

function quoteIntersectsSpan(quote, span) {
  return quote.start < span.end && quote.end > span.start;
}

function primaryKindFor(matches) {
  const priority = ['catchphrase', 'dialogue', 'psychology', 'appearance', 'expression', 'action', 'lifeTexture'];
  return priority.find((kind) => matches.includes(kind)) ?? null;
}

function dimensionForKind(kind) {
  return kind === 'lifeTexture' ? 'action' : kind;
}

function buildEvidence(unit, span) {
  const chapterIndex = unit.chapterIndex;
  const evidence = {
    chapterIndex: chapterIndex ?? null,
    paragraphIndex: unit.paragraphIndex ?? paragraphIndexAt(unit.text, span.start),
    charStart: unit.charOffset + span.start,
    charEnd: unit.charOffset + span.end,
  };
  return evidence;
}

export function candidateMine(text, options = {}) {
  options = isObject(options) ? options : {};
  const units = splitChapterUnits(text, options);
  const globalQuotes = units.flatMap((unit) => quoteSpans(String(unit.text ?? '')));
  const globalCatchphrases = catchphraseSet('', globalQuotes, options);
  const candidates = [];
  for (const unit of units) {
    const sourceText = String(unit.text ?? '');
    if (!sourceText.trim()) continue;
    const spans = sentenceSpans(sourceText);
    const quotes = quoteSpans(sourceText);
    for (let index = 0; index < spans.length; index += 1) {
      const span = capSpan(expandShortSpan(spans, index, sourceText));
      const textValue = normalizeSampleText(span.text);
      if (!isRuntimeLength(textValue)) continue;
      const matchedKinds = [];
      const containedQuotes = quotes.filter((quote) => quoteIntersectsSpan(quote, span));
      if (containedQuotes.length) matchedKinds.push('dialogue');
      if (containedQuotes.some((quote) => (globalCatchphrases.get(canonicalPhrase(quote.text)) ?? 0) >= 2)) matchedKinds.push('catchphrase');
      for (const dimension of ['appearance', 'expression', 'action', 'psychology']) {
        if (containsCue(textValue, DIMENSION_CUES[dimension])) matchedKinds.push(dimension);
      }
      if (containsCue(textValue, [LIFE_TEXTURE_REGEX])) matchedKinds.push('lifeTexture');
      if (!matchedKinds.length) continue;
      const uniqueKinds = uniqueStable(matchedKinds);
      const primaryKind = primaryKindFor(uniqueKinds);
      const dimension = dimensionForKind(primaryKind);
      const secondaryDimensions = uniqueStable(uniqueKinds
        .filter((kind) => kind !== primaryKind)
        .map(dimensionForKind)
        .filter((item) => DIMENSION_WHITELIST.includes(item)));
      const evidence = buildEvidence(unit, span);
      candidates.push({
        id: null,
        text: textValue,
        dimension,
        secondaryDimensions,
        kind: primaryKind,
        recallKinds: uniqueKinds,
        sourceWorkId: unit.sourceWorkId ?? options.sourceWorkId ?? null,
        evidence,
        chapterEvidence: [cloneValue(evidence)],
        chapters: evidence.chapterIndex === null ? [] : [evidence.chapterIndex],
        normalizedTextHash: normalizedTextHash(textValue),
      });
    }
  }

  const deduped = [];
  const byCanonicalText = new Map();
  for (const candidate of candidates) {
    const key = canonicalizeText(candidate.text);
    const existing = byCanonicalText.get(key);
    if (!existing) {
      const next = {
        ...candidate,
        id: `candidate-${String(deduped.length + 1).padStart(4, '0')}`,
      };
      byCanonicalText.set(key, next);
      deduped.push(next);
      continue;
    }
    existing.recallKinds = uniqueStable([...existing.recallKinds, ...candidate.recallKinds]);
    existing.secondaryDimensions = uniqueStable([...existing.secondaryDimensions, ...candidate.secondaryDimensions]);
    existing.chapters = uniqueStable([...existing.chapters, ...candidate.chapters]);
    existing.chapterEvidence = [...existing.chapterEvidence, ...candidate.chapterEvidence];
  }
  const maxCandidates = Number.isInteger(options.maxCandidates) && options.maxCandidates >= 0
    ? options.maxCandidates
    : Infinity;
  return deduped.slice(0, maxCandidates);
}

function annotationForRow(annotations, row, index) {
  if (Array.isArray(annotations)) return annotations[index] ?? {};
  if (!isObject(annotations)) return {};
  const map = annotations.byId ?? annotations.annotationsById;
  if (isObject(map) && row?.id && isObject(map[row.id])) return { ...annotations, ...map[row.id] };
  return annotations;
}

export function buildRichIntermediate(input, annotations = {}) {
  if (Array.isArray(input)) {
    return input.map((row, index) => annotateCandidate(row, annotationForRow(annotations, row, index)));
  }
  if (isObject(input) && Array.isArray(firstDefined(input.rows, input.candidates))) {
    const rows = firstDefined(input.rows, input.candidates);
    const shared = { ...input, ...annotations };
    delete shared.rows;
    delete shared.candidates;
    delete shared.annotations;
    const perRow = input.annotations ?? input.annotation ?? annotations;
    return rows.map((row, index) => annotateCandidate(row, {
      ...shared,
      ...annotationForRow(perRow, row, index),
    }));
  }
  if (isObject(input) && input.row !== undefined) {
    return annotateCandidate(input.row, {
      ...input,
      ...annotations,
      ...(input.annotations ?? input.annotation ?? {}),
    });
  }
  return annotateCandidate(input ?? {}, annotations);
}

function arrayEquals(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function richRecordErrors(record) {
  const errors = [];
  if (!isObject(record)) return ['record must be an object'];
  if (record.schemaVersion !== RICH_SCHEMA_VERSION) errors.push('schemaVersion must be corpus-v3.1-rich-1');
  for (const section of ['source', 'person', 'sample', 'safety', 'quality']) {
    if (!isObject(record[section])) errors.push(`${section} section is required`);
  }
  if (!isObject(record.source) || !sourceMetadataComplete(record.source)) errors.push('source metadata is incomplete');
  if (!isObject(record.person)) {
    errors.push('person section is required');
  } else {
    if (!hasText(record.person.personId)) errors.push('person.personId is required');
    if (!hasText(record.person.canonicalName)) errors.push('person.canonicalName is required');
    if (!ARCHETYPE_WHITELIST.includes(record.person.primaryArchetype)) errors.push('person.primaryArchetype is outside the archetype whitelist');
    if (!isObject(record.person.archetypeDistribution)) errors.push('person.archetypeDistribution must be an object');
    else if (Object.keys(record.person.archetypeDistribution).some((key) => !ARCHETYPE_WHITELIST.includes(key))) errors.push('person.archetypeDistribution contains an invalid archetype');
  }
  if (!isObject(record.sample)) return errors;

  const sample = record.sample;
  for (const field of ['rawText', 'safeText', 'auditText']) {
    if (typeof sample[field] !== 'string') errors.push(`sample.${field} is required`);
    else if (!isRuntimeLength(sample[field])) errors.push(`sample.${field} must be 12-140 characters`);
  }
  if (!DIMENSION_WHITELIST.includes(sample.dimension)) errors.push('sample.dimension is outside the six-dimension whitelist');
  for (const [field, whitelist] of [
    ['secondaryDimensions', DIMENSION_WHITELIST],
    ['scene', SCENE_WHITELIST],
    ['relationship', RELATIONSHIP_WHITELIST],
    ['emotionalState', EMOTIONAL_STATE_WHITELIST],
    ['humanTextureSignals', HTL_WHITELIST],
  ]) {
    if (!Array.isArray(sample[field])) errors.push(`sample.${field} must be an array`);
    else if (sample[field].some((value) => !whitelist.includes(value))) errors.push(`sample.${field} contains a value outside its whitelist`);
  }
  if (sample.subtext !== null && sample.subtext !== undefined && !SUBTEXT_WHITELIST.includes(extractLabel(sample.subtext))) {
    errors.push('sample.subtext is outside the subtext whitelist');
  }
  if (sample.subtext && !hasEvidence(firstDefined(sample.subtextEvidence, sample.subtext?.evidence, sample.evidence?.subtext))) {
    errors.push('sample.subtextEvidence is required when subtext is present');
  }
  if (Array.isArray(sample.humanTextureSignals) && sample.humanTextureSignals.length && !isEvidenceMapComplete(sample.humanTextureSignals, firstDefined(sample.humanTextureEvidence, sample.htlEvidence))) {
    errors.push('sample.humanTextureEvidence is required for every HTL signal');
  }
  if (Array.isArray(sample.microPatternDetails)) {
    for (const detail of sample.microPatternDetails) {
      if (!isObject(detail) || !Array.isArray(detail.pattern) || detail.pattern.length === 0) {
        errors.push('sample.microPatternDetails must describe structural steps in an array');
        continue;
      }
      if (detail.dimension !== null && detail.dimension !== undefined && !DIMENSION_WHITELIST.includes(detail.dimension)) {
        errors.push('sample.microPatternDetails.dimension is outside the six-dimension whitelist');
      }
      if (!Array.isArray(detail.scene) || detail.scene.some((value) => !SCENE_WHITELIST.includes(value))) errors.push('sample.microPatternDetails.scene contains an invalid scene');
      if (!Array.isArray(detail.relationship) || detail.relationship.some((value) => !RELATIONSHIP_WHITELIST.includes(value))) errors.push('sample.microPatternDetails.relationship contains an invalid relationship');
      if (!Array.isArray(detail.signals) || detail.signals.some((value) => !HTL_WHITELIST.includes(value))) errors.push('sample.microPatternDetails.signals contains an invalid HTL signal');
      if (detail.invalidLabels?.length || detail.invalidFields?.length) errors.push('sample.microPatternDetails contains invalid template or labels');
    }
  }
  if (!isObject(sample.evidence) || !Object.keys(sample.evidence).length) errors.push('sample.evidence is required');
  if (Array.isArray(sample.evidence?.evidenceSpans)) {
    for (const span of sample.evidence.evidenceSpans) {
      const start = Number(span?.start);
      const end = Number(span?.end);
      const spanText = typeof span?.text === 'string' ? span.text : '';
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > sample.rawText.length || sample.rawText.slice(start, end) !== spanText) {
        errors.push('sample.evidence.evidenceSpans must match sample.rawText coordinates');
      }
    }
  }

  if (!isObject(record.safety)) return errors;
  const safety = record.safety;
  if (!Array.isArray(safety.forbiddenTerms)) errors.push('safety.forbiddenTerms must be a merged array');
  if (!isObject(safety.forbiddenTermLayers)) {
    errors.push('safety.forbiddenTermLayers must contain coreTerms/localTerms/globalRiskTerms');
  } else {
    for (const layer of FORBIDDEN_TERM_LAYERS) {
      if (!Array.isArray(safety.forbiddenTermLayers[layer])) errors.push(`safety.forbiddenTermLayers.${layer} must be an array`);
    }
    const merged = mergeForbiddenTerms(safety.forbiddenTermLayers);
    if (!arrayEquals(safety.forbiddenTerms, merged.all)) errors.push('safety.forbiddenTerms must be the stable three-layer merge');
  }
  const mergedTerms = Array.isArray(safety.forbiddenTerms) ? safety.forbiddenTerms : [];
  const safeResidual = scanResidualTerms(sample.safeText, mergedTerms);
  const auditResidual = scanResidualTerms(sample.auditText, mergedTerms);
  const actualResidual = uniqueStable([...safeResidual, ...auditResidual], (term) => canonicalizeText(term));
  if (actualResidual.length) errors.push('safety residualTerms must be empty on both safeText and auditText');
  if (!Array.isArray(safety.residualTerms) || safety.residualTerms.length) errors.push('safety.residualTerms must be empty');
  if (!isObject(safety.residualTermsByTrack)) errors.push('safety.residualTermsByTrack is required');
  if (typeof safety.anonymizationScore !== 'number' || safety.anonymizationScore < 0 || safety.anonymizationScore > 1) errors.push('safety.anonymizationScore must be between 0 and 1');
  const storedOverlap = safety.textOverlap;
  if ((isObject(storedOverlap) || Array.isArray(storedOverlap)) && storedOverlap.blocked) errors.push('safety.textOverlap failed the overlap hard gate');
  if (Array.isArray(safety.referenceTexts)) {
    const overlap = scanTextOverlap(sample.safeText, safety.referenceTexts);
    if (overlap.blocked) errors.push('sample.safeText has a forbidden 12-character/hash/4-gram overlap');
  }
  if (sample.normalizedTextHash && sample.normalizedTextHash !== normalizedTextHash(sample.safeText)) errors.push('sample.normalizedTextHash is stale');

  if (!isObject(record.quality)) return errors;
  if (!['S', 'A', 'B', 'C', 'D'].includes(record.quality.grade)) errors.push('quality.grade is invalid');
  if (record.quality.grade === 'D') errors.push('quality.grade D is rejected');
  if (typeof record.quality.confidence !== 'number' || record.quality.confidence < 0 || record.quality.confidence > 1) errors.push('quality.confidence must be between 0 and 1');
  if (Array.isArray(record.quality.labelErrors) && record.quality.labelErrors.length) errors.push('quality.labelErrors contains values outside a whitelist');
  return errors;
}

export function validateRichRecord(record) {
  const errors = richRecordErrors(record);
  const sample = isObject(record?.sample) ? record.sample : {};
  const safety = isObject(record?.safety) ? record.safety : {};
  const terms = Array.isArray(safety.forbiddenTerms) ? safety.forbiddenTerms : [];
  const residualTerms = uniqueStable([
    ...scanResidualTerms(sample.safeText ?? '', terms),
    ...scanResidualTerms(sample.auditText ?? '', terms),
  ], (term) => canonicalizeText(term));
  const hardGate = {
    schema: record?.schemaVersion === RICH_SCHEMA_VERSION,
    runtimeLength: isRuntimeLength(sample.safeText) && isRuntimeLength(sample.auditText),
    residualTerms: residualTerms.length === 0,
    twelveCharacterOverlap: !(safety.textOverlap?.hardOverlap ?? safety.textOverlap?.blocked),
    sourceMetadata: sourceMetadataComplete(record?.source ?? {}),
  };
  return {
    valid: errors.length === 0,
    errors,
    residualTerms,
    hardGate,
  };
}

export const validateRichIntermediate = validateRichRecord;

export default {
  RICH_SCHEMA_VERSION,
  DIMENSIONS,
  DIMENSION_WHITELIST,
  SCENE_WHITELIST,
  RELATIONSHIP_WHITELIST,
  EMOTIONAL_STATE_WHITELIST,
  SUBTEXT_WHITELIST,
  HTL_WHITELIST,
  HUMAN_TEXTURE_SIGNALS,
  ARCHETYPE_WHITELIST,
  ARCHETYPES,
  WHITELISTS,
  V31_WHITELISTS,
  SIX_DIMENSIONS,
  SCENES,
  RELATIONSHIPS,
  EMOTIONAL_STATES,
  SUBTEXTS,
  HTL,
  CANDIDATE_RECALL_KINDS,
  candidateMine,
  annotateCandidate,
  buildRichIntermediate,
  validateRichRecord,
  scanResidualTerms,
  scanTextOverlap,
  gradeCandidate,
  gradeCandidateDetails,
  mergeForbiddenTerms,
  normalizeSampleText,
  canonicalizeText,
  normalizedTextHash,
  fourGrams,
  fourGramJaccard,
};
