"""Webhook signature verification (PRD §11 security)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import time

import httpx

FAL_JWKS_URL = "https://rest.alpha.fal.ai/.well-known/jwks.json"
_jwks_cache: tuple[float, list[dict]] | None = None
MAX_SKEW_S = 300


class SignatureError(Exception):
    pass


async def _fal_keys() -> list[dict]:
    global _jwks_cache
    if _jwks_cache and time.time() - _jwks_cache[0] < 86400:
        return _jwks_cache[1]
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(FAL_JWKS_URL)
        r.raise_for_status()
        keys = r.json().get("keys", [])
    _jwks_cache = (time.time(), keys)
    return keys


def _b64url(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


async def verify_fal(headers: dict[str, str], body: bytes, keys: list[dict] | None = None) -> None:
    """fal signs `request_id\\nuser_id\\ntimestamp\\nsha256(body)` with ED25519 (keys in its JWKS)."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    rid = headers.get("x-fal-webhook-request-id")
    uid = headers.get("x-fal-webhook-user-id")
    ts = headers.get("x-fal-webhook-timestamp")
    sig = headers.get("x-fal-webhook-signature")
    if not all((rid, uid, ts, sig)):
        raise SignatureError("missing fal signature headers")
    if abs(time.time() - int(ts)) > MAX_SKEW_S:
        raise SignatureError("stale fal webhook")
    msg = "\n".join([rid, uid, ts, hashlib.sha256(body).hexdigest()]).encode()
    signature = bytes.fromhex(sig)
    for k in keys if keys is not None else await _fal_keys():
        try:
            Ed25519PublicKey.from_public_bytes(_b64url(k["x"])).verify(signature, msg)
            return
        except (InvalidSignature, KeyError, ValueError):
            continue
    raise SignatureError("bad fal signature")


def verify_standard_webhook(secret: str, headers: dict[str, str], body: bytes) -> None:
    """Standard Webhooks / Svix scheme (Replicate): base64 HMAC-SHA256 of `id.timestamp.body`."""
    wid, ts, sigs = headers.get("webhook-id"), headers.get("webhook-timestamp"), headers.get("webhook-signature")
    if not all((wid, ts, sigs)):
        raise SignatureError("missing webhook signature headers")
    if abs(time.time() - int(ts)) > MAX_SKEW_S:
        raise SignatureError("stale webhook")
    key = base64.b64decode(secret.removeprefix("whsec_"))
    expected = base64.b64encode(hmac.new(key, f"{wid}.{ts}.".encode() + body, hashlib.sha256).digest()).decode()
    for part in sigs.split():
        _, _, value = part.partition(",")
        if hmac.compare_digest(value, expected):
            return
    raise SignatureError("bad webhook signature")


def verify_hmac_hex(secret: str, headers: dict[str, str], body: bytes) -> None:
    """Generic HMAC-SHA256 hex signature (publisher callbacks): `x-signature` or `x-hub-signature-256`."""
    sig = headers.get("x-signature") or headers.get("x-hub-signature-256") or headers.get("x-webhook-signature")
    if not sig:
        raise SignatureError("missing signature header")
    sig = sig.removeprefix("sha256=")
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise SignatureError("bad signature")
