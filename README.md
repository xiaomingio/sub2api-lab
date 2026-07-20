# Sub2API Lab

`Sub2API Lab` 是基于 [Sub2API](https://github.com/Wei-Shaw/sub2api) 的独立月度对账工具，适合 Codex 多人拼车场景。`20x` 等高额度方案的单位成本通常低于 `1x` 或 `5x`，但单人往往用不完；多人拼车可以更充分地利用额度，但每个人的实际用量不同，平均分摊并不公平。本工具直接使用 Sub2API 已计算的用户系统消耗，按比例分摊当月的实际采购总成本。

## 功能概览

| Tab | 使用时机 | 功能 | 数据访问 |
| --- | --- | --- | --- |
| 用量统计 | 日常查看或排查时 | 按时间范围汇总每位用户的请求数、各类 Token、标准费用和已记录费用 | 读取 `usage_logs` 和 `users` |
| 成本分摊 | 每月结算时 | 根据月初额度和当前余额计算系统消耗，再按消耗比例分摊实际采购总成本 | 读取 `users.balance` |
| 余额恢复 | 完成本月结算后 | 将所选账号的余额设置为下月额度 | 读取 `users.balance`，通过 Admin API 写入 |

## 月度结算与计费规则

1. **月初设置额度**：在「余额恢复」中，为所有参与本月拼车的账号设置相同且充足的初始系统额度，例如 `5000`。
2. **月内正常使用**：成员通过 Sub2API 使用 API，Sub2API 按自身计费规则记录调用费用，并从各账号的系统余额中扣除。
3. **月底分摊成本**：在「成本分摊」中填写月初额度和本月实际采购总成本。Sub2API Lab 根据每个所选账号的当前余额计算系统消耗，再按消耗比例分摊实际成本。
4. **结算后恢复余额**：确认分摊结果后，在「余额恢复」中将参与账号的余额设置为下个月的统一额度。

必须先完成成本分摊，再恢复余额。恢复操作会覆盖当前余额，而当前余额是计算本月系统消耗的依据。

“系统余额”是 Sub2API 内部使用的计费金额，“实际采购总成本”是本月购买 Codex 订阅或相关账号实际支付的金额。页面默认的月初和下月额度为 `5000`，实际采购总成本为 `1200`，均可修改。

```text
账号系统消耗 = max(月初系统额度 - 当前系统余额, 0)
账号分摊比例 = 账号系统消耗 / 所选账号系统消耗总额
账号应承担成本 = 账号分摊比例 * 实际采购总成本
```

例如，三位成员的系统消耗分别占 `50%`、`30%` 和 `20%`，实际采购总成本为 `1200` 元，则三人分别承担 `600` 元、`360` 元和 `240` 元。

## 快速开始

环境要求：Node.js `20.19+` 或 `22.12+`，以及可访问的 Sub2API PostgreSQL 数据库。

```bash
npm ci
cp .env.example .env.development
```

编辑 `.env.development`，至少填写 `SUB2API_LAB_AUTH_USER`、`SUB2API_LAB_AUTH_PASSWORD` 和 `DATABASE_URL`，然后启动服务：

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
| `DATABASE_URL` | 是 | Sub2API PostgreSQL 连接串 |
| `SUB2API_LAB_HOST` | 否 | 监听地址，默认为 `127.0.0.1` |
| `SUB2API_LAB_PORT` | 否 | 监听端口，默认为 `9100` |
| `SUB2API_LAB_BASE_PATH` | 否 | 挂载子路径，默认使用根路径 |
| `SUB2API_LAB_TIMEZONE` | 否 | 统计时区，默认为 `Asia/Shanghai` |
| `SUB2API_BASE_URL` | 否 | Sub2API Admin API 地址 |
| `SUB2API_ADMIN_API_KEY` | 否 | 余额恢复使用的管理员 API Key；留空时无法使用余额恢复功能 |

`DATABASE_URL` 格式如下：

```dotenv
DATABASE_URL=postgresql://用户名:密码@数据库地址:端口/数据库名?sslmode=disable
```

登录凭据属于 Sub2API Lab，与 Sub2API 用户账号无关。未登录访问会进入登录页；生产环境请使用独立的强密码。

## 管理员 API Key（可选）

只有余额恢复需要管理员 API Key。进入 Sub2API 管理后台的「系统设置 → 安全与认证 → 管理员 API Key」，点击“重新生成”，然后将密钥填入 `SUB2API_ADMIN_API_KEY`。

Sub2API Lab 不直接更新 `users.balance`。余额恢复会调用 `POST /api/v1/admin/users/:id/balance`，并使用 `operation: "set"` 设置目标余额。Sub2API 会在写入余额的同时记录调整历史并清理缓存；直接更新数据库只会改变表中的数值，可能让余额缓存和调整记录与数据库不一致。

![Sub2API 系统设置中生成管理员 API Key 的位置](docs/assets/sub2api-admin-api-key.png)

管理员 API Key 拥有完整管理员权限，只应保存在真实 env 文件或部署平台的密钥配置中。

## 在 Sub2API 中配置入口（可选）

Sub2API 可以在「系统设置 → 通用设置 → 自定义菜单页面」中添加 iframe 页面。菜单名称填写 `Sub2API Lab`，页面 URL 填写部署后的 Lab 地址，例如 `https://your-domain.example/sub2api-lab`，再按需要设置可见角色。

![在 Sub2API 系统设置中配置 Sub2API Lab 自定义菜单页面](docs/assets/sub2api-custom-menu-settings.png)

保存后，可以直接从 Sub2API 侧边栏进入 Sub2API Lab。

![配置后在 Sub2API 侧边栏内嵌显示 Sub2API Lab](docs/assets/sub2api-lab-embedded-menu.png)

## 本地开发

项目使用 `Fastify API + Vite + React`。Fastify 负责登录鉴权、数据库读取、静态资源托管和余额恢复，React 负责浏览器端管理界面。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 构建前端资源并以源码 watch 模式启动本地服务 |
| `npm test` | 运行成本分摊和 Sub2API 写入请求测试 |
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
rsync -az package.json package-lock.json ecosystem.config.cjs .env.production \
  sub2api-lab-production:/opt/sub2api-lab/
```

登录目标主机，安装生产依赖并启动服务：

```bash
ssh sub2api-lab-production
cd /opt/sub2api-lab
npm install --omit=dev
pm2 startOrReload ecosystem.config.cjs --only sub2api-lab
pm2 save
```
