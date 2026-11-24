import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { ALLOW_WITHOUT_CONSENT_KEY } from './allow-without-consent.decorator';

/**
 * M1.7b2 phase B: the routes a learner may call while `blocked`. Growing this
 * list is a TL-reviewed decision (docs/api/api.md); the test makes it visible.
 */
const REVIEWED_ALLOWLIST = [
  'GET /legal/documents/current',
  'GET /users/me/consents',
  'POST /users/me/consents/accept',
  'PUT /users/me/consents/optional/:type',
  'POST /auth/logout',
  'GET /auth/me',
  'POST /auth/email-verification/request',
  'GET /users/me',
  'GET /users/me/profile',
  'POST /users/me/deletion-request',
  'POST /users/me/data-exports',
  'GET /users/me/data-exports',
  'GET /users/me/data-exports/:id/download',
].sort();

type ControllerClass = abstract new (...args: never[]) => object;

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

function joinPath(...parts: string[]): string {
  return `/${parts
    .flatMap((part) => part.split('/'))
    .filter((segment) => segment !== '')
    .join('/')}`;
}

function routes(): Array<{ key: string; allowed: boolean }> {
  const reflector = new Reflector();
  const found: Array<{ key: string; allowed: boolean }> = [];
  for (const file of controllerFiles(join(__dirname, '..'))) {
    // requireActual runs the file through Jest's TypeScript transform.
    const exported = Object.values(
      jest.requireActual<Record<string, unknown>>(file),
    );
    for (const value of exported) {
      if (typeof value !== 'function') continue;
      const controller = value as ControllerClass;
      const base = Reflect.getMetadata(PATH_METADATA, controller) as
        | string
        | undefined;
      if (base === undefined) continue;
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          | RequestMethod
          | undefined;
        if (method === undefined) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        found.push({
          key: `${RequestMethod[method]} ${joinPath(base, path)}`,
          allowed:
            reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_CONSENT_KEY, [
              handler,
              controller,
            ]) === true,
        });
      }
    }
  }
  return found;
}

describe('@AllowWithoutConsent inventory', () => {
  it('finds the controllers it scans', () => {
    // Guards the scan itself: an empty walk would pass the test below.
    expect(routes().length).toBeGreaterThan(100);
  });

  it('marks exactly the reviewed allowlist', () => {
    const allowed = routes()
      .filter((route) => route.allowed)
      .map((route) => route.key)
      .sort();
    expect(allowed).toEqual(REVIEWED_ALLOWLIST);
  });
});
