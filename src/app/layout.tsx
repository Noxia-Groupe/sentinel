import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "SENTINEL — Centre de contrôle NVR",
  description: "Centre opérationnel de gestion des enregistreurs Dahua — Noxia Groupe",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${montserrat.variable} h-full antialiased dark`}
    >
      <body className="min-h-full bg-[#000726] flex flex-col">
        {children}
        <Toaster
          theme="dark"
          position="top-right"
          toastOptions={{
            style: {
              background: "#0d1537",
              border: "1px solid rgba(177,185,192,0.15)",
              color: "#dde1e4",
            },
          }}
        />
      </body>
    </html>
  );
}
