/**
 * Retention cleanup: actions (by age + min count), versions (keep N per doc)
 * Config: plugin::presence (retentionDays, minActionRecords, maxVersionsPerDoc)
 */
const AUDIT_MODEL = "plugin::presence.action-history";
const VERSION_UID = "plugin::presence.version";

export default ({ strapi }: { strapi: any }) => ({
  async runCleanup() {
    const pluginConfig = strapi.config.get("plugin::presence") || {};
    const config = pluginConfig.config || pluginConfig;
    const retentionDays = config.retentionDays ?? 90;
    const minActionRecords = config.minActionRecords ?? 500;
    const maxVersionsPerDoc = config.maxVersionsPerDoc ?? 5;

    const actionDeleted = await this.cleanupActions(retentionDays, minActionRecords);
    const versionDeleted = await this.cleanupVersions(maxVersionsPerDoc);

    if (actionDeleted > 0 || versionDeleted > 0) {
      strapi.log.info(`[Presence] Retention: removed ${actionDeleted} actions, ${versionDeleted} versions`);
    }
    return { actionDeleted, versionDeleted };
  },

  async cleanupActions(retentionDays: number, minActionRecords: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const total = await strapi.db.query(AUDIT_MODEL).count();
    if (total <= minActionRecords) return 0;

    const oldEntries = await strapi.db.query(AUDIT_MODEL).findMany({
      where: { createdAt: { $lt: cutoff.toISOString() } },
      orderBy: { createdAt: "asc" },
    });
    const arr = Array.isArray(oldEntries) ? oldEntries : oldEntries?.results ?? [];
    const canDelete = Math.min(arr.length, total - minActionRecords);
    if (canDelete <= 0) return 0;

    const toRemove = arr.slice(0, canDelete);
    const ids = toRemove.map((e: any) => e.id).filter(Boolean);
    if (ids.length === 0) return 0;

    await strapi.db.query(AUDIT_MODEL).deleteMany({ where: { id: { $in: ids } } });
    return ids.length;
  },

  async cleanupVersions(maxVersionsPerDoc: number): Promise<number> {
    const allVersions = await strapi.documents(VERSION_UID).findMany({
      sort: "publishedAt:desc",
      limit: 10000,
    });
    const arr = Array.isArray(allVersions) ? allVersions : allVersions?.results ?? [];
    const byDoc = new Map<string, any[]>();
    for (const v of arr) {
      const key = `${v.relatedDocumentId || ""}::${v.contentType || ""}`;
      if (!byDoc.has(key)) byDoc.set(key, []);
      byDoc.get(key)!.push(v);
    }

    let totalDeleted = 0;
    for (const [, versions] of byDoc) {
      const toRemove = versions.slice(maxVersionsPerDoc);
      for (const v of toRemove) {
        try {
          await strapi.documents(VERSION_UID).delete({ documentId: v.documentId });
          totalDeleted++;
        } catch (_) {}
      }
    }
    return totalDeleted;
  },
});
