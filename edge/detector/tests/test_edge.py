"""Detector/uplink tests. From the repo root:  python3 -m unittest discover -s edge/detector/tests -v

A fake backend reproduces apps/backend/src/ingestion/routes.ts behaviour: Bearer auth on upgrade (401),
event_ack only for valid events, duplicate on identical retry, error envelopes, server pings.
Payloads are also checked against the real JSON schemas and fixtures in ../../blissey-beacon if present.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from email.utils import format_datetime

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))       # edge/detector
from blissey_edge.contracts import event_errors, health_errors          # noqa: E402
from blissey_edge.episodes import EpisodeGrouper                          # noqa: E402
from blissey_edge.outbox import Outbox                                    # noqa: E402
from blissey_edge.uplink import Uplink                                    # noqa: E402
from blissey_edge.ws import AuthError, WebSocket                          # noqa: E402

CONTRACTS = Path(__file__).resolve().parents[3] / 'packages/contracts'
TOKEN = 'T' * 40
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'


class D:  # minimal detector Decision
    def __init__(self, alert, score=.9):
        self.alert, self.fall_score = alert, score


# ------------------------------------------------------------------ minimal JSON-schema subset validator
def schema_ok(value, schema):
    if 'anyOf' in schema:
        return any(schema_ok(value, s) for s in schema['anyOf'])
    if 'const' in schema and value != schema['const']:
        return False
    if 'enum' in schema and value not in schema['enum']:
        return False
    t = schema.get('type')
    if t == 'object':
        if not isinstance(value, dict) or any(k not in value for k in schema.get('required', [])):
            return False
        props = schema.get('properties', {})
        if schema.get('additionalProperties') is False and set(value) - set(props):
            return False
        return all(schema_ok(value[k], props[k]) for k in value if k in props)
    if t == 'string':
        if not isinstance(value, str) or len(value) < schema.get('minLength', 0) or len(value) > schema.get('maxLength', 1e9):
            return False
        if schema.get('format') == 'date-time':
            try:
                return datetime.fromisoformat(value.replace('Z', '+00:00')).tzinfo is not None
            except ValueError:
                return False
    if t == 'number' and (not isinstance(value, (int, float)) or isinstance(value, bool)
                          or value < schema.get('minimum', -1e300) or value > schema.get('maximum', 1e300)):
        return False
    if t == 'integer' and (not isinstance(value, int) or isinstance(value, bool) or value < schema.get('minimum', -1e300)):
        return False
    if t == 'boolean' and not isinstance(value, bool):
        return False
    if t == 'null' and value is not None:
        return False
    return True


# ------------------------------------------------------------------ fake backend
class FakeBackend(threading.Thread):
    def __init__(self, drop_first_ack=False, reject_code=None, retryable_once=False):
        super().__init__(daemon=True)
        self.srv = socket.socket(); self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(('127.0.0.1', 0)); self.srv.listen(5)
        self.url = 'ws://127.0.0.1:%d/api/devices/v1/stream' % self.srv.getsockname()[1]
        self.events, self.health, self.connections, self.unauthorized = {}, [], 0, 0
        self.drop_first_ack, self.reject_code, self.retryable_once = drop_first_ack, reject_code, retryable_once
        self.halt = False

    def run(self):
        self.srv.settimeout(.2)
        while not self.halt:
            try:
                conn, _ = self.srv.accept()
            except socket.timeout:
                continue
            threading.Thread(target=self.serve, args=(conn,), daemon=True).start()
        self.srv.close()

    def frame(self, conn, opcode, data):
        n = len(data)
        conn.sendall(bytes([0x80 | opcode]) + (bytes([n]) if n < 126 else bytes([126]) + struct.pack('!H', n)) + data)

    def read_frame(self, conn, buf):
        def need(n):
            while len(buf[0]) < n:
                chunk = conn.recv(4096)
                if not chunk:
                    raise ConnectionError
                buf[0] += chunk
            out = buf[0][:n]; buf[0] = buf[0][n:]; return out
        b0, b1 = need(2); n = b1 & 0x7F
        n = struct.unpack('!H', need(2))[0] if n == 126 else struct.unpack('!Q', need(8))[0] if n == 127 else n
        mask = need(4); data = bytes(b ^ mask[i % 4] for i, b in enumerate(need(n)))
        assert b1 & 0x80, 'client frames must be masked'
        return b0 & 0x0F, data

    def serve(self, conn):
        head = b''
        while b'\r\n\r\n' not in head:
            head += conn.recv(4096)
        lines = head.decode().split('\r\n')
        hdr = {l.split(':', 1)[0].lower(): l.split(':', 1)[1].strip() for l in lines[1:] if ':' in l}
        if hdr.get('authorization') != 'Bearer ' + TOKEN or '?' in lines[0]:
            self.unauthorized += 1
            conn.sendall(b'HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n'); conn.close(); return
        accept = base64.b64encode(hashlib.sha1((hdr['sec-websocket-key'] + GUID).encode()).digest()).decode()
        conn.sendall(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                      'Sec-WebSocket-Accept: %s\r\nDate: %s\r\n\r\n' % (accept, format_datetime(datetime.now(timezone.utc), usegmt=True))).encode())
        self.connections += 1
        self.frame(conn, 0x9, b'ping')
        buf = [b'']
        try:
            while not self.halt:
                op, data = self.read_frame(conn, buf)
                if op != 0x1:
                    continue
                msg = json.loads(data)
                if msg.get('type') == 'device_health':
                    assert not health_errors(msg), health_errors(msg); self.health.append(msg); continue
                eid = msg.get('event_id', 'unknown')
                if event_errors(msg):
                    self.frame(conn, 0x1, json.dumps(dict(type='error', event_id=eid, code='invalid_payload', retryable=False)).encode()); continue
                if self.reject_code:
                    self.frame(conn, 0x1, json.dumps(dict(type='error', event_id=eid, code=self.reject_code, retryable=False)).encode()); continue
                if self.retryable_once:
                    self.retryable_once = False
                    self.frame(conn, 0x1, json.dumps(dict(type='error', event_id=eid, code='storage_unavailable', retryable=True)).encode()); continue
                status = 'accepted'
                if eid in self.events:
                    assert self.events[eid] == msg, 'retry must be byte-identical facts'; status = 'duplicate'
                self.events[eid] = msg
                if self.drop_first_ack:
                    self.drop_first_ack = False; conn.close(); return      # committed, ACK lost
                self.frame(conn, 0x1, json.dumps(dict(type='event_ack', event_id=eid, incident_id='inc-' + eid, status=status)).encode())
        except (ConnectionError, OSError):
            pass
        finally:
            conn.close()


def wait(cond, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(.05)
    return False


def health_state():
    return dict(sensor_status='connected', model_status='ready', last_valid_frame_at=None)


class Episodes(unittest.TestCase):
    def test_one_event_per_episode_with_exact_v2_fields(self):
        g = EpisodeGrouper('1', '101', refractory_seconds=60)
        e1 = g.offer(D(True, .9), 100.0)
        self.assertIsNone(g.offer(D(True, .8), 105.0)); self.assertIsNone(g.offer(D(True), 159.9))
        e2 = g.offer(D(True, .7), 160.0)
        self.assertIsNone(g.offer(D(False), 300.0))
        self.assertEqual(g.suppressed, 2)
        for e in (e1, e2):
            self.assertEqual(event_errors(e), [])
            self.assertEqual((e['device_id'], e['room_id'], e['sensor_status']), ('1', '101', 'connected'))
        self.assertNotEqual(e1['event_id'], e2['event_id'])
        self.assertAlmostEqual(e2['confidence_scores']['fall'] + e2['confidence_scores']['non_fall'], 1.0, places=12)

    def test_ids_must_be_strings(self):
        with self.assertRaises(ValueError):
            EpisodeGrouper(1, '101')


@unittest.skipUnless(CONTRACTS.exists(), 'blissey-beacon contracts not present')
class RealContracts(unittest.TestCase):
    def test_payloads_match_backend_json_schemas(self):
        ev_schema = json.loads((CONTRACTS / 'schemas/inference-event.json').read_text())
        h_schema = json.loads((CONTRACTS / 'schemas/device-health.json').read_text())
        e = EpisodeGrouper('1', '101').offer(D(True, .91), 0.)
        self.assertTrue(schema_ok(e, ev_schema))
        with tempfile.TemporaryDirectory() as tmp:
            u = Uplink('ws://127.0.0.1:1/x', TOKEN, '1', '101', Outbox(tmp), health_state)
            self.assertTrue(schema_ok(json.loads(u.health_message()), h_schema))

    def test_validator_agrees_with_backend_fixtures(self):
        for f in json.loads((CONTRACTS / 'fixtures/inference-events.json').read_text()):
            self.assertEqual(event_errors(f['payload']) == [], f['valid'], f.get('name', f['payload']))


POLICY = dict(threshold=.5, votes=2, history=3, cooldown_seconds=5., reset_after_gap_seconds=.75, warmup_windows=3)


def alert_decisions(ends, scores, policy):
    """Reference copy of lahacks_cv.metrics.alert_decisions (the offline evaluation rule)."""
    from collections import deque
    history, previous, last, out = deque(maxlen=policy['history']), None, float('-inf'), []
    for t, s in zip(ends, scores):
        if previous is not None and t - previous > policy['reset_after_gap_seconds'] + 1e-9:
            history.clear()
        history.append(s >= policy['threshold'])
        fire = len(history) >= policy['warmup_windows'] and sum(history) >= policy['votes'] and t - last >= policy['cooldown_seconds']
        if fire:
            last = t
        out.append(fire); previous = t
    return out


class FixedModel:
    """Model stub returning a fixed score sequence (for detector/calibration logic tests)."""
    def __init__(self, seq, threshold=.5):
        self.bundle = dict(threshold=threshold, alert_policy=POLICY); self.n_features = 0; self.seq = seq; self.i = -1

    def fall_score(self, x):
        self.i += 1
        return self.seq[self.i % len(self.seq)]


def feed(det, n=1500, rate=100., mac_of=lambda k: 'AA:AA:AA:AA:AA:AA'):
    import random
    rng = random.Random(0); out = []
    for k in range(n):
        out += det.push(k / rate, [rng.uniform(5, 30) for _ in range(52)], mac_of(k))
    return out


class DetectorAndCalibration(unittest.TestCase):
    def test_majority_lock_survives_stray_first_packet(self):
        from blissey_edge.detector import Detector
        det = Detector(FixedModel([.1]))
        out = feed(det, mac_of=lambda k: 'BB:BB:BB:BB:BB:BB' if k in (0, 7) else 'AA:AA:AA:AA:AA:AA')
        self.assertEqual(det.mac, 'AA:AA:AA:AA:AA:AA'); self.assertEqual(det.foreign, 2); self.assertTrue(out)

    def test_event_carries_strongest_voting_score(self):
        from blissey_edge.detector import Detector
        det = Detector(FixedModel([.1, .9, .6, .1, .1, .1, .1, .1, .1, .1, .1, .1, .1, .1, .1, .1]))
        alerts = [d for d in feed(det) if d.alert]
        self.assertTrue(alerts)
        e = EpisodeGrouper('1', '101').offer(alerts[0], 0.)
        self.assertEqual(e['confidence_scores']['fall'], .9)
        self.assertEqual(event_errors(e), [])

    def test_calibrated_threshold_gives_zero_alerts_and_is_tight(self):
        import random
        from blissey_edge.calibrate import zero_alert_threshold
        rng = random.Random(1); scores = [rng.random() ** 3 for _ in range(400)]
        windows = [(3 + .5 * i, s) for i, s in enumerate(scores)]
        t0 = zero_alert_threshold(windows, POLICY)
        self.assertFalse(any(alert_decisions([w for w, _ in windows], scores, dict(POLICY, threshold=t0 * 1.0001))))
        self.assertTrue(any(alert_decisions([w for w, _ in windows], scores, dict(POLICY, threshold=t0))))


class OutboxDurability(unittest.TestCase):
    def test_survives_restart_and_dead_letters(self):
        with tempfile.TemporaryDirectory() as tmp:
            e = EpisodeGrouper('1', '101').offer(D(True), 0.)
            Outbox(tmp).add(e)
            with open(os.path.join(tmp, 'outbox', 'half.json.tmp'), 'w') as f:  # crash mid-write
                f.write('{')
            ob = Outbox(tmp)                                                       # "restart"
            self.assertEqual([i for i, _ in ob.pending()], [e['event_id']])
            ob.dead(e['event_id'], 'conflict'); self.assertEqual((ob.depth(), ob.dropped()), (0, 1))
            with self.assertRaises(ValueError):
                ob.add(dict(e, event_id='../escape'))


class UplinkProtocol(unittest.TestCase):
    def run_uplink(self, server, events=1, token=TOKEN, until=None):
        server.start()
        tmp = tempfile.mkdtemp(); ob = Outbox(tmp); g = EpisodeGrouper('1', '101', refractory_seconds=0)
        sent = [g.offer(D(True, .5 + k / 10), float(k)) for k in range(events)]
        for e in sent:
            ob.add(e)
        logs = []
        u = Uplink(server.url, token, '1', '101', ob, health_state, health_interval=.5, auth_retry_seconds=60,
                   log=logs.append)
        u.start()
        cond = until or (lambda ob, s, u: ob.depth() == 0 and len(s.health) >= 2)
        ok = wait(lambda: cond(ob, server, u))
        u.stop(); u.join(5); server.halt = True
        return ok, ob, server, sent, logs, u

    def test_events_acked_and_removed_health_sent(self):
        ok, ob, s, sent, logs, u = self.run_uplink(FakeBackend(), events=3)
        self.assertTrue(ok, logs); self.assertEqual(set(s.events), {e['event_id'] for e in sent})
        self.assertTrue(u.clock_synced); self.assertEqual(u.stats['acks'], 3)

    def test_lost_ack_resent_identical_and_deduplicated(self):
        ok, ob, s, sent, logs, u = self.run_uplink(FakeBackend(drop_first_ack=True))
        self.assertTrue(ok, logs)
        self.assertEqual(len(s.events), 1); self.assertGreaterEqual(s.connections, 2); self.assertEqual(u.stats['duplicates'], 1)

    def test_retryable_error_is_retried(self):
        ok, ob, s, sent, logs, u = self.run_uplink(FakeBackend(retryable_once=True))
        self.assertTrue(ok, logs); self.assertEqual(u.stats['retryable_errors'], 1)

    def test_rejected_event_dead_lettered(self):
        ok, ob, s, sent, logs, u = self.run_uplink(FakeBackend(reject_code='event_conflict'),
                                                   until=lambda ob, s, u: ob.dropped() == 1)
        self.assertTrue(ok, logs); self.assertEqual((ob.depth(), ob.dropped()), (0, 1))

    def test_bad_token_never_sends_and_is_not_logged(self):
        ok, ob, s, sent, logs, u = self.run_uplink(FakeBackend(), token='W' * 40,
                                                   until=lambda ob, s, u: u.stats['auth_failures'] >= 1)
        self.assertTrue(ok, logs); self.assertEqual(ob.depth(), 1); self.assertEqual(s.unauthorized, 1); self.assertEqual(s.events, {})
        self.assertTrue(any('CREDENTIAL REJECTED' in l for l in logs))
        self.assertFalse(any('W' * 40 in l for l in logs))

    def test_plain_ws_refused_for_remote_hosts(self):
        with self.assertRaises(Exception):
            WebSocket('ws://example.com/api/devices/v1/stream')
        with self.assertRaises(Exception):
            WebSocket('wss://example.com/api/devices/v1/stream?token=x')



if __name__ == '__main__':
    unittest.main()
