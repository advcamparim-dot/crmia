import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Painel Executivo — Camparim Advogados",
  description: "Painel executivo interno — Camparim Advogados",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
