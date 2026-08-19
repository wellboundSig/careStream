"""24/7 on-prem agent: claim hashed jobs → active-patient index → soft/strong flag."""
from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import traceback

from .bridge import make_bridge
from .config import load_config
from . import db, hashutil
from .patient_index import RefreshingIndex

log = logging.getLogger('hchb-dup')
_stop = False


def _handle_stop(signum, frame):
    global _stop
    _stop = True
    log.info('stop signal received (%s)', signum)


def _report(bridge, job, result=None, error=None):
    kwargs = dict(
        duplicate=bool(result and result.get('duplicate')),
        possible_match=bool(result and result.get('possible_match')),
        former_patient=bool(result and result.get('former_patient')),
        confidence=(result or {}).get('confidence'),
        match_type=(result or {}).get('match_type'),
        allow_override=bool(result and result.get('allow_override')),
        hchb_case=(result or {}).get('hchb_case'),
        error=error,
    )
    if job.receipt_handle is not None:
        bridge.report(job.job_id, receipt_handle=job.receipt_handle, **kwargs)
    else:
        bridge.report(job.job_id, **kwargs)


def run_loop() -> int:
    cfg = load_config()
    bridge = make_bridge(cfg)
    log.info('DB ping: %s', db.ping(cfg))
    log.info('bridge mode: %s', 'http' if cfg.use_http_bridge else 'sqs')

    refresh = float(os.environ.get('INDEX_REFRESH_SECONDS', '300'))
    log.info('building patient index, active + discharged (refresh every %ss)…', int(refresh))
    index = RefreshingIndex(cfg, refresh_seconds=refresh)

    wait = max(1, int(cfg.poll_seconds))
    while not _stop:
        try:
            job = bridge.claim(wait_seconds=min(20, max(1, wait)))
        except Exception:
            log.exception('claim failed')
            continue

        if not job:
            continue

        log.info('job %s claimed', job.job_id)
        try:
            result = index.lookup(
                hmac_medicaid=job.hmac_medicaid,
                hmac_mrn=job.hmac_mrn,
                hmac_name=job.hmac_name,
                hmac_name_dob=job.hmac_name_dob,
            )
            _report(bridge, job, result=result)
            case = (result.get('hchb_case') or {})
            log.info(
                'job %s done confidence=%s match_type=%s duplicate=%s case=%s dc=%s',
                job.job_id, result.get('confidence'), result.get('match_type'),
                result.get('duplicate'), case.get('case_status'), case.get('discharged_on'),
            )
        except Exception as exc:
            log.exception('job %s failed', job.job_id)
            try:
                _report(bridge, job, error=f'{type(exc).__name__}: {exc}'[:240])
            except Exception:
                log.exception('failed to report error for %s', job.job_id)

    log.info('agent stopped')
    return 0


def cmd_ping() -> int:
    print(db.ping(load_config()))
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    result = db.check_duplicate_live(
        load_config(),
        medicaid=args.medicaid,
        mrn=args.mrn,
        last_name=args.last,
        first_name=args.first,
        dob=args.dob,
    )
    print(result)
    return 0


def cmd_hash(args: argparse.Namespace) -> int:
    cfg = load_config()
    if not cfg.pepper:
        print('HCHB_LINK_PEPPER required', file=sys.stderr)
        return 2
    out = {
        'hmac_name': hashutil.hash_name(cfg.pepper, args.last, args.first) if (args.last and args.first) else '',
        'hmac_name_dob': hashutil.hash_name_dob(cfg.pepper, args.last, args.first, args.dob)
        if (args.last and args.first and args.dob) else '',
        'hmac_medicaid': hashutil.hash_medicaid(cfg.pepper, args.medicaid) if args.medicaid else '',
        'hmac_mrn': hashutil.hash_mrn(cfg.pepper, args.mrn) if args.mrn else '',
    }
    print(out)
    return 0


def cmd_rebuild_index() -> int:
    idx = RefreshingIndex(load_config(), refresh_seconds=10**9).get()
    print({
        'patients': idx.patient_count,
        'active_patients': idx.active_count,
        'mrn_rows': idx.mrn_count,
        'name_hashes_soft': len(idx.by_name),
        'name_dob_hashes_strong': len(idx.by_name_dob),
        'medicaid_hashes': len(idx.by_medicaid),
        'mrn_hashes': len(idx.by_mrn),
    })
    return 0


def cmd_inspect(args: argparse.Namespace) -> int:
    import json
    result = db.inspect_name(load_config(), args.last, args.first)
    print(json.dumps(result, indent=2, default=str))
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s %(levelname)s %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    )
    parser = argparse.ArgumentParser(description='HCHB duplicate agent (active + discharged)')
    sub = parser.add_subparsers(dest='cmd')
    sub.add_parser('run')
    sub.add_parser('ping')
    sub.add_parser('rebuild-index')

    p_check = sub.add_parser('check', help='Live check (active + discharged)')
    p_check.add_argument('--medicaid')
    p_check.add_argument('--mrn')
    p_check.add_argument('--last')
    p_check.add_argument('--first')
    p_check.add_argument('--dob')

    p_hash = sub.add_parser('hash')
    p_hash.add_argument('--medicaid')
    p_hash.add_argument('--mrn')
    p_hash.add_argument('--last')
    p_hash.add_argument('--first')
    p_hash.add_argument('--dob')

    p_inspect = sub.add_parser('inspect', help='Show raw CLIENTS_ALL rows for a name (debug accuracy)')
    p_inspect.add_argument('--last', required=True)
    p_inspect.add_argument('--first', required=True)

    args = parser.parse_args(argv)
    cmd = args.cmd or 'run'
    if cmd == 'ping':
        return cmd_ping()
    if cmd == 'check':
        return cmd_check(args)
    if cmd == 'hash':
        return cmd_hash(args)
    if cmd == 'rebuild-index':
        return cmd_rebuild_index()
    if cmd == 'inspect':
        return cmd_inspect(args)

    signal.signal(signal.SIGINT, _handle_stop)
    if hasattr(signal, 'SIGTERM'):
        signal.signal(signal.SIGTERM, _handle_stop)
    try:
        return run_loop()
    except Exception:
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
