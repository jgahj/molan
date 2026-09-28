# 墨阑项目
- 启动入口 server.js；需要 Node >=22.5.0。优先复用现有服务，未经任务授权不重启或另开服务。
- 本机运行时 ../tools/node22_runtime/node.exe；启动参数 --experimental-sqlite --no-warnings server.js。
- POST handler 使用 readBody(req)；node:sqlite 使用同步 API，不调用 db.transaction()。
- 新函数使用中文函数级注释，但服从更高优先级指令。
- 优先验证直接受影响的测试；全量测试为 npm test，仅必要时运行。不为文档调整启动服务或浏览器。
