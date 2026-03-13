import { useTheme } from '../utils/ThemeContext.jsx';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import { usePreferences } from '../context/UserPreferencesContext.jsx';
import { PIN_GROUPS } from '../components/layout/SubNav.jsx';
import palette, { hexToRgba } from '../utils/colors.js';
import { UserButton } from '@clerk/react';

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, description, children }) {
  return (
    <div style={{
      background: palette.backgroundLight.hex,
      border: `1px solid var(--color-border)`,
      borderRadius: 12,
      padding: '20px 24px',
      marginBottom: 16,
    }}>
      <div style={{ marginBottom: description ? 4 : 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>
          {title}
        </h2>
        {description && (
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: '3px 0 16px', lineHeight: 1.45 }}>
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Setting row ────────────────────────────────────────────────────────────────
function SettingRow({ label, hint, children }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      padding: '10px 0',
      borderBottom: `1px solid var(--color-border)`,
    }}>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex, margin: 0 }}>{label}</p>
        {hint && (
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: '2px 0 0', lineHeight: 1.4 }}>{hint}</p>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        position: 'relative',
        width: 44,
        height: 24,
        borderRadius: 12,
        border: 'none',
        cursor: 'pointer',
        background: checked ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.18),
        transition: 'background 0.2s',
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3,
        left: checked ? 23 : 3,
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: palette.backgroundLight.hex,
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      }} />
    </button>
  );
}

// ── Theme preview chips ───────────────────────────────────────────────────────
function ThemePreview({ isDark }) {
  const bg   = isDark ? '#14141E' : '#F7F7FA';
  const text = isDark ? '#E2E2EC' : '#0B0B10';
  const card = isDark ? '#1E1E2C' : '#FFFFFF';

  return (
    <div style={{
      display: 'flex',
      gap: 8,
      marginTop: 16,
      padding: '12px 14px',
      borderRadius: 10,
      background: bg,
      border: `1px solid ${isDark ? 'rgba(226,226,236,0.1)' : 'rgba(11,11,16,0.08)'}`,
      width: 200,
    }}>
      {/* Mini sidebar */}
      <div style={{
        width: 32,
        borderRadius: 6,
        background: '#450931',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        padding: '6px 4px',
      }}>
        {[1,2,3,4].map((i) => (
          <div key={i} style={{ height: 4, borderRadius: 2, background: 'rgba(247,247,250,0.3)' }} />
        ))}
      </div>
      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ height: 8, borderRadius: 4, background: card, width: '80%' }} />
        <div style={{ height: 30, borderRadius: 6, background: card, border: `1px solid ${isDark ? 'rgba(226,226,236,0.08)' : 'rgba(11,11,16,0.06)'}` }} />
        <div style={{ display: 'flex', gap: 4 }}>
          <div style={{ flex: 1, height: 20, borderRadius: 4, background: card }} />
          <div style={{ flex: 1, height: 20, borderRadius: 4, background: '#D91E75', opacity: 0.8 }} />
        </div>
        <div style={{ height: 5, borderRadius: 3, background: text, opacity: 0.15, width: '60%' }} />
        <div style={{ height: 5, borderRadius: 3, background: text, opacity: 0.10, width: '45%' }} />
      </div>
    </div>
  );
}

