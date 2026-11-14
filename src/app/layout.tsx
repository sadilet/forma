import type { Metadata } from "next";
import { Geist, Geist_Mono, Outfit } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const formaWordmark = Outfit({
  variable: "--font-forma-wordmark",
  subsets: ["latin"],
  weight: ["600"],
});

export const metadata: Metadata = {
  title: "Forma",
  description: "A collaborative AI workspace for designing software on an infinite canvas.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${formaWordmark.variable} dark h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        {children}
        <Toaster theme="dark" position="bottom-right" />
      </body>
    </html>
  );
}
