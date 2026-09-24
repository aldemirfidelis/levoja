import { createBff } from '@levoja/web-kit/server';

export const bff = createBff({
  apiUrl: process.env.API_URL ?? 'http://localhost:3333',
  tenant: process.env.TENANT_SLUG ?? 'levoja',
  app: 'ADMIN',
  cookiePrefix: 'lj_admin',
});
