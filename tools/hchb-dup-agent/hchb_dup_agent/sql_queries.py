"""Canonical HCHB logship SQL for duplicate checks.

Identity:  dbo.CLIENTS_ALL
MRNs:      dbo.CLIENT_EPISODES_ALL (epi_paid → pa_id)

IMPORTANT (learned from live data):
  CLIENT_EPISODE_STATUSES.epist_active is Y for ALL statuses including
  DISCHARGED / DELETED / NON-ADMIT — it does NOT mean "patient is active".
  Use epi_status allowlist instead.
"""

# Episode statuses that mean the patient is currently on the books.
# Exclude: DISCHARGED, DELETED, NON-ADMIT
ACTIVE_EPISODE_STATUSES = ('CURRENT', 'PENDING', 'HOLD', 'RECERTIFIED')

_ACTIVE_IN = ", ".join(f"'{s}'" for s in ACTIVE_EPISODE_STATUSES)

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

LIVE_CHECK_SQL = f"""
SELECT TOP 1 match_type, confidence
FROM (
  SELECT 'medicaid' AS match_type, 'strong' AS confidence, 1 AS pri
  FROM dbo.CLIENTS_ALL AS c WITH (NOLOCK)
  WHERE ? <> ''
    AND EXISTS (
      SELECT 1 FROM dbo.CLIENT_EPISODES_ALL AS e WITH (NOLOCK)
      WHERE e.epi_paid = c.pa_id
        AND UPPER(LTRIM(RTRIM(ISNULL(e.epi_status, '')))) IN ({_ACTIVE_IN})
    )
    AND UPPER(REPLACE(LTRIM(RTRIM(ISNULL(c.pa_medicaidnumber, ''))), ' ', '')) = ?

  UNION ALL

  SELECT 'mrn' AS match_type, 'strong' AS confidence, 2 AS pri
  FROM dbo.CLIENT_EPISODES_ALL AS e WITH (NOLOCK)
  WHERE ? <> ''
    AND UPPER(LTRIM(RTRIM(ISNULL(e.epi_status, '')))) IN ({_ACTIVE_IN})
    AND UPPER(REPLACE(LTRIM(RTRIM(ISNULL(e.epi_mrnum, ''))), ' ', '')) = ?

  UNION ALL

  SELECT 'name_dob' AS match_type, 'strong' AS confidence, 3 AS pri
  FROM dbo.CLIENTS_ALL AS c WITH (NOLOCK)
  WHERE ? <> ''
    AND c.pa_dob IS NOT NULL
    AND CAST(c.pa_dob AS date) = CAST(? AS date)
    AND UPPER(LTRIM(RTRIM(c.pa_lastname))) = ?
    AND UPPER(LTRIM(RTRIM(c.pa_firstname))) = ?
    AND EXISTS (
      SELECT 1 FROM dbo.CLIENT_EPISODES_ALL AS e WITH (NOLOCK)
      WHERE e.epi_paid = c.pa_id
        AND UPPER(LTRIM(RTRIM(ISNULL(e.epi_status, '')))) IN ({_ACTIVE_IN})
    )

  UNION ALL

  SELECT 'name' AS match_type, 'soft' AS confidence, 4 AS pri
  FROM dbo.CLIENTS_ALL AS c WITH (NOLOCK)
  WHERE ? <> ''
    AND UPPER(LTRIM(RTRIM(c.pa_lastname))) = ?
    AND UPPER(LTRIM(RTRIM(c.pa_firstname))) = ?
    AND EXISTS (
      SELECT 1 FROM dbo.CLIENT_EPISODES_ALL AS e WITH (NOLOCK)
      WHERE e.epi_paid = c.pa_id
        AND UPPER(LTRIM(RTRIM(ISNULL(e.epi_status, '')))) IN ({_ACTIVE_IN})
    )
) AS hits
ORDER BY pri
"""

LOAD_PATIENTS_SQL = LOAD_ACTIVE_PATIENTS_SQL
LOAD_MRNS_SQL = LOAD_ACTIVE_MRNS_SQL
