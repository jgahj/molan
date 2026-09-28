# 墨阑云端部署方法

> 用途：给其他 AI 读取并执行墨阑项目的 Git 推送、ECS 发布、服务验证、临时预览和回滚。
> 适用项目：`C:\Users\lyh\Desktop\小说专属网页\molan-home`
> 部署脚本：`C:\Users\lyh\Desktop\小说专属网页\scripts\deploy_molan.py`

## 0. 固定参数

| 参数 | 当前值 | 说明 |
|---|---|---|
| ECS_HOST | `8.138.128.184` | ECS 公网 IP |
| SSH_PORT | `22` | SSH 端口，不是网页端口 |
| SSH_USER | `root` | 部署脚本使用 root |
| APP_PORT | `3000` | Node 服务端口 |
| SERVICE | `molan` | systemd 服务名 |
| REMOTE_DIR | `/opt/molan` | 当前生效 release |
| RELEASE_ROOT | `/opt/molan-releases` | 当前和历史 release |
| BACKUP_ROOT | `/opt/molan-backups` | data 备份目录 |
| HEALTH_URL | `http://127.0.0.1:3000/api/health` | ECS 内部健康检查 |
| PUBLIC_URL | `http://8.138.128.184:3000/` | 公网访问地址，需安全组放行 TCP 3000 |
| LOCAL_TUNNEL_URL | `http://localhost:3300/#editor` | SSH 隧道临时预览，不是公网地址 |
| MODEL_UPSTREAM | `https://codex.xiaoguo.work/v1` | 云端模型请求从 ECS 直接连接，不配置 `MOLAN_PROXY` |
| ECS_EGRESS_IP | `8.138.128.184` | 如上游设有来源限制，需允许该地址访问 TCP 443 |
| NODE_VERSION | `v22.22.2` | 远端必须支持 `--experimental-sqlite` |
| LOCAL_NODE | `%TEMP%\ecsdeploy\node22\node-v22.22.2-linux-x64` | 部署脚本从这里上传 Linux Node22 |
| SSH_KEY_PATH | `%USERPROFILE%\.ssh\id_ed25519` | 当前部署机已配置的免密私钥路径 |

## 1. 给其他 AI 的执行规则

1. 先读取部署脚本和当前 Git 状态，再执行任何写操作。
2. 保留用户已有未提交修改，不执行 `git reset --hard`、`git checkout --` 或未知文件删除。
3. 只把本轮确认过的文件加入 Git；不要提交 `data/config.json`、密码、API Key、SSH 私钥、临时 tar 包或测试账号。
4. 部署前运行必要的语法检查和针对性测试；不要把无关测试失败混入本轮修复。
5. 部署后必须执行 ECS 内部健康检查，并记录实际返回值。
6. 公网端口未放行时，可以使用 SSH 隧道预览，但必须明确说明这不是公网访问。
7. 最终报告必须包含 commit、服务状态、健康检查、访问地址、测试结果和剩余风险。

## 1.1 推荐：免密 SSH

当前部署机已经配置好 `%USERPROFILE%\.ssh\id_ed25519`，部署脚本会在该文件存在时自动优先使用它，不需要 `MOLAN_SSH_PASS`。其他 AI 先用“禁止密码认证”的方式验证：

```powershell
$key = "$env:USERPROFILE\.ssh\id_ed25519"
ssh -o BatchMode=yes -o PasswordAuthentication=no -o PubkeyAuthentication=yes `
  -o StrictHostKeyChecking=no -i $key root@8.138.128.184 "printf 'passwordless-ssh-ok'"
```

预期输出：

```text
passwordless-ssh-ok
```

验证成功后直接执行部署，不要读取、复制或输出私钥内容：

```powershell
python C:\Users\lyh\Desktop\小说专属网页\scripts\deploy_molan.py
```

如果免密验证失败，才需要用户用一次性密码登录并把公钥加入 ECS。Windows 没有 `ssh-copy-id` 时可使用：

```powershell
$key = "$env:USERPROFILE\.ssh\id_ed25519"
Get-Content "$key.pub" | ssh root@8.138.128.184 `
  "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; cat >> ~/.ssh/authorized_keys"
```

完成后重新执行上面的 `BatchMode` 验证。不要把密码写入本文件、Git commit、GitHub、部署 tar 包、聊天记录或命令日志。`.gitignore` 已包含 `.env.*`，但提交前仍要用 `git status --short` 确认没有凭证文件进入暂存区。

