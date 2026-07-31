import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield } from "lucide-react";
import { SignInButton } from "./signin-button";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "Accès refusé. Votre compte Microsoft n'est pas autorisé à accéder à SENTINEL.",
  Configuration: "Configuration du fournisseur d'identité invalide. Contactez l'administrateur.",
  OAuthAccountNotLinked:
    "Cette adresse e-mail est déjà associée à un autre mode de connexion.",
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
      <Card className="w-full max-w-md border-zinc-800 bg-zinc-900">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/10">
            <Shield className="h-8 w-8 text-blue-400" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold tracking-tight text-white">
              SENTINEL
            </CardTitle>
            <CardDescription className="text-zinc-400 mt-2">
              Centre de contrôle des enregistreurs Dahua
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {ERROR_MESSAGES[error] ?? "La connexion a échoué. Veuillez réessayer."}
            </p>
          )}
          <SignInButton callbackUrl={callbackUrl ?? "/"} />
        </CardContent>
      </Card>
    </div>
  );
}
