import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { CONTRACT_IDS } from "../lib/stellar";

export default function PropertyPage() {
  const { connected } = useWallet();
  const [form, setForm] = useState({
    property_id: "",
    legal_name: "",
    jurisdiction: "",
    address: "",
    total_valuation_usd: "",
    total_shares: "1000000",
    property_type: "residential",
    ipfs_title_hash: "",
    kyc_tier_required: "1",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleTokenize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) { alert("Connect your wallet first"); return; }
    alert(`Property ${form.legal_name} would be tokenized on contract ${CONTRACT_IDS.propertyToken || "<not configured>"}`);
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={styles.h1}>Property Token</h1>
      <p style={styles.sub}>
        Fractionalize real estate. Each share = 1 unit of ownership. Dividends
        distribute pro-rata automatically on-chain.
      </p>
      <form onSubmit={handleTokenize} style={styles.form}>
        <Field label="Property ID (internal)" name="property_id" value={form.property_id} onChange={handleChange} required />
        <Field label="Legal Name" name="legal_name" value={form.legal_name} onChange={handleChange} required />
        <Field label="Jurisdiction" name="jurisdiction" value={form.jurisdiction} onChange={handleChange} required />
        <Field label="Physical Address" name="address" value={form.address} onChange={handleChange} required />
        <Field label="Total Valuation (USD)" name="total_valuation_usd" type="number" value={form.total_valuation_usd} onChange={handleChange} required />
        <Field label="Total Shares to Issue" name="total_shares" type="number" value={form.total_shares} onChange={handleChange} required />
        <div style={{ marginBottom: "1rem" }}>
          <label style={styles.label}>Property Type</label>
          <select name="property_type" value={form.property_type} onChange={handleChange}>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
            <option value="land">Land</option>
          </select>
        </div>
        <Field label="IPFS Title Hash" name="ipfs_title_hash" value={form.ipfs_title_hash} onChange={handleChange} placeholder="bafyrei..." />
        <div style={{ marginBottom: "1rem" }}>
          <label style={styles.label}>Min KYC Tier Required</label>
          <select name="kyc_tier_required" value={form.kyc_tier_required} onChange={handleChange}>
            <option value="0">0 — Basic</option>
            <option value="1">1 — Accredited</option>
            <option value="2">2 — Institutional</option>
          </select>
        </div>
        <button type="submit" style={{ marginTop: "1rem", width: "100%" }}>
          Tokenize Property
        </button>
      </form>
    </div>
  );
}

function Field({ label, name, type = "text", value, onChange, required, placeholder }: {
  label: string; name: string; type?: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean; placeholder?: string;
}) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", color: "var(--color-muted)" }}>{label}</label>
      <input name={name} type={type} value={value} onChange={onChange} required={required} placeholder={placeholder} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" },
  sub: { color: "var(--color-muted)", fontSize: "0.875rem", marginBottom: "1.5rem" },
  form: { background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "0.75rem", padding: "1.5rem" },
  label: { display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", color: "var(--color-muted)" },
};