// ── Settings page ─────────────────────────────────────────────────────────────
export default function Settings() {
  const { isDark, toggleTheme } = useTheme();
  const { appUser, appUserName } = useCurrentAppUser();
  const { prefs, save, pinPage, unpinPage, MAX_PINS } = usePreferences();

  return (
    <div style={{
      maxWidth: 680,
      margin: '0 auto',
      padding: '28px 24px 48px',
    }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 750, color: palette.backgroundDark.hex, margin: 0 }}>
          Settings
        </h1>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 4 }}>
          Manage your preferences for CareStream
        </p>
      </div>

      {/* ── Appearance ── */}
      <Section
        title="Appearance"
        description="Control how CareStream looks on your device."
      >
        <SettingRow
          label="Dark Mode"
          hint="Switches the interface to a dark color scheme. Sidebar and top nav always remain the same."
        >
          <Toggle checked={isDark} onChange={toggleTheme} />
        </SettingRow>

        {/* Last row — no bottom border needed */}
        <div style={{ paddingTop: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Preview
          </p>
          <div style={{ display: 'flex', gap: 16 }}>
            {/* Light option */}
            <div
              onClick={() => isDark && toggleTheme()}
              style={{ cursor: isDark ? 'pointer' : 'default' }}
            >
              <p style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 6 }}>Light</p>
              <div style={{
                borderRadius: 10,
                overflow: 'hidden',
                outline: !isDark ? `2px solid ${palette.primaryMagenta.hex}` : `2px solid transparent`,
                outlineOffset: 2,
                transition: 'outline-color 0.15s',
              }}>
                <ThemePreview isDark={false} />
              </div>
            </div>
            {/* Dark option */}
            <div
              onClick={() => !isDark && toggleTheme()}
              style={{ cursor: !isDark ? 'pointer' : 'default' }}
            >
              <p style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 6 }}>Dark</p>
              <div style={{
                borderRadius: 10,
                overflow: 'hidden',
                outline: isDark ? `2px solid ${palette.primaryMagenta.hex}` : `2px solid transparent`,
                outlineOffset: 2,
                transition: 'outline-color 0.15s',
              }}>
                <ThemePreview isDark={true} />
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Navigation Pins ── */}
      <Section
        title="Navigation Bar"
        description="Pin up to 6 pages for quick access. They appear as tabs in a bar below the top nav."
      >
        <SettingRow
          label="Show pinned navigation bar"
          hint="Displays a second row of tabs under the top bar with your pinned pages."
        >
          <Toggle
            checked={prefs.subnavEnabled}
            onChange={() => save({ subnavEnabled: !prefs.subnavEnabled })}
          />
        </SettingRow>

        {/* Pin picker — always shown so users can set up pins before enabling */}
        <div style={{ paddingTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p style={{ fontSize: 12, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.45), textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
              Pinned Pages
            </p>
            <span style={{ fontSize: 11.5, color: prefs.pinnedPages.length >= MAX_PINS ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.35) }}>
              {prefs.pinnedPages.length} / {MAX_PINS}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {PIN_GROUPS.map((group) => (
              <div key={group.label}>
                <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.32), marginBottom: 6 }}>
                  {group.label}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px 12px' }}>
                  {group.items.map(({ label, path }) => {
                    const pinned  = prefs.pinnedPages.includes(path);
                    const atLimit = !pinned && prefs.pinnedPages.length >= MAX_PINS;
                    return (
                      <label
                        key={path}
                        title={atLimit ? `Limit of ${MAX_PINS} reached — unpin another page first` : undefined}
                        style={{
                          display:    'flex',
                          alignItems: 'center',
                          gap:        7,
                          padding:    '5px 0',
                          cursor:     atLimit ? 'not-allowed' : 'pointer',
                          opacity:    atLimit ? 0.45 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={pinned}
                          disabled={atLimit}
                          onChange={() => pinned ? unpinPage(path) : pinPage(path)}
                          style={{ accentColor: palette.primaryMagenta.hex, width: 13, height: 13, flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 13, color: pinned ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.6), fontWeight: pinned ? 550 : 400 }}>
                          {label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Profile ── */}
      <Section
        title="Profile"
        description="Your account details are managed through Clerk. Click your avatar to update your name, email, or profile photo."
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0' }}>
          <UserButton
            appearance={{
              elements: {
                avatarBox: { width: 44, height: 44 },
              },
            }}
          />
          <div>
            <p style={{ fontSize: 14, fontWeight: 650, color: palette.backgroundDark.hex, margin: 0 }}>
              {appUserName || 'Loading…'}
            </p>
            {appUser?.email && (
              <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: '2px 0 0' }}>
                {appUser.email}
              </p>
            )}
            {appUser?.role_id && (
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.35), margin: '2px 0 0' }}>
                {appUser.role_id}
              </p>
            )}
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <span style={{
              fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
              background: hexToRgba(palette.accentGreen.hex, 0.12),
              color: palette.accentGreen.hex,
            }}>
              Active
            </span>
          </div>
        </div>
      </Section>

      {/* ── Notifications ── */}
      <Section
        title="Notifications"
        description="Notification preferences will be configurable in a future release."
      >
        <SettingRow
          label="Task Assignments"
          hint="Show a badge and panel entry when a task is assigned to you"
        >
          <Toggle checked={true} onChange={() => {}} />
        </SettingRow>
        <SettingRow
          label="Pipeline Transitions"
          hint="Notify when a patient you're responsible for changes stage"
        >
          <Toggle checked={false} onChange={() => {}} />
        </SettingRow>
        <div style={{ paddingTop: 12 }}>
        </div>
      </Section>

      {/* ── Data & Privacy (stub) ── */}
      <Section
        title="Data & Privacy"
        description="Patient data stored in Airtable in accordance with HIPAA policies."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
          {[
            'Data is never shared with third parties.',
            'All connections use TLS encryption in transit.',
            'Access is restricted to authenticated team members via Clerk.',
            'Audit logs are maintained in the Airtable base.',
          ].map((item) => (
            <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10" stroke={palette.accentGreen.hex} strokeWidth="1.8" />
                <path d="M8 12l3 3 5-5" stroke={palette.accentGreen.hex} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.45 }}>{item}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
