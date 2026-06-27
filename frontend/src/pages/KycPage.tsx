import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { CONTRACT_IDS } from "../lib/stellar";
import { PageHeader, Card, Field, Select, Icon } from "../components/ui";
import { AddressInput } from "../components/AddressInput";
import { useAddressBook } from "../lib/addressBook";

export default function KycPage() {
  const { connected } = useWallet();
  const { addEntry } = useAddressBook();
  const [lookup, setLookup] = useState("");
  const [showAddressBookModal, setShowAddressBookModal] = useState(false);
  const [addressBookLabel, setAddressBookLabel] = useState("");
  const [pendingAddress, setPendingAddress] = useState("");
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

  const handleAddToAddressBook = (address: string) => {
    setPendingAddress(address);
    setAddressBookLabel("");
    setShowAddressBookModal(true);
  };

  const confirmAddToAddressBook = () => {
    if (addressBookLabel.trim()) {
      addEntry(pendingAddress, addressBookLabel);
      setApproveForm((f) => ({ ...f, subject: pendingAddress }));
      setShowAddressBookModal(false);
      setAddressBookLabel("");
      setPendingAddress("");
    }
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
          <AddressInput
            label="Subject Address"
            value={approveForm.subject}
            onChange={(value) => setApproveForm((f) => ({ ...f, subject: value }))}
            required
            placeholder="G…"
            onAddToBook={handleAddToAddressBook}
          />
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

      {showAddressBookModal && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <h3 style={{ marginBottom: "1rem" }}>Add to Address Book</h3>
            <input
              type="text"
              placeholder="Label (e.g., 'Alice - Investor')"
              value={addressBookLabel}
              onChange={(e) => setAddressBookLabel(e.target.value)}
              style={{ width: "100%", marginBottom: "1rem" }}
            />
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                onClick={() => setShowAddressBookModal(false)}
                className="btn-ghost"
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                onClick={confirmAddToAddressBook}
                className="btn-success"
                style={{ flex: 1 }}
                disabled={!addressBookLabel.trim()}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "1.5rem",
  maxWidth: 400,
  width: "90%",
};