## 2. 部署前检查

在 PowerShell 中执行：

```powershell
Set-Location 'C:\Users\lyh\Desktop\小说专属网页\molan-home'
git status --short --branch
git log -1 --oneline
node --check completion-editor.js
node --check completion-library.js
```

确认以下条件：

| 检查项 | 要求 |
|---|---|
| 项目目录 | `molan-home` 存在且是 Git 仓库 |
| SSH 认证 | 优先验证默认 `%USERPROFILE%\.ssh\id_ed25519` 免密登录；仅在失败时使用 `MOLAN_SSH_PASS` |
| Paramiko | `python -c "import paramiko; print(paramiko.__version__)"` 成功 |
| Node22 bundle | `LOCAL_NODE\bin\node` 存在 |
| 远端权限 | root SSH 可连接，并可操作 systemd、`/opt` 和 `/usr/local/bin/node` |

如果缺少 Paramiko，在部署机安装，不要改项目依赖：

```powershell
python -m pip install paramiko
```

如果缺少 Linux Node22 bundle，先准备到部署脚本要求的 `LOCAL_NODE` 路径。远端 systemd 启动命令包含 `--experimental-sqlite`，不能使用 Node20。

## 3. Git 推送流程

只有在本轮代码已验证并确认不包含用户无关改动时执行：

```powershell
Set-Location 'C:\Users\lyh\Desktop\小说专属网页\molan-home'
git add <本轮文件1> <本轮文件2>
git diff --cached --check
git commit -m "<说明本轮改动>"
git push origin main
```

部署脚本读取当前工作树，不只读取 Git HEAD。因此：

- 已提交改动会被部署。
- 未提交改动也会被打包部署。
- `git push` 成功不等于 ECS 已部署。
- ECS 部署成功也不等于公网端口已开放。

## 4. 执行 ECS 部署

部署脚本会自动完成：构建源码 tar、连接 ECS、安装 Node22、停止旧服务、备份远端 data、创建新 release、保留远端配置、切换 `/opt/molan`、写入 systemd、重启服务、健康检查。

```powershell
Set-Location 'C:\Users\lyh\Desktop\小说专属网页'
python .\scripts\deploy_molan.py
```

SSH 认证变量：

```powershell
$env:MOLAN_SSH_KEY = "$env:USERPROFILE\.ssh\id_ed25519"
# 或者：$env:MOLAN_SSH_PASS = '<不要写入文件或 Git 的密码>'
```

云端模型上游由 `data/config.json` 的 `platformModels[].baseURL` 指定。模型请求必须从 ECS 直接连接该地址；部署会归档并移除旧的 `upstream-proxy.conf`，不得重新配置 `MOLAN_PROXY`。如果该地址从 ECS 直连超时，检查上游防火墙/来源 IP 规则，允许 ECS 出口 `8.138.128.184` 的 TCP 443；应用健康接口正常不代表模型上游可达。

脚本打包时会排除：

- `node_modules`
- `.git`
- `.workbuddy`
- `scripts`
- `test`
- `data/` 中未列入运行时白名单的数据（仅打包 `genre-baselines`、`genre-rules`、`genre-evidence`、`correction-library`）
- 本机 `generated/` 生成内容
- 本机 `lib/character-material/` 原文素材索引
- `.env*`、日志、评测报告、证据索引、输入提示和会话尾部记录

远端 `data` 会先备份并复制到新 release。`data/config.json` 只有在远端不存在时才从本地 bootstrap；远端已有配置会保留。新 release 会沿用云端已有的 `generated/` 与 `lib/character-material/`，不会上传本机对应目录。

## 5. 部署后验证

部署脚本成功输出应包含：`connected`、`node v22.22.2`、`staged`、`active`、`molan active: active` 和健康 JSON。

### 5.1 ECS 内部验证

```powershell
$key = "$env:USERPROFILE\.ssh\id_ed25519"
ssh -i $key root@8.138.128.184 "systemctl is-active molan"
ssh -i $key root@8.138.128.184 "curl -s -m 8 http://127.0.0.1:3000/api/health"
ssh -i $key root@8.138.128.184 "ss -lntp | grep ':3000' || true"
```

合格标准：

