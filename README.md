# jsDelivr 镜像站

一个简洁高效的 jsDelivr 镜像站，基于 Vercel Edge Functions。
[点击查看如何使用](https://cdn.1008.site)

## 特性

- **安全防护**：支持设置仓库、站点黑白名单、文件类型和大小限制
- **性能优化**：智能缓存，自动压缩，完整 CORS 支持
- **简易配置**：集中配置，部署便捷


## 自己部署使用   

请[Frok本仓库](https://github.com/nmgliangwei/jsd/fork)，编辑[config.js](config.js) (可参考[config.js.example](config.js.example))，然后打开Vercel进行部署。

要使用镜像站，请将原始的 jsDelivr 链接如：
```
https://cdn.jsdelivr.net/npm/jquery@3.6.4/dist/jquery.min.js
```

替换为：
```
https://your-domain.vercel.app/npm/jquery@3.6.4/dist/jquery.min.js
``` 

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件
