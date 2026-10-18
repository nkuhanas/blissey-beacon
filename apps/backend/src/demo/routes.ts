import type { FastifyInstance } from "fastify";
import { validateDemoScenarioRequest } from "@blissey/contracts";
import type { VerifyOperator } from "../auth.js";
import type { createDemoStore } from "./store.js";
import { CallError } from "../notifications/policy.js";
export function registerDemoRoutes(
  app: FastifyInstance,
  options: {
    verifyOperator: VerifyOperator;
    store: ReturnType<typeof createDemoStore>;
    enabled: boolean;
  },
) {
  app.register(async (routes) => {
    const subjects = new WeakMap<object, string>();
    routes.addHook("preHandler", async (req, reply) => {
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
      if (!token) return reply.code(401).send({ error: "unauthorized" });
      try {
        subjects.set(req, await options.verifyOperator(token));
      } catch {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });
    routes.setErrorHandler((error, _req, reply) => {
      if (error instanceof CallError)
        return reply.code(error.statusCode).send({ error: error.code });
      app.log.error(
        { code: "dashboard_api_error" },
        "Dashboard request failed",
      );
      return reply.code(503).send({ error: "service_unavailable" });
    });
    routes.get<{ Querystring: { facility_id?: string } }>(
      "/api/operator/dashboard",
      async (req) => {
        const facility = req.query.facility_id;
        if (typeof facility !== "string" || !facility || facility.length > 128)
          throw new CallError("facility_id_required", 400);
        return {
          rooms: await options.store.rooms(subjects.get(req)!, facility),
          scenarios_enabled: options.enabled,
        };
      },
    );
    routes.post("/api/operator/demo/scenarios", async (req, reply) => {
      if (!validateDemoScenarioRequest(req.body))
        throw new CallError("invalid_scenario", 400);
      const key = req.headers["idempotency-key"];
      if (typeof key !== "string" || !/^[-a-zA-Z0-9_:.]{8,128}$/.test(key))
        throw new CallError("idempotency_key_required", 400);
      return reply
        .code(201)
        .send(
          await options.store.instantiate(subjects.get(req)!, key, req.body),
        );
    });
  });
}
