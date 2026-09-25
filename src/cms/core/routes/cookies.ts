import 'server-only';

import { z } from 'zod';

import type { CmsConfig } from '../../config';
import { PERMISSIONS, requireApiPerm } from '../../modules/auth';
import { logAudit } from '../audit';
import { createRoute } from '../api/handler';
import { idParam } from '../api/params';
import { created, noContent, ok } from '../api/respond';
import {
  createCategory,
  createService,
  deleteCategory,
  deleteService,
  getCookieScan,
  listCookieCatalog,
  revalidateCookies,
  updateCategory,
  updateService,
} from '../cookies/service';

const localeMap = z.record(z.string(), z.string());

export function cookieCatalogRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.settingsRead),
    handler: async () => ok(await listCookieCatalog()),
  });
}

/** Read-only: it reports, it never writes. Adding a finding goes through
 *  `cookieServiceCreateRoute`, which is where the write permission and the
 *  audit entry already live. */
export function cookieScanRoute(config: CmsConfig) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.settingsRead),
    handler: async () => ok(await getCookieScan(config.storagePrefix)),
  });
}

const categoryBody = z.object({
  key: z.string().trim().min(1).max(64),
  name: localeMap,
  description: localeMap.nullish(),
  required: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

export function cookieCategoryCreateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
    input: categoryBody,
    handler: async ({ input, auth }) => {
      const id = await createCategory(input);
      revalidateCookies();
      await logAudit({ userId: auth.userId, action: 'cookies.category.create', subjectType: 'cookie_category', subjectId: id, after: input });
      return created({ id });
    },
  });
}

export function cookieCategoryUpdateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
    input: categoryBody.partial(),
    handler: async ({ params, input, auth }) => {
      const id = idParam(params.id);
      await updateCategory(id, input);
      revalidateCookies();
      await logAudit({ userId: auth.userId, action: 'cookies.category.update', subjectType: 'cookie_category', subjectId: id, after: input });
      return ok({ ok: true });
    },
  });
}

export function cookieCategoryDeleteRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
    handler: async ({ params, auth }) => {
      const id = idParam(params.id);
      await deleteCategory(id);
      revalidateCookies();
      await logAudit({ userId: auth.userId, action: 'cookies.category.delete', subjectType: 'cookie_category', subjectId: id });
      return noContent();
    },
  });
}

const serviceBody = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().trim().min(1).max(128),
  provider: z.string().max(128).nullish(),
  purpose: localeMap.nullish(),
  enabled: z.boolean().optional(),
});

export function cookieServiceCreateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
    input: serviceBody,
    handler: async ({ input, auth }) => {
      const id = await createService(input);
      revalidateCookies();
      await logAudit({ userId: auth.userId, action: 'cookies.service.create', subjectType: 'cookie_service', subjectId: id, after: input });
      return created({ id });
    },
  });
}

export function cookieServiceUpdateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
    input: serviceBody.partial(),
    handler: async ({ params, input, auth }) => {
      const id = idParam(params.id);
      await updateService(id, input);
      revalidateCookies();
      await logAudit({ userId: auth.userId, action: 'cookies.service.update', subjectType: 'cookie_service', subjectId: id, after: input });
      return ok({ ok: true });
    },
  });
}

export function cookieServiceDeleteRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
    handler: async ({ params, auth }) => {
      const id = idParam(params.id);
      await deleteService(id);
      revalidateCookies();
      await logAudit({ userId: auth.userId, action: 'cookies.service.delete', subjectType: 'cookie_service', subjectId: id });
      return noContent();
    },
  });
}
