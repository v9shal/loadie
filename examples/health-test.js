const HealthCheck = require('../lib/healthServer');

const healthChecker = new HealthCheck({ interval: 5000 });

healthChecker.on('serverHealthChanged', (server, isHealthy) => {
  console.log(`[EVENT] ${server} is now ${isHealthy ? 'healthy' : 'unhealthy'}`);
});

// Start with one server
healthChecker.start(['http://localhost:3001']).then(async () => {
  // Dynamically add another server after 3 seconds
  setTimeout(async () => {
    await healthChecker.addServer('http://localhost:3002');
  }, 3000);
});
