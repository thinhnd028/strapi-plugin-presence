import React, { useState, useEffect, useCallback } from 'react';
import {
  Button,
  Typography,
  Box,
  Flex,
  Loader,
} from '@strapi/design-system';
import { Check, ArrowLeft, Play, Stop, Code } from '@strapi/icons';

const getStrapiBasePath = (): string => {
  const i = window.location.pathname.indexOf('/admin');
  return i > 0 ? window.location.pathname.substring(0, i) : '';
};

const base = () => `${window.location.origin}${getStrapiBasePath()}/presence`;

interface DynamicZoneItem {
  displayName: string;
  relations: Record<string, { ok: number; missing: number }>;
  media: Record<string, { ok: number; missing: number }>;
  nestedComponents?: string[];
  nestedRelations?: Record<string, { ok: number; missing: number }>;
  count: number;
}

interface RestoreAssessment {
  overallPercent: number;
  fieldsOk: number;
  fieldsLost: number;
  fieldsBasic?: number;
  fieldsComponent?: number;
  relationsOk: number;
  relationsMissing: number;
  mediaOk: number;
  mediaMissing: number;
  schemaChanges: { missingInSchema: string[]; newRequiredInSchema: string[] };
  percentExplanation?: string;
  fieldNamesOk?: string[];
  fieldNamesLost?: string[];
  relationDetails?: Record<string, { ok: number; missing: number }>;
  mediaDetails?: Record<string, { ok: number; missing: number }>;
  schemaUnresolved?: string[];
  dynamicZoneDetails?: Record<string, DynamicZoneItem>;
}

interface AssessStep {
  step: string;
  status: string;
  message: string;
  estimatedMs?: number;
}

interface RecoveryViewProps {
  versionId: string;
  onBack: () => void;
  onComplete: () => void;
}

