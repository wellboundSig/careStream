"""Canonical HCHB logship SQL for duplicate checks.

Identity:  dbo.CLIENTS_ALL
MRNs:      dbo.CLIENT_EPISODES_ALL (epi_paid → pa_id)

IMPORTANT (learned from live data):
  CLIENT_EPISODE_STATUSES.epist_active is Y for ALL statuses including
  DISCHARGED / DELETED / NON-ADMIT — it does NOT mean "patient is active".
  Use epi_status allowlist instead.

Matches now include discharged (and other non-deleted) patients so staff can
see the latest episode and a discharge date. DELETED episodes are ignored.
"""
from __future__ import annotations

from .case_facts import ACTIVE_STATUSES, IGNORED_STATUSES

# Episode statuses that mean the patient is currently on the books.
# Exclude: DISCHARGED, DELETED, NON-ADMIT
ACTIVE_EPISODE_STATUSES = tuple(sorted(ACTIVE_STATUSES))

_ACTIVE_IN = ", ".join(f"'{s}'" for s in ACTIVE_EPISODE_STATUSES)
_IGNORED_IN = ", ".join(f"'{s}'" for s in sorted(IGNORED_STATUSES))

SOC_COLUMN_CANDIDATES = (
    'epi_socdate',
    'epi_soc_date',
    'epi_startdate',
    'epi_start_date',
    'epi_admitdate',
    'epi_admit_date',
    'epi_fromdate',
    'epi_from_date',
)
DC_COLUMN_CANDIDATES = (
    'epi_dcdate',
    'epi_dc_date',
    'epi_dischargedate',
    'epi_discharge_date',
    'epi_dischdate',
    'epi_disch_date',
    'epi_enddate',
    'epi_end_date',
    'epi_todate',
    'epi_to_date',
)

EPISODE_COLUMNS_SQL = """
SELECT COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = 'CLIENT_EPISODES_ALL'
"""


def pick_episode_date_columns(column_names: list[str] | set[str]) -> tuple[str | None, str | None]:
    cols = {str(c).lower() for c in column_names}
    soc = next((c for c in SOC_COLUMN_CANDIDATES if c in cols), None)
    dc = next((c for c in DC_COLUMN_CANDIDATES if c in cols), None)
    return soc, dc


def _date_select(alias: str, column: str | None, as_name: str) -> str:
    if not column:
        return f"CAST(NULL AS varchar(10)) AS {as_name}"
    return f"CONVERT(varchar(10), {alias}.{column}, 23) AS {as_name}"


def _latest_episode_apply(soc_col: str | None, dc_col: str | None) -> str:
    """OUTER APPLY: prefer an active episode, else the newest non-deleted one."""
    soc = _date_select('e', soc_col, 'episode_start')
    dc = _date_select('e', dc_col, 'discharged_on')
    return f"""
OUTER APPLY (
  SELECT TOP 1
    e.epi_status AS episode_status,
    {soc},
    {dc}
  FROM dbo.CLIENT_EPISODES_ALL AS e WITH (NOLOCK)
  WHERE e.epi_paid = c.pa_id
    AND UPPER(LTRIM(RTRIM(ISNULL(e.epi_status, '')))) NOT IN ({_IGNORED_IN})
  ORDER BY
    CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(e.epi_status, '')))) IN ({_ACTIVE_IN}) THEN 0 ELSE 1 END,
    e.epi_id DESC
) AS latest
"""


def _has_any_episode_exists() -> str:
    return f"""
EXISTS (
  SELECT 1
  FROM dbo.CLIENT_EPISODES_ALL AS e WITH (NOLOCK)
  WHERE e.epi_paid = c.pa_id
    AND UPPER(LTRIM(RTRIM(ISNULL(e.epi_status, '')))) NOT IN ({_IGNORED_IN})
)
"""


def _has_active_select(alias: str = 'c') -> str:
    return f"""
CASE WHEN EXISTS (
  SELECT 1
  FROM dbo.CLIENT_EPISODES_ALL AS ea WITH (NOLOCK)
  WHERE ea.epi_paid = {alias}.pa_id
    AND UPPER(LTRIM(RTRIM(ISNULL(ea.epi_status, '')))) IN ({_ACTIVE_IN})
) THEN 1 ELSE 0 END
"""


