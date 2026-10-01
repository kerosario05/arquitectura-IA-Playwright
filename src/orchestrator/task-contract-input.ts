/** Reads explicit physical-task configuration without inferring it from prose or action text. */
export function explicitRuntimeUrlFromMessage(message: string): string | undefined {
  const match = message.match(/\bruntimeUrl\s*[=:]\s*(https?:\/\/[^\s"'<>]+)/i);
  if (!match) return undefined;
  const candidate = match[1].replace(/[.,;]+$/, "");
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
