import hashlib
import os
import re
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user, is_admin_user
from app.core.database import get_db
from app.models.link_game import LinkGame
from app.models.user import User


router = APIRouter(prefix='/auth/link-games', tags=['link-games'])
DISK_ROOT = Path(os.getenv('LINK_GAMES_DIR', str(Path(__file__).resolve().parents[3] / 'storage' / 'link-games'))).resolve()
ADF_BYTES = 901120


def require_link_admin(user: User = Depends(get_current_user)) -> User:
    if not is_admin_user(user):
        raise HTTPException(403, 'Admin access required to manage Link Games')
    return user


def describe(game: LinkGame) -> dict:
    return {key: getattr(game, key) for key in ('id', 'title', 'file_name', 'sha256', 'size', 'notes')}


def find_game(game_id: str, db: Session) -> LinkGame:
    if not re.fullmatch(r'[a-f0-9]{32}', game_id):
        raise HTTPException(404, 'Link game not found')
    game = db.query(LinkGame).filter(LinkGame.id == game_id, LinkGame.published.is_(True)).first()
    if not game:
        raise HTTPException(404, 'This Link Game is no longer available')
    return game


@router.get('')
def list_link_games(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    games = db.query(LinkGame).filter(LinkGame.published.is_(True)).order_by(LinkGame.title, LinkGame.id).all()
    return {'games': [describe(game) for game in games]}


@router.get('/{game_id}/disk')
def download_link_disk(game_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    game = find_game(game_id, db)
    path = DISK_ROOT / f'{game.sha256}.adf'
    if not path.is_file():
        raise HTTPException(404, 'This game disk is missing from server storage. Ask an admin to upload it again.')
    return FileResponse(path, media_type='application/octet-stream', filename=game.file_name,
                        headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})


@router.get('/{game_id}')
def get_link_game(game_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return describe(find_game(game_id, db))


@router.post('', status_code=201)
async def upload_link_game(
    title: str = Form(..., min_length=1, max_length=120),
    notes: str = Form('', max_length=500), file: UploadFile = File(...),
    db: Session = Depends(get_db), user: User = Depends(require_link_admin),
):
    title = title.strip()
    name = (file.filename or '').replace('\\', '/').split('/')[-1]
    if not title or not name.lower().endswith('.adf') or len(name) > 240 or any(ord(c) < 32 for c in name):
        raise HTTPException(422, 'Enter a title and choose an ADF disk file')
    try:
        data = await file.read(ADF_BYTES + 1)
    finally:
        await file.close()
    if len(data) != ADF_BYTES:
        raise HTTPException(422, 'Choose a standard 880 KB ADF floppy image. Kickstart ROMs, WHDLoad archives and other file types are not accepted.')
    checksum = hashlib.sha256(data).hexdigest()
    DISK_ROOT.mkdir(parents=True, exist_ok=True)
    target = DISK_ROOT / f'{checksum}.adf'
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=DISK_ROOT, suffix='.tmp', delete=False) as output:
            temporary = Path(output.name)
            output.write(data)
        temporary.replace(target)
        game = LinkGame(id=uuid.uuid4().hex, title=title, notes=notes.strip(), file_name=name,
                        sha256=checksum, size=len(data))
        db.add(game)
        db.commit()
        db.refresh(game)
    except Exception:
        db.rollback()
        raise
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return describe(game)


@router.delete('/{game_id}')
def remove_link_game(game_id: str, db: Session = Depends(get_db), user: User = Depends(require_link_admin)):
    game = find_game(game_id, db)
    game.published = False
    db.commit()
    # Keep the content-addressed disk: another published entry can reference it.
    return {'removed': True}
