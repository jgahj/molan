'use strict';

const { createAcpTransportService } = require('../services/acp-transport-service');
const { estimatePromptTokens } = require('../lib/model/model-registry');

async function main() {
  const methodId = process.argv[2] || 'oauth-personal';
  const acp = createAcpTransportService({ estimatePromptTokens });
  console.log('[ACP] 正在启动官方 agy_acp_server.exe 并检查认证状态...');
  try {
    const cap = await acp.inspectCapabilities();
    console.log('[ACP] 已完成认证，当前会话返回 configOptions:');
    console.log(JSON.stringify(cap.session && cap.session.configOptions || [], null, 2));
    acp.close();
    return;
  } catch (err) {
    if (!err || (err.rpcCode !== -32000 && !/authentication required/i.test(String(err.message || '')))) {
      console.error('[ACP] 初始化失败:', err && err.message || err);
      acp.close();
      process.exitCode = 1;
      return;
    }
  }

  console.log(`[ACP] 尚未认证，即将发起 ${methodId} 浏览器 OAuth 登录。请在弹出的网页或下方链接中完成登录...`);
  try {
    const res = await acp.authenticateInteractive({
      methodId,
      onLog: line => {
        if (/https?:\/\/accounts\.google\.com|Open the following link|Authentication/i.test(line)) {
          console.log('[ACP]', line);
        }
      }
    });
    console.log('[ACP] 登录成功！可用模型与推理档位 configOptions:');
    console.log(JSON.stringify(res.session && res.session.configOptions || [], null, 2));
  } catch (err) {
    console.error('[ACP] 登录失败:', err && err.message || err);
    process.exitCode = 1;
  } finally {
    acp.close();
  }
}

main();
