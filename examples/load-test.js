const LoadBalancer = require('../lib/LoadBalancer');

const lb = new LoadBalancer({
  port: 8000,
  routes: {
    '/users': {
      strategy: 'consistent-hashing',
      backends: [
        'http://localhost:3001',
        'http://localhost:3002',
        'http://localhost:3005',
        'http://localhost:3006'
      ]
    },
    '/payments': {
      strategy: 'round-robin',
      backends: [
        'http://localhost:3003',
        'http://localhost:3004'
      ]
    }
  }
});

lb.on('started', (port) => console.log(`\n🎯 API Gateway ready on port ${port}`));
lb.on('serverAdded', (server, route) => console.log(`Server added to route [${route}]: ${server}`));
lb.on('serverRemoved', (server, route) => console.log(`Server removed from route [${route}]: ${server}`));
lb.on('error', (err) => console.error(`API Gateway Error: ${err.message}`));

lb.start().catch((err) => {
  console.error('Failed to start API Gateway:', err.message);
});