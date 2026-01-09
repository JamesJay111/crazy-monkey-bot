# 如何获取 Twitter Consumer Key 和 Consumer Secret

## 📋 获取步骤

### 步骤 1: 访问 Twitter Developer Portal

1. 打开浏览器，访问：
   ```
   https://developer.twitter.com/en/portal/dashboard
   ```

2. 使用你的 **Twitter B 账号** 登录

### 步骤 2: 找到你的 App

1. 登录后，你会看到项目列表
2. 找到你的项目，点击进入
3. 在项目详情页中，找到你的 App **"Jackon AI Agent"**
4. 点击进入 App 详情页

### 步骤 3: 查看 Keys and Tokens

1. 在 App 详情页中，找到左侧菜单或顶部导航
2. 点击 **"Keys and tokens"** 或 **"Keys and tokens"** 选项卡
3. 你会看到以下几个部分：
   - **Consumer Keys** (这就是我们需要的)
   - **Authentication Tokens** (OAuth 2.0 相关)
   - **Access Token and Secret** (OAuth 1.0a 相关，可选)

### 步骤 4: 获取 Consumer Keys

在 **"Consumer Keys"** 部分，你会看到：

1. **API Key** (这就是 Consumer Key)
   - 格式类似：`NjVxekZ3NWZJSFdFQ29IdlBmcjc6MTpjaQ`
   - 点击 **"Reveal"** 或 **"Show"** 按钮查看完整内容

2. **API Secret Key** (这就是 Consumer Secret)
   - 格式类似：`sXJDqKGFMFVDLcBCFVWMiCW5RLJrmsOjBUCM_1mNPoeKL7501Y`
   - 点击 **"Reveal"** 或 **"Show"** 按钮查看完整内容
   - ⚠️ **注意：** 如果之前没有保存，可能需要重新生成

### 步骤 5: 复制并保存

1. 复制 **API Key** (Consumer Key)
2. 复制 **API Secret Key** (Consumer Secret)
3. **重要：** 保存到安全的地方，这些信息只会显示一次（如果重新生成）

## 🔍 如果找不到 "Keys and tokens"

### 可能的位置：

1. **Settings 选项卡**
   - 进入 App 后，点击 **"Settings"** 选项卡
   - 在设置页面中查找 **"Keys and tokens"** 部分

2. **App Details 页面**
   - 在 App 详情页的顶部或侧边栏
   - 查找 **"Keys"**、**"Tokens"** 或 **"Credentials"** 相关链接

3. **Developer Portal 导航**
   - 在左侧导航菜单中查找
   - 可能在 **"Apps"** → **"Your App"** → **"Keys and tokens"**

## ⚠️ 注意事项

1. **API Secret Key 只显示一次**
   - 如果之前没有保存，需要点击 **"Regenerate"** 重新生成
   - 重新生成后，旧的 Secret 将失效

2. **安全提示**
   - 不要将 Consumer Key 和 Secret 分享给他人
   - 不要提交到 Git 仓库
   - 保存在 `.env` 文件中（已在 `.gitignore` 中）

3. **如果 App 是新创建的**
   - 可能需要等待几分钟才能看到 Keys
   - 或者需要完成 App 的设置流程

## 📝 获取后的操作

获取到 Consumer Key 和 Consumer Secret 后：

1. 告诉我这两个值（或直接添加到 `.env` 文件）
2. 我会帮你实现 OAuth 1.0a 授权流程
3. 更新代码以使用 OAuth 1.0a 发推

## 🆘 如果仍然找不到

如果按照以上步骤仍然找不到 Consumer Keys，可能的原因：

1. **App 类型不支持 OAuth 1.0a**
   - 检查 App Type 是否是 "Web App, Automated App or Bot"
   - OAuth 1.0a 需要特定的 App 类型

2. **需要启用 OAuth 1.0a**
   - 在 App Settings 中查找 OAuth 1.0a 相关设置
   - 确保 OAuth 1.0a 已启用

3. **联系 Twitter 支持**
   - 如果所有设置都正确但仍然找不到
   - 可能需要联系 Twitter 支持：https://developer.twitter.com/en/support

## 📸 参考位置

在 Twitter Developer Portal 中，Consumer Keys 通常位于：

```
Developer Portal
  └── Your Project
      └── Your App (Jackon AI Agent)
          └── Keys and tokens (选项卡)
              └── Consumer Keys
                  ├── API Key (Consumer Key)
                  └── API Secret Key (Consumer Secret)
```

## 💡 提示

- Consumer Key 和 Consumer Secret 是 OAuth 1.0a 必需的
- 这些信息用于生成 OAuth 签名
- 与 OAuth 2.0 的 Client ID 和 Client Secret 不同

