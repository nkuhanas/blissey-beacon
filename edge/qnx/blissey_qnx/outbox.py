"""SQLite FULL-sync outbox shared by the inference producer and transport process."""

from contextlib import contextmanager
import os
import math
from pathlib import Path
import sqlite3
import time

from .contracts import InvalidPayload, decode, encode, require, validate_event


class Outbox:
    def __init__(self, path, device_id, room_id, *, capacity=1000, max_age=86400, now=time.time):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.capacity, self.max_age, self.now = capacity, max_age, now
        require(type(capacity) is int and capacity > 0 and math.isfinite(max_age) and max_age > 0)
        self.device_id, self.room_id = device_id, room_id
        self.db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        os.chmod(self.path, 0o600)
        self.db.execute("PRAGMA journal_mode=DELETE")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), device TEXT, room TEXT);
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL,
                payload TEXT NOT NULL, queued_at REAL NOT NULL, rejected INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS counters (singleton INTEGER PRIMARY KEY CHECK(singleton=1), dropped INTEGER NOT NULL);
            INSERT OR IGNORE INTO counters VALUES (1,0);
        """)
        try:
            with self.transaction():
                row = self.db.execute("SELECT device,room FROM identity WHERE singleton=1").fetchone()
                if row and row != (device_id, room_id):
                    raise InvalidPayload("Outbox belongs to another device/room; use a separate database")
                self.db.execute("INSERT OR IGNORE INTO identity VALUES (1,?,?)", (device_id, room_id))
        except BaseException:
            self.db.close()
            raise

    @contextmanager
    def transaction(self):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def close(self):
        self.db.close()

    def _expire(self):
        # Rejected events were already counted as losses when quarantined.
        count = self.db.execute("SELECT COUNT(*) FROM events WHERE queued_at<=? AND rejected=0", (self.now()-self.max_age,)).fetchone()[0]
        self.db.execute("DELETE FROM events WHERE queued_at<=?", (self.now()-self.max_age,))
        if count:
            self.db.execute("UPDATE counters SET dropped=dropped+?", (count,))

    def enqueue(self, event):
        validate_event(event, self.device_id, self.room_id)
        payload = encode(event)
        with self.transaction():
            self._expire()
            existing = self.db.execute("SELECT payload FROM events WHERE event_id=?", (event["event_id"],)).fetchone()
            if existing:
                require(existing[0] == payload)
                return False
            while self.db.execute("SELECT COUNT(*) FROM events").fetchone()[0] >= self.capacity:
                row = self.db.execute("SELECT seq,rejected FROM events ORDER BY seq LIMIT 1").fetchone()
                self.db.execute("DELETE FROM events WHERE seq=?", (row[0],))
                self.db.execute("UPDATE counters SET dropped=dropped+?", (1-row[1],))
            self.db.execute("INSERT INTO events(event_id,payload,queued_at) VALUES (?,?,?)", (event["event_id"], payload, self.now()))
        return True

    def pending(self):
        with self.transaction():
            self._expire()
            row = self.db.execute("SELECT event_id,payload FROM events WHERE rejected=0 ORDER BY seq LIMIT 1").fetchone()
        if row:
            validate_event(decode(row[1]), self.device_id, self.room_id)
        return row

    def acknowledge(self, event_id, payload):
        with self.transaction():
            self.db.execute("DELETE FROM events WHERE event_id=? AND payload=? AND rejected=0", (event_id, payload))

    def reject(self, event_id, payload):
        with self.transaction():
            changed = self.db.execute("UPDATE events SET rejected=1 WHERE event_id=? AND payload=? AND rejected=0", (event_id, payload)).rowcount
            self.db.execute("UPDATE counters SET dropped=dropped+?", (changed,))

    def stats(self):
        with self.transaction():
            self._expire()
            pending = self.db.execute("SELECT COUNT(*) FROM events WHERE rejected=0").fetchone()[0]
            rejected = self.db.execute("SELECT COUNT(*) FROM events WHERE rejected=1").fetchone()[0]
            dropped = self.db.execute("SELECT dropped FROM counters").fetchone()[0]
        return {"outbox_depth": pending, "rejected_count": rejected, "dropped_event_count": dropped}
