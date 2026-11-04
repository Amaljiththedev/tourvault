import type { Metadata } from "next";
import { Suspense } from "react";
import { FullScreenLoader } from "@/components/ui";
import { Geist, Geist_Mono } from "next/font/google";
import StoreProvider from "./StoreProvider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TourVault",
  description: "Manage hospital virtual tours and their 3D assets.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        {/* The Redux store is created per visit (it uses Math.random for its
            internal init action), so it renders at request time, not at build
            time. Suspense lets the static shell show a loader meanwhile. */}
        <Suspense fallback={<FullScreenLoader />}>
          <StoreProvider>{children}</StoreProvider>
        </Suspense>
      </body>
    </html>
  );
}
