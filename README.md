<div align="center">

# jsDelivr 镜像站

[![License](https://img.shields.io/github/license/nmgliangwei/jsd?style=flat-square)](LICENSE)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/nmgliangwei/jsd/list-request.yml?label=名单变更&style=flat-square)](https://github.com/nmgliangwei/jsd/actions)
[![GitHub stars](https://img.shields.io/github/stars/nmgliangwei/jsd?style=flat-square)](https://github.com/nmgliangwei/jsd/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/nmgliangwei/jsd?style=flat-square)](https://github.com/nmgliangwei/jsd/forks)
[![GitHub issues](https://img.shields.io/github/issues/nmgliangwei/jsd?style=flat-square)](https://github.com/nmgliangwei/jsd/issues)
[![Deploy with Vercel](https://img.shields.io/badge/Vercel-一键部署-000?style=flat-square&logo=vercel)](https://vercel.com/new/clone?repository-url=https://github.com/nmgliangwei/jsd)
[![Deploy to Cloudflare](https://img.shields.io/badge/Cloudflare-一键部署-F38020?style=flat-square&logo=cloudflare)](https://deploy.workers.cloudflare.com/?url=https://github.com/nmgliangwei/jsd)

一个简洁高效的 jsDelivr 镜像站，同时支持 **Vercel Edge Functions** 和 **Cloudflare Workers** 双平台部署。

[在线演示](https://cdn.1008.site) · [使用文档](#使用方法) · [自行部署](#部署方式)

</div>

## 特性

- **双平台支持**：同时兼容 Vercel 和 Cloudflare Workers，按需选择部署平台
- **安全防护**：支持仓库/站点黑白名单、文件类型和大小限制
- **性能优化**：智能缓存、自动压缩、完整 CORS 支持
- **GitHub 大文件**：突破 jsDelivr 限制，支持最大 100MB 的 GitHub 文件下载
- **回退机制**：jsDelivr 不可用时自动回退到 GitHub Raw / npm Registry
- **名单管理**：通过 GitHub Issue 自动处理黑白名单变更申请
- **简易配置**：集中配置，Fork 即用

## 使用方法

将原始 jsDelivr 链接中的 `cdn.jsdelivr.net` 替换为你的镜像站域名即可：

```diff
- https://cdn.jsdelivr.net/npm/jquery@3.6.4/dist/jquery.min.js
+ https://your-domain.vercel.app/npm/jquery@3.6.4/dist/jquery.min.js
```

### 支持的路径格式

| 类型 | 路径格式 | 示例 |
|------|---------|------|
| npm 包 | `/npm/包名@版本/路径` | `/npm/jquery@3.6.4/dist/jquery.min.js` |
| GitHub 仓库 | `/gh/用户/仓库@分支/路径` | `/gh/nmgliangwei/jsd@main/README.md` |
| GitHub Releases | `/gh-release/用户/仓库/标签/文件名` | `/gh-release/vercel/vercel/v1.0.0/vercel.tgz` |

## 部署方式

### 方式一：Vercel 部署（推荐）

1. [Fork 本仓库](https://github.com/nmgliangwei/jsd/fork)
2. 编辑 [config.js](config.js)（参考 [config.js.example](config.js.example)）
3. 点击部署：[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/nmgliangwei/jsd)

### 方式二：Cloudflare Workers 部署

1. [Fork 本仓库](https://github.com/nmgliangwei/jsd/fork)
2. 编辑 [config.js](config.js)（参考 [config.js.example](config.js.example)）
3. 点击部署：[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nmgliangwei/jsd)

或手动部署：
```bash
npm install -g wrangler
wrangler deploy
```

### 方式三：Nginx 反向代理

使用自己的服务器，参考 [nginx.conf](nginx.conf) 进行配置。

> **注意：** Nginx 为纯反向代理模式，以下功能不可用：
>
> | 功能 | Vercel / CF Workers | Nginx |
> |------|:---:|:---:|
> | 仓库/站点黑白名单 | ✅ | ❌ |
> | 文件类型过滤 | ✅ | ❌ |
> | GitHub Raw / npm Registry 回退 | ✅ | ❌ |
> | GitHub Releases 下载 (`/gh-release/`) | ✅ | ❌ |
> | 配置查询 API (`/api/config`) | ✅ | ❌ |
> | 来源站点 (Referer) 控制 | ✅ | ❌ |
> | 动态文件大小限制 | ✅ | ✅ |

## 配置说明

所有配置集中在 [config.js](config.js) 中，部署前请参考 [config.js.example](config.js.example) 进行修改：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `MAX_FILE_SIZE` | 文件大小限制 (MB)，0 为不限 | `5` |
| `CACHE_MAX_AGE` | 缓存时间 (秒) | `86400` (24h) |
| `EXTENSIONS_MODE` | 文件扩展名模式：`blacklist` / `whitelist` / `none` | `whitelist` |
| `GITHUB_REPOS_MODE` | GitHub 仓库模式：`blacklist` / `whitelist` / `none` | `blacklist` |
| `NPM_PACKAGES_MODE` | npm 包模式：`blacklist` / `whitelist` / `none` | `none` |
| `SITES_MODE` | 站点访问控制：`blacklist` / `whitelist` / `none` | `whitelist` |

## 项目结构

```
jsd/
├── api/                  # Vercel Edge Functions
│   ├── proxy.js          # 代理核心逻辑
│   └── config.js         # 配置查询 API
├── css/                  # 页面样式
├── config.js             # 站点配置（部署前需修改）
├── index.html            # 首页
├── worker.js             # Cloudflare Workers 入口
├── vercel.json           # Vercel 部署配置
├── wrangler.jsonc        # Cloudflare Workers 部署配置
└── nginx.conf            # Nginx 反代配置参考
```

## 许可证

[MIT License](LICENSE) © 2026 [nmgliangwei](https://github.com/nmgliangwei)
