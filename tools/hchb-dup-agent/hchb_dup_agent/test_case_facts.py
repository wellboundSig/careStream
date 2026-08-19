"""Unit tests for episode ranking / result flags. Run: python -m hchb_dup_agent.test_case_facts"""
from __future__ import annotations

import unittest

from .case_facts import CaseFacts, keep_better, match_result
from .sql_queries import pick_episode_date_columns


class CaseFactsTests(unittest.TestCase):
    def test_active_from_row(self):
        facts = CaseFacts.from_row({
            'episode_status': 'CURRENT',
            'episode_start': '2024-01-15',
            'has_active_episode': 1,
            'episode_count': 3,
        })
        self.assertEqual(facts.case_status, 'active')
        self.assertTrue(facts.has_active_episode)
        self.assertEqual(facts.episode_start, '2024-01-15')

    def test_discharged_from_row(self):
        facts = CaseFacts.from_row({
            'episode_status': 'DISCHARGED',
            'discharged_on': '2024-06-01 00:00:00',
            'has_active_episode': 0,
        })
        self.assertEqual(facts.case_status, 'discharged')
        self.assertEqual(facts.discharged_on, '2024-06-01')
        self.assertFalse(facts.has_active_episode)

    def test_prefer_active_over_discharged(self):
        active = CaseFacts.from_row({'episode_status': 'HOLD', 'has_active_episode': 1})
        dc = CaseFacts.from_row({
            'episode_status': 'DISCHARGED',
            'discharged_on': '2025-01-01',
            'has_active_episode': 0,
        })
        self.assertEqual(keep_better(dc, active), active)

    def test_match_result_flags(self):
        active = CaseFacts.from_row({'episode_status': 'CURRENT', 'has_active_episode': 1})
        dc = CaseFacts.from_row({'episode_status': 'DISCHARGED', 'has_active_episode': 0})
        hit = match_result('name_dob', 'strong', active)
        self.assertTrue(hit['duplicate'])
        self.assertFalse(hit['former_patient'])
        former = match_result('name_dob', 'strong', dc)
        self.assertFalse(former['duplicate'])
        self.assertTrue(former['former_patient'])
        self.assertEqual(former['hchb_case']['case_status'], 'discharged')

    def test_pick_date_columns(self):
        soc, dc = pick_episode_date_columns(['epi_id', 'epi_socdate', 'epi_dcdate', 'epi_status'])
        self.assertEqual(soc, 'epi_socdate')
        self.assertEqual(dc, 'epi_dcdate')


if __name__ == '__main__':
    unittest.main()
