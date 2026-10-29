import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from app.api.routes import rooms


class MultiplayerPromotionTests(unittest.TestCase):
    def setUp(self):
        self.room = SimpleNamespace(
            room_code='X68ABC', owner_user_id=1, status='waiting', system='x68000',
            hosting_mode='solo', hosting_started_at=None, party_max_players=2,
            arcade_multiplayer=False, current_game='Chourensha68k.hdf',
            is_private=False, password_hash=None,
        )
        self.db = MagicMock()
        room_query = MagicMock()
        room_query.filter.return_value.with_for_update.return_value.first.return_value = self.room
        self.db.query.side_effect = lambda model: room_query if model is rooms.Room else MagicMock()
        self.access = self.enterContext(patch.object(rooms, 'require_system_access'))
        self.open_room = self.enterContext(patch.object(rooms, 'require_open_solo_room'))
        self.allowance = self.enterContext(patch.object(rooms, 'require_multiplayer_hosting_allowance'))

    def test_promotes_same_room_without_losing_game(self):
        result = rooms.open_multiplayer_room('x68abc', self.db, 1)
        self.assertEqual(result.room_code, 'X68ABC')
        self.assertEqual(result.hosting_mode, 'multiplayer')
        self.assertEqual(self.room.current_game, 'Chourensha68k.hdf')
        self.assertIsNotNone(self.room.hosting_started_at)
        self.access.assert_called_once_with(self.db, 1, 'x68000', creating=True)
        self.allowance.assert_called_once()
        self.db.add.assert_not_called()
        self.db.commit.assert_called_once()

    def test_guest_cannot_promote_room(self):
        with self.assertRaises(HTTPException) as result:
            rooms.open_multiplayer_room('X68ABC', self.db, 2)
        self.assertEqual(result.exception.status_code, 403)
        self.assertEqual(self.room.hosting_mode, 'solo')
        self.allowance.assert_not_called()

    def test_repeated_request_does_not_charge_allowance_again(self):
        self.room.hosting_mode = 'multiplayer'
        result = rooms.open_multiplayer_room('X68ABC', self.db, 1)
        self.assertEqual(result.hosting_mode, 'multiplayer')
        self.allowance.assert_not_called()
        self.db.commit.assert_not_called()

    def test_hosting_limit_keeps_room_solo_and_game_intact(self):
        self.allowance.side_effect = HTTPException(403, 'Hosting limit reached')
        with self.assertRaises(HTTPException):
            rooms.open_multiplayer_room('X68ABC', self.db, 1)
        self.assertEqual(self.room.hosting_mode, 'solo')
        self.assertEqual(self.room.current_game, 'Chourensha68k.hdf')
        self.db.commit.assert_not_called()
