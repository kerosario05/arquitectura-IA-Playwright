/** Only omit generic evidence when a detail capture actually owns this action. */
export function detailCaptureOwnsAction(detailTarget: string | undefined, finalIndex: number | undefined, actionIndex: number, recorder: { isDetailEvidence?: boolean } | undefined): boolean {
 return Boolean(detailTarget && finalIndex === actionIndex && recorder && recorder.isDetailEvidence !== false);
}
