const EventEmitter = require('events');
const http = require('http');
const url = require('url');

class HealthChecker extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      interval: 10000,
      timeout: 5000,
      path: '/health',
      expectedStatus: [200, 201, 202, 204],
      ...config
    };
    
    this.servers = [];
    this.serverStatus = new Map();
    this.intervalId = null;
  }

  async start(servers = []) {
    this.servers = [...servers];
    this.servers.forEach(server => {
      this.serverStatus.set(server, true); 
    });

    await this.checkAllServers();
    
    // Start periodic checks
    this.intervalId = setInterval(() => {
      this.checkAllServers().catch(err => {
        this.emit('error', err);
      });
    }, this.config.interval);

    console.log(`🔍 Health checks started (interval: ${this.config.interval}ms)`);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('🔍 Health checks stopped');
    }
  }

  addServer(server) {
    if (!this.servers.includes(server)) {
      this.servers.push(server);
      this.serverStatus.set(server, true);
    }
  }

  removeServer(server) {
    const index = this.servers.indexOf(server);
    if (index > -1) {
      this.servers.splice(index, 1);
      this.serverStatus.delete(server);
    }
  }

  async checkAllServers() {
    const healthPromises = this.servers.map(server => 
      this.checkServerHealth(server)
    );

    const results = await Promise.allSettled(healthPromises);
    
    results.forEach((result, index) => {
      const server = this.servers[index];
      const isHealthy = result.status === 'fulfilled' && result.value;
      const wasHealthy = this.serverStatus.get(server);

      if (isHealthy !== wasHealthy) {
        this.serverStatus.set(server, isHealthy);
        this.emit('serverHealthChanged', server, isHealthy);
      }
    });

    const healthyCount = Array.from(this.serverStatus.values()).filter(Boolean).length;
    console.log(`🏥 Health check complete. Healthy: ${healthyCount}/${this.servers.length}`);
  }

  async checkServerHealth(serverUrl) {
    return new Promise((resolve) => {
      const parsedUrl = url.parse(serverUrl);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: this.config.path,
        method: 'GET',
        timeout: this.config.timeout,
        headers: {
          'User-Agent': 'LoadBalancer-HealthCheck/1.0'
        }
      };

      const req = http.request(options, (res) => {
        const isHealthy = this.config.expectedStatus.includes(res.statusCode);
        resolve(isHealthy);
        
        res.resume();
      });

      req.on('error', (err) => {
        console.log(`Health check failed for ${serverUrl}: ${err.message}`);
        resolve(false);
      });

      req.on('timeout', () => {
        console.log(`Health check timeout for ${serverUrl}`);
        req.destroy();
        resolve(false);
      });

      req.setTimeout(this.config.timeout);
      req.end();
    });
  }

  getServerStatus(server) {
    return this.serverStatus.get(server) || false;
  }

  getAllStatus() {
    return Object.fromEntries(this.serverStatus);
  }
}

module.exports = HealthChecker;