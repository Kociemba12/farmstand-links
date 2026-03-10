export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8f4ef",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <img
        src="/farmstand-logo.png"
        alt="Farmstand"
        style={{ width: 72, height: 72, marginBottom: "1.5rem", borderRadius: 16 }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      <h1
        style={{
          fontSize: "2rem",
          fontWeight: 700,
          color: "#1a2e1a",
          marginBottom: "0.75rem",
          letterSpacing: "-0.02em",
        }}
      >
        Farmstand
      </h1>
      <p
        style={{
          fontSize: "1.125rem",
          color: "#4a6741",
          maxWidth: 400,
          lineHeight: 1.6,
          marginBottom: "2rem",
        }}
      >
        Discover fresh, local produce at farmstands near you.
      </p>
      <a
        href="https://apps.apple.com/app/farmstand/id6744438430"
        style={{
          display: "inline-block",
          background: "#2d5a3d",
          color: "#fff",
          padding: "0.875rem 2rem",
          borderRadius: 12,
          textDecoration: "none",
          fontWeight: 600,
          fontSize: "1rem",
          letterSpacing: "-0.01em",
        }}
      >
        Download the App
      </a>
    </main>
  );
}
