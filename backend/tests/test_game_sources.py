"""Run with unittest; all upstream traffic is mocked, no production DB used."""
import io
import json
import unittest
import zipfile
from contextlib import contextmanager
from unittest.mock import patch

from fastapi import HTTPException
from app.core import source_fetch as fetch
from app.api.routes import game_sources as sources


class Response(io.BytesIO):
    def __init__(self, body, **headers):
        super().__init__(body)
        self.headers = headers

    def getheader(self, name, default=None):
        return self.headers.get(name, default)


@contextmanager
def page(body, content_type="text/html"):
    yield Response(body, **{"Content-Type": content_type}), "https://example.com/games/"


class GameSourceTests(unittest.TestCase):
    def test_private_urls_and_credentials_rejected(self):
        for url in ["http://example.com/", "https://localhost/", "https://127.0.0.1/", "https://[::1]/", "https://10.0.0.1/", "https://user:pass@example.com/", "https://example.com:8080/", "file:///tmp/game.rom"]:
            with self.subTest(url=url), self.assertRaises(HTTPException):
                fetch.public_url(url)

    def test_mixed_public_private_dns_rejected(self):
        with patch.object(fetch.socket, "getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 443)), (2, 1, 6, "", ("192.168.1.1", 443))]):
            with self.assertRaises(HTTPException):
                fetch.resolve_public("example.com")

    def test_unicode_filename_encoded(self):
        self.assertEqual(fetch.public_url("https://example.com/café.rom"), "https://example.com/caf%C3%A9.rom")

    def test_scan_only_fetches_listing_and_deduplicates(self):
        html = b'<a href="game.nes">Play</a><a href="game.nes">Again</a><a href="other.dsk">Other</a><a href="https://127.0.0.1/private.nes">Bad</a>'
        with patch.object(sources, "open_public", return_value=page(html)) as request:
            result = sources.scan_source("https://example.com/games/", "nes")
        self.assertEqual(request.call_count, 1)
        self.assertEqual([g["file_name"] for g in result["games"]], ["game.nes"])

    def test_direct_file_scan_does_not_download(self):
        with patch.object(sources, "open_public") as request:
            result = sources.scan_source("https://example.com/test.mx2", "msx")
        request.assert_not_called()
        self.assertEqual(result["games"][0]["file_name"], "test.mx2")

    def test_large_listing_keeps_games_beyond_old_byte_and_link_limits(self):
        html = b" " * (4 * 1024 * 1024) + b"".join(
            f'<a href="game{i}.z80">Game</a><a href="game{i}.z80">Again</a>'.encode()
            for i in range(12000)
        )
        with patch.object(sources, "open_public", return_value=page(html)) as request:
            result = sources.scan_source("https://example.com/games/", "spectrum")
        self.assertEqual(len(result["games"]), 12000)
        self.assertFalse(result["truncated"])
        self.assertEqual(result["games"][-1]["file_name"], "game11999.z80")
        request.assert_called_once()

    def test_archive_metadata_filters_private_and_oversized_files(self):
        data = {"files": [{"name": "Game A.dsk", "size": "123"}, {"name": "secret.dsk", "private": True}, {"name": "huge.dsk", "size": str(sources.MAX_GAME_BYTES + 1)}]}
        with patch.object(sources, "open_public", return_value=page(json.dumps(data).encode(), "application/json")) as request:
            result = sources.scan_source("https://archive.org/details/example", "msx")
        request.assert_called_once_with("https://archive.org/metadata/example")
        self.assertEqual(len(result["games"]), 1)
        self.assertTrue(result["games"][0]["url"].endswith("Game%20A.dsk"))

    def test_size_and_truncation_checks(self):
        for body, length, limit in [(b"abc", "3", 2), (b"abc", "5", 10), (b"abc", "0", 2)]:
            with self.subTest(length=length), self.assertRaises(HTTPException):
                list(fetch.bounded_chunks(Response(body, **{"Content-Length": length}), limit))

    def test_html_disguised_as_game_rejected(self):
        with patch.object(sources, "open_public", return_value=page(b"<!doctype html><html>login", "application/octet-stream")):
            with self.assertRaises(HTTPException):
                sources.download_file("https://example.com/game.rom", "msx")

    def test_download_preserves_filename_and_bytes(self):
        with patch.object(sources, "open_public", return_value=page(b"game bytes", "application/octet-stream")):
            file, length, name = sources.download_file("https://example.com/Game%20A.dsk", "msx")
        try:
            self.assertEqual((file.read(), length, name), (b"game bytes", 10, "Game A.dsk"))
        finally:
            file.close()

    def test_zip_traversal_rejected(self):
        file = io.BytesIO()
        with zipfile.ZipFile(file, "w") as archive:
            archive.writestr("../game.rom", b"test")
        file.seek(0)
        with self.assertRaises(HTTPException):
            sources.validate_zip(file)

    def test_system_authorization_is_server_side(self):
        with patch.object(sources, "require_system_access", side_effect=HTTPException(403, "Restricted")), patch.object(sources, "scan_source") as scan:
            with self.assertRaises(HTTPException) as error:
                sources.scan(sources.SourceRequest(url="https://example.com/", system="msx"), None, 123)
        self.assertEqual(error.exception.status_code, 403)
        scan.assert_not_called()

    def test_concurrent_user_requests_blocked_and_released(self):
        with sources.operation(99999, "scan"):
            with self.assertRaises(HTTPException) as error:
                sources.acquire_operation(99999, "download")
            self.assertEqual(error.exception.status_code, 429)
        with sources.operation(99999, "scan"):
            pass
