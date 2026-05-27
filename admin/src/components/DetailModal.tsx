import React from 'react';
import { Typography, Button, Modal, Flex } from '@strapi/design-system';
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

/** Tokenize text giữ HTML tag, từ chữ-số, khoảng trắng, hoặc ký tự lẻ. Đủ tốt cho text/HTML ngắn. */
const tokenize = (s: string): string[] => s.match(/<[^>]+>|[\p{L}\p{N}]+|\s+|./gu) || [];

/** LCS-based diff. Trả về danh sách segment {type, text}. */
const diffTokens = (a: string[], b: string[]): Array<{ type: 'eq' | 'del' | 'ins'; text: string }> => {
  const n = a.length, m = b.length;
  // Giới hạn an toàn: nếu tích quá lớn → fallback so sánh whole-string
  if (n * m > 1_500_000) {
    if (a.join('') === b.join('')) return [{ type: 'eq', text: a.join('') }];
    return [{ type: 'del', text: a.join('') }, { type: 'ins', text: b.join('') }];
  }
  const dp: Uint32Array = new Uint32Array((n + 1) * (m + 1));
  const idx = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[idx(i, j)] = a[i] === b[j] ? dp[idx(i + 1, j + 1)] + 1 : Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)]);
    }
  }
  const out: Array<{ type: 'eq' | 'del' | 'ins'; text: string }> = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'eq', text: a[i] }); i++; j++; }
    else if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) { out.push({ type: 'del', text: a[i] }); i++; }
    else { out.push({ type: 'ins', text: b[j] }); j++; }
  }
  while (i < n) { out.push({ type: 'del', text: a[i] }); i++; }
  while (j < m) { out.push({ type: 'ins', text: b[j] }); j++; }
  // Gộp segment liên tiếp cùng type cho gọn DOM
  const merged: typeof out = [];
  for (const seg of out) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
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

/** Format bytes về dạng dễ đọc (B/KB/MB). */
const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

/** Payload section: hiện size + nút View → mở tab mới render JSON như endpoint API. */
const PayloadBlock = ({ data }: { data: unknown }) => {
  const json = JSON.stringify(data, null, 2);
  const size = new Blob([json]).size;

  const openInTab = () => {
    // Tạo blob URL với content-type application/json — Chrome/Firefox tự pretty-print, có cây JSON.
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    // Giải phóng URL sau ít phút (tab mới đã giữ reference khi nó load xong)
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div>
      <Flex alignItems="center" gap={2}>
        <span style={sty.sectionTitle}>Payload</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#666687', padding: '2px 8px', borderRadius: 4, background: '#eaeaef' }}>
          {formatBytes(size)}
        </span>
        <Button size="S" variant="tertiary" onClick={openInTab}>
          View
        </Button>
      </Flex>
    </div>
  );
};

const DetailModal = ({ entry, onClose }: DetailModalProps) => {
  const ai =
    ACTION_LABELS[entry.action as string] || { label: (entry.action as string) ?? '', bg: '#f0f0ff', fg: '#666' };
  const u = entry.user as { username?: string; email?: string } | undefined;
  const base = getStrapiBasePath();

  return (
    <Modal.Root open onOpenChange={onClose}>
      <Modal.Content style={{ maxWidth: 'min(1280px, 95vw)', width: '95vw' }}>
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

            {(entry.locale || (entry.filters && typeof entry.filters === 'object' && 'locale' in entry.filters)) && (
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
                  {String((entry.locale as string) ?? (entry.filters as { locale?: string })?.locale ?? "")}
                </span>
              </div>
            )}

            {(entry.ip || entry.userAgent) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
                {entry.ip && (
                  <div>
                    <span style={sty.sectionTitle}>IP address</span>
                    <Typography variant="pi" style={{ fontFamily: 'monospace' }}>
                      {String(entry.ip)}
                    </Typography>
                  </div>
                )}
                {entry.userAgent && (
                  <div style={{ minWidth: 0 }}>
                    <span style={sty.sectionTitle}>User agent</span>
                    <Typography variant="pi" textColor="neutral600" style={{ wordBreak: 'break-all' }}>
                      {String(entry.userAgent)}
                    </Typography>
                  </div>
                )}
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
              <PayloadBlock data={entry.afterData} />
            )}

            {/* Trạng thái thay đổi: hiện chips changedFields hoặc bảng Before/After.
                Đặt cuối cùng vì có thể rất dài khi sửa nhiều field. */}
            {(entry.hasChanges === false || (Array.isArray(entry.changedFields) && entry.changedFields.length > 0)) && (
              <div>
                <span style={sty.sectionTitle}>Changed fields</span>
                {entry.hasChanges === false ? (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '3px 10px',
                      borderRadius: 4,
                      background: '#eceff1',
                      color: '#546e7a',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    No changes (no-op)
                  </span>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(entry.changedFields as string[]).map((f) => (
                        <span
                          key={f}
                          style={{
                            padding: '3px 10px',
                            borderRadius: 4,
                            background: '#fdf4dc',
                            color: '#9e6d14',
                            fontSize: 12,
                            fontWeight: 600,
                            fontFamily: 'monospace',
                          }}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                    {entry.changedValues && typeof entry.changedValues === 'object' && (
                      <div style={{ marginTop: 12, border: '1px solid #eaeaef', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', background: '#f6f6f9', padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#666687', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                          <div>Field</div>
                          <div>Before</div>
                          <div>After</div>
                        </div>
                        {(entry.changedFields as string[]).map((f) => {
                          const pair = (entry.changedValues as Record<string, { before: unknown; after: unknown }>)[f];
                          const a = pair?.before;
                          const b = pair?.after;
                          const aStr = a == null ? '' : (typeof a === 'string' ? a : JSON.stringify(a));
                          const bStr = b == null ? '' : (typeof b === 'string' ? b : JSON.stringify(b));
                          const segs = diffTokens(tokenize(aStr), tokenize(bStr));
                          const renderSide = (kind: 'before' | 'after') => {
                            if ((kind === 'before' ? a : b) == null) return <span style={{ color: '#a5a5ba' }}>—</span>;
                            const keepDel = kind === 'before';
                            const keepIns = kind === 'after';
                            return segs.map((s, i) => {
                              if (s.type === 'eq') return <span key={i}>{s.text}</span>;
                              if (s.type === 'del' && keepDel) return <span key={i} style={{ background: '#fbe1de', color: '#a8261c', borderRadius: 2 }}>{s.text}</span>;
                              if (s.type === 'ins' && keepIns) return <span key={i} style={{ background: '#daf3df', color: '#0e6b27', borderRadius: 2 }}>{s.text}</span>;
                              return null;
                            });
                          };
                          return (
                            <div key={f} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', borderTop: '1px solid #eaeaef', padding: '8px 10px', fontSize: 12, alignItems: 'start' }}>
                              <div style={{ fontFamily: 'monospace', color: '#4a4a6a', wordBreak: 'break-all' }}>{f}</div>
                              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#4a4a6a' }}>{renderSide('before')}</div>
                              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#4a4a6a' }}>{renderSide('after')}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
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
