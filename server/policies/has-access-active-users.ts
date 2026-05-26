/**
 * Policy: yêu cầu quyền plugin::presence.access-active-users để xem user đang online.
 * Super admin luôn pass. Các role khác phải có action permission gán trong Settings > Roles.
 */
const SUPER_ADMIN_CODE = 'strapi-super-admin';
const ACTION = 'plugin::presence.access-active-users';

export default async (policyContext: any, _config: any, { strapi }: { strapi: any }) => {
  const user = policyContext.state?.user;
  if (!user) {
    strapi.log.debug('[Presence] active-users policy: no user in state');
    return false;
  }

  // Super admin bypass — Strapi gán role code "strapi-super-admin" cho super admin
  const roles = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []);
  if (roles.some((r: any) => r?.code === SUPER_ADMIN_CODE)) return true;

  // Kiểm tra action permission qua engine (cách chuẩn Strapi 5)
  try {
    const engine = strapi.admin?.services?.permission?.engine;
    if (engine?.generateAbility) {
      const userPerms = await strapi.admin.services.permission.findUserPermissions({ id: user.id });
      const ability = await engine.generateAbility(userPerms);
      if (ability?.can?.(ACTION)) return true;
    }
  } catch (err: any) {
    strapi.log.warn(`[Presence] active-users policy engine check failed: ${err?.message}`);
  }

  // Fallback: scan permissions trực tiếp trên user/role
  const flatPerms: any[] = [
    ...(Array.isArray(user.permissions) ? user.permissions : []),
    ...roles.flatMap((r: any) => (Array.isArray(r?.permissions) ? r.permissions : [])),
  ];
  if (flatPerms.some((p: any) => p?.action === ACTION)) return true;

  strapi.log.debug(`[Presence] active-users policy: user ${user.email || user.id} lacks ${ACTION}`);
  return false;
};
