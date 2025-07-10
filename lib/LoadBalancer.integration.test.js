const request = require('supertest');
const nock = require('nock');
const LoadBalancer = require('./LoadBalancer');

jest.mock('./logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('LoadBalancer Integration Tests', () => {
  let lb;
  let server;

  const config = {
    port: 0, 
    healthCheck: {
      enabled: true,
      interval: 100,
      timeout: 50,
      path: '/health'
    },
    routes: {
      '/users': {
        strategy: 'round-robin',
        backends: ['http://user-service:3001', 'http://user-service:3002']
      }
    }
  };

  beforeEach(async () => {
    nock.cleanAll();
    lb = new LoadBalancer(config);
    server = await lb.start();
  });

  afterEach(async () => {
    await lb.stop();
    nock.cleanAll();
  });

  it('should proxy a request to a healthy backend using round-robin', async () => {
    nock('http://user-service:3001').get('/health').reply(200, 'OK');
    nock('http://user-service:3002').get('/health').reply(200, 'OK');
    const scope1 = nock('http://user-service:3001').get('/users/1').reply(200, { server: '3001' });
    const scope2 = nock('http://user-service:3002').get('/users/1').reply(200, { server: '3002' });
    
    const res1 = await request(server).get('/users/1');
    expect(res1.status).toBe(200);
    expect(res1.body.server).toBe('3001');
    expect(scope1.isDone()).toBe(true); 

    const res2 = await request(server).get('/users/1');
    expect(res2.status).toBe(200);
    expect(res2.body.server).toBe('3002');
    expect(scope2.isDone()).toBe(true);
  });

  it('should automatically failover when a backend becomes unhealthy', async () => {
    nock('http://user-service:3001').get('/health').reply(200, 'OK');
    nock('http://user-service:3002').get('/health').reply(200, 'OK');
    const healthyScope = nock('http://user-service:3001').get('/users/failover').reply(200, { server: '3001' });

    await new Promise(resolve => setTimeout(resolve, 150));

    const res1 = await request(server).get('/users/failover');
    expect(res1.body.server).toBe('3001');
    expect(healthyScope.isDone()).toBe(true);

    nock.cleanAll(); 
    nock('http://user-service:3001').get('/health').reply(500, 'Internal Server Error'); 
    nock('http://user-service:3002').get('/health').reply(200, 'OK'); 
    
    const failoverScope = nock('http://user-service:3002').get('/users/failover').reply(200, { server: '3002' });

    await new Promise(resolve => setTimeout(resolve, 150)); 
    
    const res2 = await request(server).get('/users/failover');
    expect(res2.status).toBe(200);
    expect(res2.body.server).toBe('3002');
    expect(failoverScope.isDone()).toBe(true);
  });
});