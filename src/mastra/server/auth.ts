import { SimpleAuth } from "@mastra/core/server";

// SimpleAuth treats the env var as a bearer token. Frontend sends
// `Authorization: Bearer <DEMO_PASSCODE>` on every request. Mastra protects
// /api/agents/*, /api/workflows/*, and any custom routes we register.
//
// The "passcode" is the token value verbatim. Not rotation-safe; this is the
// demo posture. Production swap-out path is JWT or an external IDP.
export function createDemoAuth(): SimpleAuth<{ id: string }> | undefined {
  const passcode = process.env.DEMO_PASSCODE;
  if (!passcode) return undefined;
  return new SimpleAuth<{ id: string }>({
    tokens: { [passcode]: { id: "demo" } },
  });
}
