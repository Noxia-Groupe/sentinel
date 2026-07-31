import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInButton } from "./signin-button";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "Accès refusé. Votre compte Microsoft n'est pas autorisé.",
  Configuration: "Configuration du fournisseur d'identité invalide.",
  OAuthAccountNotLinked: "Cette adresse e-mail est déjà associée à un autre mode de connexion.",
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#000726] p-4 relative overflow-hidden">
      {/* Fond animé subtil */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/4 w-[800px] h-[800px] rounded-full bg-[#0251a1]/5 blur-3xl animate-pulse" />
        <div className="absolute -bottom-1/2 -right-1/4 w-[600px] h-[600px] rounded-full bg-[#0251a1]/3 blur-3xl animate-pulse delay-1000" />
      </div>

      <Card className="relative w-full max-w-md border-[#132255] bg-[#0a1130]/80 backdrop-blur-xl shadow-2xl shadow-[#0251a1]/10">
        <CardHeader className="text-center space-y-6 pb-4">
          {/* Logo Noxia Groupe */}
          <div className="mx-auto w-48 h-12 relative">
            <Image
              src="/brand/logos/NOXIA GROUPE BLANC.jpg"
              alt="Noxia Groupe"
              fill
              className="object-contain"
              priority
            />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl font-extrabold tracking-wider text-[#dde1e4]">
              SENTINEL
            </CardTitle>
            <CardDescription className="text-[#8896b4] text-sm">
              Centre opérationnel de vidéosurveillance
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pb-8">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
              {ERROR_MESSAGES[error] ?? "La connexion a échoué. Veuillez réessayer."}
            </div>
          )}
          <SignInButton callbackUrl={callbackUrl ?? "/"} />
          <p className="text-center text-xs text-[#8896b4]">
            Connexion réservée aux membres Noxia Groupe
          </p>
        </CardContent>
      </Card>

      <p className="mt-8 text-xs text-[#8896b4]/50">
        © Noxia Groupe — Tous droits réservés
      </p>
    </div>
  );
}
