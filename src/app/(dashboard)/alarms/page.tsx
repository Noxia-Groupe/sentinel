import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AlarmsClient } from "./alarms-client";

export const metadata = {
  title: "Centre d'alarme — SENTINEL",
};

// `AlarmsClient` lit les paramètres d'URL (lien direct depuis un enregistreur) :
// Next impose une frontière Suspense autour d'un composant qui utilise
// `useSearchParams`.
export default function AlarmsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 lg:p-8 space-y-4">
          <Skeleton className="h-10 w-64 bg-[#132255]" />
          <Skeleton className="h-24 w-full bg-[#132255]" />
          <Skeleton className="h-96 w-full bg-[#132255]" />
        </div>
      }
    >
      <AlarmsClient />
    </Suspense>
  );
}
