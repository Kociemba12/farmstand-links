import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://links.farmstand.online"),
  title: "Farmstand",
  description: "Discover local farmstands near you",

  icons: {
    icon: "/farmstand-icon.png",
    apple: "/farmstand-icon.png",
  },

  openGraph: {
    title: "Farmstand",
    description: "Discover local farmstands near you",
    url: "https://links.farmstand.online",
    siteName: "Farmstand",
    images: [
      {
        url: "/farmstand-icon.png",
        width: 1200,
        height: 630,
      },
    ],
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    images: ["/farmstand-icon.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/farmstand-icon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/farmstand-icon.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}