import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { CONTRACT_IDS } from "../lib/stellar";

export default function KycPage() {
  const { connected } = useWallet();
  const [lookup, setLookup] = useState("");
  const [approveForm, setApproveForm] = useState({
    subject: "", tier: "0", jurisdiction: "", expiry_days: "365",
  });

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    alert(`Would query is_approved(${lookup}) on ${CONTRACT_IDS.kycRegistry || "<not configured>"}`);
  };

  const handleApprove = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) { alert("Connect wallet first"); return; }
    alert(`Would approve KYC for ${approveForm.subject} at tier ${approveForm.tier}`);
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={styles.h1}>KYC Registry</h1>
      <p style={styles.sub}>
        Manage investor KYC approvals. Only authorized verifiers can approve or
        revoke status. All token transfers are gated by this registry.
      </p>

      <section style={styles.card}>
        <h2 style={styles.h2}>Check KYC Status</h2>
        <form onSubmit={handleLookup} style={{ display: "flex", gap: "0.75rem" }}>
          <input
            placeholder="Stellar address (G...)"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit">Lookup</button>
        </form>
      </section>

      <section style={{ ...styles.card, marginTop: "1.5rem" }}>
        <h2 style={styles.h2}>Approve KYC (verifier only)</h2>
        <form onSubmit={handleApprove}>
          <Field label="Subject Address" value={approveForm.subject} onChange={(e) => setApproveForm(f => ({ ...f, subject: e.target.value }))} required placeholder="G..." />
          <div style={{ marginBottom: "1rem" }}>
            <label style={styles.label}>KYC Tier</label>
            <select value={approveForm.tier} onChange={(e) => setApproveForm(f => ({ ...f, tier: e.target.value }))}>
              <option value="0">0 — Basic</option>
              <option value="1">1 — Accredited Investor</option>
              <option value="2">2 — Institutional</option>
            </select>
          </div>
          <Field label="Jurisdiction" value={approveForm.jurisdiction} onChange={(e) => setApproveForm(f => ({ ...f, jurisdiction: e.target.value }))} required placeholder="US, EU, NG …" />
          <Field label="Validity (days)" type="number" value={approveForm.expiry_days} onChange={(e) => setApproveForm(f => ({ ...f, expiry_days: e.target.value }))} />
          <button type="submit" style={{ marginTop: "0.5rem", width: "100%", background: "var(--color-success)" }}>
            Approve KYC
          </button>
        </form>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, required, placeholder, type = "text" }: {
  label: string; value: string; type?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean; placeholder?: string;
}) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", color: "var(--color-muted)" }}>{label}</label>
      <input type={type} value={value} onChange={onChange} required={required} placeholder={placeholder} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" },
  h2: { fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" },
  sub: { color: "var(--color-muted)", fontSize: "0.875rem", marginBottom: "1.5rem" },
  card: { background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "0.75rem", padding: "1.5rem" },
  label: { display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", color: "var(--color-muted)" },
};
