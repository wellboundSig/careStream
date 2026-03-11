import { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { usePatients } from '../hooks/usePatients.js';
import { useReferrals } from '../hooks/useReferrals.js';
import { usePatientDrawer } from '../context/PatientDrawerContext.jsx';
import LoadingState from '../components/common/LoadingState.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import DivisionBadge from '../components/common/DivisionBadge.jsx';
import StageBadge from '../components/common/StageBadge.jsx';
import palette, { hexToRgba } from '../utils/colors.js';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function calcAge(dob) {
  if (!dob) return '—';
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 86400000));
}

export default function PatientList() {
  const { division } = useOutletContext();
  const { data: patients, loading: pLoading, error: pError } = usePatients();
  const { data: referrals, loading: rLoading } = useReferrals();
  const { open: openPatient } = usePatientDrawer();

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('last_name');
  const [sortDir, setSortDir] = useState('asc');

  const referralByPatient = useMemo(() => {
    const map = {};
    referrals.forEach((r) => {
      const pid = r.patient_id;
      if (!pid) return;
      if (!map[pid] || new Date(r.referral_date) > new Date(map[pid].referral_date)) {
        map[pid] = r;
      }
    });
    return map;
  }, [referrals]);

  const filtered = useMemo(() => {
    let list = division === 'All'
      ? patients
      : patients.filter((p) => p.division === division);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
          (p.medicaid_number || '').toLowerCase().includes(q) ||
          (p.medicare_number || '').toLowerCase().includes(q)
      );
    }

    return [...list].sort((a, b) => {
      const va = (a[sortField] || '').toString().toLowerCase();
      const vb = (b[sortField] || '').toString().toLowerCase();
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [patients, division, search, sortField, sortDir]);

  function toggleSort(field) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  const loading = pLoading || rLoading;

  if (loading) return <LoadingState message="Loading patients..." />;
  if (pError) return (
    <div style={{ padding: 32, color: palette.primaryMagenta.hex, fontSize: 14 }}>
      Error: {pError}
    </div>
  );

  const columns = [
    { key: 'last_name', label: 'Name', sortable: true },
    { key: 'dob', label: 'DOB / Age', sortable: true },
    { key: 'division', label: 'Division', sortable: true },
    { key: 'current_stage', label: 'Stage', sortable: false },
    { key: 'insurance_plan', label: 'Insurance', sortable: true },
    { key: 'phone_primary', label: 'Phone', sortable: false },
    { key: 'created_at', label: 'Created', sortable: true },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 2 }}>
            Patients
          </h1>
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
            {filtered.length} of {patients.length} records
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: hexToRgba(palette.backgroundDark.hex, 0.05),
              border: `1px solid var(--color-border)`,
              borderRadius: 8,
              padding: '0 12px',
              height: 36,
              width: 260,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" />
              <path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, Medicaid #, Medicare #..."
              style={{
                background: 'none',
                border: 'none',
                outline: 'none',
                fontSize: 13,
                color: palette.backgroundDark.hex,
                width: '100%',
              }}
            />
          </div>

          <button
            style={{
              height: 36,
              padding: '0 16px',
              borderRadius: 8,
              background: palette.primaryMagenta.hex,
              color: palette.backgroundLight.hex,
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            + New Referral
          </button>
        </div>
      </div>

      <div
        style={{
          background: palette.backgroundLight.hex,
          border: `1px solid var(--color-border)`,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: `0 1px 4px var(--color-card-shadow)`,
        }}
      >
        {filtered.length === 0 ? (
          <EmptyState
            title="No patients found"
            subtitle={search ? `No results for "${search}"` : 'Patients will appear here once referrals are created.'}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead>
                <tr
                  style={{
                    borderBottom: `1px solid var(--color-border)`,
                    background: hexToRgba(palette.backgroundDark.hex, 0.025),
                  }}
                >
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                      style={{
                        padding: '10px 16px',
                        textAlign: 'left',
                        fontSize: 11,
                        fontWeight: 650,
                        letterSpacing: '0.04em',
                        color: hexToRgba(palette.backgroundDark.hex, 0.45),
                        textTransform: 'uppercase',
                        cursor: col.sortable ? 'pointer' : 'default',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {col.label}
                        {col.sortable && sortField === col.key && (
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 10 10"
                            fill="none"
                            style={{ transform: sortDir === 'desc' ? 'rotate(180deg)' : 'none' }}
                          >
                            <path d="M5 2L8 7H2L5 2Z" fill={hexToRgba(palette.backgroundDark.hex, 0.5)} />
                          </svg>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((patient) => {
                  const ref = referralByPatient[patient.id];
                  return (
                    <PatientRow
                      key={patient._id}
                      patient={patient}
                      referral={ref}
                      onOpen={() => openPatient(patient, ref || null)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PatientRow({ patient, referral, onOpen }) {
  const [hovered, setHovered] = useState(false);

  return (
    <tr
      style={{
        borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`,
        background: hovered ? hexToRgba(palette.primaryDeepPlum.hex, 0.03) : 'transparent',
        transition: 'background 0.1s',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={onOpen}
      title="Double-click to open patient detail"
    >
      <td style={{ padding: '13px 16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: palette.backgroundDark.hex,
            }}
          >
            {patient.last_name}, {patient.first_name}
          </span>
          {patient.medicaid_number && (
            <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
              Medicaid: {patient.medicaid_number}
            </span>
          )}
        </div>
      </td>

      <td style={{ padding: '13px 16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, color: palette.backgroundDark.hex }}>
            {formatDate(patient.dob)}
          </span>
          <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            Age {calcAge(patient.dob)}
          </span>
        </div>
      </td>

      <td style={{ padding: '13px 16px' }}>
        <DivisionBadge division={patient.division} size="small" />
      </td>

      <td style={{ padding: '13px 16px' }}>
        {referral ? (
          <StageBadge stage={referral.current_stage} size="small" />
        ) : (
          <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.3) }}>
            No referral
          </span>
        )}
      </td>

      <td
        style={{
          padding: '13px 16px',
          fontSize: 13,
          color: hexToRgba(palette.backgroundDark.hex, 0.7),
        }}
      >
        {patient.insurance_plan || patient.medicare_number
          ? patient.insurance_plan || 'Medicare'
          : '—'}
      </td>

      <td
        style={{
          padding: '13px 16px',
          fontSize: 13,
          color: hexToRgba(palette.backgroundDark.hex, 0.65),
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {patient.phone_primary || '—'}
      </td>

      <td
        style={{
          padding: '13px 16px',
          fontSize: 12,
          color: hexToRgba(palette.backgroundDark.hex, 0.45),
        }}
      >
        {formatDate(patient.created_at)}
      </td>
    </tr>
  );
}
