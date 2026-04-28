"use client";

import { useEffect } from "react";

interface AutoOpenAppProps {
  slug: string;
}

export default function AutoOpenApp({ slug }: AutoOpenAppProps) {
  useEffect(() => {
    const url = `https://links.farmstand.online/farmstand/${slug}`;

    const timer = setTimeout(() => {
      window.location.href = url;
    }, 100);

    return () => clearTimeout(timer);
  }, [slug]);

  return null;
}
