"""Load config from environment / .env next to the project root."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(_ROOT / '.env')
load_dotenv(_ROOT / '.env.local', override=True)


def _req(name: str, default: str | None = None) -> str:
    val = os.environ.get(name, default)
    if val is None or val == '':
        raise RuntimeError(f'Missing required env var: {name}')
    return val


@dataclass(frozen=True)
class Config:
    db_server: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str
    odbc_driver: str
    trust_cert: bool
    pepper: str
    aws_region: str
    queue_url: str
    results_queue_url: str
    bridge_url: str
    agent_token: str
    poll_seconds: float
    job_timeout_seconds: float

    @property
    def use_http_bridge(self) -> bool:
        return bool(self.bridge_url)

    @property
    def use_sqs(self) -> bool:
        return bool(self.queue_url) and not self.use_http_bridge


def load_config() -> Config:
    return Config(
        db_server=os.environ.get('OASIS_DB_SERVER', 'LOGSHIP.ACUnion.local'),
        db_port=int(os.environ.get('OASIS_DB_PORT', '1433')),
        db_name=os.environ.get('OASIS_DB_NAME', 'HCHB_WELLBOUND'),
        db_user=os.environ.get('OASIS_DB_USER', 'dataphone'),
        db_password=_req('OASIS_DB_PASS'),
        odbc_driver=os.environ.get('OASIS_ODBC_DRIVER', 'ODBC Driver 18 for SQL Server'),
        trust_cert=os.environ.get('OASIS_DB_TRUST_CERT', 'yes').lower() in ('1', 'true', 'yes'),
        pepper=os.environ.get('HCHB_LINK_PEPPER', ''),
        aws_region=os.environ.get('AWS_REGION', 'us-east-2'),
        queue_url=os.environ.get('HCHB_DUP_QUEUE_URL', '').rstrip('/'),
        results_queue_url=os.environ.get('HCHB_DUP_RESULTS_QUEUE_URL', '').rstrip('/'),
        bridge_url=os.environ.get('HCHB_DUP_BRIDGE_URL', '').rstrip('/'),
        agent_token=os.environ.get('HCHB_DUP_AGENT_TOKEN', ''),
        poll_seconds=float(os.environ.get('POLL_SECONDS', '2')),
        job_timeout_seconds=float(os.environ.get('JOB_TIMEOUT_SECONDS', '60')),
    )


def odbc_conn_str(cfg: Config) -> str:
    parts = [
        f'DRIVER={{{cfg.odbc_driver}}}',
        f'SERVER={cfg.db_server},{cfg.db_port}',
        f'DATABASE={cfg.db_name}',
        f'UID={cfg.db_user}',
        f'PWD={cfg.db_password}',
    ]
    if cfg.trust_cert:
        parts.append('TrustServerCertificate=yes')
    return ';'.join(parts)