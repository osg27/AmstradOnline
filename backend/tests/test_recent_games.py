import unittest
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models.play_session import PlaySession
from app.models.user import User
from app.api.routes.profile import get_recent_games, recent_games_for_user


class RecentGamesTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite:///:memory:')
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.db.add_all([
            User(id=1, username='me', email='me@example.com', password_hash='unused', role='user'),
            User(id=2, username='other', email='other@example.com', password_hash='unused', role='user'),
        ])
        self.db.commit()
        self.now = datetime.now(timezone.utc)
        self.next_id = 1

    def tearDown(self):
        self.db.close(); self.engine.dispose()

    def session(self, user_id, system, game, hours_ago, seconds):
        start = self.now - timedelta(hours=hours_ago)
        self.db.add(PlaySession(
            id=self.next_id, room_id=self.next_id, room_code=f'R{self.next_id}', user_id=user_id,
            username='x', host_id=user_id, host_name='x', system=system, game=game, mode='solo',
            is_host=True, started_at=start, last_seen_at=start + timedelta(seconds=seconds),
            duration_seconds=seconds, connected_seconds=0,
        ))
        self.next_id += 1
        self.db.commit()

    def test_groups_by_game_newest_first_and_only_for_the_user(self):
        self.session(1, 'megadrive', 'Sonic.md', 30, 600)
        self.session(1, 'arcade', 'sf2.zip', 5, 120)
        self.session(1, 'megadrive', 'Sonic.md', 2, 300)
        self.session(1, 'cpc', None, 1, 999)
        self.session(2, 'snes', 'Mario.sfc', 0, 50)
        rows = recent_games_for_user(self.db, 1)
        self.assertEqual([row['game'] for row in rows], ['Sonic.md', 'sf2.zip'])
        self.assertEqual(rows[0]['total_seconds'], 900)
        self.assertEqual(rows[0]['sessions'], 2)
        self.assertEqual(rows[0]['system'], 'megadrive')
        self.assertTrue(rows[0]['last_played_at'].endswith('+00:00'))

    def test_route_respects_limit(self):
        for index in range(4):
            self.session(1, 'nes', f'Game{index}.nes', index, 60)
        user = self.db.get(User, 1)
        rows = get_recent_games(limit=2, user=user, db=self.db)
        self.assertEqual([row['game'] for row in rows], ['Game0.nes', 'Game1.nes'])


if __name__ == '__main__':
    unittest.main()
