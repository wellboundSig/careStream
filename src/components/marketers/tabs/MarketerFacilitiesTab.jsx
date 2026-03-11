import palette, { hexToRgba } from '../../../utils/colors.js';
import LoadingState from '../../common/LoadingState.jsx';

const TYPE_COLORS = {
  ALF:       { bg: hexToRgba(palette.highlightYellow.hex, 0.2),   text: '#7A5F00' },
  Hospital:  { bg: hexToRgba(palette.primaryMagenta.hex, 0.15),   text: palette.primaryMagenta.hex },
  SNF:       { bg: hexToRgba(palette.accentOrange.hex, 0.15),     text: palette.accentOrange.hex },
  School:    { bg: hexToRgba(palette.accentBlue.hex, 0.15),       text: palette.accentBlue.hex },
  'PCP Office': { bg: hexToRgba(palette.accentGreen.hex, 0.15),   text: palette.accentGreen.hex },
  Other:     { bg: hexToRgba(palette.backgroundDark.hex, 0.08),   text: hexToRgba(palette.backgroundDark.hex, 0.55) },
};

export default function MarketerFacilitiesTab({ facilities, loading }) {
  if (loading) return <LoadingState message="Loading facilities…" size="small" />;

  if (!facilities.length) {
    return <p style={{ padding: '32px 22px', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', textAlign: 'center' }}>No facilities assigned.</p>;
  }

  return (
    <div style={{ padding: '16px 22px' }}>
      <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 14 }}>
        {facilities.length} facilit{facilities.length === 1 ? 'y' : 'ies'} assigned
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {facilities.map((link, i) => {
          const fac = link.facility;
          if (!fac) return null;
          const typeStyle = TYPE_COLORS[fac.type] || TYPE_COLORS.Other;
          return (
            <div key={link.id || i} style={{ padding: '12px 14px', borderRadius: 10, background: hexToRgba(palette.backgroundDark.hex, 0.025) }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <p style={{ fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex }}>{fac.name}</p>
                  {link.is_primary && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: hexToRgba(palette.accentGreen.hex, 0.15), color: palette.accentGreen.hex }}>Primary</span>
                  )}
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: typeStyle.bg, color: typeStyle.text }}>{fac.type || 'Other'}</span>
              </div>
              {(fac.address_city || fac.region) && (
                <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
                  {[fac.address_city, fac.region].filter(Boolean).join(' · ')}
                </p>
              )}
              {fac.primary_contact_name && (
                <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 2 }}>Contact: {fac.primary_contact_name}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
