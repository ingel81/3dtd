import { describe, it, expect } from 'vitest';
import { clientInfoFrom, clientLabel, mixedEngines } from './client-info';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const EDGE = `${CHROME} Edg/140.0.3485.54`;
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';
const ELECTRON = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) 3dtd/0.4.0 Chrome/138.0.7204.100 Electron/37.2.0 Safari/537.36';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

describe('clientInfoFrom', () => {
  it('tells the browser, its version, engine family and system from the user agent', () => {
    expect(clientInfoFrom(CHROME)).toEqual({ engine: 'Chrome', version: '140.0.0.0', family: 'blink', os: 'Windows' });
    expect(clientInfoFrom(EDGE)).toEqual({ engine: 'Edge', version: '140.0.3485.54', family: 'blink', os: 'Windows' });
    expect(clientInfoFrom(FIREFOX)).toEqual({ engine: 'Firefox', version: '143.0', family: 'gecko', os: 'Windows' });
    expect(clientInfoFrom(ELECTRON)).toEqual({ engine: 'Electron', version: '37.2.0, Chromium 138', family: 'blink', os: 'Linux' });
    expect(clientInfoFrom(SAFARI)).toEqual({ engine: 'Safari', version: '18.0', family: 'webkit', os: 'macOS' });
    expect(clientInfoFrom('curl/8')).toEqual({ engine: 'Browser', version: '', family: 'other', os: '' });
  });

  it('labels a client and finds engines that compute differently', () => {
    expect(clientLabel(clientInfoFrom(FIREFOX))).toBe('Firefox 143.0, Windows');
    expect(mixedEngines([clientInfoFrom(CHROME), clientInfoFrom(ELECTRON), null])).toBe(false);
    expect(mixedEngines([clientInfoFrom(CHROME), clientInfoFrom(FIREFOX)])).toBe(true);
  });
});
