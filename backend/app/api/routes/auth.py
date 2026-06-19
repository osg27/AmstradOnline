import hashlib
import logging
import secrets
from datetime import datetime, timezone
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.email import send_email
from app.core.security import create_access_token, decode_access_token, hash_password, verify_password
from app.models.user import AccountToken, User
from app.schemas.auth import (
    AuthResponse,
    EmailRequest,
    LoginRequest,
    PasswordResetRequest,
    RegisterRequest,
    TokenRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)
VERIFY_EMAIL = "verify_email"
RESET_PASSWORD = "reset_password"


def is_super_admin_user(user: User) -> bool:
    return user.username.lower() == settings.SUPER_ADMIN_USERNAME.lower()


def is_admin_user(user: User) -> bool:
    return user.role == "admin" or is_super_admin_user(user) or bool(
        settings.ADMIN_USERNAME and user.username.lower() == settings.ADMIN_USERNAME.lower()
    )


def is_tester_user(user: User) -> bool:
    return user.role == "tester"


def is_xyphoe_user(user: User) -> bool:
    return user.role == "xyphoe"


def initial_role_for_username(username: str) -> str:
    normalized = username.lower()
    if normalized == settings.SUPER_ADMIN_USERNAME.lower() or (
        settings.ADMIN_USERNAME and normalized == settings.ADMIN_USERNAME.lower()
    ):
        return "admin"
    return "user"


def can_use_preview_systems(user: User) -> bool:
    return is_admin_user(user) or is_tester_user(user)


def hash_account_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_account_token(db: Session, user: User, purpose: str, expires_minutes: int) -> str:
    db.query(AccountToken).filter(
        AccountToken.user_id == user.id,
        AccountToken.purpose == purpose,
        AccountToken.used_at.is_(None),
    ).delete(synchronize_session=False)

    token = secrets.token_urlsafe(32)
    db.add(
        AccountToken(
            user_id=user.id,
            token_hash=hash_account_token(token),
            purpose=purpose,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=expires_minutes),
        )
    )
    return token


def use_account_token(db: Session, token: str, purpose: str) -> tuple[AccountToken, User]:
    account_token = (
        db.query(AccountToken)
        .filter(
            AccountToken.token_hash == hash_account_token(token),
            AccountToken.purpose == purpose,
            AccountToken.used_at.is_(None),
            AccountToken.expires_at > datetime.now(timezone.utc),
        )
        .first()
    )
    if not account_token:
        raise HTTPException(status_code=400, detail="This link is invalid or has expired")

    user = db.query(User).filter(User.id == account_token.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="This link is invalid or has expired")
    return account_token, user


def send_verification_email(user: User, token: str) -> None:
    app_url = settings.APP_BASE_URL or settings.PUBLIC_APP_URL
    link = f"{app_url.rstrip('/')}/verify-email?token={token}"
    send_email(
        user.email,
        "Verify your Old Style Gaming account",
        f"Hello {user.username},\n\nVerify your email address by opening this link:\n{link}\n\n"
        "This link expires in 24 hours. If you did not create this account, you can ignore this email.",
    )


def send_password_reset_email(user: User, token: str) -> None:
    app_url = settings.APP_BASE_URL or settings.PUBLIC_APP_URL
    link = f"{app_url.rstrip('/')}/reset-password?token={token}"
    send_email(
        user.email,
        "Reset your Old Style Gaming password",
        f"Hello {user.username},\n\nReset your password by opening this link:\n{link}\n\n"
        "This link expires in one hour. If you did not request this, you can ignore this email.",
    )


def get_current_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = authorization.split(" ", 1)[1]
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user


@router.post("/register")
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    existing_user = (
        db.query(User)
        .filter(or_(User.username == payload.username, User.email == payload.email))
        .first()
    )
    if existing_user:
        raise HTTPException(status_code=400, detail="Username or email already exists")

    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        email_verified=False,
        role=initial_role_for_username(payload.username),
    )
    db.add(user)
    db.flush()
    verification_token = create_account_token(db, user, VERIFY_EMAIL, 24 * 60)
    try:
        send_verification_email(user, verification_token)
    except Exception:
        logger.exception("Could not send verification email")
        db.rollback()
        raise HTTPException(status_code=503, detail="Could not send verification email. Please try again.")
    db.commit()
    return {"message": "Check your email to verify your account"}


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user.email_verified:
        raise HTTPException(status_code=403, detail="Please verify your email before signing in")

    user.last_login_at = datetime.now(timezone.utc)
    user.login_count = (user.login_count or 0) + 1
    db.commit()
    db.refresh(user)

    token = create_access_token(str(user.id))
    return AuthResponse(
        access_token=token,
        username=user.username,
        is_admin=is_admin_user(user),
        is_super_admin=is_super_admin_user(user),
        is_tester=is_tester_user(user),
        is_xyphoe=is_xyphoe_user(user),
    )


@router.post("/verify-email")
def verify_email(payload: TokenRequest, db: Session = Depends(get_db)):
    account_token, user = use_account_token(db, payload.token, VERIFY_EMAIL)
    user.email_verified = True
    account_token.used_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Email verified. You can now sign in."}


@router.post("/resend-verification")
def resend_verification(payload: EmailRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user and not user.email_verified:
        token = create_account_token(db, user, VERIFY_EMAIL, 24 * 60)
        try:
            send_verification_email(user, token)
            db.commit()
        except Exception:
            logger.exception("Could not resend verification email")
            db.rollback()
    return {"message": "If that account needs verification, a new email has been sent."}


@router.post("/forgot-password")
def forgot_password(payload: EmailRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user:
        token = create_account_token(db, user, RESET_PASSWORD, 60)
        try:
            send_password_reset_email(user, token)
            db.commit()
        except Exception:
            logger.exception("Could not send password reset email")
            db.rollback()
    return {"message": "If that email is registered, a password reset link has been sent."}


@router.post("/reset-password")
def reset_password(payload: PasswordResetRequest, db: Session = Depends(get_db)):
    account_token, user = use_account_token(db, payload.token, RESET_PASSWORD)
    user.password_hash = hash_password(payload.password)
    account_token.used_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Password changed. You can now sign in."}


@router.get("/me")
def get_me(user: User = Depends(get_current_user)):
    return {
        "id": user.id,
        "username": user.username,
        "is_admin": is_admin_user(user),
        "is_super_admin": is_super_admin_user(user),
        "is_tester": is_tester_user(user),
        "is_xyphoe": is_xyphoe_user(user),
    }
