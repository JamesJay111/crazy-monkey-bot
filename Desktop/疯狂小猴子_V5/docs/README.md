# 文档目录

本文档目录包含系统的详细实现文档和部署指南。

## 核心文档

### 1. [宏观新闻推送实现文档](MACRO_NEWS_IMPLEMENTATION.md)
详细的宏观新闻推送模块实现说明，包括：
- CoinGlass API 字段映射详解
- 服务实现步骤（10个步骤）
- 错误处理机制
- 性能优化建议
- 测试建议

### 2. [CoinGlass 字段映射文档](COINGLASS_FIELD_MAPPING.md)
完整的 CoinGlass API v4.0 字段映射说明，包括：
- 经济数据字段映射
- 财经事件字段映射
- 央行动态字段映射
- 新闻文章字段映射
- 快讯字段映射
- ETF 数据字段映射
- 合约数据字段映射

### 3. [部署文档](DEPLOYMENT.md)
详细的部署指南，包括：
- 环境要求
- 环境变量配置
- 数据库初始化
- 服务启动（开发/生产/Docker）
- 监控与日志
- 故障排查
- 性能优化
- 备份与恢复

## 快速开始

1. 阅读 [部署文档](DEPLOYMENT.md) 了解如何部署系统
2. 阅读 [宏观新闻推送实现文档](MACRO_NEWS_IMPLEMENTATION.md) 了解核心功能实现
3. 阅读 [CoinGlass 字段映射文档](COINGLASS_FIELD_MAPPING.md) 了解 API 集成细节

## 其他文档

- [ETF 推送实现文档](../ETF_IMPLEMENTATION.md) - ETF 资金流推送实现说明
- [OI 异动推送实现文档](../OI_ALERT_IMPLEMENTATION.md) - OI 异动推送实现说明
- [Twitter 自动推送实现文档](../TWITTER_AUTO_TWEET_IMPLEMENTATION.md) - Twitter 自动推送实现说明
