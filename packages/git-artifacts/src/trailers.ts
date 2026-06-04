export type GitArtifactActor = "user" | "agent" | "system";

export interface GitCommitTrailerOptions {
  readonly actor?: GitArtifactActor | string | undefined;
  readonly turnId?: string | undefined;
  readonly toolCallId?: string | undefined;
}

export interface GitCommitTrailers {
  readonly actor?: string | undefined;
  readonly turnId?: string | undefined;
  readonly toolCallId?: string | undefined;
}

export function buildGitCommitMessage(
  subject: string,
  trailers: GitCommitTrailerOptions | undefined,
): string {
  const lines = gitTrailerLines(trailers);
  return lines.length ? `${subject}\n\n${lines.join("\n")}` : subject;
}

export function gitTrailerLines(trailers: GitCommitTrailerOptions | undefined): readonly string[] {
  if (!trailers) return [];
  return [
    trailers.actor ? `Actor: ${trailers.actor}` : null,
    trailers.turnId ? `Turn-Id: ${trailers.turnId}` : null,
    trailers.toolCallId ? `Tool-Call-Id: ${trailers.toolCallId}` : null,
  ].filter((line): line is string => line !== null);
}

export function parseGitCommitTrailers(message: string): GitCommitTrailers {
  const trailers: { actor?: string; turnId?: string; toolCallId?: string } = {};
  for (const line of message.split(/\r?\n/).reverse()) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line.trim());
    if (!match) {
      if (line.trim() === "") continue;
      break;
    }
    const key = match[1] ?? "";
    const value = match[2] ?? "";
    if (key === "Actor") trailers.actor = value;
    else if (key === "Turn-Id") trailers.turnId = value;
    else if (key === "Tool-Call-Id") trailers.toolCallId = value;
  }
  return trailers;
}

export function gitActorName(actor: GitArtifactActor | undefined): string {
  switch (actor) {
    case "agent":
      return "Schematics Agent";
    case "system":
      return "Schematics";
    default:
      return "Schematics User";
  }
}

export function gitActorEmail(actor: GitArtifactActor | undefined): string {
  return `${actor ?? "user"}@schematics.local`;
}
