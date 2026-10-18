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
  const messagesEnabled = env.NOTIFICATION_MESSAGES_ENABLED === "true";
  const photon = {
    projectId: env.PHOTON_PROJECT_ID,
    apiKey: env.PHOTON_API_KEY,
    senderNumber: env.PHOTON_IMESSAGE_SENDER_NUMBER,
  };
  const messagingConfigured = Object.values(photon).every(Boolean);
  if (messagesEnabled && !messagingConfigured)
    throw new Error(
      "Messaging requires Photon project, API key and iMessage sender number",
    );
  if (photon.senderNumber && !/^\+[1-9][0-9]{7,14}$/.test(photon.senderNumber))
    throw new Error("Invalid PHOTON_IMESSAGE_SENDER_NUMBER");
  const demoPhone = env.DEMO_CONTACT_PHONE ?? env.DEMO_FAMILY_PHONE_E164;
  if (
    env.DEMO_SCENARIOS_ENABLED === "true" &&
    (!demoPhone || !/^\+[1-9]\d{7,14}$/.test(demoPhone))
  )
    throw new Error(
      "Enabled dashboard scenarios require a consented DEMO_CONTACT_PHONE",
    );
  return {
    demo: {
      enabled: env.DEMO_SCENARIOS_ENABLED === "true",
      facilityId: env.DEMO_FACILITY_ID ?? "demo_facility",
      phone: demoPhone,
    },
    messagesEnabled,
    photon: messagingConfigured
      ? {
          projectId: photon.projectId!,
          apiKey: photon.apiKey!,
          senderNumber: photon.senderNumber!,
        }
      : null,
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
