import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = path.resolve(path.join(ROOT, '..'));
const PROJECT_PREFIX = path.relative(REPOSITORY, ROOT).replace(/\\/g, '/');
const BASELINE_DIR = path.join(ROOT, 'data', 'evolution', 'baseline');
const OUTPUT_PATH = path.join(BASELINE_DIR, 'source-hashes.json');
const UI_OUTPUT_PATH = path.join(BASELINE_DIR, 'ui-manifest.json');
const EXPECTED_ABSENCES = new Set(['pages/tokens.css']);
const UI_PATHS = [
  'index.html',
  'completion-editor.js',
  'pages/editor.html',
  'pages/editor.js',
  'pages/molan-shell.js',
  'pages/molan-ui.css',
  'pages/styles.css',
  'pages/tokens.css'
];

/** 在项目仓库根目录执行 Git 命令并返回原始字节。 */
function runGit(args) {
  const result = spawnSync('git', args, { cwd: REPOSITORY, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(String(result.stderr || `git ${args.join(' ')} failed`).trim());
  return Buffer.from(result.stdout);
}

/** 读取指定基线对象，缺少文件时返回 null。 */
function tryGit(args) {
  const result = spawnSync('git', args, { cwd: REPOSITORY, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) return null;
  return Buffer.from(result.stdout);
}

/** 解析基线构建参数。 */
function parseOptions(argv) {
  const options = { write: false, ref: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--write') options.write = true;
    else if (argv[index] === '--ref') options.ref = argv[++index];
    else throw new TypeError(`未知参数: ${argv[index]}`);
  }
  return options;
}

/** 从固定 Git commit 构建不读取工作区数据的源码与 UI 基线。 */
export async function buildGenerationBaseline({ ref, generatedAt = new Date().toISOString() } = {}) {
  const codeManifest = JSON.parse(await readFile(path.join(BASELINE_DIR, 'code-manifest.json'), 'utf8'));
  const promptManifest = JSON.parse(await readFile(path.join(BASELINE_DIR, 'prompt-manifest.json'), 'utf8'));
  const styleManifest = JSON.parse(await readFile(path.join(BASELINE_DIR, 'style-manifest.json'), 'utf8'));
  const schemaManifest = JSON.parse(await readFile(path.join(BASELINE_DIR, 'schema-manifest.json'), 'utf8'));
  const sourceRef = String(ref || codeManifest.sourceCommit || '').trim();
  if (!sourceRef) throw new TypeError('基线 Git ref 必填');
  const sourceCommit = runGit(['rev-parse', '--verify', `${sourceRef}^{commit}`]).toString('utf8').trim();

  const fileGroups = {
    code: [...new Set(codeManifest.scope || [])],
    prompt: [...new Set(promptManifest.files || [])],
    schema: schemaManifest.latestPostgresMigration ? [`db/migrations/${schemaManifest.latestPostgresMigration}`] : [],
    style: [...new Set(styleManifest.systems || [])].filter(file => !file.endsWith('/')),
    ui: UI_PATHS
  };
  const files = {};
  const missing = [];
  const absentAtBaseline = [];
  for (const [group, names] of Object.entries(fileGroups)) {
    files[group] = {};
    for (const name of names) {
      const normalized = String(name).replace(/\\/g, '/');
      if (normalized.startsWith('/') || normalized.split('/').includes('..')) throw new TypeError(`基线路径超出项目范围: ${name}`);
      const content = tryGit(['show', `${sourceCommit}:${PROJECT_PREFIX}/${normalized}`]);
      if (!content) {
        (EXPECTED_ABSENCES.has(normalized) ? absentAtBaseline : missing).push(normalized);
        continue;
      }
      files[group][normalized] = createHash('sha256').update(content).digest('hex');
    }
  }

  const baseline = {
    schemaVersion: 'generation-source-baseline-v1',
    sourceRef,
    sourceCommit,
    generatedAt,
    algorithm: 'sha256',
    files,
    missing: [...new Set(missing)].sort(),
    notPresentAtBaseline: [...new Set(absentAtBaseline)].sort(),
    protectedDataRead: false
  };
  baseline.uiManifest = {
    schemaVersion: 'ui-source-baseline-v1',
    sourceRef,
    sourceCommit,
    generatedAt,
    algorithm: 'sha256',
    files: files.ui,
    notPresentAtBaseline: baseline.notPresentAtBaseline
  };
  return baseline;
}

/** 输出或显式更新基线 JSON。 */
export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const manifest = await buildGenerationBaseline({ ref: options.ref });
  const output = `${JSON.stringify(manifest, null, 2)}\n`;
  if (options.write) {
    await writeFile(OUTPUT_PATH, output, 'utf8');
    await writeFile(UI_OUTPUT_PATH, `${JSON.stringify(manifest.uiManifest, null, 2)}\n`, 'utf8');
    process.stdout.write(`WROTE ${path.relative(ROOT, OUTPUT_PATH)} files=${Object.values(manifest.files).reduce((count, group) => count + Object.keys(group).length, 0)} missing=${manifest.missing.length}\n`);
  } else {
    process.stdout.write(output);
  }
  if (manifest.missing.length) {
    process.stderr.write(`BASELINE MISSING ${manifest.missing.join(', ')}\n`);
    process.exitCode = 1;
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`BASELINE ERROR: ${String(error && error.message || error)}\n`);
    process.exitCode = 1;
  });
}
