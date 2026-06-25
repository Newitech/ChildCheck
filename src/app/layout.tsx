import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ServiceWorkerRegister } from "@/components/domain/service-worker-register";
import { RuntimeTheme } from "@/components/domain/runtime-theme";
import { Providers } from "@/components/providers";
import { getOrgConfig } from "@/lib/branding";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const config = await getOrgConfig();
  const appName = config.branding.appName;
  return {
    title: { default: `${appName} — ${config.branding.tagline}`, template: `%s · ${appName}` },
    description: `Self-hosted secure child check-in / check-out system for churches, clubs, schools and childcare.`,
    manifest: "/manifest.webmanifest",
    applicationName: appName,
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: appName,
    },
    icons: {
      icon: [
        { url: "/icon-192.svg", type: "image/svg+xml" },
        { url: "/icon-512.svg", type: "image/svg+xml" },
      ],
      apple: [{ url: "/icon-192.svg" }],
    },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  themeColor: "#0f9d8a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // kiosk-friendly
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>
          <RuntimeTheme />
          {children}
          <Toaster />
          <SonnerToaster position="top-center" richColors closeButton />
          <ServiceWorkerRegister />
        </Providers>
      </body>
    </html>
  );
}
