"""Download resilience.

A multi-hour unattended backfill fails on the network, not on logic. These pin
the distinction the retry logic turns on: a dropped connection is worth retrying,
a missing file is not -- and retrying the missing ones would waste hours across
the ~20k symbol-months that never existed.
"""
from __future__ import annotations

import http.client
import urllib.error

import pytest

from alpha_audit.ingest import binance_bulk as bb


class _Resp:
    def __init__(self, body: bytes):
        self.body = body

    def read(self) -> bytes:
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


@pytest.fixture(autouse=True)
def _no_sleeping(monkeypatch):
    monkeypatch.setattr(bb.time, "sleep", lambda _s: None)


def _urlopen(monkeypatch, side_effects):
    calls: list[int] = []

    def fake(_req, timeout=None):
        calls.append(1)
        eff = side_effects[min(len(calls) - 1, len(side_effects) - 1)]
        if isinstance(eff, Exception):
            raise eff
        return _Resp(eff)

    monkeypatch.setattr(bb.urllib.request, "urlopen", fake)
    return calls


def test_a_dropped_connection_is_retried(monkeypatch):
    """This is the failure that killed the first backfill 26 minutes in."""
    calls = _urlopen(monkeypatch, [
        http.client.RemoteDisconnected("closed"),
        http.client.RemoteDisconnected("closed"),
        b"payload",
    ])
    assert bb._get("https://example/x.zip") == b"payload"
    assert len(calls) == 3


def test_a_throttling_response_is_retried(monkeypatch):
    calls = _urlopen(monkeypatch, [
        urllib.error.HTTPError("u", 429, "slow down", None, None),
        b"payload",
    ])
    assert bb._get("https://example/x.zip") == b"payload"
    assert len(calls) == 2


def test_a_missing_file_is_not_retried(monkeypatch):
    calls = _urlopen(monkeypatch, [urllib.error.HTTPError("u", 404, "nf", None, None)])
    with pytest.raises(urllib.error.HTTPError):
        bb._get("https://example/x.zip")
    assert len(calls) == 1, "retrying absent symbol-months would cost hours"


def test_retries_are_bounded(monkeypatch):
    calls = _urlopen(monkeypatch, [http.client.RemoteDisconnected("closed")])
    with pytest.raises(http.client.RemoteDisconnected):
        bb._get("https://example/x.zip", retries=4)
    assert len(calls) == 4


def test_download_month_reports_absence_as_none(monkeypatch, tmp_path):
    monkeypatch.setattr(bb, "BRONZE", tmp_path)
    _urlopen(monkeypatch, [urllib.error.HTTPError("u", 404, "nf", None, None)])
    assert bb.download_month("NOPEUSDT", "2024-01") is None


def test_download_month_writes_atomically(monkeypatch, tmp_path):
    monkeypatch.setattr(bb, "BRONZE", tmp_path)
    _urlopen(monkeypatch, [b"zipbytes"])
    p = bb.download_month("BTCUSDT", "2024-01")
    assert p is not None and p.read_bytes() == b"zipbytes"
    assert not list(tmp_path.rglob("*.part")), "no partial file left behind"
    # A second call must not re-download.
    calls = _urlopen(monkeypatch, [b"different"])
    assert bb.download_month("BTCUSDT", "2024-01") == p
    assert len(calls) == 0


def test_non_ascii_symbols_are_percent_encoded():
    """The archive really does list a Chinese-named pair; interpolating it raw
    raises UnicodeEncodeError inside http.client rather than 404ing."""
    url = bb.month_url("\u5e01\u5b89\u4eba\u751fUSDT", "2022-01")
    assert "%" in url and url.isascii()
    assert url.endswith("-1m-2022-01.zip")
    assert bb.month_url("BTCUSDT", "2024-01").endswith(
        "/klines/BTCUSDT/1m/BTCUSDT-1m-2024-01.zip")
