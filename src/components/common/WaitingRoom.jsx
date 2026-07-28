import { useClerk } from '@clerk/react';
import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * Shown when the signed-in user's role is Unassigned (pending manager setup).
 * They can sign out; they cannot reach patient data.
 */
export default function WaitingRoom({ userName }) {
  const { signOut } = useClerk();
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: `linear-gradient(160deg, ${hexToRgba(palette.primaryDeepPlum.hex, 0.06)} 0%, ${palette.backgroundLight.hex} 45%, ${hexToRgba(palette.accentBlue.hex, 0.05)} 100%)`,
    }}>
      <div style={{
        width: 'min(440px, 100%)',
        background: palette.backgroundLight.hex,
        borderRadius: 16,
        border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.08)}`,
        boxShadow: `0 18px 48px ${hexToRgba(palette.backgroundDark.hex, 0.1)}`,
        padding: '36px 32px 28px',
        textAlign: 'center',
      }}>
        <img src="/logo-cs.png" alt="CareStream" style={{ height: 32, objectFit: 'contain', marginBottom: 20 }} />
        <p style={{
          margin: '0 0 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: palette.accentOrange.hex,
        }}>
          Account pending setup
        </p>
        <h1 style={{
          margin: '0 0 10px', fontSize: 22, fontWeight: 750, letterSpacing: '-0.02em',
          color: palette.backgroundDark.hex, lineHeight: 1.25,
        }}>
          {userName ? `Welcome, ${userName}` : 'Welcome to CareStream'}
        </h1>
        <p style={{
          margin: '0 0 22px', fontSize: 14, lineHeight: 1.5,
          color: hexToRgba(palette.backgroundDark.hex, 0.6),
        }}>
          Your account is signed in but not assigned yet. A manager needs to set
          your role and divisions before you can view patients or modules.
        </p>
        <button
          type="button"
          onClick={() => signOut()}
          style={{
            padding: '10px 18px', borderRadius: 8, border: 'none',
            background: palette.primaryDeepPlum.hex, color: palette.backgroundLight.hex,
            fontSize: 13, fontWeight: 650, cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
