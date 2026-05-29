import proxyHandler from './api/proxy.js'
import configHandler from './api/config.js'

export default {
  async fetch(request) {
    if (new URL(request.url).pathname === '/api/config') return configHandler(request)
    return proxyHandler(request)
  }
}
