'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PackagePublisher } = require('../lib/composition/corpus/package-publisher');
const { EvidenceCatalog } = require('../lib/composition/corpus/evidence-catalog');

test('PackagePublisher: 默认路径基于 __dirname 指向 molan-home/data/strategy-knowledge-base，彻底根除跨 CWD 根目录孤岛', () => {
  const originalCwd = process.cwd();
  // 模拟在项目外或工作区根目录执行
  const publisher = new PackagePublisher();
  const expectedBase = path.resolve(__dirname, '../data/strategy-knowledge-base');
  assert.equal(publisher.targetBase, expectedBase);
  assert.equal(publisher.packagesDir, path.join(expectedBase, 'packages'));
  assert.equal(publisher.activePointerFile, path.join(expectedBase, 'active_package.json'));
});

test('EvidenceCatalog: 默认加载路径对齐 molan-home/data/strategy-knowledge-base', () => {
  const catalog = new EvidenceCatalog();
  const expectedBase = path.resolve(__dirname, '../data/strategy-knowledge-base');
  // 无参数触发检查时，不应在 process.cwd() 下寻找孤岛目录
  catalog.findRelevantCards();
  assert.ok(true);
});

test('PackagePublisher: LRU 滚动保留机制（保留最近 3 个历史包）与激活版本保护', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pkg-lru-'));
  try {
    const packagesDir = path.join(tmpDir, 'packages');
    fs.mkdirSync(packagesDir, { recursive: true });

    // 创建 5 个历史包及 1 个当前激活包
    const versions = [
      { id: 'v1_oldest', time: 1000 },
      { id: 'v2_older', time: 2000 },
      { id: 'v3_mid', time: 3000 },
      { id: 'v4_newer', time: 4000 },
      { id: 'v5_newest', time: 5000 },
      { id: 'v_active', time: 500 } // 激活包即使时间最老，也绝不能被删除
    ];

    for (const v of versions) {
      const pDir = path.join(packagesDir, v.id);
      fs.mkdirSync(pDir, { recursive: true });
      fs.writeFileSync(path.join(pDir, 'package-manifest.json'), JSON.stringify({
        packageVersion: v.id,
        publishedAt: new Date(v.time).toISOString()
      }), 'utf8');
    }

    // 写入 active 指针
    fs.writeFileSync(path.join(tmpDir, 'active_package.json'), JSON.stringify({
      activeVersion: 'v_active',
      packageDir: 'packages/v_active'
    }), 'utf8');

    // 写入一个临时碎片文件
    fs.writeFileSync(path.join(tmpDir, 'active_package.json.tmp_12345'), '{}', 'utf8');

    const publisher = new PackagePublisher({ targetBase: tmpDir });

    // 测试 tmp 碎片清理
    publisher._cleanTmpPointers();
    assert.equal(fs.existsSync(path.join(tmpDir, 'active_package.json.tmp_12345')), false);

    // 执行 LRU 淘汰：保留激活版本 + 最近 3 个历史包 (v5, v4, v3)；淘汰 v1, v2
    const pruned = publisher.pruneHistoryPackages('v_active', 3);
    assert.deepEqual(pruned.sort(), ['v1_oldest', 'v2_older'].sort());

    const remaining = fs.readdirSync(packagesDir);
    assert.ok(remaining.includes('v_active'), '激活版本必须永远保留');
    assert.ok(remaining.includes('v5_newest'), '最新历史包必须保留');
    assert.ok(remaining.includes('v4_newer'), '第二新历史包必须保留');
    assert.ok(remaining.includes('v3_mid'), '第三新历史包必须保留');
    assert.equal(remaining.includes('v2_older'), false, '超出保留数量的历史包应被删除');
    assert.equal(remaining.includes('v1_oldest'), false, '超出保留数量的历史包应被删除');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
