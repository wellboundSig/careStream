import { useState, useEffect } from 'react';
import { getConflictsByReferral } from '../../../api/conflicts.js';
import { useLookups } from '../../../hooks/useLookups.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { conflictCategoryLabel, resolveConflict as resolveConflictApi } from '../../../utils/conflictFlagging.js';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';

const SEVERITY_COLORS = {
  Low:      { bg: hexToRgba(palette.accentBlue.hex, 0.1),       text: '#005B84' },
  Medium:   { bg: hexToRgba(palette.highlightYellow.hex, 0.18), text: '#7A5F00' },
  High:     { bg: hexToRgba(palette.accentOrange.hex, 0.14),    text: '#8B4A00' },
  Critical: { bg: hexToRgba(palette.primaryMagenta.hex, 0.14),  text: palette.primaryMagenta.hex },
};

const STATUS_COLORS = {
  Unaddressed:   { bg: hexToRgba(palette.primaryMagenta.hex, 0.12), text: palette.primaryMagenta.hex },
  Open:          { bg: hexToRgba(palette.primaryMagenta.hex, 0.10), text: palette.primaryMagenta.hex },
  'In Progress': { bg: hexToRgba(palette.accentOrange.hex, 0.12),   text: '#8B4A00' },
  Resolved:      { bg: hexToRgba(palette.accentGreen.hex, 0.14),    text: '#3A6E00' },
  Waived:        { bg: hexToRgba(palette.backgroundDark.hex, 0.07), text: hexToRgba(palette.backgroundDark.hex, 0.45) },
};

const SOURCE_MODULE_LABELS = {
  eligibility:   'Eligibility',
  authorization: 'Authorization',
  clinical:      'Clinical',
  intake:        'Intake',
  other:         'Other',
};

const ACTIVE_STATUSES = new Set(['Unaddressed', 'Open', 'In Progress']);
const RESOLVED_STATUSES = new Set(['Resolved', 'Waived']);

