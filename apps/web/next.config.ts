import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this app — Next.js otherwise picks the
  // outermost lockfile (the one in ~/attain-finance/) and warns. We're a
  // self-contained deploy unit, so anchor here.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // The dev-tools FAB defaults to bottom-left, which sits on top of the chat
  // composer's attach button. Top-right corner is empty.
  devIndicators: {
    position: "top-right",
  },
};

export default nextConfig;
