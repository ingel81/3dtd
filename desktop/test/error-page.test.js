'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { errorPageHtml, errorPageUrl, isFatalLoadFailure } = require('../src/error-page');

describe('isFatalLoadFailure', () => {
  it('counts a failed main frame', () => {
    assert.equal(isFatalLoadFailure(-6, true), true); // FILE_NOT_FOUND
    assert.equal(isFatalLoadFailure(-102, true), true); // CONNECTION_REFUSED, dev server down
  });

  it('ignores subframes and loads replaced by another one', () => {
    assert.equal(isFatalLoadFailure(-6, false), false);
    assert.equal(isFatalLoadFailure(-3, true), false);
  });
});

describe('errorPageHtml', () => {
  const content = { heading: 'The game stopped', detail: 'renderer crashed, exit code 5', retryUrl: 'app://app/?l=1,2&s=3,4' };

  it('shows heading, detail and a link back to the game', () => {
    const html = errorPageHtml(content);
    assert.ok(html.includes('<h1>The game stopped</h1>'));
    assert.ok(html.includes('<code>renderer crashed, exit code 5</code>'));
    assert.ok(html.includes('<a href="app://app/?l=1,2&amp;s=3,4">Reload</a>'));
  });

  it('escapes what comes from outside', () => {
    const html = errorPageHtml({ ...content, detail: '<img src=x onerror=alert(1)>', retryUrl: 'app://app/?"><script>' });
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });

  it('runs no script at all', () => {
    const html = errorPageHtml(content);
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(!/<script/i.test(html));
  });
});

describe('errorPageUrl', () => {
  it('is a data URL that decodes to the page', () => {
    const content = { heading: 'H', detail: 'D', retryUrl: 'app://app/' };
    const url = errorPageUrl(content);
    assert.ok(url.startsWith('data:text/html;charset=utf-8,'));
    assert.equal(decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length)), errorPageHtml(content));
  });
});
