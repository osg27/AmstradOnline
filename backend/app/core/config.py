from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    CORS_ORIGINS: list[str] | str = ["http://localhost:5173"]
    ADMIN_USERNAME: str | None = None
    TESTER_USERNAMES: list[str] | str = ["Lucarse", "LesleyM", "Fenryr"]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, value):
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("TESTER_USERNAMES", mode="before")
    @classmethod
    def parse_tester_usernames(cls, value):
        if isinstance(value, str):
            return [username.strip() for username in value.split(",") if username.strip()]
        return value


settings = Settings()
