import test from 'node:test';
import assert from 'node:assert/strict';

import { validateManualMail, createManualSendHandler } from './manual.js';

test('validateManualMail rejects payload without recipient', () => {
  assert.throws(() => validateManualMail({ subject: 'Test', html: '<p>hi</p>' }), /destinatario|to/i);
});

test('createManualSendHandler forwards valid payload to the SMTP sender', async () => {
  let sent = null;
  const handler = createManualSendHandler({
    sendMail: async (payload) => {
      sent = payload;
      return true;
    },
  });

  const chunks = [];
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    on(event, cb) {
      if (event === 'data') {
        cb(Buffer.from(JSON.stringify({ to: 'mario@example.com', subject: 'Ciao', html: '<p>Hi</p>' })));
      }
      if (event === 'end') {
        cb();
      }
    },
  };

  const res = {
    statusCode: 200,
    headers: {},
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers || {};
    },
    end(data) {
      this.body = data;
    },
  };

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(sent.destinatario, 'mario@example.com');
  assert.equal(sent.subject, 'Ciao');
  assert.match(sent.html, /<p>Hi<\/p>/);
});
