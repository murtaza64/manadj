"""Origin labels for Audio Provenance (ADR-0006).

External Sources are identified by URL only; the label is derived from the
URL host — known-host map first, else the bare host with `www.` stripped.
"""

from urllib.parse import urlparse

KNOWN_HOSTS = {
    "youtube.com": "youtube",
    "youtu.be": "youtube",
    "beatport.com": "beatport",
    "bandcamp.com": "bandcamp",
    "soundcloud.com": "soundcloud",
    "mixcloud.com": "mixcloud",
}


def is_url(text: str) -> bool:
    return text.startswith(("http://", "https://"))


def derive_label(url: str) -> str:
    """Origin label from a URL's host."""
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    if host in KNOWN_HOSTS:
        return KNOWN_HOSTS[host]
    # artist subdomains (e.g. sansibar.bandcamp.com)
    for known, label in KNOWN_HOSTS.items():
        if host.endswith("." + known):
            return label
    return host
