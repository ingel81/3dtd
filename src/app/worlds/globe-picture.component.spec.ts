// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Input } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { GlobePictureComponent, GlobePictures } from './globe-picture.component';

for (const name of ['world', 'src', 'label']) Input({ alias: name, isSignal: true } as Input)(GlobePictureComponent.prototype, name);

/** A world's globe as an icon: its still picture, the world's disc until there is one, named for the reader */
describe('GlobePictureComponent', () => {
  beforeAll(() => {
    try {
      getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
    } catch {
      // Another spec of this worker set it up
    }
  });
  afterEach(() => TestBed.resetTestingModule());

  function show(src: string | null) {
    const f = TestBed.createComponent(GlobePictureComponent);
    f.componentRef.setInput('world', 'osm');
    f.componentRef.setInput('label', 'OpenStreetMap');
    f.componentRef.setInput('src', src);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('shows the disc of its world while there is no picture, named by the label', () => {
    const el = show(null);
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('OpenStreetMap');
    expect(el.getAttribute('title')).toBe('OpenStreetMap');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.td-world-disc.is-osm')).not.toBeNull();
  });

  it('shows the picture once there is one, as decoration of its label', () => {
    const el = show('data:image/png;base64,AA');
    const img = el.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AA');
    expect(img.getAttribute('alt')).toBe('');
    expect(el.querySelector('.td-world-disc')).toBeNull();
  });

  it('keeps the pictures per world for the page', () => {
    const pictures = TestBed.inject(GlobePictures);
    pictures.set('real', 'a');
    pictures.set('maps', 'b');
    pictures.set('real', 'c');
    expect(pictures.all()).toEqual({ real: 'c', maps: 'b' });
  });
});
