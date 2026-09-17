import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import "./brand.css";
import "./module.css";
import "./documents.css";
import "./products.css";
import "./orders.css";
import "./logistics.css";
import "./route-overrides.css";
import "./management.css";
import "./logistics-enhancements.css";
import "./crm-enhancements.css";
import "./fleet-logistics.css";
import "./management-details.css";
import "./fleet.css";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://quimicativa.vercel.app"),
  title: "Quimicativa | Gestão Integrada",
  description: "Central executiva para gestão de pessoas, operações, vendas e finanças da Quimicativa.",
  openGraph: {
    title: "Quimicativa | Gestão Integrada",
    description: "Gestão integrada, decisões mais inteligentes.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Quimicativa — Gestão integrada" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Quimicativa | Gestão Integrada",
    description: "Gestão integrada, decisões mais inteligentes.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/brand/quimicativa-logo.png",
    shortcut: "/brand/quimicativa-logo.png",
    apple: "/brand/quimicativa-logo.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className={manrope.variable}>{children}</body></html>;
}
