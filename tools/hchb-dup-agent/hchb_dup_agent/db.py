"""SQL Server helpers: ping + live plaintext duplicate check."""
from __future__ import annotations

from typing import Any

import pyodbc

from .config import Config, odbc_conn_str
from . import hashutil
from .case_facts import CaseFacts, match_result
from .sql_queries import (
    ACTIVE_EPISODE_STATUSES,
    EPISODE_COLUMNS_SQL,
    build_case_facts_sql,
    build_find_match_sql,
    pick_episode_date_columns,
)


def connect(cfg: Config) -> pyodbc.Connection:
    return pyodbc.connect(odbc_conn_str(cfg), timeout=30)


def ping(cfg: Config) -> str:
    with connect(cfg) as conn:
        cur = conn.cursor()
        cur.execute('SELECT DB_NAME(), @@SERVERNAME, SYSTEM_USER')
        db, server, user = cur.fetchone()
        return f'{server} / {db} as {user}'


def discover_episode_date_columns(cur) -> tuple[str | None, str | None]:
    cur.execute(EPISODE_COLUMNS_SQL)
    names = [row[0] for row in cur.fetchall()]
    return pick_episode_date_columns(names)


def _fetch_case_facts(cur, pa_id: Any) -> CaseFacts | None:
    soc_col, dc_col = discover_episode_date_columns(cur)
    cur.execute(build_case_facts_sql(soc_col, dc_col), (pa_id,))
    row = cur.fetchone()
    if not row:
        return None
    cols = [d[0].lower() for d in cur.description]
    return CaseFacts.from_row(dict(zip(cols, row)))


def inspect_name(cfg: Config, last_name: str, first_name: str) -> dict[str, Any]:
    """Show raw CLIENTS_ALL hits for a name — with and without active filter."""
    last_n = hashutil.normalize_name(last_name)
    first_n = hashutil.normalize_name(first_name)
    active_in = ", ".join(f"'{s}'" for s in ACTIVE_EPISODE_STATUSES)
    sql = f"""
    SELECT
      c.pa_id,
      c.pa_lastname,
      c.pa_firstname,
      CONVERT(varchar(10), c.pa_dob, 23) AS pa_dob,
      c.pa_status,
      c.pa_archivestatus,
      c.pa_legacymrnum,
      CASE WHEN EXISTS (
        SELECT 1
        FROM dbo.CLIENT_EPISODES_ALL AS e WITH (NOLOCK)
        WHERE e.epi_paid = c.pa_id
          AND UPPER(LTRIM(RTRIM(ISNULL(e.epi_status, '')))) IN ({active_in})
      ) THEN 1 ELSE 0 END AS has_active_episode,
      (
        SELECT COUNT(*)
        FROM dbo.CLIENT_EPISODES_ALL AS e2 WITH (NOLOCK)
        WHERE e2.epi_paid = c.pa_id
      ) AS episode_count,
      (
        SELECT TOP 1 e4.epi_status
        FROM dbo.CLIENT_EPISODES_ALL AS e4 WITH (NOLOCK)
        WHERE e4.epi_paid = c.pa_id
        ORDER BY
          CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(e4.epi_status, '')))) IN ({active_in}) THEN 0 ELSE 1 END,
          e4.epi_id DESC
      ) AS latest_episode_status
    FROM dbo.CLIENTS_ALL AS c WITH (NOLOCK)
    WHERE UPPER(LTRIM(RTRIM(c.pa_lastname))) = ?
      AND UPPER(LTRIM(RTRIM(c.pa_firstname))) = ?
    ORDER BY c.pa_id
    """
    # Also last-name-only near matches (spelling help)
    near_sql = """
    SELECT TOP 20
      c.pa_lastname, c.pa_firstname,
      CONVERT(varchar(10), c.pa_dob, 23) AS pa_dob,
      c.pa_status
    FROM dbo.CLIENTS_ALL AS c WITH (NOLOCK)
    WHERE UPPER(LTRIM(RTRIM(c.pa_lastname))) = ?
    ORDER BY c.pa_firstname
    """
    with connect(cfg) as conn:
        cur = conn.cursor()
        soc_col, dc_col = discover_episode_date_columns(cur)
        cur.execute(sql, (last_n, first_n))
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]

        cur.execute(near_sql, (last_n,))
        near_cols = [d[0] for d in cur.description]
        near = [dict(zip(near_cols, row)) for row in cur.fetchall()]

        cur.execute("""
          SELECT e.epi_status, COUNT(*) AS episode_rows
          FROM dbo.CLIENT_EPISODES_ALL AS e WITH (NOLOCK)
          GROUP BY e.epi_status
          ORDER BY episode_rows DESC
        """)
        status_cols = [d[0] for d in cur.description]
        statuses = [dict(zip(status_cols, row)) for row in cur.fetchall()]

        cur.execute('SELECT COUNT(*) FROM dbo.CLIENTS_ALL WITH (NOLOCK)')
        total_clients = cur.fetchone()[0]
        cur.execute(f"""
          SELECT COUNT(*) FROM dbo.CLIENTS_ALL AS c WITH (NOLOCK)
          WHERE EXISTS (
            SELECT 1 FROM dbo.CLIENT_EPISODES_ALL AS e WITH (NOLOCK)
            WHERE e.epi_paid = c.pa_id
              AND UPPER(LTRIM(RTRIM(ISNULL(e.epi_status, '')))) IN ({active_in})
          )
        """)
        active_clients = cur.fetchone()[0]

    return {
        'queried': {'last': last_n, 'first': first_n},
        'active_statuses_used': list(ACTIVE_EPISODE_STATUSES),
        'episode_date_columns': {'soc': soc_col, 'discharge': dc_col},
        'matches_in_CLIENTS_ALL': rows,
        'match_count': len(rows),
        'would_soft_flag_active_only': any(r.get('has_active_episode') for r in rows),
        'same_lastname_sample': near,
        'totals': {
            'CLIENTS_ALL': total_clients,
            'active_episode_patients': active_clients,
        },
        'episode_status_breakdown': statuses,
    }


def check_duplicate_live(
    cfg: Config,
    *,
    medicaid: str | None = None,
    mrn: str | None = None,
    last_name: str | None = None,
    first_name: str | None = None,
    dob: str | None = None,
    ssn: str | None = None,  # accepted but unused — CareStream does not collect SSN
) -> dict[str, Any]:
    """Plaintext live check. Closet PC / CLI only. Includes discharged patients."""
    med_n = hashutil.normalize_medicaid(medicaid)
    mrn_n = hashutil.normalize_mrn(mrn)
    last_n = hashutil.normalize_name(last_name)
    first_n = hashutil.normalize_name(first_name)
    dob_n = hashutil.normalize_dob(dob)

    # Param order matches FIND_MATCH_SQL unions:
    # medicaid×2, mrn×2, name_dob (flag, dob, last, first), name (flag, last, first)
    name_ready = '1' if (last_n and first_n) else ''
    dob_ready = '1' if (last_n and first_n and dob_n) else ''
    params = (
        med_n, med_n,
        mrn_n, mrn_n,
        dob_ready, dob_n, last_n, first_n,
        name_ready, last_n, first_n,
    )
    with connect(cfg) as conn:
        cur = conn.cursor()
        cur.execute(build_find_match_sql(), params)
        row = cur.fetchone()
        if not row:
            return match_result(None, None, None)
        match_type, confidence, pa_id = str(row[0]), str(row[1]), row[2]
        facts = _fetch_case_facts(cur, pa_id)
        return match_result(match_type, confidence, facts)
