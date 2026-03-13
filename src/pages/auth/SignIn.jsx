import { SignIn } from '@clerk/react';
import palette, { hexToRgba } from '../../utils/colors.js';
import { fontFamily } from '../../utils/fontUtility.js';

export default function SignInPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
      }}
    >
      {/* Left side – image */}
      <div
        style={{
          flex: 1,
          backgroundImage: 'url(/signupart.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />

      {/* Right side – sign-in */}
      <div
        style={{
          flex: 1,
          background: palette.primaryDeepPlum.hex,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 48,
        }}
      >
        <img
          src="/logo-cs.png"
          alt="CareStream"
          style={{ height: 56, objectFit: 'contain', marginBottom: 40 }}
        />

        <div style={{ position: 'relative' }}>
          <SignIn
            routing="path"
            path="/sign-in"
            afterSignInUrl="/"
            appearance={{
              variables: {
                colorPrimary: palette.primaryMagenta.hex,
                colorBackground: palette.backgroundLight.hex,
                fontFamily,
              },
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: -30,
              left: -10,
              right: -10,
              height: 100,
              background: palette.primaryDeepPlum.hex,
              zIndex: 10,
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: 57,
              left: 0,
              right: 0,
              height: 16,
              background: palette.backgroundLight.hex,
              borderRadius: '0 0 12px 12px',
              zIndex: 11,
            }}
          />
        </div>
      </div>
    </div>
  );
}