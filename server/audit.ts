/**
 * Action History + Version Snapshot – Document Service Middleware
 * - Action: lưu payload vào afterData
 * - Snapshot: luôn re-fetch với deep populate để đảm bảo có đủ dữ liệu con (relations, components lồng nhau)
 */

import path from 'path';
import fs from 'fs';

const AUDIT_MODEL = 'plugin::presence.action-history';
const VERSION_UID = 'plugin::presence.version';

const TRACKED_ACTIONS = new Set([
  'create', 'update', 'publish', 'unpublish', 'delete', 'discardDraft',
]);

/** Media, Users, Roles, Content (api::*) */
const TRACKED_UID_PREFIXES = ['api::'];
  /** Media, Users, Roles tracked via db.lifecycles only */

/** Lấy thư mục components từ Strapi – dùng API chính thức, hoạt động cả dev/prod */
function getComponentsDir(strapi: any): string | null {
  const root = strapi?.dirs?.app?.root ?? process.cwd();
  const direct = strapi?.dirs?.app?.components;
  if (direct && fs.existsSync(direct)) return direct;
  const joined = path.join(root, 'src', 'components');
  if (fs.existsSync(joined)) return joined;
  return null;
}

function isTrackedUid(uid: string): boolean {
  if (!uid) return false;
  return TRACKED_UID_PREFIXES.some((p) => uid.startsWith(p)) || false;
}

/** Snapshot only for api::* in snapshotContentTypes (recovery). Lifecycle = action log only. */
function shouldSnapshot(strapi: any, uid: string): boolean {
  const pluginConfig = strapi.config?.get?.('plugin::presence') || {};
  const config = pluginConfig.config || pluginConfig;
  const list = config.snapshotContentTypes;
  return Array.isArray(list) && list.length > 0 && list.includes(uid);
}

function getUserInfo(strapi: any): { user: any; source: 'admin' | 'api' } {
  try {
    const ctx = strapi.requestContext?.get?.();
    if (!ctx?.state) return { user: null, source: 'api' };
    const cred = ctx.state?.auth?.credentials;
    if (cred?.id && cred?.email) {
      return {
        user: {
          id: cred.id,
          username: (cred.firstname ? `${cred.firstname} ${cred.lastname || ''}`.trim() : cred.username) || cred.email,
          email: cred.email,
        },
        source: 'admin',
      };
    }
    const apiUser = ctx.state?.user;
    if (apiUser?.id) {
      return {
        user: { id: apiUser.id, username: apiUser.username || apiUser.email, email: apiUser.email },
        source: 'api',
      };
    }
    return { user: null, source: 'api' };
  } catch {
    return { user: null, source: 'api' };
  }
}

/** Get schema với fallback đọc file (Strapi 5 có thể không expose components qua API) */
function getSchema(strapi: any, uid: string): any {
  const tryUids = [uid];
  if (!uid.includes('::')) {
    tryUids.push(`component::${uid}`);
    if (!uid.startsWith('components.')) tryUids.push(`components.${uid}`);
    if (uid.includes('.')) {
      const [cat, ...rest] = uid.split('.');
      if (cat?.endsWith('s') && rest.length) tryUids.push(`${cat.slice(0, -1)}.${rest.join('.')}`);
    }
  }
  for (const u of tryUids) {
    try {
      const m = strapi.getModel?.(u);
      if (m?.attributes) return m;
    } catch {}
    try {
      const ct = strapi.contentType?.(u);
      if (ct?.attributes) return ct;
    } catch {}
    try {
      const comp = strapi.components?.[u];
      if (comp?.attributes) return comp;
    } catch {}
  }
  if (!uid.includes('::') && uid.includes('.')) {
    const parts = uid.split('.');
    const category = parts[0];
    const name = parts.slice(1).join('.');
    if (category && name) {
      try {
        const componentsDir = getComponentsDir(strapi);
        if (componentsDir) {
          const schemaPath = path.join(componentsDir, category, `${name}.json`);
          if (fs.existsSync(schemaPath)) {
            const raw = fs.readFileSync(schemaPath, 'utf-8');
            const schema = JSON.parse(raw);
            if (schema?.attributes) return schema as any;
          }
        }
      } catch {}
    }
  }
  return null;
}

