import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { publishIncident101 } from "../lib/incident.mjs";
const config = {
  api: "https://api.example.test",
  supabase: "https://auth.example.test",
  facility: "demo_facility",
  env: {
    DEMO_OPERATOR_EMAIL: "fictional@example.test",
    DEMO_OPERATOR_PASSWORD: "test-only-password",
    SUPABASE_PUBLISHABLE_KEY: "synthetic-key",
  },
};
const incident = "11111111-1111-4111-8111-111111111111";
function backend() {
  const requests = [],
    records = new Map();
  let loseReply = false;
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.redirect, "error");
    assert.ok(
      !url.includes("notifications") &&
        !url.includes("messages") &&
        !url.includes("stream"),
    );
    if (url.includes("/auth/v1/token"))
      return Response.json({ access_token: "synthetic-jwt", expires_in: 3600 });
    assert.equal(url, config.api + "/api/operator/demo/scenarios");
    assert.deepEqual(JSON.parse(options.body), {
      facility_id: "demo_facility",
      room_id: "101",
      scenario: "attention",
    });
    const key = options.headers["Idempotency-Key"];
    const result = records.get(key) ?? {
      room_id: "101",
      scenario: "attention",
      incident_id: incident,
      scenario_id: randomUUID(),
    };
    records.set(key, result);
    if (loseReply) {
      loseReply = false;
      throw Error("synthetic lost response after commit");
    }
    return Response.json(result, { status: 201 });
  };
  return {
    fetcher,
    requests,
    records,
    loseNextReply: () => {
      loseReply = true;
    },
  };
}
test("one-shot creates only the room101 scenario; repeats skip login and explicit retry skips all requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "incident101-"));
  try {
    const b = backend(),
      key = randomUUID();
    const first = await publishIncident101(config, key, {
      directory,
      fetcher: b.fetcher,
    });
    assert.equal(first.incident_id, incident);
    assert.equal(b.requests.length, 2);
    assert.deepEqual(
      await publishIncident101(config, key, { directory, fetcher: b.fetcher }),
      first,
    );
    assert.equal(b.requests.length, 2);
    await publishIncident101(config, randomUUID(), {
      directory,
      fetcher: b.fetcher,
    });
    assert.equal(b.requests.length, 3);
    assert.equal(
      b.requests.filter((r) => r.url.includes("/auth/v1/token")).length,
      1,
    );
    const authFile = join(
      directory,
      (await readdir(directory)).find((n) => n.startsWith("incident-auth-")),
    );
    assert.equal((await stat(authFile)).mode & 0o777, 0o600);
    assert.ok(
      !(await readFile(authFile, "utf8")).includes("test-only-password"),
    );
    await assert.rejects(
      publishIncident101(
        { ...config, api: "https://other.example.test" },
        key,
        { directory, fetcher: b.fetcher },
      ),
      /another operator\/target/,
    );
    assert.equal(b.requests.length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("lost commit response never automatically resubmits; an explicit same-key retry creates one incident", async () => {
  const directory = await mkdtemp(join(tmpdir(), "incident101-"));
  try {
    const b = backend(),
      key = randomUUID();
    b.loseNextReply();
    await assert.rejects(
      publishIncident101(config, key, { directory, fetcher: b.fetcher }),
      /No automatic incident retry/,
    );
    assert.equal(b.requests.length, 2);
    assert.equal(b.records.size, 1);
    await publishIncident101(config, key, { directory, fetcher: b.fetcher });
    assert.equal(b.requests.length, 3);
    assert.equal(b.records.size, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("rejected cached JWT is refreshed once; the incident idempotency key is preserved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "incident101-"));
  try {
    const b = backend();
    await publishIncident101(config, randomUUID(), {
      directory,
      fetcher: b.fetcher,
    });
    let reject = true;
    const fetcher = async (url, options) => {
      if (reject && url.includes("/demo/scenarios")) {
        reject = false;
        b.requests.push({ url, options });
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      return b.fetcher(url, options);
    };
    const key = randomUUID();
    await publishIncident101(config, key, { directory, fetcher });
    const posts = b.requests.filter(
      (r) => r.options.headers["Idempotency-Key"] === key,
    );
    assert.equal(posts.length, 2);
    assert.equal(b.records.size, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
