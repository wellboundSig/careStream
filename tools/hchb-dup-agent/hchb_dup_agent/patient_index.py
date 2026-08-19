"""In-memory HMAC index of HCHB patients (active + discharged)."""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any

from . import hashutil
from .case_facts import CaseFacts, keep_better, match_result
from .config import Config
from .db import connect, discover_episode_date_columns
from .sql_queries import build_load_mrns_sql, build_load_patients_sql

log = logging.getLogger('hchb-dup')


@dataclass
class PatientIndex:
    pepper: str
    by_medicaid: dict[str, CaseFacts] = field(default_factory=dict)
    by_mrn: dict[str, CaseFacts] = field(default_factory=dict)
    by_name: dict[str, CaseFacts] = field(default_factory=dict)
    by_name_dob: dict[str, CaseFacts] = field(default_factory=dict)
    patient_count: int = 0
    mrn_count: int = 0
    active_count: int = 0
    loaded_at: float = 0.0
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def lookup(
        self,
        *,
        hmac_medicaid: str = '',
        hmac_mrn: str = '',
        hmac_name: str = '',
        hmac_name_dob: str = '',
        hmac_ssn: str = '',  # ignored — CareStream does not collect SSN
    ) -> dict[str, Any]:
        with self._lock:
            if hmac_medicaid and hmac_medicaid in self.by_medicaid:
                return match_result('medicaid', 'strong', self.by_medicaid[hmac_medicaid])
            if hmac_mrn and hmac_mrn in self.by_mrn:
                return match_result('mrn', 'strong', self.by_mrn[hmac_mrn])
            if hmac_name_dob and hmac_name_dob in self.by_name_dob:
                return match_result('name_dob', 'strong', self.by_name_dob[hmac_name_dob])
            if hmac_name and hmac_name in self.by_name:
                return match_result('name', 'soft', self.by_name[hmac_name])
            return match_result(None, None, None)


def _put(store: dict[str, CaseFacts], key: str, facts: CaseFacts) -> None:
    store[key] = keep_better(store.get(key), facts) or facts


def build_index(cfg: Config) -> PatientIndex:
    if not cfg.pepper:
        raise RuntimeError('HCHB_LINK_PEPPER required to build patient index')

    by_medicaid: dict[str, CaseFacts] = {}
    by_mrn: dict[str, CaseFacts] = {}
    by_name: dict[str, CaseFacts] = {}
    by_name_dob: dict[str, CaseFacts] = {}
    mrn_count = 0
    active_count = 0
    facts_by_pa: dict[Any, CaseFacts] = {}

    t0 = time.time()
    with connect(cfg) as conn:
        cur = conn.cursor()
        soc_col, dc_col = discover_episode_date_columns(cur)
        log.info('episode date columns: soc=%s dc=%s', soc_col, dc_col)

        cur.execute(build_load_patients_sql(soc_col, dc_col))
        cols = [d[0].lower() for d in cur.description]
        patients = [dict(zip(cols, row)) for row in cur.fetchall()]

        for p in patients:
            facts = CaseFacts.from_row(p)
            if not facts:
                continue
            if facts.has_active_episode:
                active_count += 1
            facts_by_pa[p.get('pa_id')] = facts

            h = hashutil.hash_medicaid(cfg.pepper, p.get('pa_medicaidnumber'))
            if h:
                _put(by_medicaid, h, facts)
            h = hashutil.hash_mrn(cfg.pepper, p.get('pa_legacymrnum'))
            if h:
                _put(by_mrn, h, facts)
            h = hashutil.hash_name(cfg.pepper, p.get('pa_lastname'), p.get('pa_firstname'))
            if h:
                _put(by_name, h, facts)
            dob_raw = p.get('pa_dob')
            if hasattr(dob_raw, 'strftime'):
                dob_raw = dob_raw.strftime('%Y-%m-%d')
            h = hashutil.hash_name_dob(
                cfg.pepper,
                p.get('pa_lastname'),
                p.get('pa_firstname'),
                str(dob_raw or '') or None,
            )
            if h:
                _put(by_name_dob, h, facts)

        cur.execute(build_load_mrns_sql())
        for epi_paid, mrn in cur.fetchall():
            facts = facts_by_pa.get(epi_paid)
            if not facts:
                continue
            h = hashutil.hash_mrn(cfg.pepper, mrn)
            if h:
                _put(by_mrn, h, facts)
                mrn_count += 1

    idx = PatientIndex(
        pepper=cfg.pepper,
        by_medicaid=by_medicaid,
        by_mrn=by_mrn,
        by_name=by_name,
        by_name_dob=by_name_dob,
        patient_count=len(patients),
        mrn_count=mrn_count,
        active_count=active_count,
        loaded_at=time.time(),
    )
    log.info(
        'patient index: patients=%s active=%s mrn_rows=%s medicaid=%s mrn=%s name=%s name_dob=%s in %.1fs',
        idx.patient_count, active_count, mrn_count, len(by_medicaid), len(by_mrn),
        len(by_name), len(by_name_dob), time.time() - t0,
    )
    return idx


class RefreshingIndex:
    def __init__(self, cfg: Config, refresh_seconds: float = 300.0):
        self.cfg = cfg
        self.refresh_seconds = refresh_seconds
        self._index = build_index(cfg)
        self._lock = threading.Lock()

    def get(self) -> PatientIndex:
        with self._lock:
            if time.time() - self._index.loaded_at >= self.refresh_seconds:
                try:
                    self._index = build_index(self.cfg)
                except Exception:
                    log.exception('index refresh failed; keeping previous')
            return self._index

    def lookup(self, **kwargs) -> dict[str, Any]:
        return self.get().lookup(**kwargs)
