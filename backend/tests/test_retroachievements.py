import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from urllib.error import URLError

from fastapi import HTTPException
from pydantic import SecretStr, ValidationError
from app.services import retroachievements as ra
from app.api.routes import profile

ULID = '00003EMFWR7XB8SDPEHB3K56ZQ'


class RetroAchievementsServiceTests(unittest.TestCase):
    def setUp(self):
        ra._cache.clear()
        ra._recent_requests.clear()
        self.enterContext(patch.object(ra.settings, 'RETROACHIEVEMENTS_API_KEY', SecretStr('test-only-secret')))

    def test_requests_are_cached_and_secret_is_not_returned(self):
        opener = MagicMock()
        opener.open.return_value = io.BytesIO(json.dumps({'User': 'Player', 'ULID': ULID, 'TotalPoints': '123'}).encode())
        with patch.object(ra, 'build_opener', return_value=opener):
            first = ra.public_profile('Player')
            second = ra.public_profile('player')
        self.assertEqual(first, second)
        self.assertEqual(first['points'], 123)
        self.assertEqual(first['ulid'], ULID)
        self.assertEqual(opener.open.call_count, 1)
        self.assertNotIn('test-only-secret', json.dumps(first))
        self.assertEqual(opener.open.call_args.kwargs['timeout'], 10)

    def test_network_errors_never_expose_secret_urls(self):
        opener = MagicMock()
        opener.open.side_effect = URLError('https://retroachievements.org/API/test?y=test-only-secret')
        with patch.object(ra, 'build_opener', return_value=opener):
            with self.assertRaises(HTTPException) as result:
                ra.public_profile('Player')
        self.assertNotIn('test-only-secret', result.exception.detail)
        self.assertEqual(result.exception.status_code, 502)

    def test_oversized_responses_are_rejected(self):
        opener = MagicMock()
        opener.open.return_value = io.BytesIO(b' ' * (2 * 1024 * 1024 + 1))
        with patch.object(ra, 'build_opener', return_value=opener):
            with self.assertRaises(HTTPException):
                ra.public_profile('Player')

    def test_recent_unlocks_are_deduplicated_in_date_order(self):
        items = [
            {'AchievementID': 1, 'Date': '2026-10-30 12:00:00', 'BadgeName': '123', 'HardcoreMode': 1},
            {'AchievementID': 2, 'Date': '2026-10-29 12:00:00', 'BadgeName': 'https://untrusted.invalid/badge'},
            {'AchievementID': 1, 'Date': '2026-10-28 12:00:00', 'HardcoreMode': 0},
        ]
        with patch.object(ra, 'request_public', return_value=items):
            result = ra.recent_unlocks(ULID)
        self.assertEqual([item['id'] for item in result], [1, 2])
        self.assertTrue(result[0]['hardcore'])
        self.assertIsNone(result[1]['badge_url'])

    def test_empty_user_response_is_not_a_valid_profile(self):
        with patch.object(ra, 'request_public', return_value={}):
            with self.assertRaises(HTTPException) as result:
                ra.public_profile('Missing')
        self.assertEqual(result.exception.status_code, 404)

    def test_upstream_budget_prevents_excess_requests(self):
        with patch.object(ra.time, 'monotonic', return_value=100):
            ra._recent_requests.extend([100] * 60)
            with self.assertRaises(HTTPException) as result:
                ra.request_public('API_GetUserProfile.php', 'Player')
        self.assertEqual(result.exception.status_code, 503)


class RetroAchievementsProfileTests(unittest.TestCase):
    def setUp(self):
        self.user = SimpleNamespace(retroachievements_username=None, retroachievements_ulid=None)
        self.db = MagicMock()

    def test_username_can_be_saved_without_api_configuration(self):
        with patch.object(ra, 'configured', return_value=False), patch.object(ra, 'public_profile') as lookup:
            result = profile.update_retroachievements(profile.RetroAchievementsUpdate(username=' Player '), self.user, self.db)
        self.assertEqual(self.user.retroachievements_username, 'Player')
        self.assertFalse(result['configured'])
        lookup.assert_not_called()

    def test_remove_does_not_call_upstream(self):
        self.user.retroachievements_username = 'Player'
        self.user.retroachievements_ulid = ULID
        with patch.object(ra, 'configured', return_value=True), patch.object(ra, 'public_profile') as lookup:
            result = profile.update_retroachievements(profile.RetroAchievementsUpdate(username=''), self.user, self.db)
        self.assertEqual(result['username'], '')
        self.assertIsNone(self.user.retroachievements_ulid)
        lookup.assert_not_called()

    def test_failed_new_lookup_keeps_existing_profile(self):
        self.user.retroachievements_username = 'Original'
        with patch.object(ra, 'configured', return_value=True), patch.object(ra, 'public_profile', side_effect=HTTPException(404, 'Not found')):
            with self.assertRaises(HTTPException):
                profile.update_retroachievements(profile.RetroAchievementsUpdate(username='Missing'), self.user, self.db)
        self.assertEqual(self.user.retroachievements_username, 'Original')
        self.db.commit.assert_not_called()

    def test_renamed_profile_is_resolved_by_stable_ulid(self):
        self.user.retroachievements_username = 'OldName'
        self.user.retroachievements_ulid = ULID
        remote = {'username': 'NewName', 'ulid': ULID, 'points': 123}
        with patch.object(ra, 'configured', return_value=True), patch.object(ra, 'public_profile', return_value=remote) as lookup, patch.object(ra, 'recent_unlocks', return_value=[]):
            result = profile.retroachievements_state(self.user, self.db)
        lookup.assert_called_once_with(ULID)
        self.assertEqual(result['username'], 'NewName')
        self.assertEqual(self.user.retroachievements_username, 'NewName')
        self.assertNotIn('ulid', result['profile'])

    def test_outage_is_isolated_from_profile_page(self):
        self.user.retroachievements_username = 'Player'
        with patch.object(ra, 'configured', return_value=True), patch.object(ra, 'public_profile', side_effect=HTTPException(502, 'Temporarily unavailable')):
            result = profile.retroachievements_state(self.user, self.db)
        self.assertEqual(result['username'], 'Player')
        self.assertIsNone(result['profile'])
        self.assertEqual(result['error'], 'Temporarily unavailable')

    def test_recent_unlock_outage_preserves_profile_points(self):
        self.user.retroachievements_username = 'Player'
        remote = {'username': 'Player', 'ulid': ULID, 'points': 123}
        with patch.object(ra, 'configured', return_value=True), patch.object(ra, 'public_profile', return_value=remote), patch.object(ra, 'recent_unlocks', side_effect=HTTPException(502, 'Temporarily unavailable')):
            result = profile.retroachievements_state(self.user, self.db)
        self.assertEqual(result['profile']['points'], 123)
        self.assertEqual(result['profile']['recent_unlocks'], [])
        self.assertEqual(result['profile']['recent_error'], 'Temporarily unavailable')

    def test_username_rejects_links_and_control_characters(self):
        for value in ['https://example.com/player', 'player\nname', '<script>']:
            with self.assertRaises(ValidationError):
                profile.RetroAchievementsUpdate(username=value)
