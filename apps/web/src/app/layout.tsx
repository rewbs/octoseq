import type { Metadata } from "next";
import {
  ClerkProvider,
} from '@clerk/nextjs';
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AutosaveProvider } from "@/components/project";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Octoseq",
  description: "Audio analysis and music information retrieval",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} >
          <ThemeProvider>
            <AutosaveProvider>{children}</AutosaveProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
