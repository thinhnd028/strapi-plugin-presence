/**
 * Controller: trả về danh sách user đang online qua WebSocket presence.
 * Auth + permission check do route policies xử lý
 * ('admin::isAuthenticatedAdmin' + 'plugin::presence.has-access-active-users').
 */
export default ({ strapi }: { strapi: any }) => ({
  async getCount(ctx: any) {
    const activeUsers = (strapi as any).presenceActiveUsers as Map<string, any> | undefined;
    if (!activeUsers || !(activeUsers instanceof Map)) {
      return ctx.send({ count: 0, uniqueCount: 0, users: [] });
    }

    const all = Array.from(activeUsers.values());
    // Gom theo userId: 1 user có thể mở nhiều tab/document. Mỗi user trả về danh sách entryId
    // họ đang xem để UI hiển thị "ai đang ở đâu".
    const byUser = new Map<string, any>();
    for (const u of all) {
      const key = String(u?.id ?? u?.socketId ?? '');
      if (!key) continue;
      const existing = byUser.get(key);
      if (existing) {
        if (u?.entryId && !existing.entries.includes(u.entryId)) existing.entries.push(u.entryId);
        existing.tabCount += 1;
      } else {
        byUser.set(key, {
          id: u?.id ?? null,
          username: u?.username ?? null,
          email: u?.email ?? null,
          initials: u?.initials ?? null,
          color: u?.color ?? null,
          entries: u?.entryId ? [u.entryId] : [],
          tabCount: 1,
        });
      }
    }

    ctx.send({
      count: all.length,
      uniqueCount: byUser.size,
      users: Array.from(byUser.values()),
    });
  },
});
