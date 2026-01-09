# GitHub 部署指南

本文档说明如何将项目部署到 GitHub，包括代码提交、文档管理和版本控制。

## 目录

1. [准备工作](#准备工作)
2. [代码提交](#代码提交)
3. [文档管理](#文档管理)
4. [版本标签](#版本标签)
5. [持续集成](#持续集成)

## 准备工作

### 1. 初始化 Git 仓库

如果项目还没有 Git 仓库：

```bash
git init
git add .
git commit -m "Initial commit: Macro news push system with detailed documentation"
```

### 2. 创建 GitHub 仓库

1. 在 GitHub 上创建新仓库
2. 添加远程仓库：

```bash
git remote add origin https://github.com/your-username/your-repo-name.git
git branch -M main
git push -u origin main
```

### 3. 配置 .gitignore

确保 `.gitignore` 文件包含以下内容：

```
# 依赖
node_modules/
dist/

# 环境变量
.env
.env.local
.env.*.local

# 日志
*.log
logs/
*.log.*

# 数据库
db/*.sqlite
db/*.db
*.db

# 数据文件
data/
cache/

# IDE
.vscode/
.idea/
*.swp
*.swo

# 系统文件
.DS_Store
Thumbs.db
```

## 代码提交

### 提交规范

使用以下提交信息格式：

```
<type>(<scope>): <subject>

<body>

<footer>
```

**类型 (type)**:
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `test`: 测试
- `chore`: 构建/工具链

**示例**:

```bash
# 新功能
git commit -m "feat(macro-news): add webhook push service with multi-language support"

# 文档更新
git commit -m "docs(macro-news): add detailed implementation documentation"

# 修复 bug
git commit -m "fix(coinglass): fix timestamp conversion for API v4.0"
```

### 提交步骤

1. **检查更改**:
```bash
git status
git diff
```

2. **添加文件**:
```bash
# 添加所有更改
git add .

# 或选择性添加
git add src/services/macroNewsWebhookPush.service.ts
git add docs/MACRO_NEWS_IMPLEMENTATION.md
```

3. **提交更改**:
```bash
git commit -m "feat(macro-news): implement webhook push service with detailed documentation"
```

4. **推送到 GitHub**:
```bash
git push origin main
```

## 文档管理

### 文档结构

```
docs/
├── README.md                          # 文档目录
├── MACRO_NEWS_IMPLEMENTATION.md      # 宏观新闻实现文档
├── COINGLASS_FIELD_MAPPING.md        # CoinGlass 字段映射文档
├── DEPLOYMENT.md                      # 部署文档
└── GITHUB_DEPLOYMENT.md              # GitHub 部署指南（本文档）
```

### 文档更新流程

1. **更新文档**:
```bash
# 编辑文档
vim docs/MACRO_NEWS_IMPLEMENTATION.md
```

2. **提交文档更改**:
```bash
git add docs/
git commit -m "docs: update macro news implementation documentation"
git push origin main
```

3. **验证文档格式**:
确保 Markdown 文档格式正确，可以使用以下工具：
- [Markdownlint](https://github.com/DavidAnson/markdownlint)
- [Markdown Preview](https://marketplace.visualstudio.com/items?itemName=shd101wyy.markdown-preview-enhanced)

## 版本标签

### 创建版本标签

```bash
# 创建标签
git tag -a v1.0.0 -m "Release version 1.0.0: Macro news push system"

# 推送标签
git push origin v1.0.0
```

### 版本号规范

使用 [语义化版本](https://semver.org/)：

- **主版本号 (MAJOR)**: 不兼容的 API 修改
- **次版本号 (MINOR)**: 向下兼容的功能性新增
- **修订号 (PATCH)**: 向下兼容的问题修正

**示例**:
- `v1.0.0`: 初始版本
- `v1.1.0`: 新增功能（如新增 Twitter 推送）
- `v1.1.1`: 修复 bug
- `v2.0.0`: 重大更新（如 API 重构）

## 持续集成

### GitHub Actions

创建 `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v3

    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'

    - name: Install dependencies
      run: npm ci

    - name: Run linter
      run: npm run lint

    - name: Run tests
      run: npm test

    - name: Build
      run: npm run build
```

### 代码检查

在提交前运行：

```bash
# 检查代码格式
npm run lint

# 运行测试
npm test

# 构建项目
npm run build
```

## 分支管理

### 主分支策略

- **main**: 生产环境代码，始终可部署
- **develop**: 开发分支，用于集成新功能
- **feature/***: 功能分支，用于开发新功能
- **fix/***: 修复分支，用于修复 bug

### 创建功能分支

```bash
# 创建并切换到新分支
git checkout -b feature/macro-news-webhook

# 开发完成后合并到主分支
git checkout main
git merge feature/macro-news-webhook
git push origin main
```

## Pull Request 流程

1. **创建 Pull Request**:
   - 在 GitHub 上创建 PR
   - 填写详细的描述，包括：
     - 功能说明
     - 实现方式
     - 测试结果
     - 相关文档链接

2. **代码审查**:
   - 确保代码符合规范
   - 检查文档是否更新
   - 验证测试是否通过

3. **合并 PR**:
   - 审查通过后合并
   - 删除功能分支

## 发布流程

### 1. 更新版本号

```bash
# 更新 package.json 中的版本号
npm version patch  # 或 minor, major
```

### 2. 更新 CHANGELOG.md

创建或更新 `CHANGELOG.md`:

```markdown
# Changelog

## [1.0.0] - 2024-01-09

### Added
- 宏观新闻 Webhook 实时推送服务
- Twitter 多账户推送功能
- 详细的实现文档和字段映射文档

### Fixed
- CoinGlass API v4.0 时间戳转换问题
- 字段映射错误

### Changed
- 更新 README.md，添加详细的功能说明
```

### 3. 创建 Release

在 GitHub 上创建 Release：

1. 进入仓库的 "Releases" 页面
2. 点击 "Create a new release"
3. 选择版本标签
4. 填写 Release 标题和描述
5. 上传构建产物（可选）

## 文档维护

### 文档更新检查清单

- [ ] 代码注释是否完整
- [ ] API 字段映射是否准确
- [ ] 实现步骤是否清晰
- [ ] 错误处理是否说明
- [ ] 示例代码是否可运行
- [ ] 相关链接是否有效

### 定期审查

建议每月审查一次文档：

1. 检查 API 文档是否有更新
2. 验证代码示例是否仍然有效
3. 更新过时的信息
4. 添加新的功能说明

## 常见问题

### Q1: 如何回滚到之前的版本？

```bash
# 查看提交历史
git log --oneline

# 回滚到指定提交
git reset --hard <commit-hash>

# 强制推送（谨慎使用）
git push origin main --force
```

### Q2: 如何合并多个提交？

```bash
# 交互式 rebase
git rebase -i HEAD~3

# 在编辑器中将 "pick" 改为 "squash" 或 "fixup"
```

### Q3: 如何处理冲突？

```bash
# 拉取最新代码
git pull origin main

# 解决冲突后
git add .
git commit -m "fix: resolve merge conflicts"
git push origin main
```

## 最佳实践

1. **频繁提交**: 小步快跑，频繁提交代码
2. **清晰描述**: 提交信息要清晰描述更改内容
3. **文档同步**: 代码更改时同步更新文档
4. **代码审查**: 重要更改前进行代码审查
5. **测试覆盖**: 确保新功能有测试覆盖

## 相关资源

- [Git 官方文档](https://git-scm.com/doc)
- [GitHub 文档](https://docs.github.com/)
- [语义化版本](https://semver.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
