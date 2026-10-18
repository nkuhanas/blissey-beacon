import { useState } from "react";
import type { CSSProperties } from "react";
import architecture from "../../../../design/facility/willow-house.svg";
import type { DemoIncident, DemoRoom } from "./model";
import { roomStatus } from "./model";
import { Icon } from "./Icon";
import "./facility-map.css";

// Coordinates match the 1000 × 800 Paper illustration, in drawing units.
const roomGeometry = [
  { id: "101", x: 108, y: 78 },
  { id: "102", x: 323, y: 78 },
  { id: "103", x: 538, y: 78 },
  { id: "104", x: 108, y: 438 },
  { id: "105", x: 323, y: 438 },
  { id: "106", x: 538, y: 438 },
];
export function FacilityMap({
  rooms,
  incident,
  selected,
  onSelect,
}: {
  rooms: DemoRoom[];
  incident: DemoIncident | null;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [zoom, setZoom] = useState(0);
  return (
    <section className="map-section" aria-labelledby="map-title">
      <div className="section-heading">
        <div>
          <h2 id="map-title">Facility map</h2>
          <p className="small muted">Ground floor · Staged room status</p>
        </div>
        <div className="map-zoom" role="group" aria-label="Map zoom">
          <button
            className="icon-button compact"
            aria-label="Zoom out of facility map"
            disabled={zoom === 0}
            onClick={() => setZoom((z) => z - 1)}
          >
            −
          </button>
          <span className="small" aria-live="polite">
            {100 + zoom * 25}%
          </span>
          <button
            className="icon-button compact"
            aria-label="Zoom into facility map"
            disabled={zoom === 2}
            onClick={() => setZoom((z) => z + 1)}
          >
            +
          </button>
        </div>
      </div>
      <ul className="map-legend" aria-label="Room status legend">
        <li className="monitoring">
          <Icon name="check" size={16} />
          Monitoring
        </li>
        <li className="attention">
          <Icon name="alert" size={16} />
          Possible fall
        </li>
        <li className="responding">
          <Icon name="history" size={16} />
          Acknowledged / responding
        </li>
        <li className="offline">
          <Icon name="offline" size={16} />
          Offline
        </li>
      </ul>
      <div
        className="floorplan-viewport"
        tabIndex={0}
        role="region"
        aria-label="Scrollable facility floor plan"
        aria-describedby="map-description"
      >
        <div
          className="floorplan-artwork"
          style={{ width: `${100 + zoom * 25}%` }}
        >
          <img
            className="floorplan-building"
            src={architecture}
            alt=""
            width="1000"
            height="800"
            draggable={false}
          />
          {roomGeometry.map(({ id, x, y }) => {
            const room = rooms.find((r) => r.id === id);
            if (!room) return null;
            const active =
              incident?.roomId === id && incident.status !== "resolved";
            const tone = !room.online
              ? "offline"
              : active
                ? incident.status === "pending"
                  ? "attention"
                  : "responding"
                : "monitoring";
            const label =
              tone === "offline"
                ? "Sensor offline"
                : tone === "attention"
                  ? "Possible fall"
                  : tone === "responding"
                    ? incident!.status === "acknowledged"
                      ? "Acknowledged"
                      : "Responding"
                    : "Monitoring";
            const style: CSSProperties = {
              left: `${x / 10}%`,
              top: `${y / 8}%`,
              width: "19.9%",
              height: "26.125%",
            };
            return (
              <button
                key={id}
                className={`room-hotspot ${tone} ${y > 400 ? "south-room" : "north-room"}`}
                style={style}
                aria-label={`Room ${id}, ${room.resident}, ${roomStatus(room, incident)}`}
                aria-pressed={selected === id}
                title={`${room.resident} · ${roomStatus(room, incident)}`}
                onClick={() => onSelect(id)}
              >
                <span className="room-pin">
                  <Icon
                    name={
                      tone === "offline"
                        ? "offline"
                        : tone === "attention"
                          ? "alert"
                          : tone === "responding"
                            ? "history"
                            : "check"
                    }
                    size={16}
                  />
                </span>
                <strong className="map-room-label">Room {id}</strong>
                <span className="map-room-status">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p id="map-description" className="map-caption small muted">
        Illustrative floor plan · Select a room for details. Scroll to explore,
        or use the room list below.
      </p>
    </section>
  );
}
