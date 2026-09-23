from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.routes.rooms import create_room, join_room, update_room, update_arcade_mode, room_heartbeat, get_room
from app.api.routes.tournaments import can_manage_tournament, delete_tournament, reset_tournament_leaderboard
from app.api.routes.social import invite_friend_to_room
from app.core.database import Base
from app.core.entitlements import has_entitlement, require_system_early_access
from app.models.user import User, UserEntitlement
from app.schemas.room import RoomCreateRequest, RoomJoinRequest, RoomUpdateRequest, ArcadeModeUpdateRequest
from app.models.room import Room, RoomActivity
from app.models.friendship import Friendship
from app.models.tournament import Tournament
from app.schemas.room import RoomHeartbeatRequest


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def add_user(db, name, plan="FREE"):
    user = User(username=name, email=f"{name}@example.com", password_hash="unused", plan=plan)
    db.add(user)
    db.commit()
    return user


def test_free_cannot_craft_private_or_large_room_requests(db):
    user = add_user(db, "freeplayer")
    for payload in (
        RoomCreateRequest(system="cpc", is_private=True),
        RoomCreateRequest(system="cpc_party", party_max_players=8),
        RoomCreateRequest(system="cpc", password="secret"),
    ):
        with pytest.raises(HTTPException) as error:
            create_room(payload, db, user.id)
        assert error.value.status_code == 403

    room = create_room(RoomCreateRequest(system="cpc_party", party_max_players=4), db, user.id)
    with pytest.raises(HTTPException) as error:
        update_room(room.room_code, RoomUpdateRequest(system="cpc_party", party_max_players=8), db, user.id)
    assert error.value.status_code == 403


def test_supporter_plan_and_individual_grant(db):
    supporter = add_user(db, "supporter", "SUPPORTER")
    gifted = add_user(db, "gifted")
    db.add(UserEntitlement(user_id=gifted.id, entitlement="private_rooms"))
    db.commit()
    assert has_entitlement(supporter, db, "create_tournaments")
    assert has_entitlement(gifted, db, "private_rooms")
    assert not has_entitlement(gifted, db, "create_tournaments")
    room = create_room(RoomCreateRequest(system="cpc_party", party_max_players=8,
                                         is_private=True, password="secret"), db, supporter.id)
    with pytest.raises(HTTPException) as error:
        join_room(RoomJoinRequest(room_code=room.room_code), db, gifted.id)
    assert error.value.status_code == 403
    assert join_room(RoomJoinRequest(room_code=room.room_code, password="secret"), db, gifted.id).is_private


def test_solo_launches_do_not_use_multiplayer_allowance(db):
    host = add_user(db, "solo_host")
    guest = add_user(db, "solo_guest")
    for _ in range(15):
        solo = create_room(RoomCreateRequest(system="arcade", hosting_mode="solo"), db, host.id)
        with pytest.raises(HTTPException) as error:
            join_room(RoomJoinRequest(room_code=solo.room_code), db, guest.id)
        assert error.value.status_code == 403

    hosted = [create_room(RoomCreateRequest(system="cpc"), db, host.id) for _ in range(12)]
    assert all(room.hosting_mode == "multiplayer" for room in hosted)
    with pytest.raises(HTTPException) as error:
        create_room(RoomCreateRequest(system="cpc"), db, host.id)
    assert error.value.status_code == 403
    assert create_room(RoomCreateRequest(system="cpc", hosting_mode="solo"), db, host.id).hosting_mode == "solo"


def test_arcade_conversion_uses_multiplayer_allowance(db):
    host = add_user(db, "cabinet_host")
    solo = create_room(RoomCreateRequest(system="arcade", hosting_mode="solo"), db, host.id)
    for _ in range(12):
        create_room(RoomCreateRequest(system="cpc"), db, host.id)
    with pytest.raises(HTTPException) as error:
        update_arcade_mode(solo.room_code, ArcadeModeUpdateRequest(multiplayer=True), db, host.id)
    assert error.value.status_code == 403
    assert db.query(Room).filter(Room.room_code == solo.room_code).first().hosting_mode == "solo"


def test_early_access_registry_can_protect_future_systems(db, monkeypatch):
    import app.core.entitlements as entitlements
    free = add_user(db, "early_free")
    supporter = add_user(db, "early_supporter", "SUPPORTER")
    monkeypatch.setattr(entitlements, "EARLY_ACCESS_SYSTEMS", frozenset({"nes"}))
    with pytest.raises(HTTPException) as error:
        require_system_early_access(free, db, "nes")
    assert error.value.status_code == 403
    require_system_early_access(supporter, db, "nes")


