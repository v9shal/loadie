const pino = require('pino');

const level = process.env.LOG_LEVEL || 'info';


const logger = pino({
  level: level,
  transport: process.env.NODE_ENV !== 'production'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

module.exports = logger;