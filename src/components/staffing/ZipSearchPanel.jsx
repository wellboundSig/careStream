import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useEsperClinicians } from '../../hooks/useEsperClinicians.js';
import palette, { hexToRgba } from '../../utils/colors.js';

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getZipLatLon(zip) {
  const url = import.meta.env.DEV
    ? `/zip-proxy/us/${zip}`
    : `https://api.zippopotam.us/us/${zip}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const place = data.places?.[0];
    if (!place) return null;
    return { lat: parseFloat(place.latitude), lon: parseFloat(place.longitude), city: place['place name'], state: place['state abbreviation'] };
  } catch { return null; }
}

async function reverseGeoZip(lat, lon) {
  try {
    const base = import.meta.env.DEV ? '/nominatim-proxy' : 'https://nominatim.openstreetmap.org';
    const res = await fetch(
      `${base}/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'CareStream/1.0' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.address?.postcode?.replace(/\s/g, '') || null;
  } catch { return null; }
}

const LOADER_MESSAGES = [
  'Locating district…',
  'Finding nearby ZIP codes…',
  'Checking clinician network…',
  'Calculating distances…',
  'Mapping service areas…',
  'Establishing clinician connections…',
  'Cross-referencing coverage zones…',
  'Compiling results…',
];

// Inject keyframes once
if (typeof document !== 'undefined' && !document.getElementById('zip-loader-style')) {
  const style = document.createElement('style');
  style.id = 'zip-loader-style';
  style.textContent = `
    @keyframes zipBarSlide {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(400%); }
    }
    @keyframes zipMsgFade {
      0%   { opacity: 0; transform: translateY(4px); }
      15%  { opacity: 1; transform: translateY(0); }
      80%  { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(-4px); }
    }
  `;
  document.head.appendChild(style);
}

