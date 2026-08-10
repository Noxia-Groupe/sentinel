import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { NvrsClient } from "./nvrs-client";

export const metadata = {
  title: "Enregistreurs — SENTINEL",
};

// La liste accepte un filtre client passé en paramètre d'URL (`?clientId=`),
// ce qui impose une frontière Suspense autour du composant client.
export default function NvrsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 lg:p-8 space-y-4">
          <Skeleton className="h-10 w-64 bg-[#132255]" />
          <Skeleton className="h-96 w-full bg-[#132255]" />
        </div>
      }
    >
      <NvrsClient />
    </Suspense>
  );
}
