import palette, { hexToRgba } from '../../../utils/colors.js';
import LoadingState from '../../common/LoadingState.jsx';

function initials(first, last) {
  return `${(first || '?')[0]}${(last || '')[0] || ''}`.toUpperCase();
}

export default function FacilityMarketersTab({ marketerLinks, marketerDetails, loading }) {
  if (loading) return <LoadingState message="Loading marketers…" size="small" />;

  if (!marketerLinks.length) {
    return <p style={{ padding: '32px 22px', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', textAlign: 'center' }}>No marketers assigned to this facility.</p>;
  }

  return (
    <div style={{ padding: '16px 22px 40px' }}>
      <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 14 }}>
        {marketerLinks.length} marketer{marketerLinks.length !== 1 ? 's' : ''} assigned
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {marketerLinks.map((link) => {
          const m = marketerDetails[link.marketer_id];
          const isPrimary = link.is_primary === true || link.is_primary === 'true';
          if (!m) return null;
          return (
            <div key={link._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, background: hexToRgba(palette.backgroundDark.hex, 0.025) }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, background: hexToRgba(palette.accentOrange.hex, 0.15), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: palette.accentOrange.hex }}>
                {initials(m.first_name, m.last_name)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <p style={{ fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex }}>{m.first_name} {m.last_name}</p>
                  {isPrimary && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: hexToRgba(palette.accentGreen.hex, 0.15), color: palette.accentGreen.hex }}>
                      Liaison
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
                  {m.email}
                  {m.region && <span style={{ marginLeft: 8 }}>· {m.region}</span>}
                </p>
              </div>
              {link.assigned_date && (
                <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.35), flexShrink: 0 }}>
                  Since {new Date(link.assigned_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
