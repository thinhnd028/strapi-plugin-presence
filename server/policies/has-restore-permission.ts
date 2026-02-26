/**
 * Policy: yêu cầu quyền plugin::presence.restore để dùng tính năng phục hồi
 */
export default async (policyContext: any, _config: any, { strapi }: { strapi: any }) => {
  const user = policyContext.state?.user;
  if (!user) return false;

  try {
    const engine = strapi.admin?.services?.permission?.engine;
    if (engine?.check) {
      const result = await engine.check({ ability: user, action: 'plugin::presence.restore', subject: null });
      return !!result;
    }
    const permissions = (user as any).permissions ?? user.role?.permissions ?? [];
    const action = 'plugin::presence.restore';
    return Array.isArray(permissions) && permissions.some((p: any) => p?.action === action);
  } catch {
    return false;
  }
};
