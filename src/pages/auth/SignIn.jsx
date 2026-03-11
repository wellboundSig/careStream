import { SignIn } from '@clerk/react';
import palette, { hexToRgba } from '../../utils/colors.js';

export default function SignInPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: palette.primaryDeepPlum.hex,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ marginBottom: 32, display: 'flex', alignItems: 'center', gap: 20 }}>
        <img src="/logo-wb.png" alt="Wellbound" style={{ height: 44, objectFit: 'contain' }} />
        <div
          style={{
            width: 1,
            height: 36,
            background: hexToRgba(palette.backgroundLight.hex, 0.2),
          }}
        />
        <img src="/logo-cs.png" alt="CareStream" style={{ height: 38, objectFit: 'contain' }} />
      </div>

      <SignIn
        routing="path"
        path="/sign-in"
        afterSignInUrl="/"
        appearance={{
          variables: {
            colorPrimary: palette.primaryMagenta.hex,
            colorBackground: palette.backgroundLight.hex,
            fontFamily: "'SN Pro', -apple-system, sans-serif",
          },
        }}
      />
    </div>
  );
}
