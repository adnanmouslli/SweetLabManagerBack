import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true',
}));

export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV || 'development',
  name: 'NestJS API',
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',
  jwt: {
    secret: process.env.JWT_SECRET,
    expirationTime: parseInt(process.env.JWT_EXPIRATION_TIME, 10) || 3600,
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL, 10) || 60,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  },
}));