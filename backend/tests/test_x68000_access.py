import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from app.api.routes import rooms


class X68000AccessTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(id=2)

    def test_regular_guest_can_access_x68000_room(self):
        with patch.object(rooms, 'is_super_admin_user', return_value=False):
            rooms.require_system_access(self.db, 2, 'x68000')

    def test_regular_user_can_create_x68000_room_and_link_sources(self):
        with patch.object(rooms, 'is_super_admin_user', return_value=False):
            rooms.require_system_access(self.db, 2, 'x68000', creating=True)

    def test_super_admin_can_create_x68000_room(self):
        with patch.object(rooms, 'is_super_admin_user', return_value=True):
            rooms.require_system_access(self.db, 2, 'x68000', creating=True)

    def test_unknown_user_cannot_join(self):
        self.db.query.return_value.filter.return_value.first.return_value = None
        with self.assertRaises(HTTPException) as result:
            rooms.require_system_access(self.db, 2, 'x68000')
        self.assertEqual(result.exception.status_code, 401)
