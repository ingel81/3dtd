/**
 * @angular/core for the bundled simulation: the real one, with inject() on
 * a plain record of services, as the scenario specs mock it
 * (resimulation.scenario.spec.ts); Angular's DI needs an injection context.
 * build.mjs sends every other import of @angular/core here, this one
 * reaches the real module.
 */
export * from '@angular/core';
import { noopStub } from '../../src/app/integration/noop-stub';

export const services: Record<string, unknown> = {};

export function Injectable(): (target: unknown) => unknown {
  return (target) => target;
}

export function effect(): undefined {
  return undefined;
}

export function inject(token: { name?: string }): unknown {
  const name = token?.name ?? 'unknown';
  if (!services[name]) services[name] = noopStub();
  return services[name];
}
