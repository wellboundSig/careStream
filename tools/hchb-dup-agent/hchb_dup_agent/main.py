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
from .visit_index import RefreshingVisitIndex
from .visit_match import DATE_WINDOW_DAYS

log = logging.getLogger('hchb-dup')
_stop = False


def _handle_stop(signum, frame):
    global _stop
    _stop = True
    log.info('stop signal received (%s)', signum)


def _report(bridge, job, result=None, error=None, matches=None):
    kwargs = dict(
        duplicate=bool(result and result.get('duplicate')),
        possible_match=bool(result and result.get('possible_match')),
        former_patient=bool(result and result.get('former_patient')),
        confidence=(result or {}).get('confidence'),
        match_type=(result or {}).get('match_type'),
        allow_override=bool(result and result.get('allow_override')),
        hchb_case=(result or {}).get('hchb_case'),
        matches=matches or (result or {}).get('matches') or [],
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
    log.info('building SOC/ROC visit index (refresh every %ss)…', int(refresh))
    try:
        visit_index = RefreshingVisitIndex(cfg, refresh_seconds=refresh)
    except Exception:
        log.exception('visit index failed to build — visit_check jobs will error until refresh succeeds')
        visit_index = None

    wait = max(1, int(cfg.poll_seconds))
    while not _stop:
        try:
            job = bridge.claim(wait_seconds=min(20, max(1, wait)))
        except Exception:
            log.exception('claim failed')
            continue

        if not job:
            continue

        log.info('job %s kind=%s claimed', job.job_id, job.kind or 'dup')
        try:
            if (job.kind or 'dup') == 'visit_check':
                if visit_index is None:
                    visit_index = RefreshingVisitIndex(cfg, refresh_seconds=refresh)
                matches = visit_index.match_candidates(job.candidates or [])
                _report(bridge, job, matches=matches)
                hit = sum(1 for m in matches if m.get('matched'))
                log.info('job %s visit_check done candidates=%s matched=%s', job.job_id, len(matches), hit)
                continue

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


def cmd_visit_check(args: argparse.Namespace) -> int:
    """Live SOC/ROC visit lookup (plaintext, closet PC only)."""
    from .visit_index import build_visit_index
    from .visit_match import match_candidate

    cfg = load_config()
    idx = build_visit_index(cfg)
    hmac_name = hashutil.hash_name(cfg.pepper, args.last, hashutil.first_token(args.first)) if (args.last and args.first) else ''
    hmac_name_dob = (
        hashutil.hash_name_dob(cfg.pepper, args.last, hashutil.first_token(args.first), args.dob)
        if (args.last and args.first and args.dob) else ''
    )
    strong = list(idx.by_name_dob.get(hmac_name_dob) or []) if hmac_name_dob else []
    soft = list(idx.by_name.get(hmac_name) or []) if hmac_name else []
    result = match_candidate(
        token='cli',
        visit_kind=str(args.kind or 'SOC').upper(),
        scheduled_date=str(args.date or ''),
        strong_visits=strong,
        soft_visits=soft,
        window_days=DATE_WINDOW_DAYS,
    )
    print({
        'index': {'visits': idx.visit_count, 'soc': idx.soc_count, 'roc': idx.roc_count},
        'result': result,
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

    p_visit = sub.add_parser('visit-check', help='Live SOC/ROC visit lookup against V_AGENTVISITTIMEREPORT')
    p_visit.add_argument('--last', required=True)
    p_visit.add_argument('--first', required=True)
    p_visit.add_argument('--dob')
    p_visit.add_argument('--kind', default='SOC', help='SOC or ROC')
    p_visit.add_argument('--date', required=True, help='Scheduled date YYYY-MM-DD')

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
    if cmd == 'visit-check':
        return cmd_visit_check(args)

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
