import React, { useEffect, useState, useRef, useCallback } from 'react';
// @ts-ignore
import { useParams, useLocation } from 'react-router-dom';
// @ts-ignore
import { useAuth } from '@strapi/strapi/admin';

const avatarColors = [
    '#4945ff', '#32d08d', '#ff5d5d', '#ffb54d',
    '#a155ff', '#211fad', '#007bff',
];

const getStrapiBasePath = (): string => {
    const path = window.location.pathname;
    const adminIndex = path.indexOf('/admin');
    return adminIndex > 0 ? path.substring(0, adminIndex) : '';
};

const getColor = (id: any): string => {
    const strId = String(id);
    let hash = 0;
    for (let i = 0; i < strId.length; i++) {
        hash = strId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return avatarColors[Math.abs(hash) % avatarColors.length];
};

/**
 * Lấy contentType UID từ pathname Content Manager:
 *   /admin/content-manager/collection-types/api::page.page/abc123 → api::page.page
 *   /admin/content-manager/single-types/api::about-page.about-page → api::about-page.about-page
 * Trả về '' nếu không phải URL Content Manager (giữ entryId ổn định cho route khác).
 */
const extractContentTypeUid = (pathname: string): string => {
    const match = pathname.match(/\/content-manager\/(?:collection-types|single-types)\/([^/?#]+)/);
    return match?.[1] ?? '';
};

const PresenceAvatars = () => {
    const params = useParams<any>();
    const location = useLocation();
    const docPart = params.id || params.documentId || params.slug || '';
    const contentTypeUid = extractContentTypeUid(location?.pathname || '');
    // Gom theo contentType + documentId để hai content type cùng documentId không va phòng,
    // nhưng draft và published của CÙNG document vẫn chung phòng (status nằm trong query string, không tính).
    const entryId = contentTypeUid && docPart
        ? `${contentTypeUid}:${docPart}`
        : (docPart || (location?.pathname || ''));

    const [allUsers, setAllUsers] = useState<any[]>([]);
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [typingUsers, setTypingUsers] = useState<any[]>([]);

    const wsRef = useRef<WebSocket | null>(null);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevEntryIdRef = useRef<string | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectCountRef = useRef(0);
    const mountedRef = useRef(true);
    const currentUserRef = useRef<any>(null);
    const entryIdRef = useRef<string>(entryId);

    useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);
    useEffect(() => { entryIdRef.current = entryId; }, [entryId]);

    const sendMsg = useCallback((data: object) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }, []);

    // Unmount cleanup
    useEffect(() => {
        return () => {
            mountedRef.current = false;
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, []);

    // Read current admin user from AuthProvider (single source of truth in admin)
    const authUser = useAuth('PresenceAvatars', (state: any) => state.user);

    useEffect(() => {
        if (!authUser) return;

        const first = (authUser.firstname as string) || '';
        const last = (authUser.lastname as string) || '';
        const fullName = (first + (last ? ` ${last}` : '')).trim();
        const displayName = fullName || (authUser.username as string) || (authUser.email as string) || 'Admin';

        const initials = first
            ? (first[0] + (last ? last[0] : '')).toUpperCase().slice(0, 2)
            : (((authUser.username as string) || (authUser.email as string) || 'A')[0] || 'A').toUpperCase();

        setCurrentUser({
            id: (authUser.id as number | string) ?? ('anon-' + Math.random().toString(36).substring(2, 7)),
            username: displayName,
            email: (authUser.email as string) || null,
            initials,
        });
    }, [authUser]);

    // Create WebSocket connection once when currentUser is ready
    useEffect(() => {
        if (!currentUser) return;
        if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) return;

        const basePath = getStrapiBasePath();

        const connect = () => {
            if (!mountedRef.current) return;

            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(`${proto}//${window.location.host}${basePath}/ws/presence`);
            wsRef.current = ws;

            ws.onopen = () => {
                if (!mountedRef.current) { ws.close(); return; }
                reconnectCountRef.current = 0;
                setIsConnected(true);
                const eid = entryIdRef.current;
                const user = currentUserRef.current;
                if (eid && user) {
                    ws.send(JSON.stringify({ type: 'join-entry', entryId: eid, user }));
                }
            };

            ws.onmessage = (event: MessageEvent) => {
                if (!mountedRef.current) return;
                try {
                    const msg = JSON.parse(event.data as string);
                    if (msg.type === 'presence-update') {
                        const raw: any[] = msg.users || [];
                        setAllUsers(Array.from(new Map(raw.map(u => [u.id, u])).values()));
                    } else if (msg.type === 'typing-update') {
                        setTypingUsers(msg.users || []);
                    }
                } catch {}
            };

            ws.onclose = () => {
                if (!mountedRef.current) return;
                setIsConnected(false);
                setAllUsers([]);
                setTypingUsers([]);
                if (reconnectCountRef.current < 10) {
                    const delay = Math.min(1000 * Math.pow(1.5, reconnectCountRef.current), 5000);
                    reconnectCountRef.current++;
                    reconnectTimerRef.current = setTimeout(connect, delay);
                }
            };

            ws.onerror = () => {};
        };

        connect();
    }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

    // Handle entryId changes: leave old room, join new room
    useEffect(() => {
        if (!entryId) return;

        const prev = prevEntryIdRef.current;
        if (prev && prev !== entryId) {
            sendMsg({ type: 'leave-entry', entryId: prev });
            setAllUsers([]);
            setTypingUsers([]);
        }
        prevEntryIdRef.current = entryId;

        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN && currentUser) {
            ws.send(JSON.stringify({ type: 'join-entry', entryId, user: currentUser }));
        }
    }, [entryId, currentUser, sendMsg]);

    // Emit typing events
    useEffect(() => {
        if (!entryId || !currentUser) return;
        const emitTyping = () => {
            sendMsg({ type: 'user-typing', entryId, userId: currentUser.id, username: currentUser.username });
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = setTimeout(() => {
                sendMsg({ type: 'user-stop-typing', entryId });
                typingTimeoutRef.current = null;
            }, 1500);
        };
        document.addEventListener('input', emitTyping);
        document.addEventListener('keydown', emitTyping);
        return () => {
            document.removeEventListener('input', emitTyping);
            document.removeEventListener('keydown', emitTyping);
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            sendMsg({ type: 'user-stop-typing', entryId });
        };
    }, [entryId, currentUser, sendMsg]);

    if (!entryId) return null;

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
