import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from app.api.routes import profile, retroachievements_play as play
from app.services import retroachievements_session as sessions


class RetroAchievementsConnectionTests(unittest.TestCase):
    def setUp(self):
        sessions._requests.clear()
        self.user = SimpleNamespace(id=19, retroachievements_token=None, retroachievements_username='PublicName', retroachievements_ulid=None)
        self.db = MagicMock()

    def connect(self):
        payload = profile.RetroAchievementsConnect(username='Player', password='private-password')
        result = {'status': 200, 'body': json.dumps({'Success': True, 'User': 'Player', 'Token': 'private-ra-token'})}
        with patch.object(profile, 'forward_rpc', return_value=result):
            return profile.connect_ra(payload, self.user, self.db)

    def test_connect_encrypts_only_token_and_status_never_returns_secrets(self):
        response = self.connect()
        encrypted = self.user.retroachievements_token
        self.assertNotIn('private-ra-token', encrypted)
        self.assertNotIn('private-password', encrypted)
        self.assertEqual(sessions.saved_session(self.user), {'username': 'Player', 'token': 'private-ra-token'})
        state = profile.get_ra_connection(self.user)
        self.assertTrue(json.loads(state.body)['connected'])
        self.assertNotIn(b'private-ra-token', state.body)
        self.assertNotIn(b'private-password', response.body)
        self.assertEqual(state.headers['cache-control'], 'no-store')
        self.assertEqual(self.user.retroachievements_username, 'Player')

    def test_encrypted_tokens_are_bound_to_site_user_and_server_key(self):
        self.connect()
        other = SimpleNamespace(id=20, retroachievements_token=self.user.retroachievements_token)
        self.assertIsNone(sessions.saved_session(other))
        with patch.object(sessions.settings, 'JWT_SECRET', 'different-server-key'):
            self.assertIsNone(sessions.saved_session(self.user))
            self.assertTrue(profile.connection_state(self.user)['reconnect_required'])

    def test_bad_login_preserves_existing_connection_and_sanitizes_error(self):
        self.connect(); saved = self.user.retroachievements_token
        response = {'status': 200, 'body': json.dumps({'Success': False, 'Error': 'private-password'})}
        with patch.object(profile, 'forward_rpc', return_value=response), self.assertRaises(HTTPException) as error:
            profile.connect_ra(profile.RetroAchievementsConnect(username='Player', password='wrong'), self.user, self.db)
        self.assertNotIn('private-password', error.exception.detail)
        self.assertEqual(self.user.retroachievements_token, saved)

    def test_disconnect_removes_remembered_session(self):
        self.connect()
        response = profile.disconnect_ra(self.user, self.db)
        self.assertFalse(json.loads(response.body)['connected'])
        self.assertIsNone(self.user.retroachievements_token)
        self.assertEqual(self.user.retroachievements_username, 'Player')

    def test_session_requires_authorized_room_and_is_not_cached(self):
        self.connect()
        with patch.object(play, 'require_room') as check:
            result = play.room_session(play.RoomSessionRequest(room_code='SOLOMD'), self.user, self.db)
        check.assert_called_once_with('SOLOMD', self.user, self.db)
        self.assertEqual(json.loads(result.body)['token'], 'private-ra-token')
        self.assertEqual(result.headers['cache-control'], 'no-store')
        with patch.object(play, 'require_room', side_effect=HTTPException(403)), self.assertRaises(HTTPException):
            play.room_session(play.RoomSessionRequest(room_code='OTHER'), self.user, self.db)

    def test_missing_connection_requires_profile_setup(self):
        with patch.object(play, 'require_room'), self.assertRaises(HTTPException) as error:
            play.room_session(play.RoomSessionRequest(room_code='SOLOMD'), self.user, self.db)
        self.assertEqual(error.exception.status_code, 409)
