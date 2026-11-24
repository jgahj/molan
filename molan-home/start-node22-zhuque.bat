@echo off
cd /d "%~dp0"
rem 本地朱雀闭环启动器：只从环境变量读取 MAKERS_MODELS_KEY，不把密钥写入任何文件。
if "%MAKERS_MODELS_KEY%"=="" (
  echo [molan] 请先设置环境变量 MAKERS_MODELS_KEY，再运行本脚本。
  echo [molan] 示例：set MAKERS_MODELS_KEY=你的Key
  exit /b 1
)
set MOLAN_ZHUQUE_CLOSED_LOOP=1
if "%MOLAN_ZHUQUE_REWRITE_ROUNDS%"=="" set MOLAN_ZHUQUE_REWRITE_ROUNDS=2
if "%MOLAN_ZHUQUE_SEGMENT_REPAIR_ROUNDS%"=="" set MOLAN_ZHUQUE_SEGMENT_REPAIR_ROUNDS=3
rem 编辑器「去 AI 味」工具的真朱雀自检闸门：默认 2 轮。配了 MAKERS_MODELS_KEY 时用真值判定，未配置自动降级本地代理。
if "%MOLAN_HUMANIZE_GATE_ROUNDS%"=="" set MOLAN_HUMANIZE_GATE_ROUNDS=2
call "%~dp0start-node22.bat"
