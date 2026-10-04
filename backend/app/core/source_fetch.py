"""Bounded public HTTPS requests for user-selected game sources.

DNS is checked and the connection is pinned to the checked address. Every
redirect is checked again. Never forward cookies, credentials or app tokens.
"""
import http.client
import ipaddress
import socket
import ssl
import time
from contextlib import contextmanager
from urllib.parse import quote, urljoin, urlsplit, urlunsplit

from fastapi import HTTPException

MAX_REDIRECTS = 4
SOCKET_TIMEOUT = 10


def is_public_address(value):
    address = ipaddress.ip_address(value)
    return address.is_global and not address.is_multicast and not address.is_reserved and not (
        isinstance(address, ipaddress.IPv6Address) and (address.sixtofour or address.teredo)
    )


def public_url(value: str) -> str:
    try:
        if len(value) > 4096 or any(ord(char) < 33 or ord(char) == 127 for char in value) or "\\" in value:
            raise ValueError()
        parts = urlsplit(value)
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or parts.port not in (None, 443):
            raise ValueError()
        host = parts.hostname.encode("idna").decode("ascii").lower().rstrip(".")
        if "%" in host or host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
            raise ValueError()
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            address = None
        if address and not is_public_address(str(address)):
            raise ValueError()
        netloc = f"[{host}]" if ":" in host else host
        return urlunsplit(("https", netloc, quote(parts.path or "/", safe="/%:@!$&'()*+,;=-._~"), quote(parts.query, safe="/%?:@!$&'()*+,;=-._~"), ""))
    except (ValueError, UnicodeError):
        raise HTTPException(400, "Use a public HTTPS URL without credentials or a custom port") from None


def resolve_public(host: str) -> str:
    try:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
    except OSError:
        raise HTTPException(502, "The source hostname could not be resolved") from None
    if not addresses or any(not is_public_address(address) for address in addresses):
        raise HTTPException(400, "Private and local network addresses are not permitted")
    return sorted(addresses)[0]


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, address):
        super().__init__(host, timeout=SOCKET_TIMEOUT, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        # Connect to the validated IP, but retain the original host for TLS/SNI.
        raw = socket.create_connection((self.address, 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except Exception:
            raw.close()
            raise


@contextmanager
def open_public(value: str):
    connection = None
    try:
        for _ in range(MAX_REDIRECTS + 1):
            url = public_url(value)
            parts = urlsplit(url)
            connection = PinnedHTTPSConnection(parts.hostname, resolve_public(parts.hostname))
            connection.request("GET", urlunsplit(("", "", parts.path, parts.query, "")), headers={
                "User-Agent": "OldStyleGaming-UserSource/1.0",
                "Accept-Encoding": "identity",
                "Accept": "*/*",
            })
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("Location")
                connection.close()
                if not location:
                    raise HTTPException(502, "The source returned an invalid redirect")
                value = urljoin(url, location)
                continue
            if response.status != 200:
                if response.status in (401, 403):
                    raise HTTPException(422, "This source requires permission or blocks downloads; use a public source or a local file")
                raise HTTPException(502, f"The source returned HTTP {response.status}")
            if response.getheader("Content-Encoding", "identity").lower() not in ("", "identity"):
                raise HTTPException(422, "The source returned an unsupported compressed response")
            yield response, url
            return
        raise HTTPException(422, "The source redirects too many times")
    except (OSError, http.client.HTTPException):
        raise HTTPException(502, "The source connection failed or timed out") from None
    finally:
        if connection:
            connection.close()


def bounded_chunks(response, limit: int, seconds: int = 60):
    try:
        announced = int(response.getheader("Content-Length", "0"))
    except ValueError:
        raise HTTPException(422, "The source returned an invalid file size") from None
    if announced < 0 or announced > limit:
        raise HTTPException(413, "This source or file is too large for this preview")
    started = time.monotonic()
    total = 0
    while True:
        if time.monotonic() - started > seconds:
            raise HTTPException(504, "The source took too long to download")
        chunk = response.read1(min(65536, limit - total + 1))
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(413, "This source or file is too large for this preview")
        yield chunk
    if announced and total != announced:
        raise HTTPException(502, "The source download ended before the file was complete")
