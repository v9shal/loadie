const ProxyServer = require('../lib/ProxyServer');

const proxy = new ProxyServer();
proxy.start(8000, () => {
  console.log('Proxy server running on http://localhost:8000');
});