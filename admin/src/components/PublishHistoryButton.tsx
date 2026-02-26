import React, { useState, useEffect } from 'react';
// @ts-ignore
import { unstable_useContentManagerContext as useContentManagerContext, useRBAC } from '@strapi/strapi/admin';
import {
    Button,
    Typography,
    Box,
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
    Badge,
    Loader,
    Modal,
    Flex,
    JSONInput,
} from '@strapi/design-system';
import { Clock, ArrowClockwise, ChevronDown, ChevronUp } from '@strapi/icons';
import { RecoveryView } from './RecoveryView';
import { pluginPermissions } from '../permissions';

const getStrapiBasePath = (): string => {
    const i = window.location.pathname.indexOf('/admin');
    return i > 0 ? window.location.pathname.substring(0, i) : '';
};

const SYSTEM_FIELDS = [
    'id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt',
    'createdBy', 'updatedBy', 'status', 'locale', 'localizations',
    'publishedBy', 'v', '_v',
];

function cleanForDisplay(data: any): any {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.map(cleanForDisplay);
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
        if (SYSTEM_FIELDS.includes(k)) continue;
        cleaned[k] = cleanForDisplay(v);
    }
    return cleaned;
}

const ActionBadge = ({ action }: { action: string }) => {
    if (action === 'published') {
        return (
            <Badge
                backgroundColor="success100"
                textColor="success700"
                style={{ fontWeight: 600 }}
            >
                Published
            </Badge>
        );
    }
    if (action === 'draft') {
        return (
            <Badge
                backgroundColor="secondary100"
                textColor="secondary700"
                style={{ fontWeight: 600 }}
            >
                Draft
            </Badge>
        );
    }
    // Fallback for old records without action field
    return (
        <Badge
            backgroundColor="success100"
            textColor="success700"
            style={{ fontWeight: 600 }}
        >
            Published
        </Badge>
    );
};

