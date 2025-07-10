const EventEmitter = require('events');
const http = require('http');
const url = require('url');

class ProxyServer extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      timeout: 30000,
      keepAlive: true,
      retries: 1,
      ...config
    };
  }

  createServer(requestHandler) {
    const server = http.createServer(requestHandler);
    
    if (this.config.keepAlive) {
      server.keepAliveTimeout = 65000; 
      server.headersTimeout = 66000;
    }

    return server;
  }

  proxyRequest(clientReq, clientRes, targetServer) {
    const startTime = Date.now();
    this.emit('requestStart', targetServer);

    try {
      const parsedTarget = url.parse(targetServer);
      
      console.log(`🔄 Proxying ${clientReq.method} ${clientReq.url} to ${targetServer}`);

      const proxyOptions = {
        hostname: parsedTarget.hostname,
        port: parsedTarget.port,
        path: clientReq.url,
        method: clientReq.method,
        headers: this.prepareHeaders(clientReq.headers, parsedTarget),
        timeout: this.config.timeout
      };

      const proxyReq = http.request(proxyOptions, (proxyRes) => {
        this.handleProxyResponse(clientReq, clientRes, proxyRes, targetServer, startTime);
      });

      this.setupProxyRequestHandlers(clientReq, clientRes, proxyReq, targetServer, startTime);
      
      
      clientReq.pipe(proxyReq);

    } catch (error) {
      this.handleError(error, clientReq, clientRes, targetServer, startTime);
    }
  }

  prepareHeaders(originalHeaders, parsedTarget) {
    const headers = { ...originalHeaders };
    
    
    headers.host = `${parsedTarget.hostname}:${parsedTarget.port}`;
    
    headers['x-forwarded-for'] = headers['x-forwarded-for'] 
      ? `${headers['x-forwarded-for']}, ${this.getClientIP(originalHeaders)}`
      : this.getClientIP(originalHeaders);
    
    headers['x-forwarded-proto'] = parsedTarget.protocol.slice(0, -1); 
    headers['x-forwarded-host'] = originalHeaders.host;
    
    return headers;
  }

  getClientIP(headers) {
    return headers['x-real-ip'] || 
           headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           '127.0.0.1';
  }

  handleProxyResponse(clientReq, clientRes, proxyRes, targetServer, startTime) {
 
    const responseHeaders = { ...proxyRes.headers };
    responseHeaders['x-proxy-server'] = targetServer;
    
    clientRes.writeHead(proxyRes.statusCode, responseHeaders);
    
   
    proxyRes.pipe(clientRes);
  
    proxyRes.on('error', (err) => {
      console.error(`Proxy response error from ${targetServer}:`, err.message);
      this.handleError(err, clientReq, clientRes, targetServer, startTime);
    });

    proxyRes.on('end', () => {
      const duration = Date.now() - startTime;
      console.log(`✅ Request completed: ${clientReq.method} ${clientReq.url} -> ${targetServer} (${duration}ms)`);
      this.emit('requestEnd', targetServer);
    });
  }

  setupProxyRequestHandlers(clientReq, clientRes, proxyReq, targetServer, startTime) {
   
    proxyReq.on('error', (err) => {
      console.error(`Proxy request error to ${targetServer}:`, err.message);
      this.handleError(err, clientReq, clientRes, targetServer, startTime);
    });

    proxyReq.on('timeout', () => {
      console.error(`Proxy request timeout to ${targetServer}`);
      proxyReq.destroy();
      this.handleError(new Error('Request timeout'), clientReq, clientRes, targetServer, startTime);
    });

    
    clientReq.on('error', (err) => {
      console.error('Client request error:', err.message);
      proxyReq.destroy();
      this.emit('requestEnd', targetServer);
    });

    clientRes.on('error', (err) => {
      console.error('Client response error:', err.message);
      proxyReq.destroy();
      this.emit('requestEnd', targetServer);
    });

    
    clientReq.on('close', () => {
      if (!clientReq.complete) {
        console.log('Client disconnected before request completed');
        proxyReq.destroy();
        this.emit('requestEnd', targetServer);
      }
    });

  
    proxyReq.setTimeout(this.config.timeout);
  }

  handleError(error, clientReq, clientRes, targetServer, startTime) {
    const duration = Date.now() - startTime;
    console.error(` Request failed: ${clientReq.method} ${clientReq.url} -> ${targetServer} (${duration}ms) - ${error.message}`);
    
    this.emit('error', error, clientReq, clientRes);
    this.emit('requestEnd', targetServer);

    if (!clientRes.headersSent) {
      const statusCode = this.getErrorStatusCode(error);
      const errorMessage = this.getErrorMessage(statusCode);
      
      clientRes.writeHead(statusCode, { 
        'Content-Type': 'application/json',
        'X-Error': error.message 
      });
      
      clientRes.end(JSON.stringify({
        error: errorMessage,
        message: error.message,
        timestamp: new Date().toISOString()
      }));
    }
  }

  getErrorStatusCode(error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return 502;
    }
    if (error.message.includes('timeout')) {
      return 504; 
    }
    return 500; 
  }

  getErrorMessage(statusCode) {
    const messages = {
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout'
    };
    return messages[statusCode] || 'Unknown Error';
  }
}

module.exports = ProxyServer;