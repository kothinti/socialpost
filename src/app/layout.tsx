import type { Metadata } from "next";
import { IBM_Plex_Mono, Montserrat, Radley } from "next/font/google";
import "./globals.css";

// Monfort brand fonts (monfortcompanies.com): Montserrat for UI/headings, Radley for serif copy.
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
});

const radley = Radley({
  variable: "--font-radley",
  subsets: ["latin"],
  weight: "400",
});

const ibm = IBM_Plex_Mono({
  variable: "--font-ibm",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "MonfortSocial",
  description: "Write and schedule posts, quote what you're reading, and answer mentions on X",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${radley.variable} ${ibm.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
