import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.models.user import User

NOT_VERIFIED = "Verify your email to play online and post scores."


class EmailVerificationGateTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)

        def override_db():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)
        self.mail = patch("app.api.routes.auth.send_email")
        self.send_email = self.mail.start()
        from app.api.routes import auth
        auth.RESEND_COOLDOWN.clear()

    def tearDown(self):
        self.mail.stop()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def signup(self, name="player", verified=False):
        res = self.client.post("/auth/register", json={"username": name, "email": f"{name}@example.com", "password": "password123"})
        self.assertEqual(res.status_code, 200, res.text)
        if verified:
            self.verify(name)
        return {"Authorization": f"Bearer {res.json()['access_token']}"}

    def verify(self, name):
        with self.Session() as db:
            db.query(User).filter(User.username == name).update({"email_verified": True})
            db.commit()

    def assert_blocked(self, res):
        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(res.json()["detail"]["code"], "email_not_verified")
        self.assertEqual(res.json()["detail"]["message"], NOT_VERIFIED)

    # auth
    def test_register_signs_in_and_reports_unverified(self):
        res = self.client.post("/auth/register", json={"username": "newbie", "email": "n@example.com", "password": "password123"})
        body = res.json()
        self.assertEqual(res.status_code, 200)
        self.assertTrue(body["access_token"])
        self.assertFalse(body["email_verified"])
        self.assertTrue(body["email_sent"])
        self.send_email.assert_called_once()
        me = self.client.get("/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}).json()
        self.assertFalse(me["email_verified"])

    def test_register_survives_smtp_failure(self):
        self.send_email.side_effect = RuntimeError("smtp down")
        res = self.client.post("/auth/register", json={"username": "newbie", "email": "n@example.com", "password": "password123"})
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["email_sent"])
        self.assertIn("resend", res.json()["message"])
        with self.Session() as db:
            self.assertIsNotNone(db.query(User).filter(User.username == "newbie").first())

    def test_unverified_user_can_log_in(self):
        self.signup("someone")
        res = self.client.post("/auth/login", json={"username": "someone", "password": "password123"})
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["email_verified"])
        self.verify("someone")
        res = self.client.post("/auth/login", json={"username": "someone", "password": "password123"})
        self.assertTrue(res.json()["email_verified"])

    def test_resend_for_current_user(self):
        headers = self.signup("someone")
        self.send_email.reset_mock()
        res = self.client.post("/auth/resend-verification/me", headers=headers)
        self.assertEqual(res.status_code, 200, res.text)
        self.send_email.assert_called_once()
        # A second call inside the cooldown is rate limited.
        self.assertEqual(self.client.post("/auth/resend-verification/me", headers=headers).status_code, 429)

    def test_resend_for_current_user_reports_failure(self):
        headers = self.signup("someone")
        self.send_email.side_effect = RuntimeError("smtp down")
        self.assertEqual(self.client.post("/auth/resend-verification/me", headers=headers).status_code, 503)

    def test_resend_for_verified_user_is_noop(self):
        headers = self.signup("someone", verified=True)
        self.send_email.reset_mock()
        res = self.client.post("/auth/resend-verification/me", headers=headers)
        self.assertTrue(res.json()["email_verified"])
        self.send_email.assert_not_called()

    # rooms
    def create(self, headers, **body):
        return self.client.post("/rooms/create", json={"system": "cpc", **body}, headers=headers)

    def test_unverified_cannot_create_multiplayer_room(self):
        self.assert_blocked(self.create(self.signup("alpha"), hosting_mode="multiplayer"))
        self.assert_blocked(self.client.post("/rooms/create", json={"system": "cpc"}, headers=self.signup("bravo")))

    def test_unverified_can_create_solo_room_and_reenter_it(self):
        headers = self.signup("alpha")
        res = self.create(headers, hosting_mode="solo")
        self.assertEqual(res.status_code, 200, res.text)
        code = res.json()["room_code"]
        self.assertEqual(self.client.post("/rooms/join", json={"room_code": code}, headers=headers).status_code, 200)

    def test_unverified_can_create_solo_arcade_cabinet(self):
        res = self.create(self.signup("alpha"), system="arcade", hosting_mode="solo")
        self.assertEqual(res.status_code, 200, res.text)

    def test_verified_can_create_and_unverified_cannot_join(self):
        host = self.signup("host", verified=True)
        res = self.create(host, hosting_mode="multiplayer")
        self.assertEqual(res.status_code, 200, res.text)
        code = res.json()["room_code"]
        self.assert_blocked(self.client.post("/rooms/join", json={"room_code": code}, headers=self.signup("guest")))
        guest = self.signup("guest2", verified=True)
        self.assertEqual(self.client.post("/rooms/join", json={"room_code": code}, headers=guest).status_code, 200)

    def test_unverified_cannot_switch_to_multiplayer(self):
        headers = self.signup("alpha")
        code = self.create(headers, hosting_mode="solo").json()["room_code"]
        self.assert_blocked(self.client.post(f"/rooms/{code}/multiplayer", headers=headers))
        self.verify("alpha")
        self.assertEqual(self.client.post(f"/rooms/{code}/multiplayer", headers=headers).status_code, 200)

    def test_unverified_cannot_switch_cabinet_to_multiplayer(self):
        headers = self.signup("alpha")
        code = self.create(headers, system="arcade", hosting_mode="solo").json()["room_code"]
        self.assert_blocked(self.client.patch(f"/rooms/{code}/arcade-mode", json={"multiplayer": True}, headers=headers))
        self.assertEqual(self.client.patch(f"/rooms/{code}/arcade-mode", json={"multiplayer": False}, headers=headers).status_code, 200)

    # scores, tournaments, social
    def test_score_endpoints_blocked_when_unverified(self):
        headers = self.signup("alpha")
        self.assert_blocked(self.client.post("/scores/submit", json={"game": "g", "system": "cpc", "score": 5}, headers=headers))
        self.assert_blocked(self.client.post("/mame/sessions/s1/extract-scores", json={"rom_name": "pacman"}, headers=headers))
        self.assert_blocked(self.client.post("/scores/amiga/extract-score", json={"game_key": "x", "source_path": "a", "data": "", "baseline_data": ""}, headers=headers))

    def test_score_submit_allowed_when_verified(self):
        headers = self.signup("alpha", verified=True)
        res = self.client.post("/scores/submit", json={"game": "g", "system": "cpc", "score": 5}, headers=headers)
        self.assertEqual(res.status_code, 200, res.text)

    def test_tournament_actions_blocked_when_unverified(self):
        headers = self.signup("alpha")
        self.assert_blocked(self.client.post("/tournaments/ABC/join", headers=headers))
        self.assert_blocked(self.client.post("/tournaments/ABC/sessions/s1/extract-score", json={"rom_name": "pacman"}, headers=headers))
        res = self.client.post("/tournaments", data={"name": "Cup", "rom_name": "pacman", "duration_hours": 2},
                               files={"rom_file": ("pacman.zip", b"x")}, headers=headers)
        self.assert_blocked(res)

    def test_tournament_join_reaches_handler_when_verified(self):
        headers = self.signup("alpha", verified=True)
        self.assertEqual(self.client.post("/tournaments/NOPE/join", headers=headers).status_code, 404)

    def test_social_writes_blocked_when_unverified(self):
        headers = self.signup("alpha")
        self.signup("bravo", verified=True)
        self.assert_blocked(self.client.post("/auth/social/messages", json={"message": "hi", "recipient_username": "bravo"}, headers=headers))
        self.assert_blocked(self.client.post("/auth/social/requests", json={"username": "bravo"}, headers=headers))
        self.assert_blocked(self.client.post("/auth/social/friends/2/invite/ABCDEF", headers=headers))

    def test_social_write_allowed_when_verified(self):
        headers = self.signup("alpha", verified=True)
        self.signup("bravo", verified=True)
        self.assertEqual(self.client.post("/auth/social/requests", json={"username": "bravo"}, headers=headers).status_code, 200)


if __name__ == "__main__":
    unittest.main()
