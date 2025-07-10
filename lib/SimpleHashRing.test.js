const SimpleHashRing = require('./SimpleHashRing');

describe('SimpleHashRing', () => {
  let ring;

  beforeEach(() => {
    const servers = ['http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'];
    ring = new SimpleHashRing(servers);
  });

  it('should create a ring with the initial servers', () => {
    expect(ring.getAll()).toHaveLength(3);
    expect(ring.getAll()).toContain('http://localhost:3002');
  });

  it('should add a new server correctly', () => {
    ring.add('http://localhost:3004');
    expect(ring.getAll()).toHaveLength(4);
    expect(ring.getAll()).toContain('http://localhost:3004');
  });

  it('should remove a server correctly', () => {
    ring.remove('http://localhost:3002');
    expect(ring.getAll()).toHaveLength(2);
    expect(ring.getAll()).not.toContain('http://localhost:3002');
  });

  it('should consistently map the same key to the same server', () => {
    const key = 'my-user-id-123';
    const server1 = ring.get(key);
    const server2 = ring.get(key);
    expect(server1).toBe(server2);
    expect(server1).toBeTruthy(); 
  });

  it('should re-map keys to a new server when their target is removed', () => {
    const key = 'another-key-456';
    const originalServer = ring.get(key);
    
    ring.remove(originalServer);

    const newServer = ring.get(key);
    
    expect(newServer).not.toBe(originalServer);
    expect(newServer).toBeTruthy();
    expect(ring.getAll()).toContain(newServer);
  });

  it('should return null if the ring is empty', () => {
    const emptyRing = new SimpleHashRing();
    expect(emptyRing.get('any-key')).toBeNull();
  });
});