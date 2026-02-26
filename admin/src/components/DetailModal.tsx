import React from 'react';
import { Typography, Button, Modal, Flex, JSONInput } from '@strapi/design-system';
import { Link } from '@strapi/icons';

const ACTION_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  create: { label: 'Create', bg: '#eafbe7', fg: '#328048' },
  update: { label: 'Update', bg: '#fdf4dc', fg: '#9e6d14' },
  publish: { label: 'Publish', bg: '#d9f0ff', fg: '#0c75af' },
  unpublish: { label: 'Unpublish', bg: '#f0e6ff', fg: '#7b2cbf' },
  delete: { label: 'Delete', bg: '#fcecea', fg: '#d02b20' },
  discardDraft: { label: 'Discard draft', bg: '#f5f0ff', fg: '#7b61ff' },
  login: { label: 'Login', bg: '#e0f7fa', fg: '#00838f' },
  logout: { label: 'Logout', bg: '#eceff1', fg: '#546e7a' },
};

const SOURCE_LABELS: Record<string, string> = { admin: 'Admin Panel', api: 'API' };

const getStrapiBasePath = (): string => {
  const i = window.location.pathname.indexOf('/admin');
  return i > 0 ? window.location.pathname.substring(0, i) : '';
};

const fmtCT = (uid: string) => {
  const m = uid.match(/^api::([a-z0-9-]+)\./);
  return m ? m[1] : uid;
};

const fmtDate = (d: string) => {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
};

const sty = {
  sectionTitle: {
    fontSize: 11,
    fontWeight: 800,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#666687',
    marginBottom: 8,
    display: 'block',
  } as React.CSSProperties,
  badge: (bg: string, fg: string) => ({
    display: 'inline-block',
    padding: '4px 14px',
    borderRadius: 4,
    background: bg,
    color: fg,
    fontWeight: 700,
    fontSize: 13,
  }),
};

export interface DetailModalProps {
  entry: any;
  onClose: () => void;
}

const DetailModal = ({ entry, onClose }: DetailModalProps) => {
  const ai =
    ACTION_LABELS[entry.action as string] || { label: (entry.action as string) ?? '', bg: '#f0f0ff', fg: '#666' };
  const u = entry.user as { username?: string; email?: string } | undefined;
  const base = getStrapiBasePath();

  return (
    <Modal.Root open onOpenChange={onClose}>
      <Modal.Content>
        <Modal.Header>
          <Typography variant="beta" tag="h2">
            Action details
          </Typography>
        </Modal.Header>
        <Modal.Body>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={sty.badge(ai.bg, ai.fg)}>{ai.label}</span>
                <Typography variant="epsilon" fontWeight="bold">
                  {fmtCT((entry.contentType as string) ?? '')}
                </Typography>
              </div>
              <Typography variant="pi" textColor="neutral600" style={{ marginTop: 8 }}>
                {fmtDate((entry.createdAt as string) ?? '')} · {SOURCE_LABELS[(entry.source as string) ?? ''] ?? (entry.source as string)}
              </Typography>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <span style={sty.sectionTitle}>Performed by</span>
                {u ? (
                  <>
                    <Typography variant="pi" textColor="neutral600" style={{ marginTop: 2 }}>
                      {u.email}
                    </Typography>
                  </>
                ) : (
                  <Typography variant="pi" textColor="neutral600">
                    System
                  </Typography>
                )}
              </div>
              <div>
                <span style={sty.sectionTitle}>Document ID</span>
                <Typography variant="pi" style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {(entry.targetDocumentId as string) ?? '—'}
                </Typography>
              </div>
            </div>

            {entry.filters && typeof entry.filters === 'object' && 'locale' in entry.filters && (
              <div>
                <span style={sty.sectionTitle}>Locale</span>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '3px 10px',
                    borderRadius: 4,
                    background: '#eaeaef',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {String((entry.filters as { locale?: string }).locale ?? "")}
                </span>
              </div>
            )}

            {entry.versionDocumentId && (
              <div>
                <span style={sty.sectionTitle}>Version snapshot</span>
                <a
                  href={`${base}/admin/content-manager/collection-types/plugin::presence.version/${entry.versionDocumentId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: '#4945ff',
                    fontWeight: 600,
                    fontSize: 13,
                    textDecoration: 'none',
                  }}
                >
                  <Link width={16} height={16} /> View snapshot
                </a>
              </div>
            )}

            {entry.afterData && typeof entry.afterData === 'object' && Object.keys(entry.afterData as object).length > 0 && (
              <div>
                <span style={sty.sectionTitle}>Payload</span>
                <JSONInput
                  aria-label="JSON"
                  value={JSON.stringify(
                    entry.afterData,
                    null,
                    3,
                  )}
                />
              </div>
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Flex justifyContent="flex-end" width="100%">
            <Button onClick={onClose} variant="tertiary">
              Close
            </Button>
          </Flex>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default DetailModal;
