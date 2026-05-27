/**
 * Action History + Version Snapshot – Document Service Middleware
 * - Action: lưu payload vào afterData
 * - Snapshot: luôn re-fetch với deep populate để đảm bảo có đủ dữ liệu con (relations, components lồng nhau)
 */

import path from 'path';
import fs from 'fs';

const AUDIT_MODEL = 'plugin::presence.action-history';

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

/** Các field do hệ thống Strapi tự sinh — không phải user-editable, luôn bỏ qua khi diff.
 *  Bao gồm timestamps, document metadata, tracked-by relations và i18n linkage. */
const SYSTEM_FIELDS = new Set([
  'id', 'documentId',
  'createdAt', 'updatedAt', 'publishedAt',
  'createdBy', 'updatedBy',
  'locale', 'localizations',
  'strapi_stage', 'strapi_assignee', 'strapi_release',
  '__component',
  // CM internal tracker cho item mới trong repeatable component, chỉ có ở payload
  '__temp_key__',
]);

/** Object dạng relation/media payload từ Content Manager: { set: [...] } hoặc { connect, disconnect }.
 *  Hoặc pre-state đã populate: object có documentId. Lưu ý: components trong Strapi v5 KHÔNG có
 *  documentId (chỉ có id số), nên check theo documentId để không nhầm component thành relation. */
function isRelationLike(val: any): boolean {
  if (!val || typeof val !== 'object') return false;
  if (Array.isArray(val)) {
    return val.length > 0 && val.every((v) => v && typeof v === 'object' && 'documentId' in v && !('__component' in v));
  }
  if ('set' in val || 'connect' in val || 'disconnect' in val) return true;
  if ('documentId' in val && !('__component' in val)) return true;
  return false;
}

/** So sánh sâu payload với pre-state.
 *  Trả về danh sách leaf-path đã đổi (vd: "seo.metaTitle", "sections[0].title").
 *  - Bỏ qua mọi SYSTEM_FIELDS ở mọi cấp.
 *  - Với relation/media field: chỉ báo tên field (không đi sâu vào property con của relation). */
function diffPayload(before: any, payload: any): string[] {
  const out: string[] = [];
  // Root entity tự nó cũng có `documentId` — KHÔNG coi root là relation, iterate trực tiếp các key.
  const beforeObj = before && typeof before === 'object' && !Array.isArray(before) ? before : {};
  const payloadObj = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(payloadObj)]);
  for (const key of keys) {
    if (SYSTEM_FIELDS.has(key)) continue;
    walkDiff(beforeObj[key], payloadObj[key], key, out);
  }
  return Array.from(new Set(out));
}

function walkDiff(before: any, payload: any, path: string, out: string[]): void {
  // Cùng tham chiếu / cùng giá trị nguyên thuỷ
  if (before === payload) return;

  const beforeIsObj = before && typeof before === 'object';
  const payloadIsObj = payload && typeof payload === 'object';

  // Relation/media: so sánh theo danh sách documentId (canonicalize 2 format
  // pre-state populated array vs payload {set} / {connect, disconnect} về cùng dạng).
  if ((beforeIsObj || payloadIsObj) && (isRelationLike(before) || isRelationLike(payload))) {
    if (diffRelation(before, payload)) {
      if (path) out.push(path);
    }
    return;
  }

  // Mảng (component repeatable / dynamic zone / array scalar) – cho phép một bên thiếu
  if (Array.isArray(before) || Array.isArray(payload)) {
    const beforeArr = Array.isArray(before) ? before : [];
    const payloadArr = Array.isArray(payload) ? payload : [];
    const max = Math.max(beforeArr.length, payloadArr.length);
    let lengthChanged = beforeArr.length !== payloadArr.length;
    for (let i = 0; i < max; i++) {
      const a = beforeArr[i];
      const b = payloadArr[i];
      if (a && b && typeof a === 'object' && typeof b === 'object') {
        walkDiff(a, b, `${path}[${i}]`, out);
      } else if (JSON.stringify(normalizeForDiff(a)) !== JSON.stringify(normalizeForDiff(b))) {
        out.push(`${path}[${i}]`);
      }
    }
    if (lengthChanged && path && !out.some((p) => p.startsWith(`${path}[`))) {
      out.push(path);
    }
    return;
  }

  // Object thường (component, nested struct) – cho phép một bên thiếu (create / xoá nhánh)
  const beforeIsPlainObj = beforeIsObj && !Array.isArray(before);
  const payloadIsPlainObj = payloadIsObj && !Array.isArray(payload);
  if (beforeIsPlainObj || payloadIsPlainObj) {
    const beforeKeys = beforeIsPlainObj ? Object.keys(before) : [];
    const payloadKeys = payloadIsPlainObj ? Object.keys(payload) : [];
    const keys = new Set([...beforeKeys, ...payloadKeys]);
    for (const key of keys) {
      if (SYSTEM_FIELDS.has(key)) continue;
      const subPath = path ? `${path}.${key}` : key;
      walkDiff(beforeIsPlainObj ? before[key] : undefined, payloadIsPlainObj ? payload[key] : undefined, subPath, out);
    }
    return;
  }

  // Một bên null/undefined, hoặc kiểu khác nhau, hoặc primitive khác nhau
  if (JSON.stringify(normalizeForDiff(before)) !== JSON.stringify(normalizeForDiff(payload))) {
    if (path) out.push(path);
  }
}

