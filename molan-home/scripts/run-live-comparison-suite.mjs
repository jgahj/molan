/**
 * run-live-comparison-suite.mjs
 * 墨阑真实双轨对比评测执行与度量套件
 * 
 * 评测对比设计：
 * - 实验组：走墨阑项目真实完整调用（策略编译 + Tier 1~4 注意力分级 + 场景规划 + 因果状态机约束）
 * - 对照组：走原生模型调用（大模型单轮直接根据提示词生成，无项目链路介入）
 * - 模型：均采用 gemini-3.8-flash-high
 * - 题材分类：按原书题材分门别类归档比对
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QuadrantQualityEvaluator } from '../lib/composition/corpus/prompt-experiment-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CORPUS_DIR = path.join(ROOT_DIR, 'data', 'corpus-prompt-experiments');
const OUTPUT_DIR = path.join(CORPUS_DIR, 'live_evaluations');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

export class DualTrackComparisonSuite {
  constructor() {
    this.evaluator = new QuadrantQualityEvaluator();
  }

  /**
   * 评测单个题材样本的双轨生成结果
   * @param {Object} sampleData 
   * @param {string} experimentText 实验组生成文本
   * @param {string} controlText 对照组生成文本
   * @returns {Object} 评测详情
   */
  evaluatePair(sampleData, experimentText, controlText) {
    // 实验组：象限 B (墨阑完整链路全规格)
    const expEval = this.evaluator.evaluateCandidate(experimentText, sampleData, 'B');
    // 对照组：象限 D (原生模型单轮直出)
    const ctrlEval = this.evaluator.evaluateCandidate(controlText, sampleData, 'D');

    const diff = {
      charCountDelta: expEval.charCount - ctrlEval.charCount,
      lengthRatioDelta: Number((expEval.lengthRatio - ctrlEval.lengthRatio).toFixed(3)),
      styleDistanceImprovement: Number((ctrlEval.styleDistance - expEval.styleDistance).toFixed(3)), // 正值代表实验组更贴合原著
      actionDensityDelta: Number((expEval.actionDensity - ctrlEval.actionDensity).toFixed(3)),
      aiFlavorReduction: Number((ctrlEval.aiFlavorRisk - expEval.aiFlavorRisk).toFixed(3)), // 正值代表实验组套词风险更低
      entityRetentionDelta: Number((expEval.entityRetention - ctrlEval.entityRetention).toFixed(3)),
      compositeScoreDelta: Number((expEval.compositeScore - ctrlEval.compositeScore).toFixed(1))
    };

    return {
      bookId: sampleData.bookId,
      category: sampleData.category,
      chapterTitle: sampleData.sampledChapter?.chapterTitle || '未知章节',
      originalCharCount: sampleData.sampledChapter?.charCount || 0,
      experiment: expEval,
      control: ctrlEval,
      diff
    };
  }

  /**
   * 生成 Markdown 评测报告
   */
  generateMarkdownReport(comparisons = []) {
    const lines = [];
    lines.push('# 墨阑项目真实双轨对比评测报告 (Gemini 3.8 Flash High)');
    lines.push('');
    lines.push('> **评测基准时间**：' + new Date().toISOString());
    lines.push('> **对比模型**：`gemini-3.8-flash-high`（实验组与对照组完全同源一致）');
    lines.push('> **实验设计**：控制变量唯一。相同原著提示词输入下，一组走【墨阑项目真实完整调用】（策略编译、场景规约、Tier 1~4 注意力分级、因果债务状态机）；一组走【原生模型直接单轮调用】（无策略编译器、无注意力裁剪）。');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## 一、分类评测多维指标总览');
    lines.push('');
    lines.push('| 题材分类 | 样本书目 / 章节 | 组别 | 生成字数 | 原著字数拟合比 | 文风欧氏距离(越小越好) | 动作动词密度 | AI味风险(越低越好) | 综合得分 | 得分差值 (Δ) |');
    lines.push('| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |');

    for (const item of comparisons) {
      const { category, bookId, chapterTitle, experiment: exp, control: ctrl, diff } = item;
      const scoreDeltaStr = diff.compositeScoreDelta >= 0 ? `+${diff.compositeScoreDelta}` : `${diff.compositeScoreDelta}`;
      lines.push(`| **${category}** | 《${bookId}》<br>${chapterTitle} | 实验组(墨阑全链) | ${exp.charCount} | ${(exp.lengthRatio * 100).toFixed(1)}% | **${exp.styleDistance}** | **${(exp.actionDensity * 100).toFixed(1)}%** | **${exp.aiFlavorRisk}** | **${exp.compositeScore}** | <mark>**${scoreDeltaStr}**</mark> |`);
      lines.push(`| ${category} | (同上) | 对照组(原生直出) | ${ctrl.charCount} | ${(ctrl.lengthRatio * 100).toFixed(1)}% | ${ctrl.styleDistance} | ${(ctrl.actionDensity * 100).toFixed(1)}% | ${ctrl.aiFlavorRisk} | ${ctrl.compositeScore} | 基线 |`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## 二、分类样本深入质感对比剖析');
    lines.push('');

    for (const item of comparisons) {
      const { category, bookId, chapterTitle, experiment: exp, control: ctrl, diff } = item;
      lines.push(`### 2.${comparisons.indexOf(item) + 1} 【${category}题材】《${bookId}》 - ${chapterTitle}`);
      lines.push('');
      lines.push(`- **原著篇幅参考**：${item.originalCharCount} 字`);
      lines.push(`- **客观度量对照**：`);
      lines.push(`  - 篇幅字数：实验组 **${exp.charCount} 字**（拟合比 ${(exp.lengthRatio * 100).toFixed(1)}%） vs 对照组 **${ctrl.charCount} 字**（拟合比 ${(ctrl.lengthRatio * 100).toFixed(1)}%）`);
      lines.push(`  - 11维文风距离：实验组 **${exp.styleDistance}** vs 对照组 **${ctrl.styleDistance}**（实验组文风贴合度提升 ${(diff.styleDistanceImprovement > 0 ? '+' : '') + diff.styleDistanceImprovement}）`);
      lines.push(`  - 动作动词密度：实验组 **${(exp.actionDensity * 100).toFixed(1)}%** vs 对照组 **${(ctrl.actionDensity * 100).toFixed(1)}%**`);
      lines.push(`  - AI味机械套词风险：实验组 **${exp.aiFlavorRisk}** vs 对照组 **${ctrl.aiFlavorRisk}**（套词出现降幅 ${(diff.aiFlavorReduction > 0 ? '-' : '') + diff.aiFlavorReduction}）`);
      lines.push(`  - 综合质量评分：实验组 **${exp.compositeScore} 分** vs 对照组 **${ctrl.compositeScore} 分**（**提升 +${diff.compositeScoreDelta} 分**）`);
      lines.push('');
    }

    return lines.join('\n');
  }
}
