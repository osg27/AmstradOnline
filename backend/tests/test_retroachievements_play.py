import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from urllib.error import URLError

from fastapi import HTTPException
from app.api.routes import retroachievements_play as ra
from app.services import retroachievements_session as transport


class RetroAchievementsPlayTests(unittest.TestCase):
    def setUp(self):
        transport._requests.clear()
        self.user = SimpleNamespace(id=17, retroachievements_username='Player')
        self.room = SimpleNamespace(owner_user_id=17, system='megadrive', hosting_mode='solo')
        self.db = MagicMock()
        self.db.query.return_value.filter.return_value.first.return_value = self.room
        self.enterContext(patch.object(ra, 'require_open_solo_room'))

    def payload(self, data='r=login2&u=Player&p=private-password'):
        return ra.ClientRequest(room_code='test', post_data=data)

    def test_rejects_hardcore_unknown_actions_and_duplicate_fields(self):
        for data in ['r=awardachievement&h=1', 'r=submitlbentry', 'r=login2&r=ping', 'r=ping&h=0&h=1', 'bad']:
            with self.subTest(data=data), self.assertRaises(HTTPException):
                ra.validate_rpc(data)
        self.assertEqual(ra.validate_rpc('r=awardachievement&h=0'), 'awardachievement')

    def test_only_supported_solo_owner_can_forward_requests(self):
        for changes in [{'owner_user_id': 18}, {'system': 'x68000'}, {'system': 'snes'}, {'system': 'nes'}, {'system': 'pcengine'}, {'system': 'cpc_party'}, {'hosting_mode': 'multiplayer'}]:
            original = vars(self.room).copy()
            vars(self.room).update(changes)
            with patch.object(transport, 'build_opener') as upstream, self.assertRaises(HTTPException) as error:
                ra.client_request(self.payload(), self.user, self.db)
            self.assertEqual(error.exception.status_code, 403)
            upstream.assert_not_called()
            vars(self.room).update(original)

    def test_fixed_https_transport_preserves_native_response_and_never_caches(self):
        response = io.BytesIO(b'{"Success":true,"Token":"fixture-token"}')
        response.status = 200
        opener = MagicMock(); opener.open.return_value = response
        with patch.object(transport, 'build_opener', return_value=opener):
            result = ra.client_request(self.payload(), self.user, self.db)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, ra.RPC_URL)
        self.assertEqual(request.get_method(), 'POST')
        self.assertNotIn('private-password', request.full_url)
        self.assertEqual(opener.open.call_args.kwargs['timeout'], 10)
        self.assertEqual(result.headers['cache-control'], 'no-store')
        self.assertTrue(json.loads(json.loads(result.body)['body'])['Success'])

    def test_failures_do_not_expose_passwords_or_tokens(self):
        opener = MagicMock(); opener.open.side_effect = URLError('private-password fixture-token')
        with patch.object(transport, 'build_opener', return_value=opener), self.assertRaises(HTTPException) as error:
            ra.client_request(self.payload(), self.user, self.db)
        self.assertEqual(error.exception.status_code, 502)
        self.assertNotIn('private-password', error.exception.detail)
        self.assertNotIn('fixture-token', error.exception.detail)
        self.assertNotIn('private-password', repr(self.payload()))

    def test_login_attempts_are_limited_before_upstream(self):
        transport._requests[self.user.id].extend([(transport.time.monotonic(), 'login2')] * 6)
        with patch.object(transport, 'build_opener') as upstream, self.assertRaises(HTTPException) as error:
            ra.client_request(self.payload(), self.user, self.db)
        self.assertEqual(error.exception.status_code, 429)
        upstream.assert_not_called()

    def test_options_do_not_expose_site_web_api_key(self):
        self.assertEqual(ra.options(self.user), {'username': 'Player', 'connected': False, 'softcore': True})

    def test_cpc_solo_host_can_use_same_transport(self):
        self.room.system = 'cpc'
        with patch.object(ra, 'forward_rpc', return_value={'status': 200, 'body': '{"Success":true}'}) as upstream:
            result = ra.client_request(self.payload('r=startsession&g=1&h=0'), self.user, self.db)
        self.assertEqual(result.status_code, 200)
        upstream.assert_called_once()

    def test_master_system_solo_host_can_use_same_transport(self):
        self.room.system = 'mastersystem'
        with patch.object(ra, 'forward_rpc', return_value={'status': 200, 'body': '{"Success":true}'}) as upstream:
            result = ra.client_request(self.payload('r=startsession&g=1&h=0'), self.user, self.db)
        self.assertEqual(result.status_code, 200)
        upstream.assert_called_once()
