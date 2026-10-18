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
export function messageCandidates({ staffDispatchConfirmed = false } = {}) {
  return {
    missed:
      "This is Blissey Beacon. We tried to reach you with a care notification. Please contact your care team for an update. Reply CALLBACK to request operator review, or STOP to stop iMessages.",
    summary: `Blissey Beacon care notification: Thank you for speaking with us. ${staffDispatchConfirmed ? "Our care team has been dispatched and will keep you updated as the situation develops." : "Please contact your care team for the latest updates."} Reply CALLBACK to request operator review, or STOP to stop iMessages.`,
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

export function isAutomaticFollowup(policy: unknown) {
  return policy === "automatic-v2" || policy === "automatic-v3";
}
export function automaticFollowupSelection(
  policy: unknown,
  report: {
    outcome?: string;
    recipientVerified?: boolean;
    answered?: boolean;
  } | null,
) {
  if (policy === "automatic-v3")
    return report?.answered === true
      ? ("summary" as const)
      : ("missed" as const);
  return report?.outcome === "communicated" &&
    report?.recipientVerified === true
    ? ("summary" as const)
    : ("missed" as const);
}
