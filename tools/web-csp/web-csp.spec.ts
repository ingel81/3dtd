// @vitest-environment node
/**
 * The web version's Content-Security-Policy (public/.htaccess, TODO E94a) is
 * the desktop app's, word for word: the same build runs under both, and the
 * desktop's has been played with. A host or an inline script added on one
 * side only fails here. Against the built index.html (dist), where there is
 * one: every inline script and handler is allowed by its hash, else the page
 * would lose its stylesheet on the live site.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { CONTENT_SECURITY_POLICY } = require('../../desktop/src/protocol.js') as { CONTENT_SECURITY_POLICY: string };

const htaccess = readFileSync(resolve('public/.htaccess'), 'utf8');
/** The policy the web server sends with /play/ */
const webPolicy = /^\s*Header always set Content-Security-Policy "([^"]+)"\s*$/m.exec(htaccess)?.[1] ?? null;
const indexFile = resolve('dist/3DTD/browser/index.html');
const sha256 = (source: string) => `'sha256-${createHash('sha256').update(source).digest('base64')}'`;

describe('the web version’s CSP', () => {
  it('is the desktop app’s, beside the isolation headers', () => {
    expect(webPolicy).toBe(CONTENT_SECURITY_POLICY);
    expect(htaccess).toContain('Header always set Cross-Origin-Opener-Policy "same-origin"');
    expect(htaccess).toContain('Header always set Cross-Origin-Embedder-Policy "credentialless"');
  });

  it.skipIf(!existsSync(indexFile))('allows every inline script and handler of the built index.html', () => {
    const html = readFileSync(indexFile, 'utf8');
    const scriptSrc = webPolicy!.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '))!;
    const handlers = [...html.matchAll(/\son[a-z]+\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
    const scripts = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(([, attributes, body]) => body.trim() && !/type\s*=\s*"application\/(ld\+)?json"/i.test(attributes))
      .map(([, , body]) => body);
    for (const code of [...handlers, ...scripts]) expect(scriptSrc, code.slice(0, 80)).toContain(sha256(code));
  });
});
