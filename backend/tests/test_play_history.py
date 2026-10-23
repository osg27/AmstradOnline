import unittest
from datetime import datetime, timedelta, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from fastapi import HTTPException
from app.core.database import Base
from app.models.user import User
from app.models.room import Room
from app.models.play_session import PlaySession
from app.core.play_history import record_heartbeat, record_leave, serialize_session
from app.api.routes.admin import get_play_history, require_admin


class PlayHistoryTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite:///:memory:')
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.db.add_all([User(id=1, username='host', email='host@example.com', password_hash='unused', role='user'), User(id=2, username='guest', email='guest@example.com', password_hash='unused', role='user')])
        self.room = Room(id=1, room_code='ABC123', owner_user_id=1, system='c64', hosting_mode='multiplayer', current_game='Game.crt')
        self.db.add(self.room); self.db.commit()
        self.now = datetime.now(timezone.utc)

    def tearDown(self):
        self.db.close(); self.engine.dispose()

    def beat(self, seconds, user=1, connected=False):
        record_heartbeat(self.db, self.room, user, self.now + timedelta(seconds=seconds), connected)
        self.db.commit()

    def test_host_and_guest_and_connection_duration(self):
        self.beat(0, connected=True); self.beat(5, user=2, connected=True)
        self.beat(15, connected=True); self.beat(20, user=2, connected=True)
        rows = self.db.query(PlaySession).order_by(PlaySession.id).all()
        self.assertEqual(len(rows), 2)
        self.assertTrue(rows[0].is_host); self.assertFalse(rows[1].is_host)
        self.assertEqual(rows[0].connected_seconds, 15)
        self.assertEqual(rows[1].game, 'Game.crt')
        self.assertEqual(rows[1].host_name, 'host')

    def test_timeout_does_not_count_absent_time_and_rejoin_is_new_session(self):
        self.beat(0); self.beat(15)
        row = self.db.query(PlaySession).one()
        result = serialize_session(row, self.now + timedelta(hours=3))
        self.assertEqual(result['duration_seconds'], 15)
        self.assertEqual(result['end_reason'], 'heartbeat_timeout')
        self.beat(180)
        self.assertEqual(self.db.query(PlaySession).count(), 2)
        self.assertEqual(row.end_reason, 'heartbeat_timeout')

    def test_game_change_and_leave_preserve_history(self):
        self.beat(0); self.beat(15)
        self.room.current_game = 'Next.crt'
        self.beat(20)
        record_leave(self.db, 1, 1); self.db.commit()
        rows = self.db.query(PlaySession).order_by(PlaySession.id).all()
        self.assertEqual([row.game for row in rows], ['Game.crt', 'Next.crt'])
        self.assertEqual(rows[0].end_reason, 'game_or_mode_changed')
        self.assertEqual(rows[1].end_reason, 'left_room')
        self.db.delete(self.room); self.db.commit()
        self.assertEqual(self.db.query(PlaySession).count(), 2)

    def test_solo_cannot_report_peer_and_mode_change_splits_session(self):
        self.room.hosting_mode = 'solo'
        self.beat(0, connected=True)
        self.assertFalse(self.db.query(PlaySession).one().ever_connected)
        self.room.hosting_mode = 'multiplayer'
        self.beat(15, connected=True)
        self.assertEqual(self.db.query(PlaySession).count(), 2)

    def test_admin_filter_and_summary_do_not_double_count_guests(self):
        self.beat(0, connected=True); self.beat(0, user=2, connected=True)
        self.beat(30, connected=True); self.beat(30, user=2, connected=True)
        args = dict(db=self.db, admin_user=self.db.get(User, 1), offset=0, limit=25, search='', system='', mode='', connected=None, since=None, until=None, room_code='')
        result = get_play_history(**args)
        self.assertEqual(result['summary'], {'rooms': 1, 'players': 2, 'game_seconds': 30, 'connected_rooms': 1})
        self.assertEqual(result['daily'][0]['seconds'], 30)
        self.assertEqual(get_play_history(**{**args, 'search': 'guest'})['total'], 1)
        self.assertEqual(get_play_history(**{**args, 'system': 'nes'})['total'], 0)
        with self.assertRaises(HTTPException) as error:
            require_admin(self.db.get(User, 2))
        self.assertEqual(error.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
