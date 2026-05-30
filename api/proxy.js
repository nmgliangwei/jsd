import { CONFIG } from '../config.js'

export const config = {
  runtime: 'edge',
}

// ============================================================================
// 错误缓存: 缓存上游4xx错误，避免重复请求打上游
// 使用 Map 存储，key 为请求路径，value 为 { status, timestamp }
// ============================================================================
const errorCache = new Map()
const ERROR_CACHE_MAX_SIZE = 5000 // 防止内存泄漏

function getErrorCache(path) {
  if (CONFIG.ERROR_CACHE_TTL <= 0) return null
  const entry = errorCache.get(path)
  if (!entry) return null
  // 过期清理
  if (Date.now() - entry.timestamp > CONFIG.ERROR_CACHE_TTL * 1000) {
    errorCache.delete(path)
    return null
  }
  return entry
}

function setErrorCache(path, status) {
  if (CONFIG.ERROR_CACHE_TTL <= 0) return
  // 防止缓存过大，超过上限时清除一半旧条目
  if (errorCache.size >= ERROR_CACHE_MAX_SIZE) {
    const keys = [...errorCache.keys()]
    const half = Math.floor(keys.length / 2)
    for (let i = 0; i < half; i++) {
      errorCache.delete(keys[i])
    }
  }
  errorCache.set(path, { status, timestamp: Date.now() })
}

// ============================================================================
// 请求限流: 基于IP的滑动窗口计数器
// 使用 Map 存储，key 为 IP，value 为 { count, startTime }
// ============================================================================
const rateLimitMap = new Map()
const RATE_LIMIT_MAX_ENTRIES = 10000 // 防止内存泄漏

