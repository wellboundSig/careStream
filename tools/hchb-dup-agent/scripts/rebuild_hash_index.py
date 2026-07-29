#!/usr/bin/env python3
"""Rebuild dbo.CareStreamDupIndex from a source patient table on logship.

Edit SOURCE_SQL below (or set HCHB_DUP_SOURCE_SQL) to return:
  ssn, mrn, last_name, first_name, dob

Usage on closet PC:
  python scripts/rebuild_hash_index.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from hchb_dup_agent import hashutil
from hchb_dup_agent.config import load_config
from hchb_dup_agent.db import connect

# REPLACE column/table names after running discover_schema.py
DEFAULT_SOURCE_SQL = """
SELECT TOP 500000
  CAST(NULL AS varchar(32)) AS ssn,
  CAST(NULL AS varchar(64)) AS mrn,
  CAST(NULL AS varchar(128)) AS last_name,
  CAST(NULL AS varchar(128)) AS first_name,
  CAST(NULL AS date) AS dob
FROM dbo.YourPatientTable WITH (NOLOCK)
WHERE 1 = 0
"""


def main() -> int:
    cfg = load_config()
    if not cfg.pepper:
        print('HCHB_LINK_PEPPER required', file=sys.stderr)
        return 2

    source_sql = os.environ.get('HCHB_DUP_SOURCE_SQL', DEFAULT_SOURCE_SQL).strip()
    with connect(cfg) as conn:
        cur = conn.cursor()
        cur.execute("""
            IF OBJECT_ID('dbo.CareStreamDupIndex', 'U') IS NULL
            BEGIN
              CREATE TABLE dbo.CareStreamDupIndex (
                hmac_ssn char(64) NULL,
                hmac_mrn char(64) NULL,
                hmac_name_dob char(64) NULL,
                updated_at datetime2 NOT NULL CONSTRAINT DF_CareStreamDupIndex_updated DEFAULT sysutcdatetime()
              );
            END
        """)
        conn.commit()

        print('Reading source rows…')
        cur.execute(source_sql)
        cols = [d[0].lower() for d in cur.description]
        rows = cur.fetchall()
        print(f'  {len(rows)} rows')

        print('Truncating + inserting hashes…')
        cur.execute('TRUNCATE TABLE dbo.CareStreamDupIndex')
        batch = []
        for row in rows:
            data = dict(zip(cols, row))
            batch.append((
                hashutil.hash_ssn(cfg.pepper, data.get('ssn')) or None,
                hashutil.hash_mrn(cfg.pepper, data.get('mrn')) or None,
                hashutil.hash_name_dob(
                    cfg.pepper,
                    data.get('last_name'),
                    data.get('first_name'),
                    str(data.get('dob') or '') or None,
                ) or None,
            ))
            if len(batch) >= 1000:
                cur.executemany(
                    'INSERT INTO dbo.CareStreamDupIndex (hmac_ssn, hmac_mrn, hmac_name_dob) VALUES (?, ?, ?)',
                    batch,
                )
                batch.clear()
        if batch:
            cur.executemany(
                'INSERT INTO dbo.CareStreamDupIndex (hmac_ssn, hmac_mrn, hmac_name_dob) VALUES (?, ?, ?)',
                batch,
            )
        conn.commit()
        cur.execute('SELECT COUNT(*) FROM dbo.CareStreamDupIndex')
        print('Done. Index rows:', cur.fetchone()[0])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())