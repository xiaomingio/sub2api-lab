# 项目协作规则

## 分析 Sub2API

凡是需要分析、核对或参考 Sub2API 的源码、接口、配置、行为或实现，必须遵循 `third-party-project-analysis` 流程。

- 优先使用本地第三方仓库：`/Users/jzj/workspace/third-party/sub2api`
- 使用前检查该仓库的 `git status --short --branch` 和 `git remote -v`，确认仓库身份及本地改动
- 仓库工作区干净时，按第三方流程检查并同步远端默认分支；有本地改动时不得覆盖、重置或擅自切换
- 基于本地源码分析，优先读取项目入口、核心模块、接口路由、运行配置和相关测试
- 不得把 Sub2API 克隆到当前项目目录，也不得在临时目录重复创建同一仓库副本
- 只有确认本地没有匹配仓库时，才按第三方流程将其创建到 `/Users/jzj/workspace/third-party/<repo-name>`