const HistoryModalContent = ({ documentId, slug, onClose }: any) => {
    const { allowedActions: { canUseRestore } = { canUseRestore: false } } = useRBAC(pluginPermissions);
    const [history, setHistory] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [expandedRow, setExpandedRow] = useState<string | null>(null);
    const [recoveryVersionId, setRecoveryVersionId] = useState<string | null>(null);
    const [filterAction, setFilterAction] = useState<'all' | 'draft' | 'published'>('all');
    const [expandedSnapshots, setExpandedSnapshots] = useState<Record<string, any>>({});
    const [loadingSnapshot, setLoadingSnapshot] = useState<string | null>(null);

    useEffect(() => {
        if (!documentId) return;

        const fetchHistory = async () => {
            setIsLoading(true);
            try {
                const response = await fetch(`${window.location.origin}${getStrapiBasePath()}/presence/list?documentId=${documentId}&contentType=${slug}`);
                if (!response.ok) throw new Error('Failed to fetch');
                const result = await response.json();
                if (result && Array.isArray(result.data)) {
                    setHistory(result.data);
                } else {
                    setHistory([]);
                }
            } catch (err) {
                console.error('[Publish History] Fetch error:', err);
                setHistory([]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchHistory();
    }, [documentId, slug]);

    // Normalize action for old records that don't have the field
    const getAction = (item: any) => item.action || 'published';

    const filteredHistory = filterAction === 'all'
        ? history
        : history.filter((item: any) => getAction(item) === filterAction);

    const handleRecoveryComplete = () => {
        window.location.reload();
    };

    const renderSnapshotPreview = (snapshot: any) => {
        if (!snapshot || typeof snapshot !== 'object') {
            return <Typography variant="pi" textColor="neutral500">No content data</Typography>;
        }
        try {
            const cleaned = cleanForDisplay(snapshot);
            const str = JSON.stringify(cleaned, null, 3);
            return (
                <Box>
                    <JSONInput
                        aria-label="Version snapshot"
                        value={str}
                        disabled
                    />
                </Box>
            );
        } catch {
            return <Typography variant="pi" textColor="neutral500">Unable to display (invalid structure)</Typography>;
        }
    };

    const draftCount = history.filter((i: any) => getAction(i) === 'draft').length;
    const publishedCount = history.filter((i: any) => getAction(i) === 'published').length;

    return (
        <>
            <Modal.Body>
                {recoveryVersionId ? (
                    <RecoveryView
                        versionId={recoveryVersionId}
                        onBack={() => setRecoveryVersionId(null)}
                        onComplete={handleRecoveryComplete}
                    />
                ) : isLoading ? (
                    <Flex padding={8} justifyContent="center" width="100%">
                        <Loader />
                    </Flex>
                ) : history.length === 0 ? (
                    <Box padding={4}>
                        <Typography>No history found for this document.</Typography>
                    </Box>
                ) : (
                    <>
                        {filteredHistory.length === 0 ? (
                            <Box padding={4}>
                                <Typography textColor="neutral500">No records match this filter.</Typography>
                            </Box>
                        ) : (
                            <Table
                                colCount={canUseRestore ? 5 : 4}
                                rowCount={filteredHistory.length}
                                style={{
                                    border: 'none',
                                    tableLayout: 'fixed',
                                    width: '100%',
                                }}
                            >
                                <Thead>
                                    <Tr>
                                        {canUseRestore && (
                                            <Th style={{ width: '50px' }}><Typography variant="sigma">Expand</Typography></Th>
                                        )}
                                        <Th style={{ width: '200px' }}><Typography variant="sigma">Time</Typography></Th>
                                        <Th style={{ width: '110px' }}><Typography variant="sigma">Type</Typography></Th>
                                        <Th><Typography variant="sigma">User</Typography></Th>
                                        {canUseRestore && (
                                            <Th style={{ width: '150px' }}><Typography variant="sigma">Action</Typography></Th>
                                        )}
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {filteredHistory.map((item: any) => (
                                        <React.Fragment key={item.documentId || item.id}>
                                            <Tr>
                                                {canUseRestore && (
                                                    <Td style={{ verticalAlign: 'middle', textAlign: 'center' }}>
                                                        <Button
                                                            onClick={() => {
                                                            const id = item.documentId || item.id;
                                                            if (expandedRow === id) {
                                                                setExpandedRow(null);
                                                            } else {
                                                                setExpandedRow(id);
                                                                if (!item.snapshot && !expandedSnapshots[id]) {
                                                                    setLoadingSnapshot(id);
                                                                    fetch(`${window.location.origin}${getStrapiBasePath()}/presence/version/${id}`)
                                                                        .then(r => r.ok ? r.json() : Promise.reject())
                                                                        .then(res => { setExpandedSnapshots(prev => ({ ...prev, [id]: res.data?.snapshot })); })
                                                                        .catch(() => {})
                                                                        .finally(() => setLoadingSnapshot(null));
                                                                }
                                                            }
                                                        }}
                                                            variant="ghost"
                                                            size="S"
                                                            style={{ padding: '4px', height: '32px', width: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                        >
                                                            {expandedRow === (item.documentId || item.id) ? <ChevronUp /> : <ChevronDown />}
                                                        </Button>
                                                    </Td>
                                                )}
                                                <Td>
                                                    <Typography textColor="neutral800">
                                                        {new Date(item.publishedAt).toLocaleString('en-US')}
                                                    </Typography>
                                                </Td>
                                                <Td>
                                                    <ActionBadge action={getAction(item)} />
                                                </Td>
                                                <Td>
                                                    <Typography textColor="neutral800" ellipsis title={item.author?.username || item.author?.email}>
                                                        {item.author?.username || item.author?.email || 'System'}
                                                    </Typography>
                                                </Td>
                                                {canUseRestore && (
                                                    <Td>
                                                        <Flex gap={2}>
                                                            <Button
                                                                variant="secondary"
                                                                startIcon={<ArrowClockwise />}
                                                                onClick={(e: any) => {
                                                                    e.stopPropagation();
                                                                    setRecoveryVersionId(item.documentId || item.id);
                                                                }}
                                                                size="S"
                                                            >
                                                                Restore
                                                            </Button>
                                                        </Flex>
                                                    </Td>
                                                )}
                                            </Tr>
                                            {canUseRestore && expandedRow === (item.documentId || item.id) && (
                                                <Tr>
                                                    <Td colSpan={5} style={{ padding: 0 }}>
                                                        {(loadingSnapshot === (item.documentId || item.id)) ? (
                                                            <Box padding={4}><Loader small /> Loading...</Box>
                                                        ) : renderSnapshotPreview(expandedSnapshots[item.documentId || item.id] ?? item.snapshot)}
                                                    </Td>
                                                </Tr>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </Tbody>
                            </Table>
                        )}
                    </>
                )}

            </Modal.Body>
            <Modal.Footer>
                <Flex justifyContent="flex-end" width="100%">
                    <Button onClick={onClose} variant="tertiary">Close</Button>
                </Flex>
            </Modal.Footer>
        </>
    );
};

// This is a Document Action Component
const PublishHistoryButton = ({ model, document }: any) => {
    const { allowedActions: { canAccessVersionHistory } = { canAccessVersionHistory: false } } = useRBAC(pluginPermissions);
    let context: any = null;
    try {
        context = useContentManagerContext();
    } catch (e) { }

    const hasDraftAndPublish = context?.hasDraftAndPublish;
    const documentId = document?.documentId || document?.id;
    const isCreatingEntry = context?.isCreatingEntry;

    if (!canAccessVersionHistory || !hasDraftAndPublish || isCreatingEntry || !documentId || !model?.startsWith('api::')) {
        return null;
    }

    return {
        id: 'publish-history-action',
        label: 'Version history',
        icon: <Clock />,
        position: 'header',
        onClick: () => {
            return false;
        },
        dialog: {
            type: 'modal',
            title: 'Version history',
            content: ({ onClose }: any) => (
                <HistoryModalContent
                    documentId={documentId}
                    slug={model}
                    onClose={onClose}
                />
            ),
        },
    };
};

// @ts-ignore
PublishHistoryButton.type = 'publish-history';

export default PublishHistoryButton;
