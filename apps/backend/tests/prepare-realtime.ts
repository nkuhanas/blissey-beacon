// Deliberately uses only Node built-ins: CI calls this before workspace installation.
import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile, chmod } from "node:fs/promises";
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const keys = {
  private: { ...privateKey.export({ format: "jwk" }), kid: "synthetic-local" },
  public: {
    ...publicKey.export({ format: "jwk" }),
    kid: "synthetic-local",
    alg: "ES256",
    use: "sig",
  },
};
const root = new URL("../../../", import.meta.url);
await mkdir(new URL(".supabase-test/", root), { recursive: true });
await writeFile(
  new URL(".supabase-test/keys.json", root),
  JSON.stringify(keys),
  { mode: 0o600 },
);
const publicEnvironment = new URL(".env.realtime", root);
await writeFile(
  publicEnvironment,
  `REALTIME_TEST_JWKS='${JSON.stringify({ keys: [keys.public] })}'\n`,
);
// Compose runs on the host in Linux CI and must read this PUBLIC JWKS.
// The private test key remains mode 0600 and is read only inside test containers.
await chmod(publicEnvironment, 0o644);
console.log(
  "Generated ephemeral local test keys; no production credentials used.",
);
