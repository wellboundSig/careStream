import { useState, useRef, useCallback } from 'react';
import palette, { hexToRgba } from '../../utils/colors.js';

const API = 'https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search';

export default function ICD10Lookup({ onSelect, compact = false }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);
  const [open, setOpen] = useState(false);
  const debounce = useRef(null);

  const search = useCallback((term) => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!term.trim()) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}?sf=code,name&terms=${encodeURIComponent(term)}&maxList=10`);
        const data = await res.json();
        // data[3] is array of [code, name] pairs
        const items = (data[3] || []).map(([code, name]) => ({ code, name }));
        setResults(items);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 320);
  }, []);

  function addCode(item) {
    if (selected.find((s) => s.code === item.code)) return;
    const next = [...selected, item];
    setSelected(next);
    onSelect?.(next);
    setQuery('');
    setResults([]);
  }

  function removeCode(code) {
    const next = selected.filter((s) => s.code !== code);
    setSelected(next);
    onSelect?.(next);
  }

  const inp = {
    width: '100%', padding: compact ? '5px 8px' : '7px 9px', borderRadius: 7,
    border: `1px solid var(--color-border)`, fontSize: compact ? 12 : 12.5,
    fontFamily: 'inherit', outline: 'none', background: palette.backgroundLight.hex,
    color: palette.backgroundDark.hex,
  };

  return (
    <div>
      {/* Selected codes */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {selected.map((s) => (
            <span key={s.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 650, padding: '3px 9px', borderRadius: 20, background: hexToRgba(palette.accentBlue.hex, 0.12), color: palette.accentBlue.hex }}>
              <strong>{s.code}</strong>
              <span style={{ fontWeight: 400, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
              <button onClick={() => removeCode(s.code)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: hexToRgba(palette.accentBlue.hex, 0.6), padding: '0 2px', fontSize: 12, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div style={{ position: 'relative' }}>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); search(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search ICD-10 code or diagnosis…"
          style={inp}
          onFocus={(e) => { e.target.style.borderColor = palette.primaryMagenta.hex; setOpen(true); }}
          onBlur={(e) => { e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12); setTimeout(() => setOpen(false), 180); }}
        />
        {loading && (
          <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            Searching…
          </span>
        )}

        {open && results.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 500, background: palette.backgroundLight.hex, border: `1px solid var(--color-border)`, borderRadius: 8, boxShadow: `0 6px 20px ${hexToRgba(palette.backgroundDark.hex, 0.12)}`, maxHeight: 220, overflowY: 'auto', marginTop: 2 }}>
            {results.map((item) => {
              const already = !!selected.find((s) => s.code === item.code);
              return (
                <button
                  key={item.code}
                  onMouseDown={(e) => { e.preventDefault(); addCode(item); }}
                  disabled={already}
                  style={{
                    width: '100%', padding: '8px 12px', background: 'none', border: 'none',
                    textAlign: 'left', cursor: already ? 'default' : 'pointer',
                    opacity: already ? 0.45 : 1,
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => !already && (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.04))}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: palette.accentBlue.hex, flexShrink: 0, minWidth: 56 }}>{item.code}</span>
                  <span style={{ fontSize: 12, color: palette.backgroundDark.hex, lineHeight: 1.4 }}>{item.name}</span>
                  {already && <span style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginLeft: 'auto', flexShrink: 0 }}>Added</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
