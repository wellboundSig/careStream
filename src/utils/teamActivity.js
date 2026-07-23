/**
 * Build a unified staff activity stream for department / team dashboards.
 * Pulls from every hydrated audit surface we have — not just ActivityLog.
 *
 * Each event: { id, actorId, timestamp, action, detail, patientId, referralId, colorKey }
 *
 * actorId is always normalized to the member's business id (usr_###) when possible,
 * so Clerk ids / Airtable rec ids still land on the right person.
 */

function asIso(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

/**
 * Map any known id for a team member → their canonical business id (usr_###).
 * Accepts Users store slice + Set of member business ids.
 */
export function buildActorAliasMap(users, memberIds) {
  const members = memberIds instanceof Set ? memberIds : new Set(memberIds || []);
  const aliasToCanonical = new Map();
  for (const u of Object.values(users || {})) {
    const canonical = u?.id;
    if (!canonical || !members.has(canonical)) continue;
    for (const alias of [u.id, u._id, u.clerk_user_id]) {
      if (alias) aliasToCanonical.set(String(alias), canonical);
    }
  }
  // Also allow direct business-id hits even if Users row is missing aliases
  for (const id of members) {
    if (id) aliasToCanonical.set(String(id), String(id));
  }
  return aliasToCanonical;
}

function resolveActor(aliasMap, rawId) {
  if (!rawId) return null;
  return aliasMap.get(String(rawId)) || null;
}

function push(out, evt) {
  if (!evt?.actorId || !evt?.timestamp) return;
  const ts = asIso(evt.timestamp);
  if (!ts) return;
  out.push({
    id: evt.id,
    actorId: evt.actorId,
    timestamp: ts,
    action: evt.action || 'Activity',
    detail: evt.detail || '',
    patientId: evt.patientId || null,
    referralId: evt.referralId || null,
    colorKey: evt.colorKey || evt.action || 'default',
  });
}

function buildReferralMap(referrals) {
  const refMap = new Map();
  for (const r of Object.values(referrals || {})) {
    if (r?.id) refMap.set(r.id, r);
    if (r?._id) refMap.set(r._id, r);
  }
  return refMap;
}

function patientFromReferral(referralById, referralId) {
  if (!referralId) return null;
  const ref = referralById.get(referralId);
  return ref?.patient_id || null;
}

function humanizeAction(action) {
  if (!action) return 'Activity';
  const s = String(action);
  if (s.includes(' ') && /[A-Z]/.test(s[0])) return s;
  return s
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param {object} opts
 * @param {Set<string>|string[]} opts.memberIds — business ids (usr_###)
 * @param {object} opts.stores — slices from careStore
 * @param {object} [opts.users] — Users store (for clerk/_id alias resolution)
 * @param {Map<string, object>} [opts.referralById]
 */
export function buildTeamActivityEvents({ memberIds, stores, users, referralById }) {
  const members = memberIds instanceof Set ? memberIds : new Set(memberIds || []);
  if (!members.size) return [];

  const aliasMap = buildActorAliasMap(users || stores.users || {}, members);
  const refMap = referralById || buildReferralMap(stores.referrals);

  const out = [];
  const tryActor = (raw) => resolveActor(aliasMap, raw);

  // ── ActivityLog (incl. metadata fallback when id columns failed to write) ─
  for (const a of Object.values(stores.activityLog || {})) {
    const meta = parseMeta(a.metadata);
    const actorId = tryActor(a.actor_id || meta.actorUserId);
    if (!actorId) continue;
    push(out, {
      id: `act_${a._id || a.id}`,
      actorId,
      timestamp: a.timestamp || a.created_at,
      action: humanizeAction(a.action),
      detail: a.detail || '',
      patientId: a.patient_id || meta.patientId || null,
      referralId: a.referral_id || meta.referralId || null,
      colorKey: a.action,
    });
  }

  // ── StageHistory ─────────────────────────────────────────────────────────
  for (const h of Object.values(stores.stageHistory || {})) {
    const actorId = tryActor(h.changed_by_id);
    if (!actorId) continue;
    const from = h.from_stage || '?';
    const to = h.to_stage || '?';
    push(out, {
      id: `stage_${h._id || h.id}`,
      actorId,
      timestamp: h.timestamp || h.created_at,
      action: 'Stage Change',
      detail: `${from} → ${to}${h.reason ? ` · ${h.reason}` : ''}`,
      patientId: patientFromReferral(refMap, h.referral_id),
      referralId: h.referral_id || null,
      colorKey: 'Stage Change',
    });
  }

  // ── Notes (skip auto stage-transition wrappers; surface those via StageHistory) ─
  for (const n of Object.values(stores.notes || {})) {
    const actorId = tryActor(n.author_id);
    if (!actorId) continue;
    const content = String(n.content || '').trim();
    if (!content) continue;

    // Orphan stage-transition notes (history write failed) still count
    const stageMatch = content.match(/^\[([^\]]+?)\s*(?:→|->)\s*([^\]]+?)\]\s*\n?([\s\S]*)$/);
    if (stageMatch) {
      push(out, {
        id: `stage_note_${n._id || n.id}`,
        actorId,
        timestamp: n.created_at || n.timestamp,
        action: 'Stage Change',
        detail: `${stageMatch[1].trim()} → ${stageMatch[2].trim()}${stageMatch[3]?.trim() ? ` · ${stageMatch[3].trim()}` : ''}`,
        patientId: n.patient_id || null,
        referralId: n.referral_id || null,
        colorKey: 'Stage Change',
      });
      continue;
    }

    const preview = content.length > 120 ? `${content.slice(0, 117)}…` : content;
    push(out, {
      id: `note_${n._id || n.id}`,
      actorId,
      timestamp: n.created_at || n.timestamp,
      action: n.is_pinned === true || n.is_pinned === 'TRUE' ? 'Note Pinned' : 'Note Added',
      detail: preview,
      patientId: n.patient_id || null,
      referralId: n.referral_id || null,
      colorKey: 'Note Added',
    });
  }

  // ── Tasks ────────────────────────────────────────────────────────────────
  for (const t of Object.values(stores.tasks || {})) {
    const title = t.title || 'Task';
    const bits = [];
    if (t.due_date) bits.push(`Due ${String(t.due_date).slice(0, 10)}`);
    if (t.scheduled_date) bits.push(`Scheduled ${String(t.scheduled_date).slice(0, 10)}`);
    if (t.type) bits.push(t.type);

    const assignee = tryActor(t.assigned_to_id);
    if (assignee && (t.created_at || t.due_date || t.scheduled_date)) {
      push(out, {
        id: `task_asg_${t._id || t.id}`,
        actorId: assignee,
        timestamp: t.created_at || t.scheduled_date || t.due_date,
        action: t.scheduled_date ? 'Task Scheduled' : 'Task Assigned',
        detail: [title, ...bits].filter(Boolean).join(' · '),
        patientId: t.patient_id || null,
        referralId: t.referral_id || null,
        colorKey: 'Task Created',
      });
    }

    const creator = tryActor(t.created_by_id || t.created_by);
    if (creator && t.created_at && creator !== assignee) {
      push(out, {
        id: `task_crt_${t._id || t.id}`,
        actorId: creator,
        timestamp: t.created_at,
        action: 'Task Created',
        detail: [title, assignee ? `Assigned to teammate` : null, ...bits].filter(Boolean).join(' · '),
        patientId: t.patient_id || null,
        referralId: t.referral_id || null,
        colorKey: 'Task Created',
      });
    }

    const completer = tryActor(t.completed_by_id);
    if (completer && t.completed_at) {
      push(out, {
        id: `task_done_${t._id || t.id}`,
        actorId: completer,
        timestamp: t.completed_at,
        action: 'Task Completed',
        detail: title,
        patientId: t.patient_id || null,
        referralId: t.referral_id || null,
        colorKey: 'Task Created',
      });
    }
  }

  // ── Files ────────────────────────────────────────────────────────────────
  for (const f of Object.values(stores.files || {})) {
    const actorId = tryActor(f.uploaded_by_id || f.created_by_id);
    if (!actorId) continue;
    push(out, {
      id: `file_${f._id || f.id}`,
      actorId,
      timestamp: f.created_at || f.uploaded_at,
      action: 'File Uploaded',
      detail: [f.category, f.file_name || f.name].filter(Boolean).join(' · '),
      patientId: f.patient_id || null,
      referralId: f.referral_id || null,
      colorKey: 'File Uploaded',
    });
  }

  // ── Conflicts ────────────────────────────────────────────────────────────
  for (const c of Object.values(stores.conflicts || {})) {
    const flagger = tryActor(c.flagged_by_id || c.created_by_id);
    if (flagger) {
      push(out, {
        id: `conf_open_${c._id || c.id}`,
        actorId: flagger,
        timestamp: c.created_at || c.flagged_at,
        action: 'Conflict Flagged',
        detail: [c.category, c.severity, c.description].filter(Boolean).join(' · '),
        patientId: c.patient_id || null,
        referralId: c.referral_id || null,
        colorKey: 'Conflict Flagged',
      });
    }
    const resolver = tryActor(c.resolved_by_id);
    if (resolver && (c.resolved_at || c.status === 'Resolved' || c.status === 'Waived')) {
      push(out, {
        id: `conf_done_${c._id || c.id}`,
        actorId: resolver,
        timestamp: c.resolved_at || c.updated_at || c.created_at,
        action: c.status === 'Waived' ? 'Conflict Waived' : 'Conflict Resolved',
        detail: c.resolution_note || c.category || '',
        patientId: c.patient_id || null,
        referralId: c.referral_id || null,
        colorKey: 'Conflict Flagged',
      });
    }
  }

  // ── Triage (+ phone call detail when present) ────────────────────────────
  function pushTriage(t, kind, keyPrefix) {
    const actorId = tryActor(t.filled_by_id || t.created_by_id || t.updated_by_id);
    if (!actorId) return;
    const patientId = t.patient_id || patientFromReferral(refMap, t.referral_id);
    const phone = t.phone_call_made_to ? String(t.phone_call_made_to).trim() : '';
    push(out, {
      id: `${keyPrefix}_${t._id || t.id}`,
      actorId,
      timestamp: t.created_at || t.updated_at || t.filled_at,
      action: 'Triage Submitted',
      detail: [kind, phone ? `Phone call: ${phone}` : null].filter(Boolean).join(' · '),
      patientId,
      referralId: t.referral_id || null,
      colorKey: 'Triage Submitted',
    });
    if (phone) {
      push(out, {
        id: `${keyPrefix}_phone_${t._id || t.id}`,
        actorId,
        timestamp: t.created_at || t.updated_at || t.filled_at,
        action: 'Phone Call Logged',
        detail: phone,
        patientId,
        referralId: t.referral_id || null,
        colorKey: 'Phone Call Logged',
      });
    }
  }
  for (const t of Object.values(stores.triageAdult || {})) pushTriage(t, 'Adult triage', 'triage_a');
  for (const t of Object.values(stores.triagePediatric || {})) pushTriage(t, 'Pediatric triage', 'triage_p');

  // ── Insurance checks ─────────────────────────────────────────────────────
  for (const c of Object.values(stores.insuranceChecks || {})) {
    const actorId = tryActor(c.checked_by_id || c.created_by_id || c.created_by_user_id);
    if (!actorId) continue;
    push(out, {
      id: `ins_${c._id || c.id}`,
      actorId,
      timestamp: c.check_date || c.created_at || c.verified_at,
      action: 'Insurance Check',
      detail: [c.plan_name || c.insurance_plan, c.result || c.status || c.verification_status].filter(Boolean).join(' · '),
      patientId: c.patient_id || null,
      referralId: c.referral_id || null,
      colorKey: 'Insurance Check',
    });
  }

  // ── Authorizations ───────────────────────────────────────────────────────
  for (const a of Object.values(stores.authorizations || {})) {
    const actorId = tryActor(a.decided_by_user_id || a.created_by_id || a.updated_by_id);
    if (!actorId) continue;
    const decision = a.status || a.decision || 'Updated';
    push(out, {
      id: `auth_${a._id || a.id}`,
      actorId,
      timestamp: a.decided_at || a.approved_date || a.created_at || a.updated_at,
      action: 'Authorization',
      detail: String(decision),
      patientId: a.patient_id || null,
      referralId: a.referral_id || null,
      colorKey: 'Insurance Check',
    });
  }

  // ── Clinical / cursory reviews ───────────────────────────────────────────
  for (const r of Object.values(stores.clinicalReviews || {})) {
    const actorId = tryActor(r.reviewed_by || r.reviewed_by_id || r.completed_by_id);
    if (!actorId) continue;
    push(out, {
      id: `clin_${r._id || r.id}`,
      actorId,
      timestamp: r.completed_at || r.created_at || r.updated_at,
      action: 'Clinical Review',
      detail: r.decision || r.clinical_review_decision || '',
      patientId: r.patient_id || patientFromReferral(refMap, r.referral_id),
      referralId: r.referral_id || null,
      colorKey: 'Triage Submitted',
    });
  }
  for (const r of Object.values(stores.cursoryReviews || {})) {
    const actorId = tryActor(r.reviewed_by || r.reviewed_by_id || r.completed_by_id);
    if (!actorId) continue;
    push(out, {
      id: `curs_${r._id || r.id}`,
      actorId,
      timestamp: r.completed_at || r.created_at || r.updated_at,
      action: 'Cursory Review',
      detail: '',
      patientId: r.patient_id || patientFromReferral(refMap, r.referral_id),
      referralId: r.referral_id || null,
      colorKey: 'Triage Submitted',
    });
  }

  // ── Disenrollment assistance flags ───────────────────────────────────────
  for (const d of Object.values(stores.disenrollmentAssistanceFlags || {})) {
    const opener = tryActor(d.flagged_by_id || d.created_by_id);
    if (opener) {
      push(out, {
        id: `dea_${d._id || d.id}`,
        actorId: opener,
        timestamp: d.created_at || d.flagged_at,
        action: 'Disenrollment Assist Flagged',
        detail: d.reason || d.notes || '',
        patientId: d.patient_id || null,
        referralId: d.referral_id || null,
        colorKey: 'Conflict Flagged',
      });
    }
  }

  // ── OPWDD case milestones ────────────────────────────────────────────────
  for (const c of Object.values(stores.opwddCases || {})) {
    const stamps = [
      [c.opened_at, c.opened_by_id || c.created_by_id || c.assigned_enrollment_specialist_id, 'OPWDD Case Opened', null],
      [c.submission_sent_at, c.submission_sent_by_id, 'OPWDD Packet Submitted', c.submission_method],
      [c.notice_received_at, c.notice_received_by_id || c.updated_by_id, 'OPWDD Notice Received', c.eligibility_determination],
      [c.code_95_received_at, c.code_95_received_by_id || c.updated_by_id, 'OPWDD Code 95 Received', null],
      [c.converted_to_intake_at, c.converted_by_id, 'OPWDD Converted to Intake', null],
      [c.closed_at, c.closed_by_id || c.converted_by_id, 'OPWDD Case Closed', c.close_reason || c.status],
    ];
    for (const [ts, by, action, detail] of stamps) {
      const actorId = tryActor(by);
      if (!actorId || !ts) continue;
      push(out, {
        id: `opwdd_${action.replace(/\s+/g, '_')}_${c._id || c.id}`,
        actorId,
        timestamp: ts,
        action,
        detail: detail ? String(detail) : '',
        patientId: c.patient_id || null,
        referralId: c.referral_id || null,
        colorKey: 'OPWDD',
      });
    }
  }

  // ── OPWDD checklist item receipts / reviews ──────────────────────────────
  for (const item of Object.values(stores.opwddChecklistItems || {})) {
    const receiver = tryActor(item.received_by_id);
    if (receiver && item.received_at) {
      push(out, {
        id: `opwdd_chk_rcv_${item._id || item.id}`,
        actorId: receiver,
        timestamp: item.received_at,
        action: 'OPWDD Document Received',
        detail: item.label || item.item_key || item.name || '',
        patientId: item.patient_id || null,
        referralId: item.referral_id || null,
        colorKey: 'OPWDD',
      });
    }
    const reviewer = tryActor(item.reviewed_by_id);
    if (reviewer && item.reviewed_at) {
      push(out, {
        id: `opwdd_chk_rev_${item._id || item.id}`,
        actorId: reviewer,
        timestamp: item.reviewed_at,
        action: 'OPWDD Document Reviewed',
        detail: item.label || item.item_key || item.name || '',
        patientId: item.patient_id || null,
        referralId: item.referral_id || null,
        colorKey: 'OPWDD',
      });
    }
  }

  // ── Referral milestone stamps (eligibility, EMR, staffing, SOC, …) ───────
  const milestones = [
    ['eligibility_completed_at', 'eligibility_completed_by_id', 'Eligibility Completed', null],
    ['auth_obtained_at', 'auth_obtained_by_id', 'Authorization Obtained', null],
    ['emr_initial_onboarded_at', 'emr_initial_onboarded_by_id', 'Initial EMR Onboarding', 'HCHB chart created'],
    ['emr_onboarded_at', 'emr_onboarded_by_id', 'EMR Onboarding Completed', null],
    ['staffing_confirmed_at', 'staffing_confirmed_by_id', 'Staffing Confirmed', null],
    ['soc_scheduled_at', 'soc_scheduled_by_id', 'SOC Scheduled', null],
    ['clinical_review_completed_at', 'clinical_review_completed_by_id', 'Clinical RN Review Completed', null],
    ['clinical_review_pushed_at', 'clinical_review_pushed_by_id', 'Pushed to Clinical RN Review', null],
    ['f2f_date_logged_at', 'f2f_date_logged_by_id', 'F2F Document Logged', null],
    ['opwdd_route_started_at', 'opwdd_route_started_by_id', 'Routed to OPWDD', null],
    ['intake_owner_assigned_at', 'intake_owner_id', 'Intake Owner Assigned', null],
  ];
  for (const ref of Object.values(stores.referrals || {})) {
    for (const [tsKey, byKey, action, detail] of milestones) {
      const actorId = tryActor(ref[byKey]);
      const ts = ref[tsKey];
      // Intake owner assignment may only have owner id without a stamp — skip if no ts
      if (!actorId || !ts) continue;
      push(out, {
        id: `ms_${tsKey}_${ref._id || ref.id}`,
        actorId,
        timestamp: ts,
        action,
        detail: detail || (tsKey === 'soc_scheduled_at' && ref.soc_scheduled_date
          ? `SOC date: ${String(ref.soc_scheduled_date).slice(0, 10)}`
          : ''),
        patientId: ref.patient_id || null,
        referralId: ref.id || null,
        colorKey: action,
      });
    }

    // Owner assigned without dedicated timestamp — use updated_at only when owner set recently? Skip to avoid noise.
  }

  // Sort newest first; light de-dupe (same actor + action + patient + minute)
  out.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  const seen = new Set();
  const deduped = [];
  for (const e of out) {
    const minute = String(e.timestamp).slice(0, 16);
    const key = `${e.actorId}|${e.action}|${e.patientId || ''}|${minute}|${e.detail?.slice(0, 40) || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  return deduped;
}

/** Color token for a colorKey / action label. */
export function activityColor(colorKey, palette, hexToRgba) {
  const map = {
    'Referral Created': palette.accentGreen.hex,
    'Stage Change': palette.accentBlue.hex,
    'Note Added': palette.primaryMagenta.hex,
    'Note Pinned': palette.primaryMagenta.hex,
    'Task Created': palette.accentOrange.hex,
    'Task Assigned': palette.accentOrange.hex,
    'Task Scheduled': palette.accentOrange.hex,
    'Task Completed': palette.accentGreen.hex,
    'File Uploaded': palette.primaryDeepPlum.hex,
    'Patient Created': palette.accentGreen.hex,
    'Insurance Check': palette.highlightYellow.hex,
    'Triage Submitted': palette.primaryMagenta.hex,
    'Phone Call Logged': palette.accentBlue.hex,
    'Conflict Flagged': palette.accentOrange.hex,
    'Conflict Resolved': palette.accentGreen.hex,
    'Conflict Waived': palette.accentOrange.hex,
    'Eligibility Completed': palette.accentBlue.hex,
    'Authorization': palette.accentBlue.hex,
    'Authorization Obtained': palette.accentBlue.hex,
    'Clinical Review': palette.primaryMagenta.hex,
    'Clinical RN Review Completed': palette.primaryMagenta.hex,
    'Cursory Review': palette.primaryMagenta.hex,
    'SOC Scheduled': palette.accentGreen.hex,
    'Staffing Confirmed': palette.accentGreen.hex,
    'F2F Document Logged': palette.accentOrange.hex,
    'OPWDD': palette.primaryDeepPlum.hex,
    'OPWDD Case Opened': palette.primaryDeepPlum.hex,
    'Routed to OPWDD': palette.primaryDeepPlum.hex,
    'Disenrollment Assist Flagged': palette.accentOrange.hex,
    'Intake Owner Assigned': palette.accentBlue.hex,
  };
  return map[colorKey] || hexToRgba(palette.backgroundDark.hex, 0.4);
}
