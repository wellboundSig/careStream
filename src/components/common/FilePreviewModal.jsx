import { useEffect } from 'react';
import palette, { hexToRgba } from '../../utils/colors.js';
import { useSignedFileUrl } from '../../hooks/useSignedFileUrl.js';
import FilePreviewPane, { getFileKind } from './FilePreviewPane.jsx';

// Shared, inline file preview modal. Used by FilesTab and F2FTab so staff can
// SEE the file (PDF or image) without having to bounce out to a new tab.
//
// Props:
//   file:    { file_name, file_type, r2_url, category? }
//   onClose: () => void
//   onOpenToSide: optional () => void — open beside patient snapshot instead

export default function FilePreviewModal({ file, onClose, onOpenToSide }) {
  const kind = getFileKind(file?.file_type, file?.file_name);
  const { url } = useSignedFileUrl(file);
  const { url: downloadUrl } = useSignedFileUrl(file, { download: true });

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
            {onOpenToSide && (
              <button
                type="button"
                onClick={() => { onOpenToSide(); onClose?.(); }}
                title="Open beside patient snapshot"
                style={{
                  padding: '6px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
                  background: hexToRgba(palette.primaryMagenta.hex, 0.1),
                  border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.22)}`,
                  fontSize: 12, fontWeight: 650, color: palette.primaryMagenta.hex,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="4" width="8" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                  <rect x="13" y="4" width="8" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
                </svg>
                Open to side
              </button>
            )}
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
                Open
              </a>
            )}
            {downloadUrl && (
              <a
                href={downloadUrl}
                style={{
                  padding: '6px 14px', borderRadius: 7,
                  background: hexToRgba(palette.accentBlue.hex, 0.1),
                  border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.25)}`,
                  fontSize: 12, fontWeight: 650, color: palette.accentBlue.hex,
                  textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                Download
              </a>
            )}
            <button
              type="button"
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

        <FilePreviewPane file={file} fill />
      </div>
    </div>
  );
}
