"""In-memory HMAC index of recent HCHB SOC/ROC visits."""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any

from . import hashutil
from .config import Config
from .db import connect
from .sql_queries import build_load_visit_identity_sql, build_load_visits_sql
from .visit_match import classify_visit_kind, empty_unmatched, match_candidate

log = logging.getLogger('hchb-dup')


def _iso(value: Any) -> str:
    if value is None:
        return ''
    if hasattr(value, 'strftime'):
        return value.strftime('%Y-%m-%d')
    s = str(value).strip()
    return s[:10] if s else ''


@dataclass
class VisitIndex:
    pepper: str
    by_name_dob: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    by_name: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    visit_count: int = 0
    soc_count: int = 0
    roc_count: int = 0
    loaded_at: float = 0.0
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def match_candidates(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        with self._lock:
            out: list[dict[str, Any]] = []
            for raw in candidates or []:
                token = str(raw.get('token') or '')
                if not token:
                    continue
                hmac_name_dob = str(raw.get('hmac_name_dob') or '')
                hmac_name = str(raw.get('hmac_name') or '')
                strong = list(self.by_name_dob.get(hmac_name_dob) or []) if hmac_name_dob else []
                soft = list(self.by_name.get(hmac_name) or []) if hmac_name else []
                if not strong and not soft:
                    out.append(empty_unmatched(token, 'no_match'))
                    continue
                out.append(match_candidate(
                    token=token,
                    visit_kind=str(raw.get('visit_kind') or ''),
                    scheduled_date=str(raw.get('scheduled_date') or ''),
                    strong_visits=strong,
                    soft_visits=soft,
                ))
            return out


def _append(store: dict[str, list[dict[str, Any]]], key: str, row: dict[str, Any]) -> None:
    if not key:
        return
    bucket = store.setdefault(key, [])
    bucket.append(row)


def _identity_maps(rows: list[dict[str, Any]]) -> tuple[dict[tuple[str, str], list[str]], dict[tuple[str, str], list[str]]]:
    """(last, first) and (last, first_token) → DOB list."""
    full: dict[tuple[str, str], list[str]] = {}
    token: dict[tuple[str, str], list[str]] = {}
    for p in rows:
        last = hashutil.normalize_name(p.get('pa_lastname'))
        first = hashutil.normalize_name(p.get('pa_firstname'))
        dob = _iso(p.get('pa_dob'))
        if not last or not first or not dob:
            continue
        full.setdefault((last, first), []).append(dob)
        ft = hashutil.first_token(first)
        if ft:
            token.setdefault((last, ft), []).append(dob)
    return full, token


def build_visit_index(cfg: Config) -> VisitIndex:
    if not cfg.pepper:
        raise RuntimeError('HCHB_LINK_PEPPER required to build visit index')

    by_name_dob: dict[str, list[dict[str, Any]]] = {}
    by_name: dict[str, list[dict[str, Any]]] = {}
    visit_count = 0
    soc_count = 0
    roc_count = 0

    t0 = time.time()
    with connect(cfg) as conn:
        cur = conn.cursor()
        cur.execute(build_load_visit_identity_sql())
        id_cols = [d[0].lower() for d in cur.description]
        identity_rows = [dict(zip(id_cols, row)) for row in cur.fetchall()]
        by_full, by_token = _identity_maps(identity_rows)

        cur.execute(build_load_visits_sql())
        v_cols = [d[0].lower() for d in cur.description]
        visits = [dict(zip(v_cols, row)) for row in cur.fetchall()]

    for v in visits:
        kind = classify_visit_kind(v.get('visit_type'))
        if kind not in {'SOC', 'ROC'}:
            continue
        visit_date = _iso(v.get('visit_date'))
        if not visit_date:
            continue
        payload = {
            'visit_date': visit_date,
            'visit_kind': kind,
            'visit_type': str(v.get('visit_type') or '')[:40],
        }
        visit_count += 1
        if kind == 'SOC':
            soc_count += 1
        else:
            roc_count += 1

        last, first = hashutil.parse_hchb_client_name(v.get('client_name'))
        if not last or not first:
            continue
        last_n = hashutil.normalize_name(last)
        first_n = hashutil.first_token(first)
        name_hash = hashutil.hash_name(cfg.pepper, last_n, first_n)
        _append(by_name, name_hash, payload)

        dobs = list(by_full.get((last_n, hashutil.normalize_name(first))) or [])
        dobs.extend(by_token.get((last_n, first_n)) or [])
        seen_dob = set()
        for dob in dobs:
            if dob in seen_dob:
                continue
            seen_dob.add(dob)
            _append(by_name_dob, hashutil.hash_name_dob(cfg.pepper, last_n, first_n, dob), payload)

    idx = VisitIndex(
        pepper=cfg.pepper,
        by_name_dob=by_name_dob,
        by_name=by_name,
        visit_count=visit_count,
        soc_count=soc_count,
        roc_count=roc_count,
        loaded_at=time.time(),
    )
    log.info(
        'visit index: visits=%s soc=%s roc=%s name=%s name_dob=%s in %.1fs',
        visit_count, soc_count, roc_count, len(by_name), len(by_name_dob), time.time() - t0,
    )
    return idx


class RefreshingVisitIndex:
    def __init__(self, cfg: Config, refresh_seconds: float = 300.0):
        self.cfg = cfg
        self.refresh_seconds = refresh_seconds
        self._index = build_visit_index(cfg)
        self._lock = threading.Lock()

    def get(self) -> VisitIndex:
        with self._lock:
            if time.time() - self._index.loaded_at >= self.refresh_seconds:
                try:
                    self._index = build_visit_index(self.cfg)
                except Exception:
                    log.exception('visit index refresh failed; keeping previous')
            return self._index

    def match_candidates(self, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self.get().match_candidates(candidates)
