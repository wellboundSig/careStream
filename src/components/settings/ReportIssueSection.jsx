import { useRef, useState } from 'react';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { createIssueReport } from '../../api/issueReports.js';
import { uploadToR2 } from '../../utils/r2Upload.js';
import { mergeEntities } from '../../store/careStore.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const REPORT_TYPES = [
  { value: 'bug', label: 'Bug / Mistake' },
  { value: 'enhancement', label: 'Suggested Enhancement' },
];

/**
 * Top Settings section — staff report bugs or suggest enhancements.
 */
export default function ReportIssueSection() {
  const { appUserId, appUserName } = useCurrentAppUser();
  const fileRef = useRef(null);

  const [reportType, setReportType] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  function resetForm() {
    setReportType('');
    setDescription('');
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function onPickFile(e) {
    const f = e.target.files?.[0] || null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!f) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!f.type.startsWith('image/')) {
      setError('Please upload an image screenshot (PNG, JPG, etc.).');
      e.target.value = '';
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      setError('Screenshot must be under 8 MB.');
      e.target.value = '';
      return;
    }
    setError(null);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!reportType) {
      setError('Choose whether this is a bug or a suggested enhancement.');
      return;
    }
    if (!description.trim() || description.trim().length < 20) {
      setError('Please explain in detail (at least a couple of sentences).');
      return;
    }
    if (!appUserId) {
      setError('Could not identify your account. Try refreshing.');
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const id = `iss_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

      let screenshot_r2_key = '';
      let screenshot_file_name = '';
      let screenshot_content_type = '';

      if (file) {
        const uploaded = await uploadToR2(file, `issue-reports/${appUserId}`);
        screenshot_r2_key = uploaded.r2Key || '';
        screenshot_file_name = file.name;
        screenshot_content_type = file.type || 'image/png';
      }

      const fields = {
        id,
        user_id: appUserId,
        report_type: reportType,
        description: description.trim(),
        screenshot_r2_key: screenshot_r2_key || undefined,
        screenshot_file_name: screenshot_file_name || undefined,
        screenshot_content_type: screenshot_content_type || undefined,
        status: 'open',
        created_at: now,
        updated_at: now,
      };

      const rec = await createIssueReport(fields);
      mergeEntities('issueReports', { [rec.id]: { _id: rec.id, ...rec.fields } });

      setSuccess(true);
      resetForm();
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      setError(err.message || 'Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 8,
    border: `1px solid var(--color-border)`,
    fontSize: 13.5,
    fontFamily: 'inherit',
    color: palette.backgroundDark.hex,
    background: palette.backgroundLight.hex,
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={{
      background: palette.backgroundLight.hex,
      border: `1px solid var(--color-border)`,
      borderRadius: 12,
      padding: '20px 24px',
      marginBottom: 16,
    }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>
          Report an issue
        </h2>
        <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: '3px 0 0', lineHeight: 1.45 }}>
          Found a bug, or have an idea to improve CareStream?
          {appUserName ? ` Submitting as ${appUserName}.` : ''}
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 6 }}>
            Type
          </span>
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
            required
            style={inputStyle}
          >
            <option value="">— Select —</option>
            {REPORT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 6 }}>
            Explain in detail
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="What happened? What did you expect? Steps to reproduce, or why the enhancement would help…"
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
          />
        </label>

        <div>
          <span style={{ display: 'block', fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 6 }}>
            Screenshot <span style={{ fontWeight: 500, opacity: 0.7 }}>(optional)</span>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{
                padding: '8px 14px', borderRadius: 8,
                border: `1px solid var(--color-border)`,
                background: hexToRgba(palette.backgroundDark.hex, 0.04),
                fontSize: 12.5, fontWeight: 600,
                color: palette.backgroundDark.hex, cursor: 'pointer',
              }}
            >
              {file ? 'Change image' : 'Upload screenshot'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onPickFile}
              style={{ display: 'none' }}
            />
            {file && (
              <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
                {file.name}
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(null);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                  style={{
                    marginLeft: 8, border: 'none', background: 'none', cursor: 'pointer',
                    color: palette.primaryMagenta.hex, fontSize: 12, fontWeight: 600,
                  }}
                >
                  Remove
                </button>
              </span>
            )}
          </div>
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Screenshot preview"
              style={{
                marginTop: 10, maxWidth: '100%', maxHeight: 180,
                borderRadius: 8, border: `1px solid var(--color-border)`, objectFit: 'contain',
              }}
            />
          )}
        </div>

        {error && (
          <p style={{ fontSize: 12.5, color: palette.primaryMagenta.hex, margin: 0 }}>{error}</p>
        )}
        {success && (
          <p style={{ fontSize: 12.5, color: palette.accentGreen.hex, margin: 0, fontWeight: 600 }}>
            Thanks — your report was submitted.
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '9px 18px', borderRadius: 8, border: 'none',
              background: submitting ? hexToRgba(palette.primaryMagenta.hex, 0.4) : palette.primaryMagenta.hex,
              color: palette.backgroundLight.hex, fontSize: 13, fontWeight: 650,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Submitting…' : 'Submit report'}
          </button>
        </div>
      </form>
    </div>
  );
}
