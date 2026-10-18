from contextlib import contextmanager
import copy
import datetime as dt
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from websockets.sync.server import serve
from websockets.exceptions import ConnectionClosed

from blissey_qnx.client import Client, Config, FatalTransport, health_message
from blissey_qnx.contracts import (
    InvalidPayload, decode, encode, timestamp, validate_event, validate_health, validate_reply,
)
from blissey_qnx.outbox import Outbox

ROOT = Path(os.environ.get("BLISSEY_REPO", Path(__file__).resolve().parents[3]))
FIXTURES = json.loads((ROOT / "packages/contracts/fixtures/inference-events.json").read_text())
EVENT = next(row["payload"] for row in FIXTURES if row["valid"])
TOKEN = "test-only-credential-" + "x" * 32


@contextmanager
def server(handler, **kwargs):
    with serve(handler, "127.0.0.1", 0, compression=None, close_timeout=.2, **kwargs) as instance:
        thread = threading.Thread(target=instance.serve_forever, daemon=True)
        thread.start()
        try:
            yield instance.socket.getsockname()[1]
        finally:
            instance.shutdown()
            thread.join(timeout=3)


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        token = self.base / "device-token"
        token.write_text(TOKEN)
        token.chmod(0o600)
        self.config = Config("wss://api.blissey-beacon.health/api/devices/v1/stream",
                             EVENT["device_id"], EVENT["room_id"], token,
                             self.base / "outbox.sqlite3", self.base / "health.json")

    def outbox(self, **kwargs):
        box = Outbox(self.config.outbox_path, self.config.device_id, self.config.room_id, **kwargs)
        self.addCleanup(box.close)
        return box

    def local_config(self, port, *, tls=False, ca=None, hostname="127.0.0.1"):
        return Config(f'{"wss" if tls else "ws"}://{hostname}:{port}/api/devices/v1/stream',
                      self.config.device_id, self.config.room_id, self.config.token_file,
                      self.config.outbox_path, self.config.health_file, ca)


class Contracts(Base):
    def test_shared_event_fixtures(self):
        for row in FIXTURES:
            with self.subTest(row["name"]):
                if row["valid"]:
                    validate_event(row["payload"])
                else:
                    with self.assertRaises(InvalidPayload):
                        validate_event(row["payload"])

    def test_rules_track_authoritative_shapes(self):
        # New schema properties must be reconciled with the native rules deliberately.
        examples = {
            "inference-event": (EVENT, validate_event),
            "device-health": (health_message(self.config, self.outbox()), validate_health),
            "event-ack": ({"type": "event_ack", "event_id": "e", "incident_id": "i", "status": "accepted"}, validate_reply),
            "event-error": ({"type": "error", "event_id": "e", "code": "storage_unavailable", "retryable": True}, validate_reply),
        }
        for name, (value, validator) in examples.items():
            schema = json.loads((ROOT / f"packages/contracts/schemas/{name}.json").read_text())
            self.assertEqual(set(schema["required"]), set(value))
            self.assertEqual(set(schema["properties"]), set(value))
            for key in value:
                missing = dict(value)
                del missing[key]
                with self.subTest(schema=name, missing=key), self.assertRaises(InvalidPayload):
                    validator(missing)
            with self.assertRaises(InvalidPayload):
                validator({**value, "extra": True})

    def test_nonfinite_bool_identity_timestamp_and_json_bounds(self):
        for score in (float("nan"), float("inf"), True, 10**1000):
            bad = copy.deepcopy(EVENT)
            bad["confidence_scores"]["fall"] = score
            with self.assertRaises(InvalidPayload):
                validate_event(bad)
        with self.assertRaises(InvalidPayload):
            validate_event(EVENT, "another-device", EVENT["room_id"])
        for value in ("2026-01-01", "2026-01-01T01:00:00", "2026-02-30T01:00:00Z"):
            with self.assertRaises(InvalidPayload):
                timestamp(value)
        timestamp("2026-10-17T14:32:06-07:00")
        for value in ('{"a":1,"a":2}', '{"a":NaN}', '"' + 'x'*16384 + '"'):
            with self.assertRaises(InvalidPayload):
                decode(value)

    def test_config_tls_loopback_and_secret_permissions(self):
        value = {"url": self.config.url, "device_id": EVENT["device_id"], "room_id": EVENT["room_id"],
                 "token_file": "device-token", "outbox_path": "outbox.sqlite3", "health_file": "health.json"}
        path = self.base / "config.json"
        for url, local, valid in (
            (self.config.url, False, True),
            (self.config.url + "?token=secret", False, False),
            (self.config.url + "#secret", False, False),
            ("wss://user:password@example.com/api/devices/v1/stream", False, False),
            ("ws://example.com/api/devices/v1/stream", True, False),
            ("ws://127.0.0.1/api/devices/v1/stream", False, False),
            ("ws://127.0.0.1/api/devices/v1/stream", True, True),
        ):
            path.write_text(json.dumps({**value, "url": url}))
            if valid:
                Config.load(path, allow_local_ws=local)
            else:
                with self.assertRaises(InvalidPayload):
                    Config.load(path, allow_local_ws=local)
        self.assertEqual(self.config.token(), TOKEN)
        self.config.token_file.chmod(0o644)
        with self.assertRaises(InvalidPayload):
            self.config.token()