function getClientIP(request) {
  // Cloudflare Workers 使用 cf-connecting-ip
  // Vercel Edge 使用 x-forwarded-for 或 x-real-ip
  return request.headers.get('cf-connecting-ip') ||
         request.headers.get('x-real-ip') ||
         (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
         'unknown'
}

function checkRateLimit(ip) {
  if (CONFIG.RATE_LIMIT_MAX_REQUESTS <= 0) return true

  const now = Date.now()
  const windowMs = CONFIG.RATE_LIMIT_WINDOW * 1000
  let entry = rateLimitMap.get(ip)

  // 窗口过期，重置计数
  if (!entry || (now - entry.startTime) > windowMs) {
    rateLimitMap.set(ip, { count: 1, startTime: now })

    // 防止 Map 过大，超过上限时清除过期条目或最旧条目
    if (rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
      const cutoff = now - windowMs
      for (const [key, val] of rateLimitMap) {
        if (val.startTime < cutoff) rateLimitMap.delete(key)
      }
      // 如果清理后仍然过大，删除一半
      if (rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
        const keys = [...rateLimitMap.keys()]
        const half = Math.floor(keys.length / 2)
        for (let i = 0; i < half; i++) {
          rateLimitMap.delete(keys[i])
        }
      }
    }
    return true
  }

  entry.count++
  return entry.count <= CONFIG.RATE_LIMIT_MAX_REQUESTS
}

// ============================================================================
// 路径验证: 拒绝明显无效的CDN路径，避免无意义请求打上游
//
// 策略: 不用白名单（容易漏掉 jsDelivr 新增路径如 /combine/ /esm/ /+ 等），
//       而是拦截"确定不是CDN路径"的请求:
//       1. 以点开头的隐藏路径 (如 /.env, /.git/config)
//       2. 常见攻击探测路径 (如 /wp-admin, /phpmyadmin, /admin)
//
//       对其他路径一律放行，因为:
//       - jsDelivr 路径格式多样 (/npm/..., /gh/..., /wp/..., /combine/..., /esm/..., /+...)
//       - 单层路径如 /aws-config.js 也是可能的（虽然少见）
//       - 无法穷举所有合法前缀，且 jsDelivr 可能新增路径格式
//       - 即使打了错误的请求，错误缓存会在第2层兜底，不会重复打上游
//
//       特殊放行: 根路径 / 和 /index.html 用于首页
// ============================================================================
function isValidCDNPath(pathname) {
  // 根路径和首页放行
  if (pathname === '/' || pathname === '/index.html') return true

  // 隐藏路径 (/.env, /.git/config, /.htaccess, /.DS_Store 等) → 拦截
  // 这些永远是攻击探测，不是合法CDN请求
  if (pathname.startsWith('/.')) return false

  // 常见攻击探测路径前缀
  const blockedPrefixes = [
    '/wp-admin', '/wp-login', '/wp-content/uploads',
    '/phpmyadmin', '/pma',
    '/admin', '/administrator', '/manager',
    '/server-status', '/server-info',
    '/cgi-bin/', '/fcgi-bin/',
  ]
  for (const prefix of blockedPrefixes) {
    if (pathname.startsWith(prefix)) return false
  }

  return true
}

// 检查文件扩展名是否被允许
function isAllowedFileType(url) {
  if (CONFIG.EXTENSIONS_MODE === 'none') return true

  const pathname = new URL(url).pathname
  const extension = pathname.substring(pathname.lastIndexOf('.')).toLowerCase()

  // 如果没有扩展名，允许通过（可能是目录或API请求）
  if (!extension || extension === pathname) return true

  if (CONFIG.EXTENSIONS_MODE === 'whitelist') {
    return CONFIG.EXTENSIONS_WHITELIST.includes(extension)
  }

  if (CONFIG.EXTENSIONS_MODE === 'blacklist') {
    return !CONFIG.EXTENSIONS_BLACKLIST.includes(extension)
  }

  return true
}

// 从URL中提取GitHub仓库信息
function extractGitHubRepo(url) {
  try {
    const pathname = new URL(url).pathname
    const match = pathname.match(/^\/(gh|github)\/([^\/]+)\/([^\/]+)/)
    if (match) {
      return `${match[2]}/${match[3].split('@')[0]}`
    }
  } catch (e) {
    // URL解析失败
  }
  return null
}

// 从URL中提取npm包信息
function extractNpmPackage(url) {
  try {
    const pathname = new URL(url).pathname
    const match = pathname.match(/^\/npm\/([^@\/]+)/)
    if (match) {
      return match[1]
    }
  } catch (e) {
    // URL解析失败
  }
  return null
}

// 通配符匹配: owner/* (GitHub), @scope/* (npm), *.domain (站点)
function matchWithWildcard(item, list) {
  return list.some(entry => {
    const itemLower = item.toLowerCase()
    const entryLower = entry.toLowerCase()

    if (entryLower.endsWith('/*')) {
      const prefix = entryLower.slice(0, -1)
      return itemLower.startsWith(prefix)
    }

    if (entryLower.startsWith('*.')) {
      const domain = entryLower.slice(1) // '.example.com'
      return itemLower.endsWith(domain)
    }

    return itemLower === entryLower
  })
}

// 检查GitHub仓库是否被允许 (支持 owner/* 通配)
function isGitHubRepoAllowed(repo) {
  if (!repo || CONFIG.GITHUB_REPOS_MODE === 'none') return true

  if (CONFIG.GITHUB_REPOS_MODE === 'blacklist') {
    return !matchWithWildcard(repo, CONFIG.GITHUB_REPOS.blacklist)
  } else if (CONFIG.GITHUB_REPOS_MODE === 'whitelist') {
    return matchWithWildcard(repo, CONFIG.GITHUB_REPOS.whitelist)
  }

  return true
}

// 检查npm包是否被允许 (支持 @scope/* 通配)
function isNpmPackageAllowed(packageName) {
  if (!packageName || CONFIG.NPM_PACKAGES_MODE === 'none') return true

  if (CONFIG.NPM_PACKAGES_MODE === 'blacklist') {
    return !matchWithWildcard(packageName, CONFIG.NPM_PACKAGES.blacklist)
  } else if (CONFIG.NPM_PACKAGES_MODE === 'whitelist') {
    return matchWithWildcard(packageName, CONFIG.NPM_PACKAGES.whitelist)
  }

  return true
}

// 检查referer是否被允许 (支持 *.domain 通配)
function isRefererAllowed(referer) {
  if (!referer || CONFIG.SITES_MODE === 'none') return true

  try {
    const refererHost = new URL(referer).hostname.toLowerCase()

    if (CONFIG.SITES_MODE === 'blacklist') {
      return !matchWithWildcard(refererHost, CONFIG.SITES.blacklist)
    } else if (CONFIG.SITES_MODE === 'whitelist') {
      return matchWithWildcard(refererHost, CONFIG.SITES.whitelist)
    }
  } catch (e) {
    return true
  }

  return true
}

// 生成错误响应
function createErrorResponse(message, status = 403) {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    }
  })
}

