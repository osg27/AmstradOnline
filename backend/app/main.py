from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.admin import router as admin_router
from app.api.routes.auth import router as auth_router
from app.api.routes.feedback import router as feedback_router
from app.api.routes.library_media import router as library_media_router
from app.api.routes.mame import router as mame_router
from app.api.routes.rooms import router as rooms_router
from app.api.routes.scores import router as scores_router
from app.api.routes.social import router as social_router
from app.api.routes.tournaments import router as tournaments_router
from app.api.routes.vip_amiga import router as vip_amiga_router
from app.api.routes.vip_amstrad import router as vip_amstrad_router
from app.api.routes.vip_c64 import router as vip_c64_router
from app.api.routes.vip_mame import router as vip_mame_router
from app.api.routes.vip_mastersystem import router as vip_mastersystem_router
from app.api.routes.vip_nes import router as vip_nes_router
from app.api.routes.vip_megadrive import router as vip_megadrive_router
from app.api.routes.vip_pcengine import router as vip_pcengine_router
from app.api.routes.vip_spectrum import router as vip_spectrum_router
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
app.include_router(rooms_router)
app.include_router(feedback_router)
app.include_router(library_media_router)
app.include_router(mame_router)
app.include_router(mame_router, prefix="/scores")
app.include_router(admin_router)
app.include_router(scores_router)
app.include_router(social_router)
app.include_router(tournaments_router)
app.include_router(tournaments_router, prefix="/auth")
app.include_router(vip_mame_router)
app.include_router(vip_mastersystem_router)
app.include_router(vip_nes_router)
app.include_router(vip_c64_router)
app.include_router(vip_amiga_router)
app.include_router(vip_amstrad_router)
app.include_router(vip_spectrum_router)
app.include_router(vip_megadrive_router)
app.include_router(vip_pcengine_router)
app.include_router(signaling_router)
