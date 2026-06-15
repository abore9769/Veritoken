import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { PageHeader, Card, Field, Icon } from "../components/ui";

export default function AdminPage() {
  const { connected } = useWallet();
  const [rules, setRules] = useState({
    max_transfer_amount: "0",
    min_holding_period: "0",
    max_holders: "0",
    require_same_jurisdiction: false,
    paused: false,
  });

  const handleSaveRules = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) return alert("Connect wallet first");
    alert("Would call set_rules() on compliance engine");
  };

  return (
    <div className="form-narrow">
      <PageHeader
        eyebrow="Governance"
        icon={<Icon.admin size={22} />}
        title="Admin Panel"
        description="Configure global compliance rules. Only the contract admin can call these functions."
      />

      <Card title="Compliance Rules">
        <form onSubmit={handleSaveRules}>
          <Field
            label="Max Transfer Amount (0 = unlimited, in stroops)"
            type="number"
            value={rules.max_transfer_amount}
            onChange={(e) => setRules((r) => ({ ...r, max_transfer_amount: e.target.value }))}
          />
          <Field
            label="Min Holding Period (seconds, 0 = none)"
            type="number"
            value={rules.min_holding_period}
            onChange={(e) => setRules((r) => ({ ...r, min_holding_period: e.target.value }))}
          />
          <Field
            label="Max Holders (0 = unlimited)"
            type="number"
            value={rules.max_holders}
            onChange={(e) => setRules((r) => ({ ...r, max_holders: e.target.value }))}
          />
          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={rules.require_same_jurisdiction}
              onChange={(e) => setRules((r) => ({ ...r, require_same_jurisdiction: e.target.checked }))}
            />
            <span style={{ fontSize: "0.875rem", color: "var(--text)" }}>
              Require same jurisdiction for transfers
            </span>
          </label>
          <button type="submit" className="btn-block">
            Save Rules
          </button>
        </form>
      </Card>

      <Card title="Emergency Controls" subtitle="Pause halts every transfer across all asset tokens" style={{ marginTop: "1.25rem" }}>
        <div style={{ display: "flex", gap: "1rem" }}>
          <button
            onClick={() => alert("Would call pause() on compliance engine")}
            className="btn-danger"
            style={{ flex: 1 }}
          >
            <Icon.bolt size={15} style={{ display: "inline", verticalAlign: "-2px", marginRight: 6 }} />
            Pause All Transfers
          </button>
          <button
            onClick={() => alert("Would call unpause() on compliance engine")}
            className="btn-success"
            style={{ flex: 1 }}
          >
            Unpause Transfers
          </button>
        </div>
      </Card>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    margin: "0.25rem 0 1.1rem",
    cursor: "pointer",
  },
};
