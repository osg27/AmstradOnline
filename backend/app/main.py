from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.admin import router as admin_router
from app.api.routes.amiga_scores import router as amiga_scores_router
from app.api.routes.auth import router as auth_router
from app.api.routes.feedback import router as feedback_router
from app.api.routes.library_media import router as library_media_router
from app.api.routes.mame import router as mame_router
from app.api.routes.profile import router as profile_router
from app.api.routes.rooms import router as rooms_router
from app.api.routes.scores import router as scores_router
from app.api.routes.social import router as social_router
from app.api.routes.tournaments import router as tournaments_router
from app.core.config import settings
from app.core.database import Base, engine
from app.core.migrations import ensure_runtime_columns
from app.websockets.signaling import router as signaling_router

Base.metadata.create_all(bind=engine)
ensure_runtime_columns(engine)

app = FastAPI(title="Old Style Gaming API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"status": "ok"}


app.include_router(auth_router)
app.include_router(amiga_scores_router)
app.include_router(rooms_router)
app.include_router(feedback_router)
app.include_router(library_media_router)
app.include_router(mame_router)
app.include_router(mame_router, prefix="/scores")
app.include_router(profile_router)
app.include_router(admin_router)
app.include_router(scores_router)
app.include_router(social_router)
app.include_router(tournaments_router)
app.include_router(tournaments_router, prefix="/auth")
app.include_router(signaling_router)
