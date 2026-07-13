import { useUser } from '@clerk/react';
import { useCareStore } from '../../store/careStore.js';
import palette, { hexToRgba } from '../../utils/colors.js';

export default function HydrationScreen() {
  const { done, total } = useCareStore((s) => s.hydrationProgress);
  const error = useCareStore((s) => s.hydrationError);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Clerk resolves before store hydration, so the name is usually ready.
  const { user, isLoaded } = useUser();
  const firstName = isLoaded ? (user?.firstName || '').trim() : '';

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: palette.primaryDeepPlum.hex,
        gap: 24,
      }}
    >
      <img
        src="/logo-cs.png"
        alt="CareStream"
        style={{ height: 44, objectFit: 'contain' }}
      />

      {firstName && (
        <p
          style={{
            color: hexToRgba('#ffffff', 0.85),
            fontSize: 15,
            fontWeight: 550,
            letterSpacing: '0.01em',
            margin: 0,
            animation: 'hydration-greet 0.6s ease-out both',
          }}
        >
          Hi {firstName}
        </p>
      )}

      {/* Progress bar */}
      <div
        style={{
          width: 220,
          height: 3,
          borderRadius: 3,
          background: hexToRgba('#ffffff', 0.12),
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            borderRadius: 3,
            width: `${pct}%`,
            background: palette.accentGreen.hex,
            transition: 'width 0.3s ease-out',
          }}
        />
      </div>

      <p
        style={{
          color: hexToRgba('#ffffff', 0.45),
          fontSize: 12.5,
          fontWeight: 450,
          letterSpacing: '0.02em',
        }}
      >
        {error
          ? 'Something went wrong — please refresh.'
          : `Loading CareStream\u2026`}
      </p>

      <style>{`
        @keyframes hydration-pulse {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 0.7; }
        }
        @keyframes hydration-greet {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
