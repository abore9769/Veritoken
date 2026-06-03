import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { CONTRACT_IDS } from "../lib/stellar";

export default function CarbonPage() {
  const { connected } = useWallet();
  const [tab, setTab] = useState<"issue" | "retire">("issue");

  const [issueForm, setIssueForm] = useState({
    project_id: "", standard: "VCS", vintage_year: "2024",
    project_name: "", project_type: "forestry", country: "",
    verifier: "", ipfs_cert_hash: "", amount: "",
  });

  const [retireForm, setRetireForm] = useState({
    amount: "", beneficiary: "", reason: "",
  });

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) { alert("Connect wallet first"); return; }
    alert(`Would mint ${issueForm.amount} carbon credits on ${CONTRACT_IDS.carbonToken || "<not configured>"}`);
  };

  const handleRetire = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) { alert("Connect wallet first"); return; }
    alert(`Would retire ${retireForm.amount} credits for "${retireForm.beneficiary}"`);
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={styles.h1}>Carbon Credit Token</h1>
      <p style={styles.sub}>
        Issue verified carbon credits (1 token = 1 tonne CO₂e) and retire them
        with permanent on-chain receipts.
      </p>
      <div style={styles.tabs}>
        <button onClick={() => setTab("issue")} style={tab === "issue" ? styles.tabActive : styles.tab}>Issue Credits</button>
        <button onClick={() => setTab("retire")} style={tab === "retire" ? styles.tabActive : styles.tab}>Retire Credits</button>
      </div>
      {tab === "issue" && (
        <form onSubmit={handleIssue} style={styles.form}>
          <Field label="Project ID" name="project_id" value={issueForm.project_id} onChange={(e) => setIssueForm(f => ({ ...f, project_id: e.target.value }))} required />
          <div style={{ marginBottom: "1rem" }}>
            <label style={styles.label}>Standard</label>
            <select value={issueForm.standard} onChange={(e) => setIssueForm(f => ({ ...f, standard: e.target.value }))}>
              <option>VCS</option>
              <option>Gold Standard</option>
              <option>CDM</option>
              <option>ACR</option>
            </select>
          </div>
          <Field label="Vintage Year" name="vintage_year" type="number" value={issueForm.vintage_year} onChange={(e) => setIssueForm(f => ({ ...f, vintage_year: e.target.value }))} required />
          <Field label="Project Name" name="project_name" value={issueForm.project_name} onChange={(e) => setIssueForm(f => ({ ...f, project_name: e.target.value }))} required />
          <div style={{ marginBottom: "1rem" }}>
            <label style={styles.label}>Project Type</label>
            <select value={issueForm.project_type} onChange={(e) => setIssueForm(f => ({ ...f, project_type: e.target.value }))}>
              <option value="forestry">Forestry</option>
              <option value="renewable">Renewable Energy</option>
              <option value="methane_capture">Methane Capture</option>
            </select>
          </div>
          <Field label="Country" name="country" value={issueForm.country} onChange={(e) => setIssueForm(f => ({ ...f, country: e.target.value }))} required />
          <Field label="Verifier" name="verifier" value={issueForm.verifier} onChange={(e) => setIssueForm(f => ({ ...f, verifier: e.target.value }))} required />
          <Field label="IPFS Certificate Hash" name="ipfs_cert_hash" value={issueForm.ipfs_cert_hash} onChange={(e) => setIssueForm(f => ({ ...f, ipfs_cert_hash: e.target.value }))} placeholder="bafyrei..." />
          <Field label="Credits to Mint (tonnes CO₂e)" name="amount" type="number" value={issueForm.amount} onChange={(e) => setIssueForm(f => ({ ...f, amount: e.target.value }))} required />
          <button type="submit" style={{ marginTop: "1rem", width: "100%" }}>Issue Carbon Credits</button>
        </form>
      )}
      {tab === "retire" && (
        <form onSubmit={handleRetire} style={styles.form}>
          <Field label="Amount to Retire (tonnes CO₂e)" name="amount" type="number" value={retireForm.amount} onChange={(e) => setRetireForm(f => ({ ...f, amount: e.target.value }))} required />
          <Field label="Beneficiary Name" name="beneficiary" value={retireForm.beneficiary} onChange={(e) => setRetireForm(f => ({ ...f, beneficiary: e.target.value }))} placeholder="Acme Corp 2024 offset" />
          <Field label="Retirement Reason" name="reason" value={retireForm.reason} onChange={(e) => setRetireForm(f => ({ ...f, reason: e.target.value }))} placeholder="Annual Scope 1 offset" />
          <button type="submit" style={{ marginTop: "1rem", width: "100%", background: "var(--color-success)" }}>
            Retire Credits (Permanent)
          </button>
        </form>
      )}
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
  tabs: { display: "flex", gap: "0.5rem", marginBottom: "1.5rem" },
  tab: { background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" },
  tabActive: { background: "var(--color-accent)" },
  form: { background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "0.75rem", padding: "1.5rem" },
  label: { display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", color: "var(--color-muted)" },
};
