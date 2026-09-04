"""SOC/ROC visit matching against HCHB visit-report rows.

Matching rules (CareStream mass-complete tool):
  - Identity is HMAC only (name / name+DOB). No names leave this PC.
  - Visit kind must be SOC or ROC and must equal the scheduled episode type.
  - Visit date may be ±1 calendar day from the CareStream scheduled date
    (HCHB often posts a day late).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable

DATE_WINDOW_DAYS = 1

_RESUME_RE = re.compile(r'RESUMPT')
_START_OF_CARE_RE = re.compile(r'START\s*OF\s*CARE')


def classify_visit_kind(visit_type: str | None) -> str | None:
    """Map an HCHB Visit Type / service code to SOC, ROC, or None."""
    raw = str(visit_type or '').upper()
    if not raw.strip():
        return None
    if _RESUME_RE.search(raw):
        return 'ROC'
    if _START_OF_CARE_RE.search(raw):
        return 'SOC'
    tokens = [t for t in re.split(r'[^A-Z0-9]+', raw) if t]
    if any(t == 'ROC' or t.endswith('ROC') for t in tokens):
        return 'ROC'
    if any(t == 'SOC' or t.endswith('SOC') for t in tokens):
        return 'SOC'
    return None


def parse_iso_date(value: Any) -> date | None:
    if value is None or value == '':
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', s)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def day_offset(scheduled: date, visit: date) -> int:
    return (visit - scheduled).days


def in_date_window(scheduled: date, visit: date, plus_minus: int = DATE_WINDOW_DAYS) -> bool:
    return abs(day_offset(scheduled, visit)) <= plus_minus


@dataclass(frozen=True)
class VisitHit:
    visit_date: str
    visit_kind: str
    visit_type: str
    day_offset: int
    confidence: str  # strong | soft

    def as_match(self, token: str, status: str = 'match') -> dict[str, Any]:
        return {
            'token': token,
            'matched': status == 'match',
            'status': status,
            'confidence': self.confidence,
            'visit_kind': self.visit_kind,
            'visit_date': self.visit_date,
            'visit_type': self.visit_type,
            'day_offset': self.day_offset,
        }


def _score(hit: VisitHit) -> tuple[int, int]:
    """Prefer exact date, then smaller offset, then strong over soft."""
    return (abs(hit.day_offset), 0 if hit.confidence == 'strong' else 1)


def pick_best_hit(hits: Iterable[VisitHit]) -> VisitHit | None:
    ranked = sorted(hits, key=_score)
    return ranked[0] if ranked else None


def match_candidate(
    *,
    token: str,
    visit_kind: str,
    scheduled_date: str,
    strong_visits: list[dict[str, Any]],
    soft_visits: list[dict[str, Any]],
    window_days: int = DATE_WINDOW_DAYS,
) -> dict[str, Any]:
    """Pick the best HCHB visit for one CareStream candidate.

    strong_visits / soft_visits items: visit_date, visit_kind, visit_type
    """
    scheduled = parse_iso_date(scheduled_date)
    kind = str(visit_kind or '').upper().strip()
    if kind not in {'SOC', 'ROC'} or scheduled is None:
        return {
            'token': token,
            'matched': False,
            'status': 'skipped',
            'confidence': '',
            'visit_kind': '',
            'visit_date': '',
            'visit_type': '',
            'day_offset': None,
        }

    def collect(rows: list[dict[str, Any]], confidence: str) -> tuple[list[VisitHit], list[VisitHit]]:
        same: list[VisitHit] = []
        other: list[VisitHit] = []
        for row in rows or []:
            vdate = parse_iso_date(row.get('visit_date'))
            vkind = str(row.get('visit_kind') or '')
            if not vdate or vkind not in {'SOC', 'ROC'}:
                continue
            if not in_date_window(scheduled, vdate, window_days):
                continue
            hit = VisitHit(
                visit_date=vdate.isoformat(),
                visit_kind=vkind,
                visit_type=str(row.get('visit_type') or '')[:40],
                day_offset=day_offset(scheduled, vdate),
                confidence=confidence,
            )
            (same if vkind == kind else other).append(hit)
        return same, other

    same_strong, other_strong = collect(strong_visits, 'strong')
    same_soft, other_soft = collect(soft_visits, 'soft')

    best = pick_best_hit(same_strong) or pick_best_hit(same_soft)
    if best:
        return best.as_match(token, 'match')

    mismatch = pick_best_hit(other_strong) or pick_best_hit(other_soft)
    if mismatch:
        return mismatch.as_match(token, 'kind_mismatch')

    return {
        'token': token,
        'matched': False,
        'status': 'no_match',
        'confidence': '',
        'visit_kind': '',
        'visit_date': '',
        'visit_type': '',
        'day_offset': None,
    }


def empty_unmatched(token: str, status: str = 'no_match') -> dict[str, Any]:
    return {
        'token': token,
        'matched': False,
        'status': status,
        'confidence': '',
        'visit_kind': '',
        'visit_date': '',
        'visit_type': '',
        'day_offset': None,
    }
