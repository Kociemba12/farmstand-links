# Farmstand Links (Next.js)

This is a standalone Next.js 15 app that lives in `/links` inside the monorepo. It powers share links and universal links for the Farmstand mobile app.

## Purpose

- Serves `https://links.farmstand.online/farmstand/[slug]` pages with Open Graph metadata for link previews
- Hosts `/.well-known/apple-app-site-association` for iOS universal links
- Deployed independently to Vercel

## Structure

```
links/
├── app/
│   ├── layout.tsx                    # Root layout
│   ├── page.tsx                      # Home page (download CTA)
│   └── farmstand/[slug]/page.tsx     # Farmstand share page (OG metadata + fallback UI)
├── public/
│   └── .well-known/
│       └── apple-app-site-association
├── next.config.mjs
├── package.json
├── tsconfig.json
└── vercel.json                       # Headers for AASA content-type
```

## Environment Variables (set in Vercel dashboard)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) |

## Deploying

1. Create a new Vercel project pointed at this repo
2. Set the **Root Directory** to `links`
3. Add the two env vars above
4. Assign the custom domain `links.farmstand.online`

## Share Link Format

```
https://links.farmstand.online/farmstand/ek-farms
```

The page fetches the farmstand by `slug` from Supabase and returns:
- `og:title` — farmstand name
- `og:description` — city, state + description
- `og:image` — cover photo
- `twitter:card` — `summary_large_image`
- Fallback webpage with photo, name, location, description, and deep-link CTA
