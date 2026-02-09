import { Server } from "socket.io";

export default {
    register(/*{ strapi }*/) { },

    async bootstrap({ strapi }: { strapi: any }) {
        const io = new Server(strapi.server.httpServer, {
            cors: {
                origin: "*", // In production, restrict this to your admin URL
                methods: ["GET", "POST"]
            },
            // Allow WebSocket connections both directly and behind a reverse proxy.
            // The client will send the full path (e.g. /cms/socket.io/) and the proxy
            // strips the prefix, so Strapi always sees /socket.io/.
            allowEIO3: true,
        });

        const activeUsers = new Map(); // key: socketId, value: { userId, entryId, username, avatar }

        io.on('connection', (socket: any) => {
            socket.on('join-entry', ({ entryId, user }: { entryId: string, user: any }) => {
                activeUsers.set(socket.id, { entryId, ...user });
                socket.join(`entry-${entryId}`);

                // Update everyone in the room
                const usersInRoom = Array.from(activeUsers.values()).filter((u: any) => u.entryId === entryId);
                io.to(`entry-${entryId}`).emit('presence-update', usersInRoom);

                console.log(`[Presence] User ${user.username} joined entry ${entryId}`);
            });

            socket.on('disconnect', () => {
                const user = activeUsers.get(socket.id);
                if (user) {
                    const { entryId } = user;
                    activeUsers.delete(socket.id);

                    const usersInRoom = Array.from(activeUsers.values()).filter((u: any) => u.entryId === entryId);
                    io.to(`entry-${entryId}`).emit('presence-update', usersInRoom);

                    console.log(`[Presence] User ${user.username} left`);
                }
            });
        });

        strapi.io = io;
        console.log('[Presence] Socket.io server initialized');
    },
};
