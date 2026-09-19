'use strict';

/**
 * The CSP only allows inline code it names. If the Angular build starts
 * writing a new inline handler or script into index.html, this fails before
 * the page silently loses its stylesheet or a script in the installer.
 * Runs against the copied build in desktop/app, else against dist; skipped
 * when neither exists.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');
const { ALLOWED_INLINE_HANDLERS } = require('../src/protocol');

const candidates = [
  path.join(__dirname, '..', 'app', 'index.html'),
  path.join(__dirname, '..', '..', 'dist', '3DTD', 'browser', 'index.html'),
];
const indexFile = candidates.find((file) => fs.existsSync(file));

it('index.html has no inline code the CSP would block', { skip: !indexFile && 'no build' }, () => {
  const html = fs.readFileSync(indexFile, 'utf8');

  const handlers = [...html.matchAll(/\son[a-z]+\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
  for (const handler of handlers) {
    assert.ok(ALLOWED_INLINE_HANDLERS.includes(handler), `inline handler not in the CSP: ${handler}`);
  }

  const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/gi)].filter(
    ([, attributes, body]) => body.trim() && !/type\s*=\s*"application\/(ld\+)?json"/i.test(attributes)
  );
  assert.equal(inlineScripts.length, 0, 'inline <script> in index.html, the CSP blocks it');
});
