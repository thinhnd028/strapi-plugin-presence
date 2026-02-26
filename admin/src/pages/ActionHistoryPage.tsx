import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box, Flex, Main, Typography, Table, Thead, Tbody, Tr, Th, Td,
  Loader, Button, Field, SingleSelect, SingleSelectOption, TextInput,
  IconButton,
} from '@strapi/design-system';
import { ArrowClockwise, Eye } from '@strapi/icons';
// @ts-ignore
import { Page } from '@strapi/strapi/admin';

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

const fmtDate = (d: string) => {
  try {
    return new Date(d).toLocaleString('en-US');
  } catch {
    return d;
  }
};

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
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionF, setActionF] = useState('');
  const [ctF, setCtF] = useState('');
  const [srcF, setSrcF] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [hasInitialNavigate, setHasInitialNavigate] = useState(false);

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
          <Typography id="action-history-title" variant="alpha" tag="h1" fontWeight="bold">
            Action History
          </Typography>
          <Box paddingTop={2}>
            <Typography variant="epsilon" textColor="neutral600">
              Audit log of content changes. Links to version snapshots when available.
            </Typography>
          </Box>
        </Box>

        <Box paddingBottom={4}>
          <Flex gap={3} wrap="wrap" alignItems="flex-end">
            <Box style={{ minWidth: 170 }}>
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
            </Box>
            <Box style={{ minWidth: 160 }}>
              <Field.Root>
                <Field.Label>Source</Field.Label>
                <SingleSelect value={srcF} onChange={(v) => handleFilterChange('source', v as string)}>
                  <SingleSelectOption value="">All</SingleSelectOption>
                  <SingleSelectOption value="admin">Admin Panel</SingleSelectOption>
                  <SingleSelectOption value="api">API</SingleSelectOption>
                </SingleSelect>
              </Field.Root>
            </Box>
            <Box style={{ minWidth: 200 }}>
              <Field.Root>
                <Field.Label>Content Type</Field.Label>
                <TextInput placeholder="e.g. news, event..." value={ctF} onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFilterChange('contentType', e.target.value)} />
              </Field.Root>
            </Box>
            <Box style={{ minWidth: 200 }}>
              <Field.Root>
                <Field.Label>Search</Field.Label>
                <TextInput placeholder="Document ID..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFilterChange('search', e.target.value)} />
              </Field.Root>
            </Box>
            <Button variant="tertiary" onClick={reset}>Clear filters</Button>
            <Button variant="secondary" onClick={fetchData} startIcon={<ArrowClockwise />}>Refresh</Button>
          </Flex>
        </Box>

        <Box paddingBottom={3}>
          <Typography variant="pi" textColor="neutral600">
            Total: {total} changes · Page {page}/{pageCount}
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
            <Table colCount={7} rowCount={data.length}>
              <Thead>
                <Tr>
                  {['Time', 'Action', 'Content Type', 'Document ID', 'User', 'Source', 'Details'].map(h => (
                    <Th key={h}><Typography variant="sigma">{h}</Typography></Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {data.map((entry: Record<string, unknown>) => {
                  const ai = ACTION_LABELS[entry.action as string] || { label: (entry.action as string) ?? '', bg: '#f0f0ff', fg: '#666' };
                  const u = entry.user as { username?: string; email?: string } | undefined;
                  return (
                    <Tr key={String(entry.id)}>
                      <Td><Typography variant="pi" style={{ whiteSpace: 'nowrap' }}>{fmtDate((entry.createdAt as string) ?? '')}</Typography></Td>
                      <Td><span style={{ padding: '3px 10px', borderRadius: 4, fontSize: 12, fontWeight: 700, background: ai.bg, color: ai.fg, display: 'inline-block' }}>{ai.label}</span></Td>
                      <Td><Typography variant="pi" fontWeight="bold">{fmtCT((entry.contentType as string) ?? '')}</Typography></Td>
                      <Td><Typography variant="pi" style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={(entry.targetDocumentId as string) ?? '-'}>{(entry.targetDocumentId as string) ?? '-'}</Typography></Td>
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

        {pageCount > 1 && (
          <Flex justifyContent="space-between" alignItems="center" paddingTop={6} gap={4} wrap="wrap">
            <Flex gap={2} alignItems="center">
              <Button variant="tertiary" onClick={() => updateUrl({ page: Math.max(1, page - 1) })} disabled={page <= 1}>← Previous</Button>
              <Flex gap={1} alignItems="center">
                {Array.from({ length: Math.min(pageCount, 7) }, (_, i) => {
                  let p: number;
                  if (pageCount <= 7) p = i + 1;
                  else if (page <= 4) p = i + 1;
                  else if (page >= pageCount - 3) p = pageCount - 6 + i;
                  else p = page - 3 + i;
                  return (
                    <Button key={p} variant={p === page ? 'secondary' : 'tertiary'} size="S" onClick={() => updateUrl({ page: p })}>{p}</Button>
                  );
                })}
              </Flex>
              <Button variant="tertiary" onClick={() => updateUrl({ page: Math.min(pageCount, page + 1) })} disabled={page >= pageCount}>Next →</Button>
            </Flex>
            {total > 10 && (
              <Flex alignItems="center" gap={2}>
                <Typography variant="pi" textColor="neutral600">Entries per page</Typography>
                <SingleSelect
                  value={String(pageSize)}
                  onChange={(v) => updateUrl({ pageSize: parseInt(v as string, 10), page: 1 })}
                  size="S"
                >
                  {PAGE_SIZE_OPTIONS.map(n => <SingleSelectOption key={n} value={String(n)}>{n}</SingleSelectOption>)}
                </SingleSelect>
              </Flex>
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
