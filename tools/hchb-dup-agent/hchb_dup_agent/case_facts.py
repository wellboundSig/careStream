"""Latest-episode facts attached to an HCHB duplicate match.

Returned over the bridge as `hchb_case`. No names, SSN, MRN, or DOB —
only case status and dates staff need to decide whether to open a new chart.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


ACTIVE_STATUSES = frozenset({'CURRENT', 'PENDING', 'HOLD', 'RECERTIFIED'})
DISCHARGED_STATUSES = frozenset({'DISCHARGED'})
NON_ADMIT_STATUSES = frozenset({'NON-ADMIT', 'NONADMIT', 'NON_ADMIT'})
IGNORED_STATUSES = frozenset({'DELETED'})


def normalize_status(value: Any) -> str:
    return str(value or '').upper().strip()


def case_status_for(episode_status: Any, *, has_active_episode: bool = False) -> str:
    if has_active_episode:
        return 'active'
    status = normalize_status(episode_status)
    if status in ACTIVE_STATUSES:
        return 'active'
    if status in DISCHARGED_STATUSES:
        return 'discharged'
    if status in NON_ADMIT_STATUSES:
        return 'non_admit'
    if status:
        return 'other'
    return 'unknown'


def iso_date(value: Any) -> str | None:
    if value is None or value == '':
        return None
    if hasattr(value, 'strftime'):
        return value.strftime('%Y-%m-%d')
    s = str(value).strip()
    if len(s) >= 10 and s[4] == '-' and s[7] == '-':
        return s[:10]
    return s or None


@dataclass(frozen=True)
class CaseFacts:
    case_status: str
    episode_status: str | None
    episode_start: str | None
    discharged_on: str | None
    has_active_episode: bool
    episode_count: int = 0

    @classmethod
    def from_row(cls, row: dict[str, Any] | None) -> 'CaseFacts | None':
        if not row:
            return None
        status = normalize_status(row.get('episode_status') or row.get('epi_status'))
        has_active = bool(row.get('has_active_episode'))
        if not has_active and status in ACTIVE_STATUSES:
            has_active = True
        count = row.get('episode_count')
        try:
            count_i = int(count or 0)
        except (TypeError, ValueError):
            count_i = 0
        return cls(
            case_status=case_status_for(status, has_active_episode=has_active),
            episode_status=status or None,
            episode_start=iso_date(row.get('episode_start')),
            discharged_on=iso_date(row.get('discharged_on')),
            has_active_episode=has_active,
            episode_count=count_i,
        )

    def rank(self) -> tuple:
        """Higher wins when two patients share a hash (prefer active, then recent)."""
        tier = 2 if self.has_active_episode else (1 if self.case_status == 'discharged' else 0)
        recent = self.discharged_on or self.episode_start or ''
        return (tier, recent, self.episode_count)

    def to_dict(self) -> dict[str, Any]:
        return {
            'case_status': self.case_status,
            'episode_status': self.episode_status,
            'episode_start': self.episode_start,
            'discharged_on': self.discharged_on,
            'has_active_episode': bool(self.has_active_episode),
            'episode_count': int(self.episode_count or 0),
        }


def keep_better(current: CaseFacts | None, incoming: CaseFacts | None) -> CaseFacts | None:
    if incoming is None:
        return current
    if current is None or incoming.rank() > current.rank():
        return incoming
    return current


def sanitize_hchb_case(raw: Any) -> dict[str, Any]:
    """Bridge / DynamoDB payload — no None values."""
    if not isinstance(raw, dict):
        return {}
    status = normalize_status(raw.get('episode_status'))
    has_active = bool(raw.get('has_active_episode'))
    try:
        count = int(raw.get('episode_count') or 0)
    except (TypeError, ValueError):
        count = 0
    case_status = str(raw.get('case_status') or '').strip().lower()
    if case_status not in {'active', 'discharged', 'non_admit', 'other', 'unknown'}:
        case_status = case_status_for(status, has_active_episode=has_active)
    return {
        'case_status': case_status,
        'episode_status': status,
        'episode_start': iso_date(raw.get('episode_start')) or '',
        'discharged_on': iso_date(raw.get('discharged_on')) or '',
        'has_active_episode': has_active,
        'episode_count': count,
    }


def match_result(
    match_type: str | None,
    confidence: str | None,
    facts: CaseFacts | None = None,
) -> dict[str, Any]:
    strong = confidence == 'strong'
    soft = confidence == 'soft'
    has_active = bool(facts and facts.has_active_episode)
    former = bool(strong and facts and not has_active)
    return {
        'duplicate': bool(strong and has_active),
        'possible_match': bool(soft or strong),
        'former_patient': former,
        'confidence': confidence,
        'match_type': match_type,
        'allow_override': bool(strong and has_active),
        'hchb_case': facts.to_dict() if facts else None,
    }