/** Lấy giá trị theo path dạng "a.b[2].c" trên object. Trả undefined nếu không tới được. */
function getByPath(obj: any, path: string): any {
  if (!path) return obj;
  const tokens: Array<string | number> = [];
  const re = /[^.[\]]+|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    tokens.push(m[1] !== undefined ? Number(m[1]) : m[0]);
  }
  let cur: any = obj;
  for (const tok of tokens) {
    if (cur == null) return undefined;
    cur = typeof tok === 'number' ? (Array.isArray(cur) ? cur[tok] : undefined) : cur[tok];
  }
  return cur;
}

/** Tóm tắt giá trị về dạng có thể lưu/hiển thị: scalar giữ nguyên, object/array → summary nhẹ. */
function summarizeValue(val: any): any {
  if (val == null) return null;
  if (typeof val === 'string') return val.length > 2000 ? val.slice(0, 2000) + '…' : val;
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  // Relation/media → list documentId
  const ids = collectRelationIds(val);
  if (ids != null) return ids.length === 0 ? null : (ids.length === 1 ? ids[0] : ids);
  if (Array.isArray(val)) return `[Array(${val.length})]`;
  if (typeof val === 'object') {
    const json = JSON.stringify(val);
    return json.length > 2000 ? json.slice(0, 2000) + '…' : json;
  }
  return String(val);
}

/** Sinh map { path -> { before, after } } cho từng changed leaf-path. */
function buildChangedValues(before: any, payload: any, paths: string[]): Record<string, { before: any; after: any }> {
  const out: Record<string, { before: any; after: any }> = {};
  for (const p of paths) {
    out[p] = {
      before: summarizeValue(getByPath(before, p)),
      after: summarizeValue(getByPath(payload, p)),
    };
  }
  return out;
}

/** Thu thập danh sách documentId từ relation/media ở mọi format có thể gặp.
 *  Trả null nếu là form {connect/disconnect} (không xác định được final state nếu không có before). */
function collectRelationIds(val: any): string[] | null {
  if (val == null) return [];
  if (Array.isArray(val)) {
    return val
      .map((v) => (v && typeof v === 'object' ? String(v.documentId ?? v.id ?? '') : ''))
      .filter(Boolean)
      .sort();
  }
  if (typeof val === 'object') {
    if ('set' in val && Array.isArray(val.set)) {
      return val.set
        .map((v: any) => (v && typeof v === 'object' ? String(v.documentId ?? v.id ?? '') : ''))
        .filter(Boolean)
        .sort();
    }
    if ('connect' in val || 'disconnect' in val) return null;
    if ('documentId' in val) return [String(val.documentId)];
    if ('id' in val) return [String(val.id)];
  }
  return [];
}

