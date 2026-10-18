export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  function required(name: string) {
    const value = env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  }
  const supabaseUrl = new URL(required("SUPABASE_URL"));
  if (
    supabaseUrl.protocol !== "https:" &&
    !(
      supabaseUrl.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(supabaseUrl.hostname)
    )
  )
    throw new Error("SUPABASE_URL requires HTTPS outside localhost");
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  const apiKey = env.GEMINI_API_KEY;
  const model = env.GEMINI_MODEL;
  if (apiKey && (!model || !/^[a-zA-Z0-9._-]{1,120}$/.test(model)))
    throw new Error(
      "Set a valid GEMINI_MODEL when GEMINI_API_KEY is configured",
    );
  const callsEnabled = env.NOTIFICATION_CALLS_ENABLED === "true";
  const voice = {
    apiKey: env.ELEVENLABS_API_KEY,
    agentId: env.ELEVENLABS_AGENT_ID,
    phoneNumberId: env.ELEVENLABS_PHONE_NUMBER_ID,
    secret: env.ELEVENLABS_WEBHOOK_SECRET,
  };
  if (callsEnabled && Object.values(voice).some((value) => !value))
    throw new Error("Calling requires all ElevenLabs configuration values");
  return {
    callsEnabled,
    voice,
    gemini: apiKey && model ? { apiKey, model } : null,
    databaseUrl: required("DATABASE_URL"),
    issuer: `${supabaseUrl.origin}/auth/v1`,
    audience: "authenticated",
    webOrigin: new URL(required("WEB_ORIGIN")).origin,
    port,
  };
}
