// Agent calls go through the same-origin /api/agent proxy (session-cookie
// auth; the Next server forwards to the agent on localhost). Browser code
// never talks to the agent directly and never holds an agent credential.
export function agentUrl(path: string): string {
  return `/api/agent${path.startsWith("/") ? path : `/${path}`}`;
}
