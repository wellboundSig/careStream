// Per-directory permission helpers.
//
// Each directory page (Marketers, Facilities, Physicians, Referral Sources,
// Clinicians, Campaigns) is independently grantable with view / create / edit
// permissions. These helpers also fall back to the legacy org-wide directory
// keys (directory.view / directory.create / directory.edit) so older saved
// permission sets keep working until they're reconfigured granularly.

import { PERMISSION_KEYS as K } from './permissionKeys.js';

export const DIRECTORY_IDS = [
  'marketers',
  'facilities',
  'physicians',
  'referral_sources',
  'clinicians',
  'campaigns',
];

export const DIRECTORY_PERMS = {
  marketers:        { view: K.DIRECTORY_MARKETERS_VIEW,        create: K.DIRECTORY_MARKETERS_CREATE,        edit: K.DIRECTORY_MARKETERS_EDIT },
  facilities:       { view: K.DIRECTORY_FACILITIES_VIEW,       create: K.DIRECTORY_FACILITIES_CREATE,       edit: K.DIRECTORY_FACILITIES_EDIT },
  physicians:       { view: K.DIRECTORY_PHYSICIANS_VIEW,       create: K.DIRECTORY_PHYSICIANS_CREATE,       edit: K.DIRECTORY_PHYSICIANS_EDIT },
  referral_sources: { view: K.DIRECTORY_REFERRAL_SOURCES_VIEW, create: K.DIRECTORY_REFERRAL_SOURCES_CREATE, edit: K.DIRECTORY_REFERRAL_SOURCES_EDIT },
  clinicians:       { view: K.DIRECTORY_CLINICIANS_VIEW,       create: K.DIRECTORY_CLINICIANS_CREATE,       edit: K.DIRECTORY_CLINICIANS_EDIT },
  campaigns:        { view: K.DIRECTORY_CAMPAIGNS_VIEW,        create: K.DIRECTORY_CAMPAIGNS_CREATE,        edit: K.DIRECTORY_CAMPAIGNS_EDIT },
};

export function canViewDirectory(can, dir) {
  const p = DIRECTORY_PERMS[dir];
  return !!p && (can(p.view) || can(K.DIRECTORY_VIEW));
}

export function canCreateDirectory(can, dir) {
  const p = DIRECTORY_PERMS[dir];
  return !!p && (can(p.create) || can(K.DIRECTORY_CREATE));
}

export function canEditDirectory(can, dir) {
  const p = DIRECTORY_PERMS[dir];
  return !!p && (can(p.edit) || can(K.DIRECTORY_EDIT));
}
