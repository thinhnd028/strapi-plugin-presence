import { Server } from "socket.io";
import { registerActionHistory } from "./audit";
import { registerAuthAudit } from "./audit-auth";

function scheduleRetention(strapi: any) {
  const run = () => {
    strapi.plugin("presence").service("retention-service").runCleanup().catch((e: Error) => {
      strapi.log.warn("[Presence] Retention cleanup failed:", e.message);
    });
  };
  run();
  setInterval(run, 6 * 60 * 60 * 1000);
}
import routes from "./routes";
import controllers from "./controllers";
import contentTypes from "./content-types";
import services from "./services";
import config from "./config";
import hasRestorePermission from "./policies/has-restore-permission";

export default {
  config,
  register({ strapi }: { strapi: any }) {
    registerActionHistory(strapi);
    registerAuthAudit(strapi);
  },

  async bootstrap({ strapi }: { strapi: any }) {
    const actions = [
      {
        section: 'plugins',
        displayName: 'Version history',
        uid: 'access-version-history',
        pluginName: 'presence',
      },
      {
        section: 'plugins',
        displayName: 'Action History',
        uid: 'access-action-history',
        pluginName: 'presence',
      },
      {
        section: 'plugins',
        displayName: 'Restore version',
        uid: 'restore',
        pluginName: 'presence',
      },
    ];
    try {
      strapi.admin?.services?.permission?.actionProvider?.registerMany?.(actions);
    } catch (e: any) {
      strapi.log.warn('[Presence] Could not register restore permission:', e?.message);
    }

    process.nextTick(() => {
      const httpServer = strapi.server?.httpServer;
      if (!httpServer) {
        strapi.log.warn('[Presence] strapi.server.httpServer not available - Socket.io disabled');
        return;
      }
      const io = new Server(httpServer, {
        cors: { origin: "*", methods: ["GET", "POST"] },
        allowEIO3: true,
        pingInterval: 10000,
        pingTimeout: 5000,
        path: "/socket.io",
      });

    const AVATAR_COLORS = ['#4945ff', '#32d08d', '#ff5d5d', '#ffb54d', '#a155ff', '#211fad', '#007bff'];
    const getColorForUser = (id: any) => { const s = String(id); let h = 0; for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]; };
    const activeUsers = new Map();
    const typingUsers = new Map<string, Map<string, { userId: string; username: string }>>();

    const broadcastRoom = (entryId: string) => {
      const usersInRoom = Array.from(activeUsers.values()).filter((u: any) => u.entryId === entryId);
      io.to(`entry-${entryId}`).emit('presence-update', usersInRoom);
    };

    const broadcastTyping = (entryId: string) => {
      const set = typingUsers.get(entryId);
      const list = set ? Array.from(set.values()) : [];
      io.to(`entry-${entryId}`).emit('typing-update', list);
    };

    io.on('connection', (socket: any) => {
      socket.on('join-entry', ({ entryId, user }: { entryId: string, user: any }) => {
        const existing = activeUsers.get(socket.id);
        if (existing && existing.entryId !== entryId) {
          socket.leave(`entry-${existing.entryId}`);
          activeUsers.delete(socket.id);
          broadcastRoom(existing.entryId);
        }
        activeUsers.set(socket.id, { entryId, socketId: socket.id, color: getColorForUser(user?.id), ...user });
        socket.join(`entry-${entryId}`);
        broadcastRoom(entryId);
      });

      socket.on('leave-entry', ({ entryId }: { entryId: string }) => {
        const existing = activeUsers.get(socket.id);
        if (existing && existing.entryId === entryId) {
          socket.leave(`entry-${entryId}`);
          activeUsers.delete(socket.id);
          const tSet = typingUsers.get(entryId);
          if (tSet) { tSet.delete(socket.id); broadcastTyping(entryId); }
          broadcastRoom(entryId);
        }
      });

      socket.on('user-typing', ({ entryId, userId, username }: { entryId: string; userId: string; username: string }) => {
        if (!typingUsers.has(entryId)) typingUsers.set(entryId, new Map());
        typingUsers.get(entryId)!.set(socket.id, { userId, username });
        broadcastTyping(entryId);
      });

      socket.on('user-stop-typing', ({ entryId }: { entryId: string }) => {
        const tSet = typingUsers.get(entryId);
        if (tSet) { tSet.delete(socket.id); broadcastTyping(entryId); }
      });

      socket.on('disconnect', () => {
        const user = activeUsers.get(socket.id);
        if (user) {
          const tSet = typingUsers.get(user.entryId);
          if (tSet) { tSet.delete(socket.id); broadcastTyping(user.entryId); }
          activeUsers.delete(socket.id);
          broadcastRoom(user.entryId);
        }
      });
    });

    strapi.io = io;
      strapi.log.info('[Presence] Socket.io attached successfully');
    });

    scheduleRetention(strapi);
  },

  routes,
  controllers,
  contentTypes,
  services,
  policies: {
    'has-restore-permission': hasRestorePermission,
  },
};
