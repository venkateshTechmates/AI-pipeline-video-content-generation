"""Publishing + metrics: Upload-Post (v1 default) and Ayrshare (agency multi-tenant, M5)."""

from __future__ import annotations

from datetime import datetime

import httpx

from ..models import Platform, PostMetrics, PostRecord
from ..ratelimit import bucket
from ..retry import PermanentError
from .base import PublishRequest, PublishResult

UPLOAD_POST_PLATFORM = {p: p.value for p in Platform}  # Upload-Post uses our names (x, facebook, threads, ...)

AYRSHARE_PLATFORM = {p: p.value for p in Platform} | {Platform.x: "twitter"}


def _caption(req: PublishRequest) -> str:
    tags = " ".join(f"#{t.lstrip('#')}" for t in req.metadata.hashtags)
    return f"{req.metadata.description}\n\n{tags}".strip()


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat().replace("+00:00", "Z") if dt else None


class UploadPostPublisher:
    """https://docs.upload-post.com — one request per platform so post IDs map 1:1."""

    name = "upload_post:post"
    BASE = "https://api.upload-post.com/api"

    def __init__(self, api_key: str, default_user: str = "default", client: httpx.AsyncClient | None = None):
        self.default_user = default_user
        self.client = client or httpx.AsyncClient(timeout=300, headers={"Authorization": f"Apikey {api_key}"})

    async def publish(self, req: PublishRequest) -> PublishResult:
        plat = UPLOAD_POST_PLATFORM[req.platform]
        data: dict[str, str | list[str]] = {
            "user": req.profile_key or self.default_user,
            "platform[]": [plat],
            "title": req.metadata.title if req.platform in (Platform.youtube,) else _caption(req)[:2200],
            "description": _caption(req),
        }
        if req.platform == Platform.tiktok:
            data["is_aigc"] = "true" if req.metadata.ai_disclosure else "false"
        if req.platform == Platform.youtube:
            data["privacyStatus"] = "public"
            data["containsSyntheticMedia"] = "true" if req.metadata.ai_disclosure else "false"
        if req.platform == Platform.instagram:
            data["media_type"] = "REELS"
        if req.platform == Platform.facebook:
            if not req.options.get("page_id"):
                raise PermanentError("facebook needs platform_options.facebook.page_id in the brand kit")
            data["facebook_page_id"] = req.options["page_id"]
            data["facebook_media_type"] = "REELS"
        if req.platform == Platform.pinterest:
            data["pinterest_board_id"] = req.options["board_id"]
            data["title"] = req.metadata.title
        if req.platform == Platform.reddit:
            data["subreddit"] = req.options["subreddit"]
            data["title"] = req.metadata.title
        if req.scheduled_at:
            data["scheduled_date"] = _iso(req.scheduled_at) or ""
        files = None
        if req.video_path and req.video_path.exists():
            files = {"video": (req.video_path.name, req.video_path.read_bytes(), "video/mp4")}
        else:
            data["video"] = req.video_url
        await bucket("upload_post").acquire()
        r = await self.client.post(f"{self.BASE}/upload", data=data, files=files)
        if r.status_code in (400, 401, 403, 422):
            raise PermanentError(f"upload-post rejected: {r.text[:400]}")
        r.raise_for_status()
        j = r.json()
        res = (j.get("results") or {}).get(plat, {})
        if res and res.get("success") is False:
            raise PermanentError(f"upload-post {plat} failed: {res.get('error')}")
        ext = res.get("platform_post_id") or res.get("post_id") or res.get("id") or j.get("request_id") \
            or j.get("job_id")
        status = "scheduled" if req.scheduled_at else "published"
        return PublishResult(platform=req.platform, external_id=str(ext) if ext else None, url=res.get("url"),
                             status=status, raw=j)


class UploadPostMetrics:
    name = "upload_post:metrics"
    BASE = "https://api.upload-post.com/api"

    def __init__(self, api_key: str, client: httpx.AsyncClient | None = None):
        self.client = client or httpx.AsyncClient(timeout=60, headers={"Authorization": f"Apikey {api_key}"})

    async def fetch(self, post: PostRecord, profile_key: str | None = None) -> PostMetrics:
        r = await self.client.get(f"{self.BASE}/uploadposts/post-analytics/{post.external_id}",
                                  params={"platform": UPLOAD_POST_PLATFORM[post.platform]})
        r.raise_for_status()
        j = r.json().get("analytics", r.json())
        return PostMetrics(post_id=post.id, views=int(j.get("views", 0)), likes=int(j.get("likes", 0)),
                           comments=int(j.get("comments", 0)), shares=int(j.get("shares", 0)),
                           retention={k: v for k, v in j.items() if "retention" in k or "watch" in k})


