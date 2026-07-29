#!/usr/bin/env python3
"""List tables/columns that look like patient identifiers on logship.

Run once on the closet PC after ODBC + .env work:
  python discover_schema.py
"""
from __future__ import annotations

import sys

from hchb_dup_agent.config import load_config
from hchb_dup_agent.db import connect

KEYWORDS = (
    'ssn', 'social', 'mrn', 'medical_record', 'patient', 'dob', 'birth',
    'first_name', 'last_name', 'fname', 'lname', 'client',
)


def main() -> int:
    cfg = load_config()
    print('Connected:', end=' ')
    with connect(cfg) as conn:
        cur = conn.cursor()
        cur.execute('SELECT DB_NAME(), @@SERVERNAME')
        print(cur.fetchone())
        cur.execute("""
            SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
            ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
        """)
        rows = cur.fetchall()

    hits = []
    for schema, table, col, dtype in rows:
        blob = f'{schema}.{table}.{col}'.lower()
        if any(k in blob for k in KEYWORDS):
            hits.append((schema, table, col, dtype))

    print(f'\nIdentifier-ish columns ({len(hits)}):')
    current = None
    for schema, table, col, dtype in hits:
        key = f'{schema}.{table}'
        if key != current:
            print(f'\n[{key}]')
            current = key
        print(f'  {col} ({dtype})')

    print('\nNext: create dbo.CareStreamDupIndex and a populate job from the')
    print('patient table that holds SSN/MRN/name/DOB. See scripts/build_hash_index.sql.example')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())