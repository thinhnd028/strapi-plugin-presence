/**
 * Controller: trả về số lượng user đang hoạt động (online) qua Socket.io.
 * Chỉ dành cho superadmin (qua permission plugin::presence.access-active-users).
 * Route dùng auth: false để tránh 404; kiểm tra quyền thủ công trong controller.
 */
export default ({ strapi }: { strapi: any }) => ({
  async getCount(ctx: any) {
    // Kiểm tra quyền: cần Bearer token hợp lệ + permission access-active-users
    const authHeader = ctx.request?.header?.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return ctx.unauthorized('Missing or invalid Authorization header');

    let user: any = null;
    try {
      const tokenService = strapi.admin?.services?.token ?? strapi.plugin('admin')?.service('token');
      const decoded = await tokenService?.decodeJwtToken?.(token) ?? await (tokenService as any)?.verify?.(token);
      const userId = decoded?.id ?? decoded?.userId;
      if (userId) {
        user = await strapi.db.query('admin::user').findOne({
          where: { id: userId },
          populate: { roles: { populate: ['permissions'] } },
        });
      }
    } catch {
      return ctx.unauthorized('Invalid token');
    }
    if (!user) return ctx.unauthorized('User not found');

    const engine = strapi.admin?.services?.permission?.engine;
    if (engine?.check) {
      const allowed = await engine.check({
        ability: user,
        action: 'plugin::presence.access-active-users',
        subject: null,
      });
      if (!allowed) return ctx.forbidden('Insufficient permission');
    } else {
      const perms = user?.permissions ?? user?.role?.permissions ?? [];
      const hasPermission = Array.isArray(perms) && perms.some(
        (p: any) => p?.action === 'plugin::presence.access-active-users'
      );
      if (!hasPermission) return ctx.forbidden('Insufficient permission');
    }

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
