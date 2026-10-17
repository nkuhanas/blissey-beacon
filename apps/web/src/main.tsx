import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { validateRoom, type Room } from "@blissey/contracts";
import { apiUrl, facilityId, supabase } from "./client";
import "./style.css";
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setChecking(false);
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    setRooms([]);
    setError("");
    if (!session || !supabase) return;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch(
          `${apiUrl}/api/operator/rooms?facility_id=${encodeURIComponent(facilityId)}`,
          {
            headers: { Authorization: `Bearer ${session!.access_token}` },
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error(
            response.status === 403
              ? "This account is not assigned to this facility."
              : "Unable to load rooms. Check the backend connection or sign in again.",
          );
        const body: unknown = await response.json();
        if (
          !body ||
          typeof body !== "object" ||
          !("rooms" in body) ||
          !Array.isArray(body.rooms) ||
          !body.rooms.every((value) => validateRoom(value))
        )
          throw new Error("Unexpected room response.");
        if (!controller.signal.aborted) {
          setRooms(body.rooms);
          setError("");
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "Unable to load rooms.",
          );
      }
    }
    void refresh();
    // Supabase carries the signed-in user's JWT; RLS authorizes each row.
    const channel = supabase
      .channel(`rooms:${facilityId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
          filter: `facility_id=eq.${facilityId}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refresh();
      });
    const onOnline = () => {
      void refresh();
    };
    window.addEventListener("online", onOnline);
    return () => {
      controller.abort();
      window.removeEventListener("online", onOnline);
      void supabase!.removeChannel(channel);
    };
  }, [session]);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error)
        setError("Sign-in failed. Check your demo account credentials.");
      else setPassword("");
    } catch {
      setError("Authentication service is unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <header>
        <span className="brand">BLISSEY BEACON</span>
        <span className="badge">Development foundation</span>
      </header>
      <section className="intro">
        <p className="eyebrow">Camera-free sensing · Room-centered care</p>
        <h1>
          A clearer view.
          <br />A thoughtful response.
        </h1>
        <p className="muted">
          Experimental demo using fictional residents and staged events. Not a
          medical or emergency response device.
        </p>
      </section>
      {!supabase ? (
        <section className="panel">
          <h2>Connect your demo environment</h2>
          <p>
            Configure the Supabase URL and publishable key to enable operator
            sign-in.
          </p>
          <p>
            Hardware sensing, incident ingestion, explanations and notifications
            are not connected in this scaffold.
          </p>
        </section>
      ) : checking ? (
        <p role="status">Checking your session…</p>
      ) : !session ? (
        <form
          className="panel"
          onSubmit={(event) => {
            void login(event);
          }}
        >
          <h2>Operator sign-in</h2>
          <p>Use your provisioned demo account.</p>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      ) : (
        <section className="panel">
          <div className="row">
            <h2>Demo rooms</h2>
            <button
              onClick={() => {
                void supabase!.auth.signOut().then(({ error }) => {
                  if (error) setError("Sign-out failed. Please retry.");
                });
              }}
            >
              Sign out
            </button>
          </div>
          <p className="muted">
            {session.user.email} · No live sensing connected
          </p>
          {rooms.length ? (
            <div className="rooms">
              {rooms.map((room) => (
                <article key={room.id}>
                  <span className="eyebrow">Floor {room.floor}</span>
                  <h3>{room.label}</h3>
                  <p>Monitoring not integrated</p>
                </article>
              ))}
            </div>
          ) : (
            <p>
              No rooms loaded. Provision facility membership and apply the demo
              seed.
            </p>
          )}
        </section>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer>Local inference on QNX. Structured events in the cloud.</footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
