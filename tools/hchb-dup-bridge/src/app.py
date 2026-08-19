"""API Gateway handlers: enqueue hashed jobs, agent claim/result, status poll.

Inbound bodies must never include raw name/DOB — only HMAC hex digests.
Results may include latest-episode case facts (status + dates). No names,
SSN, MRN, or DOB from HCHB. CareStream does not collect SSN;
soft=name, strong=name+DOB.
"""
from __future__ import annotations

import json
import os
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

table = ddb.Table(TABLE)


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


def create_job(event, context):
    if CARESTREAM_TOKEN and _bearer(event) != CARESTREAM_TOKEN:
        return _resp(401, {'error': 'unauthorized'})
    try:
        data = _body(event)
    except Exception as exc:
        return _resp(400, {'error': str(exc)})

    hmac_medicaid = str(data.get('hmac_medicaid') or '')
    hmac_mrn = str(data.get('hmac_mrn') or '')
    hmac_name = str(data.get('hmac_name') or '')
    hmac_name_dob = str(data.get('hmac_name_dob') or '')
    if not any((hmac_medicaid, hmac_mrn, hmac_name, hmac_name_dob)):
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
        'status': 'pending',
        'hmac_medicaid': hmac_medicaid,
        'hmac_mrn': hmac_mrn,
        'hmac_name': hmac_name,
        'hmac_name_dob': hmac_name_dob,
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
            'hmac_medicaid': hmac_medicaid,
            'hmac_mrn': hmac_mrn,
            'hmac_name': hmac_name,
            'hmac_name_dob': hmac_name_dob,
        }),
    )
    return _resp(201, {'job_id': job_id, 'status': 'pending'})


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
        'status': item.get('status'),
        'duplicate': item.get('duplicate'),
        'possible_match': item.get('possible_match'),
        'former_patient': item.get('former_patient'),
        'confidence': item.get('confidence') or None,
        'match_type': item.get('match_type') or None,
        'allow_override': item.get('allow_override'),
        'hchb_case': item.get('hchb_case') or {},
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
        VisibilityTimeout=60,
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
    return _resp(200, {
        'job_id': job_id,
        'hmac_medicaid': body.get('hmac_medicaid') or '',
        'hmac_mrn': body.get('hmac_mrn') or '',
        'hmac_name': body.get('hmac_name') or '',
        'hmac_name_dob': body.get('hmac_name_dob') or '',
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
    table.update_item(
        Key={'job_id': job_id},
        UpdateExpression=(
            'SET #s = :st, duplicate = :d, possible_match = :pm, former_patient = :fp, '
            'confidence = :c, match_type = :m, allow_override = :ao, hchb_case = :hc, '
            '#e = :err, completed_at = :t'
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
            ':err': error or '',
            ':t': int(time.time()),
        },
    )
    return _resp(200, {'ok': True, 'job_id': job_id, 'status': status})
