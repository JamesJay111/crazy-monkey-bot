# CoinGlass 美国宏观事件 → Twitter 三语言多账户自动推送实现文档

## 📋 功能概述

实现了 CoinGlass 美国宏观事件（经济数据/财经日历/央行动态）自动推送到 Twitter 三账户的功能。

### 核心特性

- ✅ **数据源**：CoinGlass API（`/api/macro/calendar`）
- ✅ **轮询频率**：每 2 小时执行一次
- ✅ **推送策略**：每次最多推送 1 条事件
- ✅ **三账户发布**：
  - Account A：韩语（KR）
  - Account B：中文（ZH）
  - Account C：英文（EN）
- ✅ **AI 生成**：使用 DeepSeek API 生成推文内容
- ✅ **字符限制**：每条推文 <= 200 characters
- ✅ **去重机制**：同一 event_key 不重复推送（跨重启也不重复）

## 🗂️ 文件清单

### 新增文件

1. **`src/types/macroEvent.ts`**
   - CoinGlass 宏观事件类型定义
   - EventDTO（统一事件模型）
   - MacroEventPushLog（推送日志类型）

2. **`src/utils/macroEventNormalizer.ts`**
   - 事件数据标准化工具
   - 生成 event_key（SHA1 哈希）
   - 统一时间戳为毫秒
   - 判断事件状态（UPCOMING/RELEASED）

3. **`src/services/macroUsTweetJob.service.ts`**
   - 宏观事件自动推送 Job 服务
   - 事件拉取、过滤、选择逻辑
   - DeepSeek 推文生成
   - Twitter 三账户发布
   - 字符数裁剪逻辑

### 修改文件

1. **`src/clients/coinglass.client.ts`**
   - 新增 `getMacroEvents()` 方法

2. **`db/init.sql`**
   - 新增 `macro_event_push_log` 表

3. **`src/bot/index.ts`**
   - 初始化 `MacroUsTweetJobService`
   - 启动/停止 Job

## 🔧 核心实现

### 1. 事件拉取与过滤

```typescript
// 时间窗口：过去6小时 + 未来24小时
const startTime = Math.floor((now - 6 * 60 * 60 * 1000) / 1000); // 秒级
const endTime = Math.floor((now + 24 * 60 * 60 * 1000) / 1000); // 秒级

// 过滤：只保留 country_code == "USA" 的事件
const usaEvents = events.filter(event => event.country_code === 'USA');
```

### 2. 事件选择逻辑

排序优先级：
1. `importance_level` 高优先（3 > 2 > 1）
2. 距离当前时间最近（`abs(publish_time - now)` 最小）
3. 优先 RELEASED 再 UPCOMING

### 3. 去重机制

使用 `event_key`（SHA1 哈希）作为唯一标识：
- 查询 `macro_event_push_log` 表
- 排除已推送的 `event_key`
- 跨进程重启也不重复

### 4. Icon 规则

- `importance_level=3` → 🚨
- `importance_level=2` → ⚠️
- `importance_level=1` → ℹ️

增强：
- 若 `status=UPCOMING` 且 `publish_time` 在未来 2 小时内：ICON 后追加 ⏱️
- 若 `status=RELEASED`：ICON 后追加 ✅

### 5. DeepSeek 推文生成

**系统 Prompt**（各语言）：
- 角色：加密货币交易者的美国宏观经济事件分析师
- 要求：ST（短期交易者视角）+ MT（中期交易者视角）
- 禁止：喊单、价格预测
- 限制：最多 200 字符

**用户 Prompt**（结构化数据）：
- 事件名称、时间、重要性级别
- 状态（UPCOMING/RELEASED）
- 预期值、前值、公布值、修正前值、影响描述

**输出格式**（四行结构）：
```
Line1: {ICON} US Macro: {calendar_name}
Line2: ⏰ {utc_time} | Impact {importance_level}/3
Line3: ST: ...
Line4: MT: ...
```

### 6. 字符数裁剪逻辑

裁剪顺序（必须保留：ICON、事件名、时间、ST 标签）：
1. 先缩短 MT
2. 再缩短 ST
3. 最后（必要时）删除 MT

### 7. Twitter 发布

- 使用 `XTweetOAuth1Service`（OAuth 1.0a）
- 三账户独立发布（A/KR、B/ZH、C/EN）
- 每个账户最多重试 1 次（指数退避 2s -> 5s）
- 账户失败互不影响

### 8. 数据库设计

**表：`macro_event_push_log`**