class AyrsharePublisher:
    """Ayrshare with per-brand Profile-Key (token isolation for agency tenants)."""

    name = "ayrshare:post"
    BASE = "https://api.ayrshare.com/api"

    def __init__(self, api_key: str, client: httpx.AsyncClient | None = None):
        self.client = client or httpx.AsyncClient(timeout=120, headers={"Authorization": f"Bearer {api_key}"})

    async def publish(self, req: PublishRequest) -> PublishResult:
        plat = AYRSHARE_PLATFORM[req.platform]
        body: dict = {
            "post": _caption(req),
            "platforms": [plat],
            "mediaUrls": [req.video_url],
            "isVideo": True,
        }
        if req.scheduled_at:
            body["scheduleDate"] = _iso(req.scheduled_at)
        if req.platform == Platform.youtube:
            body["youTubeOptions"] = {"title": req.metadata.title[:100], "visibility": "public", "shorts": True,
                                      "madeForKids": False, **({"thumbNail": req.thumbnail_url}
                                                               if req.thumbnail_url else {})}
        if req.platform == Platform.instagram:
            body["instagramOptions"] = {"reels": True, "shareReelsFeed": True,
                                        **({"coverUrl": req.thumbnail_url} if req.thumbnail_url else {})}
        if req.platform == Platform.tiktok:
            body["tikTokOptions"] = {"isAIGenerated": req.metadata.ai_disclosure,
                                     **({"thumbNailOffset": int(req.metadata.thumbnail_time * 1000)})}
        if req.platform == Platform.facebook:
            body["faceBookOptions"] = {"reels": True, "title": req.metadata.title[:255]}
        if req.platform == Platform.pinterest:
            body["pinterestOptions"] = {"boardId": req.options["board_id"], "title": req.metadata.title[:100],
                                        **({"thumbNail": req.thumbnail_url} if req.thumbnail_url else {})}
        if req.platform == Platform.reddit:
            body["redditOptions"] = {"title": req.metadata.title[:300], "subreddit": req.options["subreddit"]}
        headers = {"Profile-Key": req.profile_key} if req.profile_key else {}
        await bucket("ayrshare").acquire()
        r = await self.client.post(f"{self.BASE}/post", json=body, headers=headers)
        j = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code >= 400 or j.get("status") == "error":
            if r.status_code >= 500:
                r.raise_for_status()
            raise PermanentError(f"ayrshare rejected: {str(j or r.text)[:400]}")
        ids = {p.get("platform"): p for p in j.get("postIds", [])}
        p = ids.get(plat, {})
        return PublishResult(platform=req.platform, external_id=p.get("id") or j.get("id"), url=p.get("postUrl"),
                             status="scheduled" if req.scheduled_at else "published",
                             raw={**j, "ayrshare_id": j.get("id")})


class AyrshareMetrics:
    name = "ayrshare:metrics"
    BASE = "https://api.ayrshare.com/api"

    def __init__(self, api_key: str, client: httpx.AsyncClient | None = None):
        self.client = client or httpx.AsyncClient(timeout=60, headers={"Authorization": f"Bearer {api_key}"})

    async def fetch(self, post: PostRecord, profile_key: str | None = None) -> PostMetrics:
        plat = AYRSHARE_PLATFORM[post.platform]
        aid = post.metadata.get("ayrshare_id") or post.external_id
        headers = {"Profile-Key": profile_key} if profile_key else {}
        r = await self.client.post(f"{self.BASE}/analytics/post", json={"id": aid, "platforms": [plat]},
                                   headers=headers)
        r.raise_for_status()
        a = (r.json().get(plat) or {}).get("analytics", {})
        views = a.get("views") or a.get("videoViews") or a.get("impressionCount") or a.get("playCount") or 0
        likes = a.get("likes") or a.get("likeCount") or a.get("favoriteCount") or 0
        comments = a.get("comments") or a.get("commentsCount") or a.get("commentCount") or a.get("replyCount") or 0
        shares = a.get("shares") or a.get("shareCount") or a.get("retweetCount") or 0
        retention = {k: v for k, v in a.items() if "average" in k.lower() or "retention" in k.lower()
                     or "watch" in k.lower()}
        return PostMetrics(post_id=post.id, views=int(views), likes=int(likes), comments=int(comments),
                           shares=int(shares), retention=retention)
