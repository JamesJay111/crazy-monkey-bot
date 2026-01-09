# ETF 资金流向分析落盘功能实现文档

## 📋 功能概述

在现有 ETF 每日报告功能基础上，新增 DeepSeek AI 分析功能，每天自动生成两个文件：
1. **原始数据文件**：ETF 资金流原始数据
2. **分析文本文件**：DeepSeek 生成的研究员风格分析文本

## 🗂️ 文件清单

### 修改的文件

1. **`src/services/etfDailyReport.service.ts`**
   - 【新增】添加 `DeepSeekClient` 依赖（可选参数）
   - 【新增】创建 `/data/etf/raw/` 和 `/data/etf/analysis/` 目录
   - 【新增】`generateAndSaveAnalysis()` 方法：生成并保存 DeepSeek 分析
   - 【修改】`generateReport()` 方法：同时生成原始数据文件和分析文件
   - 【保留】Mac 桌面报告（兼容性）

2. **`src/bot/index.ts`**
   - 【修改】初始化 `ETFDailyReportService` 时传递 `deepseek` 客户端

3. **`scripts/testETFDailyReport.ts`**
   - 【更新】支持传递 DeepSeek API key 进行测试

## 🔧 核心功能说明

### 1. 文件目录结构

```
/data/etf/
  ├── raw/
  │   └── etf_flow_raw_YYYY-MM-DD.txt
  └── analysis/
      └── etf_flow_analysis_YYYY-MM-DD.txt
```

### 2. 文件命名规则

- **原始数据文件**：`etf_flow_raw_YYYY-MM-DD.txt`
- **分析文件**：`etf_flow_analysis_YYYY-MM-DD.txt`
- 日期格式：`YYYY-MM-DD`（基于北京时间）

### 3. 执行流程

```
1. 生成原始数据内容（buildReportContent）
   ↓
2. 保存到 Mac 桌面（兼容性，保留）
   ↓
3. 保存原始数据文件到 /data/etf/raw/
   ↓
4. 调用 DeepSeek API 生成分析文本
   ↓
5. 保存分析文件到 /data/etf/analysis/
```

### 4. DeepSeek 分析 Prompt

**System Prompt:**
```
你是一位专业的数据分析师，专注于加密货币 ETF 资金流向研究。你的任务是基于提供的 ETF 资金流数据，生成一段客观、专业的研究分析文本。

要求：
1. 使用研究员/数据分析师的风格，使用相对判断与缓冲语气
2. 分析资金流向趋势、主要 ETF 的变化、不同资产的表现差异
3. 不给出交易建议，不预测价格
4. 使用中文，自然流畅，逻辑清晰
5. 只输出分析文本本身，不包含标题、日期等元信息
```

**User Prompt:**
```
请基于以下 ETF 资金流数据（日期：{dateStr}），生成一段分析文本：

{rawContent}

请从以下角度进行分析：
- 整体资金流向趋势（净流入/流出规模）
- 各资产（BTC/ETH/SOL/XRP）的表现差异
- 主要 ETF 发行方的资金变化（如 BlackRock、Grayscale 等）
- 与前一周期的可能变化趋势（如果有数据对比）

请只输出分析文本，不要包含任何 JSON、Prompt 或日志信息。
```

### 5. 容错机制

- **DeepSeek 客户端未配置**：写入错误提示 "分析生成失败：DeepSeek 客户端未配置，请稍后重试"
- **DeepSeek API 调用失败**：写入错误提示 "分析生成失败，请稍后重试"
- **原始数据文件始终生成**：即使分析失败，原始数据文件也会正常生成

### 6. 文件内容规范

- **原始数据文件**：包含完整的 ETF 资金流数据（与桌面报告内容相同）
- **分析文件**：
  - 只包含分析文本本身
  - 不包含 JSON、Prompt、日志信息
  - UTF-8 编码
  - 如果生成失败，包含错误提示

## 📊 数据输入说明