class Durability(Base):
    def test_reopen_retains_identical_event_until_ack(self):
        box = Outbox(self.config.outbox_path, self.config.device_id, self.config.room_id)
        box.enqueue(EVENT)
        first = box.pending()
        box.close()
        reopened = self.outbox()
        self.assertEqual(reopened.pending(), first)
        self.assertFalse(reopened.enqueue(EVENT))
        conflict = {**EVENT, "detected_at": "2026-10-18T00:00:00Z"}
        with self.assertRaises(InvalidPayload):
            reopened.enqueue(conflict)
        reopened.acknowledge(*first)
        self.assertIsNone(reopened.pending())

    def test_overflow_expiration_rejection_and_identity_are_durable(self):
        clock = [1000]
        box = self.outbox(capacity=2, max_age=10, now=lambda: clock[0])
        box.enqueue(EVENT)
        box.reject(*box.pending())
        box.enqueue({**EVENT, "event_id": "second"})
        box.enqueue({**EVENT, "event_id": "third"})
        self.assertEqual(box.stats()["dropped_event_count"], 1)
        clock[0] += 11
        self.assertEqual(box.stats(), {"outbox_depth": 0, "rejected_count": 0, "dropped_event_count": 3})
        with self.assertRaises(InvalidPayload):
            Outbox(self.config.outbox_path, "other-device", EVENT["room_id"])

    def test_old_ack_cannot_remove_a_replacement_after_overflow(self):
        box = self.outbox(capacity=1)
        box.enqueue(EVENT)
        old = box.pending()
        box.enqueue({**EVENT, "event_id": "other"})
        box.enqueue({**EVENT, "detected_at": "2026-10-18T00:00:00Z"})
        box.acknowledge(*old)
        self.assertIsNotNone(box.pending())

    def test_rejected_event_is_quarantined_without_retry(self):
        box = self.outbox()
        box.enqueue(EVENT)
        pending = box.pending()
        box.reject(*pending)
        box.reject(*pending)
        self.assertIsNone(box.pending())
        self.assertEqual(box.stats(), {"outbox_depth": 0, "rejected_count": 1, "dropped_event_count": 1})
        self.assertEqual(box.db.execute("SELECT payload FROM events").fetchone()[0], pending[1])


