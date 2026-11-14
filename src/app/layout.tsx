import type { Metadata } from "next";
import { Geist, Geist_Mono, Outfit } from "next/font/google";
import { THEME_INIT_SCRIPT, ThemeProvider, ThemedToaster } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-outfit",
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
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${outfit.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full bg-background text-foreground">
        <ThemeProvider>
          {children}
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
