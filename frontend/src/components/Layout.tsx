import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useWallet } from "../lib/wallet";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/invoices", label: "Invoices" },
  { to: "/property", label: "Property" },
  { to: "/carbon", label: "Carbon Credits" },
  { to: "/kyc", label: "KYC" },
  { to: "/admin", label: "Admin" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { address, connected, connect, disconnect } = useWallet();

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <header style={styles.header}>
        <div style={styles.brand}>
          <span style={styles.logo}>VT</span>
          <span style={styles.brandName}>Veritoken</span>
        </div>
        <nav style={styles.nav}>
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              style={{
                ...styles.navLink,
                ...(pathname === n.to ? styles.navLinkActive : {}),
              }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div>
          {connected ? (
            <div style={styles.walletInfo}>
              <span style={styles.address}>
                {address?.slice(0, 6)}…{address?.slice(-4)}
              </span>
              <button onClick={disconnect} style={styles.disconnectBtn}>
                Disconnect
              </button>
            </div>
          ) : (
            <button onClick={connect}>Connect Wallet</button>
          )}
        </div>
      </header>
      <main style={styles.main}>{children}</main>
      <footer style={styles.footer}>
        <span style={{ color: "var(--color-muted)", fontSize: "0.75rem" }}>
          Veritoken RWA Kit · Stellar Testnet
        </span>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: "2rem",
    padding: "1rem 2rem",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-surface)",
  },
  brand: { display: "flex", alignItems: "center", gap: "0.5rem" },
  logo: {
    background: "var(--color-accent)",
    color: "#fff",
    padding: "0.25rem 0.5rem",
    borderRadius: "0.375rem",
    fontWeight: 800,
    fontSize: "0.875rem",
  },
  brandName: { fontWeight: 700, fontSize: "1.125rem" },
  nav: { display: "flex", gap: "1.5rem", flex: 1 },
  navLink: { color: "var(--color-muted)", fontWeight: 500, fontSize: "0.875rem" },
  navLinkActive: { color: "var(--color-text)" },
  walletInfo: { display: "flex", alignItems: "center", gap: "0.75rem" },
  address: {
    fontFamily: "monospace",
    fontSize: "0.75rem",
    background: "var(--color-bg)",
    padding: "0.25rem 0.5rem",
    borderRadius: "0.25rem",
    border: "1px solid var(--color-border)",
  },
  disconnectBtn: {
    background: "transparent",
    border: "1px solid var(--color-border)",
    color: "var(--color-muted)",
    padding: "0.25rem 0.75rem",
    fontSize: "0.75rem",
  },
  main: { flex: 1, padding: "2rem" },
  footer: {
    borderTop: "1px solid var(--color-border)",
    padding: "1rem 2rem",
    textAlign: "center",
  },
};
