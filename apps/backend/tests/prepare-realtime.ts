import { generateKeyPair, exportJWK } from "jose";
import { mkdir, writeFile } from "node:fs/promises";
const { privateKey, publicKey } = await generateKeyPair("ES256", {
  extractable: true,
});
const keys = {
  private: { ...(await exportJWK(privateKey)), kid: "synthetic-local" },
  public: {
    ...(await exportJWK(publicKey)),
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
await writeFile(
  new URL(".env.realtime", root),
  `REALTIME_TEST_JWKS='${JSON.stringify({ keys: [keys.public] })}'\n`,
  { mode: 0o600 },
);
console.log(
  "Generated ephemeral local test keys; no production credentials used.",
);
