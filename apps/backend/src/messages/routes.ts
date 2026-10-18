import type { FastifyInstance } from "fastify";
import {
  validateMessagingConsent,
  validateMessagePreviewRequest,
  validateMessageAuthorization,
  validateMessageReview,
  validateReplyReview,
} from "@blissey/contracts";
import type { VerifyOperator } from "../auth.js";
import { CallError } from "../notifications/policy.js";
import type { MessageStore } from "./store.js";
import type { MessageProvider } from "./photon.js";
export function registerMessageRoutes(
  app: FastifyInstance,
  options: {
    verifyOperator: VerifyOperator;
    store: MessageStore;
    provider?: MessageProvider;
    enabled: boolean;
  },
) {
  app.register(async (api) => {
    const subjects = new WeakMap<object, string>();
    const id = (value: string) => {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          value,
        )
      )
        throw new CallError("invalid_id", 400);
      return value;
    };
    api.setErrorHandler((error, _req, reply) => {
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
      app.log.error({ code: "message_api_error" }, "Messaging request failed");
      return reply.code(503).send({ error: "service_unavailable" });
    });
    api.addHook("preHandler", async (req, reply) => {
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
      if (!token) return reply.code(401).send({ error: "unauthorized" });
      try {
        subjects.set(req, await options.verifyOperator(token));
      } catch {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });
    api.put<{ Params: { id: string } }>(
      "/api/operator/family-contacts/:id/messaging-consent",
      async (req) => {
        if (!validateMessagingConsent(req.body))
          throw new CallError("invalid_messaging_consent", 400);
        return {
          contact: await options.store.consent(
            subjects.get(req)!,
            id(req.params.id),
            req.body,
          ),
        };
      },
    );
    api.post<{ Params: { id: string } }>(
      "/api/operator/incidents/:id/messages/preview",
      async (req) => {
        if (!validateMessagePreviewRequest(req.body))
          throw new CallError("invalid_message_preview", 400);
        const incidentId = id(req.params.id),
          subject = subjects.get(req)!;
        const destination = await options.store.destination(
          subject,
          incidentId,
          req.body,
        );
        if (!options.provider)
          throw new CallError("messaging_not_configured", 503);
        const route = await options.provider.resolve(
          destination,
          AbortSignal.timeout(30000),
        );
        return {
          ...(await options.store.preview(
            subject,
            incidentId,
            req.body,
            route,
          )),
          dispatch_enabled: options.enabled,
        };
      },
    );
    api.post<{ Params: { id: string } }>(
      "/api/operator/incidents/:id/messages",
      async (req, reply) => {
        if (!validateMessageAuthorization(req.body))
          throw new CallError("invalid_message_authorization", 400);
        if (!options.enabled) throw new CallError("messages_not_enabled", 503);
        const key = req.headers["idempotency-key"];
        if (typeof key !== "string" || !/^[-a-zA-Z0-9_:.]{8,128}$/.test(key))
          throw new CallError("idempotency_key_required", 400);
        return reply.code(202).send({
          authorization_id: await options.store.authorizeUpdate(
            subjects.get(req)!,
            id(req.params.id),
            key,
            req.body,
          ),
        });
      },
    );
    api.post<{ Params: { id: string } }>(
      "/api/operator/message-authorizations/:id/review",
      async (req, reply) => {
        if (!validateMessageReview(req.body))
          throw new CallError("invalid_message_review", 400);
        if (!options.enabled) throw new CallError("messages_not_enabled", 503);
        return reply
          .code(202)
          .send(
            await options.store.review(
              subjects.get(req)!,
              id(req.params.id),
              req.body,
            ),
          );
      },
    );
    api.get<{ Params: { id: string } }>(
      "/api/operator/incidents/:id/messages",
      async (req) =>
        options.store.history(subjects.get(req)!, id(req.params.id)),
    );
    api.get<{ Querystring: { facility_id?: string } }>(
      "/api/operator/family-replies",
      async (req) => {
        const facility = req.query.facility_id;
        if (typeof facility !== "string" || !facility || facility.length > 128)
          throw new CallError("facility_id_required", 400);
        return {
          replies: await options.store.inbox(subjects.get(req)!, facility),
        };
      },
    );
    api.patch<{ Params: { id: string } }>(
      "/api/operator/family-replies/:id",
      async (req) => {
        if (!validateReplyReview(req.body))
          throw new CallError("invalid_reply_review", 400);
        return options.store.reviewReply(
          subjects.get(req)!,
          id(req.params.id),
          req.body,
        );
      },
    );
  });
}
