import { redirect } from "next/navigation";
import { ownerExists } from "@/lib/localAuth";

// Setup is one-shot: once the owner exists, this route stops existing in
// practice (the API also 409s, this is just the friendlier path).
export default async function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await ownerExists()) redirect("/login");
  return <>{children}</>;
}
