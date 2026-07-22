import palette, { hexToRgba } from '../../utils/colors.js';
import { useSignedFileUrl } from '../../hooks/useSignedFileUrl.js';
import { openSignedFile } from '../../utils/r2Upload.js';

export function getFileKind(type, name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'heic'].includes(ext)) return 'image';
  if (['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'csv'].includes(ext)) return 'doc';
  if (type) {
    if (type.includes('pdf')) return 'pdf';
    if (type.includes('image')) return 'image';
    if (type.includes('word') || type.includes('document') || type.includes('spreadsheet')) return 'doc';
  }
  return 'generic';
}

/**
 * Inline PDF/image preview body (no chrome). Used by FilePreviewModal and
 * the patient-drawer "Open to side" workspace.
 */
export default function FilePreviewPane({ file, fill = false }) {
  const kind = getFileKind(file?.file_type, file?.file_name);
  const { url, loading } = useSignedFileUrl(file);
  const { url: downloadUrl } = useSignedFileUrl(file, { download: true });

  if (!file) return null;

  const shell = {
    flex: 1,
    minHeight: fill ? 0 : 280,
    height: fill ? '100%' : undefined,
    overflow: 'auto',
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'center',
    background: kind === 'image' ? hexToRgba(palette.backgroundDark.hex, 0.04) : '#525659',
  };

  if (loading && !url) {
    return (
      <div style={{ ...shell, alignItems: 'center', background: palette.backgroundLight.hex }}>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>Loading preview…</p>
      </div>
    );
  }

  if (!url) {
    return (
      <div style={{ ...shell, alignItems: 'center', background: palette.backgroundLight.hex }}>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45), fontStyle: 'italic', padding: 24, textAlign: 'center' }}>
          No preview URL available for this file.
        </p>
      </div>
    );
  }

  if (kind === 'image') {
    return (
      <div style={{ ...shell, alignItems: 'center', background: hexToRgba(palette.backgroundDark.hex, 0.04) }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', padding: 16, boxSizing: 'border-box' }}>
          <img
            src={url}
            alt={file.file_name}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6 }}
          />
        </div>
      </div>
    );
  }

  if (kind === 'pdf') {
    return (
      <div style={shell}>
        <iframe
          src={url}
          title={file.file_name}
          style={{ width: '100%', height: '100%', border: 'none', background: '#525659', minHeight: fill ? 0 : 480 }}
        />
      </div>
    );
  }

  return (
    <div style={{ ...shell, alignItems: 'center', background: palette.backgroundLight.hex }}>
      <div style={{ textAlign: 'center', padding: '40px 24px', maxWidth: 380 }}>
        <p style={{ fontSize: 14, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 8 }}>
          {file.file_name}
        </p>
        <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 20, lineHeight: 1.5 }}>
          Inline preview isn’t available for this file type.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => openSignedFile(file)}
            style={{
              padding: '9px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: palette.accentBlue.hex, color: '#fff', fontSize: 13, fontWeight: 650,
            }}
          >
            Open in new tab
          </button>
          {downloadUrl && (
            <a
              href={downloadUrl}
              style={{
                padding: '9px 18px', borderRadius: 8,
                background: hexToRgba(palette.accentBlue.hex, 0.1), color: palette.accentBlue.hex,
                fontSize: 13, fontWeight: 650, textDecoration: 'none',
                border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.25)}`,
              }}
            >
              Download
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
