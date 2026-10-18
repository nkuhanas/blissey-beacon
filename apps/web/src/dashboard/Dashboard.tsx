import { useEffect, useReducer, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import logo from "../../../../design/brand/blissey-beacon-logo-v1.png";
import { Icon } from "./Icon";
import { FacilityMap } from "./FacilityMap";
import { SummaryCards } from "./SummaryCards";
import { SensorHistory } from "./SensorHistory";
import { MoonlitBackground, MoonlitHills } from "./MoonlitDecor";
import moonlitLogo from "../../../../design/brand/blissey-beacon-moonlit-mark.png";
import branch from "../../../../design/ornaments/conservatory-branch.svg";
import { canReviewCall, createDemo, demoReducer, roomStatus } from "./model";
import type { Contact, DemoIncident, DemoRoom, Scenario } from "./model";
import "./dashboard.css";
import "./refinement.css";
import "./moonlit.css";
import "./overview.css";

type View = "overview" | "residents" | "history" | "devices";
const navigation: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "residents", label: "Residents" },
  { id: "history", label: "Incident history" },
  { id: "devices", label: "Devices" },
];
function Status({
  room,
  incident,
}: {
  room: DemoRoom;
  incident: DemoIncident | null;
}) {
  const tone = !room.online
    ? "offline"
    : incident?.roomId === room.id && incident.status !== "resolved"
      ? "attention"
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
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="dialog-title"
      onCancel={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
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
            “Hello, this is a demo update from Willow House about{" "}
            {room.resident}. A possible fall was detected. Their current
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
  const [state, dispatch] = useReducer(demoReducer, undefined, () =>
    createDemo(),
  );
  const [selected, setSelected] = useState("104");
  const [view, setView] = useState<View>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<"contact" | "call" | null>(null);
  const [note, setNote] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [scenario, setScenario] = useState<Scenario>("attention");
  const detailRef = useRef<HTMLElement>(null);
  const room = state.rooms.find((r) => r.id === selected)!;
  const incident = state.incident?.roomId === selected ? state.incident : null;
  const active = state.incident && state.incident.status !== "resolved" ? 1 : 0;
  const online = state.rooms.filter((r) => r.online).length;
  const sorted = [...state.rooms].sort((a, b) => {
    const rank = (r: DemoRoom) =>
      state.incident?.roomId === r.id && active ? 0 : !r.online ? 1 : 2;
    return rank(a) - rank(b) || a.id.localeCompare(b.id);
  });
  function selectRoom(id: string) {
    setSelected(id);
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
  const detail = (
    <section
      className="resident-panel panel"
      data-attention={
        incident && incident.status !== "resolved" ? true : undefined
      }
      ref={detailRef}
      tabIndex={-1}
      aria-labelledby="resident-title"
    >
      <div className="section-heading">
        <p className="eyebrow">
          {incident && incident.status !== "resolved"
            ? "Needs attention"
            : "Resident detail"}
        </p>
        {incident && <span className="small muted">{incident.status}</span>}
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
          </p>
        </div>
      </div>
      {!room.online && (
        <div className="notice">
          <strong>Monitoring interrupted</strong>
          <p>
            No current sensing data. Check the device connection. Last staged
            data: 2:25 PM.
          </p>
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
                ? "This staged incident remains in the demo history."
                : `Check on the resident in Room ${room.id}.`}
            </p>
            <p className="small muted">
              Trigger time 2:32 PM · October 17, 2026
              <br />
              Explanation {incident.explanation} · Staged event
            </p>
          </div>
          {incident.explanation !== "pending" && (
            <div className="explanation">
              <h3>
                {incident.explanation === "fallback"
                  ? "Explanation unavailable"
                  : "Sample explanation"}
              </h3>
              <p>
                {incident.explanation === "fallback"
                  ? "The explanation could not be generated. The incident is still available for review."
                  : "The staged sensor event indicates a possible fall. Check on the resident; this sample does not confirm a fall or injury."}
              </p>
            </div>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={incident.status !== "pending"}
              onClick={() => {
                dispatch({ type: "advance", status: "acknowledged" });
                setAnnouncement("Demo incident acknowledged.");
              }}
            >
              Acknowledge
            </button>
            <button
              disabled={incident.status !== "acknowledged"}
              onClick={() => {
                dispatch({ type: "advance", status: "responding" });
                setAnnouncement("Demo incident marked responding.");
              }}
            >
              Mark responding
            </button>
          </div>
          {incident.status === "pending" && (
            <p className="small muted">
              Acknowledge before marking responding.
            </p>
          )}
          {incident.status === "responding" && (
            <button
              className="full"
              onClick={() => {
                dispatch({ type: "advance", status: "resolved" });
                setAnnouncement("Demo incident resolved.");
              }}
            >
              Resolve incident
            </button>
          )}
          {incident.status !== "resolved" && (
            <button
              className="text-button"
              onClick={() => {
                dispatch({ type: "false-alarm" });
                setAnnouncement("Demo incident resolved as a false alarm.");
              }}
            >
              Mark as false alarm
            </button>
          )}
        </>
      ) : (
        <div className="quiet">
          <Status room={room} incident={null} />
          <p>
            {room.online
              ? "No active incident in this staged scenario."
              : "Room status cannot be confirmed while the sensor is offline."}
          </p>
          <p className="small muted">
            Last staged data: {room.online ? "2:32 PM" : "2:25 PM"}
          </p>
        </div>
      )}
      <details
        className="contact-section"
        key={`${view}-${room.id}`}
        open={view === "overview" ? undefined : true}
      >
        <summary>
          Family contact
          <span className="small muted">
            {room.contact?.name ?? "No contact saved"}
          </span>
        </summary>
        <div className="contact-content">
          <div className="section-heading">
            <h3>Family contact</h3>
            <button className="compact" onClick={() => setModal("contact")}>
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
                  <dd>Phone ending {room.contact.phone.slice(-4)}</dd>
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
            onClick={() => setModal("call")}
          >
            Review notification <Icon name="arrow" size={16} />
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
          <p className="small muted">
            Sample model scores: fall 0.91 · non-fall 0.09. Experimental scores,
            not clinical probabilities.
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
                dispatch({ type: "note", text: note });
                setNote("");
                setAnnouncement("Demo note added.");
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
            <button disabled={!note.trim()}>Add note</button>
          </form>
        </details>
      )}
    </section>
  );
  return (
    <div
      className={`dashboard ${refined ? "conservatory" : ""} ${moonlit ? "moonlit" : ""} ${view === "overview" ? "overview-workspace" : ""}`}
    >
      <a className="skip-link" href="#dashboard-main">
        Skip to dashboard
      </a>
      <aside className="sidebar">
        <div className="mobile-brand">
          <a
            href="?demo=1"
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
          <p>
            <Icon name="shield" size={16} />
            Camera-free by design
          </p>
          <p>
            Experimental demo
            <br />
            Fictional residents & events
          </p>
          <a href="/?operator=1">
            Operator sign-in <Icon name="arrow" size={16} />
          </a>
        </div>
      </aside>
      <main id="dashboard-main" className="dashboard-main">
        {moonlit && (
          <div className="moon-background" aria-hidden="true">
            <MoonlitBackground />
          </div>
        )}
        <div className="demo-toolbar">
          <span>
            <strong>Interactive demo</strong> · Fictional data. No calls or live
            sensing.
          </span>
          <button className="compact" onClick={() => reset(scenario)}>
            Reset demo
          </button>
        </div>
        {view !== "overview" && (
          <header className="topbar">
            <div className={online < 6 ? "notice" : "quiet"}>
              <strong>
                {online < 6 ? "Monitoring interrupted" : "Monitoring"}
              </strong>
              <span>
                {online} of 6 staged devices connected
                {online === 5 ? " · Room 106 offline" : ""}
              </span>
            </div>
            <span className="workspace-label">Demo workspace</span>
          </header>
        )}
        <div className="page-heading">
          {refined && (
            <>
              <p className="workspace-eyebrow">
                CARE WORKSPACE /{" "}
                {String(
                  navigation.findIndex((n) => n.id === view) + 1,
                ).padStart(2, "0")}
              </p>
              <img
                className="header-ornament"
                src={branch}
                alt=""
                aria-hidden="true"
                width="210"
                height="158"
              />
            </>
          )}
          <div>
            <h1>
              {navigation.find((n) => n.id === view)!.label === "Overview"
                ? "Facility overview"
                : navigation.find((n) => n.id === view)!.label}
            </h1>
            <p className="muted">
              Willow House · Ground floor · Fictional demo data
            </p>
          </div>
          <label className="scenario-label">
            Demo scenario
            <select
              value={scenario}
              onChange={(e) => reset(e.target.value as Scenario)}
            >
              <option value="attention">Possible fall · Pending</option>
              <option value="ready">Sample explanation</option>
              <option value="fallback">Explanation unavailable</option>
              <option value="offline">All devices offline</option>
              <option value="empty">No incidents</option>
            </select>
          </label>
        </div>
        <SummaryCards
          total={state.rooms.length}
          active={active}
          online={online}
          refined={refined}
        />
        {view === "overview" && (
          <div className="overview-health" role="status">
            <span>
              <Icon
                name={online < state.rooms.length ? "offline" : "check"}
                size={16}
              />
              <strong>
                {online < state.rooms.length
                  ? "Monitoring interrupted"
                  : "Monitoring connected"}
              </strong>
              <span>
                {online === 5
                  ? "Room 106 offline"
                  : `${online} of ${state.rooms.length} staged devices connected`}
              </span>
            </span>
            <span className="small muted">Last staged data · 2:32 PM</span>
          </div>
        )}
        {(view === "overview" || view === "residents") && (
          <div className="overview-grid">
            <div className="facility-column">
              {view === "overview" && (
                <FacilityMap
                  rooms={state.rooms}
                  incident={state.incident}
                  selected={selected}
                  onSelect={selectRoom}
                />
              )}
              <section
                className="room-list panel"
                aria-labelledby="rooms-title"
              >
                <div className="section-heading">
                  <h2 id="rooms-title">All rooms · 6</h2>
                  <span className="small muted">Priority first</span>
                </div>
                {sorted.map((r) => (
                  <button
                    key={r.id}
                    className={`room-row ${r.id === selected ? "selected" : ""}`}
                    aria-pressed={r.id === selected}
                    onClick={() => selectRoom(r.id)}
                  >
                    <span className="room-number">{r.id}</span>
                    <span className="room-person">
                      <strong>{r.resident}</strong>
                      <Status room={r} incident={state.incident} />
                      {view === "overview" && (
                        <span className="room-telemetry">
                          {r.device} · Last data{" "}
                          {r.online ? "2:32 PM" : "2:25 PM"}
                        </span>
                      )}
                    </span>
                    <Icon name="arrow" size={18} />
                  </button>
                ))}
              </section>
            </div>
            {moonlit ? (
              <div className="dashboard-right-column">
                {detail}
                {view === "overview" && <SensorHistory rooms={state.rooms} />}
              </div>
            ) : (
              detail
            )}
          </div>
        )}
        {view === "history" && (
          <section className="panel">
            <h2>Recent incidents</h2>
            <p className="muted">
              Staged events and actions from this demo session.
            </p>
            {state.incident ? (
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
          <section className="panel">
            <h2>Device connections</h2>
            <p className="muted">
              Illustrative device health, not a connection to your Raspberry Pi.
            </p>
            <div className="device-list">
              {state.rooms.map((r) => (
                <div key={r.id} className="device-row">
                  <Icon name="devices" />
                  <div>
                    <strong>{r.device}</strong>
                    <p className="small muted">
                      Room {r.id} · Last staged data{" "}
                      {r.online ? "2:32 PM" : "2:25 PM"}
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
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
        <footer>
          Experimental possible-fall monitoring · Fictional data · Not a medical
          or emergency response device.
        </footer>
      </main>
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
      {modal === "call" && incident && canReviewCall(room, incident) && (
        <CallReview
          room={room}
          incident={incident}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
