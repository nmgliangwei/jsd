export const CONFIG = {
    // 联系方式
    CONTACT: 'nmgliangwei@gmail.com',
    
    // 文件大小限制 (单位: MB, 0表示不限制)
    MAX_FILE_SIZE: 50,

    // 允许的文件扩展名 (空数组表示不限制文件类型)
    // ALLOWED_EXTENSIONS: [".js", ".css", ".json", ".txt", ".md", ".xml", ".svg", ".woff", ".woff2",],
    ALLOWED_EXTENSIONS: [],

    // 缓存设置
    CACHE_MAX_AGE: 24 * 60 * 60, // 24小时 (单位：秒)

    // 黑白名单模式: 'blacklist' | 'whitelist' | 'none'
    LIST_MODE: 'none',

    // GitHub 仓库配置 (格式: 'owner/repo')
    GITHUB_REPOS: {
        // 黑名单模式时使用 (只允许非黑名单仓库)
        blacklist: [
        ],
        // 白名单模式时使用 (只允许这些仓库)
        whitelist: [
        ]
    },

    // npm 包配置 (格式: 'package-name')
    NPM_PACKAGES: {
        // 黑名单模式时使用 (只允许非黑名单包)
        blacklist: [
        ],
        // 白名单模式时使用 (只允许这些包)
        whitelist: [
        ]
    },

    // 站点访问控制
    SITES: {
        // 黑名单模式时使用 (只允许非黑名单站点)
        blacklist: [
        ],
        // 白名单模式时使用 (只允许这些站点引用)
        whitelist: [
        ]
    }
}
