# 文风档案存储

文风档案的读取、保存、版本历史、风格审查和上下文装配共享同一存储适配器。HTTP 接口为：

- `GET /api/books/:bookId/styles?branchId=main&level=novel_narrative`
- `POST /api/books/:bookId/styles`
- `GET /api/books/:bookId/styles/:profileId/versions?branchId=main`
- `POST /api/books/:bookId/style-audits`
- `POST /api/books/:bookId/context/assemble`

## 本地 JSON

设置 `MOLAN_STYLE_STORE=json` 后，本地文风档案保存到
`MOLAN_DATA_DIR/style-profiles-json`；未设置 `MOLAN_DATA_DIR` 时使用项目 `data/style-profiles-json`。
档案按项目隔离，保留分支、revision 和不可变版本快照。服务器启动时取得单进程写锁并检查恢复日志；
同一目录不能由多个服务进程同时打开。优雅退出会释放锁，进程异常结束后下次启动会恢复未完成的原子提交。
损坏文件或写盘失败会返回错误，不会按空档案库继续运行。

本地 JSON 模式只接管文风档案域。它不会迁移或删除旧 SQLite 数据；未设置该开关时仍使用既有本地后端。

## PostgreSQL

启用 PostgreSQL 后会优先使用 PG 适配器，不读取本地 JSON 档案。读写在
`withCreationBookTransaction` 的当前用户事务中完成，依赖项目成员校验、事务绑定和 `luna.style_profiles` /
`luna.style_profile_versions` 的 RLS 策略。档案更新使用 revision CAS；当前版本快照缺失时返回
`STYLE_PROFILE_CORRUPT`，不会回退到较早版本或静默生成空规则。

旧 SQLite 文风档案不会自动导入。迁移前应按项目迁移流程备份、导出并核对关联与内容；本说明不授权自动修改旧库或受保护数据目录。

## 验证边界

`test/style-profile-store.test.js` 只覆盖原生 JSON store，可在 Node 20 运行，不依赖 SQL。
`test/style-profile-store-routes.test.js` 为过渡期路由集成测试，使用 `node:sqlite` 夹具初始化既有权限与记忆表；
它不能作为普通测试或生产链已零 SQLite 的证明。部署接入还需在目标 PostgreSQL 实例执行真实 RLS 与 revision 冒烟。
