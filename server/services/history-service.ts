import path from 'path';
import fs from 'fs';
import { factories } from '@strapi/strapi';
import { step, type RestoreStep, type RestoreAssessment } from './restore-steps';

const RESTORE_CANCEL_TOKENS = new Map<string, boolean>();
const RESTORE_CHECKPOINTS = new Map<string, unknown>();

const VERSION_UID = 'plugin::presence.version';

const SYSTEM_FIELDS = [
  'id',
  'documentId',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'publishedBy',
  'status',
  'locale',
  'localizations',
  'v',
  '_v',
];

/** Strapi metadata – __component trong dynamiczone không phải attribute của component */
const METADATA_KEYS = ['__component'];

/** Lấy thư mục components từ Strapi – dùng API chính thức, hoạt động cả dev/prod */
function getComponentsDir(strapi: any): string | null {
  const root = strapi?.dirs?.app?.root ?? process.cwd();
  const direct = strapi?.dirs?.app?.components;
  if (direct && fs.existsSync(direct)) return direct;
  const joined = path.join(root, 'src', 'components');
  if (fs.existsSync(joined)) return joined;
  return null;
}

/** Get schema with fallbacks – thử nhiều format UID + đọc file khi Strapi API không trả component */
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
  // Fallback: đọc schema từ file – dùng strapi.dirs (API Strapi), hoạt động dev/prod
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
            if (schema?.attributes) return schema;
          }
        }
      } catch { }
    }
  }
  return null;
}

/** Extract documentId + locale từ relation/media – hỗ trợ document_id, locale (vi, en...) */
function extractRelationItem(val: any, isMulti: boolean): Array<{ documentId: string; locale?: string }> | { documentId: string; locale?: string } | null {
  const docIdFrom = (o: any) => o?.documentId ?? o?.document_id ?? o?.id?.toString?.();
  const withLocale = (docId: string, o: any) =>
    (o && typeof o.locale === 'string' && o.locale)
      ? { documentId: docId, locale: o.locale }
      : { documentId: docId };
  if (val == null) return null;
  if (Array.isArray(val)) {
    const items = val
      .map((o) => {
        if (!o || typeof o !== 'object') return null;
        const docId = docIdFrom(o);
        if (!docId) return null;
        return withLocale(docId, o);
      })
      .filter((x): x is { documentId: string; locale?: string } => x != null && !!x.documentId);
    return isMulti ? items : items[0] ?? null;
  }
  if (typeof val === 'object') {
    const docId = docIdFrom(val);
    if (!docId) return null;
    return withLocale(docId, val);
  }
  if (typeof val === 'string' && /^[a-z0-9]{20,}$/i.test(val)) return { documentId: val };
  return null;
}

/** Check if documentId exists (relation/media) */
async function checkDocumentExists(strapi: any, targetUid: string, documentId: string, locale?: string): Promise<boolean> {
  try {
    const doc = await strapi.documents(targetUid).findOne({
      documentId,
      ...(locale ? { locale } : {}),
    });
    return !!doc;
  } catch {
    if (locale && targetUid === 'plugin::upload.file') {
      try {
        const doc = await strapi.documents(targetUid).findOne({ documentId });
        return !!doc;
      } catch {}
    }
    return false;
  }
}

/** Check media exists - plugin::upload.file uses documentId */
async function checkMediaExists(strapi: any, documentId: string): Promise<boolean> {
  try {
    const file = await strapi.documents('plugin::upload.file').findOne({ documentId });
    return !!file;
  } catch {
    return false;
  }
}

/** Resolve documentId to numeric id – Strapi entity validator queries by id */
async function resolveDocumentIdToId(strapi: any, targetUid: string, documentId: string, locale?: string): Promise<number | null> {
  try {
    const doc = await strapi.documents(targetUid).findOne({
      documentId,
      ...(locale ? { locale } : {}),
    });
    const id = doc?.id;
    if (id != null) return Number(id);
  } catch { }
  /** Media thường không localized – thử lại không cần locale */
  if (locale && targetUid === 'plugin::upload.file') {
    try {
      const doc = await strapi.documents(targetUid).findOne({ documentId });
      if (doc?.id != null) return Number(doc.id);
    } catch { }
  }
  if (targetUid === 'plugin::upload.file') {
    for (const key of ['document_id', 'documentId']) {
      try {
        const res = await strapi.db.query('plugin::upload.file').findMany({
          where: { [key]: documentId },
          limit: 1,
        });
        const arr = Array.isArray(res) ? res : (res?.results ?? []);
        const file = arr[0];
        if (file?.id != null) return Number(file.id);
      } catch { }
    }
  }
  return null;
}

