import { AppShell } from "@/components/AppShell";
import { PageSkeleton } from "@/components/PageSkeleton";

export default function Loading() {
  return (
    <AppShell active="pipeline">
      <PageSkeleton variant="list" />
    </AppShell>
  );
}
