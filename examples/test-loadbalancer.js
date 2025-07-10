const http = require('http');

async function testLoadBalancer() {
  console.log('🧪 Testing Load Balancer...\n');
  
  const tests = [
    { path: '/user/123', description: 'User 123 request' },
    { path: '/user/456', description: 'User 456 request' },
    { path: '/user/789', description: 'User 789 request' },
    { path: '/api', description: 'API request' },
    { path: '/health', description: 'Health check' }
  ];
  
  for (const test of tests) {
    try {
      const result = await makeRequest(test.path);
      console.log(`✅ ${test.description}: ${result}`);
    } catch (error) {
      console.error(`❌ ${test.description}: ${error.message}`);
    }
  }
}

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8000,
      path: path,
      method: 'GET',
      timeout: 5000
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(`Status: ${res.statusCode}, Response: ${JSON.stringify(parsed)}`);
        } catch (e) {
          resolve(`Status: ${res.statusCode}, Response: ${data}`);
        }
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

// Wait a bit for load balancer to start, then test
setTimeout(() => {
  testLoadBalancer().then(() => {
    console.log('\n🏁 Test completed');
  });
}, 2000);

console.log('⏳ Waiting for load balancer to start...');