const EventEmitter = require('events');
const HealthChecker = require('./healthServer');
const ProxyServer = require('./ProxyServer');
const SimpleHashRing = require('./SimpleHashRing');
const logger = require('./logger'); 
class LoadBalancer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      port: 8000,
      routes: {},
      healthCheck: {
        enabled: true,
        interval: 10000,
        timeout: 5000,
        path: '/health',
      },
      proxy: {
        timeout: 30000,
      },
      ...options
    };

    this.routeState = new Map();
    this.serverToRoute = new Map(); 

    for (const path in this.config.routes) {
      const routeConfig = this.config.routes[path];
      const normalizedBackends = routeConfig.backends.map(b => {
          if (typeof b === 'string') return { url: b, weight: 1 };
          return { url: b.url, weight: b.weight || 1 };
      });
      routeConfig.backends = normalizedBackends;
      
      const backendUrls = normalizedBackends.map(b => b.url);

      this.routeState.set(path, {
        config: routeConfig,
        healthyServers: [...backendUrls],
        hashring: new SimpleHashRing(backendUrls),
        connectionCounts: new Map(backendUrls.map(url => [url, 0])),
        wrr: { currentIndex: -1, currentWeight: 0, gcd: 0 },
        rrCurrentIndex: 0,
      });

      backendUrls.forEach(url => this.serverToRoute.set(url, path));
    }

    this.healthChecker = new HealthChecker(this.config.healthCheck);
    this.proxyServer = new ProxyServer(this.config.proxy);
    this.setupEventHandlers();

    logger.info({ config: this.config }, 'LoadBalancer initialized');
  }

  getClientIp(req) {
    return req.socket.remoteAddress;
  }
  
  gcd(a, b) {
    return b === 0 ? a : this.gcd(b, a % b);
  }

  setupEventHandlers() {
    this.healthChecker.on('serverHealthChanged', (serverUrl, isHealthy) => {
      const routePath = this.serverToRoute.get(serverUrl);
      if (!routePath) {
        logger.warn({ server: serverUrl }, 'Health change for a server not belonging to any known route');
        return;
      }

      if (isHealthy) {
        this.addHealthyServer(serverUrl, routePath);
      } else {
        this.removeUnhealthyServer(serverUrl, routePath);
      }
    });
    
    this.proxyServer.on('requestStart', (serverUrl) => {
      const routePath = this.serverToRoute.get(serverUrl);
      const state = this.routeState.get(routePath);
      if(state) {
        const count = state.connectionCounts.get(serverUrl) || 0;
        state.connectionCounts.set(serverUrl, count + 1);
      }
    });

    this.proxyServer.on('requestEnd', (serverUrl) => {
      const routePath = this.serverToRoute.get(serverUrl);
      const state = this.routeState.get(routePath);
      if(state) {
        const count = state.connectionCounts.get(serverUrl) || 1;
        state.connectionCounts.set(serverUrl, Math.max(0, count - 1));
      }
    });
    
    this.proxyServer.on('error', (error, req, res) => {
      logger.error({ err: error.message, url: req.url }, 'ProxyServer emitted an error');
      this.emit('proxyError', error, req, res);
    });
  }
  
  addHealthyServer(serverUrl, routePath) {
    const state = this.routeState.get(routePath);
    if (state && !state.healthyServers.includes(serverUrl)) {
      state.healthyServers.push(serverUrl);
      state.connectionCounts.set(serverUrl, 0);
      this.emit('serverAdded', serverUrl, routePath);
      logger.warn(
        { server: serverUrl, route: routePath, status: 'healthy' },
        'Server health changed: back online'
      );
    }
  }

  removeUnhealthyServer(serverUrl, routePath) {
    const state = this.routeState.get(routePath);
    if (state) {
      const index = state.healthyServers.indexOf(serverUrl);
      if (index > -1) {
        state.healthyServers.splice(index, 1);
        state.connectionCounts.delete(serverUrl);
        this.emit('serverRemoved', serverUrl, routePath);
        logger.warn(
          { server: serverUrl, route: routePath, status: 'unhealthy' },
          'Server health changed: went offline'
        );
      }
    }
  }
  
  handleRequest(req, res) {
    const requestDetails = { method: req.method, url: req.url, ip: this.getClientIp(req) };
    logger.debug(requestDetails, 'Incoming request received');

    try {
      const routePath = this.findMatchingRoute(req.url);
      if (!routePath) {
        logger.warn({ ...requestDetails, component: 'router' }, 'No matching route found for request');
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found: No matching route');
        return;
      }
      
      const targetServer = this.getNextServer(req, routePath);
      logger.info({ ...requestDetails, target: targetServer, route: routePath }, 'Proxying request to target');
      
      this.proxyServer.proxyRequest(req, res, targetServer);
      this.emit('requestProxied', targetServer, req.url);
    } catch (error) {
      logger.error({ ...requestDetails, err: error.message, stack: error.stack }, 'Error handling request');
      this.emit('error', error);
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
      }
    }
  }

  findMatchingRoute(url) {
    const paths = Array.from(this.routeState.keys());
    paths.sort((a, b) => b.length - a.length);
    for (const path of paths) {
      if (url.startsWith(path)) return path;
    }
    return null;
  }
  
  getNextServer(req, routePath) {
    const state = this.routeState.get(routePath);
    if (!state || state.healthyServers.length === 0) {
      throw new Error(`No healthy servers available for route: ${routePath}`);
    }

    const strategy = state.config.strategy || 'round-robin';
    
    switch (strategy) {
      case 'ip-hash':
        return this.getIpHashServer(req, state);
      case 'weighted-round-robin':
        return this.getWeightedRoundRobinServer(state);
      case 'consistent-hashing':
        return this.getConsistentHashingServer(req, state);
      case 'least-connections':
        return this.getLeastConnectionsServer(state);
      default:
        return this.getRoundRobinServer(state);
    }
  }
  
  getIpHashServer(req, state) {
    const clientIp = this.getClientIp(req);
    const healthyRing = new SimpleHashRing(state.healthyServers);
    const server = healthyRing.get(clientIp);
    if (!server) {
        logger.warn({ ip: clientIp, route: state.config.path }, 'IP Hash failed, falling back to round-robin');
        return this.getRoundRobinServer(state);
    }
    return server;
  }

  getWeightedRoundRobinServer(state) {
    const healthyBackends = state.config.backends.filter(b => state.healthyServers.includes(b.url));
    if (healthyBackends.length === 0) throw new Error("No healthy servers for weighted strategy.");

    const weights = healthyBackends.map(b => b.weight);
    state.wrr.gcd = weights.reduce((a, b) => this.gcd(a, b));

    while (true) {
        state.wrr.currentIndex = (state.wrr.currentIndex + 1) % healthyBackends.length;
        if (state.wrr.currentIndex === 0) {
            state.wrr.currentWeight = state.wrr.currentWeight - state.wrr.gcd;
            if (state.wrr.currentWeight <= 0) {
                state.wrr.currentWeight = Math.max(...weights);
            }
        }
        if (healthyBackends[state.wrr.currentIndex].weight >= state.wrr.currentWeight) {
            return healthyBackends[state.wrr.currentIndex].url;
        }
    }
  }
  
  getRoundRobinServer(state) {
    const server = state.healthyServers[state.rrCurrentIndex];
    state.rrCurrentIndex = (state.rrCurrentIndex + 1) % state.healthyServers.length;
    return server;
  }
  
  getLeastConnectionsServer(state) {
     let minConnections = Infinity;
     let selectedServer = state.healthyServers[0];
     for (const serverUrl of state.healthyServers) {
        const connections = state.connectionCounts.get(serverUrl) || 0;
        if (connections < minConnections) {
            minConnections = connections;
            selectedServer = serverUrl;
        }
     }
     return selectedServer;
  }
  
  getConsistentHashingServer(req, state) {
    const healthyRing = new SimpleHashRing(state.healthyServers);
    const key = req.url.split('/').pop() || req.url;
    const server = healthyRing.get(key);
    if (!server) {
        logger.warn({ key: key, route: state.config.path }, 'Consistent Hash failed, falling back to round-robin');
        return this.getRoundRobinServer(state);
    }
    return server;
  }

  async start() {
    const allBackends = Object.values(this.config.routes).flatMap(r => r.backends.map(b => b.url));
    if (allBackends.length === 0) {
      throw new Error('No backends configured in any route');
    }

    if (this.config.healthCheck.enabled) {
      await this.healthChecker.start([...new Set(allBackends)]);
    }

    return new Promise((resolve, reject) => {
      const server = this.proxyServer.createServer((req, res) => this.handleRequest(req, res));
      server.listen(this.config.port, (err) => {
        if (err) {
          logger.error({ err: err.message, port: this.config.port }, 'Failed to start API Gateway');
          return reject(err);
        }
        
        logger.info({ port: this.config.port }, ' API Gateway started successfully');
        
        const routeInfo = {};
        for(const path in this.config.routes) {
            const route = this.config.routes[path];
            const backendUrls = route.backends.map(b => b.url);
            routeInfo[path] = {
                backends: backendUrls,
                strategy: route.strategy || 'round-robin'
            };
        }
        logger.info({ routes: routeInfo }, '--- Configured Routes ---');

        this.emit('started', this.config.port);
        resolve(server);
      });
      this.server = server;
    });
  }
  
  async stop() {
    if (this.healthChecker) this.healthChecker.stop();
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          logger.info(' API Gateway stopped gracefully');
          this.emit('stopped');
          resolve();
        });
      });
    }
  }
}

module.exports = LoadBalancer;