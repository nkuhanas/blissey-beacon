import { CallError, digest } from "../notifications/policy.js";
export interface MessageRoute {
  sender_number: string;
  destination: string;
  sender_id: string;
  recipient_id: string;
  space_id: string;
  resource_id: string | null;
  assignment_id: string | null;
}
export interface PhotonMessage {
  id: string;
  status: string;
  spaceId: string;
  senderId: string;
  recipientId: string | null;
  parentId: string | null;
  text: string | null;
  createdAt: string;
}
export interface MessageResult {
  state: "accepted" | "failed" | "unknown";
  providerId?: string;
  code?: string;
}
export interface MessageProvider {
  resolve(destination: string, signal: AbortSignal): Promise<MessageRoute>;
  send(
    id: string,
    text: string,
    route: MessageRoute,
    signal: AbortSignal,
  ): Promise<MessageResult>;
  get(
    id: string,
    route: MessageRoute,
    signal: AbortSignal,
  ): Promise<PhotonMessage>;
  replies(
    route: MessageRoute,
    since: string,
    token: string | null,
    signal: AbortSignal,
  ): Promise<{ items: PhotonMessage[]; next: string | null }>;
}
type Obj = Record<string, unknown>;
function obj(x: unknown): Obj {
  if (!x || typeof x !== "object" || Array.isArray(x))
    throw new CallError("invalid_photon_response", 502);
  return x as Obj;
}
function str(x: unknown, max = 200): string {
  if (typeof x !== "string" || !x || x.length > max)
    throw new CallError("invalid_photon_response", 502);
  return x;
}
export function parsePhotonMessage(value: unknown): PhotonMessage {
  const o = obj(value),
    space = obj(o.space),
    sender = obj(o.sentBy),
    content = obj(o.content);
  if (
    o.platform !== "imessage" ||
    space.platform !== "imessage" ||
    sender.platform !== "imessage"
  )
    throw new CallError("invalid_photon_response", 502);
  const createdAt = str(o.createdAt, 100);
  if (!Number.isFinite(Date.parse(createdAt)))
    throw new CallError("invalid_photon_response", 502);
  return {
    id: str(o.id),
    status: str(o.status),
    spaceId: str(space.id),
    senderId: str(sender.id),
    recipientId: o.receivedBy ? str(obj(o.receivedBy).id) : null,
    parentId: o.parentMessageId ? str(o.parentMessageId) : null,
    text:
      content.type === "text" &&
      typeof content.text === "string" &&
      content.text.length > 0
        ? content.text.slice(0, 4000)
        : null,
    createdAt,
  };
}
export function createPhotonProvider(options: {
  projectId: string;
  apiKey: string;
  senderNumber: string;
  fetcher?: typeof fetch;
}): MessageProvider {
  if (
    !/^pho_prj_[a-z0-9]+$/.test(options.projectId) ||
    !/^\+[1-9][0-9]{7,14}$/.test(options.senderNumber)
  )
    throw Error("Invalid Photon project/sender configuration");
  const base = `https://api.photon.codes/v1/projects/${options.projectId}`;
  const fetcher = options.fetcher ?? fetch;
  async function request(
    path: string,
    signal: AbortSignal,
    body?: unknown,
    key?: string,
  ): Promise<Obj> {
    const response = await fetcher(base + path, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new CallError(`photon_http_${response.status}`, 502);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new CallError("invalid_photon_response", 502);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw new CallError("photon_response_too_large", 502);
      }
      chunks.push(part.value);
    }
    return obj(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  }
  function pageToken(page: Obj) {
    return page.nextPageToken === undefined
      ? null
      : str(page.nextPageToken, 4096);
  }
  async function replies(
    route: MessageRoute,
    since: string,
    token: string | null,
    signal: AbortSignal,
  ) {
    const query = new URLSearchParams({
      ...(route.resource_id
        ? {
            platform: "imessage",
            resourceId: route.resource_id,
            createdSince: since,
          }
        : { perspectiveUserId: route.sender_id }),
      spaceId: route.space_id,
      direction: "received",
      order: "asc",
      pageSize: "100",
      ...(token ? { pageToken: token } : {}),
    });
    const page = await request("/messages?" + query, signal);
    if (!Array.isArray(page.items))
      throw new CallError("invalid_photon_response", 502);
    return {
      items: page.items
        .map(parsePhotonMessage)
        .filter(
          (m) =>
            Date.parse(m.createdAt) >= Date.parse(since) &&
            m.status === "received" &&
            m.spaceId === route.space_id &&
            m.senderId === route.recipient_id &&
            m.recipientId === route.sender_id,
        ),
      next: pageToken(page),
    };
  }
  return {
    async resolve(destination, signal) {
      if (!/^\+[1-9][0-9]{7,14}$/.test(destination))
        throw new CallError("invalid_messaging_destination", 400);
      const settings = await request("/platforms/imessage", signal);
      let assignment: Obj | undefined;
      if (settings.mode === "shared") {
        let token: string | null = null;
        for (let count = 0; count < 32; count++) {
          const page = await request(
            "/platforms/imessage/assignments?" +
              new URLSearchParams({
                pageSize: "100",
                ...(token ? { pageToken: token } : {}),
              }),
            signal,
          );
          if (!Array.isArray(page.assignments))
            throw new CallError("invalid_photon_response", 502);
          assignment = page.assignments
            .map(obj)
            .find(
              (a) =>
                a.handle === destination &&
                a.assignedPhoneNumber === options.senderNumber &&
                !a.releasedAt,
            );
          if (assignment) break;
          token = pageToken(page);
          if (!token) break;
        }
        if (!assignment) throw new CallError("imessage_assignment_required");
      } else if (settings.mode !== "dedicated")
        throw new CallError("invalid_photon_response", 502);
      // These official create-or-get operations resolve identities and a DM; they send no message.
      const sender = await request("/users", signal, {
        platform: "imessage",
        handle: options.senderNumber,
      });
      const recipient = await request("/users", signal, {
        platform: "imessage",
        handle: destination,
      });
      if (
        sender.platform !== "imessage" ||
        recipient.platform !== "imessage" ||
        sender.handle !== options.senderNumber ||
        recipient.handle !== destination
      )
        throw new CallError("imessage_identity_mismatch");
      // Shared line identities intentionally omit resourceId. The active assignment
      // authorizes this sender; query the documented user perspective for its DM.
      const resourceId = assignment
        ? null
        : str(obj(sender.details).resourceId);
      if (resourceId) {
        const resource = await request(
          "/platforms/resources/" + encodeURIComponent(resourceId),
          signal,
        );
        if (
          resource.state !== "active" ||
          !Array.isArray(resource.abilities) ||
          !resource.abilities.includes("imessage")
        )
          throw new CallError("imessage_sender_unavailable");
      }
      const senderId = str(sender.id),
        recipientId = str(recipient.id);
      const space = await request(
        "/spaces",
        signal,
        {
          platform: "imessage",
          participantIds: [senderId, recipientId],
        },
        "blissey-space-" +
          digest({ project: options.projectId, senderId, recipientId }),
      );
      if (
        space.platform !== "imessage" ||
        !Array.isArray(space.participantIds) ||
        space.participantIds.length !== 2 ||
        !space.participantIds.includes(senderId) ||
        !space.participantIds.includes(recipientId)
      )
        throw new CallError("imessage_space_mismatch");
      const route: MessageRoute = {
        sender_number: options.senderNumber,
        destination,
        sender_id: senderId,
        recipient_id: recipientId,
        space_id: str(space.id),
        resource_id: resourceId,
        assignment_id: assignment ? str(assignment.assignmentId) : null,
      };
      if (assignment) {
        const since = str(assignment.createdAt, 100);
        let token: string | null = null,
          onboarded = false;
        for (let count = 0; count < 32; count++) {
          const page = await replies(route, since, token, signal);
          if (page.items.length) {
            onboarded = true;
            break;
          }
          token = page.next;
          if (!token) break;
        }
        if (!onboarded)
          throw new CallError("imessage_inbound_onboarding_required");
      }
      return route;
    },
    async send(id, text, route, signal) {
      try {
        const sent = parsePhotonMessage(
          await request(
            "/messages",
            signal,
            {
              senderId: route.sender_id,
              spaceId: route.space_id,
              content: { type: "text", format: "plain", text },
            },
            "blissey-message-" + id,
          ),
        );
        if (
          sent.senderId !== route.sender_id ||
          sent.spaceId !== route.space_id ||
          sent.text !== text
        )
          return { state: "unknown", code: "photon_identity_mismatch" };
        return {
          state: sent.status === "failed" ? "failed" : "accepted",
          providerId: sent.id,
        };
      } catch (e) {
        const code =
          e instanceof CallError ? e.code : "photon_submission_interrupted";
        return {
          state: /^photon_http_(400|401|403|404|422)$/.test(code)
            ? "failed"
            : "unknown",
          code,
        };
      }
    },
    async get(id, route, signal) {
      const m = parsePhotonMessage(
        await request("/messages/" + encodeURIComponent(id), signal),
      );
      if (
        m.id !== id ||
        m.senderId !== route.sender_id ||
        m.spaceId !== route.space_id
      )
        throw new CallError("photon_identity_mismatch");
      return m;
    },
    replies,
  };
}
