import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box, Flex, Main, Typography, Table, Thead, Tbody, Tr, Th, Td,
  Loader, Button, Field, SingleSelect, SingleSelectOption,
  IconButton, Searchbar, Tag, Popover, Pagination, PageLink, Dots, NextLink, PreviousLink,
} from '@strapi/design-system';
import { ArrowClockwise, Eye, Filter, Cross, Search } from '@strapi/icons';
// @ts-ignore
import { Page, useFetchClient } from '@strapi/strapi/admin';

import DetailModal from '../components/DetailModal';
import { pluginPermissions } from '../permissions';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_SORT = 'createdAt:desc';

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

/** entryId của presence room có dạng "api::page.page:abc123" hoặc "abc123" thuần.
 *  Tách thành label dễ đọc: "page / abc12345…" */
const fmtEntry = (entryId: string): string => {
  if (!entryId) return '';
  const [maybeUid, ...rest] = entryId.split(':');
  if (rest.length > 0 && maybeUid.startsWith('api::')) {
    const ct = fmtCT(maybeUid);
    const doc = rest.join(':');
    const shortDoc = doc.length > 10 ? `${doc.slice(0, 8)}…` : doc;
    return `${ct} / ${shortDoc}`;
  }
  return entryId.length > 24 ? `${entryId.slice(0, 22)}…` : entryId;
};

const getInitials = (name?: string | null): string => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

const PRESENCE_PALETTE = ['#4945ff', '#32d08d', '#ff5d5d', '#ffb54d', '#a155ff', '#211fad', '#007bff'];
const colorForId = (id: any): string => {
  const s = String(id ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return PRESENCE_PALETTE[Math.abs(h) % PRESENCE_PALETTE.length];
};

const fmtDate = (d: string) => {
  try {
    return new Date(d).toLocaleString('en-US');
  } catch {
    return d;
  }
};

/** Pagination ellipsis kiểu Strapi: [1, '...', n-1, n, n+1, '...', last].
 *  Luôn hiện trang đầu và cuối, các trang quanh active page, và dấu '...' khi cách quãng. */
function buildPaginationPages(active: number, total: number): Array<number | 'dots'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: Array<number | 'dots'> = [1];
  const start = Math.max(2, active - 1);
  const end = Math.min(total - 1, active + 1);
  if (start > 2) pages.push('dots');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push('dots');
  pages.push(total);
  return pages;
}

function buildSearchString(params: {
  pageSize: number;
  page: number;
  sort: string;
  action?: string;
  contentType?: string;
  source?: string;
  search?: string;
}): string {
  const p = new URLSearchParams();
  p.set('pageSize', String(params.pageSize));
  p.set('page', String(params.page));
  p.set('sort', params.sort);
  if (params.action) p.set('action', params.action);
  if (params.contentType) p.set('contentType', params.contentType);
  if (params.source) p.set('source', params.source);
  if (params.search) p.set('search', params.search);
  const s = p.toString();
  return s ? `?${s}` : '';
}

const ActionHistoryPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { get } = useFetchClient();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [activeUsersCount, setActiveUsersCount] = useState<number | null>(null);
  const [activeUsers, setActiveUsers] = useState<Array<{
    id: number | string | null;
    username: string | null;
    email: string | null;
    initials: string | null;
    color: string | null;
    entries: string[];
    tabCount: number;
  }>>([]);
  const [activeUsersError, setActiveUsersError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionF, setActionF] = useState('');
  const [ctF, setCtF] = useState('');
  const [srcF, setSrcF] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [hasInitialNavigate, setHasInitialNavigate] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const filtersTriggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const params = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return {
      pageSize: Math.min(Math.max(1, parseInt(searchParams.get('pageSize') ?? '', 10) || DEFAULT_PAGE_SIZE), 100) || DEFAULT_PAGE_SIZE,
      page: Math.max(1, parseInt(searchParams.get('page') ?? '', 10) || 1),
      sort: searchParams.get('sort') ?? DEFAULT_SORT,
      action: searchParams.get('action') ?? '',
      contentType: searchParams.get('contentType') ?? '',
      source: searchParams.get('source') ?? '',
      search: searchParams.get('search') ?? '',
    };
  }, [location.search]);

  const { pageSize, page, sort } = params;

  useEffect(() => {
    setActionF(params.action);
    setCtF(params.contentType);
    setSrcF(params.source);
    setSearch(params.search);
  }, [params.action, params.contentType, params.source, params.search]);

  useEffect(() => {
    if (!hasInitialNavigate && !location.search) {
      navigate({ pathname: location.pathname, search: buildSearchString({ pageSize: DEFAULT_PAGE_SIZE, page: 1, sort: DEFAULT_SORT }) }, { replace: true });
      setHasInitialNavigate(true);
    }
  }, [hasInitialNavigate, location.search, location.pathname, navigate]);

  const updateUrl = useCallback((updates: Partial<{ pageSize: number; page: number; sort: string; action: string; contentType: string; source: string; search: string }>) => {
    const next = {
      pageSize: updates.pageSize ?? params.pageSize,
      page: updates.page ?? params.page,
      sort: updates.sort ?? params.sort,
      action: updates.action ?? params.action,
      contentType: updates.contentType ?? params.contentType,
      source: updates.source ?? params.source,
      search: updates.search ?? params.search,
    };
    navigate({ pathname: location.pathname, search: buildSearchString(next) });
  }, [params, location.pathname, navigate]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const base = getStrapiBasePath();
      const p = new URLSearchParams();
      p.set('page', String(page));
      p.set('pageSize', String(pageSize));
      p.set('sort', sort);
      if (actionF) p.set('action', actionF);
      if (ctF) p.set('contentType', ctF);
      if (srcF) p.set('source', srcF);
      if (search) p.set('search', search);
      const url = `${window.location.origin}${base}/presence/action-history?${p.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('fetch failed');
      const json = (await res.json()) as { data?: Record<string, unknown>[]; meta?: { pagination?: { pageCount?: number; total?: number } } };
      setData(json.data ?? []);
      setPageCount(json.meta?.pagination?.pageCount ?? 1);
      setTotal(json.meta?.pagination?.total ?? 0);
    } catch (err) {
      console.error('[ActionHistory]', err);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sort, actionF, ctF, srcF, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch active users (yêu cầu permission plugin::presence.access-active-users)
  // Dùng useFetchClient của Strapi để admin SDK tự gắn access-token (Strapi 5 không lưu token ở storage)
  useEffect(() => {
    let cancelled = false;
    const fetchActiveUsers = async () => {
      try {
        const res = await get<{ uniqueCount?: number; count?: number; users?: typeof activeUsers }>('/presence/active-users');
        if (!cancelled) {
          const json = res?.data ?? {};
          setActiveUsersCount(json.uniqueCount ?? json.count ?? 0);
          setActiveUsers(Array.isArray(json.users) ? json.users : []);
          setActiveUsersError(null);
        }
      } catch (err: any) {
        if (cancelled) return;
        const status = err?.response?.status;
        if (status === 403) {
          setActiveUsersError('You need permission "Presence: View active users count" to see online users.');
        } else if (status === 401) {
          setActiveUsersError('Session expired – please re-login.');
        } else {
          setActiveUsersError(`Could not load online users (${status ?? 'network error'}).`);
        }
        setActiveUsersCount(0);
        setActiveUsers([]);
      }
    };
    fetchActiveUsers();
    const interval = setInterval(fetchActiveUsers, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [get]);

  // Mở sẵn input search nếu URL đã có search value (khi reload/share link)
  useEffect(() => {
    if (params.search && !searchOpen) setSearchOpen(true);
  }, [params.search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus input ngay khi mở
  useEffect(() => {
    if (searchOpen) {
      // Đợi DOM render xong rồi focus
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [searchOpen]);

  const activeFilterCount = useMemo(
    () => [actionF, srcF, ctF, search].filter(Boolean).length,
    [actionF, srcF, ctF, search]
  );

  /** Suy ra danh sách contentType từ kết quả hiện tại để gợi ý trong filter.
   *  Không cần endpoint riêng — chỉ là quick win, user có thể chọn từ những type đã xuất hiện. */
  const contentTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of data) {
      const ct = row.contentType as string | undefined;
      if (ct) set.add(ct);
    }
    if (ctF) set.add(ctF);
    return Array.from(set).sort();
  }, [data, ctF]);

  const reset = useCallback(() => {
    setActionF(''); setCtF(''); setSrcF(''); setSearch('');
    updateUrl({ action: '', contentType: '', source: '', search: '', page: 1 });
  }, [updateUrl]);

  const handleFilterChange = useCallback((key: 'action' | 'contentType' | 'source' | 'search', value: string) => {
    const setters: Record<string, (v: string) => void> = { action: setActionF, contentType: setCtF, source: setSrcF, search: setSearch };
    setters[key](value);
    const paramKey = key === 'contentType' ? 'contentType' : key === 'action' ? 'action' : key === 'source' ? 'source' : 'search';
    updateUrl({ [paramKey]: value, page: 1 });
  }, [updateUrl]);

  return (
    <Page.Protect permissions={pluginPermissions.accessActionHistory}>
    <Main labelledBy="action-history-title" aria-busy={loading}>
      <Box paddingLeft={10} paddingRight={10} paddingTop={6} paddingBottom={6} background="neutral100">
        <Box paddingBottom={6}>
          <Flex justifyContent="space-between" alignItems="flex-start" wrap="wrap" gap={4}>
            <Box>
              <Typography id="action-history-title" variant="alpha" tag="h1" fontWeight="bold">
                Action History
              </Typography>
              <Box paddingTop={2}>
                <Typography variant="epsilon" textColor="neutral600">
                  Audit log of content changes. Links to version snapshots when available.
                </Typography>
              </Box>
            </Box>
            {activeUsersCount !== null && !activeUsersError && (
              <Flex alignItems="center" gap={2} background="primary100" padding={3} hasRadius>
                <Box style={{ width: 8, height: 8, borderRadius: '50%', background: '#32d08d', boxShadow: '0 0 0 3px rgba(50,208,141,0.25)' }} />
                <Typography variant="sigma" textColor="primary600">Live</Typography>
                <Typography variant="omega" fontWeight="bold" textColor="primary700">
                  {activeUsersCount} {activeUsersCount === 1 ? 'user' : 'users'} online
                </Typography>
              </Flex>
            )}
          </Flex>
        </Box>

        {(activeUsersCount !== null || activeUsersError) && (
          <Box paddingBottom={6}>
            <Box background="neutral0" padding={4} hasRadius shadow="tableShadow">
              <Flex justifyContent="space-between" alignItems="center" paddingBottom={3}>
                <Typography variant="delta" fontWeight="bold">Who's online</Typography>
                <Typography variant="pi" textColor="neutral600">
                  Refreshes every 15s
                </Typography>
              </Flex>
              {activeUsersError ? (
                <Flex
                  alignItems="center"
                  gap={2}
                  background="warning100"
                  padding={3}
                  hasRadius
                >
                  <Typography variant="pi" textColor="warning700">
                    ⚠ {activeUsersError}
                  </Typography>
                </Flex>
              ) : activeUsers.length === 0 ? (
                <Typography variant="pi" textColor="neutral600">
                  No one else is in the CMS right now.
                </Typography>
              ) : (
                <Flex wrap="wrap" gap={3}>
                  {activeUsers.map((u) => {
                    const bg = u.color || colorForId(u.id);
                    const name = u.username || u.email || 'Unknown';
                    const initials = u.initials || getInitials(name);
                    return (
                      <Flex
                        key={String(u.id ?? name)}
                        alignItems="center"
                        gap={2}
                        background="neutral100"
                        paddingTop={2}
                        paddingBottom={2}
                        paddingLeft={2}
                        paddingRight={3}
                        hasRadius
                        style={{ minWidth: 200 }}
                      >
                        <Box
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            background: bg,
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: 13,
                            flexShrink: 0,
                          }}
                        >
                          {initials}
                        </Box>
                        <Box style={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="omega" fontWeight="bold" ellipsis>
                            {name}
                          </Typography>
                          <Typography variant="pi" textColor="neutral600" ellipsis>
                            {u.entries.length === 0
                              ? 'idle'
                              : u.entries.length === 1
                                ? fmtEntry(u.entries[0])
                                : `${fmtEntry(u.entries[0])} +${u.entries.length - 1}`}
                            {u.tabCount > 1 ? ` · ${u.tabCount} tabs` : ''}
                          </Typography>
                        </Box>
                      </Flex>
                    );
                  })}
                </Flex>
              )}
            </Box>
          </Box>
        )}

        {/* Toolbar style Strapi: Search icon-button (mở rộng khi click) + nút Filters (popover) + Refresh */}
        <Box paddingBottom={3}>
          <Flex gap={2} alignItems="center" wrap="wrap">
            {searchOpen ? (
              <Box style={{ flex: '1 1 320px', minWidth: 240, maxWidth: 480 }}>
                <Searchbar
                  ref={searchInputRef}
                  name="search"
                  value={search}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFilterChange('search', e.target.value)}
                  onClear={() => { handleFilterChange('search', ''); setSearchOpen(false); }}
                  onBlur={() => { if (!search) setSearchOpen(false); }}
                  clearLabel="Clear search"
                  placeholder="Search by Document ID..."
                >
                  Search by Document ID
                </Searchbar>
              </Box>
            ) : (
              <IconButton
                variant="tertiary"
                onClick={() => setSearchOpen(true)}
                label="Search"
                withTooltip
              >
                <Search />
              </IconButton>
            )}

            <Popover.Root open={filtersOpen} onOpenChange={setFiltersOpen}>
              <Popover.Trigger>
                <Button ref={filtersTriggerRef} variant="tertiary" startIcon={<Filter />}>
                  Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                </Button>
              </Popover.Trigger>
              <Popover.Content sideOffset={4} align="start">
                <Box padding={4} style={{ width: 320 }}>
                  <Flex direction="column" gap={3} alignItems="stretch">
                    <Field.Root>
                      <Field.Label>Action</Field.Label>
                      <SingleSelect value={actionF} onChange={(v) => handleFilterChange('action', v as string)}>
                        <SingleSelectOption value="">All</SingleSelectOption>
                        <SingleSelectOption value="create">Create</SingleSelectOption>
                        <SingleSelectOption value="update">Update</SingleSelectOption>
                        <SingleSelectOption value="publish">Publish</SingleSelectOption>
                        <SingleSelectOption value="unpublish">Unpublish</SingleSelectOption>
                        <SingleSelectOption value="delete">Delete</SingleSelectOption>
                        <SingleSelectOption value="discardDraft">Discard draft</SingleSelectOption>
                        <SingleSelectOption value="login">Login</SingleSelectOption>
                        <SingleSelectOption value="logout">Logout</SingleSelectOption>
                      </SingleSelect>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label>Source</Field.Label>
                      <SingleSelect value={srcF} onChange={(v) => handleFilterChange('source', v as string)}>
                        <SingleSelectOption value="">All</SingleSelectOption>
                        <SingleSelectOption value="admin">Admin Panel</SingleSelectOption>
                        <SingleSelectOption value="api">API</SingleSelectOption>
                      </SingleSelect>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label>Content Type</Field.Label>
                      <SingleSelect
                        value={ctF}
                        onChange={(v) => handleFilterChange('contentType', v as string)}
                      >
                        <SingleSelectOption value="">All</SingleSelectOption>
                        {contentTypeOptions.map((ct) => (
                          <SingleSelectOption key={ct} value={ct}>{fmtCT(ct)}</SingleSelectOption>
                        ))}
                      </SingleSelect>
                    </Field.Root>
                    <Flex justifyContent="space-between" paddingTop={2}>
                      <Button variant="tertiary" size="S" onClick={() => { reset(); setFiltersOpen(false); }}>
                        Clear all
                      </Button>
                      <Button variant="default" size="S" onClick={() => setFiltersOpen(false)}>
                        Done
                      </Button>
                    </Flex>
                  </Flex>
                </Box>
              </Popover.Content>
            </Popover.Root>

            <IconButton variant="tertiary" onClick={fetchData} label="Refresh" withTooltip>
              <ArrowClockwise />
            </IconButton>
          </Flex>
        </Box>

        {/* Filter chips */}
        {activeFilterCount > 0 && (
          <Box paddingBottom={3}>
            <Flex gap={2} wrap="wrap">
              {actionF && (
                <Tag icon={<Cross />} onClick={() => handleFilterChange('action', '')}>
                  Action: {ACTION_LABELS[actionF]?.label ?? actionF}
                </Tag>
              )}
              {srcF && (
                <Tag icon={<Cross />} onClick={() => handleFilterChange('source', '')}>
                  Source: {SOURCE_LABELS[srcF] ?? srcF}
                </Tag>
              )}
              {ctF && (
                <Tag icon={<Cross />} onClick={() => handleFilterChange('contentType', '')}>
                  Type: {fmtCT(ctF)}
                </Tag>
              )}
              {search && (
                <Tag icon={<Cross />} onClick={() => handleFilterChange('search', '')}>
                  Search: {search}
                </Tag>
              )}
            </Flex>
          </Box>
        )}

        <Box paddingBottom={3}>
          <Typography variant="pi" textColor="neutral600">
            {total} {total === 1 ? 'entry' : 'entries'} found
          </Typography>
        </Box>

        {loading ? (
          <Flex justifyContent="center" padding={8}><Loader /></Flex>
        ) : data.length === 0 ? (
          <Box padding={8} background="neutral0" hasRadius style={{ textAlign: 'center' }}>
            <Typography variant="pi" textColor="neutral600">
              No action history yet.
            </Typography>
          </Box>
        ) : (
          <Box hasRadius style={{ overflow: 'hidden' }}>
            <Table colCount={8} rowCount={data.length}>
              <Thead>
                <Tr>
                  {['Time', 'Action', 'Content Type', 'Document ID', 'Changes', 'User', 'Source', 'Details'].map(h => (
                    <Th key={h}><Typography variant="sigma">{h}</Typography></Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {data.map((entry: Record<string, unknown>) => {
                  const ai = ACTION_LABELS[entry.action as string] || { label: (entry.action as string) ?? '', bg: '#f0f0ff', fg: '#666' };
                  const u = entry.user as { username?: string; email?: string } | undefined;
                  const changedFields = Array.isArray(entry.changedFields) ? (entry.changedFields as string[]) : [];
                  const isNoOp = entry.hasChanges === false;
                  return (
                    <Tr key={String(entry.id)} style={isNoOp ? { opacity: 0.65 } : undefined}>
                      <Td><Typography variant="pi" style={{ whiteSpace: 'nowrap' }}>{fmtDate((entry.createdAt as string) ?? '')}</Typography></Td>
                      <Td><span style={{ padding: '3px 10px', borderRadius: 4, fontSize: 12, fontWeight: 700, background: ai.bg, color: ai.fg, display: 'inline-block' }}>{ai.label}</span></Td>
                      <Td><Typography variant="pi" fontWeight="bold">{fmtCT((entry.contentType as string) ?? '')}</Typography></Td>
                      <Td><Typography variant="pi" style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={(entry.targetDocumentId as string) ?? '-'}>{(entry.targetDocumentId as string) ?? '-'}</Typography></Td>
                      <Td>
                        {isNoOp ? (
                          <Typography variant="pi" textColor="neutral500" style={{ fontStyle: 'italic' }}>No change</Typography>
                        ) : changedFields.length > 0 ? (
                          <span
                            title={changedFields.join(', ')}
                            style={{
                              padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                              background: '#fdf4dc', color: '#9e6d14',
                              fontFamily: 'monospace', display: 'inline-block',
                              maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                          >
                            {changedFields.slice(0, 2).join(', ')}{changedFields.length > 2 ? ` +${changedFields.length - 2}` : ''}
                          </span>
                        ) : (
                          <Typography variant="pi" textColor="neutral500">—</Typography>
                        )}
                      </Td>
                      <Td><Typography variant="pi">{u?.username ?? u?.email ?? 'System'}</Typography></Td>
                      <Td><Typography variant="pi" textColor="neutral600">{SOURCE_LABELS[(entry.source as string) ?? ''] ?? '-'}</Typography></Td>
                      <Td>
                        <IconButton variant="tertiary" size="S" onClick={() => setSelected(entry)} style={{ fontWeight: 600 }} label='View' withTooltip={false}>
                          <Eye />
                        </IconButton>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </Box>
        )}

        {/* Pagination style Strapi: page-size selector trái, Pagination component phải */}
        {(pageCount > 1 || total > PAGE_SIZE_OPTIONS[0]) && (
          <Flex justifyContent="space-between" alignItems="center" paddingTop={4} gap={4} wrap="wrap">
            <Flex alignItems="center" gap={2}>
              <SingleSelect
                size="S"
                aria-label="Entries per page"
                value={String(pageSize)}
                onChange={(v) => updateUrl({ pageSize: parseInt(v as string, 10), page: 1 })}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SingleSelectOption key={n} value={String(n)}>{n}</SingleSelectOption>
                ))}
              </SingleSelect>
              <Typography variant="pi" textColor="neutral600">Entries per page</Typography>
            </Flex>

            {pageCount > 1 && (
              <Pagination activePage={page} pageCount={pageCount} label="Pagination">
                <PreviousLink
                  // @ts-ignore – BaseLink polymorphic, render as button để dùng onClick
                  as="button"
                  onClick={(e: React.MouseEvent) => {
                    e.preventDefault();
                    if (page > 1) updateUrl({ page: page - 1 });
                  }}
                >
                  Previous
                </PreviousLink>
                {buildPaginationPages(page, pageCount).map((entry, i) =>
                  entry === 'dots' ? (
                    <Dots key={`dots-${i}`} />
                  ) : (
                    <PageLink
                      key={entry}
                      number={entry}
                      // @ts-ignore – polymorphic
                      as="button"
                      onClick={(e: React.MouseEvent) => {
                        e.preventDefault();
                        updateUrl({ page: entry });
                      }}
                    >
                      {entry}
                    </PageLink>
                  )
                )}
                <NextLink
                  // @ts-ignore – polymorphic
                  as="button"
                  onClick={(e: React.MouseEvent) => {
                    e.preventDefault();
                    if (page < pageCount) updateUrl({ page: page + 1 });
                  }}
                >
                  Next
                </NextLink>
              </Pagination>
            )}
          </Flex>
        )}
      </Box>
      {selected && <DetailModal entry={selected} onClose={() => setSelected(null)} />}
    </Main>
    </Page.Protect>
  );
};

export default ActionHistoryPage;
