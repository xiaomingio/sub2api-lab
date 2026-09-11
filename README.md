# Sub2API Lab

Sub2API Lab（Sub2API 拼车助手）是面向 [Sub2API](https://github.com/Wei-Shaw/sub2api) 的只读分析与月度对账工具，适合需要按成员实际用量核算成本的 Codex 多人拼车场景。它读取 Sub2API 数据库中的用户、账号和用量记录，按系统余额、实际费用或标准费用生成用量基准，并按比例分摊实际采购成本。

各 Tab 的详细功能、数据来源、计算口径和使用流程见[功能模块说明](docs/tabs.md)。

## 功能概览

| Tab | 使用时机 | 功能 | 数据访问 |
| --- | --- | --- | --- |
| 系统介绍 | 第一次使用或需要了解工具范围时 | 说明各分析工具的用途和适用场景 | 不读取业务数据 |
| 额度趋势 | 日常查看或月底复盘时 | 按配置时区的每个整点展示各上游账号 7 天使用率折线，并列出检测到的重置 | 读取 Sub2API `accounts.extra` 的小时快照 |
| 用量统计 | 日常查看或排查时 | 按时间范围汇总每位用户的请求数、各类 Token、标准费用和已记录费用 | 读取 `usage_logs` 和 `users` |
| 额度分析 | 日常查看账号窗口和本地用量时 | 查看当前账号窗口、模型用量、用户 Token 与费用分析 | 读取原始 Sub2API 数据库 |
| 额度估算 | 估算单模型完整 7 天窗口容量时 | 按账号拟合模型消耗，展示容量区间、预测误差和 3 天对照 | 读取小时快照与使用日志 |
| 使用记录 | 排查具体请求或筛选调用来源时 | 分页查看原始调用记录，并按用户、账号、模型、接口、计费方式等条件筛选 | 读取 `usage_logs` 及关联表 |
| 成本分摊 | 每月结算时 | 按系统余额、实际费用或标准费用计算统计基准，再按比例分摊实际采购总成本 | 读取 `users.balance`、`usage_logs` 和 `accounts` |
| 余额设置 | 每月开始使用前 | 将所选用户的系统余额设置为目标额度 | 读取 `users.balance`，通过 Sub2API Admin API 写入 |

## 快速开始

环境要求：Node.js `20.19+` 或 `22.12+`，以及可访问的 Sub2API PostgreSQL 数据库。

```bash
npm ci
cp .env.example .env.development
```

编辑 `.env.development`，至少填写 `SUB2API_LAB_AUTH_USER`、`SUB2API_LAB_AUTH_PASSWORD`、`DATABASE_URL` 和 `DATABASE_URL_SUB2API`，然后启动服务：

```bash
npm run dev
```

本地默认访问地址为 `http://127.0.0.1:9100`。配置了 `SUB2API_LAB_BASE_PATH` 时，请从对应子路径访问。

## 配置说明

配置项以 [.env.example](.env.example) 为准。开发环境使用 `.env.development`，生产环境使用 `.env.production`；这两个文件已被 Git 忽略，不要提交真实账号、密码或密钥。

| 变量 | 必填 | 用途 |
| --- | --- | --- |
| `SUB2API_LAB_AUTH_USER` | 是 | Sub2API Lab 登录用户名，由部署者设置 |
| `SUB2API_LAB_AUTH_PASSWORD` | 是 | Sub2API Lab 登录密码，由部署者设置 |
| `DATABASE_URL` | 是 | Sub2API Lab PostgreSQL 连接串；也是 TinyDB migration 的目标库 |
| `DATABASE_URL_SUB2API` | 是 | Sub2API 主库 PostgreSQL 连接串，用于读取 usage、账号和余额 |
| `SUB2API_LAB_HOST` | 否 | 监听地址，默认为 `127.0.0.1` |
| `SUB2API_LAB_PORT` | 否 | 监听端口，默认为 `9100` |
| `SUB2API_LAB_BASE_PATH` | 否 | 挂载子路径，默认使用根路径 |
| `SUB2API_LAB_TIMEZONE` | 否 | 页面时间和统计边界使用的时区，默认为 `Asia/Shanghai` |
| `SUB2API_LAB_FAKE_NOW` | 否 | 仅开发环境可用，用于测试固定时间点；填写 ISO 日期时间 |
| `SUB2API_BASE_URL` | 否 | Sub2API Admin API 地址 |
| `SUB2API_ADMIN_API_KEY` | 否 | 余额设置使用的管理员 API Key；留空时无法使用余额设置功能 |

`DATABASE_URL` 格式如下：

```dotenv
DATABASE_URL=postgresql://用户名:密码@数据库地址:端口/sub2api_lab?sslmode=disable
DATABASE_URL_SUB2API=postgresql://只读用户名:密码@数据库地址:端口/sub2api?sslmode=disable
```

额度趋势使用独立的 `sub2api_lab` 数据库。首次部署时由数据库管理员创建该数据库，并让 `DATABASE_URL` 使用的数据库用户可以连接和写入。下面示例假定数据库用户已经存在，实际用户名请替换为部署环境中的角色名：

```sql
CREATE DATABASE sub2api_lab OWNER sub2api_lab;
GRANT CONNECT ON DATABASE sub2api_lab TO sub2api_lab;
```

切换到 `sub2api_lab` 后执行应用迁移：

```bash
npm run build
npm run db:migrate
```

迁移使用 `@xiaomingio/tiny-db-migrate`，会创建 `quota_snapshots` 表。应用运行时每个配置时区的整点读取 Sub2API `accounts.extra`，将 5 小时和 7 天使用率保存为小时快照，不调用 Sub2API 额度刷新接口。应用启动不会自动执行迁移，数据库管理员应先完成迁移，再启动应用。

登录凭据属于 Sub2API Lab，与 Sub2API 用户账号无关。未登录访问会进入登录页；生产环境请使用独立的强密码。

## 管理员 API Key（可选）

只有余额设置需要管理员 API Key。进入 Sub2API 管理后台的「系统设置 → 安全与认证 → 管理员 API Key」，点击“重新生成”，然后将密钥填入 `SUB2API_ADMIN_API_KEY`。

Sub2API Lab 不直接更新 `users.balance`。余额设置会调用 `POST /api/v1/admin/users/:id/balance`，并使用 `operation: "set"` 设置目标余额。Sub2API 会在写入余额的同时记录调整历史并清理缓存；直接更新数据库只会改变表中的数值，可能让余额缓存和调整记录与数据库不一致。

![Sub2API 系统设置中生成管理员 API Key 的位置](docs/assets/sub2api-admin-api-key.png)

管理员 API Key 拥有完整管理员权限，只应保存在真实 env 文件或部署平台的密钥配置中。

## 在 Sub2API 中配置入口（可选）

Sub2API 可以在「系统设置 → 通用设置 → 自定义菜单页面」中添加 iframe 页面。菜单名称填写 `Sub2API Lab`，页面 URL 填写部署后的 Lab 地址，例如 `https://your-domain.example/sub2api-lab`，再按需要设置可见角色。

![在 Sub2API 系统设置中配置 Sub2API Lab 自定义菜单页面](docs/assets/sub2api-custom-menu-settings.png)

保存后，可以直接从 Sub2API 侧边栏进入 Sub2API Lab。

![配置后在 Sub2API 侧边栏内嵌显示 Sub2API Lab](docs/assets/sub2api-lab-embedded-menu.png)

## 本地开发

项目使用 `Fastify API + Vite + React`。Fastify 负责登录鉴权、数据库读取、静态资源托管和余额设置，React 负责浏览器端管理界面。

服务提供无需登录的健康检查：`/health`；配置了 `SUB2API_LAB_BASE_PATH` 时，也可访问对应子路径下的 `/health`。正常响应为 `{ "ok": true }`。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 构建前端资源并以源码 watch 模式启动本地服务 |
| `npm run db:migrate:dev` | 使用 `.env.development` 执行本地数据库迁移 |
| `npm test` | 运行项目测试 |
| `npm run typecheck` | 检查服务端、客户端和测试 TypeScript 类型 |
| `npm run build` | 构建前端资源并编译服务端代码 |
| `npm run start` | 使用 `.env.development` 启动已构建的 `dist/server.js` |

## 生产部署

先根据 [.env.example](.env.example) 准备 `.env.production`。可以使用 [TinyShip](https://github.com/xiaomingio/tinyship-js) 部署，也可以手动执行同样的 `rsync + PM2` 流程。

### 使用 TinyShip

`tinyship.config.yml` 使用通用 SSH 别名 `sub2api-lab-production`。在本机 `~/.ssh/config` 中将它映射到自己的服务器：

```sshconfig
Host sub2api-lab-production
  HostName your-server.example.com
  User deploy
  IdentityFile ~/.ssh/your-key
```

TinyShip 会同步构建产物和 `.env.production`，安装生产依赖，再根据 `ecosystem.config.cjs` 启动或重载 PM2 服务。

```bash
npm run build
npm run deploy:validate
npm run deploy:preflight
npm run deploy:sub2api-lab
```

### 自行部署

目标主机需要安装 Node.js、PM2 和 `rsync`，并准备好可写的 `/opt/sub2api-lab` 目录。先在本地构建：

```bash
npm ci
npm run build
```

同步运行文件：

```bash
rsync -az --delete dist/ sub2api-lab-production:/opt/sub2api-lab/dist/
rsync -az package.json package-lock.json tiny-db-migrate.config.yml db/ ecosystem.config.cjs .env.production \
  sub2api-lab-production:/opt/sub2api-lab/
```

登录目标主机，安装生产依赖并启动服务：

```bash
ssh sub2api-lab-production
cd /opt/sub2api-lab
npm install --omit=dev
pm2 stop sub2api-lab
npm run db:migrate
pm2 startOrReload ecosystem.config.cjs --only sub2api-lab
pm2 save
```
