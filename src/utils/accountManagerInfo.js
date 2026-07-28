// Account manager info — nurse notes @mention routing into the SOC Completed
// Pending Log “Account manager info” column. Entries append; never overwrite.

import { getStore } from '../store/careStore.js';
import { updateReferralOptimistic } from '../store/mutations.js';
import {
  ACCOUNT_MANAGER_INFO_MENTION_ID,
  mentionMentionsAccountManagerInfo,
  MENTION_TOKEN_RE,
} from './mentions.js';

/**
 * Strip mention tokens and collapse whitespace for the log body.
 * @param {string} content
 * @returns {string}
 */
export function noteBodyForAccountManagerLog(content) {
  if (!content) return '';
  return String(content)
    .replace(MENTION_TOKEN_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * @param {object} args
 * @param {string} args.body
 * @param {string} [args.authorName]
 * @param {string|Date} [args.at]
 * @returns {string}
 */
export function formatAccountManagerEntry({ body, authorName, at }) {
  const when = at ? new Date(at) : new Date();
  const stamp = Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  const who = (authorName || 'Staff').trim() || 'Staff';
  const header = [stamp, who].filter(Boolean).join(' · ');
  return header ? `${header}\n${body}` : body;
}

/**
 * @param {string|null|undefined} existing
 * @param {string} entry
 * @returns {string}
 */
export function appendAccountManagerInfo(existing, entry) {
  const prev = String(existing || '').trim();
  const next = String(entry || '').trim();
  if (!next) return prev;
  if (!prev) return next;
  return `${prev}\n\n${next}`;
}

/**
 * Resolve which referral row should receive the AM log for a patient note.
 * Prefers the open referral context; else newest referral for the patient.
 */
function resolveReferralTarget(referral, patientId) {
  if (referral?._id) return referral;
  if (!patientId) return null;
  const rows = Object.values(getStore().referrals || {})
    .filter((r) => r?.patient_id === patientId && r._id)
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
  return rows[0] || null;
}

/**
 * If the note mentions Account manager info, append the note body to the
 * referral’s `account_manager_info` field. No-op when the special mention
 * is absent or there is no referral to write to.
 *
 * @param {object} args
 * @param {string} args.content
 * @param {object|null} [args.referral]
 * @param {string|null} [args.patientId]
 * @param {string} [args.actorName]
 * @returns {Promise<boolean>} true when an append was attempted
 */
export async function routeNoteToAccountManagerInfo({
  content,
  referral = null,
  patientId = null,
  actorName = '',
}) {
  if (!mentionMentionsAccountManagerInfo(content)) return false;
  const body = noteBodyForAccountManagerLog(content);
  if (!body) return false;

  const target = resolveReferralTarget(referral, patientId);
  if (!target?._id) {
    console.warn('[accountManagerInfo] mention present but no referral to write');
    return false;
  }

  const entry = formatAccountManagerEntry({
    body,
    authorName: actorName,
    at: new Date().toISOString(),
  });
  const next = appendAccountManagerInfo(target.account_manager_info, entry);
  await updateReferralOptimistic(target._id, { account_manager_info: next });
  return true;
}

export { ACCOUNT_MANAGER_INFO_MENTION_ID };
