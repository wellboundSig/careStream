import { useCallback, useMemo, useState } from 'react';
import { QueryBuilder } from 'react-querybuilder';
import 'react-querybuilder/dist/query-builder.css';
import { useCareStore } from '../../store/careStore.js';
import { DIVISIONS, STAGES, exportToExcel } from '../../utils/reportEngine.js';
import {
  GUIDED_TEMPLATES,
  getGuidedTemplate,
} from '../../data/guidedReportTemplates.js';
import {
  slotsToQuery,
  queryToSlots,
  CARESTREAM_OPERATORS,
} from '../../utils/queryToFormula.js';
import { InlineSelect, InlineDate, InlineMulti } from './MadLibControls.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

function useLookupOptions() {
  const marketers = useCareStore((s) => s.marketers) || {};
  const users = useCareStore((s) => s.users) || {};
  const sources = useCareStore((s) => s.referralSources) || {};

  const marketerOpts = useMemo(() => (
    Object.values(marketers)
      .map((m) => ({
        value: m.id,
        label: `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.id,
        searchText: `${m.first_name || ''} ${m.last_name || ''} ${m.region || ''}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  ), [marketers]);

  const ownerOpts = useMemo(() => (
    Object.values(users)
      .filter((u) => u.is_active === undefined || u.is_active === true || String(u.is_active).toUpperCase() === 'TRUE')
      .map((u) => ({
        value: u.id,
        label: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || u.id,
        searchText: `${u.first_name || ''} ${u.last_name || ''} ${u.email || ''}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  ), [users]);

  const sourceOpts = useMemo(() => (
    Object.values(sources)
      .filter((s) => s.is_active === undefined || s.is_active === true || String(s.is_active).toUpperCase() === 'TRUE')
      .map((s) => ({
        value: s.id,
        label: s.name || s.id,
        searchText: `${s.name || ''} ${s.type || ''} ${s.source_entity || ''}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  ), [sources]);

  return { marketerOpts, ownerOpts, sourceOpts };
}

function MadLibSentence({ template, slots, setSlots, marketerOpts, ownerOpts, sourceOpts }) {
  const set = (key, val) => setSlots((prev) => ({ ...prev, [key]: val }));
  const divisionOpts = DIVISIONS.map((d) => ({ value: d, label: d }));
  const stageOpts = STAGES.map((s) => ({ value: s, label: s }));

  const bits = {
    dateRange: (
      <>
        between <InlineDate value={slots.dateFrom} onChange={(v) => set('dateFrom', v)} placeholder="start date" />
        {' '}and{' '}
        <InlineDate value={slots.dateTo} onChange={(v) => set('dateTo', v)} placeholder="end date" />
      </>
    ),
    division: (
      <>
        in <InlineSelect
          value={slots.division}
          onChange={(v) => set('division', v)}
          options={divisionOpts}
          emptyLabel="all divisions"
        />
      </>
    ),
    marketers: (
      <>
        for marketer{' '}
        <InlineMulti
          values={slots.marketerIds}
          onChange={(v) => set('marketerIds', v)}
          options={marketerOpts}
          emptyLabel="all marketers"
          singular="marketer"
          plural="marketers"
          searchPlaceholder="Search marketers…"
        />
      </>
    ),
    owners: (
      <>
        owned by{' '}
        <InlineMulti
          values={slots.ownerIds}
          onChange={(v) => set('ownerIds', v)}
          options={ownerOpts}
          emptyLabel="anyone"
          singular="owner"
          plural="owners"
          searchPlaceholder="Search staff…"
        />
      </>
    ),
    sources: (
      <>
        from source{' '}
        <InlineMulti
          values={slots.sourceIds}
          onChange={(v) => set('sourceIds', v)}
          options={sourceOpts}
          emptyLabel="all sources"
          singular="source"
          plural="sources"
          searchPlaceholder="Search sources…"
        />
      </>
    ),
    stages: (
      <>
        currently in{' '}
        <InlineMulti
          values={slots.stages}
          onChange={(v) => set('stages', v)}
          options={stageOpts}
          emptyLabel="any stage"
          singular="stage"
          plural="stages"
          searchPlaceholder="Search stages…"
        />
      </>
    ),
  };

  // Fixed English per template — slots interpolated in natural order.
  switch (template.id) {
    case 'intake_volume':
      return (
        <p style={sentenceStyle}>
          Show leads created {bits.dateRange} {bits.division}, {bits.owners}
          {template.slots.includes('marketers') ? <>, {bits.marketers}</> : null}.
        </p>
      );
    case 'marketer_performance':
      return (
        <p style={sentenceStyle}>
          Show marketer results for referrals {bits.dateRange} {bits.division}, {bits.marketers}.
        </p>
      );
    case 'pipeline_snapshot':
      return (
        <p style={sentenceStyle}>
          Show patients {bits.stages} {bits.division}
          {slots.dateFrom || slots.dateTo ? <>, referred {bits.dateRange}</> : null}
          {', '}{bits.marketers}.
        </p>
      );
    case 'soc_completed':
      return (
        <p style={sentenceStyle}>
          Export starts of care completed {bits.dateRange} {bits.division}, {bits.marketers}, {bits.owners}.
        </p>
      );
    case 'ntuc_analysis':
      return (
        <p style={sentenceStyle}>
          Show NTUC cases with referral date {bits.dateRange} {bits.division}, {bits.marketers}, {bits.sources}.
        </p>
      );
    case 'source_attribution':
      return (
        <p style={sentenceStyle}>
          Show referral outcomes by source {bits.dateRange} {bits.division}, {bits.sources}.
        </p>
      );
    default:
      return <p style={sentenceStyle}>{template.description}</p>;
  }
}

const sentenceStyle = {
  fontSize: 15.5,
  lineHeight: 1.75,
  color: palette.backgroundDark.hex,
  margin: 0,
  fontWeight: 500,
};

export default function GuidedReports() {
  const [selectedId, setSelectedId] = useState(GUIDED_TEMPLATES[0].id);
  const template = getGuidedTemplate(selectedId);
  const [slots, setSlots] = useState(() => template.defaultSlots());
  const [query, setQuery] = useState(() => slotsToQuery(template.defaultSlots(), { dateField: template.dateField }));
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(null);
  const [errMsg, setErrMsg] = useState('');
  const { marketerOpts, ownerOpts, sourceOpts } = useLookupOptions();

  const handleSelect = useCallback((id) => {
    const t = getGuidedTemplate(id);
    const next = t.defaultSlots();
    setSelectedId(id);
    setSlots(next);
    setQuery(slotsToQuery(next, { dateField: t.dateField }));
    setAdvanced(false);
    setPreview(null);
    setStatus(null);
    setErrMsg('');
  }, []);

  const updateSlots = useCallback((updater) => {
    setSlots((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      setQuery(slotsToQuery(next, { dateField: template.dateField }));
      return next;
    });
  }, [template.dateField]);

  const onQueryChange = useCallback((q) => {
    setQuery(q);
    setSlots(queryToSlots(q, { dateField: template.dateField }));
  }, [template.dateField]);

  async function runReport({ exportExcel }) {
    setLoading(true);
    setStatus(null);
    setErrMsg('');
    try {
      // Prefer slots (sentence) — Advanced edits sync into slots via queryToSlots.
      const result = await template.run(slots);
      const { rows, columns, summary } = result;
      if (exportExcel) {
        const subtitle = [
          slots.dateFrom && slots.dateTo ? `${slots.dateFrom} → ${slots.dateTo}` : null,
          slots.division || 'All divisions',
        ].filter(Boolean).join(' · ');
        await exportToExcel(rows, columns, template.title, subtitle, summary || null);
        setStatus('done');
      } else {
        setPreview({
          rows: rows.slice(0, 20),
          columns,
          total: rows.length,
        });
        setStatus('preview');
      }
    } catch (e) {
      setErrMsg(e.message || 'Report failed');
      setStatus('error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 4, overflow: 'hidden', minHeight: 480 }}>
      {/* Template list */}
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--color-border)' }}>
        <div style={{
          padding: '9px 14px',
          background: hexToRgba(palette.backgroundDark.hex, 0.04),
          borderBottom: '1px solid var(--color-border)',
          fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em',
          textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.5),
        }}>
          Guided reports ({GUIDED_TEMPLATES.length})
        </div>
        {GUIDED_TEMPLATES.map((t, i) => {
          const active = t.id === selectedId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => handleSelect(t.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '12px 14px', border: 'none', cursor: 'pointer',
                borderBottom: i < GUIDED_TEMPLATES.length - 1 ? '1px solid var(--color-border)' : 'none',
                background: active ? hexToRgba(palette.primaryMagenta.hex, 0.06) : 'transparent',
                borderLeft: `2px solid ${active ? palette.primaryMagenta.hex : 'transparent'}`,
                fontFamily: 'inherit',
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex, display: 'block' }}>
                {t.title}
              </span>
              <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), display: 'block', marginTop: 3, lineHeight: 1.35 }}>
                {t.description}
              </span>
            </button>
          );
        })}
      </div>

      {/* Detail */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: palette.backgroundDark.hex, margin: '0 0 4px' }}>
                {template.title}
              </h2>
              <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0 }}>
                Fill in the blanks, then preview or export.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              style={{
                flexShrink: 0, height: 30, padding: '0 12px', borderRadius: 6,
                border: `1px solid ${advanced ? palette.accentBlue.hex : 'var(--color-border)'}`,
                background: advanced ? hexToRgba(palette.accentBlue.hex, 0.08) : 'none',
                color: advanced ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
                fontSize: 12, fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {advanced ? 'Sentence view' : 'Advanced'}
            </button>
          </div>

          {!advanced ? (
            <div style={{
              padding: '16px 18px',
              borderRadius: 10,
              background: hexToRgba(palette.backgroundDark.hex, 0.025),
              border: '1px solid var(--color-border)',
            }}>
              <MadLibSentence
                template={template}
                slots={slots}
                setSlots={updateSlots}
                marketerOpts={marketerOpts}
                ownerOpts={ownerOpts}
                sourceOpts={sourceOpts}
              />
            </div>
          ) : (
            <div style={{
              padding: 12,
              borderRadius: 10,
              border: '1px solid var(--color-border)',
              background: palette.backgroundLight.hex,
            }}>
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: '0 0 10px' }}>
                Same filters as the sentence, add nested AND/OR when needed. Multi-selects appear as “is any of”.
              </p>
              <QueryBuilder
                fields={template.fields}
                query={query}
                onQueryChange={onQueryChange}
                operators={CARESTREAM_OPERATORS}
                controlClassnames={{ queryBuilder: 'cs-rqb' }}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={loading}
              onClick={() => runReport({ exportExcel: false })}
              style={btnSecondary(loading)}
            >
              Preview
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => runReport({ exportExcel: true })}
              style={btnPrimary(loading)}
            >
              {loading ? 'Working…' : 'Export Excel (Summary + Detail)'}
            </button>
            {status === 'error' && <span style={{ fontSize: 12, color: palette.primaryMagenta.hex }}>{errMsg}</span>}
            {status === 'done' && <span style={{ fontSize: 12, color: palette.accentGreen.hex, fontWeight: 600 }}>Exported</span>}
            {status === 'preview' && preview && (
              <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
                {preview.total.toLocaleString()} rows matched
              </span>
            )}
          </div>
        </div>

        {preview && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{
              padding: '8px 14px',
              background: hexToRgba(palette.backgroundDark.hex, 0.03),
              borderBottom: '1px solid var(--color-border)',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: hexToRgba(palette.backgroundDark.hex, 0.45),
            }}>
              Preview · {preview.rows.length} of {preview.total.toLocaleString()}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {preview.columns.map((c) => (
                      <th key={c.key} style={{
                        padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: 11.5,
                        color: hexToRgba(palette.backgroundDark.hex, 0.55), whiteSpace: 'nowrap',
                        borderBottom: '1px solid var(--color-border)',
                        background: hexToRgba(palette.backgroundDark.hex, 0.03),
                      }}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      {preview.columns.map((c) => {
                        const v = row[c.key];
                        const display = v == null ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : Array.isArray(v) ? v.join(', ') : String(v);
                        return (
                          <td key={c.key} style={{
                            padding: '8px 12px', color: palette.backgroundDark.hex,
                            maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {display || <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.2) }}>-</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function btnPrimary(disabled) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 16px', borderRadius: 7, border: 'none',
    background: palette.primaryMagenta.hex, color: palette.backgroundLight.hex,
    fontSize: 12.5, fontWeight: 650, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1, fontFamily: 'inherit',
  };
}
function btnSecondary(disabled) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', borderRadius: 7,
    border: '1px solid var(--color-border)', background: 'transparent',
    color: hexToRgba(palette.backgroundDark.hex, 0.65),
    fontSize: 12.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1, fontFamily: 'inherit',
  };
}
