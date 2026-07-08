import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import palette, { hexToRgba } from '../../utils/colors.js';

// In-app notification toasts fed by the realtime layer (window 'wb:notification'
// CustomEvents — see src/store/realtime.js). Stacked bottom-right, auto-dismiss,
// click to navigate. Mounted once in AppShell.

const AUTO_DISMISS_MS = 7000;

export default function RealtimeToasts() {
  const [toasts, setToasts] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    function onNotify(e) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const toast = { id, ...(e.detail || {}) };
      setToasts((prev) => [...prev.slice(-3), toast]); // max 4 on screen
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), AUTO_DISMISS_MS);
    }
    window.addEventListener('wb:notification', onNotify);
    return () => window.removeEventListener('wb:notification', onNotify);
  }, []);

  if (!toasts.length) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 5000,
      display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 340,
    }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => {
            setToasts((prev) => prev.filter((x) => x.id !== t.id));
            if (t.href) navigate(t.href);
          }}
          style={{
            background: palette.primaryDeepPlum.hex, color: '#fff',
            borderRadius: 12, padding: '13px 16px', cursor: t.href ? 'pointer' : 'default',
            boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
            borderLeft: `4px solid ${palette.accentGreen.hex}`,
            animation: 'wbToastIn 0.25s ease',
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t.title}</div>
          {t.body && (
            <div style={{
              fontSize: 12.5, marginTop: 3, color: hexToRgba('#ffffff', 0.85),
              overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            }}>
              {t.body}
            </div>
          )}
        </div>
      ))}
      <style>{`@keyframes wbToastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}