export default async function handler(request) {
  try {
    const url = new URL(request.url)

    // 处理根路径请求，返回主页
    if (url.pathname === '/') {
      return Response.redirect(new URL('/index.html', request.url), 302)
    }

    // ---- 第1层防护: 路径验证 ----
    // 拒绝不匹配任何已知CDN路径模式的请求，直接返回404，不请求上游
    if (!isValidCDNPath(url.pathname)) {
      return createErrorResponse('无效的CDN路径', 404)
    }

    // ---- 第2层防护: 错误缓存 ----
    // 如果该路径近期曾导致上游4xx错误，直接返回缓存的状态码，不再请求上游
    const cachedError = getErrorCache(url.pathname)
    if (cachedError) {
      return createErrorResponse(`上游服务器错误: ${cachedError.status} (cached)`, cachedError.status)
    }

    // ---- 第3层防护: IP限流 ----
    const clientIP = getClientIP(request)
    if (!checkRateLimit(clientIP)) {
      return createErrorResponse('请求过于频繁，请稍后再试', 429)
    }

    // GitHub Releases 下载路径，直接代理到 GitHub
    if (/^\/gh-release\//.test(url.pathname)) {
      return fetchFromGitHubRelease(request, url.pathname)
    }

    // 构建目标URL
    const targetPath = url.pathname + url.search
    const targetUrl = `https://cdn.jsdelivr.net${targetPath}`

    // 如果所有类别都为无限制模式，跳过大部分检查
    if (CONFIG.GITHUB_REPOS_MODE === 'none' &&
        CONFIG.NPM_PACKAGES_MODE === 'none' &&
        CONFIG.SITES_MODE === 'none' &&
        CONFIG.EXTENSIONS_MODE === 'none' &&
        CONFIG.MAX_FILE_SIZE === 0) {
      return createFastProxy(request, targetUrl, url.pathname)
    }

    // 检查文件类型
    if (!isAllowedFileType(targetUrl)) {
      if (CONFIG.EXTENSIONS_MODE === 'whitelist') {
        return createErrorResponse('文件类型不被允许，允许类型：' + CONFIG.EXTENSIONS_WHITELIST.join(', '), 415)
      }
      return createErrorResponse('文件类型被禁止，禁止类型：' + CONFIG.EXTENSIONS_BLACKLIST.join(', '), 415)
    }

    // 检查GitHub仓库
    const githubRepo = extractGitHubRepo(targetUrl)
    if (githubRepo && !isGitHubRepoAllowed(githubRepo)) {
      return createErrorResponse(`库 ${githubRepo} 不被允许访问，请联系 ${CONFIG.CONTACT}`, 403)
    }

    // 检查npm包
    const npmPackage = extractNpmPackage(targetUrl)
    if (npmPackage && !isNpmPackageAllowed(npmPackage)) {
      return createErrorResponse(`npm包 ${npmPackage} 不被允许访问，请联系 ${CONFIG.CONTACT}`, 403)
    }

    // 检查referer
    const referer = request.headers.get('referer')
    if (!isRefererAllowed(referer)) {
      return createErrorResponse('来源站点不被允许访问，请联系 ' + CONFIG.CONTACT, 403)
    }

    // 构建代理请求头
    const proxyHeaders = new Headers()

    // 复制必要的请求头
    const allowedHeaders = [
      'accept',
      'accept-encoding',
      'accept-language',
      'cache-control',
      'user-agent'
    ]

    allowedHeaders.forEach(header => {
      const value = request.headers.get(header)
      if (value) {
        proxyHeaders.set(header, value)
      }
    })

    // 设置Host头
    proxyHeaders.set('host', 'cdn.jsdelivr.net')

    // 发起代理请求
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    })

    if (!response.ok) {
      // jsDelivr 返回 403/404 时，对 /gh/ 路径回退到 GitHub Raw
      if ((response.status === 403 || response.status === 404) && /^\/(gh|github)\//.test(url.pathname)) {
        const fallbackResponse = await fetchFromGitHubRaw(request, url.pathname)
        if (fallbackResponse) return fallbackResponse
        // fallback 也失败了，才缓存错误
        if (response.status >= 400 && response.status < 500) {
          setErrorCache(url.pathname, response.status)
        }
      }
      // jsDelivr 返回 404 时，对 /npm/ 路径回退到 npm registry
      else if (response.status === 404 && /^\/npm\//.test(url.pathname)) {
        const fallbackResponse = await fetchFromNpmRegistry(request, url.pathname)
        if (fallbackResponse) return fallbackResponse
        // fallback 也失败了，才缓存错误
        if (response.status >= 400 && response.status < 500) {
          setErrorCache(url.pathname, response.status)
        }
      }
      // 其他4xx错误（无fallback路径），直接缓存
      else if (response.status >= 400 && response.status < 500) {
        setErrorCache(url.pathname, response.status)
      }
      return createErrorResponse(`上游服务器错误: ${response.status}`, response.status)
    }

    // 检查文件大小（如果设置了限制）
    if (CONFIG.MAX_FILE_SIZE > 0) {
      const contentLength = response.headers.get('content-length')
      const maxSize = CONFIG.MAX_FILE_SIZE * 1024 * 1024

      if (contentLength && parseInt(contentLength) > maxSize) {
        return createErrorResponse(`文件过大，超过${CONFIG.MAX_FILE_SIZE}MB限制，请联系 ${CONFIG.CONTACT}`, 413)
      }

      // 如果没有content-length头，检查实际内容大小
      if (!contentLength) {
        const responseBody = await response.arrayBuffer()
        if (responseBody.byteLength > maxSize) {
          return createErrorResponse(`文件过大，超过${CONFIG.MAX_FILE_SIZE}MB限制，请联系 ${CONFIG.CONTACT}`, 413)
        }

        // 使用已读取的内容创建新响应
        return createProxyResponse(responseBody, response)
      }
    }

    // 创建代理响应
    return createProxyResponse(response.body, response)

  } catch (error) {
    console.error('代理错误:', error)
    return createErrorResponse('内部服务器错误', 500)
  }
}