def _episode_count_select(alias: str = 'c') -> str:
    return f"""
(
  SELECT COUNT(*)
  FROM dbo.CLIENT_EPISODES_ALL AS ec WITH (NOLOCK)
  WHERE ec.epi_paid = {alias}.pa_id
    AND UPPER(LTRIM(RTRIM(ISNULL(ec.epi_status, '')))) NOT IN ({_IGNORED_IN})
)
"""


def build_load_patients_sql(soc_col: str | None, dc_col: str | None) -> str:
    apply = _latest_episode_apply(soc_col, dc_col)
    return f"""
SELECT
  c.pa_id,
  c.pa_medicaidnumber,
  c.pa_lastname,
  c.pa_firstname,
  CONVERT(varchar(10), c.pa_dob, 23) AS pa_dob,
  c.pa_legacymrnum,
  c.pa_status,
  latest.episode_status,
  latest.episode_start,
  latest.discharged_on,
  {_has_active_select('c')} AS has_active_episode,
  {_episode_count_select('c')} AS episode_count
FROM dbo.CLIENTS_ALL AS c WITH (NOLOCK)
{apply}
WHERE {_has_any_episode_exists()}
"""


def build_load_mrns_sql() -> str:
    return f"""
SELECT
  e.epi_paid,
  e.epi_mrnum
FROM dbo.CLIENT_EPISODES_ALL AS e WITH (NOLOCK)
WHERE e.epi_mrnum IS NOT NULL
  AND LTRIM(RTRIM(e.epi_mrnum)) <> ''
  AND UPPER(LTRIM(RTRIM(ISNULL(e.epi_status, '')))) NOT IN ({_IGNORED_IN})
"""


def build_find_match_sql() -> str:
    """Best identity hit (any non-deleted episode). Prefers active when names collide."""
    return f"""
SELECT TOP 1 match_type, confidence, pa_id
FROM (
  SELECT 'medicaid' AS match_type, 'strong' AS confidence, 1 AS pri, c.pa_id,
         {_has_active_select('c')} AS has_active
  FROM dbo.CLIENTS_ALL AS c WITH (NOLOCK)
  WHERE ? <> ''
    AND {_has_any_episode_exists()}
    AND UPPER(REPLACE(LTRIM(RTRIM(ISNULL(c.pa_medicaidnumber, ''))), ' ', '')) = ?

  UNION ALL

  SELECT 'mrn' AS match_type, 'strong' AS confidence, 2 AS pri, e.epi_paid AS pa_id,
         CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(e.epi_status, '')))) IN ({_ACTIVE_IN}) THEN 1 ELSE 0 END AS has_active
  FROM dbo.CLIENT_EPISODES_ALL AS e WITH (NOLOCK)
  WHERE ? <> ''
    AND UPPER(LTRIM(RTRIM(ISNULL(e.epi_status, '')))) NOT IN ({_IGNORED_IN})
    AND UPPER(REPLACE(LTRIM(RTRIM(ISNULL(e.epi_mrnum, ''))), ' ', '')) = ?

  UNION ALL

  SELECT 'name_dob' AS match_type, 'strong' AS confidence, 3 AS pri, c.pa_id,
         {_has_active_select('c')} AS has_active
  FROM dbo.CLIENTS_ALL AS c WITH (NOLOCK)
  WHERE ? <> ''
    AND c.pa_dob IS NOT NULL
    AND CAST(c.pa_dob AS date) = CAST(? AS date)
    AND UPPER(LTRIM(RTRIM(c.pa_lastname))) = ?
    AND UPPER(LTRIM(RTRIM(c.pa_firstname))) = ?
    AND {_has_any_episode_exists()}

  UNION ALL

  SELECT 'name' AS match_type, 'soft' AS confidence, 4 AS pri, c.pa_id,
         {_has_active_select('c')} AS has_active
  FROM dbo.CLIENTS_ALL AS c WITH (NOLOCK)
  WHERE ? <> ''
    AND UPPER(LTRIM(RTRIM(c.pa_lastname))) = ?
    AND UPPER(LTRIM(RTRIM(c.pa_firstname))) = ?
    AND {_has_any_episode_exists()}
) AS hits
ORDER BY pri, has_active DESC, pa_id DESC
"""


