"""Persistent WSS transport; model code commits episodes through Outbox.enqueue."""

from dataclasses import dataclass
import datetime as dt
import fcntl
import logging
import os
from pathlib import Path
import random
import re
import ssl
import stat
import threading
import time
from urllib.parse import urlsplit

from websockets.exceptions import ConnectionClosed, InvalidHandshake, InvalidStatus
from websockets.sync.client import connect

from .contracts import (
    MAX_MESSAGE, InvalidPayload, decode, encode, exact, identifier, require,
    timestamp, validate_health, validate_reply,
)
from .outbox import Outbox

LOG = logging.getLogger("blissey.qnx")
# Third-party DEBUG wire logs can contain Authorization headers.
WIRE_LOG = logging.getLogger("blissey.qnx.wire")
WIRE_LOG.disabled = True
WIRE_LOG.propagate = False


class FatalTransport(RuntimeError):
    """Requires operator action; never automatically retry authentication failures."""


@dataclass(frozen=True)
class Config:
    url: str
    device_id: str
    room_id: str
    token_file: Path
    outbox_path: Path
    health_file: Path
    ca_file: Path | None = None

    @classmethod
    def load(cls, path, *, allow_local_ws=False):
        path = Path(path).resolve()
        value = read_json(path)
        require(type(value) is dict)
        required = {"url", "device_id", "room_id", "token_file", "outbox_path", "health_file"}
        require(required <= value.keys() <= required | {"ca_file"})
        for key in required:
            require(type(value[key]) is str and bool(value[key]))
        url = value["url"]
        parsed = urlsplit(url)
        require(not parsed.username and not parsed.password and "?" not in url and "#" not in url)
        require(bool(parsed.hostname) and not any(c.isspace() for c in url))
        require(parsed.path == "/api/devices/v1/stream")
        require(parsed.scheme == "wss" or (
            allow_local_ws and parsed.scheme == "ws" and parsed.hostname in ("127.0.0.1", "localhost", "::1")
        ))
        identifier(value["device_id"])
        identifier(value["room_id"])

        def relative(key):
            raw = value[key]
            require(type(raw) is str and bool(raw))
            return (path.parent / raw).resolve()

        return cls(url, value["device_id"], value["room_id"], relative("token_file"),
                   relative("outbox_path"), relative("health_file"),
                   relative("ca_file") if value.get("ca_file") is not None else None)

    def token(self):
        with self.token_file.open() as stream:
            require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode))
            require(stat.S_IMODE(os.fstat(stream.fileno()).st_mode) & 0o077 == 0)
            value = stream.read(258).strip()
        require(re.fullmatch(r"[-_a-zA-Z0-9]{32,256}", value) is not None)
        return value


def read_json(path):
    with Path(path).open() as stream:
        return decode(stream.read(MAX_MESSAGE + 1))


def health_message(config, outbox, *, now=None):
    now = dt.datetime.now(dt.timezone.utc) if now is None else now
    # Never infer readiness from socket liveness or the existence of a serial node.
    snapshot = {"sensor_status": "disconnected", "model_status": "loading",
                "last_valid_frame_at": None, "clock_synced": False}
    try:
        value = read_json(config.health_file)
        exact(value, "updated_at sensor_status model_status last_valid_frame_at clock_synced")
        age = (now - timestamp(value["updated_at"])).total_seconds()
        require(0 <= age <= 30)
        snapshot = {key: value[key] for key in snapshot}
        if snapshot["sensor_status"] == "connected":
            frame = snapshot["last_valid_frame_at"]
            if frame is None or not 0 <= (now-timestamp(frame)).total_seconds() <= 30:
                snapshot["sensor_status"] = "degraded"
    except FileNotFoundError:
        pass
    except (OSError, ValueError, TypeError, OverflowError):
        snapshot["model_status"] = "error"
    stats = outbox.stats()
    message = {"type": "device_health", "device_id": config.device_id,
               "room_id": config.room_id, "sent_at": now.isoformat(), **snapshot,
               "outbox_depth": stats["outbox_depth"],
               "dropped_event_count": stats["dropped_event_count"]}
    try:
        return validate_health(message)
    except InvalidPayload:
        message.update(sensor_status="disconnected", model_status="error",
                       last_valid_frame_at=None, clock_synced=False)
        return validate_health(message)