- 服务状态为 `active`。
- 健康 JSON 中 `ok=true`、`db=ready`，并且 `models` 数量大于 0。
- 监听结果为 `0.0.0.0:3000`，进程为 Node。

### 5.2 公网验证

```powershell
curl.exe -sS -m 10 -I http://8.138.128.184:3000/
```

如果 ECS 内部健康正常、Node 监听 `0.0.0.0:3000`，但公网请求超时，优先检查云厂商安全组是否放行入站 TCP `3000`。不要把“内部 health 正常”当作“公网可访问”。

## 6. 公网未开放时的临时预览

在本机建立 SSH 隧道：

```powershell
$key = "$env:USERPROFILE\.ssh\id_ed25519"
ssh -N -o ExitOnForwardFailure=yes -i $key -L 3300:127.0.0.1:3000 root@8.138.128.184
```

另开一个终端或浏览器访问：

```text
http://localhost:3300/#editor
```

说明：`localhost:3300` 访问的是 ECS 上的服务，但只对建立隧道的这台机器有效；关闭 SSH 进程后地址失效。它不能替代云安全组放行。

## 7. 回滚

### 7.1 自动回滚

如果 systemd 重启后不是 `active`，`deploy_molan.py` 会：

1. 输出最近的 systemd journal。
2. 把失败 release 移到 `failed-<timestamp>`。
3. 恢复上一版 release。
4. 重新启动 `molan`。

### 7.2 手动回滚

先通过 SSH 找到目标 release，再执行；不要猜目录名：

```bash
systemctl stop molan
ls -dt /opt/molan-releases/previous-* | head -1
mv /opt/molan /opt/molan-releases/failed-manual-<timestamp>
mv /opt/molan-releases/previous-<timestamp> /opt/molan
systemctl start molan
systemctl is-active molan
curl -s -m 8 http://127.0.0.1:3000/api/health
```

手动回滚前应备份当前 `/opt/molan/data`，不要删除任何 data 目录。

## 8. 故障排查速查

| 现象 | 检查 | 处理 |
|---|---|---|
| `No module named paramiko` | `python -c "import paramiko"` | 在部署机安装 Paramiko，不改项目 package.json |
| `bad option: --experimental-sqlite` | `node --version` | 使用 Node22.22.2，不使用 Node20 |
| `EADDRINUSE :3000` | `Get-NetTCPConnection -LocalPort 3000 -State Listen` | 本地验证改用 `$env:PORT=3001`，不要停未知服务 |
| SSH 认证失败 | `ssh -i <key> root@8.138.128.184 hostname` | 修正密钥路径或环境变量；不要猜密码 |
| `molan` 非 active | `systemctl status molan`、`journalctl -u molan -n 50 --no-pager` | 先看日志；部署脚本通常会自动恢复 previous release |
| health 返回 `NOHEALTH` | `systemctl is-active molan`、本机 curl | 检查启动日志、端口和 `data/config.json`，不要删除 data |
| ECS health 正常但公网超时 | `ss -lntp | grep ':3000'`、外部 curl | 检查云安全组 TCP 3000；无权限时使用 SSH 隧道 |
| 页面版本不对 | `git log -1`、浏览器强制刷新、远端 active release | 确认部署使用的 `PROJ_DIR` 和当前工作树 |

## 9. AI 交付报告模板

部署完成后，其他 AI 应按以下格式报告：

```text
结果：成功 / 部分成功 / 失败
Git：<commit SHA>，分支 <branch>，是否已 push
ECS：<host>，active release <remote dir>
服务：molan = <active/inactive>
健康检查：<实际 JSON 摘要>
公网地址：<URL>，是否实际访问成功
临时预览：<SSH tunnel URL 或无>
测试：<命令>，<通过/失败摘要>
未提交改动：<保留的用户改动，不要假装已提交>
剩余风险：<安全组、密钥、配置、回滚或其他明确阻塞>
```

## 10. 当前已知状态

截至本文件生成时：

- ECS `molan` 服务为 `active`。
- ECS 内部健康检查返回 `ok=true`、`db=ready`、`models=9`。
- Node 正在 `0.0.0.0:3000` 监听。
- 公网 `8.138.128.184:3000` 当前从外部访问超时，需检查云安全组。
- SSH 隧道预览地址为 `http://localhost:3300/#editor`。
