from dataclasses import dataclass
import re
from typing import Callable

from app.highscores.amiga.extractors import battle_squadron, hybris


@dataclass(frozen=True)
class AmigaHighScoreExtractor:
    key: str
    title: str
    filename: str
    parser: str
    title_pattern: re.Pattern
    extract: Callable[[bytes], list[dict]]
    aliases: tuple[str, ...] = ()

    def public_metadata(self) -> dict:
        return {
            "game_key": self.key,
            "title": self.title,
            "filename": self.filename,
            "parser": self.parser,
        }


EXTRACTORS = {
    "battle-squadron": AmigaHighScoreExtractor(
        key="battle-squadron",
        title="Battle Squadron",
        filename="LODSCO",
        parser="battle-squadron-lodsco-v1",
        title_pattern=re.compile(r"battle\s*[-_]?\s*squadron", re.IGNORECASE),
        extract=battle_squadron.extract,
        aliases=("battle_squadron",),
    ),
    "hybris": AmigaHighScoreExtractor(
        key="hybris",
        title="Hybris",
        filename="hybrishigh",
        parser="hybris-whdload-v1",
        title_pattern=re.compile(r"(?:^|[^a-z0-9])hybris(?:[^a-z0-9]|$)", re.IGNORECASE),
        extract=hybris.extract,
    ),
}


def get_extractor(game_key: str) -> AmigaHighScoreExtractor | None:
    normalised = game_key.strip().lower()
    for extractor in EXTRACTORS.values():
        if normalised == extractor.key or normalised in extractor.aliases:
            return extractor
    return None


def resolve_extractor(title: str) -> AmigaHighScoreExtractor | None:
    return next((item for item in EXTRACTORS.values() if item.title_pattern.search(title or "")), None)


def list_extractors() -> list[AmigaHighScoreExtractor]:
    return list(EXTRACTORS.values())
