import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { Room } from "@blissey/contracts";
import type { VerifyOperator } from "./auth.js";
export interface Store {
  isMember(subject: string, facilityId: string): Promise<boolean>;
  listRooms(facilityId: string): Promise<Room[]>;
}
export async function createApp(options: {
  verifyOperator: VerifyOperator;
  store: Store;
  webOrigin: string;
}) {
  const app = Fastify({ logger: { redact: ["req.headers.authorization"] } });
  await app.register(cors, { origin: options.webOrigin });
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
  return app;
}
