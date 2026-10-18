import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { supabase, facilityId } from "../client";
import { OperatorError } from "../operator-api";
import type {
  OperatorApi,
  CallPreview,
  MessagePreview,
  NotificationCall,
  MessageHistory,
} from "../operator-api";
export function OperatorLogin({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Operator sign-in" onClose={onClose}>
      <p>
        Use the provisioned demo operator account. Scenario creation and real
        notifications require an authenticated operator.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          void (async () => {
            try {
              if (!supabase) throw new Error("Supabase is not configured");
              const result = await supabase.auth.signInWithPassword({
                email,
                password,
              });
              if (result.error)
                throw new Error("Sign-in failed. Check your credentials.");
              setPassword("");
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Sign-in failed");
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </Modal>
  );
}
export function LiveCallReview({
  api,
  incidentId,
  onClose,
  onUpdated,
}: {
  api: OperatorApi;
  incidentId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [call, setCall] = useState<CallPreview | null>(null);
  const [message, setMessage] = useState<MessagePreview | null>(null);
  const [calls, setCalls] = useState<NotificationCall[]>([]);
  const [history, setHistory] = useState<MessageHistory | null>(null);
  const [withMessages, setWithMessages] = useState(true);
  const [staffDispatched, setStaffDispatched] = useState(false);
  const [approveCall, setApproveCall] = useState(false);
  const [approveText, setApproveText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [evidence, setEvidence] = useState<
    "" | "communicated" | "no_answer" | "voicemail"
  >("");
  const [recipientVerified, setRecipientVerified] = useState(false);
  const [reviewApproved, setReviewApproved] = useState(false);
  const authorizationKey = useRef(crypto.randomUUID());
  const attempted = useRef(false);
  const currentIncident = useRef(incidentId);
  currentIncident.current = incidentId;
  async function refresh() {
    const id = incidentId;
    const [result, messages] = await Promise.all([
      api.calls(id),
      api.messages(id),
    ]);
    if (currentIncident.current !== id) return;
    setCalls(result.calls);
    setHistory(messages);
    if (result.calls.length) {
      setUncertain(false);
      sessionStorage.removeItem("notification-intent:" + id);
    }
  }
  useEffect(() => {
    currentIncident.current = incidentId;
    let stopped = false;
    const update = () =>
      void refresh().catch(() => {
        if (!stopped)
          setError(
            "Unable to refresh call/message history. Use Check status before doing anything else.",
          );
      });
    setUncertain(!!sessionStorage.getItem("notification-intent:" + incidentId));
    update();
    const timer = setInterval(update, 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
      currentIncident.current = "";
    };
    // The API identity changes when the authenticated session refreshes.
  }, [api, incidentId]);
  async function prepare() {
    setBusy(true);
    setError("");
    setCall(null);
    setMessage(null);
    setApproveCall(false);
    setApproveText(false);
    try {
      const existing = await api.calls(incidentId);
      if (existing.calls.length) {
        setCalls(existing.calls);
        throw new Error(
          "This incident already has a call. Instantiate a new scenario for another rehearsal; nothing will be redialed automatically.",
        );
      }
      const workflow = await api.workflow(incidentId);
      if (!workflow.patient_id)
        throw new Error(
          "No unambiguous historical resident assignment. A call cannot be prepared.",
        );
      const contacts = await api.contacts(facilityId, workflow.patient_id);
      const contact = contacts.contacts.find(
        (c) => c.consent_status === "granted",
      );
      if (!contact)
        throw new Error(
          "No consented family contact is saved for this incident.",
        );
      if (withMessages && contact.imessage_consent_status !== "granted")
        throw new Error(
          "This contact has not consented to iMessage. Prepare a call only or configure messaging consent.",
        );
      const nextCall = await api.previewCall(
        incidentId,
        contact.id,
        workflow.revision,
      );
      const nextMessage = withMessages
        ? await api.previewMessages(
            incidentId,
            contact.id,
            workflow.revision,
            staffDispatched,
          )
        : null;
      setCall(nextCall);
      setMessage(nextMessage);
      authorizationKey.current = crypto.randomUUID();
      attempted.current = false;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to prepare notification",
      );
    } finally {
      setBusy(false);
    }
  }
  async function authorize() {
    if (!call || !approveCall || (message && !approveText) || attempted.current)
      return;
    attempted.current = true;
    setBusy(true);
    setError("");
    sessionStorage.setItem(
      "notification-intent:" + incidentId,
      authorizationKey.current,
    );
    try {
      const result = await api.authorize(
        incidentId,
        {
          preview_id: call.preview_id,
          context_hash: call.context_hash,
          expected_revision: call.expected_revision,
          explicit_authorization: true,
          ...(message
            ? {
                message_preview_id: message.preview_id,
                message_context_hash: message.context_hash,
                explicit_messaging_authorization: true,
              }
            : {}),
        },
        authorizationKey.current,
      );
      setCalls([result.call]);
      sessionStorage.removeItem("notification-intent:" + incidentId);
      setCall(null);
      setMessage(null);
      onUpdated();
      await refresh();
    } catch (e) {
      if (
        e instanceof OperatorError &&
        [400, 401, 403, 404, 409, 422].includes(e.status)
      ) {
        sessionStorage.removeItem("notification-intent:" + incidentId);
        setCall(null);
        setMessage(null);
        attempted.current = false;
        setError(
          e.message + ". Prepare a fresh review before authorizing again.",
        );
      } else {
        setUncertain(true);
        setError(
          (e instanceof Error
            ? e.message
            : "Authorization response unavailable") +
            ". Check status; no automatic resend will occur.",
        );
      }
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const pendingReview = history?.authorizations.find(
    (a) => a.state === "review",
  );
  const alreadyCalled = calls.length > 0;
  return (
    <Modal title="Review family call & text" onClose={onClose}>
      <p className="notice">
        Fictional resident and family contact. A real call and approved texts go
        to the registered test phone.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {alreadyCalled ? (
        <section className="notification-results">
          <h3>Call status</h3>
          {calls.map((c) => (
            <div className="note" key={c.id}>
              <strong>{c.transport_status.replaceAll("_", " ")}</strong>
              <p>
                {c.notification_success
                  ? "Incident notification confirmed"
                  : "Spoken-notification evidence is not confirmed."}
              </p>
              {c.callback_requested && (
                <p>Callback requested — awaiting operator review.</p>
              )}
              {c.summary && <p>{c.summary}</p>}
              {c.error_code && <p>{c.error_code.replaceAll("_", " ")}</p>}
            </div>
          ))}
        </section>
      ) : uncertain ? (
        <p className="notice">
          The previous authorization is being reconciled. Check status before
          starting another call.
        </p>
      ) : !call ? (
        <>
          <p>
            Prepare a frozen review from the persisted incident and explanation.
            Acknowledging an incident alone does not place a call.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={withMessages}
              onChange={(e) => setWithMessages(e.target.checked)}
            />
            <span>Include a post-call iMessage follow-up.</span>
          </label>
          {withMessages && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={staffDispatched}
                onChange={(e) => setStaffDispatched(e.target.checked)}
              />
              <span>
                I confirm staff dispatch for this incident. Include the
                care-team update in the successful-call text.
              </span>
            </label>
          )}
          <button
            className="primary full"
            disabled={busy}
            onClick={() => void prepare()}
          >
            {busy ? "Preparing…" : "Prepare call & message review"}
          </button>
        </>
      ) : (
        <>
          <dl className="facts">
            <div>
              <dt>Resident</dt>
              <dd>{call.context.resident_name ?? "Not available"}</dd>
            </div>
            <div>
              <dt>Recipient</dt>
              <dd>{call.recipient.name}</dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd>Registered test phone</dd>
            </div>
            <div>
              <dt>Incident status</dt>
              <dd>{call.context.incident_status}</dd>
            </div>
            <div>
              <dt>Explanation</dt>
              <dd>{call.context.explanation_source}</dd>
            </div>
          </dl>
          <p className="small muted">
            Review expires {new Date(call.expires_at).toLocaleTimeString()}. If
            it expires, close and prepare a fresh review.
          </p>
          <h3>Facts to share</h3>
          <p>{call.context.family_summary}</p>
          <h3>Opening</h3>
          <blockquote>{call.opening}</blockquote>
          <details>
            <summary>Conversation policy</summary>
            <p>{call.policy}</p>
          </details>
          {message && (
            <>
              <h3>After a communicated incident</h3>
              <blockquote>{message.candidates.summary}</blockquote>
              <h3>Missed or incomplete call</h3>
              <blockquote>{message.candidates.missed}</blockquote>
            </>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={approveCall}
              onChange={(e) => setApproveCall(e.target.checked)}
            />
            <span>
              I reviewed the recipient, facts, opening and policy, and authorize
              one real call.
            </span>
          </label>
          {message && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={approveText}
                onChange={(e) => setApproveText(e.target.checked)}
              />
              <span>
                I reviewed both messages and authorize the selected follow-up
                after this call.
              </span>
            </label>
          )}
          {(!call.dispatch_enabled ||
            (message && !message.dispatch_enabled)) && (
            <p className="notice">
              Calling or messaging is disabled in the backend configuration.
            </p>
          )}
          <button
            className="primary full"
            disabled={
              busy ||
              !approveCall ||
              (!!message && !approveText) ||
              !call.dispatch_enabled ||
              (!!message && !message.dispatch_enabled) ||
              attempted.current ||
              Date.parse(call.expires_at) <= Date.now() ||
              (!!message && Date.parse(message.expires_at) <= Date.now())
            }
            onClick={() => void authorize()}
          >
            {busy ? "Authorizing…" : "Authorize call & approved follow-up"}
          </button>
        </>
      )}
      {history?.messages.length ? (
        <section>
          <h3>Message delivery</h3>
          {history.messages.map((m) => (
            <div className="note" key={m.id}>
              <strong>{m.state}</strong>
              <p>{m.body}</p>
              {m.error_code && <p>{m.error_code.replaceAll("_", " ")}</p>}
            </div>
          ))}
        </section>
      ) : null}
      {pendingReview && (
        <section>
          <h3>Review call outcome</h3>
          <p>
            Confirm what happened before releasing the approved follow-up. A
            completed call alone does not confirm the incident was spoken.
          </p>
          <label>
            Observed outcome
            <select
              value={evidence}
              onChange={(e) => setEvidence(e.target.value as typeof evidence)}
            >
              <option value="">Select an outcome</option>
              <option value="communicated">Incident was communicated</option>
              <option value="no_answer">No answer</option>
              <option value="voicemail">Voicemail</option>
            </select>
          </label>
          {evidence === "communicated" && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={recipientVerified}
                onChange={(e) => setRecipientVerified(e.target.checked)}
              />
              <span>The intended recipient was verified.</span>
            </label>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={reviewApproved}
              onChange={(e) => setReviewApproved(e.target.checked)}
            />
            <span>
              I confirm this outcome and authorize the preapproved follow-up.
            </span>
          </label>
          <button
            className="primary full"
            disabled={
              busy ||
              !evidence ||
              !reviewApproved ||
              (evidence === "communicated" && !recipientVerified)
            }
            onClick={() => {
              setBusy(true);
              setError("");
              void (async () => {
                try {
                  const w = await api.workflow(incidentId);
                  await api.reviewMessage(
                    pendingReview.id,
                    w.revision,
                    evidence as "communicated" | "no_answer" | "voicemail",
                    recipientVerified,
                  );
                  await refresh();
                  onUpdated();
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Outcome review failed",
                  );
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Confirm outcome & send approved text
          </button>
        </section>
      )}
      {!!history?.replies.length && (
        <section>
          <h3>Family replies</h3>
          {history.replies.map((r) => (
            <p className="note" key={r.id}>
              {r.body}
              <br />
              {r.intent.replaceAll("_", " ")}
            </p>
          ))}
        </section>
      )}
      <button
        className="full"
        onClick={() =>
          void refresh().catch(() =>
            setError("Status is unavailable. Nothing has been resent."),
          )
        }
      >
        Check status
      </button>
    </Modal>
  );
}
