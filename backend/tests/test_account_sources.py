import unittest
from unittest.mock import patch
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.core.database import Base
from app.models.user import User
from app.api.routes import game_sources as routes


class AccountSourceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite:///:memory:')
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.db.add_all([User(id=1, username='first', email='first@example.com', password_hash='unused'), User(id=2, username='second', email='second@example.com', password_hash='unused')])
        self.db.commit()
        self.access = patch.object(routes, 'require_system_access')
        self.access.start()
        self.scan = patch.object(routes, 'scan_source', return_value={'games': [{'url': 'https://example.com/Game.nes', 'file_name': 'Game.nes', 'title': 'Game'}], 'truncated': False})
        self.scan_mock = self.scan.start()
        routes._recent.clear()

    def tearDown(self):
        self.scan.stop(); self.access.stop()
        self.db.close(); self.engine.dispose()

    def save(self, **extra):
        return routes.save_source(routes.SaveSourceRequest(url='https://example.com/games/', system='nes', **extra), self.db, 1)['source']

    def test_new_device_gets_same_catalogue_without_rescanning(self):
        saved = self.save()
        with Session(self.engine) as phone:
            manifest = routes.list_saved_sources(phone, 1)['sources']
            self.assertNotIn('games', manifest[0])
            self.assertEqual(manifest[0]['gameCount'], 1)
            self.assertEqual(routes.get_saved_source(saved['id'], phone, 1)['games'], saved['games'])
        self.scan_mock.assert_called_once()

    def test_other_account_cannot_read_or_unlink_source(self):
        saved = self.save()
        self.assertEqual(routes.list_saved_sources(self.db, 2)['sources'], [])
        for action in (routes.get_saved_source, routes.delete_saved_source):
            with self.assertRaises(HTTPException) as error:
                action(saved['id'], self.db, 2)
            self.assertEqual(error.exception.status_code, 404)

    def test_migration_preserves_id_but_cannot_resurrect_unlink(self):
        saved = self.save(id='legacy-browser-id', migration=True)
        self.assertEqual(saved['id'], 'legacy-browser-id')
        routes.delete_saved_source(saved['id'], self.db, 1)
        self.assertIsNone(self.save(id='legacy-browser-id', migration=True))
        self.assertEqual(routes.list_saved_sources(self.db, 1)['sources'], [])
        self.assertEqual(self.scan_mock.call_count, 1)
        self.assertIsNotNone(self.save())  # Explicit relink remains possible.

    def test_duplicate_link_is_idempotent_and_rescan_changes_revision(self):
        saved = self.save()
        same = self.save()
        self.assertEqual(saved['revision'], same['revision'])
        changed = self.save(refresh=True)
        self.assertNotEqual(changed['revision'], saved['revision'])
        self.assertEqual(changed['id'], saved['id'])
        self.assertEqual(self.scan_mock.call_count, 2)

    def test_rejected_rescan_preserves_existing_catalogue(self):
        saved = self.save()
        self.scan_mock.return_value = {'games': [], 'truncated': False}
        with self.assertRaises(HTTPException):
            self.save(refresh=True)
        self.assertEqual(routes.get_saved_source(saved['id'], self.db, 1)['revision'], saved['revision'])


if __name__ == '__main__':
    unittest.main()