export default function ZipSearchPanel() {
  const { clinicians, loading: clinLoading } = useEsperClinicians();
  const [zip, setZip] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [msgIdx, setMsgIdx] = useState(0);
  const zipCache = useRef({});

  useEffect(() => {
    if (!searching) { setMsgIdx(0); return; }
    const iv = setInterval(() => setMsgIdx((i) => (i + 1) % LOADER_MESSAGES.length), 2600);
    return () => clearInterval(iv);
  }, [searching]);

  const cliniciansWithLocation = useMemo(
    () => clinicians.filter((c) => c.location?.lat && c.location?.lon),
    [clinicians]
  );

  const search = useCallback(async () => {
    if (!/^\d{5}$/.test(zip)) { setError('Enter a valid 5-digit zip code'); return; }
    setSearching(true);
    setError(null);
    setResults(null);

    try {
      const origin = await getZipLatLon(zip);
      if (!origin) { setError(`Zip code ${zip} not found`); return; }

      // Calculate distance from each clinician's GPS location to the input zip
      const withDist = cliniciansWithLocation.map((c) => ({
        ...c,
        dist: haversine(origin.lat, origin.lon, c.location.lat, c.location.lon),
      })).sort((a, b) => a.dist - b.dist);

      // Reverse geocode unique clinician locations to get their zip codes.
      // Use the persistent zipCache ref so results survive across searches and
      // we never re-request a coordinate we've already resolved.
      // Requests are serialised (not parallel) to respect Nominatim's 1 req/s limit.
      const top30 = withDist.slice(0, 30);
      const uniqueKeys = [...new Set(top30.map((c) => `${c.location.lat.toFixed(3)},${c.location.lon.toFixed(3)}`))];
      const uncached = uniqueKeys.filter((k) => !(k in zipCache.current));

      for (const key of uncached) {
        const [lat, lon] = key.split(',').map(Number);
        const z = await reverseGeoZip(lat, lon);
        zipCache.current[key] = z || '?';
        // Respect Nominatim's usage policy: max 1 request/second
        if (uncached.indexOf(key) < uncached.length - 1) {
          await new Promise((r) => setTimeout(r, 1100));
        }
      }

      // Attach zip to each clinician from cache
      const enriched = top30.map((c) => {
        const key = `${c.location.lat.toFixed(3)},${c.location.lon.toFixed(3)}`;
        return { ...c, lastSeenZip: zipCache.current[key] !== '?' ? zipCache.current[key] : null };
      });

      // Group by zip code, take top 5 unique zips
      const zipGroups = {};
      for (const c of enriched) {
        const z = c.lastSeenZip || '?';
        if (!zipGroups[z]) zipGroups[z] = { zip: z, dist: c.dist, clinicians: [] };
        zipGroups[z].clinicians.push(c);
      }

      const top5 = Object.values(zipGroups)
        .filter((g) => g.zip !== '?')
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 5);

      setResults({ origin, top5 });
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }, [zip, cliniciansWithLocation]);

  const locationCount = cliniciansWithLocation.length;

  return (
    <div>
      {locationCount === 0 && !clinLoading && (
        <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 10, lineHeight: 1.5 }}>
          No device location data available yet. Devices need to have location reporting enabled in Esper.
        </p>
      )}

      {locationCount > 0 && (
        <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 8 }}>
          {locationCount} clinician{locationCount !== 1 ? 's' : ''} with GPS location
        </p>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Enter zip code…"
          maxLength={5}
          style={{ flex: 1, padding: '6px 9px', borderRadius: 7, border: `1px solid var(--color-border)`, fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }}
        />
        <button onClick={search}
          disabled={searching || zip.length < 5 || locationCount === 0}
          style={{ padding: '6px 12px', borderRadius: 7, background: (zip.length === 5 && locationCount > 0) ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.08), border: 'none', fontSize: 12, fontWeight: 650, color: (zip.length === 5 && locationCount > 0) ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.35), cursor: (zip.length === 5 && locationCount > 0) ? 'pointer' : 'not-allowed' }}>
          {searching ? '…' : 'Search'}
        </button>
      </div>

      {/* Animated loader */}
      {searching && (
        <div style={{ marginBottom: 14 }}>
          {/* Track */}
          <div style={{ position: 'relative', height: 3, borderRadius: 99, background: hexToRgba(palette.primaryDeepPlum.hex, 0.1), overflow: 'hidden', marginBottom: 10 }}>
            {/* Sliding bar */}
            <div style={{
              position: 'absolute', top: 0, left: 0, height: '100%', width: '25%',
              borderRadius: 99,
              background: `linear-gradient(90deg, transparent, ${palette.primaryDeepPlum.hex}, transparent)`,
              animation: 'zipBarSlide 1.6s ease-in-out infinite',
            }} />
          </div>
          {/* Cycling message */}
          <p key={msgIdx} style={{
            fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5),
            fontStyle: 'italic', textAlign: 'center',
            animation: 'zipMsgFade 2.6s ease forwards',
          }}>
            {LOADER_MESSAGES[msgIdx]}
          </p>
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginBottom: 8 }}>{error}</p>}

      {results && (
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 8 }}>
            Near {results.origin.city}, {results.origin.state} ({zip}) — top 5 nearby zip codes
          </p>
          {results.top5.length === 0 ? (
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>No clinicians found nearby.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {results.top5.map(({ zip: z, dist, clinicians: cls }) => (
                <div key={z} style={{ borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.025), overflow: 'hidden' }}>
                  <div style={{ padding: '7px 10px', background: hexToRgba(palette.accentBlue.hex, 0.08), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: palette.backgroundDark.hex }}>{z}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 650, color: palette.accentBlue.hex }}>{dist.toFixed(1)} mi</span>
                  </div>
                  {cls.map((c) => (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 10px', borderTop: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 550, color: palette.backgroundDark.hex }}>{c.name}</span>
                        {c.workerId && <span style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginLeft: 6 }}>#{c.workerId}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: hexToRgba(palette.accentBlue.hex, 0.1), color: palette.accentBlue.hex }}>{c.discipline}</span>
                        <span style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>{c.dist.toFixed(1)}mi</span>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.online ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.2), display: 'inline-block' }} />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
