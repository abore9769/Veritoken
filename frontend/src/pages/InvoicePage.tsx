import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { CONTRACT_IDS } from "../lib/stellar";
import { PageHeader, Card, Field, Icon } from "../components/ui";

export default function InvoicePage() {
  const { connected } = useWallet();
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) {
      alert("Connect your wallet first");
      return;
    }
    alert(
      `Invoice ${form.invoice_id} would be tokenized on contract ${
        CONTRACT_IDS.invoiceToken || "<not configured>"
      }`
    );
  };

  return (
    <div className="form-narrow">
      <PageHeader
        eyebrow="Asset Module"
        icon={<Icon.invoice size={22} />}
        title="Invoice Token"
        description="Tokenize an accounts-receivable invoice. Each token unit represents one stroop (10⁻⁷ USD) of face value."
      />
      <Card>
        <form onSubmit={handleIssue}>
          <Field label="Invoice ID" name="invoice_id" value={form.invoice_id} onChange={handleChange} required />
          <Field label="Issuer (company name)" name="issuer" value={form.issuer} onChange={handleChange} required />
          <Field label="Debtor (buyer name)" name="debtor" value={form.debtor} onChange={handleChange} required />
          <Field label="Face Value (USD)" name="face_value_usd" type="number" value={form.face_value_usd} onChange={handleChange} required />
          <Field label="Discount Rate (bps)" name="discount_rate_bps" type="number" value={form.discount_rate_bps} onChange={handleChange} />
          <Field label="Due Date" name="due_date" type="date" value={form.due_date} onChange={handleChange} required />
          <Field label="Currency" name="currency" value={form.currency} onChange={handleChange} />
          <Field label="IPFS Document Hash" name="ipfs_doc_hash" value={form.ipfs_doc_hash} onChange={handleChange} placeholder="bafyrei…" />
          <button type="submit" className="btn-block" style={{ marginTop: "0.75rem" }}>
            Tokenize Invoice
          </button>
        </form>
      </Card>
    </div>
  );
}
