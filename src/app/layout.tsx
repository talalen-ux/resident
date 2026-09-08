import type { Metadata } from "next";

import { SITE_URL } from "@/lib/site";
import { Chivo, Chivo_Mono, Roboto_Mono } from "next/font/google";
import "./globals.css";

const chivo = Chivo({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-chivo",
});

const chivoMono = Chivo_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-chivo-mono",
});

const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-roboto-mono",
});

const DESCRIPTION =
  "A liquidity protocol for tokenized equities on Robinhood Chain. Trading fees on $RES capitalize the protocol's concentrated liquidity positions; 15% of realized profit is distributed to holders every 15 minutes.";

export const metadata: Metadata = {
  // Without metadataBase, every relative OG URL resolves against localhost and
  // the share card silently breaks in production.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Resident — A liquidity protocol for tokenized equities",
    template: "%s — Resident",
  },
  description: DESCRIPTION,
  applicationName: "Resident",
  openGraph: {
    type: "website",
    siteName: "Resident",
    title: "Resident — A liquidity protocol for tokenized equities",
    description: DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Resident — A liquidity protocol for tokenized equities",
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The font variables must live on <html>: globals.css derives --font-sans
    // from --font-chivo in an @theme block that lands on :root, and that
    // substitution fails if the variable is only defined further down the tree.
    <html
      lang="en"
      className={`${chivo.variable} ${chivoMono.variable} ${robotoMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
