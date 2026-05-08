"use client";

import { useAppShell } from "@/components/AppShell";
import { ActivityCard } from "@/components/ActivityCard";

// Mobile-only standalone view of the activity feed. On desktop the same
// card lives in the right rail of the Chat route; this page exists so
// phone users can reach the feed via the side menu.
export default function ActivityPage() {
  const { resetTick } = useAppShell();

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col p-4 lg:p-6">
      <ActivityCard refreshKey={resetTick} />
    </div>
  );
}
