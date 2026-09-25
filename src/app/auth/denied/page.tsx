import type { Metadata } from "next";
import Link from "next/link";
import { ShieldX } from "lucide-react";
import { auth, signOut } from "@/lib/auth";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OrizonLabCredit, SentinelLogo } from "@/components/brand/sentinel-logo";

export const metadata: Metadata = {
  title: "Accès non autorisé — Sentinel",
};

/**
 * Compte Microsoft valide, mais absent de la liste d'accès, en attente,
 * banni ou retiré. Même message dans tous les cas : on ne révèle pas à un
 * tiers l'état de son adresse dans la liste.
 */
export default async function AccessDeniedPage() {
  const session = await auth();
  // Session encore ouverte (accès retiré en cours de route) : on propose de la
  // fermer, pour pouvoir se reconnecter avec un autre compte.
  const hasSession = Boolean(session?.user);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#000726] p-4">
      <Card className="w-full max-w-md border-[#132255] bg-[#0a1130]/80 backdrop-blur-xl shadow-2xl shadow-[#0251a1]/10">
        <CardHeader className="text-center space-y-6">
          <SentinelLogo className="mx-auto" />
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
            <ShieldX className="h-7 w-7 text-red-400" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-xl font-bold text-[#dde1e4]">Accès non autorisé</CardTitle>
            <CardDescription className="text-[#8896b4] text-sm leading-relaxed">
              Votre compte n&apos;a pas le droit d&apos;accéder à cette plateforme.
              <br />
              Rapprochez-vous de votre responsable systèmes si vous pensez devoir y accéder.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pb-8">
          {hasSession ? (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/auth/signin" });
              }}
            >
              <button
                type="submit"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "w-full bg-[#132255] hover:bg-[#1a2d66] text-[#dde1e4]",
                )}
              >
                Se déconnecter
              </button>
            </form>
          ) : (
            <Link
              href="/auth/signin"
              className={cn(
                buttonVariants({ size: "lg" }),
                "w-full bg-[#132255] hover:bg-[#1a2d66] text-[#dde1e4]",
              )}
            >
              Se connecter avec un autre compte
            </Link>
          )}
        </CardContent>
      </Card>
      <OrizonLabCredit className="mt-8" />
    </div>
  );
}
