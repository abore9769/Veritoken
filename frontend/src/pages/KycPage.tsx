import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { CONTRACT_IDS } from "../lib/stellar";
import { PageHeader, Card, Field, Select, Icon } from "../components/ui";

export default function KycPage() {
  const { connected } = useWallet();
  const [lookup, setLookup] = useState("");
  const [approveForm, setApproveForm] = useState({
    subject: "",
    tier: "0",
    jurisdiction: "",
    expiry_days: "365",
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setApproveForm((f) => ({ ...f, [k]: e.target.value }));

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    alert(`Would query is_approved(${lookup}) on ${CONTRACT_IDS.kycRegistry || "<not configured>"}`);
  };

  const handleApprove = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) return alert("Connect wallet first");
    alert(`Would approve KYC for ${approveForm.subject} at tier ${approveForm.tier}`);
  };

  return (
    <div className="form-narrow">
      <PageHeader
        eyebrow="Compliance"
        icon={<Icon.kyc size={22} />}
        title="KYC Registry"
        description="Manage investor KYC approvals. Only authorized verifiers can approve or revoke status — every token transfer is gated by this registry."
      />

      <Card title="Check KYC Status">
        <form onSubmit={handleLookup} style={{ display: "flex", gap: "0.75rem" }}>
          <input
            placeholder="Stellar address (G…)"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit">Lookup</button>
        </form>
      </Card>

      <Card title="Approve KYC" subtitle="Verifier only" style={{ marginTop: "1.25rem" }}>
        <form onSubmit={handleApprove}>
          <Field label="Subject Address" value={approveForm.subject} onChange={set("subject")} required placeholder="G…" />
          <Select
            label="KYC Tier"
            value={approveForm.tier}
            onChange={set("tier")}
            options={[
              { value: "0", label: "0 — Basic" },
              { value: "1", label: "1 — Accredited Investor" },
              { value: "2", label: "2 — Institutional" },
            ]}
          />
          <Field label="Jurisdiction" value={approveForm.jurisdiction} onChange={set("jurisdiction")} required placeholder="US, EU, NG …" />
          <Field label="Validity (days)" type="number" value={approveForm.expiry_days} onChange={set("expiry_days")} />
          <button type="submit" className="btn-success btn-block" style={{ marginTop: "0.5rem" }}>
            Approve KYC
          </button>
        </form>
      </Card>
    </div>
  );
}