/** Prepare snapshot for restore: relations/media → set format, validate existence, i18n */
async function prepareDataForRestore(
  strapi: any,
  data: unknown,
  schemaUid: string,
  steps: RestoreStep[],
  visited = new Set<string>()
): Promise<unknown> {
  if (!data || typeof data !== 'object') return data;

  // Handle arrays BEFORE the visited guard – repeatable components share the same
  // schemaUid for every item; the guard must not block sibling items.
  if (Array.isArray(data)) {
    const arr = data as any[];
    if (arr.length === 0) return [];
    return Promise.all(
      arr.map((item) => {
        if (item && typeof item === 'object' && '__component' in item) {
          return prepareDataForRestore(strapi, item, item.__component, steps, new Set(visited));
        }
        return prepareDataForRestore(strapi, item, schemaUid, steps, new Set(visited));
      })
    );
  }

  // Circular-reference guard for objects only
  if (visited.has(schemaUid)) return data;
  visited.add(schemaUid);

  const schema = getSchema(strapi, schemaUid);
  if (!schema) {
    steps.push(step('prepare', 'warn', `Schema không load được: ${schemaUid} – dùng dữ liệu gốc`, { schemaUid }));
  }

  const obj = data as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    if (SYSTEM_FIELDS.includes(key)) continue;
    if (METADATA_KEYS.includes(key)) {
      (cleaned as any)[key] = val;
      continue;
    }

    const attr = schema?.attributes?.[key];
    if (!attr) {
      steps.push(step('prepare', 'warn', `Thuộc tính không có trong schema: ${key} – giữ nguyên`, { key, schemaUid }));
      cleaned[key] = await prepareDataForRestore(strapi, val, schemaUid, steps, new Set(visited));
      continue;
    }

    switch (attr.type) {
      case 'relation': {
        /** Strapi 5 dùng documentId, không dùng numeric id – set: ['docId'] hoặc { documentId, locale? } */
        const isMulti = ['oneToMany', 'manyToMany', 'manyWay'].includes(attr.relation) || attr.morph === true;
        const extracted = extractRelationItem(val, isMulti);

        if (extracted !== null) {
          const items = Array.isArray(extracted) ? extracted : [extracted];
          const targetUid = attr.target;

          const validItems: Array<{ documentId: string; locale?: string }> = [];
          const invalidItems: string[] = [];

          for (const it of items) {
            const docId = typeof it === 'object' ? it.documentId : it;
            const loc = typeof it === 'object' ? it.locale : undefined;
            const exists = targetUid ? await checkDocumentExists(strapi, targetUid, String(docId), loc) : true;
            if (exists) {
              validItems.push(loc ? { documentId: String(docId), locale: loc } : { documentId: String(docId) });
            } else {
              invalidItems.push(String(docId));
            }
          }

          if (invalidItems.length > 0) {
            steps.push(
              step(
                'prepare',
                'warn',
                `Relation "${key}": ${invalidItems.length} document không tồn tại – bỏ qua: ${invalidItems.slice(0, 3).join(', ')}${invalidItems.length > 3 ? '...' : ''}`,
                { key, invalidIds: invalidItems }
              )
            );
          }

          if (attr.relation === 'manyWay' || attr.morph) {
            cleaned[key] = { set: validItems };
          } else if (isMulti) {
            const withLocale = validItems.some((i) => i.locale);
            cleaned[key] = { set: withLocale ? validItems : validItems.map((i) => i.documentId) };
          } else {
            const first = validItems[0];
            if (!first) {
              cleaned[key] = null;
            } else if (first.locale) {
              cleaned[key] = { set: [{ documentId: first.documentId, locale: first.locale }] };
            } else {
              cleaned[key] = first.documentId;
            }
          }
        } else {
          cleaned[key] = isMulti ? { set: [] } : null;
        }
        break;
      }
      case 'media': {
        /** Strapi 5: media (plugin::upload.file) dùng documentId – giống relation */
        const isMulti = attr.multiple === true;
        const extracted = extractRelationItem(val, isMulti);
        const items = extracted ? (Array.isArray(extracted) ? extracted : [extracted]) : [];

        const validItems: Array<{ documentId: string; locale?: string }> = [];
        const invalidIds: string[] = [];

        for (const it of items) {
          const docId = typeof it === 'object' ? it.documentId : it;
          const loc = typeof it === 'object' ? it.locale : undefined;
          const exists = await checkDocumentExists(strapi, 'plugin::upload.file', String(docId), loc);
          if (exists) {
            validItems.push(loc ? { documentId: String(docId), locale: loc } : { documentId: String(docId) });
          } else {
            invalidIds.push(String(docId));
          }
        }

        if (invalidIds.length > 0) {
          steps.push(
            step(
              'prepare',
              'warn',
              `Media "${key}": ${invalidIds.length} file không tồn tại – bỏ qua: ${invalidIds.slice(0, 3).join(', ')}${invalidIds.length > 3 ? '...' : ''}`,
              { key, invalidIds }
            )
          );
        }

        if (isMulti) {
          const withLocale = validItems.some((i) => i.locale);
          cleaned[key] = { set: withLocale ? validItems : validItems.map((i) => i.documentId) };
        } else {
          const first = validItems[0];
          cleaned[key] = first ? (first.locale ? { set: [{ documentId: first.documentId, locale: first.locale }] } : first.documentId) : null;
        }
        break;
      }
      case 'component':
        cleaned[key] = await prepareDataForRestore(
          strapi,
          val,
          attr.component ?? attr.target ?? schemaUid,
          steps,
          new Set(visited)
        );
        break;
      case 'dynamiczone':
        cleaned[key] = Array.isArray(val)
          ? await Promise.all(
            (val as any[]).map((frag) =>
              frag && typeof frag === 'object' && '__component' in frag
                ? prepareDataForRestore(strapi, frag, frag.__component, steps, new Set(visited))
                : frag
            )
          )
          : val;
        break;
      default:
        cleaned[key] = await prepareDataForRestore(strapi, val, schemaUid, steps, new Set(visited));
    }
  }

  return cleaned;
}

/** Chi tiết từng block trong dynamic zone (sections.program-grid-2, sections.partner-content, ...) */
interface DynamicZoneItem {
  displayName: string;
  relations: Record<string, { ok: number; missing: number }>;
  media: Record<string, { ok: number; missing: number }>;
  /** Tên các attribute là component (items, group1, group2...) – có thể chứa quan hệ bên trong */
  nestedComponents: string[];
  /** Quan hệ trong component con: "items.headLecturer", "group1.partnershipGroup"... */
  nestedRelations: Record<string, { ok: number; missing: number }>;
  count: number;
}

interface AssessmentStats {
  fieldsOk: number;
  fieldsLost: number;
  fieldsBasic: number;
  fieldsComponent: number;
  relationsOk: number;
  relationsMissing: number;
  mediaOk: number;
  mediaMissing: number;
  fieldNamesOk: string[];
  fieldNamesLost: string[];
  relationDetails: Record<string, { ok: number; missing: number }>;
  mediaDetails: Record<string, { ok: number; missing: number }>;
  schemaUnresolved: string[];
  /** Chi tiết theo từng loại component trong dynamic zone */
  dynamicZoneDetails: Record<string, DynamicZoneItem>;
}

