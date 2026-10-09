const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMailerHeaders } = require('./mailerHeaders.cjs');

test('Supabase edge functions: apikey = anon, Authorization = token della sessione staff', () => {
  const headers = buildMailerHeaders({ SUPABASE_ANON_KEY: 'anon-key-123' }, 'user-jwt-789');

  assert.equal(headers.Authorization, 'Bearer user-jwt-789');
  assert.equal(headers.apikey, 'anon-key-123');
  assert.equal(headers['Content-Type'], 'application/json');
});

test('la chiave anon non viene mai usata come Authorization', () => {
  const headers = buildMailerHeaders({ SUPABASE_ANON_KEY: 'anon-key-123' });

  assert.equal(headers.Authorization, undefined);
  assert.equal(headers.apikey, 'anon-key-123');
});

test('custom mailer key is sent as custom header and bearer token when configured', () => {
  const headers = buildMailerHeaders({
    MAILER_API_KEY: 'mailer-secret-456',
  });

  assert.equal(headers['X-Mailer-Key'], 'mailer-secret-456');
  assert.equal(headers.Authorization, 'Bearer mailer-secret-456');
  assert.equal(headers['Content-Type'], 'application/json');
});
