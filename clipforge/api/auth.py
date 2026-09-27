"""Supabase JWT auth + brand scoping (multi-tenant, PRD §8)."""

from __future__ import annotations

import hmac
from dataclasses import dataclass

import jwt
from fastapi import HTTPException, Request

from ..config import Settings


@dataclass
class Principal:
    user_id: str | None
    org_ids: list[str] | None  # None = all orgs (service / dev)
    service: bool = False


def _token(request: Request) -> str | None:
    h = request.headers.get("authorization", "")
    if h.lower().startswith("bearer "):
        return h[7:].strip()
    return request.query_params.get("token")  # EventSource cannot set headers


async def principal(request: Request) -> Principal:
    app = request.app.state.cf
    settings: Settings = app.settings
    tok = _token(request)
    if tok and settings.api_token and hmac.compare_digest(tok, settings.api_token):
        return Principal(user_id=None, org_ids=None, service=True)
    if not tok:
        if settings.auth_required:
            raise HTTPException(401, "missing bearer token")
        return Principal(user_id=None, org_ids=None, service=True)
    if not settings.supabase_jwt_secret:
        if settings.auth_required:
            raise HTTPException(401, "JWT verification not configured")
        return Principal(user_id=None, org_ids=None, service=True)
    try:
        claims = jwt.decode(tok, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
    except jwt.PyJWTError as e:
        raise HTTPException(401, f"invalid token: {e}") from e
    uid = claims["sub"]
    return Principal(user_id=uid, org_ids=await app.repo.user_org_ids(uid))


async def brand_ids_for(request: Request, p: Principal) -> list[str] | None:
    if p.org_ids is None:
        return None
    return [b.id for b in await request.app.state.cf.repo.list_brands(p.org_ids)]


async def require_brand(request: Request, p: Principal, brand_id: str) -> None:
    allowed = await brand_ids_for(request, p)
    if allowed is not None and brand_id not in allowed:
        raise HTTPException(404, "brand not found")
