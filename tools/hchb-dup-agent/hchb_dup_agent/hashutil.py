"""Privacy-preserving identifier hashing (HMAC-SHA256).

Cloud / wifi only ever sees these digests + a boolean result.
Pepper lives on trusted endpoints only (this agent + CareStream backend later).
"""
from __future__ import annotations

import hashlib
import hmac
import re


def normalize_name(value: str | None) -> str:
    if not value:
        return ''
    s = value.upper().strip()
    s = re.sub(r'[^A-Z0-9 ]+', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def first_token(value: str | None) -> str:
    """First word of a normalized name — 'JOHN MICHAEL' → 'JOHN'."""
    n = normalize_name(value)
    if not n:
        return ''
    return n.split()[0]


def parse_hchb_client_name(value: str | None) -> tuple[str, str]:
    """HCHB visit-report client names are 'LAST, FIRST' (optional middle)."""
    s = (value or '').strip()
    if not s:
        return '', ''
    if ',' in s:
        last, rest = s.split(',', 1)
        return last.strip(), first_token(rest)
    parts = s.split()
    if len(parts) >= 2:
        return parts[0].strip(), first_token(parts[1])
    return s, ''


def normalize_ssn(value: str | None) -> str:
    if not value:
        return ''
    digits = re.sub(r'\D+', '', str(value))
    return digits


def normalize_mrn(value: str | None) -> str:
    if not value:
        return ''
    return re.sub(r'[^A-Z0-9]+', '', str(value).upper().strip())


def normalize_dob(value: str | None) -> str:
    """Accept YYYY-MM-DD, MM/DD/YYYY, YYYYMMDD, or SQL datetime → YYYY-MM-DD."""
    if not value:
        return ''
    s = str(value).strip()
    # datetime / datetime2 string from SQL: "1942-02-18 00:00:00" or with T
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', s)
    if m:
        return f'{m.group(1)}-{m.group(2)}-{m.group(3)}'
    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})', s)
    if m:
        mm, dd, yyyy = m.groups()
        return f'{yyyy}-{int(mm):02d}-{int(dd):02d}'
    digits = re.sub(r'\D+', '', s)
    # take date portion only if time digits trail (YYYYMMDDHHMMSS…)
    if len(digits) >= 8:
        digits = digits[:8]
        return f'{digits[0:4]}-{digits[4:6]}-{digits[6:8]}'
    return ''


def hmac_hex(pepper: str, material: str) -> str:
    if not pepper:
        raise RuntimeError('HCHB_LINK_PEPPER is required for hashing')
    if not material:
        return ''
    digest = hmac.new(
        pepper.encode('utf-8'),
        material.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()
    return digest


def hash_ssn(pepper: str, ssn: str | None) -> str:
    n = normalize_ssn(ssn)
    return hmac_hex(pepper, f'SSN|{n}') if n else ''


def hash_mrn(pepper: str, mrn: str | None) -> str:
    n = normalize_mrn(mrn)
    return hmac_hex(pepper, f'MRN|{n}') if n else ''


def normalize_medicaid(value: str | None) -> str:
    if not value:
        return ''
    return re.sub(r'[^A-Z0-9]+', '', str(value).upper().strip())


def hash_medicaid(pepper: str, medicaid: str | None) -> str:
    n = normalize_medicaid(medicaid)
    return hmac_hex(pepper, f'MEDICAID|{n}') if n else ''


def hash_name(pepper: str, last_name: str | None, first_name: str | None) -> str:
    """Soft match key — last + first only (no DOB)."""
    last = normalize_name(last_name)
    first = normalize_name(first_name)
    if not last or not first:
        return ''
    return hmac_hex(pepper, f'NAME|{last}|{first}')


def hash_name_dob(pepper: str, last_name: str | None, first_name: str | None, dob: str | None) -> str:
    """Strong match key — last + first + DOB."""
    last = normalize_name(last_name)
    first = normalize_name(first_name)
    d = normalize_dob(dob)
    if not last or not first or not d:
        return ''
    material = f'NAMEDOB|{last}|{first}|{d}'
    return hmac_hex(pepper, material)