import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
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
import hasAccessActiveUsers from "./policies/has-access-active-users";

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
        displayName: 'View active users count',
        uid: 'access-active-users',
        pluginName: 'presence',
      },
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
        strapi.log.warn('[Presence] strapi.server.httpServer not available - WebSocket disabled');
        return;
      }

      const wss = new WebSocketServer({ server: httpServer, path: '/ws/presence' });

      const AVATAR_COLORS = ['#4945ff', '#32d08d', '#ff5d5d', '#ffb54d', '#a155ff', '#211fad', '#007bff'];
      const getColorForUser = (id: any) => {
        const s = String(id);
        let h = 0;
        for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
        return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
      };

      // socketId → user info (exposed for active-users-controller)
      const activeUsers = new Map<string, any>();
      // ws → { entryId, socketId, user }
      const socketState = new Map<WebSocket, { entryId: string; socketId: string; user: any }>();
      // entryId → Set<WebSocket>
      const rooms = new Map<string, Set<WebSocket>>();
      // entryId → Map<WebSocket, { userId, username }>
      const typingUsers = new Map<string, Map<WebSocket, { userId: string; username: string }>>();
      const socketLiveness = new WeakMap<WebSocket, boolean>();
      let socketCounter = 0;

      const cleanupSocket = (ws: WebSocket) => {
        const state = socketState.get(ws);

        for (const [entryId, users] of typingUsers.entries()) {
          if (users.delete(ws) && users.size === 0) typingUsers.delete(entryId);
        }

        if (state) {
          leaveRoom(ws, state.entryId);
          activeUsers.delete(state.socketId);
          socketState.delete(ws);
        } else {
          for (const [entryId, room] of rooms.entries()) {
            if (room.delete(ws) && room.size === 0) rooms.delete(entryId);
          }
        }

        socketLiveness.delete(ws);
      };

      const HEARTBEAT_INTERVAL_MS = 30000;

      wss.on('connection', (ws: WebSocket) => {
        socketLiveness.set(ws, true);

        ws.on('pong', () => {
          socketLiveness.set(ws, true);
        });

        ws.on('close', () => {
          cleanupSocket(ws);
        });
      });

      const heartbeatInterval = setInterval(() => {
        for (const ws of wss.clients) {
          if (socketLiveness.get(ws as WebSocket) === false) {
            cleanupSocket(ws as WebSocket);
            ws.terminate();
            continue;
          }

          socketLiveness.set(ws as WebSocket, false);
          try {
            ws.ping();
          } catch {
            cleanupSocket(ws as WebSocket);
            ws.terminate();
          }
        }
      }, HEARTBEAT_INTERVAL_MS);

      wss.on('close', () => {
        clearInterval(heartbeatInterval);
      });

      const joinRoom = (ws: WebSocket, entryId: string) => {
        if (!rooms.has(entryId)) rooms.set(entryId, new Set());
        rooms.get(entryId)!.add(ws);
      };

      const leaveRoom = (ws: WebSocket, entryId: string) => {
        const room = rooms.get(entryId);
        if (room) {
          room.delete(ws);
          if (room.size === 0) rooms.delete(entryId);
        }
      };

      const broadcastRoom = (entryId: string) => {
        const users = Array.from(socketState.values())
          .filter(s => s.entryId === entryId)
          .map(s => s.user);
        const message = JSON.stringify({ type: 'presence-update', users });
        const room = rooms.get(entryId);
        if (room) {
          room.forEach(ws => {
            if (ws.readyState === 1 /* OPEN */) ws.send(message);
          });
        }
      };

      const broadcastTyping = (entryId: string) => {
        const set = typingUsers.get(entryId);
        const users = set ? Array.from(set.values()) : [];
        const message = JSON.stringify({ type: 'typing-update', users });
        const room = rooms.get(entryId);
        if (room) {
          room.forEach(ws => {
            if (ws.readyState === 1 /* OPEN */) ws.send(message);
          });
        }
      };

      wss.on('connection', (ws: WebSocket) => {
        const socketId = `ws_${++socketCounter}_${Date.now()}`;

        ws.on('message', (data: import('ws').RawData) => {
          try {
            let text: string;
            if (typeof data === 'string') {
              text = data;
            } else if (Buffer.isBuffer(data)) {
              text = data.toString('utf8');
            } else if (data instanceof ArrayBuffer) {
              text = Buffer.from(data).toString('utf8');
            } else if (Array.isArray(data)) {
              text = Buffer.concat(data).toString('utf8');
            } else {
              text = String(data);
            }
            const msg = JSON.parse(text);

            if (msg.type === 'join-entry') {
              const { entryId, user } = msg;
              const existing = socketState.get(ws);
              if (existing && existing.entryId !== entryId) {
                leaveRoom(ws, existing.entryId);
                activeUsers.delete(existing.socketId);
                const tSet = typingUsers.get(existing.entryId);
                if (tSet) { tSet.delete(ws); broadcastTyping(existing.entryId); }
                broadcastRoom(existing.entryId);
              }
              const userWithMeta = { entryId, socketId, color: getColorForUser(user?.id), ...user };
              socketState.set(ws, { entryId, socketId, user: userWithMeta });
              activeUsers.set(socketId, userWithMeta);
              joinRoom(ws, entryId);
              broadcastRoom(entryId);

            } else if (msg.type === 'leave-entry') {
              const { entryId } = msg;
              const existing = socketState.get(ws);
              if (existing && existing.entryId === entryId) {
                leaveRoom(ws, entryId);
                activeUsers.delete(existing.socketId);
                const tSet = typingUsers.get(entryId);
                if (tSet) { tSet.delete(ws); broadcastTyping(entryId); }
                socketState.delete(ws);
                broadcastRoom(entryId);
              }

            } else if (msg.type === 'user-typing') {
              const { entryId, userId, username } = msg;
              if (!typingUsers.has(entryId)) typingUsers.set(entryId, new Map());
              typingUsers.get(entryId)!.set(ws, { userId, username });
              broadcastTyping(entryId);

            } else if (msg.type === 'user-stop-typing') {
              const { entryId } = msg;
              const tSet = typingUsers.get(entryId);
              if (tSet) { tSet.delete(ws); broadcastTyping(entryId); }
            }

          } catch {
            // Invalid JSON – ignore
          }
        });

        ws.on('close', () => {
          const state = socketState.get(ws);
          if (state) {
            const { entryId, socketId: sid } = state;
            const tSet = typingUsers.get(entryId);
            if (tSet) { tSet.delete(ws); broadcastTyping(entryId); }
            leaveRoom(ws, entryId);
            activeUsers.delete(sid);
            socketState.delete(ws);
            broadcastRoom(entryId);
          }
        });

        ws.on('error', () => {
          try { ws.close(); } catch {}
        });
      });

      strapi.presenceWss = wss;
      strapi.presenceActiveUsers = activeUsers;
      strapi.log.info('[Presence] WebSocket server attached successfully at /ws/presence');
    });

    scheduleRetention(strapi);
  },

  routes,
  controllers,
  contentTypes,
  services,
  policies: {
    'has-restore-permission': hasRestorePermission,
    'has-access-active-users': hasAccessActiveUsers,
  },
};