function fmtFull(d) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function ConflictsTab({ referral, readOnly = false }) {
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolveTarget, setResolveTarget] = useState(null);
  const [resolveError, setResolveError] = useState(null);
  const [resolving, setResolving] = useState(false);
  const { can } = usePermissions();
  const { resolveUser } = useLookups();
  const { appUserId } = useCurrentAppUser();

  useEffect(() => {
    if (!referral?.id) { setLoading(false); return; }
    setLoading(true);
    getConflictsByReferral(referral.id)
      .then((records) => setConflicts(records.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [referral?.id]);

  function openResolvePrompt(conflict) {
    if (!can(PERMISSION_KEYS.CONFLICT_RESOLVE)) return;
    setResolveError(null);
    setResolveTarget(conflict);
  }

  async function confirmResolve(note) {
    if (!resolveTarget) return;
    if (!note?.trim()) {
      setResolveError('Resolution note is required.');
      return;
    }
    setResolving(true);
    setResolveError(null);
    try {
      const { updates } = await resolveConflictApi({
        conflict: resolveTarget,
        note,
        actorUserId: appUserId,
      });
      setConflicts((prev) => prev.map((c) => c._id === resolveTarget._id
        ? { ...c, ...updates }
        : c));
      setResolveTarget(null);
    } catch (err) {
      setResolveError(err?.message || 'Failed to resolve conflict.');
    } finally {
      setResolving(false);
    }
  }

  if (!referral) return <p style={{ padding: 24, fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic', textAlign: 'center' }}>No referral selected.</p>;
  if (loading) return <LoadingState message="Loading conflicts..." size="small" />;

  const sortByCreated = (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0);
  const active   = conflicts.filter((c) => ACTIVE_STATUSES.has(c.status) || (!c.status && !RESOLVED_STATUSES.has(c.status))).sort(sortByCreated);
  const resolved = conflicts.filter((c) => RESOLVED_STATUSES.has(c.status)).sort(sortByCreated);

  return (
    <div style={{ padding: '20px' }}>
      {resolveTarget && (
        <ResolveConflictModal
          conflict={resolveTarget}
          submitting={resolving}
          error={resolveError}
          onCancel={() => { if (!resolving) { setResolveTarget(null); setResolveError(null); } }}
          onConfirm={confirmResolve}
        />
      )}
      {conflicts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: hexToRgba(palette.accentGreen.hex, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 22 }}>✓</div>
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45), fontStyle: 'italic' }}>No conflicts on record.</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: palette.primaryMagenta.hex, marginBottom: 10 }}>
                Active ({active.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {active.map((c) => (
                  <ConflictCard
                    key={c._id}
                    conflict={c}
                    resolveUser={resolveUser}
                    onResolve={!readOnly && can(PERMISSION_KEYS.CONFLICT_RESOLVE) ? openResolvePrompt : undefined}
                  />
                ))}
              </div>
            </div>
          )}
          {resolved.length > 0 && (
            <div>
              <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 10 }}>
                Resolved ({resolved.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {resolved.map((c) => (
                  <ConflictCard key={c._id} conflict={c} resolveUser={resolveUser} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConflictCard({ conflict, onResolve, resolveUser }) {
  const status     = conflict.status || 'Unaddressed';
  const sevColors  = SEVERITY_COLORS[conflict.severity] || SEVERITY_COLORS.Medium;
  const statColors = STATUS_COLORS[status] || STATUS_COLORS.Unaddressed;
  const isActive   = ACTIVE_STATUSES.has(status);

  const categoryLabel = conflictCategoryLabel(conflict.type);
  const sourceLabel   = SOURCE_MODULE_LABELS[conflict.source_module] || conflict.source_module || null;

  const flaggedById   = conflict.flagged_by_id || conflict.created_by_id || null;
  const flaggedByName = flaggedById ? resolveUser?.(flaggedById) : null;
  const resolvedById  = conflict.resolved_by_id || null;
  const resolvedByName = resolvedById ? resolveUser?.(resolvedById) : null;

  const description = conflict.description || conflict.details || '';

  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, border: `1px solid ${isActive ? hexToRgba(palette.primaryMagenta.hex, 0.2) : 'var(--color-border)'}`, background: isActive ? hexToRgba(palette.primaryMagenta.hex, 0.02) : palette.backgroundLight.hex, opacity: isActive ? 1 : 0.85 }}>
      {/* Header row: badges + resolve button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: statColors.bg, color: statColors.text }}>
            {status}
          </span>
          {conflict.severity && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: sevColors.bg, color: sevColors.text }}>
              {conflict.severity}
            </span>
          )}
          {sourceLabel && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: hexToRgba(palette.accentBlue.hex, 0.1), color: palette.accentBlue.hex }}>
              {sourceLabel}
            </span>
          )}
        </div>
        {isActive && onResolve && (
          <button
            onClick={() => onResolve(conflict)}
            style={{ padding: '4px 12px', borderRadius: 6, background: hexToRgba(palette.accentGreen.hex, 0.12), border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.3)}`, fontSize: 11.5, fontWeight: 650, color: '#3A6E00', cursor: 'pointer', flexShrink: 0 }}
          >
            Resolve
          </button>
        )}
      </div>

      {/* Type/category */}
      <p style={{ fontSize: 13.5, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 4 }}>
        {categoryLabel}
      </p>

      {/* Description / details */}
      {description && (
        <p style={{ fontSize: 13, color: palette.backgroundDark.hex, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {description}
        </p>
      )}

      {/* When + by who */}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
        {conflict.created_at && (
          <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
            Flagged {fmtFull(conflict.created_at)}
          </span>
        )}
        {flaggedById && (
          <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
            by <strong style={{ color: hexToRgba(palette.backgroundDark.hex, 0.7) }}>
              {flaggedByName && flaggedByName !== '—' ? flaggedByName : flaggedById}
            </strong>
          </span>
        )}
      </div>

      {/* Resolution info */}
      {!isActive && (conflict.resolved_at || resolvedById || conflict.resolution_note) && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
          {(conflict.resolved_at || resolvedById) && (
            <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
              Resolved {fmtFull(conflict.resolved_at)}
              {resolvedById ? <> by <strong style={{ color: hexToRgba(palette.backgroundDark.hex, 0.7) }}>{resolvedByName && resolvedByName !== '—' ? resolvedByName : resolvedById}</strong></> : null}
            </p>
          )}
          {conflict.resolution_note && (
            <p style={{ marginTop: 4, fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.7), lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
              <span style={{ fontWeight: 700, fontStyle: 'normal', color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>Resolution note: </span>
              {conflict.resolution_note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Resolution prompt modal ────────────────────────────────────────────────
function ResolveConflictModal({ conflict, submitting, error, onCancel, onConfirm }) {
  const [note, setNote] = useState('');
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !submitting) onCancel(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, submitting]);

  const categoryLabel = conflictCategoryLabel(conflict?.type);
  const canSubmit = !!note.trim() && !submitting;

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && !submitting && onCancel()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: hexToRgba(palette.backgroundDark.hex, 0.45),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        background: palette.backgroundLight.hex,
        borderRadius: 14, width: '100%', maxWidth: 460,
        boxShadow: `0 20px 60px ${hexToRgba(palette.backgroundDark.hex, 0.2)}`,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '18px 22px 14px', borderBottom: `1px solid var(--color-border)` }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 4 }}>
            Resolve conflict
          </h2>
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.4 }}>
            <strong>{categoryLabel}</strong>
            {conflict?.severity ? <> &middot; {conflict.severity}</> : null}
          </p>
        </div>

        <div style={{ padding: '16px 22px' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.6), marginBottom: 6, letterSpacing: '0.02em' }}>
            Resolution note <span style={{ color: palette.primaryMagenta.hex, marginLeft: 3 }}>*</span>
          </label>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was resolved and how? This is required and will be saved on the conflict, the patient's notes, and the timeline."
            rows={5}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              border: `1px solid var(--color-border)`,
              background: hexToRgba(palette.backgroundDark.hex, 0.03),
              fontSize: 13, color: palette.backgroundDark.hex,
              resize: 'vertical', outline: 'none', lineHeight: 1.5,
              transition: 'border-color 0.15s', fontFamily: 'inherit',
            }}
            onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
            onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.1))}
          />
          {!note.trim() && (
            <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 5 }}>
              A resolution note is required.
            </p>
          )}
          {error && (
            <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginTop: 6 }}>{error}</p>
          )}
        </div>

        <div style={{ padding: '12px 22px 18px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={submitting}
            style={{
              padding: '9px 18px', borderRadius: 8,
              background: hexToRgba(palette.backgroundDark.hex, 0.06),
              border: `1px solid var(--color-border)`,
              fontSize: 13, fontWeight: 600,
              color: hexToRgba(palette.backgroundDark.hex, 0.65),
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => canSubmit && onConfirm(note)}
            disabled={!canSubmit}
            style={{
              padding: '9px 22px', borderRadius: 8,
              background: canSubmit ? palette.accentGreen.hex : hexToRgba(palette.accentGreen.hex, 0.3),
              border: 'none', fontSize: 13, fontWeight: 650,
              color: '#fff',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? 'Resolving…' : 'Resolve'}
          </button>
        </div>
      </div>
    </div>
  );
}
