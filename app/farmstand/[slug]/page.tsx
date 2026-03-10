import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

interface Farmstand {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  description: string | null;
  hero_image_url: string | null;
  image_url: string | null;
  slug: string;
  listing_status: string;
}

async function getFarmstand(slug: string): Promise<Farmstand | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment variables");
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase
    .from("farmstands")
    .select("id, name, city, state, description, hero_image_url, image_url, slug, listing_status")
    .eq("slug", slug)
    .eq("listing_status", "approved")
    .single();

  if (error || !data) {
    return null;
  }

  return data as Farmstand;
}

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const farmstand = await getFarmstand(slug);

  if (!farmstand) {
    return {
      title: "Farmstand Not Found",
    };
  }

  const location = [farmstand.city, farmstand.state].filter(Boolean).join(", ");
  const description = farmstand.description
    ? `${location ? location + " · " : ""}${farmstand.description}`
    : location || "A local farmstand near you.";

  const heroImage = farmstand.hero_image_url || farmstand.image_url;

  const images = heroImage
    ? [
        {
          url: heroImage,
          width: 1200,
          height: 630,
          alt: farmstand.name,
        },
      ]
    : [];

  return {
    title: farmstand.name,
    description,
    openGraph: {
      title: farmstand.name,
      description,
      images,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: farmstand.name,
      description,
      images: heroImage ? [heroImage] : [],
    },
  };
}

export default async function FarmstandPage({ params }: Props) {
  const { slug } = await params;
  const farmstand = await getFarmstand(slug);

  if (!farmstand) {
    notFound();
  }

  const location = [farmstand.city, farmstand.state].filter(Boolean).join(", ");
  const heroImage = farmstand.hero_image_url || farmstand.image_url;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f8f4ef",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* Hero image */}
      {heroImage && (
        <div
          style={{
            width: "100%",
            height: 320,
            position: "relative",
            overflow: "hidden",
            background: "#d4c9b8",
          }}
        >
          <img
            src={heroImage}
            alt={farmstand.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
          {/* Gradient overlay */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.55) 100%)",
            }}
          />
        </div>
      )}

      {/* Content */}
      <div
        style={{
          maxWidth: 600,
          margin: "0 auto",
          padding: "2rem 1.5rem 3rem",
        }}
      >
        {/* Name */}
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: 700,
            color: "#1a2e1a",
            marginBottom: "0.25rem",
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
          }}
        >
          {farmstand.name}
        </h1>

        {/* Location */}
        {location && (
          <p
            style={{
              fontSize: "1rem",
              color: "#4a6741",
              fontWeight: 500,
              marginBottom: "1.25rem",
              display: "flex",
              alignItems: "center",
              gap: "0.35rem",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {location}
          </p>
        )}

        {/* Description */}
        {farmstand.description && (
          <p
            style={{
              fontSize: "1.0625rem",
              color: "#3d3d3d",
              lineHeight: 1.65,
              marginBottom: "2rem",
            }}
          >
            {farmstand.description}
          </p>
        )}

        {/* Divider */}
        <hr
          style={{
            border: "none",
            borderTop: "1px solid #e0d8ce",
            marginBottom: "2rem",
          }}
        />

        {/* CTA */}
        <div style={{ textAlign: "center" }}>
          <p
            style={{
              fontSize: "0.9375rem",
              color: "#6b6b6b",
              marginBottom: "1.25rem",
            }}
          >
            View this farmstand and more in the Farmstand app
          </p>
          <a
            href={`farmstand://farmstand/${farmstand.slug}`}
            style={{
              display: "inline-block",
              background: "#2d5a3d",
              color: "#fff",
              padding: "0.875rem 2.25rem",
              borderRadius: 14,
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "1.0625rem",
              letterSpacing: "-0.01em",
              marginBottom: "1rem",
              boxShadow: "0 2px 12px rgba(45,90,61,0.25)",
            }}
          >
            Open in App
          </a>
          <br />
          <a
            href="https://apps.apple.com/app/farmstand/id6744438430"
            style={{
              fontSize: "0.875rem",
              color: "#4a6741",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            Download the App
          </a>
        </div>
      </div>
    </main>
  );
}
