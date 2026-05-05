export const CONFIG = {
    // 联系方式
    CONTACT: 'nmgliangwei@gmail.com',
    
    // 文件大小限制 (单位: MB, 0表示不限制)
    MAX_FILE_SIZE: 100,

    // 允许的文件扩展名 (空数组表示不限制文件类型)
    // ALLOWED_EXTENSIONS: [".js", ".css", ".json", ".txt", ".md", ".xml", ".svg", ".woff", ".woff2",],
    ALLOWED_EXTENSIONS: [],

    // 缓存设置
    CACHE_MAX_AGE: 24 * 60 * 60, // 24小时 (单位：秒)

    // 各类黑白名单模式: 'blacklist' | 'whitelist' | 'none' (每种类型独立控制)
    GITHUB_REPOS_MODE: 'whitelist',
    NPM_PACKAGES_MODE: 'none',
    SITES_MODE: 'none',

    // GitHub 仓库配置 (格式: 'owner/repo', 支持通配符 'owner/*')
    GITHUB_REPOS: {
        // 黑名单模式时使用 (支持通配符，如 'bad-user/*' 屏蔽该用户下所有仓库)
        blacklist: [
        ],
        // 白名单模式时使用 (支持通配符，如 'my-org/*' 允许该组织下所有仓库)
        whitelist: [
        ]
    },

    // npm 包配置 (格式: 'package-name' 或 '@scope/package', 支持通配符 '@scope/*')
    NPM_PACKAGES: {
        // 黑名单模式时使用 (支持通配符，如 '@bad-scope/*' 屏蔽该作用域下所有包)
        blacklist: [
        ],
        // 白名单模式时使用 (支持通配符，如 '@my-org/*' 允许该作用域下所有包)
        whitelist: [
        ]
    },

    // 站点访问控制 (格式: 'domain.com', 支持通配符 '*.domain.com')
    SITES: {
        // 黑名单模式时使用 (支持通配符，如 '*.bad-site.com' 屏蔽其所有子域名)
        blacklist: [
        ],
        // 白名单模式时使用 (支持通配符，如 '*.my-site.com' 允许其所有子域名)
        whitelist: [
        ]
    }
}
