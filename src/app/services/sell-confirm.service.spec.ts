import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SELL_CONFIRM_WINDOW_MS, SellConfirmService } from './sell-confirm.service';

describe('SellConfirmService', () => {
  let service: SellConfirmService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new SellConfirmService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms on the first request and confirms on the second', () => {
    expect(service.request('t1')).toBe(false);
    expect(service.armedTowerId()).toBe('t1');

    expect(service.request('t1')).toBe(true);
    expect(service.armedTowerId()).toBeNull();
  });

  it('runs out after the window, the next request arms again', () => {
    service.request('t1');
    vi.advanceTimersByTime(SELL_CONFIRM_WINDOW_MS - 1);
    expect(service.armedTowerId()).toBe('t1');

    vi.advanceTimersByTime(1);
    expect(service.armedTowerId()).toBeNull();
    expect(service.request('t1')).toBe(false);
  });

  it('moves the confirmation to another tower instead of selling it', () => {
    service.request('t1');
    expect(service.request('t2')).toBe(false);
    expect(service.armedTowerId()).toBe('t2');

    // The first tower's timer must not clear the second one early
    vi.advanceTimersByTime(SELL_CONFIRM_WINDOW_MS - 1);
    expect(service.armedTowerId()).toBe('t2');
    expect(service.request('t2')).toBe(true);
  });

  it('disarm drops a pending confirmation', () => {
    service.request('t1');
    service.disarm();
    expect(service.armedTowerId()).toBeNull();
    expect(service.request('t1')).toBe(false);
  });
});
