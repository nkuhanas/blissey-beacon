"""Native rules for packages/contracts/schemas; exercise shared fixtures in tests."""

import datetime as dt
import json
import math
import re

MAX_MESSAGE = 16 * 1024
SCORE_TOLERANCE = 1e-6


class InvalidPayload(ValueError):
    pass


def require(condition):
    if not condition:
        raise InvalidPayload("Message violates the device contract")


def exact(value, keys):
    require(type(value) is dict and set(value) == set(keys.split()))


def identifier(value):
    require(type(value) is str and 1 <= len(value) <= 128)


def timestamp(value):
    require(type(value) is str)
    require(re.fullmatch(
        r"\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})",
        value,
    ) is not None)
    try:
        parsed = dt.datetime.fromisoformat(value.upper().replace("Z", "+00:00"))
        require(parsed.tzinfo is not None)
        return parsed
    except ValueError:
        raise InvalidPayload("Invalid timestamp") from None


def validate_event(value, device_id=None, room_id=None):
    exact(value, "event_id room_id device_id event_type confidence_scores detected_at sensor_status")
    for key in ("event_id", "room_id", "device_id"):
        identifier(value[key])
    require(value["event_type"] == "inference_result")
    require(value["sensor_status"] == "connected")
    scores = value["confidence_scores"]
    exact(scores, "fall non_fall")
    for score in scores.values():
        require(type(score) in (int, float) and 0 <= score <= 1 and math.isfinite(score))
    require(abs(sum(scores.values()) - 1) <= SCORE_TOLERANCE)
    timestamp(value["detected_at"])
    if device_id is not None:
        require(value["device_id"] == device_id)
    if room_id is not None:
        require(value["room_id"] == room_id)
    return value


def validate_health(value):
    exact(value, "type device_id room_id sent_at sensor_status model_status last_valid_frame_at outbox_depth dropped_event_count clock_synced")
    require(value["type"] == "device_health")
    identifier(value["device_id"])
    identifier(value["room_id"])
    timestamp(value["sent_at"])
    require(value["sensor_status"] in ("connected", "degraded", "disconnected"))
    require(value["model_status"] in ("loading", "ready", "error"))
    if value["last_valid_frame_at"] is not None:
        timestamp(value["last_valid_frame_at"])
    for key in ("outbox_depth", "dropped_event_count"):
        require(type(value[key]) is int and value[key] >= 0)
    require(type(value["clock_synced"]) is bool)
    return value


def validate_reply(value):
    require(type(value) is dict)
    if value.get("type") == "event_ack":
        exact(value, "type event_id incident_id status")
        identifier(value["event_id"])
        identifier(value["incident_id"])
        require(value["status"] in ("accepted", "duplicate"))
    else:
        exact(value, "type event_id code retryable")
        require(value["type"] == "error")
        identifier(value["event_id"])
        identifier(value["code"])
        require(type(value["retryable"]) is bool)
    return value


def encode(value):
    try:
        text = json.dumps(value, allow_nan=False, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    except (TypeError, ValueError):
        raise InvalidPayload("Cannot encode message") from None
    require(len(text.encode("utf-8")) <= MAX_MESSAGE)
    return text


def decode(text):
    require(type(text) is str and len(text.encode("utf-8")) <= MAX_MESSAGE)

    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result)
            result[key] = value
        return result

    def invalid_constant(_):
        raise InvalidPayload("Nonfinite JSON value")

    try:
        return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid_constant)
    except (ValueError, RecursionError):
        raise InvalidPayload("Invalid JSON message") from None
