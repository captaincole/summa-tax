import { type NextRequest, NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/localAuth";

// Server-side proxy to the Mastra agent — the single bridge between the
// browser and the agent (chat streaming, /app/state, filing lifecycle,
// thread history). The browser authenticates with the session cookie; the
// agent never sees a browser credential and can bind to localhost. If
// AGENT_API_TOKEN is set (agent port reachable beyond localhost), the proxy
// attaches it server-side.
//
// Streaming: we hand the upstream body straight through, so chat SSE flows
// without buffering.

const AGENT_INTERNAL_URL =
  process.env.AGENT_INTERNAL_URL ?? "http://127.0.0.1:4111";

async function forward(
  request: NextRequest,
  params: Promise<{ path: string[] }>,
): Promise<Response> {
  const session = await getOwnerSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { path } = await params;
  const target = new URL(
    `/${path.join("/")}${request.nextUrl.search}`,
    AGENT_INTERNAL_URL,
  );

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const accept = request.headers.get("accept");
  if (accept) headers.set("accept", accept);
  if (process.env.AGENT_API_TOKEN) {
    headers.set("authorization", `Bearer ${process.env.AGENT_API_TOKEN}`);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    // Required by undici when forwarding a ReadableStream body.
    ...(hasBody ? { duplex: "half" as const } : {}),
  });

  // Pass status + body through; copy content headers so SSE stays SSE.
  const responseHeaders = new Headers();
  for (const h of ["content-type", "cache-control", "transfer-encoding"]) {
    const v = upstream.headers.get(h);
    if (v) responseHeaders.set(h, v);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
