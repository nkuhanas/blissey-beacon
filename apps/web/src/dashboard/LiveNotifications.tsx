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
type Bundle = { call: CallPreview; message: MessagePreview | null };
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
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [calls, setCalls] = useState<NotificationCall[]>([]);
  const [history, setHistory] = useState<MessageHistory | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(
    () => !!sessionStorage.getItem("notification-intent:" + incidentId),
  );
  const [retry, setRetry] = useState(0);
  const preview = useRef<Bundle | null>(null);
  const attempted = useRef(false);
  const generation = useRef(0);
  const intentKey = useRef(crypto.randomUUID());
  useEffect(() => {
    const epoch = ++generation.current;
    let polling = false;
    const alive = () => epoch === generation.current;
    async function update() {
      if (polling) return;
      polling = true;
      try {
        const [result, messages, w] = await Promise.all([
          api.calls(incidentId),
          api.messages(incidentId),
          api.workflow(incidentId),
        ]);
        if (!alive()) return;
        setCalls((previous) =>
          result.calls.length
            ? result.calls
            : attempted.current
              ? previous
              : [],
        );
        setHistory(messages);
        if (result.calls.length) {
          sessionStorage.removeItem("notification-intent:" + incidentId);
          setUncertain(false);
          setLoading(false);
          return;
        }
        if (sessionStorage.getItem("notification-intent:" + incidentId)) {
          setUncertain(true);
          setLoading(false);
          return;
        }
        if (attempted.current) return;
        const current = preview.current;
        if (
          current &&
          current.call.expected_revision === w.revision &&
          Date.parse(current.call.expires_at) > Date.now() + 5000 &&
          (!current.message ||
            Date.parse(current.message.expires_at) > Date.now() + 5000)
        ) {
          setLoading(false);
          return;
        }
        preview.current = null;
        setBundle(null);
        setApproved(false);
        setLoading(true);
        if (!w.patient_id)
          throw new Error("No resident assignment is saved for this incident.");
        const contacts = await api.contacts(facilityId, w.patient_id);
        const contact = contacts.contacts.find(
          (c) => c.consent_status === "granted",
        );
        if (!contact)
          throw new Error(
            "No consented family contact is saved for this incident.",
          );
        const call = await api.previewCall(incidentId, contact.id, w.revision);
        const message =
          contact.imessage_consent_status === "granted"
            ? await api.previewMessages(
                incidentId,
                contact.id,
                w.revision,
                false,
              )
            : null;
        if (!alive()) return;
        preview.current = { call, message };
        setBundle(preview.current);
        setError("");
        setLoading(false);
      } catch (e) {
        if (alive()) {
          if (
            e instanceof OperatorError &&
            [
              "explanation_not_ready",
              "incident_revision_conflict",
              "message_review_changed",
            ].includes(e.code)
          ) {
            setError("");
            setLoading(true);
          } else {
            setError(
              e instanceof Error
                ? e.message
                : "Unable to load family notification",
            );
            setLoading(false);
          }
        }
      } finally {
        polling = false;
      }
    }
    void update();
    const timer = setInterval(() => void update(), 4000);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [api, incidentId, retry]);
  async function authorize() {
    if (!bundle || !approved || attempted.current) return;
    attempted.current = true;
    setBusy(true);
    setError("");
    try {
      sessionStorage.setItem(
        "notification-intent:" + incidentId,
        intentKey.current,
      );
      const result = await api.authorize(
        incidentId,
        {
          preview_id: bundle.call.preview_id,
          context_hash: bundle.call.context_hash,
          expected_revision: bundle.call.expected_revision,
          explicit_authorization: true,
          ...(bundle.message
            ? {
                message_preview_id: bundle.message.preview_id,
                message_context_hash: bundle.message.context_hash,
                explicit_messaging_authorization: true,
              }
            : {}),
        },
        intentKey.current,
      );
      setCalls([result.call]);
      sessionStorage.removeItem("notification-intent:" + incidentId);
      setBundle(null);
      preview.current = null;
      onUpdated();
    } catch (e) {
      if (
        e instanceof OperatorError &&
        [400, 401, 403, 404, 409, 422].includes(e.status)
      ) {
        sessionStorage.removeItem("notification-intent:" + incidentId);
        attempted.current = false;
        preview.current = null;
        setBundle(null);
        setApproved(false);
        intentKey.current = crypto.randomUUID();
        setError(
          "The incident or contact changed. Loading the latest details for a fresh approval.",
        );
        setRetry((n) => n + 1);
      } else {
        setUncertain(true);
        setBundle(null);
        setError(
          "The authorization response was interrupted. Checking the saved call status; it will not be redialed automatically.",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  const sent = calls.length > 0;
  return (
    <Modal
      title={sent ? "Family notification" : "Notify family?"}
      onClose={onClose}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {sent ? (
        <>
          <p>
            Follow-up selection and delivery are automatic. No post-call review
            is needed.
          </p>
          {calls.map((c) => (
            <div className="note" key={c.id}>
              <strong>Call {c.transport_status.replaceAll("_", " ")}</strong>
              {c.summary && <p>{c.summary}</p>}
              {c.callback_requested && <p>Family requested a callback.</p>}
              {c.error_code && <p>{c.error_code.replaceAll("_", " ")}</p>}
            </div>
          ))}
        </>
      ) : uncertain ? (
        <p role="status">
          Checking the saved notification status… No second call will be placed.
        </p>
      ) : loading ? (
        <p role="status">
          Preparing the family notification from the latest incident…
        </p>
      ) : bundle ? (
        <>
          <p>
            Call <strong>{bundle.call.recipient.name}</strong> about{" "}
            <strong>
              {bundle.call.context.resident_name ?? "the resident"}
            </strong>{" "}
            and this incident.
          </p>
          <p>{bundle.call.context.family_summary}</p>
          <p className="small muted">
            Fictional family contact · delivery to the registered test phone.
          </p>
          {bundle.message ? (
            <p>
              We’ll automatically send a follow-up text after the call,
              including if it is missed or the outcome is unclear.
            </p>
          ) : (
            <p className="notice">
              Messaging consent is not configured for this contact. This
              approval places a call only.
            </p>
          )}
          <details>
            <summary>Call details and follow-up messages</summary>
            <h3>Opening</h3>
            <p>{bundle.call.opening}</p>
            {bundle.message && (
              <>
                <h3>After the incident is communicated</h3>
                <p>{bundle.message.candidates.summary}</p>
                <h3>Missed, incomplete or unclear call</h3>
                <p>{bundle.message.candidates.missed}</p>
              </>
            )}
            <h3>Conversation policy</h3>
            <p>{bundle.call.policy}</p>
          </details>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            <span>
              {bundle.message
                ? "I authorize this call and its automatic follow-up text to the saved family contact."
                : "I authorize this call to the saved family contact."}
            </span>
          </label>
          {(!bundle.call.dispatch_enabled ||
            (bundle.message && !bundle.message.dispatch_enabled)) && (
            <p className="notice">Notifications are temporarily unavailable.</p>
          )}
          <button
            className="primary full"
            disabled={
              !approved ||
              busy ||
              !bundle.call.dispatch_enabled ||
              (!!bundle.message && !bundle.message.dispatch_enabled) ||
              Date.parse(bundle.call.expires_at) <= Date.now() ||
              (!!bundle.message &&
                Date.parse(bundle.message.expires_at) <= Date.now())
            }
            onClick={() => void authorize()}
          >
            {busy ? "Notifying…" : "Yes, notify family"}
          </button>
        </>
      ) : (
        <button onClick={() => setRetry((n) => n + 1)}>
          Reload notification details
        </button>
      )}
      {history?.authorizations.some((a) => a.state === "waiting") && (
        <p className="small muted">
          The approved text will be selected automatically after the call
          outcome arrives.
        </p>
      )}
      {history?.authorizations.some((a) => a.state === "review") && (
        <p className="small muted">
          An earlier notification used the previous approval rules and remains
          held.
        </p>
      )}
      {!!history?.messages.length && (
        <section>
          <h3>Text message</h3>
          {history.messages.map((m) => (
            <div className="note" key={m.id}>
              <strong>{m.state}</strong>
              <p>{m.body}</p>
              {m.error_code && <p>{m.error_code.replaceAll("_", " ")}</p>}
            </div>
          ))}
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
    </Modal>
  );
}
