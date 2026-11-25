'use strict';

/**
 * @file lora-dataset-and-pipeline.test.js
 * 1,279 本真人小说微调数据集与模型注册表管道测试
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getModelCapability } = require('../lib/model/model-registry');

describe('LoRA Pipeline & Dataset Validation Suite', () => {
  it('model-registry correctly registers molan-humanizer-7b and resolves aliases', () => {
    const cap = getModelCapability('molan-humanizer-7b');
    assert.ok(cap, 'molan-humanizer-7b 应成功获取能力描述');
    assert.strictEqual(cap.modelId, 'molan-humanizer-7b');
    assert.strictEqual(cap.recommendedRole, 'humanizer');
    assert.strictEqual(cap.contextWindow, 32768);

    const aliasCap1 = getModelCapability('molan-humanizer');
    assert.strictEqual(aliasCap1.modelId, 'molan-humanizer');
    assert.strictEqual(aliasCap1.recommendedRole, 'humanizer');
    assert.strictEqual(aliasCap1.contextWindow, 32768);

    const aliasCap2 = getModelCapability('qwen2.5-7b-lora');
    assert.strictEqual(aliasCap2.modelId, 'qwen2.5-7b-lora');
    assert.strictEqual(aliasCap2.recommendedRole, 'humanizer');
  });

  it('verifies generated dataset files exist and have non-zero size', () => {
    const dataDir = path.resolve(__dirname, '../data/lora-training');
    assert.ok(fs.existsSync(dataDir), '数据目录应当存在');

    const expectedFiles = [
      'train_alpaca.json',
      'val_alpaca.json',
      'train_sharegpt.jsonl',
      'val_sharegpt.jsonl',
      'dataset_info.json',
      'dataset_summary.json'
    ];

    for (const file of expectedFiles) {
      const p = path.join(dataDir, file);
      assert.ok(fs.existsSync(p), `文件 ${file} 应当存在`);
      const stat = fs.statSync(p);
      assert.ok(stat.size > 0, `文件 ${file} 大小应大于 0`);
    }
  });

  it('validates Alpaca dataset structure and content quality', () => {
    const valAlpacaPath = path.resolve(__dirname, '../data/lora-training/val_alpaca.json');
    const samples = JSON.parse(fs.readFileSync(valAlpacaPath, 'utf8'));
    assert.ok(Array.isArray(samples), 'val_alpaca.json 应当是数组');
    assert.ok(samples.length >= 10, '验证集样本数应 >= 10');

    const first = samples[0];
    assert.ok(first.instruction && first.instruction.length > 20, '应当有详尽的 instruction');
    assert.ok(first.input && first.input.length > 20, '应当有合理的 input');
    assert.ok(first.output && first.output.length > 300, '真人正文输出应有充足字数');

    // 严禁含 AI 典型套词
    assert.ok(!/嘴角勾起|倒吸凉气|眼神闪过一丝/.test(first.output), '真人输出不应含AI恶习套词');
  });

  it('validates ShareGPT dataset format', () => {
    const valShareGptPath = path.resolve(__dirname, '../data/lora-training/val_sharegpt.jsonl');
    const firstLine = fs.readFileSync(valShareGptPath, 'utf8').split('\n').filter(Boolean)[0];
    const parsed = JSON.parse(firstLine);
    assert.ok(Array.isArray(parsed.messages), 'messages 应为数组');
    assert.strictEqual(parsed.messages.length, 3, '应包含 system, user, assistant 三段对话');
    assert.strictEqual(parsed.messages[0].role, 'system');
    assert.strictEqual(parsed.messages[1].role, 'user');
    assert.strictEqual(parsed.messages[2].role, 'assistant');
    assert.ok(parsed.messages[2].content.length > 300, 'assistant 回复应包含完整真人正文');
  });

  it('validates dataset_info.json conforms to LLaMA-Factory spec', () => {
    const infoPath = path.resolve(__dirname, '../data/lora-training/dataset_info.json');
    const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    assert.ok(info.molan_de_ai_alpaca, '应当包含 molan_de_ai_alpaca 配置');
    assert.strictEqual(info.molan_de_ai_alpaca.formatting, 'alpaca');
    assert.strictEqual(info.molan_de_ai_alpaca.file_name, 'train_alpaca.json');

    assert.ok(info.molan_de_ai_sharegpt, '应当包含 molan_de_ai_sharegpt 配置');
    assert.strictEqual(info.molan_de_ai_sharegpt.formatting, 'sharegpt');
  });

  it('validates training scripts and config files exist', () => {
    const trainingDir = path.resolve(__dirname, '../training');
    assert.ok(fs.existsSync(path.join(trainingDir, 'train_lora_llamafactory.yaml')), 'LLaMA-Factory 配置应存在');
    assert.ok(fs.existsSync(path.join(trainingDir, 'train_unsloth.py')), 'Unsloth 脚本应存在');
    assert.ok(fs.existsSync(path.join(trainingDir, 'run_autodl.sh')), 'AutoDL 一键脚本应存在');
    assert.ok(fs.existsSync(path.join(trainingDir, 'Modelfile')), 'Ollama Modelfile 应存在');
    assert.ok(fs.existsSync(path.join(trainingDir, 'README_TRAINING_GUIDE.md')), '微调指南应存在');
    assert.ok(fs.existsSync(path.join(trainingDir, 'colab/molan_qwen25_7b_lora_colab.ipynb')), 'Colab T4 Notebook 应存在');
  });

  it('validates v2 dataset anti-leakage, anti-truncation and zero fake boilerplate invariants', () => {
    const dataDir = path.resolve(__dirname, '../data/lora-training');
    const summary = JSON.parse(fs.readFileSync(path.join(dataDir, 'dataset_summary.json'), 'utf8'));
    assert.strictEqual(summary.schemaVersion, '2.0');
    assert.strictEqual(summary.splitStrategy, 'book_level_zero_leakage');
    assert.strictEqual(summary.charStats.over2400Chars, 0, '不应存在超过 2400 字的截断风险样本');
    assert.ok(!summary.genreStats['测试'], '不应包含测试目录题材');

    const trainLines = fs.readFileSync(path.join(dataDir, 'train_sharegpt.jsonl'), 'utf8').trim().split('\n');
    const valLines = fs.readFileSync(path.join(dataDir, 'val_sharegpt.jsonl'), 'utf8').trim().split('\n');
    const trainPrefixes = new Set();

    for (const line of trainLines) {
      const row = JSON.parse(line);
      assert.ok(!row.messages[1].content.includes('现场气氛有些凝固'), '严禁出现写死假粗稿模板');
      trainPrefixes.add(row.messages[2].content.slice(0, 120));
    }

    let overlap = 0;
    for (const line of valLines) {
      const row = JSON.parse(line);
      if (trainPrefixes.has(row.messages[2].content.slice(0, 120))) overlap++;
    }
    assert.strictEqual(overlap, 0, '训练集与验证集应为书本级 0% 泄露隔离');
  });

  it('validates Colab T4 notebook JSON structure and anti-OOM / resume safeguards', () => {
    const nbPath = path.resolve(__dirname, '../training/colab/molan_qwen25_7b_lora_colab.ipynb');
    const nb = JSON.parse(fs.readFileSync(nbPath, 'utf8'));
    assert.strictEqual(nb.nbformat, 4);
    assert.ok(Array.isArray(nb.cells) && nb.cells.length >= 10, 'Notebook 应包含完整训练与恢复单元');

    const allCode = nb.cells
      .filter(c => c.cell_type === 'code')
      .map(c => (Array.isArray(c.source) ? c.source.join('') : String(c.source || '')))
      .join('\n');

    assert.ok(allCode.includes('train_on_responses_only'), '应开启仅对小说正文算 Loss');
    assert.ok(allCode.includes('resume_from_checkpoint'), '应支持 Colab 断线自动断点续训');
    assert.ok(allCode.includes('eval_dataset=val_dataset'), '应挂载验证集监控过拟合');
    assert.ok(allCode.includes('is_bfloat16_supported'), '应自适应 T4 fp16 与 L4/A100 bf16');
    assert.ok(allCode.includes('maximum_memory_usage=0.4'), '应配置低内存 GGUF 防 OOM 导出');
    assert.ok(allCode.includes('add_generation_prompt=True'), '推理验收应使用 ChatML 模板');
  });
});
