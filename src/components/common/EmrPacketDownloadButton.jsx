import { useEffect, useState } from 'react';
import {
  generateEmrPacket,
  EMR_PACKET_DEFAULT_OPTIONS,
} from '../../utils/generateEmrPacket.js';
import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * EMR packet download — opens a checklist modal so staff pick:
 *   • CareStream summary (generated demographics / notes / timeline)
 *   • Patient uploaded documents
 *   • One joined PDF vs separate files vs both
 */
export default function EmrPacketDownloadButton({
  referral,
  resolveSource,
  resolveUser,
  resolveMarketer,
  label = '↓ Download EMR Onboarding Packet',
  variant = 'default',
  disabled = false,
  onError,
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [opts, setOpts] = useState({ ...EMR_PACKET_DEFAULT_OPTIONS });

  useEffect(() => {
    if (!open) return;
    setOpts({ ...EMR_PACKET_DEFAULT_OPTIONS });
  }, [open, referral?._id]);

  async function runDownload() {
    if (!referral || loading) return;
    if (!opts.includeHousePacket && !opts.includePatientFiles) return;
    setLoading(true);
    onError?.(null);
    try {
      await generateEmrPacket(referral, {
        resolveSource,
        resolveUser,
        resolveMarketer,
        packetOptions: opts,
      });
      setOpen(false);
    } catch (err) {
      onError?.(err.message || 'Failed to generate packet');
    } finally {
      setLoading(false);
    }
  }

  const canRun = opts.includeHousePacket || opts.includePatientFiles;
  const filesOnly = !opts.includeHousePacket && opts.includePatientFiles;
  const summaryOnly = opts.includeHousePacket && !opts.includePatientFiles;

  return (
    <>
      <ActionLike
        variant={variant}
        disabled={disabled || !referral}
        onClick={() => setOpen(true)}
        label={label}
      />

      {open && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget && !loading) setOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 10060,
            background: hexToRgba(palette.backgroundDark.hex, 0.45),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div style={{
            width: '100%', maxWidth: 440,
            background: palette.backgroundLight.hex,
            borderRadius: 14,
            boxShadow: `0 20px 50px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '16px 18px 12px',
              borderBottom: `1px solid var(--color-border)`,
            }}>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 750, color: palette.backgroundDark.hex }}>
                Download EMR packet
              </p>
              <p style={{
                margin: '5px 0 0', fontSize: 12.5, lineHeight: 1.4,
                color: hexToRgba(palette.backgroundDark.hex, 0.5),
              }}>
                Choose what to include and how files should be packaged.
              </p>
            </div>

            <div style={{ padding: '14px 18px 8px' }}>
              <SectionLabel>Include</SectionLabel>
              <CheckRow
                checked={opts.includeHousePacket}
                onChange={(v) => setOpts((o) => ({
                  ...o,
                  includeHousePacket: v,
                  packageMode: v && !o.includePatientFiles ? 'joined' : o.packageMode,
                }))}
                title="CareStream summary packet"
                detail="Generated demographics, contacts, notes, and timeline — not patient uploads."
              />
              <CheckRow
                checked={opts.includePatientFiles}
                onChange={(v) => setOpts((o) => ({
                  ...o,
                  includePatientFiles: v,
                  includeArchivedFiles: v ? o.includeArchivedFiles : false,
                  packageMode: !v && o.includeHousePacket ? 'joined' : o.packageMode,
                }))}
                title="Patient uploaded documents"
                detail="F2F, MD orders, and other files from the Files tab. Archived files are left out unless included below."
              />
              {opts.includePatientFiles && (
                <div style={{ marginLeft: 24 }}>
                  <CheckRow
                    checked={opts.includeArchivedFiles === true}
                    onChange={(v) => setOpts((o) => ({ ...o, includeArchivedFiles: v }))}
                    title="Also include archived files"
                    detail="Superseded documents that staff archived (e.g. an F2F that was replaced). Marked ARCHIVED in the manifest and kept in a separate ZIP folder."
                  />
                </div>
              )}

              <SectionLabel style={{ marginTop: 16 }}>Download as</SectionLabel>
              <RadioRow
                checked={opts.packageMode === 'joined' || summaryOnly}
                disabled={false}
                onChange={() => setOpts((o) => ({ ...o, packageMode: 'joined' }))}
                title="One joined PDF"
                detail={
                  summaryOnly
                    ? 'Summary packet as a single PDF.'
                    : filesOnly
                      ? 'All selected documents merged into one PDF.'
                      : 'Summary + documents merged into one long PDF.'
                }
              />
              <RadioRow
                checked={opts.packageMode === 'separate' && !summaryOnly}
                disabled={summaryOnly}
                onChange={() => setOpts((o) => ({ ...o, packageMode: 'separate' }))}
                title="All separate (ZIP)"
                detail={
                  filesOnly
                    ? 'Each original upload as its own file.'
                    : 'Summary PDF + each original upload as its own file.'
                }
              />
              <RadioRow
                checked={opts.packageMode === 'joined_and_separate' && !summaryOnly && !filesOnly}
                disabled={summaryOnly || filesOnly}
                onChange={() => setOpts((o) => ({ ...o, packageMode: 'joined_and_separate' }))}
                title="Joined PDF + separate originals (ZIP)"
                detail="One complete PDF, plus the summary alone, plus original uploads in a folder."
              />

              {!canRun && (
                <p style={{
                  margin: '10px 0 0', fontSize: 12, fontWeight: 600,
                  color: palette.primaryMagenta.hex,
                }}>
                  Select at least one item to include.
                </p>
              )}
            </div>

            <div style={{
              padding: '12px 18px 16px',
              display: 'flex', gap: 8, justifyContent: 'flex-end',
              borderTop: `1px solid var(--color-border)`,
            }}>
              <button
                type="button"
                disabled={loading}
                onClick={() => setOpen(false)}
                style={btnSecondary}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canRun || loading}
                onClick={runDownload}
                style={{
                  ...btnPrimary,
                  opacity: !canRun || loading ? 0.55 : 1,
                  cursor: !canRun || loading ? 'default' : 'pointer',
                }}
              >
                {loading ? 'Generating…' : 'Download'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SectionLabel({ children, style }) {
  return (
    <p style={{
      margin: '0 0 8px',
      fontSize: 11,
      fontWeight: 750,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: hexToRgba(palette.backgroundDark.hex, 0.4),
      ...style,
    }}>
      {children}
    </p>
  );
}

function CheckRow({ checked, onChange, title, detail }) {
  return (
    <label style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      padding: '10px 10px', marginBottom: 6, borderRadius: 10,
      border: `1px solid ${checked ? hexToRgba(palette.accentBlue.hex, 0.35) : 'var(--color-border)'}`,
      background: checked ? hexToRgba(palette.accentBlue.hex, 0.06) : 'transparent',
      cursor: 'pointer',
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, accentColor: palette.accentBlue.hex, flexShrink: 0 }}
      />
      <span>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex }}>
          {title}
        </span>
        <span style={{ display: 'block', fontSize: 12, marginTop: 2, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.35 }}>
          {detail}
        </span>
      </span>
    </label>
  );
}

function RadioRow({ checked, onChange, title, detail, disabled }) {
  return (
    <label style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      padding: '10px 10px', marginBottom: 6, borderRadius: 10,
      border: `1px solid ${checked && !disabled ? hexToRgba(palette.primaryMagenta.hex, 0.35) : 'var(--color-border)'}`,
      background: checked && !disabled ? hexToRgba(palette.primaryMagenta.hex, 0.05) : 'transparent',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
    }}>
      <input
        type="radio"
        name="emr-packet-mode"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        style={{ marginTop: 3, accentColor: palette.primaryMagenta.hex, flexShrink: 0 }}
      />
      <span>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex }}>
          {title}
        </span>
        <span style={{ display: 'block', fontSize: 12, marginTop: 2, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.35 }}>
          {detail}
        </span>
      </span>
    </label>
  );
}

const btnSecondary = {
  height: 36, padding: '0 14px', borderRadius: 8,
  border: `1px solid var(--color-border)`, background: 'transparent',
  fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer',
};

const btnPrimary = {
  height: 36, padding: '0 16px', borderRadius: 8, border: 'none',
  background: palette.primaryMagenta.hex, color: palette.backgroundLight.hex,
  fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
};

function ActionLike({ label, onClick, disabled, variant }) {
  const styles = {
    forward:  { bg: palette.accentGreen.hex, color: palette.backgroundLight.hex, pad: '11px 14px', size: 13.5, weight: 700 },
    success:  { bg: hexToRgba(palette.accentGreen.hex, 0.13), color: palette.accentGreen.hex, pad: '8px 12px', size: 12.5, weight: 650 },
    default:  { bg: hexToRgba(palette.backgroundDark.hex, 0.07), color: hexToRgba(palette.backgroundDark.hex, 0.65), pad: '7px 12px', size: 12, weight: 600 },
  };
  const s = styles[variant] || styles.default;
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: s.pad, borderRadius: 8,
        fontSize: s.size, fontWeight: s.weight,
        cursor: disabled ? 'not-allowed' : 'pointer', marginBottom: 6,
        background: s.bg, color: s.color, border: 'none',
        textAlign: 'left', opacity: disabled ? 0.45 : 1,
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}