/** Analyze snapshot for assessment - counts + collects field names */
async function analyzeForAssessment(
  strapi: any,
  data: unknown,
  schemaUid: string,
  stats: AssessmentStats,
  visited = new Set<string>(),
  rootUid?: string,
  parentDzUid?: string,
  parentCompPath?: string
): Promise<void> {
  if (!data || typeof data !== 'object') return;

  // Handle arrays BEFORE the visited guard – repeatable components share the same
  // schemaUid for every item; the guard must not block sibling items.
  if (Array.isArray(data)) {
    for (const item of data as any[]) {
      if (item && typeof item === 'object' && '__component' in item) {
        await analyzeForAssessment(strapi, item, item.__component, stats, new Set(visited), rootUid, parentDzUid, parentCompPath);
      } else {
        await analyzeForAssessment(strapi, item, schemaUid, stats, new Set(visited), rootUid, parentDzUid, parentCompPath);
      }
    }
    return;
  }

  // Circular-reference guard for objects only
  if (visited.has(schemaUid)) return;
  visited.add(schemaUid);
  const isRoot = !rootUid || schemaUid === rootUid;
  if (!rootUid) rootUid = schemaUid;

  const schema = getSchema(strapi, schemaUid);
  if (!schema && !stats.schemaUnresolved.includes(schemaUid)) {
    stats.schemaUnresolved.push(schemaUid);
  }

  const obj = data as Record<string, unknown>;
  for (const [key, val] of Object.entries(obj)) {
    if (SYSTEM_FIELDS.includes(key) || METADATA_KEYS.includes(key)) continue;
    const attr = schema?.attributes?.[key];

    if (!attr) {
      if (schema) {
        stats.fieldsLost += 1;
        stats.fieldNamesLost.push(isRoot ? key : `${schemaUid}.${key}`);
      }
      await analyzeForAssessment(strapi, val, schemaUid, stats, new Set(visited), rootUid, parentDzUid, parentCompPath);
      continue;
    }

    switch (attr.type) {
      case 'relation': {
        const isMulti = ['oneToMany', 'manyToMany', 'manyWay'].includes(attr.relation) || !!attr.morph;
        const extracted = extractRelationItem(val, isMulti);
        const items = extracted ? (Array.isArray(extracted) ? extracted : [extracted]) : [];
        let ok = 0;
        let miss = 0;
        for (const it of items) {
          const docId = typeof it === 'object' ? it.documentId : it;
          const loc = typeof it === 'object' ? it.locale : undefined;
          const exists = attr.target ? await checkDocumentExists(strapi, attr.target, docId, loc) : true;
          if (exists) {
            stats.relationsOk += 1;
            ok += 1;
          } else {
            stats.relationsMissing += 1;
            miss += 1;
          }
        }
        const relKey = isRoot ? key : `${schemaUid}.${key}`;
        if (ok > 0 || miss > 0) {
          if (!stats.relationDetails[relKey]) stats.relationDetails[relKey] = { ok: 0, missing: 0 };
          stats.relationDetails[relKey].ok += ok;
          stats.relationDetails[relKey].missing += miss;
          if (!isRoot && stats.dynamicZoneDetails[schemaUid]) {
            if (!stats.dynamicZoneDetails[schemaUid].relations[key]) stats.dynamicZoneDetails[schemaUid].relations[key] = { ok: 0, missing: 0 };
            stats.dynamicZoneDetails[schemaUid].relations[key].ok += ok;
            stats.dynamicZoneDetails[schemaUid].relations[key].missing += miss;
          }
          if (parentDzUid && stats.dynamicZoneDetails[parentDzUid]) {
            const nestKey = parentCompPath ? `${parentCompPath}.${key}` : key;
            if (!stats.dynamicZoneDetails[parentDzUid].nestedRelations[nestKey]) stats.dynamicZoneDetails[parentDzUid].nestedRelations[nestKey] = { ok: 0, missing: 0 };
            stats.dynamicZoneDetails[parentDzUid].nestedRelations[nestKey].ok += ok;
            stats.dynamicZoneDetails[parentDzUid].nestedRelations[nestKey].missing += miss;
          }
        }
        break;
      }
      case 'media': {
        const extracted = extractRelationItem(val, !!attr.multiple);
        const items = extracted ? (Array.isArray(extracted) ? extracted : [extracted]) : [];
        let ok = 0;
        let miss = 0;
        for (const it of items) {
          const docId = typeof it === 'object' ? it.documentId : it;
          const exists = await checkMediaExists(strapi, docId);
          if (exists) {
            stats.mediaOk += 1;
            ok += 1;
          } else {
            stats.mediaMissing += 1;
            miss += 1;
          }
        }
        const mediaKey = isRoot ? key : `${schemaUid}.${key}`;
        if (ok > 0 || miss > 0) {
          if (!stats.mediaDetails[mediaKey]) stats.mediaDetails[mediaKey] = { ok: 0, missing: 0 };
          stats.mediaDetails[mediaKey].ok += ok;
          stats.mediaDetails[mediaKey].missing += miss;
          if (!isRoot && stats.dynamicZoneDetails[schemaUid]) {
            if (!stats.dynamicZoneDetails[schemaUid].media[key]) stats.dynamicZoneDetails[schemaUid].media[key] = { ok: 0, missing: 0 };
            stats.dynamicZoneDetails[schemaUid].media[key].ok += ok;
            stats.dynamicZoneDetails[schemaUid].media[key].missing += miss;
          }
        }
        break;
      }
      case 'component':
        stats.fieldsOk += 1;
        stats.fieldsComponent += 1;
        if (isRoot) stats.fieldNamesOk.push(key);
        const nextDz = parentDzUid ?? (stats.dynamicZoneDetails[schemaUid] ? schemaUid : undefined);
        const nextPath = parentCompPath ? `${parentCompPath}.${key}` : (stats.dynamicZoneDetails[schemaUid] ? key : undefined);
        await analyzeForAssessment(strapi, val, attr.component ?? attr.target ?? schemaUid, stats, new Set(visited), rootUid, nextDz, nextPath);
        break;
      case 'dynamiczone':
        stats.fieldsOk += 1;
        stats.fieldsComponent += 1;
        if (isRoot) stats.fieldNamesOk.push(key);
        for (const frag of Array.isArray(val) ? val : []) {
          if (frag && typeof frag === 'object' && '__component' in frag) {
            const compUid = frag.__component as string;
            if (!stats.dynamicZoneDetails[compUid]) {
              const compSchema = getSchema(strapi, compUid);
              const displayName = compSchema?.info?.displayName ?? compUid.split('.').pop() ?? compUid;
              const nestedComponents = Object.entries(compSchema?.attributes || {})
                .filter(([, a]: [string, any]) => a?.type === 'component')
                .map(([k]) => k);
              stats.dynamicZoneDetails[compUid] = {
                displayName,
                relations: {},
                media: {},
                nestedComponents,
                nestedRelations: {},
                count: 0,
              };
            }
            stats.dynamicZoneDetails[compUid].count += 1;
            await analyzeForAssessment(strapi, frag, compUid, stats, new Set(visited), rootUid, compUid, undefined);
          }
        }
        break;
      default:
        stats.fieldsOk += 1;
        stats.fieldsBasic += 1;
        if (isRoot) stats.fieldNamesOk.push(key);
        await analyzeForAssessment(strapi, val, schemaUid, stats, new Set(visited), rootUid, parentDzUid, parentCompPath);
    }
  }
}

