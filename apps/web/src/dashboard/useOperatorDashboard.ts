import { overviewIncident } from "./incident-selection";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type {
  Incident,
  DashboardRoom,
  IncidentWorkflow,
  DemoScenarioRequest,
} from "@blissey/contracts";
import { apiUrl, facilityId, supabase } from "../client";
import { createOperatorApi } from "../operator-api";
import { subscribeToIncidents } from "../incidents";
import { createDemo } from "./model";
import type { DemoAction, DemoIncident, DemoState, Scenario } from "./model";
export function useOperatorDashboard(enabled: boolean, selected: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [records, setRecords] = useState<Incident[]>([]);
  const [rooms, setRooms] = useState<DashboardRoom[]>([]);
  const [workflow, setWorkflow] = useState<IncidentWorkflow | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(true);
  const [scenariosEnabled, setScenariosEnabled] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [marker, setMarker] = useState<Scenario | null>(null);
  const generation = useRef(0);
  const scenarioRequest = useRef<{
    key: string;
    room: string;
    scenario: Scenario;
  } | null>(null);
  const api = useMemo(
    () => (session ? createOperatorApi(apiUrl, session.access_token) : null),
    [session],
  );
  const record = overviewIncident(records, selected, Date.now(), focused);
  const refresh = useCallback(async () => {
    if (!api) return;
    const revision = ++generation.current;
    try {
      const [snapshot, history] = await Promise.all([
        api.dashboard(facilityId),
        api.incidents(facilityId),
      ]);
      const chosen = overviewIncident(
        history.incidents,
        selected,
        Date.now(),
        focused,
      );
      const nextWorkflow = chosen ? await api.workflow(chosen.id) : null;
      if (revision !== generation.current) return;
      setRooms(snapshot.rooms);
      setRecords(history.incidents);
      setWorkflow(nextWorkflow);
      setScenariosEnabled(snapshot.scenarios_enabled);
      setError("");
      setStale(false);
    } catch (e) {
      if (revision === generation.current) {
        setError(
          e instanceof Error ? e.message : "Unable to refresh dashboard",
        );
        setStale(true);
      }
    }
  }, [api, selected, focused]);
  useEffect(() => {
    if (!enabled || !supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, value) => setSession(value));
    return () => {
      subscription.unsubscribe();
      generation.current++;
    };
  }, [enabled]);
  useEffect(() => {
    if (!session) {
      setRooms([]);
      setRecords([]);
      setWorkflow(null);
      setFocused(null);
      setMarker(null);
      scenarioRequest.current = null;
      generation.current++;
      setStale(true);
      return;
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    const stop = supabase
      ? subscribeToIncidents(
          supabase,
          facilityId,
          () => void refresh(),
          setStale,
        )
      : () => {};
    return () => {
      clearInterval(timer);
      stop();
      generation.current++;
    };
  }, [refresh, session]);
  async function instantiate(scenario: Scenario) {
    if (!api) throw new Error("Sign in to instantiate a backend scenario.");
    setBusy(true);
    setActionError("");
    try {
      if (
        !scenarioRequest.current ||
        scenarioRequest.current.room !== selected ||
        scenarioRequest.current.scenario !== scenario
      )
        scenarioRequest.current = {
          key:
            sessionStorage.getItem(
              `scenario-intent:${facilityId}:${selected}:${scenario}`,
            ) ?? crypto.randomUUID(),
          room: selected,
          scenario,
        };
      sessionStorage.setItem(
        `scenario-intent:${facilityId}:${selected}:${scenario}`,
        scenarioRequest.current.key,
      );
      const result = await api.instantiate(
        {
          facility_id: facilityId,
          room_id: selected as DemoScenarioRequest["room_id"],
          scenario,
        },
        scenarioRequest.current.key,
      );
      setFocused(null);
      setMarker(result.incident_id ? null : scenario);
      sessionStorage.removeItem(
        `scenario-intent:${facilityId}:${selected}:${scenario}`,
      );
      scenarioRequest.current = null;
      await refresh();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Scenario request failed",
      );
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function dispatch(action: DemoAction) {
    if (
      !api ||
      !record ||
      !workflow ||
      workflow.incident_id !== record.id ||
      stale
    )
      throw new Error("Instantiate or select a persisted incident first.");
    setBusy(true);
    setActionError("");
    try {
      if (action.type === "advance")
        await api.action(
          record.id,
          {
            expected_revision: workflow.revision,
            status: action.status as "acknowledged" | "responding" | "resolved",
          },
          crypto.randomUUID(),
        );
      else if (action.type === "note")
        await api.action(
          record.id,
          { expected_revision: workflow.revision, note: action.text },
          crypto.randomUUID(),
        );
      else if (action.type === "false-alarm")
        await api.action(
          record.id,
          {
            expected_revision: workflow.revision,
            status: "resolved",
            disposition: "false_alarm",
          },
          crypto.randomUUID(),
        );
      else
        throw new Error("Use the backend scenario controls for this action.");
      await refresh();
    } catch (e) {
      await refresh();
      setActionError(e instanceof Error ? e.message : "Incident action failed");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function resetAlerts() {
    if (!api || busy) return;
    setBusy(true);
    setActionError("");
    try {
      const storageKey = `room-reset:${facilityId}:${selected}`;
      const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey, key);
      await api.resetRoom(facilityId, selected, key);
      sessionStorage.removeItem(storageKey);
      setMarker(null);
      setFocused(null);
      await refresh();
    } catch (e) {
      await refresh();
      setActionError(e instanceof Error ? e.message : "Room reset failed");
    } finally {
      setBusy(false);
    }
  }
  const converted = (i: Incident): DemoIncident => ({
    roomId: i.room_id,
    status: i.status,
    explanation: i.explanation_status,
    timeline: [
      `${new Date(i.detected_at).toLocaleString()} · ${i.event_id.startsWith("synthetic_") ? "Synthetic scenario" : "Device event"} persisted`,
    ],
    notes:
      i.id === workflow?.incident_id ? workflow.notes.map((n) => n.note) : [],
    falseAlarm:
      i.id === workflow?.incident_id && workflow.disposition === "false_alarm",
    record: i,
  });
  const state: DemoState = {
    rooms: createDemo("empty")
      .rooms.map((r) => {
        const actual = rooms.find((x) => x.id === r.id);
        return {
          ...r,
          online: actual?.monitoring_status === "monitoring",
          monitoringStatus: actual?.monitoring_status ?? "offline",
          resident: actual?.resident ?? r.resident,
          device: actual?.device_id ?? "Not registered",
          lastDataAt: actual?.last_data_at ?? null,
          dataSource: actual?.data_source,
          contact: actual?.contact_id
            ? {
                name: actual.contact_name ?? "Family contact",
                phone: "+12025550142",
                consent: actual.voice_consent,
              }
            : null,
        };
      })
      .concat(
        rooms
          .filter(
            (r) => !createDemo("empty").rooms.some((base) => base.id === r.id),
          )
          .map((r) => ({
            id: r.id,
            resident: r.resident ?? "Unassigned resident",
            device: r.device_id ?? "Not registered",
            online: r.monitoring_status === "monitoring",
            monitoringStatus: r.monitoring_status,
            lastDataAt: r.last_data_at,
            dataSource: r.data_source,
            contact: r.contact_id
              ? {
                  name: r.contact_name ?? "Family contact",
                  phone: "+12025550142",
                  consent: r.voice_consent,
                }
              : null,
          })),
      ),
    incident: record && !marker ? converted(record) : null,
  };
  return {
    enabled,
    session,
    api,
    state,
    records,
    workflow,
    record: marker ? null : record,
    busy,
    error: actionError || error,
    stale,
    scenariosEnabled,
    marker,
    refresh,
    instantiate,
    dispatch,
    resetAlerts,
    focus: (id: string | null) => {
      setFocused(id);
      setMarker(null);
    },
    incidents: records.map(converted),
  };
}
