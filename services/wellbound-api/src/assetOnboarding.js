/**
 * assetOnboarding.js — HR onboarding → asset management intake.
 *
 * Called by the HR onboarding Apps Script (code.gs) via
 * POST /internal/asset-onboarding/intake (x-internal-key guarded).
 *
 * For each new hire it:
 *   1. Creates (or reuses) the informational AssetMgtUsers record.
 *   2. Creates an AssetMgtOnboardingRequests row with a unique token.
 *   3. Emails the hiring manager a link to the request form at
 *      https://support.wellboundcarestream.com/onboarding-request/<token>
 *      through the existing Resend notify worker (NOT Gmail) — env
 *      NOTIFY_WORKER_URL. If the worker is unreachable the intake still
 *      succeeds and the link is returned so HR can forward it manually.
 *
 * Body:
 *   { firstName, lastName, title, staffType, entity, startDate, email,
 *     managerName, managerEmail, entryId }
 */

import crypto from 'node:crypto';
import { query } from './db.js';
import { createRecords } from './records.js';

const FORM_BASE = (process.env.ASSET_REQUEST_FORM_BASE
  || 'https://support.wellboundcarestream.com/onboarding-request').replace(/\/$/, '');

function mapStaffType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s.startsWith('clinician') || s === 'field') return 'FIELD';
  return 'OFFICE';
}

function isoDate(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

async function sendManagerEmail({ managerName, managerEmail, hireName, hireTitle, link }) {
  const workerUrl = (process.env.NOTIFY_WORKER_URL || '').replace(/\/$/, '');
  if (!workerUrl) return { sent: false, reason: 'NOTIFY_WORKER_URL not set' };

  const greeting = managerName ? `Hello ${managerName},` : 'Hello,';
  const titlePart = hireTitle ? ` (${hireTitle})` : '';
  const body = [
    greeting,
    '',
    `${hireName}${titlePart} is being onboarded. As the hiring manager, please complete their software and hardware request form:`,
    '',
    link,
    '',
    `The form requires your Wellbound sign in. ${hireName} has already been onboarded into Empeon and Microsoft 365, so those do not need to be requested.`,
    '',
    'Wellbound IT',
  ].join('\n');

  try {
    const res = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: [managerEmail],
        cc: [],
        subject: `Hardware and software requests for ${hireName}`,
        body,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { sent: false, reason: `notify worker ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { sent: true, id: data.id || null };
  } catch (err) {
    return { sent: false, reason: String(err && err.message || err) };
  }
}

export async function runAssetOnboardingIntake(body) {
  const firstName = String(body?.firstName || '').trim();
  const lastName = String(body?.lastName || '').trim();
  const name = `${firstName} ${lastName}`.trim();
  const managerEmail = String(body?.managerEmail || '').trim().toLowerCase();
  const managerName = String(body?.managerName || '').trim();
  const title = String(body?.title || '').trim();
  const staffType = mapStaffType(body?.staffType);
  const entity = String(body?.entity || '').trim();
  const startDate = isoDate(body?.startDate);
  const email = String(body?.email || '').trim();
  const entryId = String(body?.entryId || '').trim();

  if (!name) return { ok: false, error: 'firstName / lastName required' };

  // 1. Asset user — reuse an existing active record with the same name +
  // staff type (HR re-submissions must not create duplicates).
  let userRecId = null;
  try {
    const { rows } = await query(
      `SELECT rec_id FROM asset_mgt_users
        WHERE LOWER(TRIM(name)) = $1 AND staff_type = $2
        LIMIT 1`,
      [name.toLowerCase(), staffType],
    );
    userRecId = rows?.[0]?.rec_id || null;
  } catch { /* lookup is best-effort; fall through to create */ }

  if (!userRecId) {
    const created = await createRecords('AssetMgtUsers', {
      fields: {
        first_name: firstName,
        last_name: lastName,
        name,
        staff_type: staffType,
        ...(staffType === 'FIELD' ? { discipline: title } : { title }),
        ...(email ? { email } : {}),
        status: 'Active',
        ...(startDate ? { hire_date: startDate } : {}),
        source: 'ONBOARDING',
      },
    });
    userRecId = created.id;
    // Stamp id = rec_id (same convention as Tickets) so formula filters work.
    await query('UPDATE asset_mgt_users SET id = rec_id WHERE rec_id = $1 AND id IS NULL', [userRecId]);
  }

  // 2. Onboarding request with a unique link token. If HR re-submits the
  // same entry, reuse the existing PENDING request instead of minting a new
  // link (the old email would otherwise dead-end).
  let token = null;
  let requestRecId = null;
  if (entryId) {
    try {
      const { rows } = await query(
        `SELECT rec_id, token FROM asset_mgt_onboarding_requests
          WHERE source_entry_id = $1 AND status = 'PENDING'
          LIMIT 1`,
        [entryId],
      );
      if (rows?.[0]) { requestRecId = rows[0].rec_id; token = rows[0].token; }
    } catch { /* fall through to create */ }
  }

  if (!requestRecId) {
    token = crypto.randomBytes(16).toString('hex');
    const created = await createRecords('AssetMgtOnboardingRequests', {
      fields: {
        token,
        new_hire_first_name: firstName,
        new_hire_last_name: lastName,
        new_hire_name: name,
        new_hire_title: title,
        staff_type: staffType,
        ...(entity ? { entity } : {}),
        ...(startDate ? { start_date: startDate } : {}),
        hiring_manager_name: managerName,
        hiring_manager_email: managerEmail,
        status: 'PENDING',
        asset_user_id: [userRecId],
        ...(entryId ? { source_entry_id: entryId } : {}),
      },
    });
    requestRecId = created.id;
    await query('UPDATE asset_mgt_onboarding_requests SET id = rec_id WHERE rec_id = $1 AND id IS NULL', [requestRecId]);
  }

  const link = `${FORM_BASE}/${token}`;

  // 3. Email the hiring manager (best-effort — never fail the intake).
  let emailResult = { sent: false, reason: 'no manager email provided' };
  if (managerEmail) {
    emailResult = await sendManagerEmail({
      managerName, managerEmail, hireName: name, hireTitle: title, link,
    });
  }

  return {
    ok: true,
    userRecId,
    requestRecId,
    token,
    link,
    email: emailResult,
  };
}
