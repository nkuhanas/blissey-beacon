import { registerMessageRoutes } from "./messages/routes.js";
import { registerDemoRoutes } from "./demo/routes.js";
import { registerCallRoutes } from "./notifications/routes.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { registerDeviceRoutes } from "./ingestion/routes.js";
import type { DeviceStore } from "./ingestion/store.js";
import type { createIncidentStore } from "./incidents/store.js";
import type { Room } from "@blissey/contracts";
import type { VerifyOperator } from "./auth.js";
export interface Store extends ReturnType<typeof createIncidentStore> {
  isMember(subject: string, facilityId: string): Promise<boolean>;
  listRooms(facilityId: string): Promise<Room[]>;
}
export async function createApp(options: {
  verifyOperator: VerifyOperator;
  store: Store;
  webOrigin: string;
  devices?: DeviceStore;
  messages?: Omit<
    Parameters<typeof registerMessageRoutes>[1],
    "verifyOperator"
  >;
  calls?: Omit<Parameters<typeof registerCallRoutes>[1], "verifyOperator">;
  demo?: Omit<Parameters<typeof registerDemoRoutes>[1], "verifyOperator">;
}) {
  const app = Fastify({ logger: { redact: ["req.headers.authorization"] } });
  await app.register(cors, {
    origin: options.webOrigin,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "OPTIONS"],
  });
  // Register before future WebSocket routes. Attach their message listeners synchronously.
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  app.get("/healthz", async () => ({ status: "ok", scope: "process-only" }));
  app.get<{ Querystring: { facility_id?: string } }>(
    "/api/operator/rooms",
    async (request, reply) => {
      const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "");
      if (!match?.[1]) return reply.code(401).send({ error: "unauthorized" });
      let subject: string;
      try {
        subject = await options.verifyOperator(match[1]);
      } catch {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const facilityId = request.query.facility_id;
      if (
        typeof facilityId !== "string" ||
        !facilityId ||
        facilityId.length > 128
      )
        return reply.code(400).send({ error: "facility_id_required" });
      if (!(await options.store.isMember(subject, facilityId)))
        return reply.code(403).send({ error: "forbidden" });
      return { rooms: await options.store.listRooms(facilityId) };
    },
  );
  if (options.devices) registerDeviceRoutes(app, options.devices);
  if (options.demo)
    registerDemoRoutes(app, {
      ...options.demo,
      verifyOperator: options.verifyOperator,
    });
  if (options.messages)
    registerMessageRoutes(app, {
      ...options.messages,
      verifyOperator: options.verifyOperator,
    });
  if (options.calls)
    registerCallRoutes(app, {
      ...options.calls,
      verifyOperator: options.verifyOperator,
    });
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.register(async (operator) => {
    const subjects = new WeakMap<object, string>();
    operator.addHook("preHandler", async (request, reply) => {
      const token = /^Bearer (\S+)$/.exec(
        request.headers.authorization ?? "",
      )?.[1];
      if (!token) return reply.code(401).send({ error: "unauthorized" });
      try {
        subjects.set(request, await options.verifyOperator(token));
      } catch {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });
    async function facility(subject: string, value: unknown) {
      if (typeof value !== "string" || value.length === 0 || value.length > 128)
        return null;
      return (await options.store.isMember(subject, value)) ? value : false;
    }
    operator.get<{
      Querystring: {
        facility_id?: string;
        limit?: string;
        cursor?: string;
        include_explanation?: string;
      };
    }>("/api/operator/incidents", async (request, reply) => {
      const subject = subjects.get(request)!;
      const id = await facility(subject, request.query.facility_id);
      if (id === null)
        return reply.code(400).send({ error: "facility_id_required" });
      if (id === false) return reply.code(403).send({ error: "forbidden" });
      const raw = request.query.limit;
      const limit =
        raw === undefined
          ? 25
          : typeof raw === "string" && /^\d+$/.test(raw)
            ? Number(raw)
            : NaN;
      const cursor = request.query.cursor ?? null;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (cursor !== null && (typeof cursor !== "string" || !uuid.test(cursor)))
      )
        return reply.code(400).send({ error: "invalid_pagination" });
      const include = request.query.include_explanation;
      if (include !== undefined && include !== "true" && include !== "false")
        return reply.code(400).send({ error: "invalid_include_explanation" });
      return options.store.listIncidents(
        subject,
        id,
        limit,
        cursor,
        include === "true",
      );
    });
    operator.get<{
      Params: { id: string };
      Querystring: { include_explanation?: string };
    }>("/api/operator/incidents/:id", async (request, reply) => {
      if (!uuid.test(request.params.id))
        return reply.code(400).send({ error: "invalid_incident_id" });
      const include = request.query.include_explanation;
      if (include !== undefined && include !== "true" && include !== "false")
        return reply.code(400).send({ error: "invalid_include_explanation" });
      const incident = await options.store.getIncident(
        subjects.get(request)!,
        request.params.id,
        include === "true",
      );
      if (!incident) return reply.code(404).send({ error: "not_found" });
      return { incident };
    });
    operator.get<{ Querystring: { facility_id?: string } }>(
      "/api/devices/status",
      async (request, reply) => {
        const subject = subjects.get(request)!;
        const id = await facility(subject, request.query.facility_id);
        if (id === null)
          return reply.code(400).send({ error: "facility_id_required" });
        if (id === false) return reply.code(403).send({ error: "forbidden" });
        return { devices: await options.store.listDeviceStatus(subject, id) };
      },
    );
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Request failed");
    const status =
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
        ? error.statusCode
        : 503;
    reply.code(status).send({
      error: status === 503 ? "service_unavailable" : "invalid_request",
    });
  });
  return app;
}
