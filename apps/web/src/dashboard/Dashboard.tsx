import { supabase } from "../client";
import { Modal } from "./Modal";
import { OperatorLogin, LiveCallReview } from "./LiveNotifications";
import { useOperatorDashboard } from "./useOperatorDashboard";
import { useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import logo from "../../../../design/brand/blissey-beacon-logo-v1.png";
import { Icon } from "./Icon";
import { FacilityMap } from "./FacilityMap";
import { SensorHistory } from "./SensorHistory";
import { MoonlitBackground, MoonlitHills } from "./MoonlitDecor";
import moonlitLogo from "../../../../design/brand/blissey-beacon-moonlit-mark.png";
import branch from "../../../../design/ornaments/conservatory-branch.svg";
import { canReviewCall, createDemo, demoReducer, roomStatus } from "./model";
import type { Contact, DemoIncident, DemoRoom, Scenario } from "./model";
import "./dashboard.css";
import "./refinement.css";
import "./moonlit.css";
import "./workspace.css";

type View = "overview" | "residents" | "history" | "devices";
const navigation: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "residents", label: "Residents" },
  { id: "history", label: "History" },
  { id: "devices", label: "Devices" },
];
function Status({
  room,
  incident,
}: {
  room: DemoRoom;
  incident: DemoIncident | null;
}) {
  const tone =
    incident?.roomId === room.id && incident.status !== "resolved"
      ? "attention"
      : !room.online
        ? "offline"
        : "monitoring";
  return (
    <span className={`status ${tone}`}>
      <Icon
        name={
          tone === "offline"
            ? "offline"
            : tone === "attention"
              ? "alert"
              : "check"
        }
        size={16}
      />
      {roomStatus(room, incident)}
    </span>
  );
}
function ContactForm({
  room,
  onSave,
  onClose,
}: {
  room: DemoRoom;
  onSave: (contact: Contact) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(room.contact?.name ?? "");
  const [phone, setPhone] = useState(room.contact?.phone ?? "");
  const [consent, setConsent] = useState(room.contact?.consent ?? false);
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !/^\+[1-9]\d{7,14}$/.test(phone.trim())) {
      setError(
        "Enter a contact name and phone number with country code, such as +12025550142.",
      );
      return;
    }
    onSave({ name: name.trim(), phone: phone.trim(), consent });
  }
  return (
    <Modal title="Family contact" onClose={onClose}>
      <p className="muted">
        {room.resident} · Room {room.id}
      </p>
      <p className="notice">
        Practice with fictional details. Changes last until you reset or refresh
        this demo.
      </p>
      <form onSubmit={submit}>
        <label>
          Contact name
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          Phone number
          <input
            required
            type="tel"
            inputMode="tel"
            maxLength={16}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-describedby="phone-help"
            autoComplete="off"
          />
        </label>
        <p id="phone-help" className="muted small">
          Include + and country code. Example: +12025550142.
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>This family contact agreed to receive calls.</span>
        </label>
        <p className="small muted">
          Saving a contact never authorizes a call. You can revoke consent by
          unchecking this box.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="primary">
            Save demo contact
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CallReview({
  room,
  incident,
  onClose,
}: {
  room: DemoRoom;
  incident: DemoIncident;
  onClose: () => void;
}) {
  const [approved, setApproved] = useState(false);
  const [result, setResult] = useState(false);
  const contact = room.contact!;
  return (
    <Modal
      title={result ? "Authorization preview" : "Review family notification"}
      onClose={onClose}
    >
      <p className="notice">
        Simulation only · No telephone call will be placed.
      </p>
      {result ? (
        <>
          <p role="status">
            Demo authorization recorded for this preview. No provider was
            contacted and no delivery or speech is confirmed.
          </p>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </>
      ) : (
        <>
          <dl className="facts">
            <div>
              <dt>Recipient</dt>
              <dd>{contact.name}</dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd>Phone ending {contact.phone.slice(-4)}</dd>
            </div>
            <div>
              <dt>Consent</dt>
              <dd>Agreed to receive calls</dd>
            </div>
          </dl>
          <h3>Facts to share</h3>
          <p>
            A staged possible-fall event was recorded for {room.resident} in
            Room {room.id} at 2:32 PM. Demo incident status: {incident.status}.
            Their current condition has not been confirmed.
          </p>
          <h3>Opening message</h3>
          <blockquote>
            “Hello, this is a demo update from James West Alumni Center at UCLA
            about {room.resident}. A possible fall was detected. Their current
            condition has not been confirmed.”
          </blockquote>
          <h3>Conversation boundaries</h3>
          <p>
            Use only these reviewed facts. Do not infer injury, treatment or
            staff arrival. Offer to record a callback request; do not promise a
            response time.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            <span>
              I reviewed the recipient, facts, opening and conversation
              boundaries.
            </span>
          </label>
          <button
            className="primary full"
            disabled={!approved}
            onClick={() => setResult(true)}
          >
            Simulate call authorization
          </button>
        </>
      )}
    </Modal>
  );
}
export function Dashboard() {
  const refined =
    new URLSearchParams(window.location.search).get("style") !== "base";
  const moonlit =
    refined &&
    new URLSearchParams(window.location.search).get("style") !== "conservatory";
  const [demoState, dispatchDemo] = useReducer(demoReducer, undefined, () =>
    createDemo(),
  );
  const [selected, setSelected] = useState("104");
  const connected =
    new URLSearchParams(window.location.search).get("demo") !== "1";
  const live = useOperatorDashboard(connected, selected);
  const state = connected && live.session ? live.state : demoState;
  async function dispatch(action: import("./model").DemoAction) {
    if (!connected) {
      dispatchDemo(action);
      return true;
    }
    if (!live.session) {
      setModal("login");
      return false;
    }
    try {
      await live.dispatch(action);
      if (action.type === "advance" && action.status === "acknowledged")
        setModal("call");
      return true;
    } catch {
      return false;
    }
  }
  const [view, setView] = useState<View>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<"contact" | "call" | "login" | null>(
    new URLSearchParams(window.location.search).get("operator") === "1"
      ? "login"
      : null,
  );
  const [note, setNote] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [scenario, setScenario] = useState<Scenario>("attention");
  const detailRef = useRef<HTMLElement>(null);
  const room = state.rooms.find((r) => r.id === selected)!;
  const incident = state.incident?.roomId === selected ? state.incident : null;
  const active =
    connected && live.session
      ? live.records.filter((i) => i.status !== "resolved").length
      : state.incident && state.incident.status !== "resolved"
        ? 1
        : 0;
  const pendingRooms =
    connected && live.session
      ? [
          ...new Set(
            live.records
              .filter((i) => i.status === "pending")
              .map((i) => i.room_id),
          ),
        ]
      : state.incident?.status === "pending"
        ? [state.incident.roomId]
        : [];
  const offline = state.rooms.filter((r) => !r.online);
  const sorted = [...state.rooms].sort((a, b) => {
    const rank = (r: DemoRoom) =>
      (
        connected && live.session
          ? live.records.some(
              (i) => i.room_id === r.id && i.status !== "resolved",
            )
          : state.incident?.roomId === r.id && active
      )
        ? 0
        : !r.online
          ? 1
          : 2;
    return rank(a) - rank(b) || a.id.localeCompare(b.id);
  });
  function selectRoom(id: string) {
    setSelected(id);
    if (connected) live.focus(null);
    setNote("");
    setAnnouncement(`Room ${id} selected.`);
    if (window.innerWidth < 1024) {
      detailRef.current?.scrollIntoView({
        behavior: "instant",
        block: "start",
      });
      detailRef.current?.focus({ preventScroll: true });
    }
  }
  function reset(next: Scenario) {
    setScenario(next);
    dispatch({ type: "reset", scenario: next });
    setSelected("104");
    setNote("");
    setModal(null);
    setAnnouncement("Demo reset. All changes cleared.");
  }
  const triggerTime = incident?.record
    ? new Date(incident.record.detected_at).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : "2:32 PM";
  const triggerDate = incident?.record
    ? new Date(incident.record.detected_at).toLocaleDateString([], {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "October 17, 2026";
  const detail = (
    <section
      className="resident-panel panel"
      data-attention={
        incident && incident.status !== "resolved" ? true : undefined
      }
      data-state={incident?.status ?? (!room.online ? "offline" : "monitoring")}
      ref={detailRef}
      tabIndex={-1}
      aria-labelledby="resident-title"
    >
      <div className="section-heading incident-signal">
        <span className="signal-icon" aria-hidden="true">
          <Icon
            name={
              incident
                ? incident.status === "resolved"
                  ? "check"
                  : "alert"
                : !room.online
                  ? "offline"
                  : "residents"
            }
            size={18}
          />
        </span>
        <p className="eyebrow">
          {incident && incident.status !== "resolved"
            ? incident.status === "pending"
              ? "Needs attention"
              : "Active incident"
            : !room.online
              ? "Monitoring interrupted"
              : "Resident detail"}
        </p>
        {incident && (
          <span className="incident-status">
            {incident.status === "pending"
              ? "Needs review"
              : incident.status === "acknowledged"
                ? "Acknowledged"
                : incident.status === "responding"
                  ? "Responding"
                  : "Resolved"}
          </span>
        )}
      </div>
      <div className="resident-heading">
        <span className="avatar">
          {room.resident
            .split(" ")
            .map((n) => n[0])
            .join("")}
        </span>
        <div>
          <h2 id="resident-title">{room.resident}</h2>
          <p className="small muted">
            Room {room.id} · Device {room.device}
            {room.dataSource === "synthetic" ? " · Synthetic feed" : ""}
          </p>
        </div>
      </div>
      {!room.online && (
        <div className="notice monitoring-notice">
          <strong>
            <Icon name="offline" size={16} />{" "}
            {room.monitoringStatus === "degraded"
              ? "Monitoring degraded"
              : "Sensor offline"}
          </strong>
          <p>
            {connected && live.session
              ? `No current sensing data. Last telemetry: ${room.lastDataAt ? new Date(room.lastDataAt).toLocaleString() : "not received"}.`
              : "No current sensing data. Last staged data: 2:25 PM."}
          </p>
          <p>Room status cannot be confirmed while the sensor is offline.</p>
        </div>
      )}
      {incident ? (
        <>
          <div className="incident-callout">
            <h3>
              {incident.status === "resolved"
                ? incident.falseAlarm
                  ? "Marked as false alarm"
                  : "Incident resolved"
                : "Possible fall detected"}
            </h3>
            <p>
              {incident.status === "resolved"
                ? incident.record
                  ? "This incident remains in persisted history."
                  : "This staged incident remains in the demo history."
                : `Check on the resident in Room ${room.id}.`}
            </p>
            <p className="small muted">
              Trigger time {triggerTime} · {triggerDate}
              <br />
              Explanation {incident.explanation} ·{" "}
              {incident.record
                ? incident.record.event_id.startsWith("synthetic_")
                  ? "Synthetic event"
                  : "Device event"
                : "Staged event"}
            </p>
          </div>
          {incident.explanation !== "pending" && (
            <div className="explanation">
              <h3>
                {incident.explanation === "fallback"
                  ? "Explanation unavailable"
                  : incident.record
                    ? "Incident explanation"
                    : "Sample explanation"}
              </h3>
              <p>
                {incident.explanation === "fallback"
                  ? "The explanation could not be generated. The incident is still available for review."
                  : (incident.record?.explanation?.description ??
                    "The staged sensor event indicates a possible fall. Check on the resident; this sample does not confirm a fall or injury.")}
              </p>
            </div>
          )}
          {incident.status !== "resolved" && (
            <button
              className="primary full incident-next-action"
              disabled={
                connected && (live.session ? live.busy || live.stale : false)
              }
              onClick={() => {
                const next =
                  incident.status === "pending"
                    ? "acknowledged"
                    : incident.status === "acknowledged"
                      ? "responding"
                      : "resolved";
                dispatch({ type: "advance", status: next });
                if (!connected)
                  setAnnouncement(`Demo incident marked ${next}.`);
              }}
            >
              {incident.status === "pending"
                ? "Acknowledge incident"
                : incident.status === "acknowledged"
                  ? "Mark responding"
                  : "Resolve incident"}
              <Icon name="arrow" size={16} />
            </button>
          )}
          {incident.status !== "resolved" &&
            (!connected ||
              !live.session ||
              incident.status === "responding") && (
              <button
                className="text-button"
                disabled={
                  connected &&
                  !!live.session &&
                  (incident.status !== "responding" || live.busy || live.stale)
                }
                title={
                  connected
                    ? "Mark responding before resolving as a false alarm"
                    : undefined
                }
                onClick={() => {
                  dispatch({ type: "false-alarm" });
                  if (!connected)
                    setAnnouncement("Demo incident resolved as a false alarm.");
                }}
              >
                Mark as false alarm
              </button>
            )}
        </>
      ) : room.online ? (
        <div className="quiet">
          <Status room={room} incident={null} />
          <p>
            {connected && live.session
              ? "No active incident. Monitoring is healthy."
              : "No active incident in this staged scenario."}
          </p>
          <p className="small muted">
            {connected && live.session
              ? `Last ${room.dataSource === "synthetic" ? "synthetic sample" : "telemetry"}: ${room.lastDataAt ? new Date(room.lastDataAt).toLocaleTimeString() : "not received"}`
              : "Last staged data: 2:32 PM"}
          </p>
        </div>
      ) : null}
      {connected && live.session && (
        <button
          className="text-button"
          disabled={live.busy || live.stale}
          title="Archive this room’s existing events and incidents; restore synthetic monitoring where applicable"
          onClick={() => void live.resetAlerts()}
        >
          {live.busy ? "Resetting…" : "Reset room alerts"}
        </button>
      )}
      <details className="contact-section" key={room.id}>
        <summary>
          Family notification
          <span className="small muted">
            {room.contact?.name ?? "No contact saved"}
          </span>
        </summary>
        <div className="contact-content">
          <div className="section-heading">
            <h3>Family contact</h3>
            <button
              className="compact"
              disabled={connected}
              title={
                connected
                  ? "Test contact routing is configured on the backend"
                  : undefined
              }
              onClick={() => setModal("contact")}
            >
              {room.contact ? "Edit" : "Add"}
              <span className="sr-only">
                {" "}
                family contact for {room.resident}
              </span>
            </button>
          </div>
          {room.contact ? (
            <>
              <dl className="facts">
                <div>
                  <dt>Name</dt>
                  <dd>{room.contact.name}</dd>
                </div>
                <div>
                  <dt>Contact information</dt>
                  <dd>
                    {connected
                      ? "Registered test phone (fictional contact)"
                      : `Phone ending ${room.contact.phone.slice(-4)}`}
                  </dd>
                </div>
              </dl>
              <p
                className={`status ${room.contact.consent ? "monitoring" : "offline"}`}
              >
                <Icon name={room.contact.consent ? "check" : "close"} />
                {room.contact.consent
                  ? "Agreed to receive calls"
                  : "Consent not granted"}
              </p>
            </>
          ) : (
            <p className="muted">No family contact saved.</p>
          )}
          <button
            className="full"
            disabled={!canReviewCall(room, incident)}
            onClick={() =>
              setModal(connected && !live.session ? "login" : "call")
            }
          >
            {connected ? "Notify family" : "Review notification"}{" "}
            <Icon name="arrow" size={16} />
          </button>
          <p className="small muted">
            {!incident
              ? "A recorded incident is needed to review a notification."
              : !room.contact?.consent
                ? "Save a contact with consent before reviewing a notification."
                : "Review the recipient, context and opening before authorizing. Nothing sends automatically."}
          </p>
        </div>
      </details>
      {incident && (
        <details className="incident-details">
          <summary>Timeline, notes & event details</summary>
          <ol className="timeline">
            {incident.timeline.map((entry, i) => (
              <li key={i}>{entry}</li>
            ))}
          </ol>
          {incident.record && (
            <p className="small muted">
              Event {incident.record.event_id} · Source device{" "}
              {incident.record.device_id}
            </p>
          )}
          <p className="small muted">
            {incident.record
              ? `Recorded scores: fall ${incident.record.confidence_scores.fall} · non-fall ${incident.record.confidence_scores.non_fall}.`
              : "Sample model scores: fall 0.91 · non-fall 0.09."}{" "}
            Experimental scores, not clinical probabilities.
          </p>
          {incident.notes.map((text, i) => (
            <p className="note" key={i}>
              {text}
            </p>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (note.trim()) {
                void dispatch({ type: "note", text: note }).then((ok) => {
                  if (ok) {
                    setNote("");
                    if (!connected) setAnnouncement("Demo note added.");
                  }
                });
              }
            }}
          >
            <label htmlFor="incident-note">Add a demo note</label>
            <textarea
              id="incident-note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Use fictional details only"
            />
            <button
              disabled={
                !note.trim() || (connected && (live.busy || live.stale))
              }
            >
              Add note
            </button>
          </form>
        </details>
      )}
    </section>
  );
  return (
    <div
      className={`dashboard compact-workspace ${refined ? "conservatory" : ""} ${moonlit ? "moonlit" : ""}`}
    >
      <a className="skip-link" href="#dashboard-main">
        Skip to dashboard
      </a>
      <aside className="sidebar">
        <div className="mobile-brand">
          <a
            href={connected ? "/" : "?demo=1"}
            aria-label="Blissey Beacon demo home"
            className={moonlit ? "moonlit-brand" : undefined}
          >
            {moonlit ? (
              <>
                <span className="moonlit-mark">
                  <img
                    className="logo"
                    src={moonlitLogo}
                    alt=""
                    width="184"
                    height="184"
                  />
                </span>
                <span className="moonlit-wordmark">
                  <span className="brand-blissey">blissey</span>
                  <span className="brand-beacon">beacon</span>
                </span>
              </>
            ) : (
              <img
                className="logo"
                src={logo}
                alt="Blissey Beacon"
                width="184"
                height={92}
              />
            )}
          </a>
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            aria-controls="dashboard-nav"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name="menu" />
          </button>
        </div>
        <nav
          id="dashboard-nav"
          className={menuOpen ? "open" : ""}
          aria-label="Dashboard"
        >
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => {
                setView(item.id);
                setMenuOpen(false);
              }}
            >
              <Icon name={item.id} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {moonlit && (
            <div className="moon-hills" aria-hidden="true">
              <MoonlitHills />
            </div>
          )}
          <a href={live.session ? "/?demo=1" : "/?operator=1"}>
            {live.session ? "Browser-only demo" : "Operator sign-in"}{" "}
            <Icon name="arrow" size={16} />
          </a>
        </div>
      </aside>
      <main id="dashboard-main" className="dashboard-main">
        {moonlit && (
          <div className="moon-background" aria-hidden="true">
            <MoonlitBackground />
          </div>
        )}
        <header className="workspace-header">
          <div className="page-heading">
            <div className="workspace-title">
              <h1>
                {view === "overview"
                  ? "Overview"
                  : view === "history"
                    ? "Incident history"
                    : navigation.find((n) => n.id === view)!.label}
              </h1>
              <p className="facility-label">
                James West Alumni Center at UCLA <span>/ Ground floor</span>
              </p>
            </div>
            <p className="demo-toolbar">
              <span>
                <strong>
                  {connected ? "Operator workspace" : "Interactive demo"}
                </strong>{" "}
                ·{" "}
                {connected
                  ? "Fictional residents. Calls and texts require explicit approval."
                  : "Fictional data. No live sensing or calls."}
              </span>
            </p>
          </div>
          {refined && (
            <img
              className="header-ornament"
              src={branch}
              alt=""
              aria-hidden="true"
              width="160"
              height="120"
            />
          )}
        </header>
        {connected && (
          <div className="operator-connection">
            <span>
              {live.session
                ? live.stale
                  ? "Refreshing backend state…"
                  : "Backend connected · Pi telemetry shown when received"
                : "Sign in, then instantiate a persisted scenario to use real calls and messages."}
            </span>
            <button
              className="text-button"
              onClick={() =>
                live.session ? void supabase?.auth.signOut() : setModal("login")
              }
            >
              {live.session ? "Sign out" : "Operator sign-in"}
            </button>
          </div>
        )}
        {connected && live.error && (
          <p className="error" role="alert">
            {live.error}. Refresh and review the current incident before
            retrying.
          </p>
        )}
        {connected && live.marker && (
          <p className="notice">
            {live.marker === "offline"
              ? "Outage rehearsal recorded; hardware health has not been changed."
              : "No-event rehearsal recorded; existing incident history is preserved."}
          </p>
        )}
        <div className="status-strip" aria-label="Facility status">
          <span className={`status-metric ${active ? "attention" : ""}`}>
            <Icon name={active ? "alert" : "check"} size={16} />
            <strong>
              {active} active {active === 1 ? "incident" : "incidents"}
            </strong>
          </span>
          <button
            className={`status-metric device-warning ${offline.length ? "has-fault" : ""}`}
            onClick={() => {
              setView("devices");
              setMenuOpen(false);
            }}
          >
            <Icon name={offline.length ? "offline" : "wifi"} size={16} />
            <span>
              <strong>
                {offline.length}{" "}
                {state.rooms.some((r) => r.monitoringStatus === "degraded")
                  ? "unavailable"
                  : "offline"}{" "}
                {offline.length === 1 ? "device" : "devices"}
              </strong>
              {offline.length === 1 ? ` · Room ${offline[0]!.id}` : ""}
            </span>
            <Icon name="arrow" size={14} />
          </button>
          <span className="status-metric">
            <Icon name="overview" size={16} />
            <strong>{state.rooms.length} rooms</strong>
          </span>
          <span className="last-update">
            {connected && live.session
              ? "Real Pi + labeled synthetic feeds"
              : "Last staged data · 2:32 PM"}
          </span>
        </div>
        {pendingRooms.length > 0 && (
          <div className="fall-alert-banner" role="status" aria-live="polite">
            <span className="fall-alert-beacon" aria-hidden="true">
              <Icon name="alert" size={22} />
            </span>
            <div>
              <strong>Possible fall detected</strong>
              <span>
                Room {pendingRooms.join(", ")} · Awaiting acknowledgment
              </span>
            </div>
            <button
              onClick={() => {
                selectRoom(pendingRooms[0]!);
                setView("overview");
              }}
            >
              Review alert <Icon name="arrow" size={16} />
            </button>
          </div>
        )}
        {(view === "overview" || view === "residents") && (
          <div className="overview-grid">
            <div className="facility-column">
              {view === "overview" && (
                <FacilityMap
                  rooms={state.rooms}
                  incident={state.incident}
                  incidents={
                    connected && live.session ? live.incidents : undefined
                  }
                  selected={selected}
                  onSelect={selectRoom}
                />
              )}
              {view === "residents" && (
                <section
                  className="room-list panel"
                  aria-labelledby="rooms-title"
                >
                  <div className="section-heading">
                    <h2 id="rooms-title">Room directory</h2>
                    <span className="small muted">Priority first</span>
                  </div>
                  <div className="room-table-scroll">
                    <table className="room-table">
                      <caption className="sr-only">
                        Fictional rooms, residents, monitoring status and last
                        staged data. Select a room to view details.
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Room</th>
                          <th scope="col">Resident</th>
                          <th scope="col">Status</th>
                          <th scope="col" className="last-seen">
                            Last data
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map((r) => (
                          <tr
                            key={r.id}
                            data-selected={r.id === selected || undefined}
                          >
                            <th scope="row">
                              <button
                                className="room-select"
                                aria-pressed={r.id === selected}
                                aria-label={`Select room ${r.id}, ${r.resident}`}
                                onClick={() => selectRoom(r.id)}
                              >
                                {r.id}
                              </button>
                            </th>
                            <td>
                              {r.resident}
                              <span className="mobile-last-seen">
                                {connected && live.session
                                  ? r.lastDataAt
                                    ? new Date(
                                        r.lastDataAt,
                                      ).toLocaleTimeString()
                                    : "Not received"
                                  : r.online
                                    ? "2:32 PM"
                                    : "2:25 PM"}
                              </span>
                            </td>
                            <td>
                              <Status
                                room={r}
                                incident={
                                  connected && live.session
                                    ? (live.incidents.find(
                                        (i) =>
                                          i.roomId === r.id &&
                                          i.status !== "resolved",
                                      ) ?? null)
                                    : state.incident
                                }
                              />
                            </td>
                            <td className="last-seen">
                              {connected && live.session
                                ? r.lastDataAt
                                  ? new Date(r.lastDataAt).toLocaleTimeString()
                                  : "Not received"
                                : r.online
                                  ? "2:32 PM"
                                  : "2:25 PM"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
            {moonlit ? (
              <div className="dashboard-right-column">{detail}</div>
            ) : (
              detail
            )}
          </div>
        )}
        {view === "history" && (
          <section className="panel">
            <h2>Recent incidents</h2>
            <p className="muted">
              {connected && live.session
                ? "Persisted incidents, including synthetic scenarios and device events."
                : "Staged events and actions from this demo session."}
            </p>
            {connected && live.session ? (
              <div>
                {live.records.map((i) => (
                  <button
                    className="history-row"
                    key={i.id}
                    onClick={() => {
                      setSelected(i.room_id);
                      live.focus(i.id);
                      setView("overview");
                    }}
                  >
                    <span>
                      <strong>
                        Room {i.room_id} · {i.status}
                      </strong>
                      <br />
                      {new Date(i.detected_at).toLocaleString()} ·{" "}
                      {i.event_id.startsWith("synthetic_")
                        ? "Synthetic scenario"
                        : "Device event"}
                    </span>
                    <Icon name="arrow" />
                  </button>
                ))}
              </div>
            ) : state.incident ? (
              <>
                <button
                  className="history-row"
                  onClick={() => {
                    setView("overview");
                    setSelected("104");
                  }}
                >
                  <span>
                    <strong>Possible fall · Room 104</strong>
                    <br />
                    Margaret Lee · October 17, 2026 · 2:32 PM
                  </span>
                  <span>
                    {state.incident.falseAlarm
                      ? "False alarm"
                      : state.incident.status}{" "}
                    <Icon name="arrow" size={16} />
                  </span>
                </button>
                <ol className="timeline">
                  {state.incident.timeline.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ol>
              </>
            ) : (
              <div className="empty-state">
                <Icon name="check" size={32} />
                <h3>No incidents in this scenario</h3>
                <p>Choose “Possible fall · Pending” to explore an incident.</p>
              </div>
            )}
          </section>
        )}
        {view === "devices" && (
          <div className="devices-grid">
            <section className="panel">
              <h2>Device connections</h2>
              <p className="muted">
                {connected && live.session
                  ? "Room 101 uses real Pi telemetry. Other rooms use explicitly synthetic monitoring unless hardware is registered."
                  : "Illustrative device health, not a connection to your Raspberry Pi."}
              </p>
              <div className="device-list">
                {state.rooms.map((r) => (
                  <div key={r.id} className="device-row">
                    <Icon name="devices" />
                    <div>
                      <strong>
                        {r.device}
                        {r.dataSource === "synthetic"
                          ? " · Synthetic feed"
                          : ""}
                      </strong>
                      <p className="small muted">
                        Room {r.id} ·{" "}
                        {connected && live.session
                          ? r.dataSource === "synthetic"
                            ? "Last synthetic sample"
                            : "Last telemetry"
                          : "Last staged data"}{" "}
                        {connected && live.session
                          ? r.lastDataAt
                            ? new Date(r.lastDataAt).toLocaleTimeString()
                            : "Not received"
                          : r.online
                            ? "2:32 PM"
                            : "2:25 PM"}
                      </p>
                    </div>
                    <span
                      className={`status ${r.online ? "monitoring" : "offline"}`}
                    >
                      <Icon name={r.online ? "check" : "offline"} size={16} />
                      {r.online ? "Connected" : "Offline"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
            {moonlit && !connected && <SensorHistory rooms={state.rooms} />}
          </div>
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
        <details className="scenario-tools">
          <summary>Scenario controls</summary>
          <p className="small muted">
            Synthetic rehearsal · selected room {selected}
          </p>
          <div className="workspace-tools">
            <label className="scenario-label" htmlFor="demo-scenario">
              Scenario
              <select
                id="demo-scenario"
                aria-label="Scenario"
                value={scenario}
                onChange={(e) =>
                  connected
                    ? setScenario(e.target.value as Scenario)
                    : reset(e.target.value as Scenario)
                }
              >
                <option value="attention">
                  {connected ? "Possible fall" : "Possible fall · Pending"}
                </option>
                {!connected && (
                  <option value="ready">Sample explanation</option>
                )}
                <option value="fallback">
                  {connected
                    ? "Deterministic fallback"
                    : "Explanation unavailable"}
                </option>
                <option value="offline">
                  {connected
                    ? "Monitoring outage rehearsal"
                    : "All devices offline"}
                </option>
                <option value="empty">
                  {connected ? "No new incident" : "No incidents"}
                </option>
              </select>
            </label>
            <button
              className="compact"
              onClick={() => {
                if (!connected) reset(scenario);
                else if (!live.session) setModal("login");
                else void live.instantiate(scenario).catch(() => {});
              }}
              disabled={
                connected &&
                (live.busy ||
                  (!!live.session &&
                    (!live.scenariosEnabled ||
                      live.stale ||
                      !["101", "102", "103", "104", "105", "106"].includes(
                        selected,
                      ))))
              }
              aria-label={connected ? "Instantiate scenario" : "Reset demo"}
            >
              {connected
                ? live.busy
                  ? "Working…"
                  : scenario === "offline" || scenario === "empty"
                    ? "Apply scenario"
                    : "Trigger possible fall"
                : "Reset"}
            </button>
          </div>
        </details>
        <footer>
          Experimental possible-fall monitoring · Fictional data · Not a medical
          or emergency response device.
        </footer>
      </main>
      {modal === "login" && !live.session && (
        <OperatorLogin onClose={() => setModal(null)} />
      )}
      {modal === "contact" && (
        <ContactForm
          room={room}
          onClose={() => setModal(null)}
          onSave={(contact) => {
            dispatch({ type: "contact", roomId: room.id, contact });
            setModal(null);
            setAnnouncement("Demo family contact saved.");
          }}
        />
      )}{" "}
      {modal === "call" && connected && live.api && live.record && (
        <LiveCallReview
          key={live.record.id}
          api={live.api}
          incidentId={live.record.id}
          onClose={() => setModal(null)}
          onUpdated={() => void live.refresh()}
        />
      )}
      {modal === "call" &&
        !connected &&
        incident &&
        canReviewCall(room, incident) && (
          <CallReview
            room={room}
            incident={incident}
            onClose={() => setModal(null)}
          />
        )}
    </div>
  );
}
