import React, { useEffect, useState, useRef } from 'react';
// @ts-ignore
import { useParams, useLocation } from 'react-router-dom';
// @ts-ignore
import { io, Socket } from 'socket.io-client';

const avatarColors = [
    '#4945ff', '#32d08d', '#ff5d5d', '#ffb54d',
    '#a155ff', '#211fad', '#007bff',
];

const getStrapiBasePath = (): string => {
    const path = window.location.pathname;
    const adminIndex = path.indexOf('/admin');
    return adminIndex > 0 ? path.substring(0, adminIndex) : '';
};

const PresenceAvatars = () => {
    const params = useParams<any>();
    const location = useLocation();
    const entryId = params.id || params.documentId || params.slug || (location?.pathname || "");

    const [allUsers, setAllUsers] = useState<any[]>([]);
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [typingUsers, setTypingUsers] = useState<any[]>([]);
    const socketRef = useRef<any>(null);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevEntryIdRef = useRef<string | null>(null);

    // ---- Fetch current admin user (once) ----
    useEffect(() => {
        const getCookie = (name: string) => {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) return parts.pop()?.split(';').shift();
            return null;
        };

        const getDisplayName = (data: Record<string, unknown> | null): string => {
            if (!data) return 'Admin';
            const first = (data.firstname as string) || '';
            const last = (data.lastname as string) || '';
            const name = (first + (last ? ` ${last}` : '')).trim();
            return name || (data.username as string) || (data.email as string) || 'Admin';
        };

        const getInitials = (data: Record<string, unknown> | null): string => {
            if (!data) return 'A';
            const first = (data.firstname as string) || '';
            const last = (data.lastname as string) || '';
            if (first) return (first[0] + (last ? last[0] : '')).toUpperCase().slice(0, 2);
            const u = (data.username as string) || (data.email as string) || '';
            return (u[0] || 'A').toUpperCase();
        };

        const fetchMe = async () => {
            try {
                const basePath = getStrapiBasePath();
                const token = getCookie('jwtToken') || getCookie('token') || localStorage.getItem('jwtToken') || localStorage.getItem('token');
                const response = await fetch(`${window.location.origin}${basePath}/admin/users/me`, {
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                    credentials: 'include',
                });
                const resData = await response.json().catch(() => ({}));
                const data = (resData?.data ?? resData) as Record<string, unknown> | null;

                if (response.ok && data?.id) {
                    setCurrentUser({
                        id: (data.id as number) || Math.random(),
                        username: getDisplayName(data),
                        initials: getInitials(data)
                    });
                } else {
                    setCurrentUser({
                        id: 'anon-' + Math.random().toString(36).substring(2, 7),
                        username: 'Unknown',
                        initials: '?'
                    });
                }
            } catch (err) {
                console.warn('[Presence] Failed to fetch user', err);
            }
        };
        fetchMe();
    }, []);

    // ---- Create & manage socket lifecycle ----
    useEffect(() => {
        if (!entryId || !currentUser) return;

        // Create socket if not exists or disconnected
        if (!socketRef.current || socketRef.current.disconnected) {
            try {
                const basePath = getStrapiBasePath();
                socketRef.current = io(window.location.origin, {
                    path: `${basePath}/socket.io/`,
                    transports: ['websocket', 'polling'],
                    reconnection: true,
                    reconnectionAttempts: 10,
                    reconnectionDelay: 1000,
                    reconnectionDelayMax: 5000,
                });
            } catch {
                return;
            }
        }

        const socket = socketRef.current;

        // Leave previous room if entryId changed
        const prevEntryId = prevEntryIdRef.current;
        if (prevEntryId && prevEntryId !== entryId) {
            socket.emit('leave-entry', { entryId: prevEntryId });
            setAllUsers([]); setTypingUsers([]);
        }
        prevEntryIdRef.current = entryId;

        // Join the new room
        const joinRoom = () => {
            socket.emit('join-entry', { entryId, user: currentUser });
            setIsConnected(true);
        };

        const onConnect = () => {
            setIsConnected(true);
            joinRoom();
        };

        const onReconnect = () => {
            // Re-join current room after reconnection
            joinRoom();
        };

        const onUpdate = (users: any[]) => {
            const raw = users || [];
            const uniqueUsers = Array.from(
                new Map(raw.map((u: any) => [u.id, u])).values()
            );
            setAllUsers(uniqueUsers);
        };

        const onDisconnect = () => {
            setIsConnected(false);
        };

        socket.on('connect', onConnect);
        socket.on('reconnect', onReconnect);
        socket.on('presence-update', onUpdate);
        socket.on('typing-update', (users: any[]) => setTypingUsers(users || []));
        socket.on('disconnect', onDisconnect);

        // If already connected, join immediately
        if (socket.connected) {
            joinRoom();
        }

        return () => {
            socket.off('connect', onConnect);
            socket.off('reconnect', onReconnect);
            socket.off('presence-update', onUpdate);
            socket.off('typing-update');
            socket.off('disconnect', onDisconnect);

            // Leave current room but DON'T disconnect socket
            if (entryId) {
                socket.emit('leave-entry', { entryId });
            }
        };
    }, [entryId, currentUser]);

    // ---- Emit typing to socket so others in room see it ----
    useEffect(() => {
        if (!entryId || !currentUser || !socketRef.current) return;
        const socket = socketRef.current;
        const emitTyping = () => {
            socket.emit('user-typing', { entryId, userId: currentUser.id, username: currentUser.username });
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = setTimeout(() => {
                socket.emit('user-stop-typing', { entryId });
                typingTimeoutRef.current = null;
            }, 1500);
        };
        document.addEventListener('input', emitTyping);
        document.addEventListener('keydown', emitTyping);
        return () => {
            document.removeEventListener('input', emitTyping);
            document.removeEventListener('keydown', emitTyping);
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            socket.emit('user-stop-typing', { entryId });
        };
    }, [entryId, currentUser]);

    // ---- Disconnect socket only on full unmount ----
    useEffect(() => {
        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, []);

    if (!entryId) return null;

    const getColor = (id: any) => {
        const strId = String(id);
        let hash = 0;
        for (let i = 0; i < strId.length; i++) {
            hash = strId.charCodeAt(i) + ((hash << 5) - hash);
        }
        return avatarColors[Math.abs(hash) % avatarColors.length];
    };

    return (
        <div className="presence-root-container">
            <style>{`
                .presence-root-container {
                    padding: 8px 0 0 0;
                    margin-bottom: 0px;
                    width: 100%;
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                }
                .presence-header {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    margin-bottom: 10px;
                    width: 100%;
                }
                .presence-title {
                    font-size: 11px;
                    font-weight: 800;
                    color: #4945ff;
                    letter-spacing: 0.05em;
                    text-transform: uppercase;
                    margin: 0;
                }
                .presence-status-dot {
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    position: relative;
                }
                .presence-status-dot.active::after {
                    content: '';
                    position: absolute;
                    top: 0; left: 0;
                    width: 7px;
                    height: 7px;
                    background: inherit;
                    border-radius: 50%;
                    animation: presence-pulse 2s infinite;
                }
                @keyframes presence-pulse {
                    0% { transform: scale(1); opacity: 0.8; }
                    100% { transform: scale(3); opacity: 0; }
                }
                .presence-avatar-list {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 6px;
                    align-items: center;
                    width: 100%;
                }
                .presence-avatar-item {
                    position: relative;
                    width: 30px;
                    height: 30px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 11px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: transform 0.2s ease;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.1);
                }
                .presence-avatar-item:hover {
                    transform: translateY(-2px);
                    z-index: 5;
                }
                .presence-tooltip {
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%) translateY(0);
                    background: #212134;
                    color: white;
                    padding: 5px 10px;
                    border-radius: 4px;
                    font-size: 10px;
                    white-space: nowrap;
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.2s ease;
                    pointer-events: none;
                }
                .presence-avatar-item:hover .presence-tooltip {
                    opacity: 1;
                    visibility: visible;
                    transform: translateX(-50%) translateY(-8px);
                }
                .presence-avatar-item.is-me {
                    filter: drop-shadow(0 0 3px rgba(73,69,255,0.35)) drop-shadow(0 2px 4px rgba(0,0,0,0.08));
                }
                .presence-typing-dots {
                    background: white;
                    border-radius: 4px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.15);
                    position: absolute;
                    bottom: -2px;
                    right: -2px;
                    min-width: 18px;
                    height: 10px;
                    display: flex;
                    gap: 2px;
                    align-items: center;
                    justify-content: center;
                }
                .presence-typing-dots span {
                    width: 2.5px;
                    height: 2.5px;
                    border-radius: 100%;
                    background: #d63939;
                    animation: presence-typing-bounce 1.4s ease-in-out infinite both;
                }
                .presence-typing-dots span:nth-child(1) { animation-delay: -0.32s; }
                .presence-typing-dots span:nth-child(2) { animation-delay: -0.16s; }
                @keyframes presence-typing-bounce {
                    0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
                    40% { transform: scale(1); opacity: 1; }
                }
            `}</style>

            <div className="presence-header">
                <span className="presence-title">Live Editing</span>
                <div
                    className={`presence-status-dot ${isConnected ? 'active' : ''}`}
                    style={{ background: isConnected ? '#32d08d' : '#f5c0b8' }}
                />
            </div>

            <div className="presence-avatar-list">
                {!isConnected ? (
                    <span style={{ fontSize: '11px', color: '#8e8ea9' }}>Connecting...</span>
                ) : allUsers.length > 0 ? (
                    allUsers.map((u, idx) => {
                        const isMe = currentUser && u.id === currentUser.id;
                        return (
                            <div
                                key={`${u.id}-${idx}`}
                                className={`presence-avatar-item${isMe ? ' is-me' : ''}`}
                                style={{ background: isMe ? '#4945ff' : (u.color || getColor(u.id)) }}
                            >
                                {u.initials}
                                {idx === allUsers.length - 1 && isConnected && typingUsers.length > 0 && (
                                    <div className="presence-typing-dots">
                                        <span /><span /><span />
                                    </div>
                                )}
                                <div className="presence-tooltip">
                                    {u.username} {isMe ? '(You)' : ''}
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <span style={{ fontSize: '11px', color: '#8e8ea9' }}>Ready</span>
                )}
            </div>
        </div>
    );
};

export default PresenceAvatars;
