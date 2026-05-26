import { CONFIG } from '../config.js'

export const config = {
  runtime: 'edge',
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
      return `${match[2]}/${match[3]}`
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
    
    // 构建目标URL
    const targetPath = url.pathname + url.search
    const targetUrl = `https://cdn.jsdelivr.net${targetPath}`
    
    // 如果所有类别都为无限制模式，跳过大部分检查
    if (CONFIG.GITHUB_REPOS_MODE === 'none' &&
        CONFIG.NPM_PACKAGES_MODE === 'none' &&
        CONFIG.SITES_MODE === 'none' &&
        CONFIG.EXTENSIONS_MODE === 'none' &&
        CONFIG.MAX_FILE_SIZE === 0) {
      return createFastProxy(request, targetUrl)
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
      }
      // jsDelivr 返回 404 时，对 /npm/ 路径回退到 npm registry
      if (response.status === 404 && /^\/npm\//.test(url.pathname)) {
        const fallbackResponse = await fetchFromNpmRegistry(request, url.pathname)
        if (fallbackResponse) return fallbackResponse
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

async function createFastProxy(request, targetUrl) {
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
    if ((response.status === 403 || response.status === 404) && /^\/(gh|github)\//.test(new URL(request.url).pathname)) {
      const fallbackResponse = await fetchFromGitHubRaw(request, new URL(request.url).pathname)
      if (fallbackResponse) return fallbackResponse
    }
    // jsDelivr 返回 404 时，对 /npm/ 路径回退到 npm registry
    if (response.status === 404 && /^\/npm\//.test(new URL(request.url).pathname)) {
      const fallbackResponse = await fetchFromNpmRegistry(request, new URL(request.url).pathname)
      if (fallbackResponse) return fallbackResponse
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
