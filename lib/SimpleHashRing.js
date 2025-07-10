const crypto = require('crypto');

class SimpleHashRing {
  constructor(servers = []) {
    this.ring = {};
    this.sortedHashes = [];
    this.replicas = 100; 

    servers.forEach(server => this.add(server));
  }

  _hash(key) {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    return parseInt(hash.substring(0, 8), 16);
  }

  add(server) {
    for (let i = 0; i < this.replicas; i++) {
      const key = `${server}:${i}`;
      const hash = this._hash(key);
      
      if (!this.sortedHashes.includes(hash)) {
        this.ring[hash] = server;
        this.sortedHashes.push(hash);
      }
    }
    this.sortedHashes.sort((a, b) => a - b);
  }

  remove(server) {
    for (let i = 0; i < this.replicas; i++) {
      const key = `${server}:${i}`;
      const hash = this._hash(key);
      
      const index = this.sortedHashes.indexOf(hash);
      if (index > -1) {
        this.sortedHashes.splice(index, 1);
      }
      delete this.ring[hash];
    }
  }

  get(key) {
    if (this.sortedHashes.length === 0) {
      return null;
    }

    const keyHash = this._hash(key);

    for (const serverHash of this.sortedHashes) {
      if (keyHash <= serverHash) {
        return this.ring[serverHash];
      }
    }
    
    return this.ring[this.sortedHashes[0]];
  }

  getAll() {
    return [...new Set(Object.values(this.ring))];
  }
}

module.exports = SimpleHashRing;