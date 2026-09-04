"""Unit tests for SOC/ROC visit matching. Run: python -m hchb_dup_agent.test_visit_match"""
from __future__ import annotations

import unittest

from .hashutil import first_token, parse_hchb_client_name
from .visit_match import classify_visit_kind, in_date_window, match_candidate, parse_iso_date


class ClassifyTests(unittest.TestCase):
    def test_soc_codes(self):
        self.assertEqual(classify_visit_kind('SN-SOC'), 'SOC')
        self.assertEqual(classify_visit_kind('SNSOC'), 'SOC')
        self.assertEqual(classify_visit_kind('OASIS SOC'), 'SOC')
        self.assertEqual(classify_visit_kind('Start of Care'), 'SOC')
        self.assertEqual(classify_visit_kind('PT SOC RN'), 'SOC')

    def test_roc_codes(self):
        self.assertEqual(classify_visit_kind('SN-ROC'), 'ROC')
        self.assertEqual(classify_visit_kind('SNROC'), 'ROC')
        self.assertEqual(classify_visit_kind('Resumption of Care'), 'ROC')
        self.assertEqual(classify_visit_kind('OASIS-ROC'), 'ROC')

    def test_ignores_unrelated(self):
        self.assertIsNone(classify_visit_kind('ROUTINE'))
        self.assertIsNone(classify_visit_kind('DISCHARGE'))
        self.assertIsNone(classify_visit_kind('RECERT'))
        self.assertIsNone(classify_visit_kind('ASSOCIATE'))
        self.assertIsNone(classify_visit_kind(''))


class NameParseTests(unittest.TestCase):
    def test_last_comma_first(self):
        self.assertEqual(parse_hchb_client_name('Smith, Jane'), ('Smith', 'JANE'))
        self.assertEqual(parse_hchb_client_name('SMITH, JANE MARIE'), ('SMITH', 'JANE'))

    def test_first_token(self):
        self.assertEqual(first_token('John Michael'), 'JOHN')
        self.assertEqual(first_token('jane'), 'JANE')


class WindowTests(unittest.TestCase):
    def test_plus_minus_one(self):
        sched = parse_iso_date('2026-09-01')
        self.assertTrue(in_date_window(sched, parse_iso_date('2026-09-01')))
        self.assertTrue(in_date_window(sched, parse_iso_date('2026-08-31')))
        self.assertTrue(in_date_window(sched, parse_iso_date('2026-09-02')))
        self.assertFalse(in_date_window(sched, parse_iso_date('2026-09-03')))
        self.assertFalse(in_date_window(sched, parse_iso_date('2026-08-30')))


class MatchCandidateTests(unittest.TestCase):
    def test_strong_soc_exact_date(self):
        out = match_candidate(
            token='r1',
            visit_kind='SOC',
            scheduled_date='2026-09-01',
            strong_visits=[{'visit_date': '2026-09-01', 'visit_kind': 'SOC', 'visit_type': 'SN-SOC'}],
            soft_visits=[],
        )
        self.assertTrue(out['matched'])
        self.assertEqual(out['status'], 'match')
        self.assertEqual(out['confidence'], 'strong')
        self.assertEqual(out['visit_date'], '2026-09-01')
        self.assertEqual(out['day_offset'], 0)

    def test_window_prefers_exact(self):
        out = match_candidate(
            token='r1',
            visit_kind='SOC',
            scheduled_date='2026-09-01',
            strong_visits=[
                {'visit_date': '2026-09-02', 'visit_kind': 'SOC', 'visit_type': 'SN-SOC'},
                {'visit_date': '2026-09-01', 'visit_kind': 'SOC', 'visit_type': 'SN-SOC'},
            ],
            soft_visits=[],
        )
        self.assertEqual(out['visit_date'], '2026-09-01')
        self.assertEqual(out['day_offset'], 0)

    def test_kind_must_match(self):
        out = match_candidate(
            token='r1',
            visit_kind='SOC',
            scheduled_date='2026-09-01',
            strong_visits=[{'visit_date': '2026-09-01', 'visit_kind': 'ROC', 'visit_type': 'SN-ROC'}],
            soft_visits=[],
        )
        self.assertFalse(out['matched'])
        self.assertEqual(out['status'], 'kind_mismatch')
        self.assertEqual(out['visit_kind'], 'ROC')

    def test_soft_when_no_strong(self):
        out = match_candidate(
            token='r1',
            visit_kind='ROC',
            scheduled_date='2026-09-01',
            strong_visits=[],
            soft_visits=[{'visit_date': '2026-08-31', 'visit_kind': 'ROC', 'visit_type': 'ROC'}],
        )
        self.assertTrue(out['matched'])
        self.assertEqual(out['confidence'], 'soft')
        self.assertEqual(out['day_offset'], -1)

    def test_no_match_outside_window(self):
        out = match_candidate(
            token='r1',
            visit_kind='SOC',
            scheduled_date='2026-09-01',
            strong_visits=[{'visit_date': '2026-09-10', 'visit_kind': 'SOC', 'visit_type': 'SN-SOC'}],
            soft_visits=[],
        )
        self.assertFalse(out['matched'])
        self.assertEqual(out['status'], 'no_match')


if __name__ == '__main__':
    unittest.main()
