"""Location → default content language.

A brand's `kit.region` (ISO 3166-1 country like "IN", or ISO 3166-2 subdivision like "IN-TG") picks the
default narration/caption language and subtitle languages, and tells the script writer who the audience
is. The API also suggests a locale for the current viewer from CDN geo headers and Accept-Language.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .languages import get_language, is_supported


@dataclass(frozen=True)
class Region:
    code: str
    name: str
    language: str
    subtitles: tuple[str, ...] = field(default=())


# Indian states / union territories (ISO 3166-2:IN) → the language most of the audience reads and hears.
_IN_STATES: dict[str, tuple[str, str]] = {
    "AP": ("Andhra Pradesh", "te"), "TG": ("Telangana", "te"), "TS": ("Telangana", "te"),
    "TN": ("Tamil Nadu", "ta"), "PY": ("Puducherry", "ta"), "KA": ("Karnataka", "kn"), "KL": ("Kerala", "ml"),
    "LD": ("Lakshadweep", "ml"), "MH": ("Maharashtra", "mr"), "GJ": ("Gujarat", "gu"), "PB": ("Punjab", "pa"),
    "WB": ("West Bengal", "bn"), "TR": ("Tripura", "bn"), "OR": ("Odisha", "or"), "OD": ("Odisha", "or"),
    "AS": ("Assam", "as"), "GA": ("Goa", "kok"), "SK": ("Sikkim", "ne"), "JK": ("Jammu and Kashmir", "ur"),
    "UP": ("Uttar Pradesh", "hi"), "BR": ("Bihar", "hi"), "MP": ("Madhya Pradesh", "hi"),
    "RJ": ("Rajasthan", "hi"), "HR": ("Haryana", "hi"), "DL": ("Delhi", "hi"), "UK": ("Uttarakhand", "hi"),
    "UT": ("Uttarakhand", "hi"), "HP": ("Himachal Pradesh", "hi"), "JH": ("Jharkhand", "hi"),
    "CT": ("Chhattisgarh", "hi"), "CG": ("Chhattisgarh", "hi"), "CH": ("Chandigarh", "hi"),
    "AN": ("Andaman and Nicobar Islands", "hi"), "DH": ("Dadra and Nagar Haveli and Daman and Diu", "gu"),
    "LA": ("Ladakh", "hi"), "AR": ("Arunachal Pradesh", "hi"), "MN": ("Manipur", "en"), "ML": ("Meghalaya", "en"),
    "MZ": ("Mizoram", "en"), "NL": ("Nagaland", "en"),
}

_COUNTRIES: dict[str, tuple[str, str]] = {
    "IN": ("India", "hi"), "US": ("United States", "en"), "GB": ("United Kingdom", "en"),
    "AU": ("Australia", "en"), "CA": ("Canada", "en"), "NZ": ("New Zealand", "en"), "IE": ("Ireland", "en"),
    "SG": ("Singapore", "en"), "ZA": ("South Africa", "en"), "NG": ("Nigeria", "en"), "PH": ("Philippines", "en"),
    "ES": ("Spain", "es"), "MX": ("Mexico", "es"), "AR": ("Argentina", "es"), "CO": ("Colombia", "es"),
    "CL": ("Chile", "es"), "PE": ("Peru", "es"), "FR": ("France", "fr"), "BE": ("Belgium", "fr"),
    "DE": ("Germany", "de"), "AT": ("Austria", "de"), "CH": ("Switzerland", "de"), "BR": ("Brazil", "pt"),
    "PT": ("Portugal", "pt"), "IT": ("Italy", "it"), "NL": ("Netherlands", "nl"), "PL": ("Poland", "pl"),
    "TR": ("Türkiye", "tr"), "RU": ("Russia", "ru"), "UA": ("Ukraine", "uk"), "ID": ("Indonesia", "id"),
    "VN": ("Vietnam", "vi"), "BD": ("Bangladesh", "bn"), "PK": ("Pakistan", "ur"), "NP": ("Nepal", "ne"),
    "LK": ("Sri Lanka", "ta"), "SA": ("Saudi Arabia", "ar"), "AE": ("United Arab Emirates", "ar"),
    "EG": ("Egypt", "ar"), "JP": ("Japan", "ja"), "KR": ("South Korea", "ko"), "CN": ("China", "zh"),
    "TW": ("Taiwan", "zh"), "HK": ("Hong Kong", "zh"), "TH": ("Thailand", "th"), "MY": ("Malaysia", "en"),
}


def _subtitles_for(country: str, language: str) -> tuple[str, ...]:
    """India: English + Hindi (the link languages); elsewhere English when the video isn't in English."""
    wanted = ("en", "hi") if country == "IN" else ("en",)
    return tuple(c for c in wanted if c != language)


def get_region(code: str | None) -> Region | None:
    if not code:
        return None
    code = code.strip().upper().replace("_", "-")
    country, _, sub = code.partition("-")
    if country == "IN" and sub in _IN_STATES:
        name, lang = _IN_STATES[sub]
        return Region(f"IN-{sub}", f"{name}, India", lang, _subtitles_for("IN", lang))
    if country in _COUNTRIES:
        name, lang = _COUNTRIES[country]
        return Region(country, name, lang, _subtitles_for(country, lang))
    return None


def all_regions() -> list[Region]:
    out = [r for c in _COUNTRIES if (r := get_region(c))]
    seen = set()
    for sub, (name, _) in _IN_STATES.items():
        if name not in seen:
            seen.add(name)
            r = get_region(f"IN-{sub}")
            if r:
                out.append(r)
    return sorted(out, key=lambda r: (not r.code.startswith("IN"), r.code != "IN", r.name))


# Headers set by common CDNs / edge platforms.
_COUNTRY_HEADERS = ("cf-ipcountry", "x-vercel-ip-country", "cloudfront-viewer-country", "x-appengine-country",
                    "x-country-code", "x-geo-country")
_REGION_HEADERS = ("x-vercel-ip-country-region", "cloudfront-viewer-country-region", "x-appengine-region",
                   "x-geo-region", "cf-region-code")


def suggest_locale(headers: dict[str, str], region: str | None = None) -> dict[str, object]:
    """Best default for a viewer: explicit region > CDN geo headers > Accept-Language > English."""
    h = {k.lower(): v for k, v in headers.items()}
    source = "region" if region else "default"
    if not region:
        country = next((h[k] for k in _COUNTRY_HEADERS if h.get(k) and h[k] not in ("XX", "T1")), None)
        sub = next((h[k] for k in _REGION_HEADERS if h.get(k)), None)
        if country:
            region, source = (f"{country}-{sub}" if sub else country), "geo"
    r = get_region(region)
    if r:
        return {"region": r.code, "region_name": r.name, "language": r.language,
                "subtitle_languages": list(r.subtitles), "source": source}
    # Accept-Language: first supported tag, e.g. "te-IN,te;q=0.9,en-US;q=0.8"
    for part in h.get("accept-language", "").split(","):
        tag = part.split(";")[0].strip()
        if tag and is_supported(tag):
            lang = get_language(tag).code
            country = tag.split("-")[1].upper() if "-" in tag else ""
            subs = list(_subtitles_for(country, lang)) if country else ([] if lang == "en" else ["en"])
            return {"region": country or None, "region_name": None, "language": lang,
                    "subtitle_languages": subs, "source": "accept-language"}
    return {"region": None, "region_name": None, "language": "en", "subtitle_languages": [], "source": "default"}