const RECOVERY_STYLES = `
  .recovery-root {
    --recovery-accent: #0d9488;
    --recovery-accent-muted: rgba(13, 148, 136, 0.12);
    --recovery-success: #059669;
    --recovery-danger: #dc2626;
    --recovery-neutral: #64748b;
    --recovery-bg: #f8fafc;
    --recovery-card: #ffffff;
    --recovery-shadow: 0 1px 3px rgba(0,0,0,0.06);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    text-align: left;
    max-width: 720px;
    margin: 0 auto 0 0;
  }
  .recovery-loading {
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .recovery-header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    margin-bottom: 1rem;
  }
  .recovery-assessment-card {
    background: var(--recovery-card);
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    box-shadow: var(--recovery-shadow);
    border: 1px solid rgba(0,0,0,0.04);
    position: relative;
    overflow: hidden;
    text-align: left;
  }
  .recovery-assessment-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--recovery-accent), #14b8a6);
  }
  .recovery-circular-progress {
    width: 80px;
    height: 80px;
    margin: 0 0 1rem 0;
    position: relative;
    flex-shrink: 0;
  }
  .recovery-circular-progress svg {
    transform: rotate(-90deg);
  }
  .recovery-circular-progress-bg {
    fill: none;
    stroke: var(--recovery-accent-muted);
    stroke-width: 8;
  }
  .recovery-circular-progress-fill {
    fill: none;
    stroke: url(#recovery-gradient);
    stroke-width: 8;
    stroke-linecap: round;
    stroke-dasharray: 283;
    transition: stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .recovery-percent-value {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 700;
    color: var(--recovery-accent);
  }
  .recovery-assessment-summary {
    display: flex;
    gap: 1.5rem;
    align-items: flex-start;
    margin-bottom: 1.25rem;
  }
  .recovery-assessment-text {
    flex: 1;
    min-width: 0;
  }
  .recovery-assessment-text h4 {
    font-size: 16px;
    font-weight: 600;
    color: #1e293b;
    margin: 0 0 0.5rem 0;
  }
  .recovery-assessment-text p {
    font-size: 15px;
    line-height: 1.65;
    color: #334155;
    margin: 0 0 0.75rem 0;
    word-break: keep-all;
  }
  .recovery-assessment-text p:last-child { margin-bottom: 0; }
  .recovery-assessment-text .text-ok { color: var(--recovery-success); }
  .recovery-assessment-text .text-lost { color: var(--recovery-danger); }
  .recovery-percent-formula {
    font-style: italic;
    border-left: 3px solid var(--recovery-accent-muted);
    padding-left: 0.75rem;
  }
  .recovery-schema-unresolved {
    font-size: 15px;
    color: #b45309;
    background: rgba(245, 158, 11, 0.1);
    padding: 0.75rem 1rem;
    border-radius: 8px;
    border-left: 3px solid #f59e0b;
  }
  .recovery-dynamic-zone-section {
    margin-top: 1.25rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(0,0,0,0.06);
  }
  .recovery-dynamic-zone-section h4 { margin-bottom: 0.75rem; }
  .recovery-dynamic-zone-block {
    background: rgba(13, 148, 136, 0.04);
    border: 1px solid rgba(13, 148, 136, 0.15);
    border-radius: 8px;
    padding: 0.875rem 1rem;
    margin-bottom: 0.5rem;
  }
  .recovery-dynamic-zone-block:last-child { margin-bottom: 0; }
  .recovery-dynamic-zone-block-title {
    font-weight: 600;
    font-size: 15px;
    color: #0f766e;
    margin-bottom: 0.5rem;
  }
  .recovery-dynamic-zone-block-meta {
    font-size: 13px;
    color: var(--recovery-neutral);
    margin-bottom: 0.5rem;
  }
  .recovery-dynamic-zone-block-details {
    font-size: 14px;
    margin-left: 0.5rem;
    padding-left: 0.75rem;
    border-left: 2px solid rgba(13, 148, 136, 0.2);
  }
  .recovery-steps-card {
    background: var(--recovery-card);
    border-radius: 12px;
    padding: 1rem;
    margin-bottom: 1rem;
    box-shadow: var(--recovery-shadow);
    border: 1px solid rgba(0,0,0,0.04);
  }
  .recovery-step {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    margin-bottom: 0.25rem;
    transition: all 0.25s ease;
  }
  .recovery-step:last-child { margin-bottom: 0; }
  .recovery-step--pending { background: transparent; }
  .recovery-step--active {
    background: var(--recovery-accent-muted);
    border-left: 3px solid var(--recovery-accent);
  }
  .recovery-step--done {
    background: rgba(5, 150, 105, 0.06);
    border-left: 3px solid var(--recovery-success);
  }
  .recovery-step-icon {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
  }
  .recovery-step--pending .recovery-step-icon {
    background: #e2e8f0;
    color: #94a3b8;
  }
  .recovery-step--active .recovery-step-icon {
    animation: recovery-pulse 1.5s ease-in-out infinite;
  }
  .recovery-step--done .recovery-step-icon {
    background: rgba(5, 150, 105, 0.15);
    color: var(--recovery-success);
  }
  @keyframes recovery-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(1.05); }
  }
  .recovery-step-content { flex: 1; min-width: 0; }
  .recovery-step-msg {
    font-size: 15px;
    font-weight: 500;
    color: #1e293b;
  }
  .recovery-step-time {
    font-size: 14px;
    color: var(--recovery-neutral);
    margin-top: 0.25rem;
  }
  .recovery-live-banner {
    background: linear-gradient(135deg, var(--recovery-accent-muted), rgba(13, 148, 136, 0.06));
    border: 1px solid rgba(13, 148, 136, 0.2);
    border-radius: 8px;
    padding: 0.875rem 1rem;
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 15px;
  }
  .recovery-live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--recovery-accent);
    animation: recovery-blink 1s ease-in-out infinite;
  }
  @keyframes recovery-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .recovery-result-card {
    border-radius: 12px;
    padding: 1.25rem;
    margin-bottom: 1rem;
    font-size: 15px;
  }
  .recovery-result-card--success {
    background: rgba(5, 150, 105, 0.08);
    border: 1px solid rgba(5, 150, 105, 0.2);
  }
  .recovery-result-card--error {
    background: rgba(220, 38, 38, 0.06);
    border: 1px solid rgba(220, 38, 38, 0.2);
  }
  .recovery-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1.5rem;
    padding-top: 1.25rem;
  }
  .recovery-btn-apply {
    min-height: 40px;
    padding: 0 1.5rem !important;
    font-size: 15px !important;
    font-weight: 600 !important;
    border-radius: 8px !important;
    background: var(--recovery-accent) !important;
    color: white !important;
    border: none !important;
  }
  .recovery-btn-apply:hover {
    background: #0f766e !important;
    color: white !important;
  }
  .recovery-btn-stop {
    min-height: 40px;
    padding: 0 1rem !important;
    font-size: 15px !important;
    font-weight: 600 !important;
    border-radius: 8px !important;
  }
  .recovery-json-card {
    background: var(--recovery-card);
    border-radius: 12px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: var(--recovery-shadow);
    border: 1px solid rgba(0,0,0,0.04);
  }
  .recovery-json-meta {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    font-size: 14px;
    color: var(--recovery-neutral);
  }
  .recovery-json-meta span { margin-right: 0.25rem; }
`;