/** So sánh relation: trả true nếu thực sự đổi. */
function diffRelation(before: any, payload: any): boolean {
  // Payload form {connect/disconnect}: chỉ đổi nếu có item trong connect hoặc disconnect.
  if (payload && typeof payload === 'object' && !Array.isArray(payload) &&
    ('connect' in payload || 'disconnect' in payload) && !('set' in payload)) {
    const c = Array.isArray(payload.connect) ? payload.connect.length : 0;
    const d = Array.isArray(payload.disconnect) ? payload.disconnect.length : 0;
    return c > 0 || d > 0;
  }
  const beforeIds = collectRelationIds(before) ?? [];
  const payloadIds = collectRelationIds(payload) ?? [];
  if (beforeIds.length !== payloadIds.length) return true;
  for (let i = 0; i < beforeIds.length; i++) {
    if (beforeIds[i] !== payloadIds[i]) return true;
  }
  return false;
}

/** Chuẩn hoá relation/media về danh sách documentId để so sánh nhất quán giữa pre-state (object đầy đủ)
 *  và payload (có thể là { set: [...] }, array ids, hoặc array objects). */
function normalizeForDiff(val: any): any {
  if (val == null) return null;
  if (Array.isArray(val)) return val.map(normalizeForDiff);
  if (typeof val === 'object') {
    if ('set' in val && Array.isArray(val.set)) return val.set.map(normalizeForDiff);
    if ('connect' in val || 'disconnect' in val) {
      return { connect: (val.connect ?? []).map(normalizeForDiff), disconnect: (val.disconnect ?? []).map(normalizeForDiff) };
    }
    if ('documentId' in val && !('__component' in val)) return { documentId: val.documentId };
    const out: any = {};
    for (const k of Object.keys(val).sort()) {
      if (k === 'id' || k === 'createdAt' || k === 'updatedAt' || k === 'publishedAt') continue;
      out[k] = normalizeForDiff(val[k]);
    }
    return out;
  }
  return val;
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

function getUserInfo(strapi: any): { user: any; source: 'admin' | 'api'; ip: string | null; userAgent: string | null } {
  try {
    const ctx = strapi.requestContext?.get?.();
    const ip = ctx?.request?.ip ?? ctx?.ip ?? ctx?.request?.headers?.['x-forwarded-for'] ?? null;
    const userAgent = ctx?.request?.headers?.['user-agent'] ?? null;
    if (!ctx?.state) return { user: null, source: 'api', ip, userAgent };
    const cred = ctx.state?.auth?.credentials;
    if (cred?.id && cred?.email) {
      return {
        user: {
          id: cred.id,
          username: (cred.firstname ? `${cred.firstname} ${cred.lastname || ''}`.trim() : cred.username) || cred.email,
          email: cred.email,
        },
        source: 'admin',
        ip,
        userAgent,
      };
    }
    const apiUser = ctx.state?.user;
    if (apiUser?.id) {
      return {
        user: { id: apiUser.id, username: apiUser.username || apiUser.email, email: apiUser.email },
        source: 'api',
        ip,
        userAgent,
      };
    }
    return { user: null, source: 'api', ip, userAgent };
  } catch {
    return { user: null, source: 'api', ip: null, userAgent: null };
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
    } catch { }
    try {
      const ct = strapi.contentType?.(u);
      if (ct?.attributes) return ct;
    } catch { }
    try {
      const comp = strapi.components?.[u];
      if (comp?.attributes) return comp;
    } catch { }
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
      } catch { }
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

    // Pre-fetch state để diff với payload (cho update) hoặc snapshot khi delete.
    let preUpdateData: any = null;
    if (action === 'update' && uid.startsWith('api::')) {
      const docId = context.params?.documentId ?? context.params?.where?.documentId;
      const localeParam = context.params?.locale;
      if (docId) {
        try {
          preUpdateData = await strapi.documents(uid).findOne({
            documentId: docId,
            locale: localeParam || undefined,
            status: 'draft',
            // Luôn deep-populate để diff thấy thay đổi ở component/DZ lồng — kể cả khi
            // content-type không bật snapshot.
            populate: getDeepPopulate(strapi, uid, 5),
            state: { isPresenceInternal: true },
          });
        } catch (err: any) {
          strapi.log.warn(`[Presence] Pre-update fetch failed: ${err?.message}`);
        }
      }
    }

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

    const { user, source, ip, userAgent } = getUserInfo(strapi);
    const documentId = result?.documentId ?? context.params?.documentId ?? context.params?.where?.documentId ?? null;
    const locale = result?.locale ?? context.params?.locale ?? null;
    const payload = context.params?.data ?? null;
    const snapshotStatus: 'draft' | 'published' = action === 'publish' ? 'published' : 'draft';

    let versionDocumentId: string | null = null;
    let beforeData: any = null;

    // No-op detection: chỉ áp dụng cho update. Các action khác (create/publish/unpublish/delete/discardDraft)
    // mặc định coi là có thay đổi vì bản chất chúng đổi trạng thái document.
    let changedFields: string[] | null = null;
    let changedValues: Record<string, { before: any; after: any }> | null = null;
    let hasChanges = true;
    if (action === 'update' && preUpdateData && payload && typeof payload === 'object') {
      changedFields = diffPayload(preUpdateData, payload);
      hasChanges = changedFields.length > 0;
      if (hasChanges) changedValues = buildChangedValues(preUpdateData, payload, changedFields);
    } else if (action === 'create' && payload && typeof payload === 'object') {
      // Với create: diff với object rỗng để có cùng dạng leaf-path như update.
      changedFields = diffPayload({}, payload);
      if (changedFields.length > 0) changedValues = buildChangedValues({}, payload, changedFields);
    }

    try {
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
      } else if (uid.startsWith('api::') && ['create', 'update', 'publish'].includes(action) && documentId && shouldSnapshot(strapi, uid) && hasChanges) {
        try {
          /** Luôn re-fetch với deep populate – result từ create/update thường thiếu dữ liệu con (nested components, relations) */
          const deepPopulate = getDeepPopulate(strapi, uid, 5);
          const snapshotData = await strapi.documents(uid).findOne({
            documentId,
            locale: locale || undefined,
            status: snapshotStatus,
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
              snapshotStatus,
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
          status: snapshotStatus,
          locale,
          ip,
          userAgent,
          beforeData,
          afterData: action === 'delete' ? null : payload,
          filters: locale ? { locale } : null,
          resultCount: null,
          versionDocumentId,
          hasChanges,
          changedFields: changedFields && changedFields.length > 0 ? changedFields : null,
          changedValues,
        },
      });

      strapi.log.debug(`[Presence] ${action} ${uid.replace('api::', '').split('.')[0]} by ${user?.username || 'system'}${hasChanges ? '' : ' (no-op)'}`);
    } catch (err) {
      strapi.log.warn(`[Presence] Failed to log ${action} on ${uid}: ${(err as Error).message}`);
    }

    return result;
  });

  strapi.db.lifecycles.subscribe({
    models: ['plugin::upload.file', 'admin::user', 'admin::role', 'plugin::users-permissions.user', 'plugin::users-permissions.role'],
    async afterCreate(e: any) { logFromLifecycle(strapi, 'create', (e.model && e.model.uid) || 'unknown', e.result); },
    async afterUpdate(e: any) { logFromLifecycle(strapi, 'update', (e.model && e.model.uid) || 'unknown', e.result); },
    async beforeDelete(e: any) {
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
    async beforeDeleteMany(e: any) {
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
  // strapi.log.info('[Presence] Action (payload) + Version (full snapshot in background)');
  // strapi.log.info('[Presence] Lifecycles: Media, Users, Roles');
}

/** Log action from db lifecycle (Media, Users, Roles - models that may use db directly) */
async function logFromLifecycle(strapi: any, action: string, model: string, data: any, beforeDataArg?: any) {
  if (model === AUDIT_MODEL) return;
  const { user, source, ip, userAgent } = getUserInfo(strapi);
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
        status: 'draft',
        locale: null,
        ip,
        userAgent,
        beforeData,
        afterData: payload,
        filters: null,
        resultCount: null,
        versionDocumentId,
        hasChanges: true,
        changedFields: null,
      },
    })
    .catch((err: Error) => strapi.log.warn(`[Presence] Lifecycle audit failed: ${err.message}`));
}