```sql
CREATE TABLE macro_event_push_log (
  event_key TEXT PRIMARY KEY,
  calendar_name TEXT NOT NULL,
  publish_time_utc_ms INTEGER NOT NULL,
  importance_level INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('UPCOMING', 'RELEASED')),
  sent_at_utc_ms INTEGER NOT NULL,
  tw_a_status TEXT CHECK(tw_a_status IN ('sent', 'failed')),
  tw_b_status TEXT CHECK(tw_b_status IN ('sent', 'failed')),
  tw_c_status TEXT CHECK(tw_c_status IN ('sent', 'failed')),
  tw_a_tweet_id TEXT,
  tw_b_tweet_id TEXT,
  tw_c_tweet_id TEXT,
  last_error TEXT
);
```

## 🚀 启动方式

### 1. 前置条件

确保已完成 Twitter OAuth 1.0a 授权：
- Account A token：`./data/x_oauth1_tokens.json`（默认账户）
- Account B token：`./data/x_oauth1_tokens_accountB.json`
- Account C token：`./data/x_oauth1_tokens_accountC.json`

### 2. 环境变量

无需新增环境变量，使用现有配置：
- `COINGLASS_API_KEY`：CoinGlass API Key
- `DEEPSEEK_API_KEY`：DeepSeek API Key

### 3. 启动 Bot

```bash
# 方式 1: 使用启动脚本
./start.sh

# 方式 2: 直接运行
npm run dev
```

### 4. 验证启动

启动后，查看日志：

```bash
tail -f logs/bot.log | grep -i "macro"
```

应该看到：
```
✅ 宏观事件自动推送任务已启动
Running macro US tweet job...
```

## 📊 工作流程

```
1. 每 2 小时触发
   ↓
2. 拉取事件（过去6h + 未来24h）
   ↓
3. 过滤美国事件（country_code == "USA"）
   ↓
4. 去重（排除已推送的 event_key）
   ↓
5. 选择最佳事件（只选 1 条）
   ↓
6. 生成三语言推文（DeepSeek）
   ↓
7. 裁剪到 200 字符
   ↓
8. 发布到三账户（A/KR、B/ZH、C/EN）
   ↓
9. 记录推送日志
```

## 🔍 日志输出

每轮 Job 输出：
- 拉取事件数、美国事件数、去重后候选数
- 选中的 event_key
- 三账户生成文案的字符数统计
- 三账户发送结果（sent/failed + reason）

示例日志：
```json
{
  "level": 30,
  "msg": "Running macro US tweet job...",
  "totalEvents": 45,
  "usaEventsCount": 12,
  "candidatesCount": 3,
  "eventKey": "abc123...",
  "calendarName": "Non-Farm Payrolls",
  "krLength": 187,
  "zhLength": 192,
  "enLength": 198,
  "results": {
    "accountA": "sent",
    "accountB": "sent",
    "accountC": "sent"
  }
}
```

## ⚠️ 注意事项

1. **API 端点**：CoinGlass API 端点 `/api/macro/calendar` 需要确认是否正确
2. **时间戳格式**：API 返回的时间戳可能是秒级或毫秒级，代码已兼容处理
3. **国家代码**：支持多种格式（USA/US/UNITED_STATES），统一映射为 USA
4. **字符统计**：使用 Twitter 字符统计口径（可能包含 emoji 等）
5. **错误处理**：任一账户失败不影响其他账户，仅记录日志

## 🧪 测试建议

1. **手动触发测试**：
   ```typescript
   // 在 macroUsTweetJob.service.ts 中添加测试方法
   await macroUsTweetJob.runJobOnce();
   ```

2. **验证去重**：
   - 运行一次 Job
   - 再次运行，确认不会重复推送同一事件

3. **验证字符限制**：
   - 生成超长推文，确认自动裁剪到 200 字符

4. **验证多账户**：
   - 确认三账户都能成功发布
   - 测试单个账户失败不影响其他账户

## 📝 配置说明

### 轮询间隔

默认：2 小时（`POLL_INTERVAL_MS = 2 * 60 * 60 * 1000`）

如需修改，在 `macroUsTweetJob.service.ts` 中调整：
```typescript
private readonly POLL_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 小时
```

### 时间窗口

默认：过去 6 小时 + 未来 24 小时

如需修改，在 `macroUsTweetJob.service.ts` 中调整：
```typescript
private readonly TIME_WINDOW_HOURS = { past: 6, future: 24 };
```

### 字符限制

默认：200 characters

如需修改，在 `macroUsTweetJob.service.ts` 中调整：
```typescript
private readonly MAX_TWEET_LENGTH = 200;
```

## ✅ 验收标准

- [x] 每 2 小时轮询一次
- [x] 仅推送美国事件
- [x] 每轮最多推 1 个 event_key
- [x] 三账户分别发 KR/ZH/EN 推文（各<=200字符）
- [x] 推文含 ICON + 时间 + ST + MT（必要时允许裁剪掉 MT，但 ST 必须保留）
- [x] 任一账户失败不影响其他账户
- [x] 不重复推同一 event_key（跨重启也不重复）
- [x] 无候选事件则不发推，仅记录日志

