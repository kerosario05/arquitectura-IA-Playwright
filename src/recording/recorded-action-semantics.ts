export type RecordedActionTargetMetadata = {
  actionType?: unknown;
  recordingActionType?: unknown;
  technicalTargetRef?: unknown;
  technicalTargetRefs?: unknown;
  targetRef?: unknown;
};

/** A tap captured on a dialog container has no actionable control to replay. */
export function isRecordedDialogContainerTap(action: RecordedActionTargetMetadata): boolean {
  const actionType = action.actionType ?? action.recordingActionType;
  if (typeof actionType !== "string" || actionType.toLowerCase() !== "click") {
    return false;
  }

  const refs = [
    action.technicalTargetRef,
    action.targetRef,
    ...(Array.isArray(action.technicalTargetRefs) ? action.technicalTargetRefs : []),
  ];
  return refs.some((ref) => {
    if (typeof ref !== "string") return false;
    const normalized = ref.trim().toLowerCase();
    return normalized.startsWith("role:dialog|")
      || normalized.split("|").some((part, index, parts) =>
        part.trim() === "role" && parts[index + 1]?.trim() === "dialog"
      );
  });
}
