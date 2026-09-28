'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** 建立完全独立的模型与账户夹具，不读取或备份真实账户和会话。 */
function createLocalRuntime() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-isolated-test-'));
  process.env.MOLAN_DATA_DIR = directory;
  process.env.MOLAN_CONFIG_DIR = directory;
  process.env.MOLAN_REQUIRE_SQLITE = '0';
  process.env.MOLAN_PUBLIC_MODE = '0';
  process.env.MOLAN_LOCAL_ONLY = '1';
  const platformModels = ['gpt-5.6-luna', 'deepseek-v4-flash'].map(id => ({ id, model: id, provider: 'openai-compat', baseURL: 'http://127.0.0.1:1/v1', creditsPer1k: 0.18 }));
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ cloudApiBase: '', platformModels, pricing: { fallbackCreditsPer1k: 0.18 }, modelPolicy: { defaultModel: 'gpt-5.6-luna' } }), 'utf8');
  fs.writeFileSync(path.join(directory, 'users.json'), JSON.stringify([{ email: 'session-scope-test@example.com', name: 'test', role: 'admin', level: 'admin', plan: 'admin', credits: 10, spent: 0 }]), 'utf8');
  return directory;
}

module.exports = { createLocalRuntime };
