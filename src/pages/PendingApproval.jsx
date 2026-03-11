import { UserButton, useUser } from '@clerk/react';
import palette, { hexToRgba } from '../utils/colors.js';

export default function PendingApproval() {
  const { user } = useUser();

  return (
    <div
      style={{
        minHeight: '100vh',
        background: palette.backgroundLight.hex,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 440,
          width: '100%',
          background: palette.backgroundLight.hex,
          border: `1px solid var(--color-border)`,
          borderRadius: 16,
          padding: '40px 40px 36px',
          boxShadow: `0 4px 24px ${hexToRgba(palette.backgroundDark.hex, 0.07)}`,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: hexToRgba(palette.highlightYellow.hex, 0.15),
            border: `1px solid ${hexToRgba(palette.highlightYellow.hex, 0.4)}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke={palette.highlightYellow.hex} strokeWidth="1.8" />
            <path d="M12 8v4M12 16h.01" stroke={palette.highlightYellow.hex} strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: palette.backgroundDark.hex,
            marginBottom: 10,
          }}
        >
          Account Pending Approval
        </h1>
        <p
          style={{
            fontSize: 14,
            color: hexToRgba(palette.backgroundDark.hex, 0.55),
            lineHeight: 1.6,
            marginBottom: 28,
          }}
        >
          {user?.firstName ? `Hi ${user.firstName}, your` : 'Your'} account has been created but is
          awaiting activation. An administrator will review and approve your access shortly.
        </p>

        <div
          style={{
            padding: '14px 18px',
            background: hexToRgba(palette.backgroundDark.hex, 0.04),
            borderRadius: 10,
            border: `1px solid var(--color-border)`,
            marginBottom: 24,
            textAlign: 'left',
          }}
        >
          <p style={{ fontSize: 12, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 4 }}>
            SIGNED IN AS
          </p>
          <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex }}>
            {user?.fullName || 'Unknown'}
          </p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
            {user?.primaryEmailAddress?.emailAddress}
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </div>
    </div>
  );
}
