"""Brand posting calendar: next slot per platform, in the brand's timezone."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from .models import Platform, PostingCalendar


def slots_between(cal: PostingCalendar, start: datetime, end: datetime) -> list[tuple[datetime, list[Platform]]]:
    tz = ZoneInfo(cal.timezone)
    out = []
    day = start.astimezone(tz).date()
    last = end.astimezone(tz).date()
    while day <= last:
        for s in cal.slots:
            if s.weekday != day.weekday():
                continue
            hh, mm = (int(x) for x in s.time.split(":"))
            at = datetime(day.year, day.month, day.day, hh, mm, tzinfo=tz).astimezone(UTC)
            if start <= at < end:
                out.append((at, s.platforms))
        day += timedelta(days=1)
    return sorted(out, key=lambda x: x[0])


def next_slot(cal: PostingCalendar, platform: Platform, after: datetime,
              horizon_days: int = 14) -> datetime | None:
    for at, plats in slots_between(cal, after, after + timedelta(days=horizon_days)):
        if platform in plats:
            return at
    return None
