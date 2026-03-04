/**
 * Controller: trả về số lượng user đang hoạt động (online) qua Socket.io.
 * Chỉ dành cho superadmin (qua permission plugin::presence.access-active-users).
 */
export default ({ strapi }: { strapi: any }) => ({
  async getCount(ctx: any) {
    const activeUsers = (strapi as any).presenceActiveUsers as Map<string, any> | undefined;
    if (!activeUsers || !(activeUsers instanceof Map)) {
      return ctx.send({ count: 0, uniqueCount: 0 });
    }

    const all = Array.from(activeUsers.values());
    const uniqueById = new Map(all.map((u: any) => [String(u?.id ?? u?.socketId ?? ''), u]));
    const uniqueCount = uniqueById.size;

    ctx.send({
      count: all.length,
      uniqueCount,
    });
  },
});
