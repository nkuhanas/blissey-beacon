import { Icon } from "./Icon";

export function SummaryCards({
  total,
  active,
  online,
  refined,
}: {
  total: number;
  active: number;
  online: number;
  refined: boolean;
}) {
  if (!refined)
    return (
      <div className="summary-grid" aria-label="Facility summary">
        <div>
          <strong>{total}</strong>
          <span>Total rooms</span>
        </div>
        <div className="summary-alert">
          <strong>{active}</strong>
          <span>Active {active === 1 ? "incident" : "incidents"}</span>
        </div>
        <div>
          <strong>
            {online} / {total}
          </strong>
          <span>Devices connected</span>
        </div>
      </div>
    );
  const circumference = 2 * Math.PI * 19;
  const connectedFraction = total
    ? Math.max(0, Math.min(online / total, 1))
    : 0;
  const offline = Math.max(0, total - online);
  return (
    <div className="summary-grid refined-summary" aria-label="Facility summary">
      <div>
        <strong>{total}</strong>
        <span>Total rooms</span>
        <p className="summary-caption">Fictional resident rooms</p>
        <span className="summary-emblem" aria-hidden="true">
          <Icon name="overview" size={22} />
        </span>
      </div>
      <div className={active ? "summary-alert" : "summary-neutral"}>
        <strong>{active}</strong>
        <span>Active {active === 1 ? "incident" : "incidents"}</span>
        <p className="summary-caption">
          {active ? "Review the staged incident" : "No staged incidents"}
        </p>
        <span className="summary-emblem" aria-hidden="true">
          <Icon name={active ? "alert" : "history"} size={22} />
        </span>
      </div>
      <div>
        <strong>
          {online} / {total}
        </strong>
        <span>Devices connected</span>
        <p className="summary-caption">
          {offline
            ? `${offline} ${offline === 1 ? "device" : "devices"} offline`
            : "All staged devices online"}
        </p>
        <svg
          className="connectivity-ring"
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="24" cy="24" r="19" stroke="#DDE6D9" strokeWidth="4" />
          <circle
            cx="24"
            cy="24"
            r="19"
            stroke={online ? "#426653" : "#665F68"}
            strokeWidth="4"
            strokeDasharray={`${connectedFraction * circumference} ${circumference}`}
            strokeLinecap={online ? "round" : "butt"}
            transform="rotate(-90 24 24)"
          />
          <path
            d="M16 22a13 13 0 0 1 16 0 M19 26a8 8 0 0 1 10 0 M22 30a3 3 0 0 1 4 0"
            stroke={online ? "#426653" : "#665F68"}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          {!online && (
            <path
              d="m16 16 16 16"
              stroke="#665F68"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          )}
        </svg>
      </div>
    </div>
  );
}
