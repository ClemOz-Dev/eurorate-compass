import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "French Mortgage Compass",
  description: "French mortgage-rate outlook with macroeconomic signal tracking.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}

