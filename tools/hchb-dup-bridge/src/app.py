"""API Gateway handlers: enqueue hashed jobs, agent claim/result, status poll.

Inbound bodies must never include raw name/DOB — only HMAC hex digests.
Results may include latest-episode case facts (status + dates) or SOC/ROC
visit-match flags (date / kind / service code). No names, SSN, MRN, or DOB
from HCHB. CareStream does not collect SSN; soft=name, strong=name+DOB.
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from decimal import Decimal
from typing import Any

import boto3

ddb = boto3.resource('dynamodb')
sqs = boto3.client('sqs')

TABLE = os.environ['JOBS_TABLE']
QUEUE_URL = os.environ['QUEUE_URL']
AGENT_TOKEN = os.environ.get('AGENT_TOKEN', '')
CARESTREAM_TOKEN = os.environ.get('CARESTREAM_TOKEN', '')
JOB_TTL_HOURS = int(os.environ.get('JOB_TTL_HOURS', '24'))
MAX_CANDIDATES = 200

table = ddb.Table(TABLE)
_TOKEN_RE = re.compile(r'^[A-Za-z0-9._:-]{1,80}$')
_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _resp(status: int, body: dict[str, Any] | None = None) -> dict:
    return {
        'statusCode': status,
        'headers': {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
        },
        'body': json.dumps(body or {}, default=_json_default),
    }


def _json_default(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError(type(obj))


def _bearer(event) -> str:
    auth = (event.get('headers') or {}).get('authorization') or (event.get('headers') or {}).get('Authorization') or ''
    if auth.lower().startswith('bearer '):
        return auth.split(' ', 1)[1].strip()
    return ''


def _body(event) -> dict:
    raw = event.get('body') or '{}'
    if event.get('isBase64Encoded'):
        import base64
        raw = base64.b64decode(raw).decode('utf-8')
    data = json.loads(raw) if raw else {}
    if not isinstance(data, dict):
        raise ValueError('body must be object')
    return data


def _valid_hmac(val: str) -> bool:
    return len(val) == 64 and all(c in '0123456789abcdef' for c in val.lower())


def _sanitize_hchb_case(raw: Any) -> dict[str, Any]:
    """Status + dates only. Never persist names / MRN / SSN / DOB."""
    if not isinstance(raw, dict):
        return {}
    status = str(raw.get('episode_status') or '').upper().strip()[:40]
    case_status = str(raw.get('case_status') or '').lower().strip()
    if case_status not in {'active', 'discharged', 'non_admit', 'other', 'unknown'}:
        case_status = ''
    start = str(raw.get('episode_start') or '')[:10]
    dc = str(raw.get('discharged_on') or '')[:10]
    try:
        count = int(raw.get('episode_count') or 0)
    except (TypeError, ValueError):
        count = 0
    return {
        'case_status': case_status,
        'episode_status': status,
        'episode_start': start,
        'discharged_on': dc,
        'has_active_episode': bool(raw.get('has_active_episode')),
        'episode_count': count,
    }


def _sanitize_candidates(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw[:MAX_CANDIDATES]:
        if not isinstance(item, dict):
            continue
        token = str(item.get('token') or '')
        if not _TOKEN_RE.match(token) or token in seen:
            continue
        kind = str(item.get('visit_kind') or '').upper().strip()
        if kind not in {'SOC', 'ROC'}:
            continue
        scheduled = str(item.get('scheduled_date') or '')[:10]
        if not _DATE_RE.match(scheduled):
            continue
        hmac_name = str(item.get('hmac_name') or '').lower()
        hmac_name_dob = str(item.get('hmac_name_dob') or '').lower()
        if hmac_name and not _valid_hmac(hmac_name):
            continue
        if hmac_name_dob and not _valid_hmac(hmac_name_dob):
            continue
        if not hmac_name and not hmac_name_dob:
            continue
        seen.add(token)
        row: dict[str, Any] = {
            'token': token,
            'visit_kind': kind,
            'scheduled_date': scheduled,
        }
        if hmac_name:
            row['hmac_name'] = hmac_name
        if hmac_name_dob:
            row['hmac_name_dob'] = hmac_name_dob
        out.append(row)
    return out


def _sanitize_matches(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    allowed_status = {
        'match', 'no_match', 'kind_mismatch', 'skipped', 'soft_match',
    }
    out: list[dict[str, Any]] = []
    for item in raw[:MAX_CANDIDATES]:
        if not isinstance(item, dict):
            continue
        token = str(item.get('token') or '')
        if not _TOKEN_RE.match(token):
            continue
        status = str(item.get('status') or '').lower().strip()
        if status not in allowed_status:
            status = 'match' if item.get('matched') else 'no_match'
        conf = str(item.get('confidence') or '').lower().strip()
        if conf not in {'strong', 'soft'}:
            conf = ''
        kind = str(item.get('visit_kind') or '').upper().strip()
        if kind not in {'SOC', 'ROC'}:
            kind = ''
        vdate = str(item.get('visit_date') or '')[:10]
        if vdate and not _DATE_RE.match(vdate):
            vdate = ''
        offset_raw = item.get('day_offset')
        try:
            offset = int(offset_raw) if offset_raw is not None and offset_raw != '' else None
        except (TypeError, ValueError):
            offset = None
        if offset is not None and abs(offset) > 7:
            offset = None
        row: dict[str, Any] = {
            'token': token,
            'matched': bool(item.get('matched')) and status == 'match',
            'status': status,
            'confidence': conf,
            'visit_kind': kind,
            'visit_date': vdate,
            'visit_type': str(item.get('visit_type') or '')[:40],
        }
        if offset is not None:
            row['day_offset'] = offset
        out.append(row)
    return out


def create_job(event, context):
    if CARESTREAM_TOKEN and _bearer(event) != CARESTREAM_TOKEN:
        return _resp(401, {'error': 'unauthorized'})
    try:
        data = _body(event)
    except Exception as exc:
        return _resp(400, {'error': str(exc)})

    kind = str(data.get('kind') or 'dup').lower().strip()
    if kind not in {'dup', 'visit_check'}:
        return _resp(400, {'error': 'kind must be dup or visit_check'})

    hmac_medicaid = str(data.get('hmac_medicaid') or '')
    hmac_mrn = str(data.get('hmac_mrn') or '')
    hmac_name = str(data.get('hmac_name') or '')
    hmac_name_dob = str(data.get('hmac_name_dob') or '')
    candidates = _sanitize_candidates(data.get('candidates')) if kind == 'visit_check' else []

    if kind == 'visit_check':
        if not candidates:
            return _resp(400, {'error': 'visit_check requires candidates'})
    elif not any((hmac_medicaid, hmac_mrn, hmac_name, hmac_name_dob)):
        return _resp(400, {'error': 'at least one hmac_* required'})

    for key, val in (
        ('hmac_medicaid', hmac_medicaid),
        ('hmac_mrn', hmac_mrn),
        ('hmac_name', hmac_name),
        ('hmac_name_dob', hmac_name_dob),
    ):
        if val and not _valid_hmac(val):
            return _resp(400, {'error': f'{key} must be 64-char hex hmac'})

    job_id = str(uuid.uuid4())
    now = int(time.time())
    item = {
        'job_id': job_id,
        'kind': kind,
        'status': 'pending',
        'hmac_medicaid': hmac_medicaid,
        'hmac_mrn': hmac_mrn,
        'hmac_name': hmac_name,
        'hmac_name_dob': hmac_name_dob,
        'candidates': candidates,
        'matches': [],
        'created_at': now,
        'expires_at': now + JOB_TTL_HOURS * 3600,
        'duplicate': False,
        'possible_match': False,
        'former_patient': False,
        'confidence': '',
        'match_type': '',
        'allow_override': False,
        'hchb_case': {},
        'error': '',
    }
    table.put_item(Item=item)
    sqs.send_message(
        QueueUrl=QUEUE_URL,
        MessageBody=json.dumps({
            'job_id': job_id,
            'kind': kind,
            'hmac_medicaid': hmac_medicaid,
            'hmac_mrn': hmac_mrn,
            'hmac_name': hmac_name,
            'hmac_name_dob': hmac_name_dob,
            'candidates': candidates,
        }),
    )
    return _resp(201, {'job_id': job_id, 'status': 'pending', 'kind': kind})


def get_job(event, context):
    if CARESTREAM_TOKEN and _bearer(event) != CARESTREAM_TOKEN:
        return _resp(401, {'error': 'unauthorized'})
    job_id = (event.get('pathParameters') or {}).get('job_id')
    if not job_id:
        return _resp(400, {'error': 'job_id required'})
    item = table.get_item(Key={'job_id': job_id}).get('Item')
    if not item:
        return _resp(404, {'error': 'not found'})
    return _resp(200, {
        'job_id': item['job_id'],
        'kind': item.get('kind') or 'dup',
        'status': item.get('status'),
        'duplicate': item.get('duplicate'),
        'possible_match': item.get('possible_match'),
        'former_patient': item.get('former_patient'),
        'confidence': item.get('confidence') or None,
        'match_type': item.get('match_type') or None,
        'allow_override': item.get('allow_override'),
        'hchb_case': item.get('hchb_case') or {},
        'matches': item.get('matches') or [],
        'error': item.get('error') or None,
        'created_at': item.get('created_at'),
        'completed_at': item.get('completed_at'),
    })


def agent_claim(event, context):
    if not AGENT_TOKEN or _bearer(event) != AGENT_TOKEN:
        return _resp(401, {'error': 'unauthorized'})
    try:
        data = _body(event)
    except Exception:
        data = {}
    wait = int(data.get('wait_seconds') or 20)
    wait = max(0, min(20, wait))
    resp = sqs.receive_message(
        QueueUrl=QUEUE_URL,
        MaxNumberOfMessages=1,
        WaitTimeSeconds=wait,
        VisibilityTimeout=90,
    )
    msgs = resp.get('Messages') or []
    if not msgs:
        return {'statusCode': 204, 'body': ''}
    m = msgs[0]
    body = json.loads(m['Body'])
    job_id = body['job_id']
    table.update_item(
        Key={'job_id': job_id},
        UpdateExpression='SET #s = :running, claimed_at = :t, receipt_handle = :rh',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={
            ':running': 'running',
            ':t': int(time.time()),
            ':rh': m['ReceiptHandle'],
        },
    )
    sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=m['ReceiptHandle'])
    stored = table.get_item(Key={'job_id': job_id}).get('Item') or {}
    return _resp(200, {
        'job_id': job_id,
        'kind': stored.get('kind') or body.get('kind') or 'dup',
        'hmac_medicaid': stored.get('hmac_medicaid') or body.get('hmac_medicaid') or '',
        'hmac_mrn': stored.get('hmac_mrn') or body.get('hmac_mrn') or '',
        'hmac_name': stored.get('hmac_name') or body.get('hmac_name') or '',
        'hmac_name_dob': stored.get('hmac_name_dob') or body.get('hmac_name_dob') or '',
        'candidates': stored.get('candidates') or body.get('candidates') or [],
    })


def agent_result(event, context):
    if not AGENT_TOKEN or _bearer(event) != AGENT_TOKEN:
        return _resp(401, {'error': 'unauthorized'})
    try:
        data = _body(event)
    except Exception as exc:
        return _resp(400, {'error': str(exc)})
    job_id = data.get('job_id')
    if not job_id:
        return _resp(400, {'error': 'job_id required'})
    error = data.get('error')
    status = 'error' if error else 'done'
    matches = _sanitize_matches(data.get('matches')) if not error else []
    table.update_item(
        Key={'job_id': job_id},
        UpdateExpression=(
            'SET #s = :st, duplicate = :d, possible_match = :pm, former_patient = :fp, '
            'confidence = :c, match_type = :m, allow_override = :ao, hchb_case = :hc, '
            'matches = :mt, #e = :err, completed_at = :t'
        ),
        ExpressionAttributeNames={'#s': 'status', '#e': 'error'},
        ExpressionAttributeValues={
            ':st': status,
            ':d': bool(data.get('duplicate')) if not error else False,
            ':pm': bool(data.get('possible_match')) if not error else False,
            ':fp': bool(data.get('former_patient')) if not error else False,
            ':c': data.get('confidence') or '',
            ':m': data.get('match_type') or '',
            ':ao': bool(data.get('allow_override')) if not error else False,
            ':hc': _sanitize_hchb_case(data.get('hchb_case')) if not error else {},
            ':mt': matches,
            ':err': error or '',
            ':t': int(time.time()),
        },
    )
    return _resp(200, {'ok': True, 'job_id': job_id, 'status': status})
