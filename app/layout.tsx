import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Voltly — Upload your bill. Compare tariffs.",
  description: "Upload your bill and compare against UK supplier tariffs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
