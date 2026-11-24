#!/usr/bin/env node
/**
 * sync-sub2api-smtp.mjs
 * 只读读取运行中的 sub2api PostgreSQL (TCP 或 Docker sub2api-postgres 容器) 的 SMTP 设置，
 * 并写入本地 .gitignore 忽略的 data/config.json，使墨阑在 Docker 关闭时也能独立发送注册验证码。
 * 绝不打印密码或授权码。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSmtpMailService } = require('../services/smtp-mail-service');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'data', 'config.json');

const mailService = createSmtpMailService({
  env: { ...process.env, MOLAN_SMTP_HOST: '' },
  configFile: '',
  logger: console
});

const resolved = await mailService.resolveSmtpConfig();
if (!resolved) {
  console.error('[sync-sub2api-smtp] 同步失败：' + (mailService.getLastDiagnostic() || '未读取到 sub2api SMTP 配置'));
  process.exit(1);
}

let existing = {};
try {
  existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (_) {
  existing = {};
}

existing.smtp = {
  host: resolved.host,
  port: resolved.port,
  username: resolved.username,
  password: resolved.password,
  from: resolved.from,
  fromName: resolved.fromName,
  useTLS: resolved.useTLS
};

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  ok: true,
  source: resolved.source,
  host: resolved.host,
  port: resolved.port,
  from: resolved.from,
  fromName: resolved.fromName,
  useTLS: resolved.useTLS,
  passwordSaved: Boolean(resolved.password),
  target: configPath
}, null, 2));
