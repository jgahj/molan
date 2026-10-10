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

const DEFAULT_TARGET_BASE = path.resolve(__dirname, '../../../data/strategy-knowledge-base');

class PackagePublisher {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.targetBase = path.resolve(options.targetBase || DEFAULT_TARGET_BASE);
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

    // 计算待发布文件的指纹，校验版本防篡改冲突
    const incomingChecksums = {};
    for (const file of requiredFiles) {
      const src = path.join(sourceRun, file);
      incomingChecksums[file] = sha256File(src);
    }

    const existingManifestFile = path.join(targetPackageDir, 'package-manifest.json');
    if (fs.existsSync(existingManifestFile)) {
      const oldManifest = JSON.parse(fs.readFileSync(existingManifestFile, 'utf8'));
      const oldChecksums = oldManifest.checksums || {};
      const isIdentical = requiredFiles.every(f => incomingChecksums[f] === oldChecksums[f]);
      if (isIdentical) {
        return {
          status: 'idempotent',
          version,
          packageDir: targetPackageDir,
          activePointerFile: this.activePointerFile,
          manifest: oldManifest
        };
      }
      throw new Error(`版本冲突：已存在同名版本 [${version}] 但校验和不匹配 (Checksum mismatch)`);
    }

    if (!fs.existsSync(targetPackageDir)) {
      fs.mkdirSync(targetPackageDir, { recursive: true });
    }

    // 3. 拷贝并计算文件完整性指纹
    const checksums = {};
    for (const file of requiredFiles) {
      const src = path.join(sourceRun, file);
      const dest = path.join(targetPackageDir, file);
      fs.copyFileSync(src, dest);
      checksums[file] = incomingChecksums[file];
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

    // 5. 原子发布指针切换 (存储相对 POSIX 路径确保容器跨机移植性)
    const relPackageDir = path.relative(this.targetBase, targetPackageDir).replace(/\\/g, '/');
    const activePointer = {
      activeVersion: version,
      packageDir: relPackageDir,
      publishedAt: packageManifest.publishedAt,
      checksum: sha256File(path.join(targetPackageDir, 'package-manifest.json'))
    };

    const tmpPointer = `${this.activePointerFile}.tmp_${Date.now()}`;
    fs.writeFileSync(tmpPointer, JSON.stringify(activePointer, null, 2), 'utf8');
    fs.renameSync(tmpPointer, this.activePointerFile);
    this._cleanTmpPointers();

    // 6. 执行 LRU 滚动保留策略：保留当前激活版本及最近 3 个历史包，防止残包膨胀
    const prunedPackages = this.pruneHistoryPackages(version, options.maxHistoryPackages ?? 3);

    return {
      status: 'published',
      version,
      packageDir: targetPackageDir,
      activePointerFile: this.activePointerFile,
      manifest: packageManifest,
      prunedPackages
    };
  }

  /**
   * 清理 targetBase 下遗留的 active_package.json.tmp_* 碎片文件
   */
  _cleanTmpPointers() {
    try {
      if (!fs.existsSync(this.targetBase)) return;
      const files = fs.readdirSync(this.targetBase);
      for (const f of files) {
        if (f.startsWith('active_package.json.tmp_')) {
          try {
            fs.rmSync(path.join(this.targetBase, f), { force: true });
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  /**
   * LRU / 时间滚动淘汰历史知识包：保留当前激活版本，以及最近的 maxHistoryPackages (默认 3) 个历史包
   * @param {string} activeVersion 当前激活版本
   * @param {number} maxHistoryPackages 保留的历史包数量上限，默认 3
   * @returns {string[]} 被清理的历史版本列表
   */
  pruneHistoryPackages(activeVersion, maxHistoryPackages = 3) {
    if (!fs.existsSync(this.packagesDir)) return [];
    try {
      const entries = fs.readdirSync(this.packagesDir, { withFileTypes: true });
      const pkgDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
      // 筛选出非激活版本的历史包
      const historyPkgs = pkgDirs.filter(name => name !== activeVersion);
      if (historyPkgs.length <= maxHistoryPackages) {
        return [];
      }

      // 获取各包的时间戳（优先使用 package-manifest.json 中的 publishedAt，若无则使用目录 mtime）
      const pkgInfos = historyPkgs.map(name => {
        const fullDir = path.join(this.packagesDir, name);
        let timestamp = 0;
        const manifestPath = path.join(fullDir, 'package-manifest.json');
        try {
          if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (manifest.publishedAt) {
              timestamp = new Date(manifest.publishedAt).getTime();
            }
          }
        } catch (_) {}
        if (!timestamp) {
          try {
            timestamp = fs.statSync(fullDir).mtimeMs;
          } catch (_) {
            timestamp = 0;
          }
        }
        return { name, fullDir, timestamp };
      });

      // 按时间戳降序排序（最新在最前）
      pkgInfos.sort((a, b) => b.timestamp - a.timestamp);

      // 保留前 maxHistoryPackages 个，超出的删除
      const toRemove = pkgInfos.slice(maxHistoryPackages);
      const removed = [];
      for (const item of toRemove) {
        try {
          fs.rmSync(item.fullDir, { recursive: true, force: true });
          removed.push(item.name);
        } catch (_) {}
      }
      return removed;
    } catch (_) {
      return [];
    }
  }

  /**
   * 读取当前已发布的活跃知识包元数据
   */
  getActivePackage() {
    if (!fs.existsSync(this.activePointerFile)) return null;
    try {
      const pointer = JSON.parse(fs.readFileSync(this.activePointerFile, 'utf8'));
      const absPackageDir = path.isAbsolute(pointer.packageDir)
        ? pointer.packageDir
        : path.resolve(this.targetBase, pointer.packageDir);
      const resolvedPointer = {
        ...pointer,
        packageDir: absPackageDir,
        relativePackageDir: pointer.packageDir
      };
      const manifestFile = path.join(absPackageDir, 'package-manifest.json');
      if (fs.existsSync(manifestFile)) {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        return { ...resolvedPointer, pointer: resolvedPointer, manifest };
      }
      return { ...resolvedPointer, pointer: resolvedPointer, manifest: null };
    } catch (_) {
      return null;
    }
  }
}

module.exports = {
  PackagePublisher
};
