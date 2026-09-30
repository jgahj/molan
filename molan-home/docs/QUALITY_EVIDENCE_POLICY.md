# 质量证据与无假评分刚性规范 (QUALITY_EVIDENCE_POLICY)

本文档明确墨阑系统“反对一切虚假评分、反对把数据存在伪装为文学质量”的刚性准则。

## 1. 质量维度五态机 (Dimension Status)

所有 Quality Dimension 必须且仅允许处于以下五个状态之一：
1. `NOT_MEASURED`: 该维度在本轮尚未真实测量。`value` 必须为 `null`，`confidence: 0`，`evidence: []`。严禁因字段存在或无报错而默认赋高分（如 0.85/0.88）。
2. `ESTIMATED`: 启发式粗估（仅限非关键辅助维度）。
3. `MEASURED`: 确定性代码或自然语言指标完成真实测量，具备正文证据链。
4. `JUDGED`: 经由独立 LLM 审校官完成审查并输出结构化证据。
5. `HUMAN_REVIEWED`: 真人盲评或人工验收标记。

## 2. 证据刚性规则 (Evidence Verification)

1. **逐字引文比对 (Verbatim Quote Matching)**：
   - 任何标记为 `severity: 'blocker'` 的缺陷项，必须具备正文字符串 `quote`。
   - 系统将在 `outputHash` 对应的正文内做 `text.includes(quote)` 强校验。无法精确定位引文的，一律标记为 `unverified`，绝对禁止作为阻断项卡住流程。
2. **拒绝合成赋分**：
   - 严禁通过 `charCount > 10`、`causalDebt.length > 0` 直接得出 0.85/0.88。
   - 必须通过实际在正文中搜索匹配词、计算句长方差、提取对白比例等确定性真实算法得出分值。
3. **改写不变性保护 (Invariant Snapshot)**：
   - 局部改写必须保留上下文否定极性（如“没有杀她”绝对不可被修订为“杀了她”）。
   - 人名、地名、数值等关键实体在改写前后必须守恒，否则自动拒绝修订补丁。
