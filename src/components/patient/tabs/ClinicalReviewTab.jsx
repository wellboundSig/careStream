import { useState, useEffect } from 'react';
import ClinicalChecklistUI from '../../clinical/ClinicalChecklistUI.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

export default function ClinicalReviewTab({ patient, referral }) {
  const [checked, setChecked] = useState({});
  const [decision, setDecision] = useState(null);
  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    setChecked({});
    setDecision(null);
    setAuthRequired(false);
  }, [patient?.id, referral?._id]);

  function toggleItem(key) {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div style={{ padding: '20px 20px 40px' }}>
      <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 16 }}>
        Clinical intake RN review checklist for {patient?.first_name} {patient?.last_name}. This checklist is session-only and does not persist to the database.
      </p>

      <ClinicalChecklistUI
        checked={checked}
        onToggle={toggleItem}
        decision={decision}
        onDecisionChange={setDecision}
        authRequired={authRequired}
        onAuthRequiredChange={setAuthRequired}
      />
    </div>
  );
}
