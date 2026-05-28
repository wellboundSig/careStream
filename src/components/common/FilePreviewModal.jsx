import { useEffect } from 'react';
import palette, { hexToRgba } from '../../utils/colors.js';
import { resolveFileUrl } from '../../utils/r2Upload.js';

// Shared, inline file preview modal. Used by FilesTab and F2FTab so staff can
// SEE the file (PDF or image) without having to bounce out to a new tab. Other
// file types fall back to an "Open in new tab" button.
//
// Props:
//   file:    { file_name, file_type, r2_url, category? }
//   onClose: () => void

function getFileKind(type, name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'heic'].includes(ext)) return 'image';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'doc';
  if (type) {
    if (type.includes('pdf')) return 'pdf';
    if (type.includes('image')) return 'image';
    if (type.includes('word') || type.includes('document') || type.includes('spreadsheet')) return 'doc';
  }
  return 'generic';
}

export default function FilePreviewModal({ file, onClose }) {
  const kind = getFileKind(file?.file_type, file?.file_name);
  const url = resolveFileUrl(file);
  const downloadUrl = resolveFileUrl(file, { download: true });

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!file) return null;

  const inline = (kind === 'pdf' || kind === 'image') && !!url;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: hexToRgba(palette.backgroundDark.hex, 0.7),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        background: palette.backgroundLight.hex, borderRadius: 14,
        width: '100%', maxWidth: inline ? 960 : 560,
        height: inline ? '88vh' : 'auto', maxHeight: '88vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.3)}`,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: `1px solid var(--color-border)` }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex, wordBreak: 'break-all', lineHeight: 1.3 }}>
              {file.file_name}
            </p>
            {file.category && (
              <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 2 }}>
                {file.category}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in new tab"
                style={{
                  padding: '6px 12px', borderRadius: 7,
                  background: hexToRgba(palette.primaryDeepPlum.hex, 0.07),
                  border: `1px solid ${hexToRgba(palette.primaryDeepPlum.hex, 0.18)}`,
                  fontSize: 12, fontWeight: 650, color: palette.primaryDeepPlum.hex,
                  textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Open
              </a>
            )}
            {url && (
              <a
                href={downloadUrl}
                download={file.file_name}
                style={{
                  padding: '6px 14px', borderRadius: 7,
                  background: hexToRgba(palette.accentBlue.hex, 0.1),
                  border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.25)}`,
                  fontSize: 12, fontWeight: 650, color: palette.accentBlue.hex,
                  textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Download
              </a>
            )}
            <button
              onClick={onClose}
              style={{
                padding: '6px 12px', borderRadius: 7,
                background: hexToRgba(palette.backgroundDark.hex, 0.06),
                border: `1px solid var(--color-border)`,
                fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6),
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'stretch', justifyContent: 'center', minHeight: 280, background: kind === 'image' ? hexToRgba(palette.backgroundDark.hex, 0.04) : palette.backgroundLight.hex }}>
          {!url ? (
            <div style={{ alignSelf: 'center', textAlign: 'center', padding: 40 }}>
              <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45), fontStyle: 'italic' }}>
                No preview URL available for this file.
              </p>
            </div>
          ) : kind === 'image' ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: 16 }}>
              <img
                src={url}
                alt={file.file_name}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6 }}
              />
            </div>
          ) : kind === 'pdf' ? (
            <iframe
              src={url}
              title={file.file_name}
              style={{ width: '100%', height: '100%', border: 'none', background: '#525659' }}
            />
          ) : (
            <div style={{ alignSelf: 'center', textAlign: 'center', padding: '40px 24px', maxWidth: 380 }}>
              <div style={{ width: 56, height: 56, borderRadius: 12, background: hexToRgba(palette.accentBlue.hex, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={palette.accentBlue.hex} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke={palette.accentBlue.hex} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p style={{ fontSize: 14, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 6 }}>
                {file.file_name}
              </p>
              <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 20, lineHeight: 1.5 }}>
                Inline preview isn't available for this file type. Open it in a new tab or download a copy.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ padding: '9px 18px', borderRadius: 8, background: palette.accentBlue.hex, color: palette.backgroundLight.hex, fontSize: 13, fontWeight: 650, textDecoration: 'none' }}
                >
                  Open in new tab
                </a>
                <a
                  href={downloadUrl}
                  download={file.file_name}
                  style={{ padding: '9px 18px', borderRadius: 8, background: hexToRgba(palette.accentBlue.hex, 0.1), color: palette.accentBlue.hex, fontSize: 13, fontWeight: 650, textDecoration: 'none', border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.25)}` }}
                >
                  Download
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