class Client:
    def __init__(self, config, *, health_interval=10, ack_timeout=10):
        self.config = config
        self.health_interval, self.ack_timeout = health_interval, ack_timeout
        self.made_progress = False

    def session(self, socket, outbox, stop):
        pending = None
        next_health = 0
        deadline = 0
        while not stop.is_set():
            now = time.monotonic()
            if now >= next_health:
                socket.send(encode(health_message(self.config, outbox)))
                next_health = now + self.health_interval
            if pending is None:
                pending = outbox.pending()
                if pending:
                    socket.send(pending[1])
                    deadline = time.monotonic() + self.ack_timeout
            if pending and time.monotonic() >= deadline:
                raise TimeoutError("Durable acknowledgment not received")
            timeout = min(.5, max(0, next_health-time.monotonic()))
            if pending:
                timeout = min(timeout, max(0, deadline-time.monotonic()))
            try:
                message = validate_reply(decode(socket.recv(timeout=timeout)))
            except TimeoutError:
                continue
            if message["type"] == "error":
                if message["code"] in ("unauthorized_device", "identity_mismatch"):
                    raise FatalTransport("Device credential or room mapping rejected; reprovision before restarting")
                if message["retryable"]:
                    raise ConnectionError("Backend requested retry")
                if pending is None or message["event_id"] != pending[0]:
                    raise FatalTransport("Health or uncorrelated payload rejected; inspect producer configuration")
                outbox.reject(*pending)
                LOG.error("event_quarantined: inspect local outbox; no automatic retry")
                pending = None
            else:
                require(pending is not None and message["event_id"] == pending[0])
                outbox.acknowledge(*pending)
                self.made_progress = True
                pending = None
                LOG.info("durable_event_acknowledged")

    def run(self, stop=None):
        stop = threading.Event() if stop is None else stop
        config = self.config
        outbox = Outbox(config.outbox_path, config.device_id, config.room_id)
        # One sender per outbox. Inference producers still enqueue concurrently.
        lock = config.outbox_path.with_suffix(config.outbox_path.suffix + ".lock").open("a")
        try:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise FatalTransport("Another sender owns this outbox") from None
            attempts = 0
            while not stop.is_set():
                self.made_progress = False
                started = time.monotonic()
                # Configuration failures require repair, rather than a network retry loop.
                token = config.token()
                context = ssl.create_default_context(cafile=config.ca_file) if urlsplit(config.url).scheme == "wss" else None
                try:
                    with connect(config.url, ssl=context, proxy=None, compression=None,
                                 additional_headers={"Authorization": "Bearer " + token},
                                 open_timeout=10, close_timeout=2, ping_interval=15, ping_timeout=10,
                                 max_size=MAX_MESSAGE, max_queue=4, logger=WIRE_LOG) as socket:
                        LOG.info("device_stream_connected")
                        self.session(socket, outbox, stop)
                except InvalidStatus as error:
                    if error.response.status_code in (401, 403):
                        raise FatalTransport("Device authentication rejected; reprovision before restarting") from None
                    LOG.warning("upgrade_unavailable: queued events retained")
                except (ConnectionClosed, OSError, TimeoutError, ConnectionError, InvalidHandshake, InvalidPayload):
                    # Do not log third-party exceptions: headers/bodies can carry secrets.
                    LOG.warning("stream_unavailable: queued events retained")
                if self.made_progress or time.monotonic()-started >= 30:
                    attempts = 0
                delay = random.uniform(0, min(30, 2 ** min(attempts, 5)))
                attempts += 1
                stop.wait(delay)
        finally:
            lock.close()
            outbox.close()
