import { Link } from "react-router-dom";

const CARDS = [
  {
    title: "Invoice Tokens",
    description: "Tokenize accounts-receivable invoices. Trade fractional invoice claims on Stellar.",
    href: "/invoices",
    color: "#6366f1",
    icon: "📄",
  },
  {
    title: "Property Shares",
    description: "Fractional real estate ownership with dividend distribution built in.",
    href: "/property",
    color: "#10b981",
    icon: "🏢",
  },
  {
    title: "Carbon Credits",
    description: "Issue and retire verified carbon credits with immutable on-chain receipts.",
    href: "/carbon",
    color: "#f59e0b",
    icon: "🌿",
  },
  {
    title: "KYC Registry",
    description: "Manage investor verification, tiers, and jurisdictions.",
    href: "/kyc",
    color: "#3b82f6",
    icon: "🪪",
  },
];

export default function Dashboard() {
  return (
    <div>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 700 }}>Veritoken</h1>
        <p style={{ color: "var(--color-muted)", marginTop: "0.5rem", maxWidth: 560 }}>
          The plug-and-play RWA tokenization starter kit for Stellar. Launch a
          compliant real-world asset product in days — with KYC, compliance
          rules, and fractional ownership baked in.
        </p>
      </div>
      <div style={styles.grid}>
        {CARDS.map((c) => (
          <Link key={c.href} to={c.href} style={{ textDecoration: "none" }}>
            <div style={styles.card}>
              <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>{c.icon}</div>
              <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: c.color }}>
                {c.title}
              </h2>
              <p style={{ color: "var(--color-muted)", fontSize: "0.875rem", marginTop: "0.5rem" }}>
                {c.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: "1.5rem",
  },
  card: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "0.75rem",
    padding: "1.5rem",
    transition: "border-color 0.15s",
    cursor: "pointer",
  },
};
