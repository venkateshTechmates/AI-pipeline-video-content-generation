"""Content-addressed asset storage (PRD §7 cross-cutting).

Keys look like ``runs/<run_id>/<kind>/<sha256[:16]><ext>``: identical bytes map
to the same key, so re-running an idempotent node never duplicates assets.
Two backends: local filesystem and Supabase Storage.
"""

from __future__ import annotations

import hashlib
import mimetypes
import shutil
from pathlib import Path
from typing import Protocol

import httpx

from .config import Settings


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def content_key(run_id: str, kind: str, sha: str, ext: str) -> str:
    ext = ext if ext.startswith(".") or not ext else f".{ext}"
    return f"runs/{run_id}/{kind}/{sha[:16]}{ext}"


class AssetStore(Protocol):
    def put_bytes(self, key: str, data: bytes, content_type: str | None = None) -> str: ...
    def put_file(self, key: str, path: Path, content_type: str | None = None) -> str: ...
    def exists(self, key: str) -> bool: ...
    def local_path(self, key: str) -> Path:
        """Materialise the object locally (download if remote) and return its path."""
        ...
    def url(self, key: str, expires_s: int = 3600) -> str: ...


class LocalStore:
    def __init__(self, root: Path, public_base: str = "http://localhost:8000"):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.public_base = public_base.rstrip("/")

    def _p(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents and p != self.root.resolve():
            raise ValueError(f"key escapes store root: {key}")
        return p

    def put_bytes(self, key: str, data: bytes, content_type: str | None = None) -> str:
        p = self._p(key)
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(p.suffix + ".tmp")
            tmp.write_bytes(data)
            tmp.replace(p)
        return key

    def put_file(self, key: str, path: Path, content_type: str | None = None) -> str:
        p = self._p(key)
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            if Path(path).resolve() != p:
                shutil.copyfile(path, p)
        return key

    def exists(self, key: str) -> bool:
        return self._p(key).exists()

    def local_path(self, key: str) -> Path:
        if key.startswith(("http://", "https://")):
            return _download_to_cache(key, self.root / "_cache")
        p = Path(key)
        if p.is_absolute() and p.exists():
            return p
        return self._p(key)

    def url(self, key: str, expires_s: int = 3600) -> str:
        if key.startswith(("http://", "https://")):
            return key
        return f"{self.public_base}/assets/{key}"


class SupabaseStore:
    """Supabase Storage via its REST API; keeps a local read-through cache."""

    def __init__(self, url: str, service_key: str, bucket: str, cache_dir: Path):
        self.base = url.rstrip("/") + "/storage/v1"
        self.bucket = bucket
        self.headers = {"Authorization": f"Bearer {service_key}", "apikey": service_key}
        self.cache = LocalStore(cache_dir)
        self.client = httpx.Client(timeout=120, headers=self.headers)

    def put_bytes(self, key: str, data: bytes, content_type: str | None = None) -> str:
        if self.exists(key):
            return key
        ct = content_type or mimetypes.guess_type(key)[0] or "application/octet-stream"
        r = self.client.post(
            f"{self.base}/object/{self.bucket}/{key}",
            content=data,
            headers={"Content-Type": ct, "x-upsert": "true"},
        )
        r.raise_for_status()
        self.cache.put_bytes(key, data)
        return key

    def put_file(self, key: str, path: Path, content_type: str | None = None) -> str:
        return self.put_bytes(key, Path(path).read_bytes(), content_type)

    def exists(self, key: str) -> bool:
        if self.cache.exists(key):
            return True
        r = self.client.head(f"{self.base}/object/{self.bucket}/{key}")
        return r.status_code == 200

    def local_path(self, key: str) -> Path:
        if key.startswith(("http://", "https://")):
            return self.cache.local_path(key)
        if self.cache.exists(key):
            return self.cache.local_path(key)
        r = self.client.get(f"{self.base}/object/{self.bucket}/{key}")
        r.raise_for_status()
        self.cache.put_bytes(key, r.content)
        return self.cache.local_path(key)

    def url(self, key: str, expires_s: int = 3600) -> str:
        if key.startswith(("http://", "https://")):
            return key
        r = self.client.post(
            f"{self.base}/object/sign/{self.bucket}/{key}", json={"expiresIn": expires_s}
        )
        r.raise_for_status()
        signed = r.json().get("signedURL") or r.json().get("signedUrl")
        return f"{self.base}{signed}" if signed and signed.startswith("/") else signed


def _download_to_cache(url: str, cache_dir: Path) -> Path:
    name = hashlib.sha256(url.encode()).hexdigest()[:24] + (Path(url.split("?")[0]).suffix or ".bin")
    p = cache_dir / name
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        with httpx.stream("GET", url, timeout=300, follow_redirects=True) as r:
            r.raise_for_status()
            tmp = p.with_suffix(".part")
            with tmp.open("wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
            tmp.replace(p)
    return p


def build_store(settings: Settings) -> AssetStore:
    if settings.supabase_url and settings.supabase_service_key:
        return SupabaseStore(
            settings.supabase_url, settings.supabase_service_key, settings.storage_bucket,
            settings.asset_root / "_cache",
        )
    return LocalStore(settings.asset_root, settings.public_api_url)
