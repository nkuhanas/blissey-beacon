import type { DemoRoom } from "./model";

// Explicit fictional history for the design demo. This is never device telemetry.
const sampleHours = Array.from(
  { length: 12 },
  (_, i) => `${String(i + 3).padStart(2, "0")}:00`,
);
export function SensorHistory({ rooms }: { rooms: DemoRoom[] }) {
  const online = rooms.filter((room) => room.online).length;
  const offline = rooms.filter((room) => !room.online);
  return (
    <section className="sensor-history" aria-labelledby="sensor-history-title">
      <svg
        className="sensing-arcs"
        width="410"
        height="300"
        viewBox="0 0 410 300"
        fill="none"
        aria-hidden="true"
      >
        {[90, 140, 190, 240].map((r, i) => (
          <circle
            key={r}
            cx="410"
            cy="0"
            r={r}
            stroke="#F3C9D8"
            opacity={[0.22, 0.16, 0.11, 0.07][i]}
          />
        ))}
      </svg>
      <p className="history-eyebrow">Sample device check-ins · 12 hours</p>
      <div>
        <h2 id="sensor-history-title">
          {online} of {rooms.length} devices connected
        </h2>
        <p className="history-context">
          {offline.length === 1
            ? `Room ${offline[0]!.id} is offline.`
            : offline.length
              ? `${offline.length} devices are offline.`
              : "All demo devices are connected."}{" "}
          {offline.length
            ? "Monitoring is unavailable in affected rooms; resident condition is unconfirmed."
            : "Connectivity does not confirm resident condition."}
        </p>
      </div>
      <div
        className="sample-history-scroll"
        role="region"
        aria-label="Sample hourly device check-in table"
        tabIndex={0}
      >
        <table>
          <caption className="sr-only">
            Fictional hourly reports on October 17, 2026, from 03:00 through
            14:00. This fixed illustration is separate from current demo
            connection status and does not describe resident activity.
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Room</span>
              </th>
              {sampleHours.map((hour, i) => (
                <th scope="col" key={hour}>
                  <span
                    className={
                      i === 0 || i === 6 || i === 11 ? "hour-label" : "sr-only"
                    }
                  >
                    {hour}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <tr key={room.id}>
                <th scope="row">
                  <span className="sr-only">Room </span>
                  {room.id}
                </th>
                {sampleHours.map((hour, i) => {
                  const reported = room.id !== "106" || i < 8;
                  return (
                    <td
                      key={hour}
                      title={`Room ${room.id}, ${hour}: ${reported ? "reported" : "no report"}`}
                    >
                      <span
                        className={`report-dot ${reported ? "reported" : "missing"}`}
                        aria-hidden="true"
                      />
                      <span className="sr-only">
                        {reported ? "Reported" : "No report"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="history-legend">
        <span>
          <i className="report-dot reported" aria-hidden="true" />
          Device reported
        </span>
        <span>
          <i className="report-dot missing" aria-hidden="true" />
          No report
        </span>
      </div>
      <p className="history-caveat">
        Illustrative hourly reports only. Connectivity does not confirm resident
        condition.
      </p>
    </section>
  );
}
