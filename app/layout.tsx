import type { Metadata } from "next";
import { Lora, Source_Sans_3 } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const headingFont = Lora({
  variable: "--font-heading",
  subsets: ["latin"],
});

const bodyFont = Source_Sans_3({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "IUSS Insight",
  description: "Chat IUSS Pavia basata su fonti ufficiali (PDF e pagine iusspavia.it)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" className={`${headingFont.variable} ${bodyFont.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
