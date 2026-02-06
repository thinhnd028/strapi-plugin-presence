import React, { useEffect, useState, useMemo } from 'react';
// @ts-ignore
import { useParams } from 'react-router-dom';
// @ts-ignore
import { io } from 'socket.io-client';

const avatarColors = [
    '#4945ff', // Strapi Purple
    '#32d08d', // Green
    '#ff5d5d', // Red
    '#ffb54d', // Orange
    '#a155ff', // Violet
    '#211fad', // Dark Blue
    '#007bff'  // Sky Blue
];

const PresenceAvatars = () => {
    const params = useParams<any>();
    const entryId = params.id || params.documentId || params.slug;

    const [allUsers, setAllUsers] = useState<any[]>([]);
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        const getCookie = (name: string) => {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) return parts.pop()?.split(';').shift();
            return null;
        };

        const fetchMe = async () => {
            try {
                const token = getCookie('jwtToken') || localStorage.getItem('jwtToken');
                const response = await fetch(`${window.location.origin}/admin/users/me`, {
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
                });

                if (response.ok) {
                    const resData = await response.json();
                    setCurrentUser({
                        id: resData.data.id || Math.random(),
                        username: resData.data.firstname || resData.data.username || 'Admin',
                        initials: (resData.data.firstname?.[0] || 'A').toUpperCase()
                    });
                } else {
                    setCurrentUser({
                        id: 'anon-' + Math.random().toString(36).substring(2, 7),
                        username: 'Someone',
                        initials: '?'
                    });
                }
            } catch (err) { }
        };
        fetchMe();
    }, []);

    const socket = useMemo(() => {
        try {
            return io(window.location.origin, { transports: ['websocket', 'polling'] });
        } catch { return null; }
    }, []);

    useEffect(() => {
        if (!socket || !entryId || !currentUser) return;

        const onConnect = () => {
            setIsConnected(true);
            socket.emit('join-entry', { entryId, user: currentUser });
        };
        const onUpdate = (users: any[]) => {
            const uniqueUsers = Array.from(new Map((users || []).map(u => [u.id, u])).values());
            setAllUsers(uniqueUsers);
        };
        const onDisconnect = () => setIsConnected(false);

        socket.on('connect', onConnect);
        socket.on('presence-update', onUpdate);
        socket.on('disconnect', onDisconnect);

        if (socket.connected) onConnect();

        return () => {
            socket.off('connect', onConnect);
            socket.off('presence-update', onUpdate);
            socket.off('disconnect', onDisconnect);
            socket.disconnect();
        };
    }, [entryId, currentUser, socket]);

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
                    justify-content: flex-start;
                    text-align: left;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                }
                .presence-header {
                    display: flex;
                    align-items: center;
                    justify-content: flex-start;
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
                    background: #32d08d;
                    box-shadow: 0 0 8px rgba(50, 208, 141, 0.4);
                }
                .presence-status-dot.active::after {
                    content: '';
                    position: absolute;
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
                    justify-content: flex-start;
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
                .presence-me-badge {
                    position: absolute;
                    bottom: -1px;
                    right: -1px;
                    width: 9px;
                    height: 9px;
                    background: white;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: 1.5px solid #4945ff;
                }
                .presence-me-inner {
                    width: 3px;
                    height: 3px;
                    background: #4945ff;
                    border-radius: 50%;
                }
            `}</style>

            <div className="presence-header">
                <span className="presence-title">Live Editing</span>
                <div className={`presence-status-dot ${isConnected ? 'active' : ''}`} style={{ background: isConnected ? '#32d08d' : '#f5c0b8' }} />
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
                                className="presence-avatar-item"
                                style={{ background: isMe ? '#4945ff' : getColor(u.id) }}
                            >
                                {u.initials}
                                {isMe && (
                                    <div className="presence-me-badge">
                                        <div className="presence-me-inner" />
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
