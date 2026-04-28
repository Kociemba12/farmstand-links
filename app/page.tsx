export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#f8f7f2",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 600,
          textAlign: "center",
          background: "#ffffff",
          borderRadius: 20,
          padding: 32,
          boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
        }}
      >
        <h1 style={{ marginTop: 0 }}>Farmstand</h1>
        <p>Discover local farmstands, fresh food, flowers, eggs, and more.</p>
      </div>
    </main>
  );
}
