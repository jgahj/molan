# Legacy Data Archive (历史平铺数据归档)

此目录保留项目早期使用的平铺 JSON 数据文件，现已全量迁移至 SQLite / Postgres 数据库仓储与原生服务：
- `users.json`: 历史平铺账户数据（现由 SQLite accounts 表持久化）
- `admin_audit.json`: 历史管理员审计日志（现由 SQLite admin_audit 表持久化）
- `global_skills.json`: 历史全局技能配置（现由 SQLite global_skills 表持久化）
- `quality_issue_map.json`: 历史问题诊断映射字典（已被单元测试与 inplace-sanitizer 取代）
- `genre_sampling_6books.json`: 历史题材抽样清单