DeepSeek 接收的输入数据包括：

1. **资产范围**：BTC、ETH、SOL、XRP（固定）
2. **数据维度**：
   - 每日净流入/净流出
   - 总流入/总流出
   - 最新价格
   - 主要 ETF 明细（24小时汇总）
   - 数据点数

3. **数据格式**：结构化的文本格式，包含：
   - 每个币种的资金流统计
   - ETF 明细（按 ticker 汇总）

## 🚀 使用方法

### 1. 自动执行

Bot 启动后，服务会自动启动。每天北京时间早上8点会自动生成：
- 原始数据文件：`/data/etf/raw/etf_flow_raw_YYYY-MM-DD.txt`
- 分析文件：`/data/etf/analysis/etf_flow_analysis_YYYY-MM-DD.txt`

### 2. 手动测试

运行测试脚本手动触发报告生成：

```bash
npx ts-node scripts/testETFDailyReport.ts
```

### 3. 查看生成的文件

```bash
# 查看原始数据文件
cat data/etf/raw/etf_flow_raw_2025-12-30.txt

# 查看分析文件
cat data/etf/analysis/etf_flow_analysis_2025-12-30.txt
```

## ⚙️ 配置说明

- **DeepSeek API Key**：从环境变量 `DEEPSEEK_API_KEY` 读取
- **文件编码**：UTF-8
- **执行时间**：每天北京时间早上8点（固定）
- **数据周期**：过去24小时

## 🔍 日志说明

服务启动时会记录：
- ETF 数据目录初始化状态
- DeepSeek 客户端是否可用

报告生成时会记录：
- 原始数据文件保存路径和大小
- 分析文件保存路径和大小
- DeepSeek API 调用状态（成功/失败）

## ✅ 验证方法

1. **检查文件是否生成**
   ```bash
   ls -lh data/etf/raw/
   ls -lh data/etf/analysis/
   ```

2. **检查文件内容**
   ```bash
   # 原始数据文件应包含完整的 ETF 数据
   head -20 data/etf/raw/etf_flow_raw_*.txt
   
   # 分析文件应包含分析文本或错误提示
   cat data/etf/analysis/etf_flow_analysis_*.txt
   ```

3. **检查日志**
   ```bash
   tail -f bot.log | grep -E "ETF|analysis|raw"
   ```

## 📝 注意事项

1. **DeepSeek API Key**：确保 `.env` 文件中配置了 `DEEPSEEK_API_KEY`
2. **目录权限**：确保 `./data/etf/` 目录有写入权限
3. **API 限流**：如果遇到 DeepSeek API 限流，会在日志中记录错误，但不会中断服务
4. **文件覆盖**：同一天多次生成会覆盖之前的文件（使用日期作为文件名）
5. **原子性**：原始数据文件和分析文件独立生成，分析失败不影响原始数据文件

## 🎯 实现细节

### 代码位置

- **主要逻辑**：`src/services/etfDailyReport.service.ts`
  - 第 177-245 行：`generateAndSaveAnalysis()` 方法
  - 第 135-175 行：`generateReport()` 方法（已修改）

- **初始化**：`src/bot/index.ts`
  - 第 83 行：传递 `deepseek` 客户端

### 关键实现点

1. **目录自动创建**：构造函数中检查并创建必要的目录
2. **DeepSeek 可选**：`deepseek` 参数为可选，未配置时写入错误提示
3. **错误隔离**：使用 try-catch 确保分析失败不影响原始数据文件生成
4. **文件编码**：所有文件使用 UTF-8 编码

## ✅ 完成状态

- ✅ 原始数据文件生成（`/data/etf/raw/`）
- ✅ 分析文件生成（`/data/etf/analysis/`）
- ✅ DeepSeek 分析功能集成
- ✅ 容错机制实现
- ✅ 目录自动创建
- ✅ 文件命名规范
- ✅ Bot 集成完成

所有功能已实现并集成到 Bot 中！



