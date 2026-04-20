# TACO 指标 — Trump Always Chickens Out

追踪特朗普第二任期内六大市场压力因子的综合指标。当压力突破阈值，政策总会转向。

## 什么是 TACO？

TACO 是 **Trump Always Chickens Out** 的缩写，量化特朗普在政策引发市场剧烈波动时选择退缩的行为模式。该指标将六大因子标准化（Z-Score）后加权合成一个综合压力值：

| 因子 | 权重 | 数据源 | 压力方向 |
|------|------|--------|----------|
| S&P 500 指数 | 25% | Yahoo Finance | 下跌 = 压力增大 |
| 汽油均价 | 20% | EIA / AAA | 上涨 = 压力增大 |
| 10Y 国债收益率 | 15% | Yahoo Finance | 上涨 = 压力增大 |
| 30Y 抵押贷款利率 | 15% | FRED (Freddie Mac PMMS) | 上涨 = 压力增大 |
| 总统支持率 | 15% | Civiqs | 下降 = 压力增大 |
| 5Y 盈亏平衡通胀率 | 10% | FRED | 上涨 = 压力增大 |

## 快速开始

### 环境要求

- Node.js >= 14

### 安装

```bash
git clone https://github.com/higer/taco-indicator.git
cd taco-indicator
npm install
```

### 配置

复制环境变量模板并按需修改：

```bash
cp .env.example .env
# 编辑 .env 填入你的 FRED API Key 等配置
```

项目使用 [dotenv](https://github.com/motdotla/dotenv) 自动加载 `.env` 文件。

`.env` 文件中的变量：

| 变量 | 必填 | 说明 |
|------|------|------|
| `PORT` | 否 | 服务端口，默认 `3000` |
| `FRED_API_KEY` | 否 | FRED API 密钥，用于自动拉取房贷利率和通胀预期数据。[免费申请](https://fred.stlouisfed.org/docs/api/api_key.html) |
| `UPDATE_TOKEN` | 否 | API 写入操作的 Bearer Token。未设置时写入端点无需认证 |

### 启动

```bash
npm start
```

浏览器访问 `http://localhost:3000`。

## 数据更新机制

### 自动更新（每日 UTC 06:00）

服务启动后会注册一个 cron 定时任务，每天自动从以下源拉取数据：

| 指标 | 自动更新 | 条件 |
|------|---------|------|
| S&P 500 | 是 | 无需配置 |
| 10Y 国债收益率 | 是 | 无需配置 |
| 30Y 房贷利率 | 是 | 需设置 `FRED_API_KEY` |
| 5Y 通胀预期 | 是 | 需设置 `FRED_API_KEY` |
| 汽油均价 | 否 | 需手动更新 |
| 总统支持率 | 否 | 需手动更新 |

### 手动更新

#### 触发一次完整拉取

```bash
curl -X POST http://localhost:3000/api/fetch \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### 更新单个指标（以汽油价格为例）

整体替换：

```bash
curl -X POST http://localhost:3000/api/update \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"gas": [3.076, 3.121, 3.096, 3.171, 3.150, 3.150, 3.125, 3.133, 3.166, 3.060, 3.050, 2.894, 2.809, 2.908, 3.638, 4.10]}'
```

按月份补丁更新：

```bash
curl -X POST http://localhost:3000/api/update \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"patch": {"gas": {"2026-04": 4.10}, "approve": {"2026-04": 36.5}}}'
```

#### 添加新的时间线事件

```bash
curl -X POST http://localhost:3000/api/update \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"timelineEvents": [{"date":"2026-05-01","title":"退缩 #12","desc":"描述","type":"chicken"}]}'
```

事件类型：`chicken`（退缩）、`escalation`（升级）、`court`（法院裁决）。

## API 端点

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/data` | 返回全部缓存数据（含 TACO 综合值和 KPI） | 不需要 |
| POST | `/api/update` | 手动局部更新数据 | 需要 `UPDATE_TOKEN`* |
| POST | `/api/fetch` | 触发立即从 Yahoo Finance / FRED 拉取 | 需要 `UPDATE_TOKEN`* |

\* 如未设置 `UPDATE_TOKEN` 环境变量，写入端点不做认证检查。生产环境务必设置。

## 项目结构

```
taco-indicator/
├── server.js          # Express 服务器 + cron 定时任务
├── fetcher.js         # 数据拉取与 TACO 计算逻辑
├── data.json          # 缓存的数据文件（自动更新）
├── public/
│   └── index.html     # 前端页面（ECharts + GSAP + Tailwind）
├── package.json
├── .env.example
└── .gitignore
```

## 部署

该项目是标准 Node.js 应用，可部署到任何支持 Node.js 的平台：

**Railway / Render / Fly.io：**
1. 连接 GitHub 仓库
2. 设置环境变量 `FRED_API_KEY` 和 `UPDATE_TOKEN`
3. 启动命令 `npm start`

**Docker：**

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## 重要事项

- **数据仅供参考，不构成投资建议。** TACO 指标是一个观测工具，不是交易信号。
- Yahoo Finance 非官方 API 可能被限流。如遇拉取失败，服务会继续使用缓存数据运行。
- `data.json` 会被自动覆盖，不要手动编辑该文件，请通过 API 更新。
- 汽油价格和支持率没有免费的结构化 API，需要定期手动更新。推荐数据来源：
  - 汽油：[AAA Gas Prices](https://gasprices.aaa.com/) 或 [EIA](https://www.eia.gov/petroleum/gasdiesel/)
  - 支持率：[Civiqs](https://civiqs.com/results/approve_president_trump) 或 [FiveThirtyEight](https://projects.fivethirtyeight.com/polls/approval/donald-trump/)
- FRED API 密钥免费，无调用量限制（合理使用），强烈建议配置以获得完整的自动更新覆盖。

## 数据来源

| 数据 | 来源 |
|------|------|
| S&P 500 | Yahoo Finance (`^GSPC`) |
| 10Y 国债收益率 | Yahoo Finance (`^TNX`) |
| 30Y 房贷利率 | FRED `MORTGAGE30US` (Freddie Mac PMMS) |
| 5Y 通胀预期 | FRED `T5YIEM` |
| 汽油均价 | EIA / AAA |
| 支持率 | Civiqs Daily Tracking |
| 关税时间线 | Tax Foundation US Tariff Tracker |

## License

MIT
