import { syntheticEvent, sendSyntheticEvent, RejectedEvent } from "./client.js";
const { DEVICE_TOKEN, DEVICE_WS_URL, EVENT_ID } = process.env;
if (!DEVICE_TOKEN || !DEVICE_WS_URL)
  throw new Error(
    "Set DEVICE_TOKEN and DEVICE_WS_URL; do not put credentials in the URL",
  );
// Load once: retries preserve event ID, timestamp and every fact in the canonical fixture.
const event = await syntheticEvent(EVENT_ID);
for (let attempt = 0; attempt < 5; attempt++) {
  try {
    const ack = await sendSyntheticEvent({
      url: DEVICE_WS_URL,
      token: DEVICE_TOKEN,
      event,
    });
    console.log(
      JSON.stringify({
        source: "synthetic QNX simulator; not hardware evidence",
        ...ack,
      }),
    );
    break;
  } catch (error) {
    if (error instanceof RejectedEvent || attempt === 4) throw error;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.random() * Math.min(30000, 1000 * 2 ** attempt)),
    );
  }
}
