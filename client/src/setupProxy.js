const { createProxyMiddleware } = require('http-proxy-middleware');

/**
 * CRA package.json의 proxy 설정이 webpack-dev-server allowedHosts 버그를 유발하므로
 * setupProxy.js로 프록시를 분리하여 해결
 */
module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:5000',
      changeOrigin: true,
    })
  );
};
