/**
 * Login/Logout audit – records admin auth events to action-history
 */

const AUDIT_MODEL = 'plugin::presence.action-history';

export function registerAuthAudit(strapi: any) {
  const app = strapi.server?.app;
  if (!app) {
    strapi.log.warn('[Presence] Cannot register auth audit: strapi.server.app not available');
    return;
  }

  app.use(async (ctx: any, next: () => Promise<void>) => {
    const path = ctx.path || ctx.request?.path || '';
    const method = ctx.method || ctx.request?.method || '';
    const isLogin = method === 'POST' && (path.endsWith('/login') || path === '/login');
    const isLogout = method === 'POST' && (path.endsWith('/logout') || path === '/logout');

    if (!isLogin && !isLogout) {
      return next();
    }

    await next();

    if (ctx.status !== 200) return;

    const action = isLogin ? 'login' : 'logout';
    let user: Record<string, unknown> | null = null;

    if (isLogin) {
      const u = ctx.body?.data?.user ?? ctx.body?.user;
      if (u) {
        user = {
          id: u.id,
          username: u.username ?? (u.firstname ? `${u.firstname} ${u.lastname || ''}`.trim() : null) ?? u.email,
          email: u.email,
        };
      }
    } else if (isLogout) {
      const u = ctx.state?.user ?? strapi.requestContext?.get?.()?.state?.auth?.credentials;
      if (u?.id) {
        user = {
          id: u.id,
          username: (u.firstname ? `${u.firstname} ${u.lastname || ''}`.trim() : u.username) ?? u.email,
          email: u.email,
        };
      }
    }

    strapi.db.query(AUDIT_MODEL)
      .create({
        data: {
          action,
          contentType: 'admin::auth',
          targetDocumentId: null,
          entryId: null,
          user,
          source: 'admin',
          beforeData: null,
          afterData: null,
          filters: null,
          resultCount: null,
          versionDocumentId: null,
        },
      })
      .catch((err: Error) => strapi.log.warn('[Presence] Auth audit failed:', err.message));
  });

  strapi.log.info('[Presence] Login/Logout audit registered');
}