def build_case_facts_sql(soc_col: str | None, dc_col: str | None) -> str:
    apply = _latest_episode_apply(soc_col, dc_col)
    return f"""
SELECT
  latest.episode_status,
  latest.episode_start,
  latest.discharged_on,
  {_has_active_select('c')} AS has_active_episode,
  {_episode_count_select('c')} AS episode_count
FROM dbo.CLIENTS_ALL AS c WITH (NOLOCK)
{apply}
WHERE c.pa_id = ?
"""


# Back-compat aliases used by inspect / older scripts (active-only snapshot).
LOAD_ACTIVE_PATIENTS_SQL = f"""
SELECT
  c.pa_id,
  c.pa_medicaidnumber,
  c.pa_lastname,
  c.pa_firstname,
  CONVERT(varchar(10), c.pa_dob, 23) AS pa_dob,
  c.pa_legacymrnum,
  c.pa_status
FROM dbo.CLIENTS_ALL AS c WITH (NOLOCK)
WHERE EXISTS (
  SELECT 1
  FROM dbo.CLIENT_EPISODES_ALL AS e WITH (NOLOCK)
  WHERE e.epi_paid = c.pa_id
    AND UPPER(LTRIM(RTRIM(ISNULL(e.epi_status, '')))) IN ({_ACTIVE_IN})
)
"""

LOAD_ACTIVE_MRNS_SQL = f"""
SELECT
  e.epi_paid,
  e.epi_mrnum
FROM dbo.CLIENT_EPISODES_ALL AS e WITH (NOLOCK)
WHERE e.epi_mrnum IS NOT NULL
  AND LTRIM(RTRIM(e.epi_mrnum)) <> ''
  AND UPPER(LTRIM(RTRIM(ISNULL(e.epi_status, '')))) IN ({_ACTIVE_IN})
"""

LOAD_PATIENTS_SQL = LOAD_ACTIVE_PATIENTS_SQL
LOAD_MRNS_SQL = LOAD_ACTIVE_MRNS_SQL
LIVE_CHECK_SQL = build_find_match_sql()

# SOC/ROC visit matching — V_AGENTVISITTIMEREPORT (logship).
# Client is the patient. HHA/HA visits are excluded (SOC/ROC are skilled).
VISIT_LOOKBACK_DAYS = 120
VISIT_FORWARD_DAYS = 7


def build_load_visits_sql(lookback_days: int = VISIT_LOOKBACK_DAYS, forward_days: int = VISIT_FORWARD_DAYS) -> str:
    lookback = max(1, int(lookback_days))
    forward = max(0, int(forward_days))
    return f"""
SELECT
  t.[Client Name] AS client_name,
  t.[Visit Type] AS visit_type,
  CONVERT(varchar(10), t.[Visit Date], 23) AS visit_date,
  t.[Discipline] AS discipline,
  t.[Visit Number] AS visit_number
FROM V_AGENTVISITTIMEREPORT t WITH (NOLOCK)
WHERE t.[Visit Date] IS NOT NULL
  AND t.[Visit Date] >= DATEADD(day, -{lookback}, CAST(GETDATE() AS date))
  AND t.[Visit Date] <= DATEADD(day, {forward}, CAST(GETDATE() AS date))
  AND UPPER(LTRIM(RTRIM(ISNULL(t.[Discipline], '')))) NOT IN ('HHA', 'HA')
"""


def build_load_visit_identity_sql() -> str:
    """Last / first / DOB for hashing visit rows. First-token matching is in Python."""
    return """
SELECT
  c.pa_lastname,
  c.pa_firstname,
  CONVERT(varchar(10), c.pa_dob, 23) AS pa_dob
FROM dbo.CLIENTS_ALL AS c WITH (NOLOCK)
WHERE c.pa_lastname IS NOT NULL
  AND c.pa_firstname IS NOT NULL
"""
