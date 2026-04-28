import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const FALLBACK_OG_IMAGE = "https://links.farmstand.online/farmstand-icon.png";

interface Farmstand {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  short_description: string | null;
  description: string | null;
  photos: string[] | null;
  main_photo_index: number | null;
  hero_photo_url: string | null;
  hero_image_url: string | null;
  image_url: string | null;
  slug: string;
  status: string | null;
}

/** Resolve the best available image URL for og:image / page hero. */
function resolveDisplayImage(farmstand: Farmstand): string | null {
  // 1. photos[main_photo_index] → photos[0]
  if (farmstand.photos && farmstand.photos.length > 0) {
    const idx = farmstand.main_photo_index ?? 0;
    const photo = farmstand.photos[idx] ?? farmstand.photos[0];
    if (photo && photo.startsWith("http")) return photo;
  }
  // 2. hero_photo_url
  if (farmstand.hero_photo_url?.startsWith("http")) return farmstand.hero_photo_url;
  // 3. hero_image_url
  if (farmstand.hero_image_url?.startsWith("http")) return farmstand.hero_image_url;
  // 4. image_url
  if (farmstand.image_url?.startsWith("http")) return farmstand.image_url;
  return null;
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
    .select(
      "id, name, city, state, short_description, description, photos, main_photo_index, hero_photo_url, hero_image_url, image_url, slug, status"
    )
    .eq("slug", slug)
    .neq("status", "deleted")
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
  const blurb = farmstand.short_description || farmstand.description || null;
  const description = blurb
    ? `${location ? location + " · " : ""}${blurb}`
    : location || "A local farmstand near you.";

  const displayImage = resolveDisplayImage(farmstand);
  const ogImageUrl = displayImage ?? FALLBACK_OG_IMAGE;

  return {
    title: farmstand.name,
    description,
    openGraph: {
      title: farmstand.name,
      description,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: farmstand.name,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: farmstand.name,
      description,
      images: [ogImageUrl],
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
  const heroImage = resolveDisplayImage(farmstand);
  const displayDescription = farmstand.short_description || farmstand.description;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f8f4ef",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
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
          <Image
            src={heroImage}
            alt={farmstand.name}
            fill
            style={{
              objectFit: "cover",
            }}
          />
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

      <div
        style={{
          maxWidth: 600,
          margin: "0 auto",
          padding: "2rem 1.5rem 3rem",
        }}
      >
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

        {displayDescription && (
          <p
            style={{
              fontSize: "1.0625rem",
              color: "#3d3d3d",
              lineHeight: 1.65,
              marginBottom: "2rem",
            }}
          >
            {displayDescription}
          </p>
        )}

        <hr
          style={{
            border: "none",
            borderTop: "1px solid #e0d8ce",
            marginBottom: "2rem",
          }}
        />

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
