import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException
from app.api.routes import retroachievements_mame_preview as preview
from app.api.routes import retroachievements_play as play
from unittest.mock import MagicMock
from app.services import retroachievements_session as sessions

class MamePreviewTests(unittest.TestCase):
    def setUp(self):
        sessions._requests.clear()
        self.user = SimpleNamespace(id=31)
        self.session = {'username': 'FixtureUser', 'token': 'fixture-token'}
        self.enterContext(patch.object(preview, 'saved_session', return_value=self.session))

    def test_saved_connection_is_private_and_never_cached(self):
        response = preview.preview_session(self.user)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(json.loads(response.body), self.session)

    def test_only_saved_token_login_and_fixed_pacman_definitions_are_read(self):
        for data in ['r=login2&u=FixtureUser&t=fixture-token',
                     f'r=achievementsets&u=FixtureUser&t=fixture-token&m={preview.PACMAN_HASH}']:
            with patch.object(preview, 'forward_rpc', return_value={'status': 200, 'body': '{"Success":true}'}) as forward:
                result = preview.preview_request(preview.PreviewRequest(post_data=data), self.user)
                forward.assert_called_once_with(data)
                self.assertEqual(result.headers['cache-control'], 'no-store')

    def test_preview_blocks_all_writes_other_games_and_credentials(self):
        base = '&u=FixtureUser&t=fixture-token'
        rejected = ['r='+action+base for action in ['awardachievement', 'startsession', 'ping', 'submitlbentry', 'submitcodenote', 'unlocks', 'patch']]
        rejected += ['r=login2&u=Other&t=fixture-token', 'r=login2&u=FixtureUser&t=other',
                     'r=login2&u=FixtureUser&p=password', 'r=login2'+base+'&r=ping',
                     'r=login2'+base+'&h=1', 'r=achievementsets'+base+'&m=other',
                     'r=achievementsets'+base+'&g=12192', 'bad']
        for data in rejected:
            with self.subTest(data=data), patch.object(preview, 'forward_rpc') as forward:
                with self.assertRaises(HTTPException):
                    preview.preview_request(preview.PreviewRequest(post_data=data), self.user)
                forward.assert_not_called()
        self.assertNotIn('fixture-token', repr(preview.PreviewRequest(post_data='r=login2'+base)))

    def test_disconnected_profile_cannot_read_session_or_forward(self):
        with patch.object(preview, 'saved_session', return_value=None), patch.object(preview, 'forward_rpc') as forward:
            with self.assertRaises(HTTPException) as error:
                preview.preview_session(self.user)
            self.assertEqual(error.exception.status_code, 409)
            with self.assertRaises(HTTPException):
                preview.preview_request(preview.PreviewRequest(post_data='r=login2'), self.user)
            forward.assert_not_called()

    def test_normal_arcade_rooms_still_cannot_use_earning_transport(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(
            owner_user_id=self.user.id, system='arcade', hosting_mode='solo')
        with self.assertRaises(HTTPException) as error:
            play.require_room('PACMAN', self.user, db)
        self.assertEqual(error.exception.status_code, 403)
