import { CONFIG } from '../config.js'

export const config = {
  runtime: 'edge',
}

export default async function handler() {
  const data = {
    extensionsMode: CONFIG.EXTENSIONS_MODE,
    extensionsWhitelist: CONFIG.EXTENSIONS_WHITELIST,
    extensionsBlacklist: CONFIG.EXTENSIONS_BLACKLIST,
    githubReposMode: CONFIG.GITHUB_REPOS_MODE,
    npmPackagesMode: CONFIG.NPM_PACKAGES_MODE,
    sitesMode: CONFIG.SITES_MODE,
    maxFileSize: CONFIG.MAX_FILE_SIZE,
    cacheMaxAge: CONFIG.CACHE_MAX_AGE,
    githubRepos: CONFIG.GITHUB_REPOS,
    npmPackages: CONFIG.NPM_PACKAGES,
    sites: CONFIG.SITES,
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
