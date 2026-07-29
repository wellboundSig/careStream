"""In-memory HMAC index of ACTIVE HCHB patients only."""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any

from . import hashutil
from .config import Config
from .db import connect
from .sql_queries import LOAD_ACTIVE_MRNS_SQL, LOAD_ACTIVE_PATIENTS_SQL

log = logging.getLogger('hchb-dup')


def _result(match_type: str | None, confidence: str | None) -> dict[str, Any]:
    strong = confidence == 'strong'
    soft = confidence == 'soft'
    return {
        'duplicate': strong,              # near-certain; UI may still allow override
        'possible_match': soft or strong, # soft name flag OR strong
        'confidence': confidence,         # 'soft' | 'strong' | None
        'match_type': match_type,         # 'name' | 'name_dob' | 'medicaid' | 'mrn' | None
        'allow_override': strong,         # CareStream should offer manual override
    }


@dataclass
class PatientIndex:
    pepper: str
    by_medicaid: set[str] = field(default_factory=set)
    by_mrn: set[str] = field(default_factory=set)
    by_name: set[str] = field(default_factory=set)
    by_name_dob: set[str] = field(default_factory=set)
    patient_count: int = 0
    mrn_count: int = 0
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
                return _result('medicaid', 'strong')
            if hmac_mrn and hmac_mrn in self.by_mrn:
                return _result('mrn', 'strong')
            if hmac_name_dob and hmac_name_dob in self.by_name_dob:
                return _result('name_dob', 'strong')
            if hmac_name and hmac_name in self.by_name:
                return _result('name', 'soft')
            return _result(None, None)


def build_index(cfg: Config) -> PatientIndex:
    if not cfg.pepper:
        raise RuntimeError('HCHB_LINK_PEPPER required to build patient index')

    by_medicaid: set[str] = set()
    by_mrn: set[str] = set()
    by_name: set[str] = set()
    by_name_dob: set[str] = set()
    mrn_count = 0

    t0 = time.time()
    with connect(cfg) as conn:
        cur = conn.cursor()
        cur.execute(LOAD_ACTIVE_PATIENTS_SQL)
        cols = [d[0].lower() for d in cur.description]
        patients = [dict(zip(cols, row)) for row in cur.fetchall()]

        for p in patients:
            h = hashutil.hash_medicaid(cfg.pepper, p.get('pa_medicaidnumber'))
            if h:
                by_medicaid.add(h)
            h = hashutil.hash_mrn(cfg.pepper, p.get('pa_legacymrnum'))
            if h:
                by_mrn.add(h)
            h = hashutil.hash_name(cfg.pepper, p.get('pa_lastname'), p.get('pa_firstname'))
            if h:
                by_name.add(h)
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
                by_name_dob.add(h)

        cur.execute(LOAD_ACTIVE_MRNS_SQL)
        for _epi_paid, mrn in cur.fetchall():
            h = hashutil.hash_mrn(cfg.pepper, mrn)
            if h:
                by_mrn.add(h)
                mrn_count += 1

    idx = PatientIndex(
        pepper=cfg.pepper,
        by_medicaid=by_medicaid,
        by_mrn=by_mrn,
        by_name=by_name,
        by_name_dob=by_name_dob,
        patient_count=len(patients),
        mrn_count=mrn_count,
        loaded_at=time.time(),
    )
    log.info(
        'ACTIVE patient index: patients=%s mrn_rows=%s medicaid=%s mrn=%s name=%s name_dob=%s in %.1fs',
        idx.patient_count, mrn_count, len(by_medicaid), len(by_mrn), len(by_name), len(by_name_dob),
        time.time() - t0,
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
