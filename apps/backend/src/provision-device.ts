// Reads the token from the environment, never argv or logs. No production defaults.
import { Pool } from "pg";
import { credentialHash } from "./ingestion/store.js";
const { DATABASE_URL, DEVICE_ID, DEVICE_TOKEN } = process.env;
if (
  !DATABASE_URL ||
  !DEVICE_ID ||
  !DEVICE_TOKEN ||
  !/^[-_a-zA-Z0-9]{32,256}$/.test(DEVICE_TOKEN)
)
  throw new Error(
    "Set DATABASE_URL, DEVICE_ID and a random 32+ character DEVICE_TOKEN",
  );
const pool = new Pool({ connectionString: DATABASE_URL });
try {
  await pool.query(
    "INSERT INTO public.device_credentials(token_hash,device_id) VALUES ($1,$2)",
    [credentialHash(DEVICE_TOKEN), DEVICE_ID],
  );
  console.log("Device credential provisioned (token redacted).");
} finally {
  await pool.end();
}
