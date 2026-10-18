import type { FastifyInstance } from "fastify";
import {
  validateCallAuthorization,
  validateCallPreviewRequest,
  validateFamilyContactInput,
  validateIncidentAction,
} from "@blissey/contracts";
import type { VerifyOperator } from "../auth.js";
import type { CallStore } from "./store.js";
import type { DispatchStore } from "./dispatch.js";
import { CallError, digest } from "./policy.js";
import { verifyProviderEvent } from "./provider.js";
export function registerCallRoutes(
  app: FastifyInstance,
  options: {
    verifyOperator: VerifyOperator;
    store: CallStore;
    dispatch: DispatchStore;
    enabled: boolean;
    webhook?: { secret: string; agentId: string };
  },
) {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const id = (value: string) => {
    if (!uuid.test(value)) throw new CallError("invalid_id", 400);
    return value;
  };
  app.register(async (operator) => {
    operator.setErrorHandler((error, _request, reply) => {
      if (error instanceof CallError)
        return reply.code(error.statusCode).send({ error: error.code });
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      )
        return reply.code(409).send({ error: "conflict" });
      if (
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        [400, 413, 415].includes(Number(error.statusCode))
      )
        return reply
          .code(Number(error.statusCode))
          .send({ error: "invalid_request" });
      // Database errors can contain private destinations; never log provider/SQL bodies.
      app.log.error(
        { code: "notification_api_error" },
        "Notification request failed",
      );
      return reply.code(503).send({ error: "service_unavailable" });
    });
    const subjects = new WeakMap<object, string>();
    operator.addHook("preHandler", async (req, reply) => {
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
      if (!token) return reply.code(401).send({ error: "unauthorized" });
      try {
        subjects.set(req, await options.verifyOperator(token));
      } catch {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });
    function key(value: unknown) {
      if (typeof value !== "string" || !/^[-a-zA-Z0-9_:.]{8,128}$/.test(value))
        throw new CallError("idempotency_key_required", 400);
      return value;
    }
    operator.get<{
      Querystring: { facility_id?: string; patient_id?: string };
    }>("/api/operator/family-contacts", async (req) => {
      const { facility_id, patient_id } = req.query;
      if (
        typeof facility_id !== "string" ||
        typeof patient_id !== "string" ||
        !facility_id ||
        !patient_id ||
        facility_id.length > 128 ||
        patient_id.length > 128
      )
        throw new CallError("facility_and_patient_required", 400);
      return {
        contacts: await options.store.contacts(
          subjects.get(req)!,
          facility_id,
          patient_id,
        ),
      };
    });
    operator.put<{ Params: { id: string } }>(
      "/api/operator/family-contacts/:id",
      async (req) => {
        if (!validateFamilyContactInput(req.body))
          throw new CallError("invalid_contact", 400);
        return {
          contact: await options.store.saveContact(
            subjects.get(req)!,
            id(req.params.id),
            req.body,
          ),
        };
      },
    );
    operator.post<{ Params: { id: string } }>(
      "/api/operator/incidents/:id/notifications/preview",
      async (req) => {
        if (!validateCallPreviewRequest(req.body))
          throw new CallError("invalid_preview", 400);
        return {
          ...(await options.store.preview(
            subjects.get(req)!,
            id(req.params.id),
            req.body.contact_id,
            req.body.expected_revision,
          )),
          dispatch_enabled: options.enabled,
        };
      },
    );
    operator.post<{ Params: { id: string } }>(
      "/api/operator/incidents/:id/notifications",
      async (req, reply) => {
        if (!validateCallAuthorization(req.body))
          throw new CallError("invalid_authorization", 400);
        if (!options.enabled) throw new CallError("calls_not_configured", 503);
        const call = await options.store.authorize(
          subjects.get(req)!,
          id(req.params.id),
          key(req.headers["idempotency-key"]),
          req.body,
        );
        return reply.code(202).send({ call });
      },
    );
    operator.get<{ Params: { id: string } }>(
      "/api/operator/incidents/:id/notifications",
      async (req) => ({
        calls: await options.store.list(subjects.get(req)!, id(req.params.id)),
      }),
    );
    operator.get<{ Params: { id: string } }>(
      "/api/operator/incidents/:id/workflow",
      async (req) =>
        options.store.workflow(subjects.get(req)!, id(req.params.id)),
    );
    operator.patch<{ Params: { id: string } }>(
      "/api/operator/incidents/:id",
      async (req) => {
        if (!validateIncidentAction(req.body))
          throw new CallError("invalid_action", 400);
        return {
          action: await options.store.action(
            subjects.get(req)!,
            id(req.params.id),
            key(req.headers["idempotency-key"]),
            req.body,
          ),
        };
      },
    );
  });
  app.register(async (webhook) => {
    webhook.removeContentTypeParser("application/json");
    webhook.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 128 * 1024 },
      (_req, body, done) => done(null, body),
    );
    webhook.post("/api/webhooks/elevenlabs", async (req, reply) => {
      if (!options.webhook)
        return reply.code(503).send({ error: "webhook_not_configured" });
      try {
        const signature = req.headers["elevenlabs-signature"];
        const raw = req.body;
        if (!Buffer.isBuffer(raw) || typeof signature !== "string")
          throw new CallError("invalid_webhook_signature", 401);
        const event = verifyProviderEvent(
          raw,
          signature,
          options.webhook.secret,
          options.webhook.agentId,
        );
        const hash = digest(event);
        await options.dispatch.event(hash, event);
        return { accepted: true };
      } catch (error) {
        if (error instanceof CallError)
          return reply.code(error.statusCode).send({ error: error.code });
        app.log.error(
          { code: "notification_webhook_error" },
          "Call callback persistence failed",
        );
        return reply.code(503).send({ error: "service_unavailable" });
      }
    });
  });
}