/** Validate schema changes: main vs deps */
function validateSchemaChanges(strapi: any, snapshot: any, contentType: string): RestoreStep[] {
  const steps: RestoreStep[] = [];
  const mainSchema = getSchema(strapi, contentType);
  if (!mainSchema) {
    steps.push(step('schema', 'error', `Không load được schema chính: ${contentType}`, { contentType }));
    return steps;
  }

  const snapshotKeys = snapshot && typeof snapshot === 'object' ? Object.keys(snapshot).filter((k) => !SYSTEM_FIELDS.includes(k)) : [];
  const schemaKeys = Object.keys(mainSchema.attributes || {});

  const missingInSchema = snapshotKeys.filter((k) => !schemaKeys.includes(k));
  const newInSchema = schemaKeys.filter((k) => !snapshotKeys.includes(k));

  if (missingInSchema.length > 0) {
    steps.push(
      step(
        'schema',
        'warn',
        `Schema đã thay đổi: ${missingInSchema.length} trường trong snapshot không còn trong schema – sẽ bỏ qua: ${missingInSchema.slice(0, 5).join(', ')}${missingInSchema.length > 5 ? '...' : ''}`,
        { missingInSchema }
      )
    );
  }

  const requiredNew = newInSchema.filter((k) => mainSchema.attributes[k]?.required);
  if (requiredNew.length > 0) {
    steps.push(
      step(
        'schema',
        'error',
        `Schema có trường required mới – restore có thể fail: ${requiredNew.join(', ')}`,
        { requiredNew }
      )
    );
  } else if (newInSchema.length > 0) {
    steps.push(
      step(
        'schema',
        'skip',
        `Schema có ${newInSchema.length} trường mới (không required) – có thể thiếu dữ liệu`,
        { newInSchema: newInSchema.slice(0, 10) }
      )
    );
  }

  return steps;
}

/** Metadata cần loại khỏi nested – giữ documentId, locale, __component. id = row id trong components_* không dùng khi restore */
const STRIP_FROM_NESTED = ['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'publishedAt', 'publishedBy', 'status', 'v', '_v'];

/** Đệ quy loại metadata bloat khỏi mọi object/array – kể cả trong relation đã populate */
function stripSystemFields(data: unknown): unknown {
  if (data == null) return data;
  if (Array.isArray(data)) {
    return data.map((item) => stripSystemFields(item));
  }
  if (typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data)) {
      if (STRIP_FROM_NESTED.includes(key)) continue;
      out[key] = stripSystemFields(val);
    }
    return out;
  }
  return data;
}

/** Chuỗi giống documentId (CUID/v4 uuid) */
const DOC_ID_PATTERN = /^[a-zA-Z0-9_-]{13,}$/;

/** Extract documentId từ object/media/relation – hỗ trợ string, document_id, data.attributes, ... */
function extractDocIdFromObject(o: any): string | null {
  if (o == null) return null;
  if (typeof o === 'string' && DOC_ID_PATTERN.test(o)) return o;
  if (typeof o !== 'object') return null;
  const docId =
    o.documentId ?? o.document_id ?? o.id?.toString?.() ??
    o.data?.documentId ?? o.data?.document_id ?? o.data?.id?.toString?.() ??
    o.data?.attributes?.documentId ?? o.attributes?.documentId ??
    o.attributes?.id?.toString?.();
  return docId ? String(docId) : null;
}

/** Object trông giống media/relation leaf – không áp dụng cho document/component có nhiều field */
function looksLikeMediaOrRelation(o: any): boolean {
  if (!o || typeof o !== 'object') return false;
  const keys = Object.keys(o);
  if (keys.length > 15) return false;
  const hasRef = 'documentId' in o || 'id' in o || (o.data && ('documentId' in o.data || 'id' in o.data));
  const hasMedia = 'url' in o || 'mime' in o || 'provider' in o;
  return (hasRef || hasMedia) && !('__component' in o) && !('sections' in o) && !('title' in o && 'sections' in o);
}