def test_msx_preview_is_enforced_for_admins_on_the_backend(db):
    regular = add_user(db, "msx_regular")
    admin = add_user(db, "msx_admin")
    admin.role = "admin"
    db.commit()

    with pytest.raises(HTTPException) as error:
        create_room(RoomCreateRequest(system="msx", hosting_mode="solo"), db, regular.id)
    assert error.value.status_code == 403

    room = create_room(RoomCreateRequest(system="msx", hosting_mode="solo"), db, admin.id)
    assert room.system == "msx"


def test_solo_burst_is_rate_limited_for_every_plan(db):
    for plan in ("FREE", "SUPPORTER"):
        user = add_user(db, f"burst_{plan.lower()}", plan)
        for _ in range(20):
            create_room(RoomCreateRequest(system="cpc", hosting_mode="solo"), db, user.id)
        with pytest.raises(HTTPException) as error:
            create_room(RoomCreateRequest(system="cpc", hosting_mode="solo"), db, user.id)
        assert error.value.status_code == 429
        assert error.value.headers["Retry-After"] == "60"


def test_solo_active_limit_and_idle_expiry(db):
    user = add_user(db, "active_solo")
    for _ in range(12):
        room = create_room(RoomCreateRequest(system="cpc", hosting_mode="solo"), db, user.id)
        room_heartbeat(room.room_code, RoomHeartbeatRequest(), db, user.id)
    with pytest.raises(HTTPException) as error:
        create_room(RoomCreateRequest(system="cpc", hosting_mode="solo"), db, user.id)
    assert error.value.status_code == 429

    old_room = db.query(Room).filter(Room.room_code == room.room_code).first()
    old_room.created_at = datetime.now(timezone.utc) - timedelta(hours=13)
    db.query(RoomActivity).filter(RoomActivity.room_id == old_room.id).delete()
    db.commit()
    with pytest.raises(HTTPException) as error:
        get_room(old_room.room_code, db, user.id)
    assert error.value.status_code == 410
    assert old_room.status == "expired"


def test_tournament_owner_can_manage_after_downgrade(db):
    creator = add_user(db, "former_supporter", "SUPPORTER")
    stranger = add_user(db, "tournament_stranger")
    now = datetime.now(timezone.utc)
    tournament = Tournament(
        code="OWNER001", name="Owned tournament", creator_user_id=creator.id,
        rom_name="pacman", display_name="Pac-Man", starts_at=now,
        ends_at=now + timedelta(days=1),
    )
    db.add(tournament)
    db.commit()
    creator.plan = "FREE"
    db.commit()
    assert can_manage_tournament(tournament, creator)
    assert not can_manage_tournament(tournament, stranger)
    with pytest.raises(HTTPException) as error:
        reset_tournament_leaderboard(tournament.code, stranger, db)
    assert error.value.status_code == 403
    assert reset_tournament_leaderboard(tournament.code, creator, db) == {"deleted": 0}
    assert delete_tournament(tournament.code, creator, db)["deleted"] is True


def test_private_room_invite_requires_host(db):
    host = add_user(db, "private_host", "SUPPORTER")
    outsider = add_user(db, "private_outsider")
    recipient = add_user(db, "private_recipient")
    db.add(Friendship(requester_id=outsider.id, addressee_id=recipient.id, status="accepted"))
    db.add(Friendship(requester_id=host.id, addressee_id=recipient.id, status="accepted"))
    db.commit()
    room = create_room(RoomCreateRequest(system="cpc", is_private=True), db, host.id)
    with pytest.raises(HTTPException) as error:
        invite_friend_to_room(recipient.id, room.room_code, db, outsider)
    assert error.value.status_code == 403
    assert invite_friend_to_room(recipient.id, room.room_code, db, host)["message"] == "Room invite sent"


def test_large_solo_cabinet_cannot_be_opened_after_entitlement_expires(db):
    host = add_user(db, "former_large_host", "SUPPORTER")
    room = create_room(RoomCreateRequest(system="arcade", hosting_mode="solo", party_max_players=20), db, host.id)
    host.plan = "FREE"
    db.commit()
    with pytest.raises(HTTPException) as error:
        update_arcade_mode(room.room_code, ArcadeModeUpdateRequest(multiplayer=True), db, host.id)
    assert error.value.status_code == 403
