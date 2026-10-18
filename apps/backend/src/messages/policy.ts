import type { FamilyCallContext } from "@blissey/contracts";
export type CallEvidence =
  | "no_answer"
  | "busy"
  | "voicemail"
  | "ended_before_message"
  | "communicated"
  | "unknown";
export function selectFollowup(
  evidence: CallEvidence,
  recipientVerified: boolean,
) {
  if (
    ["no_answer", "busy", "voicemail", "ended_before_message"].includes(
      evidence,
    )
  )
    return "missed" as const;
  if (evidence === "communicated" && recipientVerified)
    return "summary" as const;
  return "review" as const;
}
export function messageCandidates(context: FamilyCallContext) {
  return {
    missed:
      "This is Blissey Beacon. We tried to reach you with a care notification. Please contact your care team for an update. Reply CALLBACK to request operator review, or STOP to stop iMessages.",
    summary: `Blissey Beacon care notification: ${context.family_summary} Reply CALLBACK to request operator review, ACK to acknowledge this message, or STOP to stop iMessages. A callback request does not confirm that staff will call.`,
  };
}
export function replyIntent(text: string) {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "");
  if (["stop", "unsubscribe", "cancel", "end", "quit"].includes(value))
    return "stop" as const;
  if (
    ["callback", "call me", "please call me", "request callback"].includes(
      value,
    )
  )
    return "callback_requested" as const;
  if (["ack", "acknowledged", "received"].includes(value))
    return "acknowledged" as const;
  return "operator_review" as const;
}
