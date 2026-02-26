/**
 * Restore steps – step-by-step execution with messages
 */

export type StepStatus = 'ok' | 'warn' | 'skip' | 'error';

export interface RestoreStep {
  step: string;
  status: StepStatus;
  message: string;
  detail?: Record<string, unknown>;
  estimatedMs?: number;
}

export function step(
  stepName: string,
  status: StepStatus,
  message: string,
  detail?: Record<string, unknown>,
  estimatedMs?: number
): RestoreStep {
  return { step: stepName, status, message, ...(detail ? { detail } : {}), ...(estimatedMs != null ? { estimatedMs } : {}) };
}

export interface RestoreAssessment {
  overallPercent: number;
  fieldsOk: number;
  fieldsLost: number;
  relationsOk: number;
  relationsMissing: number;
  mediaOk: number;
  mediaMissing: number;
  /** Trường cơ bản (string, text, number...) – tách khỏi component */
  fieldsBasic?: number;
  /** Component + dynamiczone */
  fieldsComponent?: number;
  schemaChanges: { missingInSchema: string[]; newRequiredInSchema: string[] };
  /** Giải thích công thức % */
  percentExplanation?: string;
  /** Tên trường sẽ khôi phục (trường cơ bản, component, dynamiczone) */
  fieldNamesOk?: string[];
  /** Tên trường sẽ mất (không còn trong schema) */
  fieldNamesLost?: string[];
  /** Relation: tên field → { ok, missing } */
  relationDetails?: Record<string, { ok: number; missing: number }>;
  /** Media: tên field → { ok, missing } */
  mediaDetails?: Record<string, { ok: number; missing: number }>;
  /** UID schema không load được – có thể do format, cần kiểm tra/save lại */
  schemaUnresolved?: string[];
  /** Chi tiết từng loại block trong dynamic zone – hiển thị tách biệt */
  dynamicZoneDetails?: Record<
    string,
    {
      displayName: string;
      relations: Record<string, { ok: number; missing: number }>;
      media: Record<string, { ok: number; missing: number }>;
      nestedComponents?: string[];
      nestedRelations?: Record<string, { ok: number; missing: number }>;
      count: number;
    }
  >;
}
