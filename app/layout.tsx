import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Profile Permission Comparator",
  description:
    "Saltbox S1 — compare Salesforce profile permissions between two orgs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-neutral-950 text-neutral-100 antialiased">
        {children}
      </body>
    </html>
  );
}
