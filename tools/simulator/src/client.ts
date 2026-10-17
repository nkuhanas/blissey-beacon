import WebSocket from "ws";
import { readFile } from "node:fs/promises";
import {
  isInferenceEvent,
  validateAck,
  validateEventError,
  type InferenceEvent,
  type EventAck,
} from "@blissey/contracts";
export class RejectedEvent extends Error {}
export async function syntheticEvent(id?: string): Promise<InferenceEvent> {
  const fixtures = JSON.parse(
    await readFile(
      new URL(
        "../../../packages/contracts/fixtures/inference-events.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { valid: boolean; payload: unknown }[];
  const payload = fixtures.find((f) => f.valid)?.payload;
  if (!isInferenceEvent(payload))
    throw new Error("Canonical fixture is invalid");
  return { ...payload, ...(id ? { event_id: id } : {}) };
}
export async function sendSyntheticEvent(options: {
  url: string;
  token: string;
  event: InferenceEvent;
  timeoutMs?: number;
  holdMs?: number;
}): Promise<EventAck> {
  const url = new URL(options.url);
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Credentials belong only in the Authorization header");
  if (
    url.protocol !== "wss:" &&
    !(
      url.protocol === "ws:" &&
      ["127.0.0.1", "localhost", "backend"].includes(url.hostname)
    )
  )
    throw new Error(
      "Use WSS (plain WS is allowed only for local Docker tests)",
    );
  if (!isInferenceEvent(options.event))
    throw new RejectedEvent("Event violates canonical contract");
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: { authorization: `Bearer ${options.token}` },
      handshakeTimeout: options.timeoutMs ?? 10000,
      maxPayload: 16 * 1024,
    });
    let settled = false;
    let ack: EventAck | undefined;
    const timer = setTimeout(
      () => finish(new Error("Acknowledgment timeout")),
      options.timeoutMs ?? 10000,
    );
    let health: ReturnType<typeof setInterval> | undefined;
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (health) clearInterval(health);
      socket.terminate();
      if (error) reject(error);
      else resolve(ack!);
    }
    socket.on("unexpected-response", (_request, response) => {
      response.resume();
      finish(
        [401, 403].includes(response.statusCode!)
          ? new RejectedEvent("Device authentication rejected")
          : new Error("Upgrade unavailable"),
      );
    });
    socket.on("error", () => finish(new Error("WebSocket connection failed")));
    socket.on("close", () => {
      if (!settled) finish(new Error("Connection closed before completion"));
    });
    socket.on("open", () => {
      const report = () => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(
            JSON.stringify({
              type: "device_health",
              device_id: options.event.device_id,
              room_id: options.event.room_id,
              sent_at: new Date().toISOString(),
              sensor_status: "connected",
              model_status: "ready",
              last_valid_frame_at: null,
              outbox_depth: ack ? 0 : 1,
              dropped_event_count: 0,
              clock_synced: true,
            }),
          );
      };
      report();
      health = setInterval(report, 10000);
      socket.send(JSON.stringify(options.event));
    });
    socket.on("message", (raw) => {
      try {
        const message: unknown = JSON.parse(raw.toString());
        if (
          validateAck(message) &&
          message.event_id === options.event.event_id
        ) {
          if (ack) return;
          ack = message;
          clearTimeout(timer);
          if (options.holdMs) setTimeout(() => finish(), options.holdMs);
          else finish();
        } else if (validateEventError(message))
          finish(
            message.retryable
              ? new Error(message.code)
              : new RejectedEvent(message.code),
          );
        else
          finish(
            new Error("Unexpected response; no valid durable acknowledgment"),
          );
      } catch {
        finish(new Error("Malformed server response"));
      }
    });
  });
}