class Health(Base):
    def test_missing_stale_invalid_and_frame_stale_never_claim_ready_monitoring(self):
        box = self.outbox()
        now = dt.datetime.now(dt.timezone.utc)
        missing = health_message(self.config, box, now=now)
        self.assertEqual(missing["model_status"], "loading")
        self.assertEqual(missing["sensor_status"], "disconnected")
        good = {"updated_at": now.isoformat(), "sensor_status": "connected", "model_status": "ready",
                "last_valid_frame_at": now.isoformat(), "clock_synced": False}
        self.config.health_file.write_text(json.dumps(good))
        self.assertEqual(health_message(self.config, box, now=now)["sensor_status"], "connected")
        self.assertFalse(health_message(self.config, box, now=now)["clock_synced"])
        stale = health_message(self.config, box, now=now+dt.timedelta(seconds=31))
        self.assertEqual((stale["sensor_status"], stale["model_status"]), ("disconnected", "error"))
        good["last_valid_frame_at"] = (now-dt.timedelta(seconds=40)).isoformat()
        self.config.health_file.write_text(json.dumps(good))
        self.assertEqual(health_message(self.config, box, now=now)["sensor_status"], "degraded")
        self.config.health_file.write_text('{"broken":true}')
        self.assertEqual(health_message(self.config, box)["model_status"], "error")


