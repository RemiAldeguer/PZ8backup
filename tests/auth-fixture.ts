import { expect, type APIRequestContext } from '@playwright/test';

// This account exists only in the temporary browser-test databases.
export const TEST_ADMIN = {
  username: 'admin',
  password: 'Planzone8-Test-Admin!2026',
  name: 'Administrateur',
};

export async function loginTestAdmin(request: APIRequestContext, password = TEST_ADMIN.password) {
  const response = await request.post('/api/auth/login', {
    data: { username: TEST_ADMIN.username, password },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ authenticated: true });
}
