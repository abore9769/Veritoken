import { useState } from "react";
import { useWallet } from "../lib/wallet";

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
    if (!connected) { alert("Connect wallet first"); return; }
    alert("Would call set_rules() on compliance engine");
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={styles.h1}>Admin Panel</h1>
      <p style={styles.sub}>
        Configure global compliance rules. Only the contract admin can call
        these functions.
      </p>

      <section style={styles.card}>
        <h2 style={styles.h2}>Compliance Rules</h2>
        <form onSubmit={handleSaveRules}>
          <Field
            label="Max Transfer Amount (0 = unlimited, in stroops)"
            type="number"
            value={rules.max_transfer_amount}
            onChange={(e) => setRules(r => ({ ...r, max_transfer_amount: e.target.value }))}
          />
          <Field
            label="Min Holding Period (seconds, 0 = none)"
            type="number"
            value={rules.min_holding_period}
            onChange={(e) => setRules(r => ({ ...r, min_holding_period: e.target.value }))}
          />
          <Field
            label="Max Holders (0 = unlimited)"
            type="number"
            value={rules.max_holders}
            onChange={(e) => setRules(r => ({ ...r, max_holders: e.target.value }))}
          />
          <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              id="same-jur"
              type="checkbox"
              style={{ width: "auto" }}
              checked={rules.require_same_jurisdiction}
              onChange={(e) => setRules(r => ({ ...r, require_same_jurisdiction: e.target.checked }))}
            />
            <label htmlFor="same-jur" style={{ fontSize: "0.875rem", color: "var(--color-muted)" }}>
              Require same jurisdiction for transfers
            </label>
          </div>
          <button type="submit" style={{ width: "100%" }}>Save Rules</button>
        </form>
      </section>

      <section style={{ ...styles.card, marginTop: "1.5rem" }}>
        <h2 style={styles.h2}>Emergency Controls</h2>
        <div style={{ display: "flex", gap: "1rem" }}>
          <button
            onClick={() => alert("Would call pause() on compliance engine")}
            style={{ background: "var(--color-danger)", flex: 1 }}
          >
            Pause All Transfers
          </button>
          <button
            onClick={() => alert("Would call unpause() on compliance engine")}
            style={{ background: "var(--color-success)", flex: 1 }}
          >
            Unpause Transfers
          </button>
        </div>
      </section>
    </div>
  );
}

function Field({ label, type = "text", value, onChange }: {
  label: string; type?: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", color: "var(--color-muted)" }}>{label}</label>
      <input type={type} value={value} onChange={onChange} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" },
  h2: { fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" },
  sub: { color: "var(--color-muted)", fontSize: "0.875rem", marginBottom: "1.5rem" },
  card: { background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "0.75rem", padding: "1.5rem" },
};
