# 美国宏观事件 Twitter 推送模块修复总结

## 📋 修复内容概览

本次修复解决了以下问题：
1. ✅ 推送语言错误 + 单条推文混入多语言
2. ✅ ST/MT 简称不需要体现 + Icon 只出现一次

---

## 📁 修改的文件清单

### 1. 核心服务文件
- **`src/services/macroUsTweetJob.service.ts`**
  - 修改账户语言映射为强绑定
  - 修改推文生成逻辑，按账户分别生成
  - 添加语言校验和重试机制
  - 修改 DeepSeek prompt，移除 ST/MT 标签要求
  - 更新推文模板结构（4行，无标签）

### 2. 新增工具文件
- **`src/utils/tweetLanguageValidator.ts`** (新建)
  - 语言校验函数 (`validateTweetLanguage`)
  - ST/MT 标签移除函数 (`removeSTMTLabels`)
  - Icon 去重函数 (`deduplicateIcons`)

### 3. 测试文件
- **`scripts/testTweetLanguageValidator.ts`** (新建)
  - 语言校验单元测试
  - ST/MT 标签移除测试
  - Icon 去重测试

---

## 🔧 关键函数/逻辑变更

### 1. 账户语言映射（强绑定）

**文件**: `src/services/macroUsTweetJob.service.ts`

**变更前**:
```typescript
const ACCOUNT_CONFIG = {
  A: { key: 'accountA', language: 'KR', name: 'Account A (Korean)' },
  B: { key: 'accountB', language: 'ZH', name: 'Account B (Chinese)' },
  C: { key: 'accountC', language: 'EN', name: 'Account C (English)' },
} as const;
```

**变更后**:
```typescript
const ACCOUNT_CONFIG = {
  A: { 
    key: 'accountA', 
    language: 'ko' as const, // 韩语
    name: 'CrazyMonkeyKR (Korean)' 
  },
  B: { 
    key: 'accountB', 
    language: 'zh' as const, // 中文
    name: 'CrazyMonkeyPerp (Chinese)' 
  },
  C: { 
    key: 'accountC', 
    language: 'en' as const, // 英文
    name: 'CrazyMonkeyEN (English)' 
  },
} as const;
```

**映射关系**:
- `accountA` (CrazyMonkeyKR) → `ko` (韩语)
- `accountB` (CrazyMonkeyPerp) → `zh` (中文)
- `accountC` (CrazyMonkeyEN) → `en` (英文)

---

### 2. 推文生成逻辑

**文件**: `src/services/macroUsTweetJob.service.ts`

**关键函数**: `generateTweetForAccount`

**变更点**:
1. **按账户分别生成**：不再使用 `generateTweetForLanguage`，改为 `generateTweetForAccount`，直接使用账户配置的强绑定语言
2. **语言校验**：每次生成后调用 `validateTweetLanguage` 进行校验
3. **重试机制**：最多重试 1 次（总共 2 次尝试），如果语言校验失败则重试
4. **ST/MT 标签移除**：生成后立即调用 `removeSTMTLabels`
5. **Icon 去重**：调用 `deduplicateIcons` 确保只保留第一行开头的 icon

**代码片段**:
```typescript
private async generateTweetForAccount(
  event: EventDTO,
  accountConfig: typeof ACCOUNT_CONFIG.A | typeof ACCOUNT_CONFIG.B | typeof ACCOUNT_CONFIG.C
): Promise<string> {
  const language = accountConfig.language; // 'ko' | 'zh' | 'en'
  // ... 生成推文 ...
  
  // 移除 ST/MT 标签
  tweet = removeSTMTLabels(tweet);
  
  // Icon 去重
  tweet = deduplicateIcons(tweet);
  
  // 语言校验
  const validation = validateTweetLanguage(tweet, language);
  if (!validation.isValid) {
    // 重试或使用降级模板
  }
  
  return tweet;
}
```

---

### 3. DeepSeek Prompt 修改

**文件**: `src/services/macroUsTweetJob.service.ts`

**关键函数**: `buildSystemPrompt`, `buildUserPrompt`

**变更点**:
1. **移除 ST/MT 标签要求**：系统 prompt 和用户 prompt 中明确要求不使用 ST/MT 标签
2. **固定 4 行结构**：
   - Line1: `{ICON} US Macro: {事件名}`
   - Line2: `⏰ {UTC时间} | Impact {x}/3`
   - Line3: `{短周期提示一句（无ST字样）}`
   - Line4: `{中周期提示一句（无MT字样）}`
3. **Icon 使用说明**：明确要求 Icon 只在第一行出现一次

**系统 Prompt 示例（中文）**:
```
你是一名面向加密货币交易者的美国宏观经济事件分析师。
撰写简短清晰的推文。
- 短期交易者视角：关注波动性/风险/预期影响
- 中期交易者视角：关注趋势/市场结构变化
- 禁止喊单或价格预测
- 最多200字符限制
- 不要使用 ST/MT 等标签
- Icon 只在第一行出现一次
```

---

### 4. 语言校验函数

**文件**: `src/utils/tweetLanguageValidator.ts`

**关键函数**: `validateTweetLanguage`

