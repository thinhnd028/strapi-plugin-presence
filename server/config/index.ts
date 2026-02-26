/**
 * Presence plugin config – retention for actions & versions
 * Override in backend/config/plugins.ts under presence.config
 */
export default {
  default: ({ env }: { env: { int: (key: string, fallback?: number) => number } }) => ({
    retentionDays: env.int('PRESENCE_RETENTION_DAYS', 90),
    minActionRecords: env.int('PRESENCE_MIN_ACTION_RECORDS', 500),
    maxVersionsPerDoc: env.int('PRESENCE_MAX_VERSIONS_PER_DOC', 5),
    /** UIDs of Single/Collection types to save version snapshots (create/update/delete). Empty = no snapshots. */
    snapshotContentTypes: [] as string[],
  }),
  validator: (config: { retentionDays?: number; minActionRecords?: number; maxVersionsPerDoc?: number; snapshotContentTypes?: string[] }) => {
    if (config.retentionDays != null && (typeof config.retentionDays !== 'number' || config.retentionDays < 1)) {
      throw new Error('presence.retentionDays must be a positive number');
    }
    if (config.minActionRecords != null && (typeof config.minActionRecords !== 'number' || config.minActionRecords < 0)) {
      throw new Error('presence.minActionRecords must be a non-negative number');
    }
    if (config.maxVersionsPerDoc != null && (typeof config.maxVersionsPerDoc !== 'number' || config.maxVersionsPerDoc < 1)) {
      throw new Error('presence.maxVersionsPerDoc must be a positive number');
    }
    if (config.snapshotContentTypes != null && !Array.isArray(config.snapshotContentTypes)) {
      throw new Error('presence.snapshotContentTypes must be an array of UIDs');
    }
  },
};
