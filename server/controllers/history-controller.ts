export default ({ strapi }: { strapi: any }) => ({
  async find(ctx: any) {
    const { documentId, contentType } = ctx.query;
    if (!documentId || !contentType) {
      return ctx.badRequest('documentId and contentType are required');
    }
    try {
      const historyService = strapi.plugin('presence').service('history-service');
      const history = await historyService.getHistory(documentId, contentType);
      const data = Array.isArray(history) ? history : (history?.results ?? []);
      ctx.body = { data };
    } catch (err: any) {
      strapi.log.error('[Presence] getHistory failed:', err?.message);
      ctx.status = 500;
      ctx.body = { error: 'Failed to fetch history' };
    }
  },

  async restore(ctx: any) {
    const { versionId } = ctx.request.body || {};
    if (!versionId) {
      return ctx.badRequest('versionId is required');
    }
    try {
      if (ctx.state) ctx.state.isPresenceRestore = true;
      const historyService = strapi.plugin('presence').service('history-service');
      const result = await historyService.restoreVersion(versionId);
      if (!result.success) {
        ctx.status = 500;
        ctx.body = { error: result.error || 'Restore failed', steps: result.steps };
        return;
      }
      ctx.body = { data: result.data, steps: result.steps };
    } catch (err: any) {
      strapi.log.error('[Presence] restore failed:', err?.message);
      ctx.status = 500;
      ctx.body = { error: err?.message || 'Failed to restore version', steps: [] };
    } finally {
      if (ctx.state) delete ctx.state.isPresenceRestore;
    }
  },

  async getVersion(ctx: any) {
    const { documentId } = ctx.params || {};
    if (!documentId) {
      return ctx.badRequest('documentId is required');
    }
    try {
      const historyService = strapi.plugin('presence').service('history-service');
      const version = await historyService.getVersion(documentId);
      if (!version) return ctx.notFound("Version not found");
      ctx.body = { data: version };
    } catch (err: any) {
      strapi.log.error('[Presence] getVersion failed:', err?.message);
      ctx.status = 500;
      ctx.body = { error: err?.message || 'Failed to fetch version' };
    }
  },

  async assess(ctx: any) {
    const { versionId } = ctx.params || {};
    if (!versionId) return ctx.badRequest('versionId is required');
    try {
      const historyService = strapi.plugin('presence').service('history-service');
      const result = await historyService.assessRestore(versionId);
      ctx.body = result;
    } catch (err: any) {
      const msg = err?.message ?? err?.stack ?? String(err);
      strapi.log.error('[Presence] assess failed:', msg);
      if (err?.stack) strapi.log.debug('[Presence] assess stack:', err.stack);
      ctx.status = 500;
      ctx.body = { error: msg || 'Assessment failed' };
    }
  },

  async restoreStream(ctx: any) {
    const { versionId } = ctx.params || {};
    const token = ctx.query?.token as string;
    if (!versionId || !token) {
      return ctx.badRequest('versionId and token are required');
    }
    ctx.respond = false;
    ctx.res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const write = (event: string, data: unknown) => {
      ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      if (ctx.state) ctx.state.isPresenceRestore = true;
      const historyService = strapi.plugin('presence').service('history-service');
      const result = await historyService.restoreVersionStream(versionId, {
        token,
        emit: (event: string, data: unknown) => write(event, data),
      });
      write('done', result);
    } catch (err: any) {
      write('error', { error: err?.message || 'Restore failed' });
    } finally {
      if (ctx.state) delete ctx.state.isPresenceRestore;
      ctx.res.end();
    }
  },

  async cancelRestore(ctx: any) {
    const { token } = ctx.request.body || {};
    if (!token) return ctx.badRequest('token is required');
    const historyService = strapi.plugin('presence').service('history-service');
    historyService.requestCancel(token);
    ctx.body = { ok: true };
  },

  async snapshotNow(ctx: any) {
    const { contentType, locale } = ctx.request.body || ctx.query || {};
    if (!contentType) return ctx.badRequest('contentType required');
    try {
      const historyService = strapi.plugin('presence').service('history-service');
      const result = await historyService.snapshotAndAssess(strapi, contentType, locale || undefined);
      ctx.body = result;
    } catch (err: any) {
      strapi.log.error('[Presence] snapshotNow failed:', err?.message);
      ctx.status = 500;
      ctx.body = { error: err?.message || 'Snapshot failed' };
    }
  },

  async getCheckpoint(ctx: any) {
    const { token } = ctx.params || {};
    if (!token) return ctx.badRequest('token is required');
    const historyService = strapi.plugin('presence').service('history-service');
    const checkpoint = historyService.getCheckpoint(token);
    ctx.body = { data: checkpoint };
  },
});
