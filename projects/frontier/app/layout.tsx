import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frontier · A research directory",
  description: "Explore an original fictional research catalog and follow how keyword and semantic search rank its labs.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
