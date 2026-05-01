import { useOutletContext } from "react-router-dom";
import { ActivityCard } from "@/components/ActivityCard";
import type { LayoutOutletContext } from "@/components/Layout";

// Mobile-only standalone view of the activity feed. On desktop the same card
// lives in the right rail of the Chat route; this page exists so phone users
// can reach the feed via the side menu.
export function Activity() {
  const { resetTick } = useOutletContext<LayoutOutletContext>();

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col p-4 lg:p-6">
      <ActivityCard refreshKey={resetTick} />
    </div>
  );
}
