# 《小说原本全量抽取与叙事引擎管线绘制任务手册》
> **版本**：v1.0.0 · 工业级执行标准  
> **制定日期**：2026-09-11  
> **定位**：可供任何后续 AI 模型或工程师**直接无缝接手**的完整工程与文学管线交付手册。由于上游 API 额度受限，本文档将任务划分为**零 Token 消耗离线预处理**、**前端 UI 级联就绪**、**阶梯式样板绘制**与**全量管线集成**四大阶段，严禁在无计划状态下盲目调用模型。

---

## 目录
1. [项目全景与原始资产全量盘点](#一项目全景与原始资产全量盘点)
2. [9月10日标杆体系与参考 Genre 索引（核心资产在哪里）](#二9月10日标杆体系与参考-genre-索引核心资产在哪里)
3. [三章抽取离线算法与技术规格（第一章 / 中间一章 / 最后一章）](#三三章抽取离线算法与技术规格第一章--中间一章--最后一章)
4. [叙事引擎管线绘制规范（达到9月10日完美表现的标准）](#四叙事引擎管线绘制规范达到9月10日完美表现的标准)
5. [AI 编辑器对话区 UI 改造方案（小说类型 ➔ 叙事引擎二级级联）](#五ai-编辑器对话区-ui-改造方案小说类型--叙事引擎二级级联)
6. [分阶段实施排期与标准化执行 SOP（防爆额度路线图）](#六分阶段实施排期与标准化执行-sop防爆额度路线图)
7. [验收标准与自动化回归测试清单](#七验收标准与自动化回归测试清单)

---

## 一、项目全景与原始资产全量盘点

### 1.1 原始小说库存储路径
- **根路径**：`c:\Users\lyh\Desktop\小说专属网页\资源库\小说原本\`（相对项目为 `../资源库/小说原本/`）
- **受保护属性**：该目录为**只读资源库**，严禁写入、删除或重命名其中的任何原始文件。

### 1.2 语料规模与分类统计（真实扫描数据）
经全量目录静态扫描，资源库共包含 **48 个题材子目录**，共有 **1,205 部** TXT 格式完整小说（另有根目录 3 个独立文件）：

| 序号 | 题材子目录 | 书目数量 | 序号 | 题材子目录 | 书目数量 | 序号 | 题材子目录 | 书目数量 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **悬疑脑洞** | 51 部 | 17 | **武侠** | 24 部 | 33 | **都市** | 24 部 |
| 2 | **科幻末世** | 48 部 | 18 | **古言脑洞** | 24 部 | 34 | **都市修真** | 24 部 |
| 3 | **悬疑灵异** | 41 部 | 19 | **职场婚恋** | 24 部 | 35 | **都市脑洞** | 26 部 |
| 4 | **游戏体育** | 37 部 | 20 | **玄幻言情** | 24 部 | 36 | **都市高武** | 22 部 |
| 5 | **女频衍生** | 32 部 | 21 | **轻小说** | 24 部 | 37 | **都市日常** | 22 部 |
| 6 | **女频悬疑** | 30 部 | 22 | **东方仙侠** | 23 部 | 38 | **都市种田** | 27 部 |
| 7 | **动漫衍生** | 28 部 | 23 | **年代** | 23 部 | 39 | **历史** | 22 部 |
| 8 | **历史脑洞** | 27 部 | 24 | **科幻** | 23 部 | 40 | **历史古代** | 17 部 |
| 9 | **古风世情** | 27 部 | 25 | **青春甜宠** | 23 部 | 41 | **抗战谍战** | 26 部 |
| 10 | **游戏** | 27 部 | 26 | **军事** | 22 部 | 42 | **西方奇幻** | 21 部 |
| 11 | **现言脑洞** | 27 部 | 27 | **体育** | 21 部 | 43 | **奇幻** | 20 部 |
| 12 | **男频衍生** | 27 部 | 28 | **民国言情** | 21 部 | 44 | **宫斗宅斗** | 20 部 |
| 13 | **种田** | 27 部 | 29 | **仙侠** | 25 部 | 45 | **玄幻脑洞** | 19 部 |
| 14 | **豪门总裁** | 27 部 | 30 | **传统玄幻** | 18 部 | 46 | **快穿** | 16 部 |
| 15 | **玄幻** | 26 部 | 31 | **战神赘婿** | 26 部 | 47 | **现实** | 14 部 |
| 16 | **诸天无限** | 26 部 | 32 | **星光璀璨** | 26 部 | 48 | **测试** | 3 部 |

> **总计**：1,205 部长篇小说。若每部抽取 3 章，共计 **3,615 个长章节**。绝不可直接调用云端 LLM 进行端到端分析，必须通过本地规则化程序先行切分与结构化。

---

## 二、9月10日标杆体系与参考 Genre 索引（核心资产在哪里）

9月10日的成果之所以被用户评价为“完美的表现”，是因为其建立了**纯客观事实证据链、严苛的物理质感约束、彻底封杀 AI 套话、以及严密的双轨张力模型**。

接手模型必须查阅并完全遵循以下文件中的规范与定义：

### 2.1 核心代码与题材母类映射
1. **`molan-home/lib/genre-engine.js`**：
   - **`GENRE_FAMILIES`（8大叙事母类）**：
     将 48 个子题材映射至 8 大叙事母类：
     - `玄幻修真`（玄幻、传统玄幻、玄幻脑洞、东方仙侠、仙侠、都市修真、武侠）➔ 默认路线 `yuanshi`
     - `都市高武`（都市高武、都市、都市脑洞、都市日常、都市种田、战神赘婿、现实）➔ 默认路线 `urban_grind`
     - `科幻末世`（科幻、科幻末世、星光璀璨）➔ 默认路线 `hard_survival`
     - `悬疑惊悚`（悬疑灵异、悬疑脑洞、女频悬疑）➔ 默认路线 `folklore_investigation`
     - `历史古代`（历史、历史古代、历史脑洞、抗战谍战、军事）➔ 默认路线 `dynasty_friction`
     - `西方奇幻`（奇幻、西方奇幻、诸天无限、游戏、游戏体育、轻小说、各类衍生）➔ 默认路线 `sequence_cost`
     - `古言世情`（古言脑洞、古风世情、宫斗宅斗、民国言情、年代、玄幻言情）➔ 默认路线 `mansion_secrets`
     - `现代言情`（豪门总裁、现言脑洞、青春甜宠、职场婚恋、快穿、种田、体育）➔ 默认路线 `urban_emotion`
   - **`EPISTEMIC_PRESETS`（核心动机图谱）**：
     定义了各类母类的四维核心驱动：`charactersDesire`（表面所求）、`charactersConceal`（隐匿之物）、`blindSpots`（认知盲区）、`irreversibleChange`（不可逆突变）。
   - **`GENRE_48_MECHANISMS`（`molan-home/lib/genre-mechanisms-data.js`）**：
     包含全部 48 个子题材的冲突机制、力量代价、爽点置换规律。

### 2.2 9月10日成熟管线范例（Pipeline Schema & JSON）
位于 **`molan-home/data/pipelines/`**：
- **`yuanshi-law-pipeline.json`**（《元始法则》现代硬核危机与神话大灾变复苏流）
- **`jianzhu-dahuang-pipeline.json`**（《剑烛大荒》大荒神异朋克机关与现代机敏心智探案流）
- **`fanren-xiuxian-pipeline.json`**（《凡人修仙传》散修生计精算与谨慎藏拙杀伐流）
> **标准 Schema 结构**：遵循 `https://molan.ai/schemas/pipeline-v1.json`，包含 `meta`、`macroRhythm`（目标字数、黄金前五章张力蓝图、即时生存钩子类型）、`macroProgressionLaws`（双轨危机定律、物理重量法则）、`narrativeSlots`（主角、导师、盟友的语言规范 voiceSpec 与微动作表征 tellSpec）、`causalDebt`（因果负债追踪）。

### 2.3 9月10日实战定稿与生成记录
位于 **`molan-home/generated/月圆夜前的布局-20260910/`**：
- **`提示词.md`**：展示了“极致克制”的提示词结构——人设动机、场景切入、多层反转、章末钩子悬念。
- **`generate.mjs`**：调用参数标准（`model: gpt-5.6-luna`, `temperature: 0.82`, `max_tokens: 6500`, SSE流式计费清洗 `parseLunaStream`）。
- **`月圆夜前的布局-定稿.md`**：标准正文输出（2300~2450汉字，无AI套话、极具电影画面感与博弈张力）。
- **`校对说明.md` & `定稿校验.json`**：审计合规回执。

### 2.4 本地证据库与指纹基线
- **`molan-home/data/genre-evidence/README.md` & `selection.json`**：严格说明了段落哈希、UTF-16 偏移量核验规则，禁止虚构引用。
- **`molan-home/data/genre-baselines/`**：各题材的统计指纹（单句段占比、心理描写比、对话占比、开篇/结尾模式分布）。
- **`molan-home/data/genre-lab/benchmark-suite/local-validation-20260910.json`**：9月10日本地验收数据规范。

---

## 三、三章抽取离线算法与技术规格（第一章 / 中间一章 / 最后一章）

### 3.1 零 Token 消耗原则
**严禁使用大模型进行文本切分！** 1,205 本书的章节切分必须完全依靠本地 Node.js 脚本高效离线处理，预计在 1~2 分钟内即可完成全部切分与元数据建立，Token 消耗为 **0**。

### 3.2 编码鲁棒性与解码流程
依据 `molan-home/lib/genre-evidence.js` 中的 `decodeSource` 规范：
1. **优先探测 BOM**：
   - `EF BB BF` ➔ UTF-8
   - `FE FF` / `FF FE` ➔ UTF-16 BE/LE
2. **无 BOM 探测**：
   - 尝试 UTF-8 严格解码；若出现畸变字符或抛错，使用 `iconv-lite` 或本地 GB18030/GBK 解码。
3. **记录校验信息**：
   - 记录原始文件的 `sourceSha256`、解码后字符数、总行数。

### 3.3 三章窗口定位算法
```javascript
// 核心切章逻辑（正则表达式规范）
const CHAPTER_PATTERN = /^[ \t]*(?:第[0-9一二三四五六七八九十百千万]+[章回节卷集幕篇话]|Chapter\s*\d+|引子|序章|楔子|尾声|大结局|后记)[ \t\S]*$/m;
```
1. **全书章节切分与边界定位**：
   - 扫描全文，收集所有匹配 `CHAPTER_PATTERN` 的位置索引与章节标题。
   - 过滤掉目录前置假标题（前 50 行内若密集出现多个章节标题，视作目录区，予以跳过）。
   - 得到有效章节列表 `chapters = [{ index, title, startOffset, endOffset }]`。
2. **抽取三章窗口**：
   - **第一章（Opening Chapter）**：
     - 首选正式的第一章（如 `第1章` 或 `第一章`）；若存在引子/序章且字数大于 800 字，可作为前置附录，但核心定位取“正文第一章”。
     - 终点由第二章标题的起始位置严格截断。
   - **中间一章（Midpoint Climax Chapter）**：
     - 取全书章节索引中位数：Mid = Math.floor(N / 2)。
     - 选取第 Mid 章（若字数异常偏短如不足 800 字的请假条，则就近顺延至 Mid ± 1）。
     - 终点由第 Mid + 1 章标题截断。
   - **最后一章（Ending Chapter）**：
     - 取全书最后一章（通常为大结局、尾声或第 N 章）。
     - 过滤末尾常见杂质（“全书完”、“新书预告”、“完本感言”、“投月票”等后记内容），保留核心情节落幕段落。
3. **存储规范**：
   提取结果保存至：`molan-home/data/genre-lab/extracted-triplets/<母类>/<书名>.json`。
   包含字段：
   ```json
   {
     "bookId": "sha256-16",
     "title": "元始法则",
     "author": "飞天鱼",
     "category": "玄幻",
     "family": "玄幻修真",
     "sourcePath": "资源库/小说原本/玄幻/元始法则 - 飞天鱼.txt",
     "totalChapters": 412,
     "chapters": {
       "first": { "title": "第一章 ...", "text": "...", "wordCount": 3200 },
       "middle": { "index": 206, "title": "第206章 ...", "text": "...", "wordCount": 2950 },
       "last": { "index": 412, "title": "第412章 ...", "text": "...", "wordCount": 3100 }
     }
   }
   ```

---

## 四、叙事引擎管线绘制规范（达到9月10日完美表现的标准）

将三章内容输入模型绘制管线时，必须强制模型按**9月10日黄金标杆**输出结构化 Pipeline JSON。严禁输出空泛套话，每一项必须能直接指导正文生成。

### 4.1 叙事管线五大核心要素（Schema 契约）

1. **宏观节奏与开篇五章蓝图 (`macroRhythm.goldFiveChaptersBlueprint`)**：
   - 提取该书/该题材独特的开篇递进轨迹。
   - 每章必须具备：
     - `titlePattern`（场景行动模式，如：`【市井算账 ➔ 湿冷拒米 ➔ 暗河退水缝异动】`）
     - `tensionCurve`（张力阶梯，如：`平稳引入(2) ➔ 规制摩擦(5) ➔ 物理反常(7) ➔ 生死威胁(9)`）
     - `narrativeMission`（不可逆的叙事使命，确立身份、打破常理、逼出底牌）
     - `hookType`（章末留钩：必须是**即时生存大威胁**或**核心动机共振**，严禁无效悬念）

2. **宏观推进法则 (`macroProgressionLaws`)**：
   - **双轨危机张力定律 (`crisisDualTrack`)**：
     必须明确该作品的“外部生存/超自然压迫”与“内部封闭社会/人际利益博弈”如何两条线交织推进。
   - **物理重量法则 (`physicalWeightLaw`)**：
     明确战斗与行动的物质约束（受寒发僵、失血眩晕、器材承重极限、法宝发热与损耗、空间尺度测算）。

3. **人设与声音规格槽位 (`narrativeSlots`)**：
   - **主角槽位 (`protagonistSlot`)**：
     - `archetypeRole`（角色原型，如：隐锋藏刃的年轻传承者）
     - `voiceSpec`（对白样本与**绝对禁忌 taboos**：坚决禁止中二口号、说教与死前嘲弄）
     - `tellSpec`（微动作身体语言：焦虑、专注、悲伤时的具体肢体细节）
   - **关键导师/盟友/反派槽位 (`mentorAnchorSlot`, `antagonistSlot`)**。

4. **因果负债与认知隔离 (`causalDebt`)**：
   - 记录每一场博弈所产生的“后患”与“代价”（例如：动用底牌留下的痕迹、杀死敌方探子引来的调查）。
   - 严格隔离视角权限，禁止全知上帝视角穿透。

5. **物理级去 AI 味禁令**：
   - 在 Prompt 和 Rules 中写入绝对禁词表：`眼神一凝`、`倒吸一口凉气`、`嘴角勾起一抹弧度`、`深吸一口气`、`恐怖如斯`、`眸中闪过一丝异色`。

---

## 五、AI 编辑器对话区 UI 改造方案（小说类型 ➔ 叙事引擎二级级联）

根据用户截图 `media_1789137926511.png`，在 AI 创作助手的侧边栏控件区实现**二级联动**。

### 5.1 控件布局变迁
- **原有布局**：
  - 控件 1：模型选择 (`data-completion-model`)
  - 控件 2：Skill 选择 (`data-completion-skill`)
  - 控件 3：历史会话 (`data-completion-history`)
  - 控件 4：思考强度 (`data-completion-thinking-control`)
  - 控件 5：叙事引擎 (`data-completion-xuanhuan-route`)（单一大列表）
- **改造后全新布局**：
  - 控件 1：模型选择
  - 控件 2：Skill 选择
  - 控件 3：历史会话
  - 控件 4：思考强度
  - **控件 5-A（新增一级）：小说类型选择 (`data-completion-genre-family`)**
    - 显示标签：`小说类型`
    - 选项：包含 `全部 / 智能匹配 (auto)` 以及 8 大母类（玄幻修真、都市高武、科幻末世、悬疑惊悚、历史古代、西方奇幻、古言世情、现代言情）。
  - **控件 5-B（联动二级）：叙事引擎路线 (`data-completion-xuanhuan-route`)**
    - 显示标签：`叙事引擎`
    - 选项：**根据一级类型动态变更**！当一级选中“玄幻修真”时，仅列出元始法则、剑烛大荒、凡人修仙等玄幻特化管线；选中“科幻末世”时，列出这游戏也太真实了、黎明之剑等。

### 5.2 代码落地位置与实现
1. **修改文件**：`molan-home/completion-editor.js`
   - 在 `renderEditorPage`（约第 960 行）：
     在 `thinkingControl` 之后，生成：
     ```html
     <label class="ai-control-field" data-completion-family-field>
       <span class="ai-control-field__label">小说类型</span>
       <select class="ai-select" data-completion-genre-family aria-label="选择小说类型母类">
         ${buildGenreFamilyOptions(state)}
       </select>
     </label>
     <label class="ai-control-field" data-completion-xuanhuan-field>
       <span class="ai-control-field__label">叙事引擎</span>
       <select class="ai-select" data-completion-xuanhuan-route aria-label="选择叙事引擎路线">
         ${buildGenreRouteOptions(state, currentFamily)}
       </select>
     </label>
     ```
2. **级联联动事件监听**：
   - 在 `installDelegation` 的 `document.addEventListener('change', ...)`：
     ```javascript
     const familySelect = event.target.closest('[data-completion-genre-family]');
     if (familySelect) {
       const state = editorState(false);
       if (state) state.genreFamily = familySelect.value;
       // 重新渲染二级叙事引擎选项
       const routeSelect = stageNode.querySelector('[data-completion-xuanhuan-route]');
       if (routeSelect) {
         routeSelect.innerHTML = buildGenreRouteOptions(state, familySelect.value);
         state.genreRoute = routeSelect.value;
       }
       return;
     }
     ```
3. **状态持久化**：
   - `state.genreFamily` 与 `state.genreRoute` 同步持久化至当前小说及会话中，刷新页面不丢失。

---

## 六、分阶段实施排期与标准化执行 SOP（防爆额度路线图）

由于 1,205 部小说全量绘制叙事引擎需要巨大的上下文理解，**必须分步阶梯式推进**：

### 阶段一：纯离线工程预处理（0 Token 消耗）
1. **运行切章脚本**：
   编写 `molan-home/scripts/extract-all-triplets.mjs`，顺序遍历 48 个目录，解码并切出 1,205 部小说的第一章、中间一章、最后一章，输出本地 JSON 索引。
2. **建立全景目录表**：
   生成 `molan-home/data/genre-lab/triplets-inventory.json`，统计成功切章率（预期 > 98%）。

### 阶段二：前端 UI 二级级联选择器上线（0 Token 消耗）
1. 在 `completion-editor.js` 中实现 `小说类型 ➔ 叙事引擎` 级联选择器。
2. 确保 8 大母类与其预置的代表性引擎正常联动。
3. 运行全套自动化测试，确保 93 项单元测试 100% 通过。

### 阶段三：标杆母类管线绘制试点（阶梯消耗，严格监控）
1. **试点范围**：8 大母类各选取 1~2 部最具代表性的经典力作（共约 10~16 部）。
   - 玄幻修真：《元始法则》（已就绪）、《剑烛大荒》（已就绪）、《凡人修仙传》（已就绪）
   - 都市高武：《以神通之名》
   - 科幻末世：《这游戏也太真实了》
   - 悬疑惊悚：《捞尸人》
   - 历史古代：《神话版三国》
   - 西方奇幻：《诡秘之主 / 宿命之环》
2. **执行绘制**：
   运行管线生成脚本，对照 9月10日 Schema 校验，写入 `molan-home/data/pipelines/`。
3. **人工/机器双重审校**：
   验证是否达成 9月10日 的物理质感、双轨危机与黄金留钩水准。

### 阶段四：全量批次扩展（按额度配额推进）
1. 建立队列任务机制（支持断点续传、失败重试、用量记录）。
2. 后续每批次处理 50~100 部，逐步充实 48 个子题材的细分专属引擎，直至 1,205 部全量管线就绪。

---

## 七、验收标准与自动化回归测试清单

任何后续模型完成各阶段工作后，必须执行以下验收门禁：

1. **语法与静态健全性**：
   ```powershell
   & "..\tools\node22_runtime\node.exe" --check molan-home/completion-editor.js
   & "..\tools\node22_runtime\node.exe" --check molan-home/server.js
   ```
2. **自动化测试套件（93项必须 100% 通过）**：
   ```powershell
   & "..\tools\node22_runtime\node.exe" --experimental-sqlite --no-warnings --test test/chat-stream-resilience.test.js test/benchmark-editor.test.js test/creation-retry.test.js test/creation-main-flow.test.js test/two-stage-creation.test.js test/benchmark-pipeline.test.js test/benchmark-http.test.js
   ```
3. **界面验证**：
   - 确认 AI 创作助手右侧栏中：一级【小说类型】与二级【叙事引擎】正常级联切换；
   - 确认输入框 Enter 键即时发送、Shift+Enter 换行、生成完成自动呈现【插入正文】与【复制】按钮。
