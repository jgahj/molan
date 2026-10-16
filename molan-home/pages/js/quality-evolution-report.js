/*
 * quality-evolution-report.js — 自 HTML 内联脚本外移（2026-10-15 CSP 收紧）
 * 原因：CSP script-src 移除 'unsafe-inline' 需外移全部内联脚本；
 * 代码为逐字迁移（行为不变），加载位置与原内联位置一致。
 */
    'use strict';
    const labels = {
      opening: '开篇', plot: '情节', pacing: '节奏', character: '人物', relationship: '关系',
      emotion: '情绪', causality: '因果', foreshadowing: '伏笔', payoff: '回收', dialogue: '对白',
      description: '描写', language: '语言', human_texture: '人味', ai_flavor: 'AI 痕迹',
      consistency: '一致性', originality: '原创性', reader_drive: '阅读驱动力', genre_fit: '题材契合', style_fit: '文风契合'
    };
    const evidenceLabels = { NOT_MEASURED: '未测量', ESTIMATED: '估算', MEASURED: '实测', JUDGED: '评审', HUMAN_REVIEWED: '人工复核' };
    const $ = id => document.getElementById(id);
    const item = (label, value) => {
      const box = document.createElement('div');
      const caption = document.createElement('span'); caption.className = 'label'; caption.textContent = label;
      const content = document.createElement('span'); content.className = 'value'; content.textContent = value == null ? '—' : String(value);
      box.append(caption, content); return box;
    };
    const cell = (row, value, className) => {
      const node = document.createElement('td');
      if (className) node.className = className;
      if (value instanceof Node) node.append(value); else node.textContent = value == null ? '—' : String(value);
      row.append(node); return node;
    };
    const badge = status => {
      const node = document.createElement('span'); node.className = `status status-${String(status || 'BLOCKED')}`;
      node.textContent = String(status || 'BLOCKED'); return node;
    };
    /** 安全渲染已校验的离线评测报告。 */
    function show(report, fileName) {
      if (!report || report.schemaVersion !== 'quality-vector-ab-report-v1') throw new Error('报告 schemaVersion 不受支持');
      $('fileName').textContent = fileName;
      $('notice').textContent = `报告指纹 ${report.reportHash || '缺失'}；评测模式 ${report.evaluationMode || '未知'}`;
      const summary = $('summary'); summary.replaceChildren(
        item('晋级结论', report.status), item('配对任务', report.pairedTaskCount),
        item('目标维度', (report.targetDimensions || []).map(name => labels[name] || name).join('、')),
        item('任务数 / 量表', `${report.golden?.taskCount ?? '—'} / ${report.scoreScale ?? '—'}`),
        item('实际费用', report.costs ? `${report.costs.baseline} → ${report.costs.candidate} ${report.costs.currency || ''}` : '—')
      );
      summary.children[0].querySelector('.value').replaceChildren(badge(report.status)); summary.hidden = false;

      const versions = report.versions || {};
      const binding = report.binding || {};
      $('binding').replaceChildren(
        item('模型', binding.model), item('参数指纹', binding.modelParametersHash),
        item('评测器', binding.evaluatorVersion), item('评审版本', binding.reviewerVersion),
        item('基线版本', JSON.stringify(versions.baseline || {})), item('候选版本', JSON.stringify(versions.candidate || {})),
        item('Golden 指纹', report.golden?.manifestHash), item('输入指纹', report.inputHash), item('报告哈希', report.reportHash)
      );
      $('bindingSection').hidden = false;

      const dimensions = $('dimensions'); dimensions.replaceChildren();
      for (const entry of report.dimensions || []) {
        const row = document.createElement('tr');
        cell(row, labels[entry.dimension] || entry.dimension);
        cell(row, entry.baseline, 'num'); cell(row, entry.candidate, 'num'); cell(row, entry.delta, 'num');
        cell(row, entry.signed_improvement, 'num'); cell(row, badge(entry.status));
        cell(row, evidenceLabels[entry.evidence_status] || entry.evidence_status);
        cell(row, (entry.evidence_refs || []).join(', '), 'refs'); dimensions.append(row);
      }
      $('dimensionsSection').hidden = false;

      const gateRows = $('gate'); gateRows.replaceChildren();
      const gate = report.existingRegressionGate || {};
      for (const [name, result] of Object.entries(gate.category_results || {})) {
        const row = document.createElement('tr'); cell(row, name); cell(row, badge(result.status));
        cell(row, '—'); cell(row, '—'); cell(row, (result.evidence_refs || []).join(', '), 'refs'); gateRows.append(row);
      }
      for (const result of gate.guard_metrics || []) {
        const row = document.createElement('tr'); cell(row, result.metric); cell(row, badge(result.status));
        cell(row, result.baseline); cell(row, result.candidate); cell(row, (result.evidence_refs || []).join(', '), 'refs'); gateRows.append(row);
      }
      if (gate.target_metric) {
        const result = gate.target_metric; const row = document.createElement('tr');
        cell(row, `目标：${result.metric || '—'}`); cell(row, badge(result.status));
        cell(row, result.baseline); cell(row, result.candidate); cell(row, (result.evidence_refs || []).join(', '), 'refs'); gateRows.append(row);
      }
      $('gateSection').hidden = false;

      const reasons = report.blockingReasons || [];
      const list = $('reasons'); list.replaceChildren();
      reasons.forEach(reason => { const row = document.createElement('li'); row.textContent = reason; list.append(row); });
      $('reasonSection').hidden = reasons.length === 0;
    }
    $('reportFile').addEventListener('change', async event => {
      const file = event.target.files && event.target.files[0]; if (!file) return;
      try { show(JSON.parse(await file.text()), file.name); }
      catch (error) {
        $('fileName').textContent = file.name;
        $('notice').textContent = error.message || String(error);
        ['summary', 'bindingSection', 'dimensionsSection', 'gateSection', 'reasonSection'].forEach(id => { $(id).hidden = true; });
        ['binding', 'dimensions', 'gate', 'reasons'].forEach(id => $(id).replaceChildren());
      }
    });
