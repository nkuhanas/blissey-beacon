import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import architecture from "../../../../design/facility/willow-house.svg";
import type { DemoIncident, DemoRoom } from "./model";
import { roomStatus } from "./model";
import { Icon } from "./Icon";
import "./facility-map.css";

const PAN_GUTTER = 240;

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
  incidents,
  selected,
  onSelect,
}: {
  rooms: DemoRoom[];
  incident: DemoIncident | null;
  incidents?: DemoIncident[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [zoom, setZoom] = useState(0);
  const [panning, setPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const artworkRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
    dragging: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const zoomAnchor = useRef<{ x: number; y: number } | null>(null);

  function changeZoom(next: number) {
    const viewport = viewportRef.current;
    const artwork = artworkRef.current;
    if (viewport && artwork) {
      zoomAnchor.current = {
        x:
          (viewport.scrollLeft - PAN_GUTTER + viewport.clientWidth / 2) /
          artwork.clientWidth,
        y:
          (viewport.scrollTop - PAN_GUTTER + viewport.clientHeight / 2) /
          artwork.clientHeight,
      };
    }
    setZoom(next);
  }
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const artwork = artworkRef.current;
    const anchor = zoomAnchor.current;
    if (!viewport || !artwork) return;
    viewport.scrollLeft = anchor
      ? PAN_GUTTER + anchor.x * artwork.clientWidth - viewport.clientWidth / 2
      : PAN_GUTTER;
    viewport.scrollTop = anchor
      ? PAN_GUTTER + anchor.y * artwork.clientHeight - viewport.clientHeight / 2
      : PAN_GUTTER;
    zoomAnchor.current = null;
  }, [zoom]);

  function finishPan(event: PointerEvent<HTMLDivElement>) {
    if (pan.current?.pointerId !== event.pointerId) return;
    pan.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }
  return (
    <section className="map-section" aria-labelledby="map-title">
      <div className="floorplan-shell">
        <div className="map-heading">
          <div>
            <h2 id="map-title">Facility map</h2>
            <p className="small muted">Ground floor</p>
          </div>
        </div>
        <div
          className="floorplan-viewport"
          ref={viewportRef}
          data-panning={panning || undefined}
          tabIndex={0}
          role="region"
          aria-label="Scrollable facility floor plan"
          aria-describedby="map-description"
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            suppressClick.current = false;
            pan.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              left: event.currentTarget.scrollLeft,
              top: event.currentTarget.scrollTop,
              dragging: false,
            };
          }}
          onPointerMove={(event) => {
            const gesture = pan.current;
            if (!gesture || gesture.pointerId !== event.pointerId) return;
            const dx = event.clientX - gesture.x;
            const dy = event.clientY - gesture.y;
            if (!gesture.dragging) {
              if (Math.hypot(dx, dy) < 6) return;
              gesture.dragging = true;
              suppressClick.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              setPanning(true);
            }
            event.preventDefault();
            event.currentTarget.scrollLeft = gesture.left - dx;
            event.currentTarget.scrollTop = gesture.top - dy;
          }}
          onPointerUp={finishPan}
          onPointerCancel={finishPan}
          onLostPointerCapture={(event) => {
            // Ignore bubbled capture loss when touch transfers from a room.
            if (event.target === event.currentTarget) finishPan(event);
          }}
          onPointerLeave={(event) => {
            if (
              pan.current?.pointerId === event.pointerId &&
              !pan.current.dragging
            ) {
              pan.current = null;
            }
          }}
          onClickCapture={(event) => {
            // Ignore the synthetic click after a drag, preserving keyboard activation.
            if (!suppressClick.current || event.detail === 0) return;
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }}
          onDragStart={(event) => event.preventDefault()}
        >
          <div
            className="floorplan-canvas"
            style={
              {
                width: `calc(${100 + zoom * 25}% + ${PAN_GUTTER * 2}px)`,
                "--pan-gutter": `${PAN_GUTTER}px`,
              } as CSSProperties
            }
          >
            <div className="floorplan-artwork" ref={artworkRef}>
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
                const roomIncident =
                  incidents?.find(
                    (i) => i.roomId === id && i.status !== "resolved",
                  ) ?? incident;
                const active =
                  roomIncident?.roomId === id &&
                  roomIncident.status !== "resolved";
                const tone = active
                  ? roomIncident.status === "pending"
                    ? "attention"
                    : "responding"
                  : !room.online
                    ? "offline"
                    : "monitoring";
                const label =
                  tone === "offline"
                    ? room.monitoringStatus === "degraded"
                      ? "Monitoring degraded"
                      : "Sensor offline"
                    : tone === "attention"
                      ? "Possible fall"
                      : tone === "responding"
                        ? roomIncident!.status === "acknowledged"
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
                    aria-label={`Room ${id}, ${room.resident}, ${roomStatus(room, roomIncident)}`}
                    aria-pressed={selected === id}
                    title={`${room.resident} · ${roomStatus(room, roomIncident)}`}
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
        </div>
        <div className="map-zoom" role="group" aria-label="Map zoom">
          <button
            className="icon-button compact"
            aria-label="Zoom out of facility map"
            disabled={zoom === 0}
            onClick={() => changeZoom(zoom - 1)}
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
            onClick={() => changeZoom(zoom + 1)}
          >
            +
          </button>
          <button
            className="icon-button compact"
            aria-label="Reset map view"
            title="Reset map view"
            onClick={() => {
              zoomAnchor.current = null;
              setZoom(0);
              viewportRef.current?.scrollTo({
                left: PAN_GUTTER,
                top: PAN_GUTTER,
                behavior: "instant",
              });
            }}
          >
            <Icon name="center" size={16} />
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
      <p id="map-description" className="map-caption small muted">
        Illustrative floor plan · Drag to pan; click a room for details. Use
        zoom or reset the view above. Touch, scrolling and arrow keys also work.
      </p>
    </section>
  );
}
