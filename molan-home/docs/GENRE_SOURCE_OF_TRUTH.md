# 题材体系唯一真理源规范 (GENRE_SOURCE_OF_TRUTH)

本规范确立 `lib/genre/genre-registry.js` 作为全站题材体系的唯一源头。前端通过 `/api/genre-catalog` 异步获取，严禁前后端双轨维护产生漂移。

## 1. 九大题材母类 (9 Genre Families)

1. `xuanhuan` (玄幻修真): 散修生计、宗族谱系、重型战舰修真工业、大荒市井机关。
2. `urban_martial` (都市高武): 官方规制与实战攻防、沿海捕捞潮汐考据、重工拓荒与集体纪律。
3. `scifi_apocalypse` (科幻末世): 废土避难所工业复苏、魔导工业去魅、基因武者深空尺度。
4. `suspense` (悬疑惊悚): 江湖捞尸门道民俗、空间规则怪谈、地方志式异闻调查。
5. `history` (历史古代): 军团大阵与天下大势、隐蔽战线密电破译。
6. `western_fantasy` (西方奇幻): 秩序隐秘魔药代价、机械图纸智械军团、猎杀者契约刀术。
7. `ancient_romance` (古言世情): 月例账目与内宅生存策略、宗法礼教利益博弈。
8. `modern_romance` (现代言情): 投行对赌势均力敌、职场博弈心理防线。
9. `universal` (通用现实): 现实情境与戏剧阻力、生活本相克制叙事。

## 2. 路由机制解耦规范

- **去具体书名号依赖**：内部状态与提示词编译仅传递计算型机制标签（如 `cautious_survival`, `wasteland_industrial_recovery`），不把“《凡人修仙传》”、“《吞噬星空》”等直接作为硬编码指令。
- **向后兼容性**：保留 `legacyValue` 别名映射（如 `fanren` -> `cautious_survival`），确保历史草稿与测试数据平滑解析。
