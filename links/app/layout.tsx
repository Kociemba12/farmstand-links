import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Farmstand",
  description: "Discover local farmstands near you",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
