import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import { createOperatorVerifier } from "../src/auth.js";
import { createApp } from "../src/app.js";
const issuer = "https://synthetic.supabase.test/auth/v1";
const subject = "11111111-1111-4111-8111-111111111111";
const { privateKey, publicKey } = await generateKeyPair("ES256");
async function token(
  options: {
    issuer?: string;
    audience?: string;
    role?: string;
    expiry?: string;
  } = {},
) {
  return new SignJWT({ role: options.role ?? "authenticated" })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(subject)
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(options.expiry ?? "5m")
    .sign(privateKey);
}
test("signature and claims are verified; identity alone does not grant facility access", async () => {
  let reads = 0;
  const app = await createApp({
    webOrigin: "http://localhost:5173",
    verifyOperator: createOperatorVerifier(issuer, "authenticated", publicKey),
    store: {
      isMember: async (_sub, facility) => facility === "assigned",
      listIncidents: async () => ({ incidents: [], next_cursor: null }),
      getIncident: async () => null,
      listDeviceStatus: async () => [],
      listRooms: async () => {
        reads++;
        return [];
      },
    },
  });
  try {
    assert.equal((await app.inject("/healthz")).statusCode, 200);
    assert.equal(
      (await app.inject("/api/operator/rooms?facility_id=assigned")).statusCode,
      401,
    );
    for (const bad of [
      "tampered",
      await token({ issuer: "https://wrong.test" }),
      await token({ audience: "wrong" }),
      await token({ role: "anon" }),
      await token({ expiry: "-1s" }),
    ]) {
      assert.equal(
        (
          await app.inject({
            url: "/api/operator/rooms?facility_id=assigned",
            headers: { authorization: `Bearer ${bad}` },
          })
        ).statusCode,
        401,
      );
    }
    const otherKey = await generateKeyPair("ES256");
    const forged = await new SignJWT({ role: "authenticated" })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject(subject)
      .setIssuer(issuer)
      .setAudience("authenticated")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(otherKey.privateKey);
    assert.equal(
      (
        await app.inject({
          url: "/api/operator/rooms?facility_id=assigned",
          headers: { authorization: `Bearer ${forged}` },
        })
      ).statusCode,
      401,
    );
    const good = await token();
    assert.equal(
      (
        await app.inject({
          url: "/api/operator/rooms?facility_id=other",
          headers: { authorization: `Bearer ${good}` },
        })
      ).statusCode,
      403,
    );
    assert.equal(reads, 0);
    assert.equal(
      (
        await app.inject({
          url: "/api/operator/rooms?facility_id=assigned",
          headers: { authorization: `Bearer ${good}` },
        })
      ).statusCode,
      200,
    );
    assert.equal(reads, 1);
  } finally {
    await app.close();
  }
});
