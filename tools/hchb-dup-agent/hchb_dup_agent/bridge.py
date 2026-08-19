"""Outbound job transport: HTTP bridge (preferred) or SQS.

Agent never opens inbound ports. CareStream enqueues hashed jobs; this PC
claims them, queries logship locally, posts match flags plus latest-episode
case facts (status / dates only — no names, SSN, or MRN).
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

import boto3
import requests

from .case_facts import sanitize_hchb_case
from .config import Config

log = logging.getLogger('hchb-dup')


@dataclass
class Job:
    job_id: str
    hmac_medicaid: str = ''
    hmac_mrn: str = ''
    hmac_name: str = ''
    hmac_name_dob: str = ''
    receipt_handle: str | None = None  # SQS only


class HttpBridge:
    def __init__(self, cfg: Config):
        if not cfg.bridge_url:
            raise RuntimeError('HCHB_DUP_BRIDGE_URL required')
        if not cfg.agent_token:
            raise RuntimeError('HCHB_DUP_AGENT_TOKEN required')
        self.base = cfg.bridge_url.rstrip('/')
        self.token = cfg.agent_token
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {self.token}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        })

    def claim(self, wait_seconds: int = 20) -> Job | None:
        r = self.session.post(
            f'{self.base}/agent/claim',
            json={'wait_seconds': wait_seconds},
            timeout=wait_seconds + 10,
        )
        if r.status_code == 204:
            return None
        r.raise_for_status()
        data = r.json() or {}
        if not data.get('job_id'):
            return None
        return Job(
            job_id=str(data['job_id']),
            hmac_medicaid=str(data.get('hmac_medicaid') or ''),
            hmac_mrn=str(data.get('hmac_mrn') or ''),
            hmac_name=str(data.get('hmac_name') or ''),
            hmac_name_dob=str(data.get('hmac_name_dob') or ''),
        )

    def report(
        self,
        job_id: str,
        *,
        duplicate: bool,
        match_type: str | None,
        error: str | None = None,
        possible_match: bool | None = None,
        confidence: str | None = None,
        allow_override: bool | None = None,
        former_patient: bool | None = None,
        hchb_case: dict[str, Any] | None = None,
    ) -> None:
        body: dict[str, Any] = {
            'job_id': job_id,
            'duplicate': bool(duplicate) if error is None else False,
            'possible_match': bool(possible_match) if error is None else False,
            'former_patient': bool(former_patient) if error is None else False,
            'confidence': confidence,
            'match_type': match_type,
            'allow_override': bool(allow_override) if error is None else False,
            'hchb_case': sanitize_hchb_case(hchb_case) if (error is None and hchb_case) else {},
            'error': error,
        }
        r = self.session.post(f'{self.base}/agent/result', json=body, timeout=30)
        r.raise_for_status()


class SqsBridge:
    def __init__(self, cfg: Config):
        if not cfg.queue_url:
            raise RuntimeError('HCHB_DUP_QUEUE_URL required')
        self.queue_url = cfg.queue_url
        self.results_url = cfg.results_queue_url
        self.sqs = boto3.client('sqs', region_name=cfg.aws_region)

    def claim(self, wait_seconds: int = 20) -> Job | None:
        resp = self.sqs.receive_message(
            QueueUrl=self.queue_url,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=min(20, max(0, wait_seconds)),
            VisibilityTimeout=60,
        )
        msgs = resp.get('Messages') or []
        if not msgs:
            return None
        m = msgs[0]
        body = json.loads(m['Body'])
        return Job(
            job_id=str(body['job_id']),
            hmac_medicaid=str(body.get('hmac_medicaid') or ''),
            hmac_mrn=str(body.get('hmac_mrn') or ''),
            hmac_name=str(body.get('hmac_name') or ''),
            hmac_name_dob=str(body.get('hmac_name_dob') or ''),
            receipt_handle=m['ReceiptHandle'],
        )

    def report(
        self,
        job_id: str,
        *,
        duplicate: bool,
        match_type: str | None,
        error: str | None = None,
        receipt_handle: str | None = None,
        possible_match: bool | None = None,
        confidence: str | None = None,
        allow_override: bool | None = None,
        former_patient: bool | None = None,
        hchb_case: dict[str, Any] | None = None,
    ) -> None:
        payload = {
            'job_id': job_id,
            'duplicate': bool(duplicate) if error is None else False,
            'possible_match': bool(possible_match) if error is None else False,
            'former_patient': bool(former_patient) if error is None else False,
            'confidence': confidence,
            'match_type': match_type,
            'allow_override': bool(allow_override) if error is None else False,
            'hchb_case': sanitize_hchb_case(hchb_case) if (error is None and hchb_case) else {},
            'error': error,
        }
        if self.results_url:
            self.sqs.send_message(QueueUrl=self.results_url, MessageBody=json.dumps(payload))
        if receipt_handle:
            self.sqs.delete_message(QueueUrl=self.queue_url, ReceiptHandle=receipt_handle)


def make_bridge(cfg: Config) -> HttpBridge | SqsBridge:
    if cfg.use_http_bridge:
        return HttpBridge(cfg)
    if cfg.use_sqs:
        return SqsBridge(cfg)
    raise RuntimeError(
        'Configure HCHB_DUP_BRIDGE_URL (+ HCHB_DUP_AGENT_TOKEN) or HCHB_DUP_QUEUE_URL'
    )