/** Deep populate từ schema (components, dynamic zones, relations, media) */
function getDeepPopulate(strapi: any, uid: string, depth = 5, visited = new Set<string>()): any {
  if (depth <= 0 || visited.has(uid)) return {};
  visited.add(uid);

  const schema = getSchema(strapi, uid);
  if (!schema?.attributes) return {};

  const populate: any = {};
  for (const [key, attribute] of Object.entries(schema.attributes) as [string, any][]) {
    switch (attribute.type) {
      case 'component':
        if (attribute.component) {
          const nested = getDeepPopulate(strapi, attribute.component, depth - 1, new Set(visited));
          populate[key] = Object.keys(nested).length > 0 ? { populate: nested } : true;
        }
        break;
      case 'dynamiczone':
        if (attribute.components?.length) {
          const onFragments: any = {};
          for (const compUid of attribute.components) {
            const compPop = getDeepPopulate(strapi, compUid, depth - 1, new Set(visited));
            onFragments[compUid] = Object.keys(compPop).length > 0 ? { populate: compPop } : true;
          }
          populate[key] = { on: onFragments };
        }
        break;
      case 'relation':
        if (attribute.target && !visited.has(attribute.target)) {
          const relPop = getDeepPopulate(strapi, attribute.target, depth - 1, new Set(visited));
          populate[key] = Object.keys(relPop).length > 0 ? { populate: relPop } : { populate: '*' };
        } else {
          populate[key] = { populate: '*' };
        }
        break;
      case 'media':
        populate[key] = true;
        break;
    }
  }
  return populate;
}

export function registerActionHistory(strapi: any) {
  strapi.documents.use(async (context: any, next: any) => {
    const { action, uid } = context;
    if (!uid || !isTrackedUid(uid)) return next();
    if (!TRACKED_ACTIONS.has(action)) return next();
    if (uid === AUDIT_MODEL) return next();
    if (context.state?.isPresenceInternal) return next();
    const reqCtx = strapi.requestContext?.get?.();
    if (context.state?.isPresenceRestore || context.params?.state?.isPresenceRestore || reqCtx?.state?.isPresenceRestore) return next();

    let preDeleteData: any = null;
    if (action === 'delete' && uid.startsWith('api::') && shouldSnapshot(strapi, uid)) {
      const docId = context.params?.documentId ?? context.params?.where?.documentId;
      const where = context.params?.where;
      const locale = context.params?.locale;
      try {
        const deepPopulate = getDeepPopulate(strapi, uid, 5);
        const docOpts: any = { populate: deepPopulate, state: { isPresenceInternal: true } };
        if (docId) {
          preDeleteData = await strapi.documents(uid).findOne({
            documentId: docId,
            locale: locale || undefined,
            ...docOpts,
          });
        } else if (where && typeof where === 'object') {
          const many = await strapi.documents(uid).findMany({
            filters: where,
            locale: locale || undefined,
            ...docOpts,
          });
          if (many) {
            const arr = Array.isArray(many) ? many : (many.results ?? Object.values(many));
            preDeleteData = Array.isArray(arr) && arr.length > 0 ? arr : (arr ? [arr] : null);
          }
        }
      } catch (err: any) {
        strapi.log.warn(`[Presence] Pre-delete fetch failed: ${err?.message}`);
      }
    }

    const result = await next();

    const { user, source } = getUserInfo(strapi);
    const documentId = result?.documentId ?? context.params?.documentId ?? context.params?.where?.documentId ?? null;
    const locale = result?.locale ?? context.params?.locale ?? null;
    const payload = context.params?.data ?? null;

    setTimeout(async () => {
      try {
        let versionDocumentId: string | null = null;
        let beforeData: any = null;

        if (action === 'delete') {
          if (preDeleteData && shouldSnapshot(strapi, uid)) {
            beforeData = preDeleteData;
            try {
              const historyService = strapi.plugin('presence').service('history-service');
              const author = user ? { id: user.id, email: user.email, username: user.username } : null;
              const version = await historyService.createVersion(
                documentId || String(preDeleteData?.documentId ?? preDeleteData?.id),
                uid,
                preDeleteData,
                'draft',
                author
              );
              versionDocumentId = version?.documentId ?? null;
            } catch (err) {
              strapi.log.warn(`[Presence] Delete snapshot failed: ${(err as Error).message}`);
            }
          } else {
            beforeData = { payload: context.params, response: result };
          }
        } else if (uid.startsWith('api::') && ['create', 'update', 'publish'].includes(action) && documentId && shouldSnapshot(strapi, uid)) {
          try {
            /** Luôn re-fetch với deep populate – result từ create/update thường thiếu dữ liệu con (nested components, relations) */
            const deepPopulate = getDeepPopulate(strapi, uid, 5);
            const snapshotData = await strapi.documents(uid).findOne({
              documentId,
              locale: locale || undefined,
              status: action === 'publish' ? 'published' : 'draft',
              populate: deepPopulate,
              state: { isPresenceInternal: true },
            });
            if (snapshotData) {
              const historyService = strapi.plugin('presence').service('history-service');
              const author = user ? { id: user.id, email: user.email, username: user.username } : null;
              const version = await historyService.createVersion(
                documentId,
                uid,
                snapshotData,
                'draft',
                author
              );
              versionDocumentId = version?.documentId ?? null;
            }
          } catch (err) {
            strapi.log.warn(`[Presence] Snapshot failed: ${(err as Error).message}`);
          }
        }

        await strapi.db.query(AUDIT_MODEL).create({
          data: {
            action,
            contentType: uid,
            targetDocumentId: documentId,
            entryId: result?.id?.toString?.() ?? null,
            user,
            source,
            beforeData,
            afterData: action === 'delete' ? null : payload,
            filters: locale ? { locale } : null,
            resultCount: null,
            versionDocumentId,
          },
        });

        strapi.log.debug(`[Presence] ${action} ${uid.replace('api::', '').split('.')[0]} by ${user?.username || 'system'}`);
      } catch (err) {
        strapi.log.warn(`[Presence] Failed to log ${action} on ${uid}: ${(err as Error).message}`);
      }
    }, 600);

    return result;
  });

  strapi.db.lifecycles.subscribe({
    models: ['plugin::upload.file', 'admin::user', 'admin::role', 'plugin::users-permissions.user', 'plugin::users-permissions.role'],
    async afterCreate(e) { logFromLifecycle(strapi, 'create', (e.model && e.model.uid) || 'unknown', e.result); },
    async afterUpdate(e) { logFromLifecycle(strapi, 'update', (e.model && e.model.uid) || 'unknown', e.result); },
    async beforeDelete(e) {
      const uid = (e.model && e.model.uid) || 'unknown';
      let beforeData: any = null;
      if (shouldSnapshot(strapi, uid)) {
        try {
          const where = e.params?.where ?? (e.params?.id != null ? { id: e.params.id } : {});
          const entity = await strapi.db.query(uid).findOne({ where });
          if (entity) beforeData = entity;
        } catch (err: any) { strapi.log.warn(`[Presence] beforeDelete fetch failed: ${err?.message}`); }
      }
      await logFromLifecycle(strapi, 'delete', uid, e.params, beforeData);
    },
    async beforeDeleteMany(e) {
      const uid = (e.model && e.model.uid) || 'unknown';
      let beforeData: any = null;
      if (shouldSnapshot(strapi, uid)) {
        try {
          const where = e.params?.where ?? {};
          const entities = await strapi.db.query(uid).findMany({ where });
          if (entities && (Array.isArray(entities) ? entities.length : Object.keys(entities).length) > 0) {
            beforeData = Array.isArray(entities) ? entities : (entities.results ?? Object.values(entities));
          }
        } catch (err: any) { strapi.log.warn(`[Presence] beforeDeleteMany fetch failed: ${err?.message}`); }
      }
      await logFromLifecycle(strapi, 'delete', uid, e.params, beforeData);
    },
  });
  strapi.log.info('[Presence] Action (payload) + Version (full snapshot in background)');
  strapi.log.info('[Presence] Lifecycles: Media, Users, Roles');
}