const LOADING_PHASES = [
  'Loading version data...',
  'Checking relations and media...',
  'Assessing schema changes...',
  'Finishing assessment...',
];

/** Bỏ 3 bước đầu (fetch, validate, schema) – đã chạy khi loading/assess */
const STEPS_TO_SKIP = new Set(['fetch', 'validate', 'schema', 'start']);

export const RecoveryView: React.FC<RecoveryViewProps> = ({ versionId, onBack, onComplete }) => {
  const [assess, setAssess] = useState<{
    assessment: RestoreAssessment;
    steps: AssessStep[];
    totalEstimatedMs: number;
    snapshot?: unknown;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stepMessages, setStepMessages] = useState<Array<{ step?: string; status: string; message: string }>>([]);
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [cancelToken, setCancelToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => {
      setLoadingPhase((p) => (p + 1) % LOADING_PHASES.length);
    }, 1200);
    return () => clearInterval(t);
  }, [loading]);

  useEffect(() => {
    fetch(`${base()}/assess/${versionId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to assess'))))
      .then((data) => {
        setAssess(data);
        setError(null);
      })
      .catch((e) => setError(e?.message || 'Could not assess'))
      .finally(() => setLoading(false));
  }, [versionId]);

  const handleApply = useCallback(() => {
    if (!assess || running) return;
    const token = `restore_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setCancelToken(token);
    setRunning(true);
    setStepMessages([]);
    setResult(null);
    let doneReceived = false;

    const url = `${base()}/restore-stream/${versionId}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.addEventListener('step', (e: MessageEvent) => {
      try {
        const s = JSON.parse(e.data);
        setStepMessages((prev) => [...prev, { step: s.step, status: s.status, message: s.message }]);
      } catch {}
    });

    es.addEventListener('done', (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        doneReceived = true;
        setResult({ success: d.success, error: d.error });
        if (d.success) setTimeout(() => onComplete(), 1500);
      } catch {}
      es.close();
      setRunning(false);
      setCancelToken(null);
    });

    es.addEventListener('error', () => {
      if (doneReceived) return;
      es.close();
      setRunning(false);
      setCancelToken(null);
      setResult((r) => r ?? { success: false, error: 'Connection interrupted' });
    });
  }, [assess, running, versionId, onComplete]);

  const handleStop = useCallback(() => {
    if (!cancelToken) return;
    fetch(`${base()}/cancel-restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: cancelToken }),
    }).catch(() => {});
    setCancelToken(null);
  }, [cancelToken]);

  const formatTime = (ms: number) => {
    if (ms < 1000) return `~${ms}ms`;
    return `~${(ms / 1000).toFixed(1)}s`;
  };

  const jsonStr = assess?.snapshot ? JSON.stringify(assess.snapshot, null, 2) : '';
  const jsonLines = jsonStr ? jsonStr.split('\n').length : 0;
  const jsonSizeBytes = jsonStr ? new Blob([jsonStr]).size : 0;
  const formatSize3 = (n: number) => (n >= 100 ? Math.round(n) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
  const jsonSizeText =
    jsonSizeBytes >= 1024 * 1024
      ? `${formatSize3(jsonSizeBytes / (1024 * 1024))} MB`
      : jsonSizeBytes >= 1024
        ? (() => {
            const kb = jsonSizeBytes / 1024;
            return kb >= 1000 ? `${formatSize3(kb / 1024)} MB` : `${formatSize3(kb)} KB`;
          })()
        : `${jsonSizeBytes} B`;

  const handleCopyJson = useCallback(() => {
    if (!jsonStr) return;
    navigator.clipboard.writeText(jsonStr).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {}
    );
  }, [jsonStr]);

  if (loading || error) {
    return (
      <div className="recovery-root">
        <style>{RECOVERY_STYLES}</style>
        <Box padding={6}>
          {loading ? (
            <div className="recovery-loading">
              <Flex direction="column" alignItems="center" gap={4} padding={8}>
                <Loader />
                <Typography variant="delta" fontWeight={600} style={{ fontSize: 16 }}>
                  {LOADING_PHASES[loadingPhase]}
                </Typography>
                <Typography variant="omega" textColor="neutral600" style={{ fontSize: 15, textAlign: 'center', maxWidth: 420 }}>
                  Checking relations, media and schema changes for a detailed assessment
                </Typography>
              </Flex>
            </div>
          ) : (
            <Flex direction="column" gap={3}>
              <Typography variant="omega" textColor="danger600" style={{ fontSize: 15 }}>{error}</Typography>
              <Button variant="secondary" onClick={onBack} startIcon={<ArrowLeft />}>
                Go back
              </Button>
            </Flex>
          )}
        </Box>
      </div>
    );
  }

  if (!assess) return null;

  const { assessment, steps, totalEstimatedMs } = assess;
  const circumference = 2 * Math.PI * 46;
  const strokeDashoffset = circumference - (assessment.overallPercent / 100) * circumference;

  const filteredSteps = steps.filter((s: AssessStep & { step?: string }) => !STEPS_TO_SKIP.has(s.step ?? ''));
  const filteredStepMessages = stepMessages.filter((s) => !STEPS_TO_SKIP.has(s.step ?? ''));
  const displaySteps = running ? filteredStepMessages : filteredSteps;
  const lastIdx = filteredStepMessages.length - 1;
  const displayTotalMs = filteredSteps.reduce((sum: number, s: AssessStep) => sum + (s.estimatedMs ?? 0), 0);

  const dzKeys = Object.keys(assessment.dynamicZoneDetails ?? {});
  const isDynamicZoneKey = (k: string) => dzKeys.some((dz) => k.startsWith(`${dz}.`));
  const relationDetailsRoot = assessment.relationDetails
    ? Object.fromEntries(Object.entries(assessment.relationDetails).filter(([k]) => !isDynamicZoneKey(k)))
    : undefined;
  const mediaDetailsRoot = assessment.mediaDetails
    ? Object.fromEntries(Object.entries(assessment.mediaDetails).filter(([k]) => !isDynamicZoneKey(k)))
    : undefined;

  return (
    <div className="recovery-root">
      <style>{RECOVERY_STYLES}</style>
      <Box padding={6}>
        <div className="recovery-header">
          <Button variant="tertiary" onClick={onBack} startIcon={<ArrowLeft />} size="S">
            Back to list
          </Button>
        </div>

        <div className="recovery-assessment-card">
          <Typography variant="delta" marginBottom={2} style={{ fontWeight: 600, fontSize: 17 }}>
            Assessment from loaded data
          </Typography>
          <Typography variant="omega" textColor="neutral600" marginBottom={3} style={{ fontSize: 15, lineHeight: 1.55 }}>
            Detailed assessment based on the loaded version – see what data will be restored, what will be lost or skipped before clicking Apply.
          </Typography>
          <div className="recovery-assessment-summary">
            <div className="recovery-circular-progress">
              <svg width="80" height="80" viewBox="0 0 100 100">
                <defs>
                  <linearGradient id="recovery-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#0d9488" />
                    <stop offset="100%" stopColor="#14b8a6" />
                  </linearGradient>
                </defs>
                <circle className="recovery-circular-progress-bg" cx="50" cy="50" r="46" />
                <circle
                  className="recovery-circular-progress-fill"
                  cx="50"
                  cy="50"
                  r="46"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                />
              </svg>
              <div className="recovery-percent-value">{assessment.overallPercent}%</div>
            </div>
            <div className="recovery-assessment-text">
              {assessment.percentExplanation && (
                <p className="recovery-percent-formula" style={{ marginBottom: '0.75rem', fontSize: 14, color: 'var(--recovery-neutral)' }}>
                  {assessment.percentExplanation}
                </p>
              )}
              {(assessment.schemaUnresolved?.length ?? 0) > 0 && (
                <p className="recovery-schema-unresolved" style={{ marginBottom: '0.75rem' }}>
                  Schema could not load: <strong>{assessment?.schemaUnresolved?.join(', ')}</strong>. May be due to initial save error or format – try <strong>saving the document again</strong> to create a new version.
                </p>
              )}
              <h4>Will be restored</h4>
              {(assessment.fieldsBasic ?? assessment.fieldsOk) > 0 || (assessment.fieldsComponent ?? 0) > 0 ? (
                <>
                  {(assessment.fieldsBasic ?? 0) > 0 && (
                    <p className="text-ok">
                      {assessment.fieldsBasic} basic fields (string, text, number...) – full restore.
                    </p>
                  )}
                  {(assessment.fieldsComponent ?? 0) > 0 && (
                    <p className="text-ok">
                      {assessment.fieldsComponent} components (blocks, nested) – full restore.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-ok">No fields/components in the snapshot.</p>
              )}
              {assessment.relationsOk > 0 || assessment.relationsMissing > 0 ? (
                relationDetailsRoot && Object.keys(relationDetailsRoot).length > 0 ? (
                  Object.entries(relationDetailsRoot).map(([field, d]) => (
                    <p key={field} className={d.missing > 0 ? 'text-lost' : 'text-ok'}>
                      Relation <strong>{field.replace(/\./g, ' → ')}</strong>: {d.ok} links still exist will restore
                      {d.missing > 0 ? `, ${d.missing} point to deleted documents – skipped` : ''}.
                    </p>
                  ))
                ) : (
                  <p className="text-ok">
                    {assessment.relationsOk > 0
                      ? `${assessment.relationsOk} relations still exist will be linked.`
                      : `${assessment.relationsMissing} relations point to deleted documents – skipped.`}
                  </p>
                )
              ) : (
                <p className="text-ok">No relations in the snapshot.</p>
              )}
              {assessment.mediaOk > 0 || assessment.mediaMissing > 0 ? (
                mediaDetailsRoot && Object.keys(mediaDetailsRoot).length > 0 ? (
                  Object.entries(mediaDetailsRoot).map(([field, d]) => (
                    <p key={field} className={d.missing > 0 ? 'text-lost' : 'text-ok'}>
                      Media <strong>{field.replace(/\./g, ' → ')}</strong>: {d.ok} files still on system will be attached
                      {d.missing > 0 ? `, ${d.missing} files deleted – need manual re-upload` : ''}.
                    </p>
                  ))
                ) : (
                  <p className="text-ok">
                    {assessment.mediaOk > 0
                      ? `${assessment.mediaOk} media files will be attached.`
                      : `${assessment.mediaMissing} media files deleted – need manual re-upload.`}
                  </p>
                )
              ) : (
                <p className="text-ok">No media in the snapshot.</p>
              )}
              {(assessment.dynamicZoneDetails && Object.keys(assessment.dynamicZoneDetails).length > 0) && (
                <div className="recovery-dynamic-zone-section">
                  <h4>Dynamic zone blocks</h4>
                  <Typography variant="omega" textColor="neutral600" style={{ fontSize: 14, marginBottom: '0.75rem' }}>
                    Details for each block type in sections – relations and media per component.
                  </Typography>
                  {Object.entries(assessment.dynamicZoneDetails).map(([uid, item]) => (
                    <div key={uid} className="recovery-dynamic-zone-block">
                      <div className="recovery-dynamic-zone-block-title">{item.displayName}</div>
                      <div className="recovery-dynamic-zone-block-meta">
                        {item.count} block{item.count > 1 ? 's' : ''} · {uid}
                      </div>
                      {(Object.keys(item.relations).length > 0 ||
                        Object.keys(item.media).length > 0 ||
                        (item.nestedRelations && Object.keys(item.nestedRelations).length > 0)) && (
                        <div className="recovery-dynamic-zone-block-details">
                          {Object.entries(item.relations).map(([field, d]) => (
                            <p key={`r-${field}`} className={d.missing > 0 ? 'text-lost' : 'text-ok'} style={{ margin: '0.25rem 0', fontSize: 14 }}>
                              Relation <strong>{field}</strong>: {d.ok} still exist
                              {d.missing > 0 ? `, ${d.missing} deleted` : ''}.
                            </p>
                          ))}
                          {item.nestedRelations && Object.entries(item.nestedRelations).map(([field, d]) => (
                            <p key={`n-${field}`} className={d.missing > 0 ? 'text-lost' : 'text-ok'} style={{ margin: '0.25rem 0', fontSize: 14 }}>
                              Relation in nested component <strong>{field.replace(/\./g, ' → ')}</strong>: {d.ok} still exist
                              {d.missing > 0 ? `, ${d.missing} deleted` : ''}.
                            </p>
                          ))}
                          {Object.entries(item.media).map(([field, d]) => (
                            <p key={`m-${field}`} className={d.missing > 0 ? 'text-lost' : 'text-ok'} style={{ margin: '0.25rem 0', fontSize: 14 }}>
                              Media <strong>{field}</strong>: {d.ok} files exist
                              {d.missing > 0 ? `, ${d.missing} deleted` : ''}.
                            </p>
                          ))}
                        </div>
                      )}
                      {Object.keys(item.relations).length === 0 &&
                        Object.keys(item.media).length === 0 &&
                        (!item.nestedRelations || Object.keys(item.nestedRelations).length === 0) && (
                        <div className="recovery-dynamic-zone-block-details">
                          <p className="text-ok" style={{ margin: 0, fontSize: 14 }}>
                            {(item.nestedComponents?.length ?? 0) > 0
                              ? `Contains nested components (${item.nestedComponents!.join(', ')}) – full restore.`
                              : 'Basic fields only – full restore.'}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {(assessment.fieldsLost > 0 ||
                (assessment.fieldNamesLost?.length ?? 0) > 0 ||
                (assessment.schemaChanges?.missingInSchema?.length ?? 0) > 0 ||
                (assessment.schemaChanges?.newRequiredInSchema?.length ?? 0) > 0) && (
                <>
                  <h4 style={{ marginTop: '1rem' }}>Will be lost or skipped</h4>
                  {((assessment.fieldNamesLost ?? assessment.schemaChanges?.missingInSchema)?.length ?? 0) > 0 ? (
                    <p className="text-lost">
                      Fields {(assessment.fieldNamesLost ?? assessment.schemaChanges?.missingInSchema ?? []).join(', ')} no longer in current schema – data will be skipped.
                    </p>
                  ) : assessment.fieldsLost > 0 ? (
                    <p className="text-lost">
                      {assessment.fieldsLost} fields (in component/nested) no longer in schema – data will be skipped.
                    </p>
                  ) : null}
                  {(assessment.schemaChanges?.newRequiredInSchema?.length ?? 0) > 0 && (
                    <p className="text-lost">
                      Schema has new required fields ({assessment.schemaChanges.newRequiredInSchema.join(', ')}) – restore may fail.
                    </p>
                  )}
                </>
              )}
              {assessment.overallPercent === 100 &&
                assessment.fieldsLost === 0 &&
                assessment.relationsMissing === 0 &&
                assessment.mediaMissing === 0 && (
                  <p className="text-ok" style={{ marginTop: '0.5rem' }}>
                    All data matches current structure, full recovery.
                  </p>
                )}
            </div>
          </div>
        </div>

        {assess?.snapshot ? (
          <div className="recovery-json-card">
            <Typography variant="delta" marginBottom={2} style={{ fontWeight: 600, fontSize: 15 }}>
              Snapshot data
            </Typography>
            <div className="recovery-json-meta">
              <span>{jsonLines} lines</span>
              <span>·</span>
              <span>{jsonSizeText}</span>
              <Button variant="secondary" size="S" startIcon={<Code />} onClick={handleCopyJson} style={{ marginLeft: 'auto' }}>
                {copied ? 'Copied' : 'Copy JSON'}
              </Button>
            </div>
          </div>
        )
      : null}

        <div className="recovery-steps-card">
          <Typography variant="delta" marginBottom={2} style={{ fontWeight: 600, fontSize: 16 }}>
            {running ? 'In progress' : 'Steps to run'}
          </Typography>
          {displaySteps.map((s: any, i: number) => {
            const isActive = running && i === lastIdx;
            const isDone = running && i < lastIdx;
            const state = isDone ? 'done' : isActive ? 'active' : 'pending';
            return (
              <div key={i} className={`recovery-step recovery-step--${state}`}>
                <div className="recovery-step-icon">
                  {isDone ? <Check width={14} height={14} /> : isActive && running ? <Loader small /> : null}
                </div>
                <div className="recovery-step-content">
                  <div className="recovery-step-msg">{s.message}</div>
                  {!running && s.estimatedMs != null && (
                    <div className="recovery-step-time">Estimated: {formatTime(s.estimatedMs)}</div>
                  )}
                </div>
              </div>
            );
          })}
          {!running && (
            <Typography variant="omega" textColor="neutral500" marginTop={2} style={{ fontSize: 14 }}>
              Total estimated time: {formatTime(displayTotalMs)}
            </Typography>
          )}
        </div>

        {stepMessages.length > 0 && running && (
          <div className="recovery-live-banner">
            <div className="recovery-live-dot" />
            <Typography variant="omega" fontWeight="bold" style={{ fontSize: 15 }}>
              {stepMessages.at(-1)?.message}
            </Typography>
          </div>
        )}

        {result && (
          <div className={`recovery-result-card recovery-result-card--${result.success ? 'success' : 'error'}`}>
            <Typography
              variant="delta"
              textColor={result.success ? 'success700' : 'danger700'}
              fontWeight={600}
              style={{ fontSize: 15 }}
            >
              {result.success ? 'Restore successful. Reloading...' : `Error: ${result.error}`}
            </Typography>
          </div>
        )}

        <div className="recovery-actions">
          {running ? (
            <Button variant="danger-light" onClick={handleStop} startIcon={<Stop />} className="recovery-btn-stop">
              Stop
            </Button>
          ) : !result ? (
            <Button
              variant="default"
              onClick={handleApply}
              startIcon={<Play />}
              className="recovery-btn-apply"
            >
              Apply
            </Button>
          ) : null}
        </div>
      </Box>
    </div>
  );
};