class Wire(Base):
    def start_client(self, config, stop, **kwargs):
        failures = []

        def run():
            try:
                Client(config, **kwargs).run(stop)
            except BaseException as error:
                failures.append(error)

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        self.addCleanup(lambda: (stop.set(), thread.join(timeout=4)))
        return thread, failures

    def test_second_sender_is_excluded(self):
        connected = threading.Event()
        stop = threading.Event()

        def handler(ws):
            for raw in ws:
                if decode(raw).get("type") == "device_health":
                    connected.set()

        with server(handler) as port:
            config = self.local_config(port)
            thread, failures = self.start_client(config, stop)
            self.assertTrue(connected.wait(3))
            with self.assertRaisesRegex(FatalTransport, "Another sender"):
                Client(config).run(threading.Event())
            stop.set()
            thread.join(timeout=4)
        self.assertEqual(failures, [])

    def test_real_socket_lost_ack_reconnect_and_duplicate_ack(self):
        box = self.outbox()
        box.enqueue(EVENT)
        deliveries, health, auth = [], [], []
        second = threading.Event()
        stop = threading.Event()

        def handler(ws):
            auth.append(ws.request.headers.get("Authorization"))
            for raw in ws:
                value = decode(raw)
                if value.get("type") == "device_health":
                    validate_health(value)
                    health.append(value)
                    continue
                deliveries.append(raw)
                if len(deliveries) == 1:
                    ws.close()  # Simulate commit followed by a lost ACK.
                    return
                ws.send(encode({"type": "event_ack", "event_id": value["event_id"],
                                "incident_id": "same-durable-incident", "status": "duplicate"}))
                second.set()

        with server(handler) as port, patch("blissey_qnx.client.random.uniform", return_value=.01):
            thread, failures = self.start_client(self.local_config(port), stop, health_interval=.05)
            self.assertTrue(second.wait(4))
            deadline = time.monotonic()+3
            while box.stats()["outbox_depth"] and time.monotonic()<deadline:
                time.sleep(.01)
            stop.set()
            thread.join(timeout=4)
        self.assertEqual(failures, [])
        self.assertEqual(len(deliveries), 2)
        self.assertEqual(deliveries[0], deliveries[1])
        self.assertEqual(auth, ["Bearer " + TOKEN]*2)
        self.assertTrue(health)
        self.assertTrue(all(h["model_status"] == "loading" for h in health))
        self.assertEqual(box.stats()["outbox_depth"], 0)

    def test_401_stops_instead_of_reconnecting_and_retains_event(self):
        box = self.outbox()
        box.enqueue(EVENT)
        requests = []

        def reject(connection, request):
            requests.append(request.path)
            return connection.respond(401, TOKEN)  # Must never surface the response body.

        with server(lambda ws: None, process_request=reject) as port:
            with self.assertRaises(FatalTransport) as caught:
                Client(self.local_config(port)).run(threading.Event())
        self.assertNotIn(TOKEN, str(caught.exception))
        self.assertEqual(len(requests), 1)
        self.assertEqual(box.stats()["outbox_depth"], 1)

    def test_terminal_event_error_retains_quarantined_payload(self):
        box = self.outbox()
        box.enqueue(EVENT)
        got_error = threading.Event()
        stop = threading.Event()

        def handler(ws):
            for raw in ws:
                value = decode(raw)
                if "event_id" in value:
                    ws.send(encode({"type": "error", "event_id": value["event_id"],
                                    "code": "event_id_conflict", "retryable": False}))
                    got_error.set()

        with server(handler) as port:
            thread, failures = self.start_client(self.local_config(port), stop)
            self.assertTrue(got_error.wait(3))
            deadline = time.monotonic()+3
            while not box.stats()["rejected_count"] and time.monotonic()<deadline:
                time.sleep(.01)
            stop.set()
            thread.join(timeout=4)
        self.assertEqual(failures, [])
        self.assertEqual(box.stats(), {"outbox_depth": 0, "rejected_count": 1, "dropped_event_count": 1})

    def test_ack_timeout_keeps_health_running_and_event_durable(self):
        box = self.outbox()
        box.enqueue(EVENT)
        health = []
        stop = threading.Event()

        def handler(ws):
            try:
                for raw in ws:
                    value = decode(raw)
                    if value.get("type") == "device_health":
                        health.append(value)
            except ConnectionClosed:
                pass
            finally:
                stop.set()

        with server(handler) as port:
            thread, failures = self.start_client(self.local_config(port), stop, health_interval=.04, ack_timeout=.2)
            thread.join(timeout=4)
            stop.set()
        self.assertEqual(failures, [])
        self.assertGreaterEqual(len(health), 2)
        self.assertEqual(box.stats()["outbox_depth"], 1)

    def test_unmatched_ack_and_oversized_reply_never_remove_event(self):
        for reply in (encode({"type": "event_ack", "event_id": "wrong-event", "incident_id": "i", "status": "accepted"}), "x"*17000):
            with self.subTest(reply_bytes=len(reply)):
                box = self.outbox()
                box.enqueue(EVENT)
                stop = threading.Event()

                def handler(ws):
                    try:
                        for raw in ws:
                            if "event_id" in decode(raw):
                                ws.send(reply)
                    except ConnectionClosed:
                        pass
                    finally:
                        stop.set()

                with server(handler) as port:
                    thread, failures = self.start_client(self.local_config(port), stop)
                    thread.join(timeout=4)
                    stop.set()
                self.assertEqual(failures, [])
                self.assertEqual(box.stats()["outbox_depth"], 1)

    def test_wss_requires_trusted_certificate_and_valid_hostname(self):
        key, cert = self.base / "key.pem", self.base / "cert.pem"
        conf = self.base / "openssl.cnf"
        conf.write_text("[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\nbasicConstraints=critical,CA:TRUE\n")
        subprocess.run(["openssl", "req", "-new", "-x509", "-newkey", "rsa:2048", "-nodes",
                        "-days", "1", "-config", str(conf), "-keyout", str(key), "-out", str(cert)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        from websockets.sync.client import connect
        with server(lambda ws: ws.close(), ssl=context) as port:
            url = f"wss://localhost:{port}/api/devices/v1/stream"
            with self.assertRaises(ssl.SSLCertVerificationError):
                connect(url, proxy=None)
            trusted = ssl.create_default_context(cafile=cert)
            with connect(url, ssl=trusted, proxy=None):
                pass
            with self.assertRaises(ssl.SSLCertVerificationError):
                connect(url.replace("localhost", "127.0.0.1"), ssl=trusted, proxy=None)


if __name__ == "__main__":
    unittest.main()
