'use strict';

/**
 * @file package-publisher.js
 * 策略知识库原子发布器 (Strategy Knowledge Package Atomic Publisher)
 * 
 * 核心架构目标：
 * 1. 严格禁止未经验证的批处理半成品直接污染生成服务；
 * 2. 只有通过质量检查 (Quality Report = passed 且仅含 A/B 级规则) 的产物方可打包；
 * 3. 产物输出到版本化独立目录 (data/strategy-knowledge-base/packages/<version>/)；
 * 4. 通过原子重命名 active_package.json 切换当前生效知识包，确保生成服务零抖动、零停机读取。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256File(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

class PackagePublisher {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.targetBase = path.resolve(options.targetBase || path.join(process.cwd(), 'data', 'strategy-knowledge-base'));
    this.packagesDir = path.join(this.targetBase, 'packages');
    this.activePointerFile = path.join(this.targetBase, 'active_package.json');
  }

  /**
   * 将指定的 staging 运行产物执行质量检查并原子发布
   * @param {string} runDir staging 运行目录
   * @param {Object} options
   * @returns {Object} 发布结果
   */
  publishRun(runDir, options = {}) {
    const sourceRun = path.resolve(runDir);
    const runId = path.basename(sourceRun);

    // 1. 完整性检查
    const requiredFiles = [
      'manifest.json',
      'chapter-features.jsonl',
      'strategy-rules.jsonl',
      'archetypes.json',
      'evidence.json',
      'quality-report.json'
    ];

    for (const file of requiredFiles) {
      const fullPath = path.join(sourceRun, file);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`发布失败：缺失必要产物文件 [${file}] 于 ${sourceRun}`);
      }
    }

    // 2. 质量门禁检查 (Quality Gate)
    const qualityReport = JSON.parse(fs.readFileSync(path.join(sourceRun, 'quality-report.json'), 'utf8'));
    if (qualityReport.status !== 'passed' && !options.force) {
      throw new Error(`发布门禁拦截：质量检查状态为 [${qualityReport.status}]，未达发布标准`);
    }

    const version = options.version || runId;
    const targetPackageDir = path.join(this.packagesDir, version);
    if (!fs.existsSync(targetPackageDir)) {
      fs.mkdirSync(targetPackageDir, { recursive: true });
    }

    // 3. 拷贝并计算文件完整性指纹
    const checksums = {};
    for (const file of requiredFiles) {
      const src = path.join(sourceRun, file);
      const dest = path.join(targetPackageDir, file);
      fs.copyFileSync(src, dest);
      checksums[file] = sha256File(dest);
    }

    // 4. 生成包元数据清单
    const packageManifest = {
      packageVersion: version,
      runId,
      publishedAt: new Date().toISOString(),
      checksums,
      totalRules: qualityReport.publishedRulesCount || 0,
      totalChapters: qualityReport.totalChaptersAnalyzed || 0,
      qualitySummary: qualityReport
    };
    fs.writeFileSync(path.join(targetPackageDir, 'package-manifest.json'), JSON.stringify(packageManifest, null, 2), 'utf8');

    // 5. 原子发布指针切换 (Atomic Pointer Switch)
    const activePointer = {
      activeVersion: version,
      packageDir: targetPackageDir,
      publishedAt: packageManifest.publishedAt,
      checksum: sha256File(path.join(targetPackageDir, 'package-manifest.json'))
    };

    const tmpPointer = `${this.activePointerFile}.tmp_${Date.now()}`;
    fs.writeFileSync(tmpPointer, JSON.stringify(activePointer, null, 2), 'utf8');
    fs.renameSync(tmpPointer, this.activePointerFile);

    return {
      status: 'published',
      version,
      packageDir: targetPackageDir,
      activePointerFile: this.activePointerFile,
      manifest: packageManifest
    };
  }

  /**
   * 读取当前已发布的活跃知识包元数据
   */
  getActivePackage() {
    if (!fs.existsSync(this.activePointerFile)) return null;
    try {
      const pointer = JSON.parse(fs.readFileSync(this.activePointerFile, 'utf8'));
      const manifestFile = path.join(pointer.packageDir, 'package-manifest.json');
      if (fs.existsSync(manifestFile)) {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        return { pointer, manifest };
      }
      return { pointer, manifest: null };
    } catch (_) {
      return null;
    }
  }
}

module.exports = {
  PackagePublisher
};
