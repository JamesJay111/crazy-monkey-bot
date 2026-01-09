# X OAuth 授权问题排查与解决方案

## ❌ 错误现象

**错误信息：** `ERR_CONNECTION_REFUSED` 或 `localhost refused to connect`

**原因：** OAuth Server 未运行或已停止

## ✅ 解决方案

### 方法 1: 使用启动脚本（推荐）

```bash
cd /Users/niyutong/Desktop/疯狂小猴子
./start-oauth.sh
```

**说明：**
- 脚本会自动检查并清理端口 8787
- 启动 OAuth Server
- 保持终端窗口打开

### 方法 2: 使用 npm 命令

```bash
cd /Users/niyutong/Desktop/疯狂小猴子
npm run oauth
```

### 方法 3: 手动启动

```bash
cd /Users/niyutong/Desktop/疯狂小猴子
node -r ts-node/register src/server/index.ts
```

## 🔍 验证 OAuth Server 是否运行

### 检查端口

```bash
lsof -ti:8787
```

如果有输出（PID），说明 Server 正在运行。

### 检查状态接口

```bash
curl http://localhost:8787/x/status
```

如果返回 JSON，说明 Server 正常运行。

### 访问授权页面

在浏览器中打开：
```
http://localhost:8787/x/auth
```

如果能看到授权页面，说明 Server 正常运行。

## 🚨 常见问题

### 问题 1: 端口被占用

**错误：** `Port 8787 is already in use`

**解决：**
```bash
# 停止占用端口的进程
lsof -ti:8787 | xargs kill -9

# 然后重新启动
./start-oauth.sh
```

### 问题 2: 授权链接过期

**错误：** `Invalid or expired state`

**原因：** 授权链接中的 `state` 参数已过期（约 5 分钟）

**解决：**
1. 重新生成授权链接
2. 或直接访问：`http://localhost:8787/x/auth`（自动生成新链接）

### 问题 3: 回调地址不匹配

**错误：** `Callback URI mismatch`

**解决：**
1. 检查 `.env` 文件中的 `X_REDIRECT_URI`
2. 确保与 Twitter Developer Portal 中设置的回调 URI 完全一致
3. 通常是：`http://localhost:8787/x/callback`

## 📝 完整授权流程

1. **启动 OAuth Server**
   ```bash
   ./start-oauth.sh
   ```

2. **生成授权链接**
   - 使用桌面上的 `X_OAuth_Authorize_URL_Fixed.txt` 文件
   - 或访问：`http://localhost:8787/x/auth`

3. **授权**
   - 在浏览器中打开授权链接
   - 确保已登录 Twitter B 账号
   - 点击"授权"按钮

4. **验证**
   - 授权成功后会自动跳转
   - Token 保存到 `./data/x_tokens.json`
   - 检查文件确认 token 已保存

## 🔧 快速修复命令

```bash
# 1. 停止旧进程
lsof -ti:8787 | xargs kill -9 2>/dev/null

# 2. 启动 OAuth Server
cd /Users/niyutong/Desktop/疯狂小猴子
./start-oauth.sh &

# 3. 等待 3 秒后验证
sleep 3
curl http://localhost:8787/x/status

# 4. 生成新授权链接（如果需要）
# 查看桌面上的 X_OAuth_Authorize_URL_Fixed.txt
```

## 💡 提示

- **保持 Server 运行：** 授权过程中必须保持 OAuth Server 运行
- **快速授权：** 授权链接有时效性，生成后尽快使用
- **永久 Token：** 授权时确保包含 `offline.access` scope，以获得 `refresh_token`
- **后台运行：** 可以使用 `nohup` 或 `screen` 让 Server 在后台运行

## ✅ 当前状态

- ✅ OAuth Server 已启动（端口 8787）
- ✅ 新的授权链接已生成（桌面上的 `X_OAuth_Authorize_URL_Fixed.txt`）
- ✅ 可以直接使用授权链接进行授权