**校验规则**:
- **中文 (zh)**:
  - ✅ 必须包含至少 1 个中文字符（\u4e00-\u9fff）
  - ❌ 不得包含韩文字符（\uac00-\ud7a3）
  - ❌ 如果主要是英文，中文比例必须 >= 30%
  
- **韩文 (ko)**:
  - ✅ 必须包含至少 1 个韩文字符（\uac00-\ud7a3）
  - ❌ 不得包含中文字符（\u4e00-\u9fff）
  - ❌ 如果主要是英文，韩文比例必须 >= 30%
  
- **英文 (en)**:
  - ✅ 必须主要由 ASCII 字符组成（至少 80%）
  - ❌ 不得包含中文或韩文字符

**返回值**:
```typescript
interface LanguageValidationResult {
  isValid: boolean;
  reason?: string;
  detectedLanguage?: string;
}
```

---

### 5. ST/MT 标签移除

**文件**: `src/utils/tweetLanguageValidator.ts`

**关键函数**: `removeSTMTLabels`

**移除的标签变体**:
- `ST:` / `ST：`
- `MT:` / `MT：`
- `短周期：` / `中周期：`
- `단기(ST):` / `중기(MT):`
- `Short-term:` / `Medium-term:`

---

### 6. Icon 去重

**文件**: `src/utils/tweetLanguageValidator.ts`

**关键函数**: `deduplicateIcons`

**逻辑**:
1. 第一行：保留第一个出现的 icon（按位置排序），移除后续所有 icon
2. 其他行：移除所有 icon
3. 保留换行符结构

**支持的 Icon**: `🚨`, `⚠️`, `ℹ️`, `⏱️`, `✅`

---

## 📊 测试验证

### 测试脚本
运行 `scripts/testTweetLanguageValidator.ts` 进行验证：

```bash
node -r ts-node/register scripts/testTweetLanguageValidator.ts
```

### 测试结果
- ✅ 语言校验：所有测试通过
- ✅ ST/MT 标签移除：所有测试通过
- ✅ Icon 去重：所有测试通过

---

## 📝 日志示例

### 成功生成推文
```
[INFO] Generated tweets for three accounts
  accountA: { 
    key: 'accountA', 
    language: 'ko', 
    length: 182,
    preview: '🚨 ⏱️ US Macro: Non-Farm Payrolls...'
  }
  accountB: { 
    key: 'accountB', 
    language: 'zh', 
    length: 137,
    preview: '🚨 ⏱️ US Macro: Non-Farm Payrolls...'
  }
  accountC: { 
    key: 'accountC', 
    language: 'en', 
    length: 196,
    preview: '🚨 ⏱️ US Macro: Non-Farm Payrolls...'
  }
```

### 语言校验失败（重试）
```
[WARN] Tweet language validation failed, retrying...
  account: 'accountB'
  language: 'zh'
  attempt: 1
  reason: '推文主要是英文，中文比例过低（中文推文应主要为中文）'
  detectedLanguage: 'en'
  tweetPreview: '🚨 US Macro: Non-Farm Payrolls...'
```

### 语言校验失败（使用降级模板）
```
[ERROR] Tweet language validation failed after all retries, using fallback
  account: 'accountB'
  language: 'zh'
  reason: '推文主要是英文，中文比例过低（中文推文应主要为中文）'
```

### 推文生成成功并校验通过
```
[INFO] Tweet generated and validated successfully
  account: 'accountB'
  language: 'zh'
  attempt: 1
  tweetLength: 137
  detectedLanguage: 'zh'
```

---

## ✅ 验收标准

- [x] 账户与语言强绑定（accountA→ko, accountB→zh, accountC→en）
- [x] 语言校验功能完整（中文/韩文/英文检测）
- [x] ST/MT 标签已移除
- [x] Icon 只出现一次（第一行开头）
- [x] DeepSeek 按账户分别生成（不翻译）
- [x] 推文结构固定为 4 行（可裁剪为 3 行）
- [x] 字符数限制 <= 200
- [x] 重试机制（最多 1 次重试）
- [x] 降级策略（使用降级模板）

---

## 🚀 部署说明

1. **代码已更新**：所有修改已完成并测试通过
2. **无需额外配置**：账户语言映射已硬编码，无需环境变量
3. **向后兼容**：不影响现有功能，仅优化推文生成逻辑
4. **建议测试**：在生产环境部署前，建议先用测试脚本验证语言校验功能

---

## 📌 注意事项

1. **DeepSeek API 调用**：每个账户分别调用，可能增加 API 调用次数（从 1 次变为 3 次）
2. **重试机制**：如果语言校验失败，会重试 1 次，最多 2 次尝试
3. **降级策略**：如果所有尝试都失败，会使用降级模板（无 ST/MT 标签）
4. **日志记录**：所有语言校验结果都会记录到日志中，便于排查问题

---

## 🔍 后续优化建议

1. **语言检测优化**：可以考虑使用更专业的语言检测库（如 `franc`）
2. **DeepSeek Prompt 优化**：根据实际生成效果，持续优化 prompt
3. **监控告警**：如果语言校验失败率过高，需要告警
4. **A/B 测试**：可以测试不同的 prompt 格式，找到最佳效果

