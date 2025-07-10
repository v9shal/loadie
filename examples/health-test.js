const HealthCheck = require('../lib/healthServer');

const healthChecker = new HealthCheck({ interval: 5000 });

healthChecker.on('serverHealthChanged', (server, isHealthy) => {
  console.log(`[EVENT] ${server} is now ${isHealthy ? 'healthy' : 'unhealthy'}`);
});

healthChecker.start(['http://localhost:3001']).then(async () => {
  setTimeout(async () => {
    await healthChecker.addServer('http://localhost:3002');
  }, 3000);
});