/** Chuyển relation/media sang { documentId, locale? } để giảm kích thước snapshot */
function leanifySnapshot(data: unknown, schemaUid: string, getSchema: (u: string) => any, visited = new Set<string>()): unknown {
  if (!data || typeof data !== 'object') return data;

  // Handle arrays BEFORE the visited guard – repeatable components share the same
  // schemaUid for every item; the guard must not block sibling items in the array.
  if (Array.isArray(data)) {
    return (data as any[]).map((item) =>
      item && typeof item === 'object' && '__component' in item
        ? leanifySnapshot(item, item.__component, getSchema, new Set(visited))
        : leanifySnapshot(item, schemaUid, getSchema, new Set(visited))
    );
  }

  // Circular-reference guard for objects only
  if (visited.has(schemaUid)) return data;
  visited.add(schemaUid);

  const schema = getSchema(schemaUid);

  const obj = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    if (SYSTEM_FIELDS.includes(key)) continue;
    const attr = schema?.attributes?.[key];

    const toLeanRef = (o: any): { documentId: string; locale?: string } | null => {
      const docId = extractDocIdFromObject(o);
      if (!docId) return null;
      return (o && typeof o === 'object' && typeof o.locale === 'string' && o.locale)
        ? { documentId: docId, locale: o.locale }
        : { documentId: docId };
    };
    if (attr?.type === 'relation') {
      if (val == null) { out[key] = val; continue; }
      const isMultiRel = ['oneToMany', 'manyToMany', 'manyWay'].includes(attr.relation) || !!attr.morph;
      const arr = Array.isArray(val) ? val : [val];
      const lean = arr.map(toLeanRef).filter((x): x is NonNullable<ReturnType<typeof toLeanRef>> => x != null && !!x.documentId);
      out[key] = isMultiRel ? lean : lean[0] ?? null;
      continue;
    }
    if (attr?.type === 'media') {
      if (val == null) { out[key] = val; continue; }
      const arr = Array.isArray(val) ? val : [val];
      const lean = arr.map(toLeanRef).filter((x): x is NonNullable<ReturnType<typeof toLeanRef>> => x != null && !!x.documentId);
      out[key] = attr.multiple ? lean : lean[0] ?? null;
      continue;
    }
    if (attr?.type === 'component') {
      out[key] = leanifySnapshot(val, attr.component ?? attr.target ?? schemaUid, getSchema, new Set(visited));
      continue;
    }
    if (attr?.type === 'dynamiczone') {
      out[key] = Array.isArray(val)
        ? (val as any[]).map((f) =>
          f && typeof f === 'object' && '__component' in f
            ? leanifySnapshot(f, f.__component, getSchema, new Set(visited))
            : f
        )
        : val;
      continue;
    }
    if (!attr && typeof val === 'string' && DOC_ID_PATTERN.test(val)) {
      out[key] = { documentId: val }; continue;
    }
    if (!attr && val != null && typeof val === 'object' && !Array.isArray(val) && looksLikeMediaOrRelation(val)) {
      const ref = toLeanRef(val as any);
      if (ref) { out[key] = ref; continue; }
    }
    if (!attr && Array.isArray(val) && val.length > 0) {
      const first = val[0];
      if (first && typeof first === 'object' && looksLikeMediaOrRelation(first)) {
        const lean = (val as any[]).map(toLeanRef).filter((x): x is NonNullable<ReturnType<typeof toLeanRef>> => x != null && !!x.documentId);
        out[key] = lean.length === 1 && !((val as any[])[0]?.locale) ? lean[0] : lean;
        continue;
      }
    }
    out[key] = leanifySnapshot(val, schemaUid, getSchema, new Set(visited));
  }
  return out;
}