// 从 GitHub Raw 获取文件（jsDelivr 回退方案）
// 路径格式: /gh/owner/repo@branch/path 或 /github/owner/repo@branch/path
// 转换为: https://raw.githubusercontent.com/owner/repo/branch/path
async function fetchFromGitHubRaw(request, pathname) {
  const match = pathname.match(/^\/(?:gh|github)\/([^\/]+)\/([^\/]+)@([^\/]+)\/(.+)/)
  if (!match) return null

  const [, owner, repo, branch, filePath] = match
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`

  try {
    const proxyHeaders = new Headers([
      ['user-agent', request.headers.get('user-agent') || 'Mozilla/5.0'],
    ])

    const response = await fetch(rawUrl, {
      method: request.method,
      headers: proxyHeaders,
    })

    if (!response.ok) return null

    // 检查文件大小限制（与主代理逻辑一致）
    if (CONFIG.MAX_FILE_SIZE > 0) {
      const contentLength = response.headers.get('content-length')
      const maxSize = CONFIG.MAX_FILE_SIZE * 1024 * 1024
      if (contentLength && parseInt(contentLength) > maxSize) {
        return null
      }
    }

    const responseHeaders = new Headers()
    const essentialHeaders = ['content-type', 'content-length', 'etag', 'last-modified']
    essentialHeaders.forEach(header => {
      const value = response.headers.get(header)
      if (value) responseHeaders.set(header, value)
    })

    responseHeaders.set('cache-control', `public, max-age=${CONFIG.CACHE_MAX_AGE}`)
    responseHeaders.set('access-control-allow-origin', '*')
    responseHeaders.set('x-content-type-options', 'nosniff')
    responseHeaders.set('x-gh-fallback', 'true')

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (e) {
    return null
  }
}

// 从 npm registry 获取 tarball（jsDelivr 回退方案）
// 路径格式: /npm/jquery/-/jquery-3.6.4.tgz
// 转换为: https://registry.npmjs.org/jquery/-/jquery-3.6.4.tgz
async function fetchFromNpmRegistry(request, pathname) {
  const match = pathname.match(/^\/npm\/((?:@[^\/]+\/)?[^\/]+)(\/.*)/)
  if (!match) return null

  const [, packageName, tarballPath] = match
  const npmUrl = `https://registry.npmjs.org/${packageName}${tarballPath}`

  try {
    const proxyHeaders = new Headers([
      ['user-agent', request.headers.get('user-agent') || 'Mozilla/5.0'],
    ])

    const response = await fetch(npmUrl, {
      method: request.method,
      headers: proxyHeaders,
    })

    if (!response.ok) return null

    if (CONFIG.MAX_FILE_SIZE > 0) {
      const contentLength = response.headers.get('content-length')
      const maxSize = CONFIG.MAX_FILE_SIZE * 1024 * 1024
      if (contentLength && parseInt(contentLength) > maxSize) {
        return null
      }
    }

    const responseHeaders = new Headers()
    const essentialHeaders = ['content-type', 'content-length', 'etag', 'last-modified']
    essentialHeaders.forEach(header => {
      const value = response.headers.get(header)
      if (value) responseHeaders.set(header, value)
    })

    responseHeaders.set('cache-control', `public, max-age=${CONFIG.CACHE_MAX_AGE}`)
    responseHeaders.set('access-control-allow-origin', '*')
    responseHeaders.set('x-content-type-options', 'nosniff')
    responseHeaders.set('x-npm-fallback', 'true')

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (e) {
    return null
  }
}

// 从 GitHub Releases 获取文件
// 路径格式: /gh-release/owner/repo/tag/filename
// 转换为: https://github.com/owner/repo/releases/download/tag/filename
async function fetchFromGitHubRelease(request, pathname) {
  const match = pathname.match(/^\/gh-release\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)/)
  if (!match) {
    return createErrorResponse('无效的 GitHub Releases URL', 400)
  }

  const [, owner, repo, tag, filename] = match
  const githubUrl = `https://github.com/${owner}/${repo}/releases/download/${tag}/${filename}`

  // 检查仓库是否被允许
  const repoFullName = `${owner}/${repo}`
  if (!isGitHubRepoAllowed(repoFullName)) {
    return createErrorResponse(`库 ${repoFullName} 不被允许访问，请联系 ${CONFIG.CONTACT}`, 403)
  }

  try {
    const proxyHeaders = new Headers([
      ['user-agent', request.headers.get('user-agent') || 'Mozilla/5.0'],
    ])

    const response = await fetch(githubUrl, {
      method: request.method,
      headers: proxyHeaders,
    })

    if (!response.ok) {
      // 缓存GitHub Release的上游4xx错误
      if (response.status >= 400 && response.status < 500) {
        setErrorCache(pathname, response.status)
      }
      return createErrorResponse(`上游服务器错误: ${response.status}`, response.status)
    }

    if (CONFIG.MAX_FILE_SIZE > 0) {
      const contentLength = response.headers.get('content-length')
      const maxSize = CONFIG.MAX_FILE_SIZE * 1024 * 1024
      if (contentLength && parseInt(contentLength) > maxSize) {
        return createErrorResponse(`文件过大，超过${CONFIG.MAX_FILE_SIZE}MB限制，请联系 ${CONFIG.CONTACT}`, 413)
      }
    }

    const responseHeaders = new Headers()
    const essentialHeaders = ['content-type', 'content-length', 'etag', 'last-modified', 'content-disposition']
    essentialHeaders.forEach(header => {
      const value = response.headers.get(header)
      if (value) responseHeaders.set(header, value)
    })

    responseHeaders.set('cache-control', `public, max-age=${CONFIG.CACHE_MAX_AGE}`)
    responseHeaders.set('access-control-allow-origin', '*')
    responseHeaders.set('x-content-type-options', 'nosniff')
    responseHeaders.set('x-github-release', 'true')

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (e) {
    console.error('GitHub Release proxy error:', e)
    return createErrorResponse('代理服务器错误', 500)
  }
}

async function createFastProxy(request, targetUrl, pathname) {
  const proxyHeaders = new Headers([
    ['host', 'cdn.jsdelivr.net'],
    ['user-agent', request.headers.get('user-agent') || 'Mozilla/5.0'],
  ])

  // 只复制关键头部
  const criticalHeaders = ['accept', 'accept-encoding', 'accept-language']
  criticalHeaders.forEach(header => {
    const value = request.headers.get(header)
    if (value) proxyHeaders.set(header, value)
  })

  const response = await fetch(targetUrl, {
    method: request.method,
    headers: proxyHeaders,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
  })

  if (!response.ok) {
    // jsDelivr 返回 403/404 时，对 /gh/ 路径回退到 GitHub Raw
    if ((response.status === 403 || response.status === 404) && /^\/(gh|github)\//.test(pathname)) {
      const fallbackResponse = await fetchFromGitHubRaw(request, pathname)
      if (fallbackResponse) return fallbackResponse
      // fallback 也失败了，才缓存错误
      if (response.status >= 400 && response.status < 500) {
        setErrorCache(pathname, response.status)
      }
    }
    // jsDelivr 返回 404 时，对 /npm/ 路径回退到 npm registry
    else if (response.status === 404 && /^\/npm\//.test(pathname)) {
      const fallbackResponse = await fetchFromNpmRegistry(request, pathname)
      if (fallbackResponse) return fallbackResponse
      // fallback 也失败了，才缓存错误
      if (response.status >= 400 && response.status < 500) {
        setErrorCache(pathname, response.status)
      }
    }
    // 其他4xx错误（无fallback路径），直接缓存
    else if (response.status >= 400 && response.status < 500) {
      setErrorCache(pathname, response.status)
    }
    return createErrorResponse(`上游服务器错误: ${response.status}`, response.status)
  }

  // 快速响应头处理
  const responseHeaders = new Headers()

  // 只复制必要的响应头
  const essentialHeaders = ['content-type', 'content-length', 'etag', 'last-modified']
  essentialHeaders.forEach(header => {
    const value = response.headers.get(header)
    if (value) responseHeaders.set(header, value)
  })

  // 设置缓存和CORS
  responseHeaders.set('cache-control', `public, max-age=${CONFIG.CACHE_MAX_AGE}`)
  responseHeaders.set('access-control-allow-origin', '*')
  responseHeaders.set('x-content-type-options', 'nosniff')

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  })
}

// 创建代理响应
function createProxyResponse(body, originalResponse) {
  const responseHeaders = new Headers()

  // 复制响应头
  const allowedResponseHeaders = [
    'content-type',
    'content-encoding',
    'content-disposition',
    'etag',
    'last-modified',
  ]

  allowedResponseHeaders.forEach(header => {
    const value = originalResponse.headers.get(header)
    if (value) {
      responseHeaders.set(header, value)
    }
  })

  // 设置缓存头
  if (CONFIG.CACHE_MAX_AGE > 0) {
    responseHeaders.set('cache-control', `public, max-age=${CONFIG.CACHE_MAX_AGE}`)
  }

  // CORS头
  responseHeaders.set('access-control-allow-origin', '*')
  responseHeaders.set('access-control-allow-methods', 'GET, HEAD, OPTIONS')
  responseHeaders.set('access-control-allow-headers', 'Origin, X-Requested-With, Content-Type, Accept')

  // 安全头
  responseHeaders.set('x-content-type-options', 'nosniff')
  responseHeaders.set('x-frame-options', 'DENY')

  return new Response(body, {
    status: originalResponse.status,
    headers: responseHeaders,
  })
}
