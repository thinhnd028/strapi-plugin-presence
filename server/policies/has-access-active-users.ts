/**
 * Policy: yêu cầu quyền plugin::presence.access-active-users để xem số user đang online.
 * Mặc định gán cho role Super Admin.
 */
export default async (policyContext: any, _config: any, { strapi }: { strapi: any }) => {
  const user = policyContext.state?.user;
  if (!user) return false;

  try {
    const engine = strapi.admin?.services?.permission?.engine;
    if (engine?.check) {
      const result = await engine.check({
        ability: user,
        action: 'plugin::presence.access-active-users',
        subject: null,
      });
      return !!result;
    }
    const permissions = (user as any).permissions ?? user.role?.permissions ?? [];
    return Array.isArray(permissions) && permissions.some(
      (p: any) => p?.action === 'plugin::presence.access-active-users'
    );
  } catch {
    return false;
  }
};
