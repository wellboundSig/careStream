import { useEffect } from 'react';
import { SignIn } from '@clerk/react';
import palette from '../../utils/colors.js';
import { fontFamily } from '../../utils/fontUtility.js';
import { useIsMobile } from '../../hooks/useIsMobile.js';

// Keyframe animations injected once — scoped names to avoid collisions
const GLOW_CSS = `
  @keyframes cs-drift-a {
    0%,100% { transform: translate(0,0) scale(1); }
    38%      { transform: translate(35px,-45px) scale(1.08); }
    72%      { transform: translate(-20px,22px) scale(0.94); }
  }
  @keyframes cs-drift-b {
    0%,100% { transform: translate(0,0) scale(1); }
    30%      { transform: translate(-50px,28px) scale(1.12); }
    68%      { transform: translate(22px,-18px) scale(0.91); }
  }
  @keyframes cs-drift-c {
    0%,100% { transform: translate(0,0); }
    50%      { transform: translate(18px,38px); }
  }
  @keyframes cs-pulse-a {
    0%,100% { opacity: 0.5; }
    50%      { opacity: 0.78; }
  }
  @keyframes cs-pulse-b {
    0%,100% { opacity: 0.35; }
    50%      { opacity: 0.6; }
  }
`;

export default function SignInPage() {
  const isMobile = useIsMobile();

  // Forward Enter key to Clerk's Continue / Sign in button.
  // Clerk renders its primary action as type="button", so pressing Enter
  // in the email or password input doesn't naturally submit the form.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Enter') return;
      const card = document.querySelector('.cl-card');
      if (!card) return;
      // Prefer a native submit button; fall back to text-matching
      const btn =
        card.querySelector('button[type="submit"]') ||
        [...card.querySelectorAll('button')].find(
          (b) => !b.disabled && /continue|sign in/i.test(b.textContent.trim())
        );
      if (btn && !btn.disabled) btn.click();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <style>{GLOW_CSS}</style>
      <div style={{ minHeight: '100vh', display: 'flex' }}>

        {/* Left panel – image, 2/3 width — hidden on mobile */}
        {!isMobile && (
          <div
            style={{
              flex: 2,
              backgroundImage: 'url(/signupart.png)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
        )}

        {/* Right panel – auth form with animated glow background */}
        <div
          style={{
            flex: 1,
            minWidth: isMobile ? undefined : 400,
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: palette.primaryDeepPlum.hex,
            // Subtle dot grid for depth and texture
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.042) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: isMobile ? '40px 24px 60px' : 48,
            minHeight: isMobile ? '100vh' : undefined,
          }}
        >
          {/* Glow orb A — top-right, magenta bloom */}
          <div style={{
            position: 'absolute',
            top: '-90px', right: '-90px',
            width: 400, height: 400,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${palette.primaryMagenta.hex}6A 0%, transparent 68%)`,
            animation: 'cs-drift-a 15s ease-in-out infinite, cs-pulse-a 8s ease-in-out infinite',
            pointerEvents: 'none',
          }} />

          {/* Glow orb B — bottom-left, wider softer bloom */}
          <div style={{
            position: 'absolute',
            bottom: '-70px', left: '-110px',
            width: 460, height: 460,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${palette.primaryMagenta.hex}45 0%, transparent 64%)`,
            animation: 'cs-drift-b 22s ease-in-out infinite, cs-pulse-b 13s ease-in-out infinite 3s',
            pointerEvents: 'none',
          }} />

          {/* Glow orb C — mid-left, white shimmer for warmth */}
          <div style={{
            position: 'absolute',
            top: '42%', left: '-55px',
            width: 240, height: 240,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.065) 0%, transparent 70%)',
            animation: 'cs-drift-c 28s ease-in-out infinite',
            pointerEvents: 'none',
          }} />

          {/* Content — sits above all orbs */}
          <div style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
          }}>
            <img
              src="/logo-cs.png"
              alt="CareStream"
              style={{
                height: isMobile ? 44 : 56,
                objectFit: 'contain',
                marginBottom: isMobile ? 32 : 40,
              }}
            />

            <div style={{ position: 'relative', width: isMobile ? '100%' : undefined }}>
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

              {/* <div style={{
                position: 'absolute',
                bottom: -30, left: -10, right: -10,
                height: 100,
                background: palette.primaryDeepPlum.hex,
                zIndex: 10,
              }} />
              <div style={{
                position: 'absolute',
                bottom: 57, left: 0, right: 0,
                height: 16,
                background: palette.backgroundLight.hex,
                borderRadius: '0 0 12px 12px',
                zIndex: 11,
              }} /> */}
              
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
