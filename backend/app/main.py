from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.auth import router as auth_router
from app.api.routes.rooms import router as rooms_router
from app.core.config import settings
from app.core.database import Base, engine
from app.websockets.signaling import router as signaling_router

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Amstrad Multiplayer API")

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
app.include_router(signaling_router)
