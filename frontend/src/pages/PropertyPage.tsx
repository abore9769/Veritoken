import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { CONTRACT_IDS } from "../lib/stellar";
import { PageHeader, Card, Field, Select, Icon } from "../components/ui";

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

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement> | React.ChangeEvent<HTMLSelectElement>
  ) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleTokenize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) {
      alert("Connect your wallet first");
      return;
    }
    alert(
      `Property ${form.legal_name} would be tokenized on contract ${
        CONTRACT_IDS.propertyToken || "<not configured>"
      }`
    );
  };

  return (
    <div className="form-narrow">
      <PageHeader
        eyebrow="Asset Module"
        icon={<Icon.property size={22} />}
        title="Property Token"
        description="Fractionalize real estate. Each share equals one unit of ownership, and dividends distribute pro-rata on-chain."
      />
      <Card>
        <form onSubmit={handleTokenize}>
          <Field label="Property ID (internal)" name="property_id" value={form.property_id} onChange={handleChange} required />
          <Field label="Legal Name" name="legal_name" value={form.legal_name} onChange={handleChange} required />
          <Field label="Jurisdiction" name="jurisdiction" value={form.jurisdiction} onChange={handleChange} required />
          <Field label="Physical Address" name="address" value={form.address} onChange={handleChange} required />
          <Field label="Total Valuation (USD)" name="total_valuation_usd" type="number" value={form.total_valuation_usd} onChange={handleChange} required />
          <Field label="Total Shares to Issue" name="total_shares" type="number" value={form.total_shares} onChange={handleChange} required />
          <Select
            label="Property Type"
            name="property_type"
            value={form.property_type}
            onChange={handleChange}
            options={[
              { value: "residential", label: "Residential" },
              { value: "commercial", label: "Commercial" },
              { value: "land", label: "Land" },
            ]}
          />
          <Field label="IPFS Title Hash" name="ipfs_title_hash" value={form.ipfs_title_hash} onChange={handleChange} placeholder="bafyrei…" />
          <Select
            label="Min KYC Tier Required"
            name="kyc_tier_required"
            value={form.kyc_tier_required}
            onChange={handleChange}
            options={[
              { value: "0", label: "0 — Basic" },
              { value: "1", label: "1 — Accredited" },
              { value: "2", label: "2 — Institutional" },
            ]}
          />
          <button type="submit" className="btn-block" style={{ marginTop: "0.75rem" }}>
            Tokenize Property
          </button>
        </form>
      </Card>
    </div>
  );
}