/** Pass đệ quy bổ sung: thay mọi object có url/documentId còn sót bằng { documentId, locale? } */
function deepLeanifyMediaAndRelations(data: unknown): unknown {
  if (data == null) return data;
  if (Array.isArray(data)) {
    return data.map((item) => deepLeanifyMediaAndRelations(item)).filter((x) => x != null);
  }
  if (typeof data === 'object') {
    // Skip empty objects – these are dead media/relation references
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return null;
    if (looksLikeMediaOrRelation(data as any)) {
      const docId = extractDocIdFromObject(data as any);
      if (docId) {
        const o = data as any;
        return (typeof o.locale === 'string' && o.locale)
          ? { documentId: docId, locale: o.locale }
          : { documentId: docId };
      }
    }
    const out: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      out[key] = deepLeanifyMediaAndRelations(val);
    }
    return out;
  }
  return data;
}
export default factories.createCoreService(VERSION_UID, ({ strapi }) => ({
  async createVersion(entryId: string, contentType: string, data: unknown, action: string, author: any) {
    const leanifyResult = stripSystemFields(leanifySnapshot(data, contentType, (u) => getSchema(strapi, u)));
    let lean = deepLeanifyMediaAndRelations(leanifyResult);
    if (lean == null && leanifyResult != null) {
      strapi.log.warn('[Presence] deepLeanify returned null, falling back to leanify result');
      lean = leanifyResult;
    }
    if (process.env.STRAPI_PRESENCE_DEBUG_SNAPSHOT === '1') {
      const sample = JSON.stringify(lean).slice(0, 800);
      strapi.log.info(`[Presence] Snapshot ${contentType}: ${sample}${(sample?.length ?? 0) >= 800 ? '...' : ''}`);
    }
    return strapi.documents(VERSION_UID).create({
      data: {
        relatedDocumentId: entryId,
        contentType,
        snapshot: lean,
        action: action || 'draft',
        publishedAt: new Date(),
        author,
      },
    });
  },

  async getHistory(documentId: string, contentType: string) {
    try {
      const result = await strapi.documents(VERSION_UID).findMany({
        filters: { relatedDocumentId: documentId, contentType },
        sort: 'publishedAt:desc',
        fields: ['documentId', 'relatedDocumentId', 'contentType', 'action', 'publishedAt', 'author'],
        limit: 50,
      });
      return Array.isArray(result) ? result : (result as { results?: unknown[] })?.results ?? [];
    } catch (e: any) {
      strapi.log.warn('[Presence] getHistory documents failed, falling back to db.query:', e?.message);
      try {
        const entries = await strapi.db.query(VERSION_UID).findMany({
          where: { relatedDocumentId: documentId, contentType },
          orderBy: { publishedAt: 'desc' },
          limit: 50,
        });
        return entries ?? [];
      } catch (e2: any) {
        strapi.log.error('[Presence] getHistory db.query also failed:', e2?.message);
        return [];
      }
    }
  },

  async assessRestore(versionId: string): Promise<{
    snapshot: unknown;
    assessment: RestoreAssessment;
    steps: Array<RestoreStep & { estimatedMs: number }>;
    totalEstimatedMs: number;
  }> {
    let version: any;
    try {
      version = await strapi.documents(VERSION_UID).findOne({ documentId: versionId });
    } catch (e: any) {
      strapi.log.warn('[Presence] documents.findOne failed, trying db.query:', e?.message);
      try {
        version = await strapi.db.query(VERSION_UID).findOne({ where: { document_id: versionId } });
      } catch (e2: any) {
        throw new Error(`Version fetch failed: ${e?.message || 'documents API error'}. Fallback failed: ${e2?.message || 'db.query error'}`);
      }
    }
    if (!version) {
      throw new Error('Version not found');
    }
    const { contentType, snapshot } = version;
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('Invalid snapshot');
    }

    const mainSchema = getSchema(strapi, contentType);
    const snapshotKeys = Object.keys(snapshot).filter((k) => !SYSTEM_FIELDS.includes(k));
    const schemaKeys = mainSchema ? Object.keys(mainSchema.attributes || {}) : [];
    const missingInSchema = snapshotKeys.filter((k) => !schemaKeys.includes(k));
    const newRequiredInSchema = schemaKeys.filter(
      (k) => !snapshotKeys.includes(k) && mainSchema?.attributes?.[k]?.required
    );

    const stats: AssessmentStats = {
      fieldsOk: 0,
      fieldsLost: 0,
      fieldsBasic: 0,
      fieldsComponent: 0,
      relationsOk: 0,
      relationsMissing: 0,
      mediaOk: 0,
      mediaMissing: 0,
      fieldNamesOk: [],
      fieldNamesLost: [],
      relationDetails: {},
      mediaDetails: {},
      schemaUnresolved: [],
      dynamicZoneDetails: {},
    };
    await analyzeForAssessment(strapi, snapshot, contentType, stats, new Set(), contentType);

    const totalUnits = stats.fieldsOk + stats.fieldsLost + stats.relationsOk + stats.relationsMissing + stats.mediaOk + stats.mediaMissing || 1;
    const recoverable = stats.fieldsOk + stats.relationsOk + stats.mediaOk;
    const overallPercent = Math.round((recoverable / totalUnits) * 100);

    const percentExplanation = `${overallPercent}% = (${stats.fieldsBasic} trường + ${stats.fieldsComponent} component + ${stats.relationsOk} quan hệ + ${stats.mediaOk} media) có thể khôi phục / tổng ${totalUnits} đơn vị`;

    const prepareEst = 200 + (stats.relationsOk + stats.relationsMissing + stats.mediaOk + stats.mediaMissing) * 15;
    const steps: Array<RestoreStep & { estimatedMs: number }> = [
      { ...step('fetch', 'ok', 'Tải version', undefined, 200), estimatedMs: 200 },
      { ...step('validate', 'ok', 'Kiểm tra snapshot', undefined, 100), estimatedMs: 100 },
      { ...step('schema', 'ok', 'Kiểm tra thay đổi schema', undefined, 100), estimatedMs: 100 },
      { ...step('prepare', 'ok', 'Chuẩn bị dữ liệu (relations, media)', undefined, prepareEst), estimatedMs: prepareEst },
      { ...step('update', 'ok', 'Cập nhật document', undefined, 500), estimatedMs: 500 },
      { ...step('done', 'ok', 'Hoàn tất', undefined, 100), estimatedMs: 100 },
    ];
    const totalEstimatedMs = steps.reduce((s, st) => s + (st.estimatedMs || 0), 0);

    return {
      snapshot,
      assessment: {
        overallPercent,
        fieldsOk: stats.fieldsOk,
        fieldsLost: stats.fieldsLost,
        relationsOk: stats.relationsOk,
        relationsMissing: stats.relationsMissing,
        mediaOk: stats.mediaOk,
        mediaMissing: stats.mediaMissing,
        schemaChanges: { missingInSchema, newRequiredInSchema },
        percentExplanation,
        fieldsBasic: stats.fieldsBasic,
        fieldsComponent: stats.fieldsComponent,
        fieldNamesOk: stats.fieldNamesOk.length > 0 ? stats.fieldNamesOk : undefined,
        fieldNamesLost: stats.fieldNamesLost.length > 0 ? stats.fieldNamesLost : missingInSchema,
        relationDetails: Object.keys(stats.relationDetails).length > 0 ? stats.relationDetails : undefined,
        mediaDetails: Object.keys(stats.mediaDetails).length > 0 ? stats.mediaDetails : undefined,
        schemaUnresolved: stats.schemaUnresolved.length > 0 ? stats.schemaUnresolved : undefined,
        dynamicZoneDetails: Object.keys(stats.dynamicZoneDetails).length > 0 ? stats.dynamicZoneDetails : undefined,
      },
      steps,
      totalEstimatedMs,
    };
  },

  requestCancel(token: string) {
    RESTORE_CANCEL_TOKENS.set(token, true);
  },

  isCancelled(token: string): boolean {
    return !!RESTORE_CANCEL_TOKENS.get(token);
  },

  saveCheckpoint(token: string, data: unknown) {
    RESTORE_CHECKPOINTS.set(token, data);
  },

  getCheckpoint(token: string): unknown {
    return RESTORE_CHECKPOINTS.get(token);
  },

  clearRestoreState(token: string) {
    RESTORE_CANCEL_TOKENS.delete(token);
    RESTORE_CHECKPOINTS.delete(token);
  },

  /** Chụp snapshot thủ công từ document hiện tại, đánh giá và trả về (debug) */
  async snapshotAndAssess(strapi: any, contentType: string, locale?: string): Promise<{
    version: any;
    assessment: any;
    debug: {
      snapshotKeys: string[];
      schemaKeys: string[];
      fieldsLost: string[];
      sectionsItemKeys?: string[];
      schemaUnresolved?: string[];
    };
  }> {
    const ct = strapi.contentType(contentType);
    const isSingle = ct?.kind === 'singleType';
    const deepPopulate = this.getDeepPopulateForContentType(strapi, contentType);

    let doc: any;
    if (isSingle) {
      doc = await strapi.documents(contentType).findFirst({
        locale: locale || undefined,
        populate: deepPopulate,
        state: { isPresenceInternal: true },
      });
    } else {
      return { version: null, assessment: null, debug: { snapshotKeys: [], schemaKeys: [], fieldsLost: [] } };
    }
    if (!doc) throw new Error('Document not found');

    const documentId = doc.documentId || doc.id?.toString?.();
    const version = await this.createVersion(
      documentId,
      contentType,
      doc,
      'draft',
      null
    );
    const assessResult = await this.assessRestore(version.documentId);
    const mainSchema = getSchema(strapi, contentType);
    const snapshotKeys = Object.keys(version.snapshot || {}).filter((k) => !SYSTEM_FIELDS.includes(k) && !METADATA_KEYS.includes(k));
    const schemaKeys = mainSchema ? Object.keys(mainSchema.attributes || {}) : [];

    const sectionsSample = (version.snapshot?.sections as any[])?.[0];
    const sectionKeys = sectionsSample && typeof sectionsSample === 'object' ? Object.keys(sectionsSample) : [];

    return {
      version: { documentId: version.documentId, contentType },
      assessment: assessResult.assessment,
      debug: {
        snapshotKeys,
        schemaKeys,
        fieldsLost: assessResult.assessment.fieldNamesLost || assessResult.assessment.schemaChanges?.missingInSchema || [],
        sectionsItemKeys: sectionKeys,
        schemaUnresolved: assessResult.assessment.schemaUnresolved,
      },
    };
  },

  getDeepPopulateForContentType(strapi: any, uid: string, depth = 5, visited = new Set<string>()): any {
    if (depth <= 0 || visited.has(uid)) return {};
    visited.add(uid);
    const schema = getSchema(strapi, uid);
    if (!schema?.attributes) return {};
    const populate: any = {};
    for (const [key, attr] of Object.entries(schema.attributes) as [string, any][]) {
      if (attr.type === 'component' && attr.component) {
        const n = this.getDeepPopulateForContentType(strapi, attr.component, depth - 1, new Set(visited));
        populate[key] = Object.keys(n).length > 0 ? { populate: n } : true;
      } else if (attr.type === 'dynamiczone' && attr.components?.length) {
        const on: any = {};
        for (const c of attr.components) {
          const n = this.getDeepPopulateForContentType(strapi, c, depth - 1, new Set(visited));
          on[c] = Object.keys(n).length > 0 ? { populate: n } : true;
        }
        populate[key] = { on };
      } else if (attr.type === 'relation' && attr.target) {
        populate[key] = { populate: '*' };
      } else if (attr.type === 'media') {
        populate[key] = true;
      }
    }
    return populate;
  },

  async getVersion(documentId: string) {
    try {
      return await strapi.documents(VERSION_UID).findOne({ documentId });
    } catch {
      return strapi.db.query(VERSION_UID).findOne({ where: { documentId } });
    }
  },

  async restoreVersion(versionId: string): Promise<{ success: boolean; data?: any; error?: string; steps: RestoreStep[] }> {
    const steps: RestoreStep[] = [];

    steps.push(step('start', 'ok', 'Bắt đầu khôi phục...'));

    let version: any;
    try {
      version = await strapi.documents(VERSION_UID).findOne({ documentId: versionId });
    } catch {
      version = await strapi.db.query(VERSION_UID).findOne({ where: { documentId: versionId } });
    }

    if (!version) {
      steps.push(step('fetch', 'error', `Version không tồn tại: ${versionId}`));
      return { success: false, error: 'Version not found', steps };
    }
    steps.push(step('fetch', 'ok', 'Đã tải version'));

    const { relatedDocumentId, contentType, snapshot } = version;
    if (!snapshot || typeof snapshot !== 'object') {
      steps.push(step('validate', 'error', 'Snapshot không hợp lệ'));
      return { success: false, error: 'Invalid version snapshot', steps };
    }
    steps.push(step('validate', 'ok', 'Snapshot hợp lệ'));

    const locale = snapshot.locale || undefined;

    const schemaSteps = validateSchemaChanges(strapi, snapshot, contentType);
    steps.push(...schemaSteps);
    const hasSchemaError = schemaSteps.some((s) => s.status === 'error');
    if (hasSchemaError) {
      strapi.log.warn('[Presence] Schema validation errors - proceeding with warnings');
    }

    steps.push(step('prepare', 'ok', 'Đang chuẩn bị dữ liệu...'));
    const preparedData = (await prepareDataForRestore(strapi, snapshot, contentType, steps)) as Record<string, unknown>;
    steps.push(step('prepare', 'ok', 'Đã chuẩn bị dữ liệu'));

    const contentTypeModel = strapi.contentType(contentType);
    const isSingleType = contentTypeModel?.kind === 'singleType';

    let result: any;

    try {
      let existing = await strapi.documents(contentType).findOne({
        documentId: relatedDocumentId,
        locale: locale || undefined,
      });
      if (!existing && isSingleType) {
        existing = await strapi.documents(contentType).findFirst({
          locale: locale || undefined,
        });
      }
      const docIdToUse = existing?.documentId ?? relatedDocumentId;

      if (existing) {
        steps.push(step('update', 'ok', 'Đang cập nhật document...'));
        result = await strapi.documents(contentType).update({
          documentId: docIdToUse,
          locale,
          data: preparedData,
          state: { isPresenceRestore: true },
        });
        steps.push(step('update', 'ok', 'Đã cập nhật draft'));
      } else {
        if (isSingleType) {
          steps.push(step('create', 'ok', 'Single type chưa có document – đang tạo...'));
          result = await strapi.documents(contentType).create({
            data: preparedData,
            locale,
            state: { isPresenceRestore: true },
          });
          steps.push(step('create', 'ok', 'Đã tạo single type document (draft)'));
        } else {
          steps.push(step('create', 'ok', 'Document đã xóa – đang tạo mới từ snapshot...'));
          result = await strapi.documents(contentType).create({
            data: preparedData,
            locale,
            state: { isPresenceRestore: true },
          });
          steps.push(step('create', 'ok', 'Đã tạo document mới (draft)'));
        }
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const details = err?.errors ?? err?.details ?? err?.cause?.message;
      const fullMsg = details ? `${msg}${typeof details === 'string' ? ` (${details})` : ''}` : msg;
      strapi.log.error('[Presence] Restore failed:', msg, details ? { details } : '');
      steps.push(step('restore', 'error', `Khôi phục thất bại: ${fullMsg}`));
      if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('timed out')) {
        steps.push(
          step(
            'restore',
            'warn',
            'Dữ liệu đã được lưu trong version – có thể khôi phục thủ công qua Content Manager'
          )
        );
      }
      return { success: false, error: fullMsg, steps };
    }

    steps.push(step('done', 'ok', 'Khôi phục hoàn tất – cập nhật/create đã kích hoạt lifecycle (meilisearch, cache)'));
    return { success: true, data: result, steps };
  },

  async restoreVersionStream(
    versionId: string,
    options: { token: string; emit: (event: string, data: unknown) => void }
  ): Promise<{ success: boolean; data?: any; error?: string; steps: RestoreStep[] }> {
    const { token, emit } = options;
    const steps: RestoreStep[] = [];

    const checkCancel = () => {
      if (RESTORE_CANCEL_TOKENS.get(token)) throw new Error('CANCELLED');
    };

    emit('step', step('start', 'ok', 'Bắt đầu khôi phục...'));
    checkCancel();

    let version: any;
    try {
      version = await strapi.documents(VERSION_UID).findOne({ documentId: versionId });
    } catch {
      version = await strapi.db.query(VERSION_UID).findOne({ where: { documentId: versionId } });
    }

    if (!version) {
      emit('step', step('fetch', 'error', `Version không tồn tại`));
      return { success: false, error: 'Version not found', steps };
    }
    emit('step', step('fetch', 'ok', 'Đã tải version'));
    checkCancel();

    const { relatedDocumentId, contentType, snapshot } = version;
    if (!snapshot || typeof snapshot !== 'object') {
      emit('step', step('validate', 'error', 'Snapshot không hợp lệ'));
      return { success: false, error: 'Invalid snapshot', steps };
    }
    emit('step', step('validate', 'ok', 'Snapshot hợp lệ'));
    checkCancel();

    const locale = snapshot.locale || undefined;

    try {
      const existing = await strapi.documents(contentType).findOne({
        documentId: relatedDocumentId,
        locale: locale || undefined,
      });
      RESTORE_CHECKPOINTS.set(token, existing);
    } catch {
      RESTORE_CHECKPOINTS.set(token, null);
    }

    const schemaSteps = validateSchemaChanges(strapi, snapshot, contentType);
    schemaSteps.forEach((s) => emit('step', s));
    steps.push(...schemaSteps);
    checkCancel();

    emit('step', step('prepare', 'ok', 'Đang chuẩn bị dữ liệu...'));
    const preparedData = (await prepareDataForRestore(strapi, snapshot, contentType, steps)) as Record<string, unknown>;
    emit('step', step('prepare', 'ok', 'Đã chuẩn bị dữ liệu'));
    checkCancel();

    const contentTypeModel = strapi.contentType(contentType);
    const isSingleType = contentTypeModel?.kind === 'singleType';
    let result: any;

    try {
      let existing = await strapi.documents(contentType).findOne({
        documentId: relatedDocumentId,
        locale: locale || undefined,
      });
      if (!existing && isSingleType) {
        existing = await strapi.documents(contentType).findFirst({
          locale: locale || undefined,
        });
      }
      const docIdToUse = existing?.documentId ?? relatedDocumentId;

      if (existing) {
        emit('step', step('update', 'ok', 'Đang cập nhật document...'));
        result = await strapi.documents(contentType).update({
          documentId: docIdToUse,
          locale,
          data: preparedData,
          state: { isPresenceRestore: true },
        });
        emit('step', step('update', 'ok', 'Đã cập nhật draft'));
      } else {
        if (isSingleType) {
          emit('step', step('create', 'ok', 'Đang tạo single type document...'));
          result = await strapi.documents(contentType).create({
            data: preparedData,
            locale,
            state: { isPresenceRestore: true },
          });
        } else {
          emit('step', step('create', 'ok', 'Đang tạo document mới...'));
          result = await strapi.documents(contentType).create({
            data: preparedData,
            locale,
            state: { isPresenceRestore: true },
          });
        }
        emit('step', step('create', 'ok', 'Đã tạo document (draft)'));
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg === 'CANCELLED') {
        emit('step', step('cancel', 'warn', 'Đã dừng. Dữ liệu checkpoint đã lưu – có thể phục hồi thủ công.'));
        return { success: false, error: 'Cancelled', steps };
      }
      const details = err?.errors ?? err?.details ?? err?.cause?.message;
      const fullMsg = details ? `${msg}${typeof details === 'string' ? ` (${details})` : ''}` : msg;
      strapi.log.error('[Presence] Restore stream failed:', msg, details ? { details } : '');
      emit('step', step('restore', 'error', `Lỗi: ${fullMsg}`));
      return { success: false, error: fullMsg, steps };
    }

    emit('step', step('done', 'ok', 'Khôi phục hoàn tất'));
    RESTORE_CANCEL_TOKENS.delete(token);
    RESTORE_CHECKPOINTS.delete(token);
    return { success: true, data: result, steps };
  },
}));
