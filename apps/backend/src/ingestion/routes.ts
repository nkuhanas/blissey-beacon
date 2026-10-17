import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  isInferenceEvent,
  validateHealth,
  type EventError,
} from "@blissey/contracts";
import { credentialHash, IngestionError, type DeviceStore } from "./store.js";
export function registerDeviceRoutes(app: FastifyInstance, store: DeviceStore) {
  const sessions = new WeakMap<FastifyRequest, string>();
  app.get(
    "/api/devices/v1/stream",
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const token = /^Bearer ([\x21-\x7e]{32,256})$/.exec(
          request.headers.authorization ?? "",
        )?.[1];
        if (!token || request.url.includes("?"))
          return reply.code(401).send({ error: "unauthorized_device" });
        const hash = credentialHash(token);
        if (!(await store.authenticate(hash)))
          return reply.code(401).send({ error: "unauthorized_device" });
        sessions.set(request, hash);
      },
    },
    (socket, request) => {
      const hash = sessions.get(request)!;
      let chain = Promise.resolve();
      let queued = 0;
      const heartbeat = setInterval(() => {
        if (socket.readyState === 1) socket.ping();
      }, 15000);
      socket.on("close", () => clearInterval(heartbeat));
      socket.on("error", () => clearInterval(heartbeat));
      // Handlers are attached synchronously. Serialize a bounded number of messages per socket.
      socket.on("message", (raw, binary) => {
        if (++queued > 64) {
          socket.close(1013, "Message queue full");
          queued--;
          return;
        }
        chain = chain
          .then(async () => {
            if (socket.readyState !== 1) return;
            let eventId = "unknown";
            try {
              if (binary) throw new Error("invalid_payload");
              const payload: unknown = JSON.parse(raw.toString());
              if (
                payload &&
                typeof payload === "object" &&
                "event_id" in payload &&
                typeof payload.event_id === "string" &&
                payload.event_id.length > 0 &&
                payload.event_id.length <= 128
              )
                eventId = payload.event_id;
              if (isInferenceEvent(payload)) {
                const ack = await store.ingest(hash, payload);
                if (socket.readyState === 1) socket.send(JSON.stringify(ack));
              } else if (validateHealth(payload)) {
                await store.health(hash, payload); // Health has no event_ack; never claims incident persistence.
              } else throw new Error("invalid_payload");
            } catch (error) {
              const known = error instanceof IngestionError;
              const invalid =
                error instanceof SyntaxError ||
                (error instanceof Error && error.message === "invalid_payload");
              const reply: EventError = {
                type: "error",
                event_id: eventId,
                code: known
                  ? error.code
                  : invalid
                    ? "invalid_payload"
                    : "storage_unavailable",
                retryable: !known && !invalid,
              };
              if (!known && !invalid)
                request.log.error({ err: error }, "Device persistence failed");
              if (socket.readyState === 1) socket.send(JSON.stringify(reply));
              if (known && error.code === "unauthorized_device")
                socket.close(1008, "Credential revoked");
            }
          })
          .catch((error) => {
            request.log.error({ err: error }, "Device stream failed");
            socket.close(1011, "Stream failed");
          })
          .finally(() => {
            queued--;
          });
      });
    },
  );
}
