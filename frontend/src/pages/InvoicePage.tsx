import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { CONTRACT_IDS } from "../lib/stellar";

export default function InvoicePage() {
  const { connected, address } = useWallet();
  const [form, setForm] = useState({
    invoice_id: "",
    issuer: "",
    debtor: "",
    face_value_usd: "",
    discount_rate_bps: "0",
    due_date: "",
    currency: "USD",
    ipfs_doc_hash: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) { alert("Connect your wallet first"); return; }
    // TODO: build + send transaction via simulateAndSend
    alert(`Invoice ${form.invoice_id} would be tokenized on contract ${CONTRACT_IDS.invoiceToken || "<not configured>"}`);
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={styles.h1}>Invoice Token</h1>
      <p style={styles.sub}>
        Tokenize an accounts-receivable invoice. Each token unit represents
        1 stroops (10<sup>-7</sup> USD) of face value.
      </p>
      <form onSubmit={handleIssue} style={styles.form}>
        <Field label="Invoice ID" name="invoice_id" value={form.invoice_id} onChange={handleChange} required />
        <Field label="Issuer (company name)" name="issuer" value={form.issuer} onChange={handleChange} required />
        <Field label="Debtor (buyer name)" name="debtor" value={form.debtor} onChange={handleChange} required />
        <Field label="Face Value (USD)" name="face_value_usd" type="number" value={form.face_value_usd} onChange={handleChange} required />
        <Field label="Discount Rate (bps)" name="discount_rate_bps" type="number" value={form.discount_rate_bps} onChange={handleChange} />
        <Field label="Due Date" name="due_date" type="date" value={form.due_date} onChange={handleChange} required />
        <Field label="Currency" name="currency" value={form.currency} onChange={handleChange} />
        <Field label="IPFS Document Hash" name="ipfs_doc_hash" value={form.ipfs_doc_hash} onChange={handleChange} placeholder="bafyrei..." />
        <button type="submit" style={{ marginTop: "1rem", width: "100%" }}>
          Tokenize Invoice
        </button>
      </form>
    </div>
  );
}

function Field({
  label, name, type = "text", value, onChange, required, placeholder,
}: {
  label: string; name: string; type?: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean; placeholder?: string;
}) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", color: "var(--color-muted)" }}>
        {label}
      </label>
      <input name={name} type={type} value={value} onChange={onChange} required={required} placeholder={placeholder} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" },
  sub: { color: "var(--color-muted)", fontSize: "0.875rem", marginBottom: "1.5rem" },
  form: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "0.75rem",
    padding: "1.5rem",
  },
};
