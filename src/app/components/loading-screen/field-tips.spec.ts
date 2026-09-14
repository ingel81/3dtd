import { ɵ_sanitizeHtml as _sanitizeHtml } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { FIELD_TIPS } from './field-tips';

/**
 * loading-screen.component.html binds tip.html via [innerHTML], which runs
 * every string through Angular's DomSanitizer. Attributes the sanitizer
 * does not allow (e.g. `style=`) get silently stripped and log
 * "WARNING: sanitizing HTML stripped some content" - this is how the
 * gold/teal accent colours went missing. Guard against a regression by
 * running each tip through the same sanitizer Angular uses at runtime.
 */
describe('FIELD_TIPS sanitization', () => {
  it('passes every tip through Angular\'s HTML sanitizer unchanged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    for (const tip of FIELD_TIPS) {
      _sanitizeHtml(document, tip.html);
    }

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('has no inline style attributes (sanitizer always strips those)', () => {
    for (const tip of FIELD_TIPS) {
      expect(tip.html).not.toContain('style=');
    }
  });
});