/** Log action from db lifecycle (Media, Users, Roles - models that may use db directly) */
async function logFromLifecycle(strapi: any, action: string, model: string, data: any, beforeDataArg?: any) {
  if (model === AUDIT_MODEL) return;
  const { user, source } = getUserInfo(strapi);
  const documentId = data?.documentId ?? data?.id?.toString?.() ?? data?.where?.id?.toString?.() ?? data?.where?.documentId ?? null;
  const entryId = data?.id?.toString?.() ?? data?.documentId ?? data?.where?.id?.toString?.() ?? data?.where?.documentId ?? null;
  const payload = action === 'delete' ? null : (data && typeof data === 'object' ? { ...data } : null);
  if (payload && payload.id) delete payload.id;

  let beforeData: any = null;
  let versionDocumentId: string | null = null;
  if (action === 'delete') {
    if (beforeDataArg && shouldSnapshot(strapi, model)) {
      beforeData = typeof beforeDataArg === 'object' ? { ...beforeDataArg } : beforeDataArg;
      if (beforeData && beforeData.id) delete beforeData.id;
      try {
        const historyService = strapi.plugin('presence').service('history-service');
        const author = user ? { id: user.id, email: user.email, username: user.username } : null;
        const version = await historyService.createVersion(
          String(beforeData.documentId ?? beforeData.id ?? entryId ?? ''),
          model,
          beforeData,
          'draft',
          author
        );
        versionDocumentId = version?.documentId ?? null;
      } catch (err: any) { strapi.log.warn(`[Presence] Delete lifecycle snapshot failed: ${err?.message}`); }
    } else {
      beforeData = { payload: data, response: null };
    }
  }

  strapi.db.query(AUDIT_MODEL)
    .create({
      data: {
        action,
        contentType: model,
        targetDocumentId: documentId,
        entryId,
        user,
        source,
        beforeData,
        afterData: payload,
        filters: null,
        resultCount: null,
        versionDocumentId,
      },
    })
    .catch((err: Error) => strapi.log.warn(`[Presence] Lifecycle audit failed: ${err.message}`));
}
