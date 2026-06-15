import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { CONTRACT_IDS } from "../lib/stellar";
import { PageHeader, Card, Field, Select, Icon } from "../components/ui";

export default function CarbonPage() {
  const { connected } = useWallet();
  const [tab, setTab] = useState<"issue" | "retire">("issue");

  const [issueForm, setIssueForm] = useState({
    project_id: "",
    standard: "VCS",
    vintage_year: "2024",
    project_name: "",
    project_type: "forestry",
    country: "",
    verifier: "",
    ipfs_cert_hash: "",
    amount: "",
  });

  const [retireForm, setRetireForm] = useState({ amount: "", beneficiary: "", reason: "" });

  const issue = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setIssueForm((f) => ({ ...f, [k]: e.target.value }));
  const retire = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setRetireForm((f) => ({ ...f, [k]: e.target.value }));

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) return alert("Connect wallet first");
    alert(`Would mint ${issueForm.amount} carbon credits on ${CONTRACT_IDS.carbonToken || "<not configured>"}`);
  };

  const handleRetire = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) return alert("Connect wallet first");
    alert(`Would retire ${retireForm.amount} credits for "${retireForm.beneficiary}"`);
  };

  return (
    <div className="form-narrow">
      <PageHeader
        eyebrow="Asset Module"
        icon={<Icon.carbon size={22} />}
        title="Carbon Credit Token"
        description="Issue verified carbon credits (1 token = 1 tonne CO₂e) and retire them with permanent on-chain receipts."
      />

      <div style={styles.tabs}>
        <button
          onClick={() => setTab("issue")}
          className={tab === "issue" ? "" : "btn-ghost"}
          style={styles.tab}
        >
          Issue Credits
        </button>
        <button
          onClick={() => setTab("retire")}
          className={tab === "retire" ? "" : "btn-ghost"}
          style={styles.tab}
        >
          Retire Credits
        </button>
      </div>

      {tab === "issue" ? (
        <Card>
          <form onSubmit={handleIssue}>
            <Field label="Project ID" value={issueForm.project_id} onChange={issue("project_id")} required />
            <Select
              label="Standard"
              value={issueForm.standard}
              onChange={issue("standard")}
              options={["VCS", "Gold Standard", "CDM", "ACR"].map((s) => ({ value: s, label: s }))}
            />
            <Field label="Vintage Year" type="number" value={issueForm.vintage_year} onChange={issue("vintage_year")} required />
            <Field label="Project Name" value={issueForm.project_name} onChange={issue("project_name")} required />
            <Select
              label="Project Type"
              value={issueForm.project_type}
              onChange={issue("project_type")}
              options={[
                { value: "forestry", label: "Forestry" },
                { value: "renewable", label: "Renewable Energy" },
                { value: "methane_capture", label: "Methane Capture" },
              ]}
            />
            <Field label="Country" value={issueForm.country} onChange={issue("country")} required />
            <Field label="Verifier" value={issueForm.verifier} onChange={issue("verifier")} required />
            <Field label="IPFS Certificate Hash" value={issueForm.ipfs_cert_hash} onChange={issue("ipfs_cert_hash")} placeholder="bafyrei…" />
            <Field label="Credits to Mint (tonnes CO₂e)" type="number" value={issueForm.amount} onChange={issue("amount")} required />
            <button type="submit" className="btn-block" style={{ marginTop: "0.75rem" }}>
              Issue Carbon Credits
            </button>
          </form>
        </Card>
      ) : (
        <Card>
          <form onSubmit={handleRetire}>
            <Field label="Amount to Retire (tonnes CO₂e)" type="number" value={retireForm.amount} onChange={retire("amount")} required />
            <Field label="Beneficiary Name" value={retireForm.beneficiary} onChange={retire("beneficiary")} placeholder="Acme Corp 2024 offset" />
            <Field label="Retirement Reason" value={retireForm.reason} onChange={retire("reason")} placeholder="Annual Scope 1 offset" />
            <p className="muted" style={{ fontSize: "0.78rem", margin: "0.25rem 0 0.9rem" }}>
              Retirement is permanent — credits are burned and cannot be re-issued.
            </p>
            <button type="submit" className="btn-success btn-block">
              Retire Credits (Permanent)
            </button>
          </form>
        </Card>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  tabs: {
    display: "inline-flex",
    gap: "0.35rem",
    padding: "0.3rem",
    marginBottom: "1.5rem",
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: 12,
  },
  tab: { boxShadow: "none" },
};
