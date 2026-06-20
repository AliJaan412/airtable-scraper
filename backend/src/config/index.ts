import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/sred_io',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  airtable: {
    clientId: process.env.AIRTABLE_CLIENT_ID || '',
    clientSecret: process.env.AIRTABLE_CLIENT_SECRET || '',
    redirectUri: process.env.AIRTABLE_REDIRECT_URI || 'http://localhost:3000/api/airtable/oauth/callback',
    scope: process.env.AIRTABLE_SCOPE || 'data.records:read schema.bases:read user.email:read',
    authUrl: 'https://airtable.com/oauth2/v1/authorize',
    tokenUrl: 'https://airtable.com/oauth2/v1/token',
    baseUrl: 'https://api.airtable.com/v0',
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',
  defaultOrgId: process.env.DEFAULT_ORG_ID || 'default-org',
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    cacheTtl: parseInt(process.env.REDIS_CACHE_TTL || '300', 10), // 5 min default
  },
};
