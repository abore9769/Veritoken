# Veritoken — Issue Backlog

This document contains 125 detailed issues for the Veritoken RWA Tokenization Starter Kit for Stellar. Each issue includes a description, the work to be done, an implementation procedure, and acceptance criteria. Issues are grouped by area for navigation, but the numbering is continuous from 1 to 125.

---

## A. Smart Contract Correctness & Bug Fixes

### Issue 1: `register_holder` is never invoked, breaking holder-count and holding-period enforcement

**Description**
The `compliance-engine` contract exposes a `register_holder(addr)` function that is responsible for stamping the ledger timestamp when an address first acquires tokens (`DataKey::HolderSince`) and incrementing the global `HolderCount`. However, no contract in the suite ever calls `register_holder`. The `rwa-token::mint`, `invoice-token::issue`, `property-token::mint`, and `carbon-credit-token::mint` functions all create balances without registering the new holder with the compliance engine. As a consequence, the `min_holding_period` rule can never trigger (there is no `HolderSince` record to compare against) and `holder_count` always returns zero regardless of how many holders actually exist.

**Work to Be Done**
Wire the holder registration call into every minting path of every asset token so that the compliance engine's holder accounting reflects reality. This requires adding a cross-contract client for the compliance engine inside `rwa-token` (which currently only stores the engine address) and invoking `register_holder` on first receipt of tokens.

**Implementation Procedure**
First, add a `#[contractclient]` trait binding for the compliance engine inside `rwa-token/src/compliance.rs` exposing `register_holder(addr: Address)` and `can_transfer(from, to, amount) -> bool`. Second, in `rwa-token::mint`, after `balance::receive_balance`, construct the compliance engine client from the stored engine address and call `register_holder(&to)`. Third, replicate this in `invoice-token::issue`, `property-token::mint`, and `carbon-credit-token::mint`. Fourth, ensure `register_holder` itself remains idempotent (it already guards on `has(&key)`), so repeated mints to the same holder do not double-count. Fifth, update the cross-contract authorization expectations so the asset token is permitted to call into the engine.

**Acceptance Criteria**
After minting tokens to three distinct addresses on any asset token, `ComplianceEngine::holder_count` returns 3. After setting a `min_holding_period` and attempting a transfer before the period elapses, the transfer is rejected, and after the period elapses it succeeds. A unit test demonstrates that minting twice to the same address increments the holder count only once. All existing tests continue to pass.

---

### Issue 2: `max_holders` rule is defined but never enforced in `can_transfer`

**Description**
`ComplianceRules` contains a `max_holders: u32` field documented as "0 = unlimited", and `register_holder` maintains a running `HolderCount`. However, `can_transfer` never reads `max_holders` and never compares it against the current holder count. A transfer to a brand-new holder that would push the holder count above the configured cap is allowed through, defeating the purpose of the rule. This is a compliance-bypass defect because regulated offerings frequently have a legal cap on the number of holders (e.g., Reg D 500-holder limits).

**Work to Be Done**
Enforce the `max_holders` cap inside `can_transfer` for transfers that would create a new holder, and ensure the holder count is consistently maintained across transfers (not only on mint).

**Implementation Procedure**
In `can_transfer`, after the existing checks, determine whether `to` is already a holder by checking `DataKey::HolderSince(to)`. If `to` is not yet a holder and `rules.max_holders > 0` and the current `HolderCount >= rules.max_holders`, return `false`. Because `can_transfer` is a read-only validation, the actual increment must continue to happen in `register_holder`, which the asset token must call after a successful transfer to a new holder (see Issue 1). Add a complementary path so that when a holder's balance reaches zero on transfer-out, the holder count is decremented and the `HolderSince` record cleared, to avoid the count drifting upward permanently.

**Acceptance Criteria**
With `max_holders` set to 2, a transfer to a third distinct holder is rejected while transfers among the existing two succeed. When an existing holder transfers their entire balance away and the recipient is new, the count remains correct. A unit test exercises the cap boundary at exactly `max_holders` and at `max_holders + 1`.

---

### Issue 3: `require_same_jurisdiction` rule is defined but never enforced

**Description**
`ComplianceRules.require_same_jurisdiction` is a boolean flag intended to restrict transfers to counterparties within the same KYC jurisdiction. The `KycRegistry` stores a `jurisdiction: String` per subject, and the engine could cross-check it. Today, `can_transfer` ignores the flag entirely, so even when an administrator enables same-jurisdiction enforcement, cross-jurisdiction transfers proceed unblocked.

**Work to Be Done**
Implement same-jurisdiction enforcement by having the compliance engine query the KYC registry for the jurisdictions of `from` and `to` and reject the transfer when they differ and the flag is enabled.

**Implementation Procedure**
Store the KYC registry address in the compliance engine at initialization (add a `KycRegistry` `DataKey` and a parameter to `initialize`, or add an admin setter). Add a `#[contractclient]` binding exposing a `get_record(addr) -> KycRecord` or a dedicated `jurisdiction_of(addr) -> String` query on the registry. In `can_transfer`, when `rules.require_same_jurisdiction` is true, fetch both jurisdictions and return `false` if they are not equal. Add a `jurisdiction_of` helper to the KYC registry that returns the stored jurisdiction string without panicking when no record exists (returns empty string).

**Acceptance Criteria**
With the flag enabled, a transfer between two approved holders in "US" and "EU" is rejected, while a transfer between two "US" holders succeeds. With the flag disabled, cross-jurisdiction transfers succeed. A unit test covers both jurisdictions matching and differing.

---

### Issue 4: `rwa-token::burn_from` bypasses KYC and compliance checks

**Description**
In `rwa-token`, the `burn_from` function spends an allowance and reduces the holder's balance and the total supply, but unlike `transfer_from` it never calls `kyc::require_kyc` on the `from` address and does not run through the compliance engine. While burning reduces supply rather than moving value, allowing a spender to burn the tokens of an address whose KYC has been revoked (or that is blocklisted) is inconsistent with the protocol's claim that "neither call can be bypassed by the application layer." The asymmetry between `burn` (KYC-checked) and `burn_from` (not KYC-checked) is also confusing.

**Work to Be Done**
Decide and document the intended compliance posture for burns, then make `burn` and `burn_from` consistent. The recommended posture is to require that the `from` address still satisfies KYC for `burn_from`, matching `burn`.

**Implementation Procedure**
Add `kyc::require_kyc(&env, &from)` to `burn_from` immediately after `spender.require_auth()`. Add a code comment explaining why compliance-engine `can_transfer` is intentionally not run for burns (burns do not create a new holder or move value to a counterparty). If product requirements call for blocklist enforcement on burns, additionally consult the blocklist via the engine. Update the contract documentation and tests accordingly.

**Acceptance Criteria**
Calling `burn_from` on an address with revoked KYC panics with "KYC not approved". A unit test demonstrates both the allowed and rejected paths. The behavior of `burn` and `burn_from` is documented as identical with respect to KYC.

---

### Issue 5: No positive-amount validation on transfers, mints, and burns in `rwa-token`

**Description**
The `rwa-token` functions `transfer`, `transfer_from`, `mint`, `burn`, and `burn_from` accept an `i128 amount` without validating that it is strictly positive. Because the workspace release profile enables `overflow-checks`, an extreme value will panic, but a zero or negative amount is not rejected. A negative `amount` in `spend_balance`/`receive_balance` could, depending on the implementation in `balance.rs`, move value in the wrong direction or emit misleading events. Even if arithmetic is internally safe, zero-amount transfers waste fees and pollute the event log.

**Work to Be Done**
Add explicit guards rejecting non-positive amounts in all value-moving entry points of `rwa-token`, and mirror the same guards across the asset tokens.

**Implementation Procedure**
At the top of `transfer`, `transfer_from`, `mint`, `burn`, and `burn_from`, add `if amount <= 0 { panic!("amount must be positive"); }`. Audit `balance.rs` to confirm `spend_balance` rejects spending more than the available balance and never accepts negatives. Apply the same `amount <= 0` guard to `invoice-token::issue`/`redeem`, `carbon-credit-token::mint`/`transfer`/`retire`, and confirm `property-token` already guards (`shares <= 0`). Add tests asserting a panic on zero and negative inputs.

**Acceptance Criteria**
Every value-moving function panics on zero and negative amounts. Unit tests assert these panics with `#[should_panic]`. No existing positive-amount test regresses.

---

### Issue 6: KYC `reject`/`revoke` panic when the subject has no existing record

**Description**
`KycRegistry::reject` and `KycRegistry::revoke` both call `Self::get_record(&env, subject)`, which uses `.expect("no KYC record")`. If a verifier attempts to reject or revoke a subject that has never been submitted/approved, the contract panics instead of recording a sensible terminal state. This is a poor administrative experience: a verifier may legitimately want to pre-emptively reject an address, and a panic on a missing record forces an approve-then-revoke dance.

**Work to Be Done**
Make `reject` and `revoke` tolerant of a missing prior record by creating a record in the appropriate terminal state when none exists.

**Implementation Procedure**
Replace the `get_record` call in `reject`/`revoke` with a lookup that falls back to a default `KycRecord` (status set later, `verifier` set to the calling verifier, `tier = 0`, `expiry = 0`, `jurisdiction = ""`). Set `record.status` to `Rejected` or `Revoked` respectively and write it. Keep the event publication. Add a helper `get_record_or_default(env, addr, verifier)` to avoid duplication.

**Acceptance Criteria**
Calling `revoke` or `reject` on an address with no prior record succeeds and produces a record whose status is `Revoked`/`Rejected`. `is_approved` for that address returns `false`. Unit tests cover reject/revoke both with and without a pre-existing record.

---

### Issue 7: Carbon credit retirement receipts grow unbounded in instance storage

**Description**
`carbon-credit-token` stores every `RetirementReceipt` by pushing onto a single `Vec<RetirementReceipt>` held under `DataKey::RetirementReceipts` in instance storage, and `retire` reads the whole vector, appends, and writes it back. This is O(n) per retirement in both compute and storage I/O, and instance storage has a strict size ceiling. After enough retirements the contract will exceed the instance entry size limit and `retire` will begin to fail, permanently bricking the retirement path. Reading `retirement_receipts()` also returns the entire history unboundedly.

**Work to Be Done**
Redesign receipt storage to be append-only and individually addressable rather than a single growing vector, and provide a paginated read API.

**Implementation Procedure**
Introduce a `RetirementCount` counter in instance storage and store each receipt under a `DataKey::Receipt(u32)` keyed by index in persistent storage with TTL extension. In `retire`, read and increment the counter, write the new receipt at that index, and emit the event. Replace `retirement_receipts()` with `retirement_count() -> u32` and `get_receipt(index: u32) -> RetirementReceipt`, plus a `get_receipts(start: u32, limit: u32) -> Vec<RetirementReceipt>` paginated reader that caps `limit`. Update the frontend Carbon page to page through receipts.

**Acceptance Criteria**
Retiring 1,000 times in a test does not exceed storage limits and each `retire` cost is independent of history length. `get_receipt(i)` returns the i-th receipt. `get_receipts` respects `start`/`limit` and caps oversized limits. Old single-vector behavior is removed.

---

### Issue 8: Invoice token never enforces a maximum supply tied to face value

**Description**
The `invoice-token` documentation states that "`face_value_usd` in the meta determines the max supply," and each token unit represents 1 USD at 7-decimal precision. However, `issue` increments `TotalSupply` without ever comparing it against `meta.face_value_usd`. An administrator can mint an arbitrary amount of invoice tokens far exceeding the underlying receivable's face value, which would over-collateralize claims against a real-world invoice and break the 1:1 economic invariant the contract advertises.

**Work to Be Done**
Cap cumulative issuance at the invoice's face value and reject issuance that would exceed it.

**Implementation Procedure**
In `issue`, after computing the new candidate supply (`supply + amount`), read `meta.face_value_usd` and panic with "exceeds face value" if `supply + amount > meta.face_value_usd`. Decide on units consistently — both `face_value_usd` and token amounts are in 7-decimal stroops — and document the relationship. Add a `remaining_issuable() -> i128` view returning `face_value_usd - total_supply`.

**Acceptance Criteria**
Issuing up to exactly `face_value_usd` succeeds; the next stroop is rejected. `remaining_issuable` decreases as tokens are issued and reaches zero at the cap. Unit tests cover issuance to the cap, one-over-the-cap, and multiple partial issuances summing to the cap.

---

### Issue 9: Property dividend deposit silently discards remainder dust

**Description**
`property-token::deposit_dividend` computes `new_dps = dps + amount / total` using integer division. Any remainder (`amount % total`) is added to the `DividendPool` but is never claimable, because `dividend_per_share` only advances by the integer quotient. Over many deposits with non-divisible amounts, dust permanently accumulates in the pool and the sum of all `pending_dividend` values is strictly less than the pool balance, making accounting reconciliation impossible and stranding funds.

**Work to Be Done**
Eliminate dust by carrying the remainder forward between deposits, or by scaling `dividend_per_share` with a fixed-point accumulator.

**Implementation Procedure**
Introduce a `DividendRemainder` accumulator. In `deposit_dividend`, compute `total_to_distribute = amount + remainder`, then `new_dps = dps + total_to_distribute / total` and `new_remainder = total_to_distribute % total`. Store the new remainder. Only add `amount` to the pool (as today), but the remainder is now folded into the next deposit's distributable base. Alternatively, scale `dividend_per_share` by a fixed `PRECISION` factor (e.g., 1e7) and divide it out in `accrued`. Document the chosen approach and its precision guarantees.

**Acceptance Criteria**
After a sequence of indivisible deposits, the sum of all holders' `pending_dividend` plus the carried remainder equals total deposited. A property-based or table-driven test confirms no value is stranded across at least 100 randomized deposits and balance changes.

---

### Issue 10: Property and carbon tokens do not enforce `require_same_jurisdiction` or compliance on mint

**Description**
`property-token::mint` and `carbon-credit-token::mint` check KYC for the recipient but never call the compliance engine. This means blocklisted addresses can receive freshly minted shares/credits, and a paused compliance engine does not prevent issuance. While minting is admin-gated, the protocol claims compliance is enforced "before any balance changes" universally; mint is a balance change that escapes the engine. Additionally, `property-token` defines `kyc_tier_required` but never checks the recipient's KYC tier.

**Work to Be Done**
Run compliance and tier checks at mint time for property and carbon tokens (and consider rwa-token mint per Issue 1).

**Implementation Procedure**
In `property-token::mint`, after `require_kyc`, fetch the recipient's tier from the KYC registry via a `get_tier(addr) -> u32` client call and panic if it is below `meta.kyc_tier_required`. Decide whether mint should be gated by the engine's pause/blocklist; if so, add a `can_mint`-style check or reuse `can_transfer` with a sentinel `from`. Mirror the compliance/pause decision for `carbon-credit-token::mint`. Document the intended semantics in each contract header.

**Acceptance Criteria**
Minting property shares to a holder whose tier is below `kyc_tier_required` is rejected. Minting to a blocklisted address is rejected when mint-time compliance is enabled. Unit tests cover tier-too-low and blocklisted-recipient cases.

---

### Issue 11: `KycRegistry::remove_verifier` emits no event

**Description**
`add_verifier` publishes an `add_vrf` event, but `remove_verifier` writes the updated list silently. Off-chain indexers and the frontend admin view that track the verifier set by subscribing to events will never learn that a verifier was removed, leaving stale UI and audit gaps. Event symmetry is important for an auditable compliance system.

**Work to Be Done**
Publish a `rm_vrf` (or similar) event from `remove_verifier`, and audit all state-mutating functions across contracts for missing events.

**Implementation Procedure**
Add `env.events().publish((symbol_short!("rm_vrf"),), verifier);` at the end of `remove_verifier`. Perform a sweep: `compliance-engine::remove_from_blocklist` and `set_admin`-style functions also lack events — add `unblocked` and admin-change events where missing. Standardize event topic naming across contracts and document the event schema in a new `docs/EVENTS.md`.

**Acceptance Criteria**
Removing a verifier emits an observable event carrying the verifier address. Removing a blocklist entry emits an `unblocked` event. A test asserts the event is present in `env.events().all()`. `docs/EVENTS.md` lists every event with topics and data payloads.

---

### Issue 12: Compliance `set_rules` performs no validation of rule values

**Description**
`ComplianceEngine::set_rules` writes whatever `ComplianceRules` the admin provides with no sanity checks. A negative `max_transfer_amount` (the field is `i128`) would make the `max_transfer_amount > 0` guard pass falsely and the `amount > rules.max_transfer_amount` comparison behave unexpectedly. An absurdly large `min_holding_period` could permanently freeze transfers. There is no guard rail preventing self-inflicted misconfiguration.

**Work to Be Done**
Validate rule fields on `set_rules` and reject incoherent configurations.

**Implementation Procedure**
In `set_rules`, panic if `rules.max_transfer_amount < 0`. Optionally clamp or reject `min_holding_period` above a sane maximum (e.g., 10 years in seconds) behind a named constant. Emit the `rules_set` event only after validation passes. Add documentation describing the meaning of each sentinel (`0 = unlimited/none`).

**Acceptance Criteria**
Setting rules with a negative `max_transfer_amount` panics. Setting coherent rules succeeds and emits the event. Unit tests cover the rejected and accepted paths.

---

### Issue 13: No emergency pause exists on individual asset tokens

**Description**
The only pause mechanism lives in the compliance engine and is shared by every asset token that points at it. There is no way to pause a single asset (e.g., one fraudulent invoice) without halting every token wired to the same engine. For an incident affecting one asset, operators must either deploy a new engine or freeze the entire platform, both of which are unacceptable for production incident response.

**Work to Be Done**
Add a per-token pause flag enforced in each asset token's transfer/issue/retire paths, independent of the engine-wide pause.

**Implementation Procedure**
Add a `Paused` `DataKey` initialized to `false` in each asset token. Add admin-gated `pause()`/`unpause()` functions emitting events. In `transfer`, `issue`/`mint`, `redeem`, and `retire`, check the local pause flag first and panic with "token paused" when set. Document that two independent pause layers now exist (global engine pause and per-token pause).

**Acceptance Criteria**
Pausing a single asset token blocks its transfers and issuance while other tokens sharing the same engine continue to operate. Unpausing restores function. Unit tests cover paused-blocks and unpaused-restores for each affected function.

---

### Issue 14: `is_approved` does not validate KYC tier or jurisdiction emptiness

**Description**
`KycRegistry::is_approved` only checks status and expiry. A record approved with `tier` left at a default and `jurisdiction` set to an empty string is treated as fully approved. Asset tokens with a minimum tier requirement (property) rely on a separate `get_tier` call that may diverge from `is_approved`. There is no single source of truth for "is this holder eligible for this specific asset," which invites inconsistent gating across contracts.

**Work to Be Done**
Provide a richer eligibility query that combines approval, expiry, minimum tier, and (optionally) allowed jurisdictions in one call, and migrate asset tokens to use it.

**Implementation Procedure**
Add `is_eligible(addr, min_tier) -> bool` to the registry that returns `is_approved(addr) && get_tier(addr) >= min_tier`. Consider `is_eligible_in(addr, min_tier, jurisdiction)` for jurisdiction-restricted assets. Update `property-token` and any tier-aware token to call `is_eligible` with their configured `kyc_tier_required`. Keep `is_approved` for the base SEP-41 path.

**Acceptance Criteria**
`is_eligible(addr, 2)` returns false for a tier-1 holder and true for a tier-2 holder, both with active approval. Property mint/transfer uses `is_eligible`. Unit tests cover tier boundaries and expired records.

---

### Issue 15: Holder count never decreases when a holder fully exits

**Description**
`HolderCount` is monotonically increasing because it is only ever incremented in `register_holder` and never decremented. Even after a holder transfers or burns their entire balance, they remain counted. This makes `max_holders` enforcement (Issue 2) progressively more restrictive than intended and renders `holder_count` inaccurate for reporting.

**Work to Be Done**
Decrement the holder count and clear the `HolderSince` record when an address's balance reaches zero.

**Implementation Procedure**
Add a `deregister_holder(addr)` function to the compliance engine that, when called, checks whether the asset token reports a zero balance for the address before removing the `HolderSince` entry and decrementing `HolderCount` (guarding against underflow). The asset tokens call `deregister_holder` after any transfer/burn that brings a balance to zero. Because the engine cannot see the token's balances directly, pass the post-transfer balance or have the token assert zero before calling. Document the trust assumption that asset tokens call this honestly.

**Acceptance Criteria**
After a holder transfers their full balance away, `holder_count` decreases by one and their `HolderSince` record is gone. Underflow is impossible. Unit tests cover full-exit and partial-exit (no decrement) scenarios.

---

### Issue 16: Minimum holding period applies to `from` only and can be trivially reset

**Description**
The holding-period check in `can_transfer` reads `HolderSince(from)`, set once on first receipt and never updated. This means a holder who received tokens long ago can churn small amounts indefinitely, and a holder who receives new tokens does not have their clock reset for those specific tokens. The rule is coarse: it gates the holder, not the tranche of tokens, and provides no lockup for newly received balances after the first.

**Work to Be Done**
Clarify and correct the holding-period semantics — either per-holder-since-last-acquisition or per-tranche — and implement consistently.

**Implementation Procedure**
Decide on a model. For the simpler per-holder model, update `HolderSince(to)` on every receipt (transfer-in and mint) to the current timestamp, so the lockup restarts whenever new tokens arrive. For a tranche model, track a weighted-average acquisition time or a FIFO queue of lots. Implement the chosen model in `register_holder`/a new `on_receive` hook called by asset tokens, and update `can_transfer` accordingly. Document the precise semantics with examples.

**Acceptance Criteria**
The documented semantics match the implementation, verified by a test that receives tokens at T0, receives more at T1, and confirms the lockup behavior matches the spec at boundary times. The previous "set once, never updated" behavior is removed.

---

### Issue 17: `transfer_from` does not register the recipient as a holder

**Description**
Even once holder registration is wired into mint (Issue 1), secondary-market transfers via `transfer`/`transfer_from` in `rwa-token` and `transfer` in property/carbon tokens still do not register new holders. A token can change hands entirely on the secondary market without the compliance engine ever learning about the new holder, so `max_holders` and holding-period rules silently fail for purchased (rather than minted) positions.

**Work to Be Done**
Call holder registration for the recipient on every successful transfer path across all tokens.

**Implementation Procedure**
After balances are updated in `rwa-token::transfer`, `rwa-token::transfer_from`, `property-token::transfer`, and `carbon-credit-token::transfer`, invoke `register_holder(&to)` on the compliance engine. Ensure idempotency. Combine with the de-registration on full exit (Issue 15). Add an integration test that mints to A, transfers A→B, and verifies B is counted.

**Acceptance Criteria**
After a transfer to a previously unseen recipient, `holder_count` increments and a `HolderSince` record exists for the recipient. Integration test across token + engine passes. No double counting occurs on repeat transfers to the same recipient.

---

### Issue 18: `initialize` functions are not protected against front-running on deploy

**Description**
Every contract uses a separate two-step deploy-then-initialize pattern (the deploy script deploys asset tokens without calling `initialize`). Between deployment and the admin's `initialize` call, anyone observing the network can call `initialize` first and set themselves as admin, KYC registry, and compliance engine. This is a critical takeover vector for the asset tokens, which are deployed in `deploy.sh` without constructor arguments.

**Work to Be Done**
Eliminate the initialization race by deploying with constructor arguments where supported, or by restricting `initialize` to the deployer.

**Implementation Procedure**
Prefer Soroban's contract constructor support so that `admin`, `kyc_registry`, `compliance_engine`, and metadata are set atomically at deploy time, matching how `kyc-registry` and `compliance-engine` are already deployed with `--admin`. For the asset tokens, update `deploy.sh` to pass constructor arguments in the same `-- --admin ...` style and convert `initialize` into a constructor (`__constructor`) or keep `initialize` but gate it so only the deploying address can call it within the same transaction. Add deployment documentation warning about the race for any path that cannot be made atomic.

**Acceptance Criteria**
Asset tokens are deployed and initialized atomically in `deploy.sh`. A second `initialize` call panics with "already initialized". Documentation describes the deployment security model. Integration test confirms a non-deployer cannot initialize.

---

### Issue 19: Invoice tokens have no transfer function, preventing any secondary market

**Description**
`invoice-token` supports `issue`, `settle`, and `redeem` but provides no `transfer` function. Once issued, invoice tokens cannot move between holders at all, which contradicts the README's framing of tokenized invoices as tradable accounts-receivable instruments and means the compliance engine wired into the contract is never exercised for invoices. Either the secondary market is intentionally disabled (and should be documented) or the transfer path is simply missing.

**Work to Be Done**
Add a compliant `transfer` function to `invoice-token` mirroring the other asset tokens, or formally document invoices as non-transferable and remove the unused compliance engine wiring.

**Implementation Procedure**
If transferability is desired: add `transfer(from, to, amount)` that requires `from` auth, checks KYC on both parties, runs the compliance engine `can_transfer`, moves balances with overflow checks, registers the recipient as a holder, and emits a `transfer` event — refusing transfers once `Settled` is true. Add `transfer_from`/`approve` if allowances are needed. If non-transferable: remove the stored compliance engine address, document the decision in the contract header, and update the README.

**Acceptance Criteria**
Either invoices can be transferred between KYC-approved holders subject to compliance rules (with tests for KYC rejection, blocklist rejection, and post-settlement rejection), or the contract and README explicitly document invoices as non-transferable and the dead compliance wiring is removed.

---

### Issue 20: `redeem` allows redemption by any holder but ignores compliance/blocklist

**Description**
`invoice-token::redeem` only checks that the caller authorized and that the invoice is settled and the balance is sufficient. It does not consult the compliance engine, so a blocklisted address can still redeem (burn) its invoice tokens after settlement. For a sanctioned holder, the protocol should arguably prevent redemption proceeds, or at least record the attempt for compliance review.

**Work to Be Done**
Define and enforce the compliance posture for redemption, consistent with the burn policy chosen in Issue 4.

**Implementation Procedure**
Add a compliance check in `redeem` that consults the blocklist (and optionally pause) via the stored compliance engine, panicking when the holder is blocklisted. If redemption must always be allowed for legal reasons (holders are entitled to settlement proceeds), instead emit a distinct event flagging blocklisted redemptions for off-chain review and document the rationale. Align with Issue 4.

**Acceptance Criteria**
The chosen policy is implemented and documented. If blocking: a blocklisted holder cannot redeem and a test confirms the panic. If flagging: a distinguishable event is emitted and a test asserts it.

---

## B. Smart Contract Features & Enhancements

### Issue 21: Add contract upgradeability via `update_current_contract_wasm`

**Description**
None of the six contracts implement an upgrade path. Soroban supports upgrading a contract's WASM in place via `env.deployer().update_current_contract_wasm(hash)`, preserving contract ID and state. Without this, fixing a bug (such as those in Section A) requires deploying a fresh contract and migrating all state and balances — operationally infeasible for live RWA tokens. An admin-gated upgrade function is essential for a production starter kit.

**Work to Be Done**
Add an admin-only `upgrade(new_wasm_hash: BytesN<32>)` to each contract, with appropriate authorization and an emitted event, plus documentation of the upgrade procedure and its risks.

**Implementation Procedure**
In each contract, add `pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>)` that reads the admin, calls `admin.require_auth()`, then `env.deployer().update_current_contract_wasm(new_wasm_hash)` and publishes an `upgraded` event. Establish a storage-layout versioning convention (a `Version` `DataKey`) and a migration hook pattern for breaking storage changes. Write `docs/UPGRADES.md` covering how to publish new WASM, obtain its hash, and invoke `upgrade`, including the warning that state layout must remain compatible.

**Acceptance Criteria**
Each contract exposes an admin-gated `upgrade` that requires admin auth and emits an event. A test upgrades a contract to a new WASM that adds a function and confirms state is preserved and the new function is callable. `docs/UPGRADES.md` documents the full procedure.

---

### Issue 22: Add a `transfer_admin` two-step ownership handoff to every contract

**Description**
Only `rwa-token` exposes `set_admin`, and it transfers admin rights in a single step. A mistyped address permanently locks every admin-gated function. The other contracts (`kyc-registry`, `compliance-engine`, asset tokens) provide no way to rotate the admin at all. A two-step propose/accept handoff is the standard safe pattern and should be uniform across the suite.

**Work to Be Done**
Implement a two-step admin transfer (`propose_admin` then `accept_admin`) consistently across all contracts.

**Implementation Procedure**
Add a `PendingAdmin` storage key. `propose_admin(new_admin)` requires current admin auth and stores the pending address, emitting an event. `accept_admin()` requires the pending admin's auth, promotes it to admin, clears the pending slot, and emits an event. Replace the existing single-step `rwa-token::set_admin` with this pattern (or keep it but deprecate). Provide an `admin()` view on every contract.

**Acceptance Criteria**
Admin can be rotated only by proposing and then having the new admin accept. A wrong proposed address can be overwritten by a new proposal before acceptance. Tests cover propose, accept, overwrite-before-accept, and unauthorized-accept rejection across all contracts.

---

### Issue 23: Implement SEP-41 standard compliance verification for `rwa-token`

**Description**
The roadmap lists "SEP-41 compliance verification against the full standard" as outstanding. `rwa-token` implements the SEP-41 surface (`allowance`, `approve`, `balance`, `transfer`, `transfer_from`, `burn`, `burn_from`, `decimals`, `name`, `symbol`) but there is no test or tooling proving conformance, and `total_supply` and `mint` are extensions beyond the standard. Subtle deviations (event topics, allowance expiration semantics, error behavior) could break SEP-41 tooling.

**Work to Be Done**
Audit `rwa-token` against the SEP-41 specification, document any intentional deviations, and add a conformance test suite.

**Implementation Procedure**
Read the SEP-41 spec and enumerate every required function signature, event, and error condition. Compare each against `rwa-token`, focusing on allowance expiration (`expiration_ledger`), event topic names and data layout, and panic/error semantics. Write a `tests/sep41_conformance.rs` exercising each required behavior, including allowance expiry past `expiration_ledger`, transfer event format, and approve event format. Document deviations (KYC/compliance gating, `mint`, `total_supply`) in `docs/SEP41.md`.

**Acceptance Criteria**
A conformance test suite passes and covers every SEP-41 function and event. `docs/SEP41.md` lists conformance status and documented deviations. Any genuine deviation from the standard is either fixed or explicitly justified.

---

### Issue 24: Add allowance expiration enforcement and querying clarity

**Description**
`rwa-token::approve` accepts an `expiration_ledger` and stores it via `allowance::write_allowance`, but it is unclear (without reading `allowance.rs`) whether `read_allowance` and `spend_allowance` actually enforce expiration, whether expired allowances return zero, and whether approving with a past expiration is rejected. Ambiguous allowance expiry is a common source of bugs and SEP-41 nonconformance.

**Work to Be Done**
Verify and, if needed, implement correct allowance expiration semantics, and reject approvals whose expiration is already in the past for nonzero amounts.

**Implementation Procedure**
Inspect `allowance.rs`. Ensure `read_allowance` returns zero once `expiration_ledger < current ledger sequence`. Ensure `spend_allowance` panics or fails when the allowance is expired or insufficient. In `approve`, panic if `amount > 0 && expiration_ledger < env.ledger().sequence()`. Add tests that approve, advance the ledger past expiration, and assert the allowance reads as zero and cannot be spent.

**Acceptance Criteria**
Expired allowances read as zero and cannot be spent. Approving a nonzero amount with a past expiration panics. Approving zero is always allowed (revocation). Tests cover approve-spend-before-expiry, approve-spend-after-expiry, and past-expiration rejection.

---

### Issue 25: Add batch operations for KYC approvals

**Description**
A verifier onboarding many holders must call `approve` once per subject, each in its own transaction, which is slow and expensive at scale. A batched `approve_many` would let a verifier approve a list of subjects with shared parameters in a single transaction, dramatically improving operational throughput for primary issuance events.

**Work to Be Done**
Add a `approve_many(verifier, subjects: Vec<Address>, tier, expiry, jurisdiction)` to `kyc-registry`, with a sane upper bound on batch size.

**Implementation Procedure**
Add `approve_many` that requires verifier auth and verifier membership once, then iterates the `subjects` vector writing an `Approved` record for each (reusing the existing `write_record`) and emitting a per-subject `approved` event. Cap the batch length (e.g., 100) to avoid exceeding resource limits and panic if exceeded. Consider a `revoke_many` counterpart.

**Acceptance Criteria**
Approving a batch of N subjects in one call results in N approved records and N events. Exceeding the cap panics. A test verifies all subjects in a batch become `is_approved`. Gas usage scales linearly and stays within ledger limits for the capped maximum.

---

### Issue 26: Add jurisdiction allow-list/deny-list to the compliance engine

**Description**
The engine supports `require_same_jurisdiction` (once Issue 3 lands) but offers no way to globally permit or forbid specific jurisdictions (e.g., block transfers to sanctioned countries regardless of counterparty). Real RWA offerings need country-level allow/deny lists independent of the same-jurisdiction rule.

**Work to Be Done**
Add admin-managed jurisdiction allow-list and deny-list to the compliance engine and enforce them in `can_transfer`.

**Implementation Procedure**
Add `DataKey::AllowedJurisdictions` and `DataKey::DeniedJurisdictions` storing `Vec<String>`, with admin-gated `add_allowed_jurisdiction`/`remove_allowed_jurisdiction`/`add_denied_jurisdiction`/`remove_denied_jurisdiction` functions emitting events. In `can_transfer`, fetch `to`'s jurisdiction from the KYC registry (requires the registry link from Issue 3): reject if it is on the deny-list, or if an allow-list is non-empty and the jurisdiction is not on it. Document precedence (deny overrides allow).

**Acceptance Criteria**
Transfers to a holder in a denied jurisdiction are rejected. With a non-empty allow-list, transfers to holders outside it are rejected. Tests cover allow-list-empty (permissive), allow-list-restrictive, and deny-list precedence.

---

### Issue 27: Add per-asset transfer fee / settlement fee mechanism

**Description**
There is no mechanism to charge a protocol or issuer fee on transfers, which many RWA platforms require for sustainability or regulatory pass-through. Adding an optional, configurable fee (basis points, with a fee-collector address) at the token level would let operators monetize without modifying core compliance logic.

**Work to Be Done**
Add an optional, admin-configurable transfer fee to the asset tokens, paid to a designated collector, with clear rounding rules.

**Implementation Procedure**
Add `FeeBps` and `FeeCollector` storage keys with admin setters and events. In each token's `transfer`, after compliance passes, compute `fee = amount * fee_bps / 10_000`, credit the collector and the recipient with `amount - fee`, ensuring the collector is KYC-approved or exempt. Guard against `fee_bps` over a maximum (e.g., 1000 = 10%). Emit a `fee` event. Decide and document rounding (round down, fee floors at zero for tiny amounts).

**Acceptance Criteria**
With a 100 bps fee, transferring 10,000 units delivers 9,900 to the recipient and 100 to the collector. Fees over the maximum are rejected. A zero `fee_bps` reproduces today's behavior exactly. Tests cover fee math, rounding, the cap, and the disabled case.

---

### Issue 28: Add freeze/unfreeze of individual holder balances

**Description**
The blocklist prevents an address from transacting, but there is no way to freeze a specific holder's existing balance for legal hold (e.g., a court order or disputed estate) while leaving the rest of the system operating normally and still allowing the holder to receive distributions. A per-address freeze flag distinct from blocklisting gives finer incident control.

**Work to Be Done**
Add an admin-gated per-holder freeze in the asset tokens that blocks outbound transfers from the frozen address while preserving its balance and dividend accrual.

**Implementation Procedure**
Add a `Frozen(Address)` storage flag with admin-gated `freeze(addr)`/`unfreeze(addr)` emitting events. In `transfer`/`transfer_from`/`redeem`/`retire`, panic with "account frozen" when the source is frozen. Crucially, do not block incoming transfers or dividend accrual. Provide an `is_frozen(addr) -> bool` view. Document the difference between freeze (asset-local, balance-preserving) and blocklist (engine-wide).

**Acceptance Criteria**
A frozen holder cannot send tokens but continues to accrue and (per policy) claim dividends and can still receive tokens. Unfreezing restores transfer ability. Tests cover frozen-send-blocked, frozen-receive-allowed, and unfreeze-restores.

---

### Issue 29: Add invoice partial settlement and default handling

**Description**
`invoice-token` models settlement as a single boolean (`Settled`). Real invoices can be partially paid, paid late, or default entirely. The current design cannot represent partial recovery or a write-down, and `redeem` assumes full-value redemption. RWA investors need the contract to reflect actual recovery for accurate redemption.

**Work to Be Done**
Extend the invoice lifecycle to support partial settlement amounts and a default/write-down state that scales redemption value.

**Implementation Procedure**
Replace `Settled: bool` with a `SettlementState` storing a recovered amount and a status enum (`Outstanding`, `PartiallySettled`, `Settled`, `Defaulted`). Add `settle_partial(amount)` and `mark_default(recovery_amount)`. Compute a redemption ratio = recovered / face_value and have `redeem` pay out proportionally (or burn tokens for the recovered fraction). Emit events for each state change. Update views (`is_settled`, plus new `settlement_state`).

**Acceptance Criteria**
An invoice can be partially settled and holders can redeem proportionally to recovery. A defaulted invoice with 40% recovery yields 40% redemption value. Tests cover outstanding, partial, full, and default paths with correct proportional math.

---

### Issue 30: Add carbon credit batch/serial-number tracking and double-retirement protection across registries

**Description**
Carbon credits are fungible (`i128` balances) with no link to underlying serial numbers from the originating registry (Verra, Gold Standard). Real carbon markets require serial-number-level traceability to prevent the same physical credit being tokenized and retired in two places. The contract should anchor batches to registry serial ranges and expose them in retirement receipts.

**Work to Be Done**
Add serial-number batch metadata to issuance and include it in retirement receipts for full traceability.

**Implementation Procedure**
Add a `CreditBatch` struct (serial range start/end, registry, vintage) and store batches in indexed storage. Change `mint` to `mint_batch(to, batch)` recording the serial range and asserting non-overlap with existing batches. Include the consumed serial range in `RetirementReceipt`. Provide a `get_batch(index)` view. Emit batch events. Document the off-chain reconciliation process with external registries.

**Acceptance Criteria**
Issuing a batch records its serial range; issuing an overlapping range is rejected. Retirement receipts reference the retired serial range. Tests cover batch issuance, overlap rejection, and receipt serial linkage.

---

### Issue 31: Add a global registry/factory contract to track all deployed assets

**Description**
There is no on-chain index of deployed Veritoken assets; the frontend learns contract IDs only from `.env`. A factory/registry contract that records every asset token deployed under a given KYC registry and compliance engine would give the dashboard a canonical, queryable list and enable ecosystem-wide tooling.

**Work to Be Done**
Create a `veritoken-registry` (factory) contract that records deployed asset contracts with their type and metadata pointer, queryable and paginated.

**Implementation Procedure**
Create a new workspace member `contracts/veritoken-registry`. Implement `register_asset(asset_type, contract_id, name)` (admin- or deployer-gated), storing entries in indexed storage with a counter. Provide `asset_count()` and paginated `get_assets(start, limit)`. Optionally let the factory deploy asset tokens directly via `env.deployer()` so registration is atomic. Emit `asset_registered` events. Wire `deploy.sh` to register each deployed asset.

**Acceptance Criteria**
After deploying the suite, the registry lists every asset with type and ID. Pagination works. The dashboard can enumerate assets from the registry rather than `.env` alone. Tests cover registration and paginated reads.

---

### Issue 32: Support multiple compliance engines / pluggable rule modules

**Description**
Each asset token points at exactly one compliance engine. Different assets may need different rule sets, and the monolithic `ComplianceRules` struct forces all rules into one shape. A pluggable approach — where an asset can reference a composable set of rule modules — would make the kit far more extensible, matching the README's "composable kit" framing.

**Work to Be Done**
Introduce a rule-module interface so the compliance engine can delegate to zero or more pluggable rule contracts, each implementing a common `check(from, to, amount) -> bool`.

**Implementation Procedure**
Define a `RuleModule` `#[contractclient]` trait with `check(from, to, amount) -> bool`. Let the engine store an ordered `Vec<Address>` of module contracts (admin-managed). In `can_transfer`, run built-in rules then iterate modules, returning false if any returns false. Provide example modules (max-transfer, time-lock) as separate contracts. Document how to author and register a module.

**Acceptance Criteria**
The engine can have rule modules added/removed by admin and consults them in `can_transfer`. A sample module rejecting odd amounts blocks odd-amount transfers when registered. Tests cover module registration, ordering, and short-circuit rejection.

---

### Issue 33: Add events with structured, indexable data for off-chain analytics

**Description**
Current events use terse `symbol_short!` topics and minimal data, making off-chain indexing brittle and inconsistent across contracts (e.g., transfer publishes `amount` only, with addresses in the topic). There is no documented, versioned event schema, which is necessary for the planned TypeScript SDK and any analytics layer.

**Work to Be Done**
Define and implement a consistent, documented event schema across all contracts with stable topic names and structured data payloads.

**Implementation Procedure**
Author `docs/EVENTS.md` listing each event with topic tuple and data layout. Standardize naming (e.g., `transfer`, `mint`, `burn`, `kyc_approved`, `compliance_blocked`). Where useful, include both addresses and amount in the data section rather than splitting across topics inconsistently. Add a schema version constant. Update all `publish` calls to match. Add tests asserting event shape for each major action.

**Acceptance Criteria**
Every emitting function matches the schema in `docs/EVENTS.md`. Tests assert topics and data for transfer, mint, burn, KYC approve/revoke, and compliance rule changes. The schema includes a version field.

---

### Issue 34: Add reentrancy and cross-contract-call safety review and guards

**Description**
Asset tokens make cross-contract calls into the KYC registry and compliance engine before mutating state. While Soroban's model differs from EVM, a malicious or buggy engine/registry could be pointed at by `initialize` and behave adversarially (e.g., re-enter the token). There is no documented trust boundary or invariant ensuring state changes are ordered safely relative to external calls.

**Work to Be Done**
Perform and document a cross-contract-call safety review, adopt a checks-effects-interactions ordering, and add guards where external contracts are attacker-controllable.

**Implementation Procedure**
Audit each token's transfer/mint path to confirm all external calls (KYC, compliance) occur before irreversible state writes and that no external call happens after partial state mutation. Document the trust assumption that the KYC registry and compliance engine are admin-controlled and trusted. Where the engine address is mutable, ensure only admin can change it. Add tests with a mock malicious engine to confirm a reverting external call leaves token state unchanged.

**Acceptance Criteria**
A documented trust-boundary section exists in each contract. A test using a mock engine that panics confirms the token transaction reverts atomically with no balance change. No state write precedes a compliance/KYC external call in any path.

---

### Issue 35: Add configurable decimals consistency and document the unit model

**Description**
Decimals differ across contracts (`invoice-token` = 7, `property-token` = 0, `carbon-credit-token` = 0) and `rwa-token` takes decimals as a parameter. The relationship between on-chain integer amounts and real-world units (USD stroops, whole shares, whole tonnes) is implied but never centrally documented, risking off-by-7-decimal errors in the frontend and SDK.

**Work to Be Done**
Document the unit and decimals model for every token and add validation that amounts respect the intended granularity.

**Implementation Procedure**
Write `docs/UNITS.md` specifying, per token, the meaning of one integer unit and the decimals returned. For zero-decimal tokens (property, carbon), document that fractional shares/tonnes are impossible. Consider validating in `rwa-token::initialize` that `decimal <= 18`. Ensure the frontend formats and parses amounts using each token's `decimals()` rather than hardcoding. Cross-reference from the README.

**Acceptance Criteria**
`docs/UNITS.md` exists and is linked from the README. `rwa-token::initialize` rejects absurd decimal values. The frontend uses `decimals()` for all amount formatting. A test confirms decimals validation.

---

### Issue 36: Add a `version()` view and embed build metadata in each contract

**Description**
There is no way to query which version of a contract's logic is deployed, which complicates upgrades (Issue 21), audits, and incident response. A `version()` returning a semantic version string and an optional git commit would make on-chain deployments self-describing.

**Work to Be Done**
Add a `version() -> String` view to every contract returning a compile-time version constant, and wire it into CI/release tooling.

**Implementation Procedure**
Define a `const VERSION: &str` per contract (or via `env!("CARGO_PKG_VERSION")`) and expose `pub fn version(env: Env) -> String { String::from_str(&env, VERSION) }`. Optionally embed the git short SHA via a build script and `env!`. Update the deploy script to print and record each deployed contract's version. Surface the version in the frontend admin page.

**Acceptance Criteria**
Each contract returns its semantic version from `version()`. The deploy script records versions. The admin page displays deployed contract versions. A test asserts the version string is non-empty.

---

### Issue 37: Add storage TTL management/extension entry points

**Description**
Contracts extend persistent-entry TTLs on writes (`extend_ttl(THRESHOLD, BUMP)`), but there is no way to proactively bump TTLs for entries that are not being written (e.g., a holder who has not transacted in months whose balance entry may expire). If a persistent entry's TTL lapses, the balance becomes archived and inaccessible without a restore, risking apparent loss of funds.

**Work to Be Done**
Add public TTL-extension entry points so anyone (or a keeper) can keep balance and KYC entries alive, and document the archival/restore model.

**Implementation Procedure**
Add `bump_balance(addr)` to asset tokens and `bump_record(addr)` to the KYC registry that re-extend the relevant persistent entry's TTL without other side effects. Document the TTL constants (30/90/365 days) per contract and the consequences of expiry. Provide guidance and optionally a keeper script in `scripts/` that bumps active holders periodically. Reference Soroban state archival semantics.

**Acceptance Criteria**
A dormant balance entry can have its TTL extended by calling the new function. `docs/STORAGE.md` explains TTLs and archival/restore. A test extends a TTL and confirms via the ledger that the entry's live-until increased. A keeper script exists.

---

### Issue 38: Add dividend distribution in a real asset (token) rather than abstract stroops

**Description**
`property-token` tracks dividends as abstract `i128` "stroops" in `DividendPool` and pays `claim_dividend` by returning an amount, but no actual asset (XLM/USDC) is transferred — the comment says dividends are "in XLM/USDC" yet there is no token transfer in or out. Holders cannot actually receive value; the accounting is purely notional.

**Work to Be Done**
Integrate a real payout asset so `deposit_dividend` pulls funds in and `claim_dividend` transfers funds out to the holder.

**Implementation Procedure**
Store a `PayoutToken: Address` (an SEP-41 token such as USDC) set at initialization. In `deposit_dividend`, require the admin to actually transfer `amount` of the payout token into the contract (via the payout token's `transfer` with the contract as recipient and `require_auth`). In `claim_dividend`, after computing the owed amount, call the payout token's `transfer` from the contract to the holder. Handle the contract's own authorization for outbound transfers. Keep per-share accounting intact (and fix dust per Issue 9).

**Acceptance Criteria**
Depositing a dividend moves real payout tokens into the contract; claiming moves them to the holder. The contract's payout-token balance equals the unclaimed total at all times. Tests cover deposit, multi-holder pro-rata claims, and that the contract never pays out more than deposited.

---

### Issue 39: Add invoice yield/discount accrual view

**Description**
`InvoiceMeta` stores `discount_rate_bps` and `due_date`, the economic basis for invoice financing (buy at a discount, redeem at face value on settlement). The contract never exposes the current accrued value or the implied yield, so a frontend cannot show holders what their position is worth as the due date approaches.

**Work to Be Done**
Add a view computing the current discounted value and time-to-maturity for the invoice based on `discount_rate_bps` and `due_date`.

**Implementation Procedure**
Add `current_value(env) -> i128` that linearly (or per a documented day-count convention) accretes from the discounted purchase value toward `face_value_usd` as `now` approaches `due_date`, clamped at face value after `due_date` until settlement. Add `time_to_maturity(env) -> u64` returning seconds remaining. Document the accrual formula and its assumptions (simple vs. compound). Surface in the frontend invoice page.

**Acceptance Criteria**
`current_value` returns the discounted value at issuance, accretes toward face value over time, and equals face value at/after `due_date`. `time_to_maturity` is correct. Tests check value at issuance, midpoint, and maturity.

---

### Issue 40: Add minimum/maximum holding (position size) limits per holder

**Description**
The compliance engine caps `max_transfer_amount` per transaction but cannot cap an individual holder's total position. Many regulated offerings limit how much any one investor may hold (concentration limits) or require a minimum investment. There is no per-holder maximum or minimum balance enforcement.

**Work to Be Done**
Add configurable per-holder maximum and minimum balance rules to the compliance engine, enforced on transfers and mints.

**Implementation Procedure**
Extend `ComplianceRules` with `max_holder_balance: i128` (0 = unlimited) and `min_investment: i128` (0 = none). Because the engine cannot read token balances directly, pass the recipient's resulting balance into a richer `can_transfer(from, to, amount, to_balance_after)` or add a dedicated `check_position(addr, new_balance)` the token calls. Reject when the resulting balance exceeds the max or a nonzero position falls below the minimum. Update token transfer/mint to pass post-transfer balances.

**Acceptance Criteria**
A transfer that would push the recipient above `max_holder_balance` is rejected. A transfer leaving a nonzero balance below `min_investment` is rejected. Tests cover both boundaries and the disabled (zero) sentinels.

---

## C. Testing & Quality Assurance

### Issue 41: Establish cross-contract integration test suite

**Description**
Each contract has a `test.rs`, but there is no integration test exercising the full path: deploy KYC registry + compliance engine + an asset token, approve holders, configure rules, and run end-to-end transfers that traverse both cross-contract calls. Unit tests in isolation can pass while the wired system fails (as several Section A bugs demonstrate).

**Work to Be Done**
Create an integration test crate/module that registers all relevant contracts in one `Env` and validates end-to-end flows.

**Implementation Procedure**
Add `contracts/integration-tests` (a test-only crate depending on the others) or a shared `tests/` module using `env.register_contract` for the registry, engine, and each asset token. Write scenarios: approve two holders, configure rules, mint, transfer success, transfer blocked by blocklist, transfer blocked by pause, transfer blocked by KYC revocation, holding-period enforcement, and max-holders enforcement. Run under `--features testutils`.

**Acceptance Criteria**
An integration suite deploys the full stack in-memory and validates at least eight end-to-end scenarios, including each compliance rejection reason. The suite runs in CI. All scenarios pass once Section A fixes land.

---

### Issue 42: Add property-based tests for the dividend accounting math

**Description**
The property-token dividend algorithm (reward-debt accumulator with `accrue`/`reset_debt`) is subtle and prone to off-by-one and dust errors (Issue 9). Example-based tests cannot cover the combinatorial space of deposit/transfer/mint/claim interleavings. Property-based testing would catch invariant violations like "sum of pending + claimed never exceeds deposited."

**Work to Be Done**
Introduce property-based tests (e.g., via `proptest`) that generate random sequences of operations and assert dividend invariants.

**Implementation Procedure**
Add `proptest` as a dev-dependency for `property-token`. Model a sequence of random operations (mint, transfer, deposit_dividend, claim) across a small set of holders. After each sequence, assert: total claimed + total pending + carried remainder == total deposited; no holder's pending is negative; a holder who held zero shares throughout claims zero. Shrink failing cases for diagnosis. Keep iteration counts CI-friendly.

**Acceptance Criteria**
A `proptest` suite runs hundreds of randomized operation sequences and all dividend invariants hold (after Issue 9). A deliberately reintroduced dust bug is caught by the suite. The suite runs in CI within a reasonable time budget.

---

### Issue 43: Add negative/failure-path test coverage for every panic

**Description**
The contracts panic in many places ("already initialized", "not an authorized verifier", "KYC not approved", "insufficient balance", "invoice already settled", etc.), but it is unclear how many of these are covered by `#[should_panic]` tests. Untested panic paths can silently change message or condition during refactors.

**Work to Be Done**
Enumerate every panic across the suite and ensure each has a dedicated failure-path test asserting the panic (and ideally its message).

**Implementation Procedure**
Grep for `panic!` and `.expect(`/`.unwrap()` across `contracts/`. For each, write a `#[should_panic(expected = "...")]` test that drives the contract into that condition (unauthorized caller, double initialize, over-spend, settled-invoice issue, non-verifier approve, etc.). For `unwrap` on missing storage, add tests for the uninitialized-contract case. Track coverage in a checklist in the PR description.

**Acceptance Criteria**
Every reachable panic and `expect` has a corresponding failure-path test asserting the expected message. Running the suite confirms each panic fires under its trigger condition. No panic path is left untested.

---

### Issue 44: Add authorization (`require_auth`) tests using `mock_auths`

**Description**
The contracts rely on `require_auth` for admin and verifier gating, but tests must confirm that calls without the correct authorization actually fail and that the correct address is the one being authorized. Soroban's `mock_auths`/`mock_all_auths` testing utilities make this verifiable, and missing such tests means an accidental removal of a `require_auth` could pass CI.

**Work to Be Done**
Add tests that assert each privileged function rejects calls authorized by the wrong address and accepts the correct one, using explicit auth mocking rather than `mock_all_auths`.

**Implementation Procedure**
For each admin/verifier-gated function (`set_rules`, `pause`, `add_verifier`, `approve`, `mint`, `settle`, etc.), write a test using `env.mock_auths(&[...])` granting auth only to the correct principal and asserting success, plus a test granting auth to a wrong principal (or none) and asserting failure. Avoid blanket `mock_all_auths` in these specific tests so the auth requirement is genuinely exercised.

**Acceptance Criteria**
Each privileged function has a positive and negative authorization test using scoped `mock_auths`. Removing a `require_auth` in any function causes its negative test to fail. The suite runs in CI.

---

### Issue 45: Add fuzz tests for arithmetic overflow and boundary values

**Description**
Balances, supplies, and dividend accumulators are `i128` with `overflow-checks` enabled in release. Edge values near `i128::MAX`/`MIN`, and operations like `bal * dps` in property dividends, could overflow and panic in production. There is no fuzzing of these arithmetic boundaries.

**Work to Be Done**
Add fuzz/boundary tests targeting arithmetic in balance, supply, and dividend computations to surface overflow conditions and confirm graceful failure.

**Implementation Procedure**
Add boundary tests minting amounts near `i128::MAX`, depositing dividends with large per-share values to probe `bal * dps`, and accumulating supply across many mints. Confirm overflow either cannot occur given documented supply caps or panics deterministically (and document the cap that prevents it). Consider `cargo fuzz` targets for the dividend accrual function. Document maximum safe supply and per-share values.

**Acceptance Criteria**
Tests demonstrate behavior at i128 boundaries: either safe due to documented caps or a deterministic panic. The property dividend multiplication has a documented safe upper bound enforced or proven. Boundary tests run in CI.

---

### Issue 46: Add a test that verifies events are emitted with correct topics and data

**Description**
Events are central to off-chain indexing and the planned SDK, but there is little assertion that events fire with the expected topics and payloads. A refactor could drop or rename an event unnoticed.

**Work to Be Done**
Add event-assertion tests for every state-mutating function using `env.events().all()`.

**Implementation Procedure**
After each mutating call in tests, read `env.events().all()` and assert the last event's contract ID, topics, and data match the documented schema (Issue 33). Cover transfer, mint, burn, approve, KYC approve/reject/revoke, rule changes, pause/unpause, blocklist add/remove, dividend deposit/claim, and retirement. Factor a small assertion helper to reduce boilerplate.

**Acceptance Criteria**
Every mutating function has a test asserting its event topics and data. Renaming or removing an event breaks the corresponding test. Tests run in CI.

---

### Issue 47: Add code coverage measurement and a minimum threshold gate

**Description**
There is no visibility into test coverage. For a compliance-critical contract suite, knowing which branches are untested is essential, and a coverage gate prevents regressions in test discipline.

**Work to Be Done**
Integrate coverage measurement (e.g., `cargo llvm-cov`) into CI, publish a report, and enforce a minimum threshold.

**Implementation Procedure**
Add a CI job running `cargo llvm-cov --features testutils --workspace` producing an lcov/HTML report. Upload the report as an artifact and optionally to a coverage service. Set an initial threshold (e.g., 70%) that fails CI when unmet, raising it over time. Exclude generated and test-only code. Document how to run coverage locally.

**Acceptance Criteria**
CI produces a coverage report on every PR and fails when coverage drops below the configured threshold. A coverage badge is added to the README. Local instructions exist in `CONTRIBUTING.md`.

---

### Issue 48: Add frontend unit and component tests

**Description**
The React frontend has no tests at all. Wallet connection logic, transaction assembly, and form validation are untested, so regressions in the user-facing flows ship silently. The `package.json` has no test runner configured.

**Work to Be Done**
Set up a frontend test framework and add unit tests for `lib/` utilities and component tests for the page forms.

**Implementation Procedure**
Add Vitest and React Testing Library as dev-dependencies, with a `test` script. Mock `@stellar/freighter-api` and `@stellar/stellar-sdk` to test `wallet.ts` (connect/disconnect/signTx) and `stellar.ts` (`simulateAndSend` success and error branches, polling). Add component tests for the Invoice, Property, Carbon, KYC, and Admin pages asserting validation and submit behavior. Wire `npm test` into CI.

**Acceptance Criteria**
`npm test` runs a passing suite covering `wallet.ts`, `stellar.ts`, and each page's form validation/submit. Freighter and SDK are mocked. The suite runs in CI on every PR.

---

### Issue 49: Add end-to-end (E2E) tests against a local/testnet network

**Description**
There is no automated end-to-end verification that a deployed contract suite plus frontend actually works against a real Stellar RPC. Manual testing is the only safeguard, which is unreliable for a kit others will fork.

**Work to Be Done**
Create an E2E test harness that deploys the contracts to a local Soroban network (or testnet) and drives the key workflows via the SDK.

**Implementation Procedure**
Add a script that spins up a local network (or uses testnet with a funded throwaway identity), runs `deploy.sh`, then executes a Node/TS E2E script that: initializes contracts, approves KYC, mints, transfers (success and compliance-blocked), and retires/redeems, asserting on-chain state via RPC. Optionally drive the UI with Playwright against a built frontend pointed at the deployed IDs. Make it runnable in CI nightly (not on every PR, to bound flakiness/cost).

**Acceptance Criteria**
An E2E harness deploys and exercises the full suite end-to-end and asserts expected on-chain state. It runs on demand and on a nightly CI schedule. Failures produce actionable logs.

---

### Issue 50: Add a deterministic test for KYC expiry behavior

**Description**
`is_approved` rejects records whose `expiry` is nonzero and in the past, but this time-dependent branch needs a deterministic test that advances the ledger timestamp. Without it, the expiry logic could break unnoticed.

**Work to Be Done**
Add tests that approve a holder with a future expiry, advance the ledger past it, and assert approval flips to false; plus a `expiry = 0` (never expires) case.

**Implementation Procedure**
Use `env.ledger().set_timestamp(...)` (or `env.ledger().with_mut`) to control time. Test: approve with `expiry = now + 100`, assert `is_approved == true`, advance to `now + 200`, assert `is_approved == false`. Test: approve with `expiry = 0`, advance far into the future, assert `is_approved == true`. Test the exact boundary (`expiry == now`).

**Acceptance Criteria**
Tests deterministically cover pre-expiry, post-expiry, exact-boundary, and never-expires cases. They run in CI and fail if the expiry comparison is altered incorrectly.

---

### Issue 51: Add clippy with `-D warnings` and rustfmt checks to the contract workspace

**Description**
The README claims CI runs fmt and clippy, but there is no CI (Issue 61) and no documented lint configuration. Without enforced clippy/fmt, style and correctness lints (clippy catches real bugs) drift. The workspace already uses `#[allow(clippy::too_many_arguments)]`, indicating clippy is expected.

**Work to Be Done**
Establish enforced `cargo fmt --check` and `cargo clippy -- -D warnings` for the entire workspace, including the wasm target.

**Implementation Procedure**
Add a `rustfmt.toml` and a `clippy.toml` if needed. Run `cargo clippy --workspace --all-targets --features testutils -- -D warnings` and `cargo fmt --all --check` locally, fixing all findings. Add a `.cargo/config` or document the wasm target check `cargo check --target wasm32-unknown-unknown`. Wire all three into CI (Issue 61). Resolve or explicitly `allow` each lint with justification.

**Acceptance Criteria**
`cargo fmt --all --check` and `cargo clippy --workspace -- -D warnings` both pass with no warnings. CI enforces them. Any `allow` carries a justifying comment.

---

### Issue 52: Add mutation testing to validate test-suite effectiveness

**Description**
Passing tests do not guarantee meaningful assertions. Mutation testing (e.g., `cargo-mutants`) reveals tests that pass even when logic is broken, which is especially valuable for compliance gating where a silently-disabled check is dangerous.

**Work to Be Done**
Run mutation testing over the contract workspace and address surviving mutants in critical compliance logic.

**Implementation Procedure**
Add `cargo-mutants` to the dev toolchain. Run it scoped initially to `compliance-engine` and `kyc-registry` (the highest-risk modules). Triage surviving mutants — particularly any that disable a rule check or invert a comparison — and add tests that kill them. Document the workflow and add a non-blocking CI job that reports surviving mutants for awareness.

**Acceptance Criteria**
Mutation testing runs over the compliance and KYC contracts, and surviving mutants in their `can_transfer`/`is_approved` logic are killed with new tests. A CI job reports mutation results. Documentation describes the process.

---

### Issue 53: Add gas/resource benchmarking for core operations

**Description**
Soroban charges for CPU instructions and storage. Operations like carbon `retire` (Issue 7) and any O(n) loop (blocklist/verifier scans) can grow costly. There is no measurement of per-operation resource cost, so regressions in cost go unnoticed and the `O(1) per holder` dividend claim is unverified.

**Work to Be Done**
Add benchmarks capturing the CPU/memory/read-write footprint of key operations and track them over time.

**Implementation Procedure**
Use Soroban's budget API (`env.budget()`/`env.cost_estimate()`) in tests to record CPU instructions and storage accesses for transfer, mint, claim_dividend, retire, approve, and can_transfer at varying scales (e.g., blocklist of 0/10/100 entries). Assert the dividend claim cost is independent of holder count. Output a benchmark report and consider failing CI on large regressions.

**Acceptance Criteria**
Benchmarks report resource usage for core operations, demonstrating O(1) dividend claims and quantifying blocklist scan cost. A regression beyond a threshold is flagged. Results are reproducible.

---

### Issue 54: Add tests asserting blocklist and verifier-list scaling behavior

**Description**
`can_transfer` calls `blocklist.contains(&from)`/`contains(&to)` and `require_verifier` calls `list.contains`, both O(n) over a `Vec`. With a large blocklist or verifier set, every transfer/approval pays a linear scan, and there are no tests probing behavior or cost at scale.

**Work to Be Done**
Test correctness and cost at large list sizes and, if needed, migrate membership checks from `Vec` to a map-keyed storage pattern.

**Implementation Procedure**
Add tests populating the blocklist/verifier list with many entries and asserting correct membership decisions and bounded cost (with Issue 53's budget API). If cost is prohibitive, refactor to per-address boolean storage keys (`DataKey::Blocked(Address)`, `DataKey::Verifier(Address)`) for O(1) membership, keeping an optional count for enumeration. Migrate reads/writes accordingly and provide enumeration via a separate index if needed.

**Acceptance Criteria**
Membership checks remain correct at large sizes. Either cost is demonstrably acceptable or the implementation is refactored to O(1) keyed lookups with passing tests. The change preserves existing add/remove semantics and events.

---

### Issue 55: Add snapshot tests for contract WASM size and a size budget

**Description**
The release profile is tuned for size (`opt-level = "z"`, `lto`, `strip`), but there is no tracking of compiled WASM size. Soroban has deployment size limits, and unwitting dependency or code growth could push a contract over the limit at the worst time.

**Work to Be Done**
Measure each contract's optimized WASM size in CI and fail when it exceeds a configured budget.

**Implementation Procedure**
Add a CI step that builds with `--release --target wasm32-unknown-unknown`, runs `stellar contract optimize`, and records each `.wasm` file size. Compare against a committed budget file and fail on regressions beyond a tolerance. Print a size table in the CI log. Document current sizes in `docs/`.

**Acceptance Criteria**
CI reports optimized WASM sizes for all contracts and fails if any exceeds its budget. A baseline size table is documented. The check runs on every PR touching contracts.

---

## D. Frontend

### Issue 56: Migrate from deprecated Freighter API calls to the current v2+ API

**Description**
`frontend/src/lib/wallet.ts` imports `isConnected`, `getPublicKey`, `signTransaction`, and `setAllowed` from `@stellar/freighter-api` and treats them as returning bare values (`await getPublicKey()` used as a string, `await isConnected()` used as a boolean). Recent Freighter API versions changed these to return result objects (e.g., `{ isConnected }`, `{ address, error }`) and renamed `getPublicKey` to `getAddress` and `setAllowed`/access flows. As written, against a current Freighter, `connect()` will misbehave (e.g., set `address` to an object) and signing may break.

**Work to Be Done**
Update the wallet integration to the actual installed `@stellar/freighter-api` version's contract, handling the object-shaped responses and error fields.

**Implementation Procedure**
Pin and inspect the installed `@stellar/freighter-api` version. Replace `isConnected()` usage with the current connection-check returning `{ isConnected }`. Replace `getPublicKey()` with `getAddress()` (or `requestAccess()`), reading the `.address` field and handling `.error`. Update `signTransaction` to read `.signedTxXdr` from the returned object and propagate `.error`. Add explicit error handling that surfaces user-rejected requests distinctly. Update the `WalletState` type if the network field shape changed.

**Acceptance Criteria**
Connecting with a current Freighter sets `address` to a real `G...` string, not an object. Signing returns a valid XDR string. User rejection produces a clear error. A mocked test confirms the new response shapes are handled.

---

### Issue 57: Fix the unbounded transaction-confirmation polling loop

**Description**
`simulateAndSend` in `stellar.ts` polls `getTransaction` in a `while (status === "NOT_FOUND")` loop with a fixed 1.5s delay and no timeout or maximum attempts. If a transaction never lands (dropped, network issue), the UI hangs forever with no feedback, and there is no cancellation. This is a poor and potentially infinite UX failure mode.

**Work to Be Done**
Add a bounded retry/timeout with exponential backoff and a clear timeout error to the confirmation polling.

**Implementation Procedure**
Introduce a maximum wait (e.g., 60s) and/or a max attempt count. Replace the fixed delay with capped exponential backoff. Throw a descriptive `TransactionTimeoutError` including the transaction hash when the budget is exhausted so the UI can show a "still pending — check explorer" message with a link. Make the function accept optional `{ timeoutMs, signal }` to support cancellation via `AbortSignal`.

**Acceptance Criteria**
Polling stops after the timeout and throws a typed timeout error containing the hash. Backoff is bounded. A test simulates perpetual `NOT_FOUND` and asserts the timeout fires. Cancellation via `AbortSignal` works.

---

### Issue 58: Add global error boundary and user-facing error toasts

**Description**
There is no React error boundary, so an exception in any page (e.g., a failed contract read) blanks the app. Transaction errors thrown by `simulateAndSend` are raw `Error`s with `JSON.stringify(errorResult)` messages unsuitable for users. There is no consistent notification surface.

**Work to Be Done**
Add an app-level error boundary and a toast/notification system that renders human-readable messages for contract and wallet errors.

**Implementation Procedure**
Wrap the router in an error boundary component that renders a recoverable fallback and logs the error. Add a lightweight toast provider (or a small library) and a `useNotify` hook. Map common error signatures (simulation failure, user rejection, insufficient balance panic, KYC-not-approved panic) to friendly messages via a translator that parses Soroban error/diagnostic strings. Replace raw `throw new Error(JSON.stringify(...))` sites with structured errors feeding the translator.

**Acceptance Criteria**
An exception in any page shows the fallback UI rather than a blank screen. Failed transactions show a readable toast (e.g., "Recipient is not KYC-approved"). User-rejected signatures show a distinct, non-alarming message. Tests cover the error-to-message mapping.

---

### Issue 59: Add loading, pending, and disabled states to all transaction buttons

**Description**
Because transactions take seconds to confirm (Issue 57's polling), every action button must reflect in-flight state to prevent double submission and to reassure the user. The current pages presumably lack consistent pending/disabled handling, risking duplicate transactions and confusing UX.

**Work to Be Done**
Introduce a shared async-action hook and apply it to every transaction-triggering control so buttons disable and show a spinner while pending.

**Implementation Procedure**
Create a `useAsyncAction` hook that wraps an async function, exposing `{ run, pending, error }`, and guarantees no concurrent invocation. Apply it to mint, transfer, issue, redeem, retire, approve/revoke KYC, set-rules, and pause/unpause buttons across all pages. While pending, disable the button and show a spinner and status text ("Simulating…", "Awaiting signature…", "Confirming…"). Re-enable on success/error.

**Acceptance Criteria**
Every transaction button disables and shows progress while in flight and cannot be double-clicked into two submissions. Status text reflects the simulate/sign/confirm phases. A test asserts the button is disabled during the pending phase.

---

### Issue 60: Add input validation and amount formatting respecting each token's decimals

**Description**
The forms accept amounts but there is no evidence of validation for negative/zero/over-precision values or formatting consistent with each token's decimals (invoice = 7, property/carbon = 0). A user could enter "1.5" shares for a zero-decimal property token, producing a confusing failure on-chain.

**Work to Be Done**
Add robust, decimals-aware client-side validation and formatting for all numeric inputs, plus address validation for Stellar public keys.

**Implementation Procedure**
Create utilities `parseAmount(value, decimals)` and `formatAmount(raw, decimals)` that convert between human input and on-chain integers and reject over-precision input. Validate addresses with the SDK's `StrKey`/`Keypair` validators. In each form, block submission with inline messages when amounts are non-positive, over-precision for the token's decimals, or addresses are malformed. Use the live `decimals()` from the contract where possible, falling back to known constants.

**Acceptance Criteria**
Entering a fractional value for a zero-decimal token is rejected client-side with a clear message. Over-precision invoice amounts are rejected. Invalid addresses are flagged before submission. Tests cover parse/format round-trips and validation rejections.

---

### Issue 61: Add a CI pipeline — the README claims one exists but `.github/` is absent

**Description**
The README and roadmap state a CI pipeline exists ("CI pipeline (GitHub Actions) — fmt, clippy, tests, wasm build, frontend lint/build", marked complete, and a repository-layout entry `.github/workflows/ci.yml`). In reality there is no `.github` directory anywhere in the repository. The project's central quality claim is false, and no automated checks run on PRs.

**Work to Be Done**
Create the GitHub Actions CI workflow the README already advertises, covering Rust fmt/clippy/test/wasm-build and frontend lint/build.

**Implementation Procedure**
Create `.github/workflows/ci.yml` triggered on push and pull_request. Add a Rust job that installs the toolchain from `rust-toolchain.toml`, adds the `wasm32-unknown-unknown` target, and runs `cargo fmt --all --check`, `cargo clippy --workspace -- -D warnings`, `cargo test --features testutils`, and `cargo build --release --target wasm32-unknown-unknown`. Add a frontend job that runs `npm ci`, `npm run lint`, and `npm run build` in `frontend/`. Cache cargo and npm. Add status badges to the README only once the workflow is green.

**Acceptance Criteria**
A CI workflow exists and runs all advertised steps on every PR and push, passing on the current codebase (after lint fixes). The README badge reflects real status. The roadmap's CI claim is now accurate.

---

### Issue 62: Add a dashboard view that reads live on-chain state

**Description**
The Dashboard page is described as an "overview of deployed asset types," but it likely shows static information from `.env` rather than live state. Users need real figures: total supply per asset, holder counts, paused status, total retired carbon, dividend pool size, and KYC verifier count.

**Work to Be Done**
Wire the Dashboard to query each deployed contract for its key metrics and render them with loading and error states.

**Implementation Procedure**
Using `@tanstack/react-query`, add read-only contract calls (via simulation, no signing) for `total_supply`/`total_shares`, `holder_count`, `get_rules().paused`, `total_retired`, `DividendPool`/`pending` aggregates, and verifier count. Build typed client wrappers in `lib/` for each contract's read methods. Render metric cards per asset with skeleton loaders and per-card error fallbacks. Refresh on an interval and on focus.

**Acceptance Criteria**
The Dashboard displays live total supply, holder count, paused state, and asset-specific metrics for each configured contract, with loading skeletons and error handling. Values update after a state-changing action. A test mocks the read calls and asserts rendering.

---

### Issue 63: Add a transaction history / activity feed using contract events

**Description**
Users cannot see a history of actions (mints, transfers, retirements, KYC approvals). The contracts emit events, but the frontend never reads them. An activity feed is essential for an auditable RWA platform and showcases the events the SDK will depend on.

**Work to Be Done**
Build an activity feed that fetches and decodes contract events from the RPC and presents them per asset and per account.

**Implementation Procedure**
Use the RPC `getEvents` API filtered by contract ID and topic to fetch recent events. Decode topics/data per the event schema (Issue 33) into typed records. Render a paginated, filterable feed (by event type and asset). Handle the RPC's event retention window and ledger range pagination. Cache via react-query. Link each entry to the transaction on a block explorer.

**Acceptance Criteria**
The feed shows recent mints, transfers, retirements, and KYC changes for the configured contracts, decoded and human-readable, with explorer links. Filtering by type works. A test mocks `getEvents` and asserts decoding and rendering.

---

### Issue 64: Persist wallet connection across reloads and handle account/network changes

**Description**
The Zustand wallet store loses connection state on page reload, forcing reconnection every visit. It also does not react to the user switching accounts or networks in Freighter, which can leave the app signing with the wrong key or against the wrong network.

**Work to Be Done**
Persist connection intent and re-hydrate on load, and subscribe to Freighter account/network change events.

**Implementation Procedure**
Use Zustand's `persist` middleware to remember that the user opted to connect, then silently re-establish the address on load if Freighter is still authorized. Poll or subscribe (per the Freighter API) for account and network changes; on change, update the store, and if the network no longer matches `NETWORK_PASSPHRASE`, surface a prominent "wrong network" banner blocking transactions. Clear persisted state on explicit disconnect.

**Acceptance Criteria**
Reloading the page keeps the user connected without a manual reconnect (when still authorized). Switching the Freighter account updates the displayed address. Switching to a non-matching network shows a blocking banner. Tests cover re-hydration and the wrong-network state.

---

### Issue 65: Add a KYC management page with verifier and subject status views

**Description**
The KYC page is described as a verifier interface to approve/revoke, but it should also let an admin manage verifiers and let anyone check a subject's status, tier, jurisdiction, and expiry. Without status visibility, operators cannot diagnose why a transfer was blocked.

**Work to Be Done**
Expand the KYC page to cover verifier management (admin), approve/reject/revoke (verifier), and a status lookup (anyone), all reading live state.

**Implementation Procedure**
Add admin-gated `add_verifier`/`remove_verifier` controls visible only when the connected wallet is the registry admin. Add the verifier approve/reject/revoke form with tier, expiry (date picker converting to ledger timestamp), and jurisdiction inputs. Add a "check status" lookup calling `is_approved`/`get_record`/`get_tier`, rendering status, tier label, jurisdiction, and a human-readable expiry. Gate UI sections by the connected role determined from on-chain reads.

**Acceptance Criteria**
Admins can add/remove verifiers; verifiers can approve/reject/revoke with full metadata; anyone can look up a subject's decoded status, tier, jurisdiction, and expiry. Role-based UI gating works. Tests cover each role's visible controls.

---

### Issue 66: Add an Admin page for compliance rule configuration with safe defaults

**Description**
The Admin page configures compliance rules and emergency pause, but the `ComplianceRules` struct has subtle sentinels (0 = unlimited/none) and units (seconds for holding period, stroops for max transfer) that are error-prone to enter raw. A misconfiguration can freeze all transfers.

**Work to Be Done**
Build a guided rule-configuration form with unit-aware inputs, sensible defaults, validation, and a confirmation step before applying.

**Implementation Procedure**
Render each rule with a labeled, unit-aware input: max transfer in human units (converted to stroops), min holding period in days (converted to seconds), max holders as an integer, same-jurisdiction and pause as toggles. Show "unlimited/none" affordances for the zero sentinels. Validate ranges client-side (mirroring Issue 12). Display a diff of current vs. proposed rules and require explicit confirmation before calling `set_rules`. Surface the current rules read live.

**Acceptance Criteria**
The Admin form presents unit-aware inputs with clear sentinel handling, validates inputs, shows a before/after diff, and requires confirmation before applying. Pausing/unpausing is a distinct, clearly-labeled control. Tests cover unit conversions and validation.

---

### Issue 67: Add responsive layout and mobile support

**Description**
The dashboard is a desktop-oriented React app; there is no indication it is responsive. RWA operators and investors may access it on tablets/phones, and a non-responsive layout undermines usability and professionalism.

**Work to Be Done**
Make the layout and all pages responsive across common breakpoints, ensuring forms, tables, and the navigation remain usable on small screens.

**Implementation Procedure**
Audit `Layout.tsx` and `ui.tsx` for fixed widths. Introduce responsive utility classes or CSS (the project uses plain CSS/`clsx`) with breakpoints for mobile/tablet/desktop. Convert the navigation to a collapsible menu on small screens. Make data tables horizontally scrollable or switch to stacked cards on mobile. Verify forms remain single-column and tappable. Test at 320px, 768px, and 1280px.

**Acceptance Criteria**
All pages are usable at 320px, 768px, and 1280px widths without horizontal overflow or clipped controls. Navigation collapses appropriately on mobile. A visual check (and optionally Playwright viewport tests) confirms responsiveness.

---

### Issue 68: Add accessibility (a11y) compliance to WCAG 2.1 AA

**Description**
There is no evidence of accessibility consideration: forms need labels, interactive elements need roles and keyboard support, color contrast must meet AA, and toasts/errors must be announced to screen readers. Public infrastructure should be accessible.

**Work to Be Done**
Audit and remediate the frontend for WCAG 2.1 AA, covering semantics, keyboard navigation, focus management, contrast, and screen-reader announcements.

**Implementation Procedure**
Add an automated a11y check (e.g., `axe-core` via `@axe-core/react` in dev and `jest-axe`/`vitest-axe` in tests). Ensure every input has an associated `<label>`, buttons have accessible names, modals trap and restore focus, the toast region uses `aria-live`, and focus styles are visible. Fix contrast in `index.css` to meet AA. Verify full keyboard operability of every workflow.

**Acceptance Criteria**
Automated axe checks pass with no serious/critical violations on every page. All workflows are completable via keyboard alone. Color contrast meets AA. Error/toast messages are announced to screen readers. a11y tests run in CI.

---

### Issue 69: Add network/environment configuration validation at startup

**Description**
`stellar.ts` reads contract IDs and network from `import.meta.env` with `?? ""` fallbacks, so a missing or empty contract ID silently yields `""`, producing cryptic failures deep in transaction building. There is no startup check that the environment is fully and correctly configured.

**Work to Be Done**
Validate required environment variables at app startup and render a clear configuration-error screen when something is missing or malformed.

**Implementation Procedure**
Add a config module that validates `VITE_STELLAR_NETWORK` is `testnet`/`mainnet`, and that each `VITE_*_ID` is present and a syntactically valid contract ID (`C...`, correct length). On failure, render a configuration-error page listing exactly which variables are missing/invalid and how to set them, instead of letting the app load broken. Type the config so consumers get non-empty strings.

**Acceptance Criteria**
Launching with a missing/empty contract ID shows a clear config-error screen naming the offending variable, not a deep runtime crash. Valid config loads normally. A test asserts the validation rejects empty and malformed IDs.

---

### Issue 70: Add a read-only "explorer" mode usable without a wallet

**Description**
Every page may assume a connected wallet, but prospective users and auditors should be able to browse asset metadata, supply, holders, and retirement receipts without installing Freighter. Gating all reads behind a wallet connection harms adoption and transparency.

**Work to Be Done**
Allow all read-only views (dashboard metrics, asset metadata, activity feed, retirement receipts, KYC status lookup) to function without a connected wallet, gating only signing actions.

**Implementation Procedure**
Separate read paths (simulation-only, no signing) from write paths in the lib clients. Ensure pages render their read-only sections regardless of wallet connection, showing "Connect wallet" prompts only on action controls. Use the RPC server for reads independent of Freighter. Verify no read path calls `signTx`.

**Acceptance Criteria**
With no wallet installed/connected, the dashboard, asset details, activity feed, and status lookups all render live data; only action buttons prompt to connect. A test with the wallet store disconnected confirms read views still populate.

---

## E. DevOps, Tooling & Release Engineering

### Issue 71: Make `deploy.sh` initialize asset tokens, not just deploy them

**Description**
`deploy.sh` deploys the asset tokens (`invoice_token`, `property_token`, `carbon_credit_token`) with no constructor arguments and never calls their `initialize`, leaving them uninitialized and vulnerable to the takeover in Issue 18. The KYC registry and engine are deployed with `--admin`, but the asset tokens are left half-configured, so the resulting `.env` points the frontend at unusable contracts.

**Work to Be Done**
Extend the deploy script to initialize every asset token with the admin, KYC registry, compliance engine, and metadata immediately after deployment (ideally atomically per Issue 18).

**Implementation Procedure**
After deploying each asset token, invoke `stellar contract invoke ... -- initialize` (or pass constructor args if Issue 18 converts to a constructor) with the deployer address as admin and the freshly captured `KYC_ID`/`CE_ID`, plus placeholder or parameterized metadata. Source metadata values from environment variables or a config file so operators can customize per asset. Fail fast (`set -euo pipefail` is present) if any initialization fails. Echo the initialized state.

**Acceptance Criteria**
After running `deploy.sh`, every asset token is initialized with the correct admin, registry, engine, and metadata, and a second `initialize` call panics. The frontend connects to fully usable contracts. The script aborts on any initialization failure.

---

### Issue 72: Make the deploy script idempotent and resumable

**Description**
`deploy.sh` always deploys fresh contracts; rerunning it creates a new set and overwrites `frontend/.env`, orphaning the previous deployment. There is no way to redeploy only one contract or resume after a mid-run failure, which is painful during iterative development and risky in production.

**Work to Be Done**
Add idempotency and selective/resumable deployment so operators can deploy specific contracts and reuse existing IDs.

**Implementation Procedure**
Read existing IDs from `frontend/.env` (or a dedicated `deployments/<network>.json`) and skip contracts that already have a recorded ID unless a `--force`/`--only <contract>` flag is passed. Persist a structured deployments manifest per network alongside `.env`. Add flags to target a single contract. On failure, leave already-deployed IDs recorded so a rerun resumes. Keep `.env` generation as a final step that merges rather than blindly overwrites.

**Acceptance Criteria**
Rerunning `deploy.sh` without flags reuses existing IDs instead of redeploying. `--only compliance_engine` redeploys just that contract and updates only its ID. A mid-run failure can be resumed without redeploying completed contracts. A network-scoped manifest records every deployment.

---

### Issue 73: Add a mainnet deployment guide and production checklist

**Description**
The roadmap lists "Mainnet deployment guide with production checklist" as outstanding. `deploy.sh` defaults to testnet and Friendbot funding, with no documented mainnet path, no key-management guidance, and no pre-flight safety checklist. Teams forking the kit have no safe route to production.

**Work to Be Done**
Write a comprehensive mainnet deployment guide and a production readiness checklist, and make the scripts mainnet-aware.

**Implementation Procedure**
Author `docs/DEPLOY_MAINNET.md` covering: secure key management (hardware wallet / multisig admin), funding from a real account (no Friendbot), setting `STELLAR_NETWORK=mainnet`, verifying WASM hashes before deploy, initializing with production metadata, configuring compliance rules, transferring admin to a multisig (Issue 22), and post-deploy verification. Include a checklist: audits complete (Issue 81), tests/CI green, upgrade path tested (Issue 21), pause tested, monitoring in place. Ensure `deploy.sh` refuses mainnet without an explicit confirmation flag.

**Acceptance Criteria**
`docs/DEPLOY_MAINNET.md` exists with a complete step-by-step guide and a production checklist. `deploy.sh` requires explicit confirmation for mainnet and supports real funding. The README roadmap item is marked done with a link.

---

### Issue 74: Pin toolchain versions and document reproducible builds

**Description**
`rust-toolchain.toml` exists but its contents and pinning are unverified, `soroban-sdk = "22.0.0"` allows semver-compatible drift, and there is no documented way to reproduce the exact WASM that gets deployed. Reproducible builds matter for auditability — a reviewer must be able to rebuild byte-identical WASM.

**Work to Be Done**
Pin the Rust toolchain and dependencies precisely and document a reproducible build procedure that yields verifiable WASM hashes.

**Implementation Procedure**
Verify `rust-toolchain.toml` pins an exact channel and the `wasm32-unknown-unknown` target. Pin `soroban-sdk` to an exact version (`=22.x.y`) and commit `Cargo.lock` (already present). Document a reproducible build using the pinned toolchain (and consider a containerized build) that produces the same optimized WASM hash every time. Add a script `scripts/build-wasm.sh` that builds, optimizes, and prints SHA-256 hashes of each contract WASM.

**Acceptance Criteria**
Building twice on a clean checkout with the pinned toolchain yields identical WASM hashes. `scripts/build-wasm.sh` prints reproducible hashes. The reproducible-build procedure is documented for auditors.

---

### Issue 75: Add a Stellar CLI task runner for common admin operations

**Description**
The roadmap lists "Stellar CLI task runner for common admin operations" as outstanding. Operators currently must hand-craft `stellar contract invoke` commands for routine actions (approve KYC, set rules, pause, mint, deposit dividend), which is error-prone. A thin task runner would standardize these.

**Work to Be Done**
Create a script-based task runner (Makefile or `scripts/admin.sh`) wrapping common admin invocations with named subcommands and argument validation.

**Implementation Procedure**
Add `scripts/admin.sh` (or a `justfile`/`Makefile`) with subcommands like `kyc-approve <subject> <tier> <expiry> <jurisdiction>`, `set-rules ...`, `pause`/`unpause`, `mint <token> <to> <amount>`, `deposit-dividend <amount>`, and `retire <amount> <beneficiary> <reason>`. Each reads contract IDs from the deployments manifest/`.env`, validates arguments, and invokes `stellar contract invoke` with the right source account and network. Provide `--help` and dry-run output.

**Acceptance Criteria**
Operators can perform each common admin action via a single named command that validates inputs and uses the correct contract IDs and network. `--help` documents all subcommands. A dry-run prints the underlying CLI call without executing.

---

### Issue 76: Add a `Dockerfile`/dev-container for reproducible local development

**Description**
Setting up the project requires Rust, the wasm target, the Stellar CLI, and Node ≥ 20 — a non-trivial toolchain that varies across machines and is a barrier to contributors. There is no container or dev-container definition to standardize the environment.

**Work to Be Done**
Provide a Docker image and a `.devcontainer` configuration with the full toolchain preinstalled.

**Implementation Procedure**
Create a `Dockerfile` based on a Rust image, adding the pinned toolchain, the `wasm32-unknown-unknown` target, the Stellar CLI, and Node ≥ 20. Add a `.devcontainer/devcontainer.json` referencing it so VS Code/Codespaces work out of the box. Document `docker build`/`docker run` usage for building contracts and running the frontend. Cache dependencies in image layers for speed.

**Acceptance Criteria**
A contributor can build contracts and run the frontend entirely inside the provided container with no host toolchain. The dev-container opens in VS Code/Codespaces ready to build and test. Documentation describes both flows.

---

### Issue 77: Add dependency vulnerability scanning (`cargo audit`, `npm audit`)

**Description**
There is no automated dependency vulnerability scanning for either the Rust workspace or the frontend. RWA infrastructure handling value must track advisories in `soroban-sdk`'s dependency tree and the npm packages (Stellar SDK, React, etc.).

**Work to Be Done**
Add `cargo audit` and `npm audit` (or equivalents) to CI with a policy for handling findings.

**Implementation Procedure**
Add `cargo-audit` and run it against `Cargo.lock` in CI, failing on known vulnerabilities with an allowlist for accepted/false-positive advisories documented with rationale. Add `npm audit --audit-level=high` in the frontend job. Optionally enable Dependabot/Renovate for automated update PRs. Document the triage process for new advisories.

**Acceptance Criteria**
CI runs `cargo audit` and `npm audit` on every PR and fails on high/critical advisories not explicitly allowlisted. An advisory allowlist with justifications exists. Dependency update automation is configured.

---

### Issue 78: Add release automation with versioned WASM artifacts and changelog

**Description**
There is no release process: no tagged releases, no published WASM artifacts, no changelog, no versioning of the contracts as a unit. Teams forking the kit cannot pin to a known-good release or know what changed between versions.

**Work to Be Done**
Establish a release workflow that tags versions, builds and attaches optimized WASM artifacts with hashes, and generates a changelog.

**Implementation Procedure**
Adopt semantic versioning for the kit. Add a GitHub Actions release workflow triggered on tags that builds optimized WASM for all contracts, computes SHA-256 hashes, and attaches them to a GitHub Release with auto-generated or curated release notes. Maintain `CHANGELOG.md` following Keep a Changelog. Coordinate contract `version()` (Issue 36) with release tags.

**Acceptance Criteria**
Pushing a version tag produces a GitHub Release with optimized WASM artifacts and their hashes attached and a populated changelog entry. `CHANGELOG.md` is maintained. Contract `version()` matches the released tag.

---

### Issue 79: Add monitoring and alerting guidance/tooling for deployed contracts

**Description**
Once deployed, there is no recommended way to monitor the contracts for anomalous activity (large transfers, pause events, mass retirements, KYC revocations) or to alert operators. Production RWA infrastructure needs observability.

**Work to Be Done**
Provide monitoring tooling and documentation that watches contract events and surfaces alerts on key conditions.

**Implementation Procedure**
Document the event schema consumers (Issue 33) and provide a sample monitoring script/service that polls the RPC `getEvents`, decodes events, and emits alerts (webhook/Slack/email) on configurable conditions: pause/unpause, blocklist changes, transfers above a threshold, admin changes, and large retirements. Include dashboards guidance (e.g., feeding events into a time-series store). Place sample tooling under `tools/monitoring/`.

**Acceptance Criteria**
Sample monitoring tooling decodes contract events and fires alerts on configured conditions (pause, admin change, large transfer). Documentation explains setup and the conditions worth alerting on. The tool runs against testnet in a demo.

---

### Issue 80: Add a `.gitignore` and repository hygiene audit, and confirm `target/` is not committed

**Description**
A `target/` directory is present in the working tree per the repo layout, and while a `.gitignore` exists (412 bytes), it must be verified that build artifacts, `frontend/.env`, `node_modules/`, and local identity material are all ignored. Committing `frontend/.env` (which `deploy.sh` generates with real contract IDs, and potentially secrets in other setups) or `target/` bloats the repo and risks leaking configuration.

**Work to Be Done**
Audit `.gitignore` and the committed tree to ensure no build artifacts, environment files, dependencies, or secrets are tracked.

**Implementation Procedure**
Review `.gitignore` for entries covering `/target`, `**/target`, `frontend/.env`, `frontend/node_modules`, `node_modules`, editor/OS files, and any key/identity files. Run `git ls-files` to confirm none of these are tracked; if any are, remove them from version control with `git rm --cached` and document the change. Ensure `.env.example` (not `.env`) is the only committed env file. Add a CI check that fails if forbidden paths become tracked.

**Acceptance Criteria**
`git ls-files` shows no `target/`, `node_modules/`, or `.env` (real) files tracked. `.gitignore` covers all artifact/secret paths. Only `.env.example` is committed. A CI guard prevents regressions.

---

## F. Security & Auditing

### Issue 81: Commission and complete an independent Soroban security audit

**Description**
The roadmap explicitly lists "Audit by an independent Soroban security reviewer" as outstanding, yet the kit advertises itself as compliant, auditable infrastructure for tokenizing real-world value. Several real defects already identified (Sections A/B) underscore that the code has not undergone rigorous security review. Shipping RWA infrastructure to mainnet without an audit is unacceptable.

**Work to Be Done**
Prepare the codebase for audit, engage a reputable Soroban auditor, remediate findings, and publish the audit report.

**Implementation Procedure**
First, land the correctness fixes in Sections A/B and freeze a release candidate with reproducible WASM hashes (Issue 74). Prepare an audit scope document describing the trust model, privileged roles, and invariants. Engage an independent Soroban/Rust auditor. Triage and remediate findings by severity, adding regression tests for each. Publish the final report and a remediation summary under `docs/audits/`. Update the roadmap.

**Acceptance Criteria**
An independent audit is completed, all high/critical findings are remediated with regression tests, and the report plus remediation summary are published in the repository. The roadmap item is marked complete with a link to the report.

---

### Issue 82: Add a `SECURITY.md` with a vulnerability disclosure policy

**Description**
There is no `SECURITY.md`, so security researchers have no defined channel to report vulnerabilities responsibly. For value-bearing infrastructure, a clear disclosure policy and contact are essential to avoid public zero-day disclosure.

**Work to Be Done**
Author a `SECURITY.md` defining supported versions, a private reporting channel, expected response timelines, and safe-harbor language.

**Implementation Procedure**
Create `SECURITY.md` at the repository root specifying: which versions are supported, how to report privately (security email or GitHub private vulnerability reporting), expected acknowledgment and remediation timelines, scope (which contracts/components), and good-faith safe-harbor terms. Enable GitHub's private vulnerability reporting. Link it from the README and `CONTRIBUTING.md`.

**Acceptance Criteria**
`SECURITY.md` exists with a working private reporting channel, defined timelines, and scope. GitHub private vulnerability reporting is enabled. The README links to the policy.

---

### Issue 83: Threat-model the privileged admin/verifier roles and add multisig guidance

**Description**
Every contract concentrates power in a single `admin` (and verifiers in the registry). A compromised admin key can pause everything, rewrite compliance rules, mint unlimited supply, and (with Issue 21) upgrade contract logic. There is no threat model documenting these powers or guidance to mitigate single-key risk.

**Work to Be Done**
Produce a threat model enumerating every privileged capability per role and recommend mitigations such as multisig and timelocks.

**Implementation Procedure**
Document, per contract, exactly what the admin and verifier roles can do and the blast radius of a key compromise. Recommend that the admin be a Stellar multisig account or a dedicated governance contract, and consider adding a timelock for high-impact actions (upgrade, rule changes, admin transfer). Cross-reference the two-step admin transfer (Issue 22). Capture residual risks accepted by operators.

**Acceptance Criteria**
A `docs/THREAT_MODEL.md` enumerates all privileged capabilities and their blast radius and recommends concrete mitigations (multisig, timelock). High-impact actions have a documented mitigation path. The threat model is referenced from the security docs.

---

### Issue 84: Add a timelock option for high-impact admin actions

**Description**
Admin actions like upgrading WASM, changing compliance rules, or transferring admin take effect immediately, giving holders no notice or opportunity to exit before a potentially adverse change. A timelock that delays execution of high-impact actions is a standard protection for tokenholders.

**Work to Be Done**
Introduce an optional timelock mechanism for designated high-impact functions across the contracts.

**Implementation Procedure**
Add a generic propose/execute pattern: `propose_action(action_id, params_hash)` records a proposal with `execute_after = now + delay`; `execute_action(...)` runs the action only after the delay and verifies the params match the proposal. Apply to `upgrade`, `set_rules`, and admin transfer, with a configurable delay (0 = disabled for backward compatibility). Emit proposal and execution events. Document the delay's tradeoffs.

**Acceptance Criteria**
With a nonzero timelock, a rule change or upgrade can only execute after the delay and only with parameters matching the proposal. Attempting early execution fails. With delay 0, behavior matches today. Tests cover propose, premature-execute rejection, and post-delay execution.

---

### Issue 85: Audit and harden all `unwrap()`/`expect()` against uninitialized state

**Description**
Many functions call `env.storage().instance().get(&DataKey::Admin).unwrap()` and similar, which panic if invoked before `initialize`. While a fresh contract is normally initialized immediately, the deploy gap (Issue 18) and any future code path could call these pre-init, producing opaque panics. Some `expect("no KYC record")` paths panic on ordinary user input (Issue 6).

**Work to Be Done**
Audit every `unwrap`/`expect` and replace user-reachable ones with explicit, descriptive errors, reserving panics for genuine invariant violations.

**Implementation Procedure**
Enumerate all `unwrap`/`expect` across `contracts/`. Classify each as (a) invariant (only fails if contract is mis-deployed) or (b) user-reachable. For (b), return or panic with a clear, specific message (e.g., "contract not initialized", "no KYC record for subject"). For (a), add a `require_initialized` helper that panics with a uniform message and use it consistently. Add tests for the pre-initialization call paths.

**Acceptance Criteria**
No user-reachable `unwrap`/`expect` produces an opaque panic; each yields a descriptive message. A test calling a function before `initialize` panics with "not initialized". The classification is documented in the PR.

---

### Issue 86: Define and use a structured contract error type instead of `panic!` strings

**Description**
The contracts signal failures with `panic!("...")` string messages. Soroban supports `#[contracterror]` enums that produce typed, numeric error codes consumable by clients and the SDK. String panics are harder to match on programmatically, are not part of a stable ABI, and complicate frontend error mapping (Issue 58).

**Work to Be Done**
Introduce a `#[contracterror]` enum per contract (or a shared crate) and replace `panic!` strings with typed errors returned via `Result`/`panic_with_error!`.

**Implementation Procedure**
Define an `Error` enum per contract with stable numeric discriminants (e.g., `AlreadyInitialized = 1`, `NotAuthorized = 2`, `KycNotApproved = 3`, `InsufficientBalance = 4`, `ComplianceBlocked = 5`, ...). Replace each `panic!` with `panic_with_error!(&env, Error::Variant)` or return `Result<_, Error>`. Keep numbers stable across versions. Update the frontend error translator (Issue 58) to map codes to messages. Document the error catalog.

**Acceptance Criteria**
Each contract exposes a stable `#[contracterror]` enum and uses it consistently instead of string panics. Clients can match on numeric codes. The frontend maps codes to friendly messages. A documented error catalog exists. Tests assert specific error codes.

---

### Issue 87: Prevent self-transfers and zero-address-like edge cases

**Description**
The token transfer functions do not check whether `from == to`. A self-transfer wastes fees, emits a misleading event, and in the property token's accrual logic (`accrue(from); accrue(to)` on the same address) could double-process or interact unexpectedly with reward-debt math. Edge cases like transferring to oneself should be explicitly handled.

**Work to Be Done**
Add explicit handling for `from == to` across all transfer paths and verify the dividend accrual math is correct (or rejected) in that case.

**Implementation Procedure**
In each token's `transfer`/`transfer_from`, decide policy: either reject self-transfers with a clear error, or make them safe no-ops that still pass compliance. For `property-token`, trace the `accrue`/`reset_debt` sequence when `from == to` to ensure no double counting; the safest path is to reject self-transfers. Add the guard early in each function. Add tests for the self-transfer case on every token.

**Acceptance Criteria**
Self-transfers are handled by an explicit, documented policy (rejected or provably-safe no-op) on every token. The property token's dividend accounting is verified correct (or the case rejected) for `from == to`. Tests cover self-transfer on each token.

---

### Issue 88: Add invariant checks / assertions for supply and pool conservation

**Description**
Critical invariants — total supply equals the sum of balances, the dividend pool equals total unclaimed dividends, total retired plus circulating equals total ever issued — are never asserted. A subtle bug could silently violate these, and there is no in-contract or in-test guard.

**Work to Be Done**
Document the conservation invariants for each contract and add test-time (and optionally debug-build) assertions verifying them after every operation.

**Implementation Procedure**
For each contract, write down its invariants. In tests, after each mutating operation, recompute and assert: sum of tracked balances == `total_supply`; `DividendPool` == sum of all holders' (`unclaimed` + `accrued`) + remainder; `total_retired` monotonic and `supply + retired` conserved. Consider `debug_assert!`-style checks gated behind the `release-with-logs` profile. Use the integration suite (Issue 41) and property tests (Issue 42) to enforce them broadly.

**Acceptance Criteria**
Documented invariants exist per contract and are asserted in tests after operations. A deliberately broken supply update is caught by an invariant assertion. The property/integration suites enforce conservation across randomized sequences.

---

### Issue 89: Review cross-contract authorization scoping (`require_auth` propagation)

**Description**
Asset tokens call into the KYC registry and compliance engine. When `register_holder`/`deregister_holder` (Issues 1/15) are added, those calls must be authorized appropriately so a token can update engine state without granting overly broad authority, and without requiring the end-user to separately authorize engine calls. The authorization scoping of these cross-contract calls needs deliberate design.

**Work to Be Done**
Design and document the authorization model for cross-contract state-mutating calls so privileges are least-privilege and not user-confusing.

**Implementation Procedure**
Determine which cross-contract calls mutate state (engine holder registration) versus read-only (KYC `is_approved`, engine `can_transfer`). For mutating calls, decide whether the engine should accept calls only from registered asset tokens (maintain an allow-list of authorized token contracts in the engine, gated by admin) rather than relying on user auth. Implement an `authorized_tokens` set the engine checks via `env.current_contract_address()`/invoker identity. Document the trust flow end-to-end.

**Acceptance Criteria**
Only admin-registered asset tokens can mutate engine holder state; arbitrary callers are rejected. End users do not need to separately authorize engine mutations beyond their token transaction. The authorization flow is documented. Tests cover authorized-token-allowed and rogue-caller-rejected.

---

### Issue 90: Add sanctioned-address screening hooks (OFAC-style) to the compliance flow

**Description**
The blocklist is a manual admin list, but real RWA compliance requires screening against sanctions lists (OFAC SDN, etc.). There is no hook to integrate an external/maintained screening source, and the manual blocklist will inevitably lag real-world designations.

**Work to Be Done**
Provide an extensible screening hook so operators can plug in an oracle/feed that augments the manual blocklist with sanctions screening.

**Implementation Procedure**
Define a `ScreeningProvider` `#[contractclient]` trait with `is_sanctioned(addr) -> bool`. Let the compliance engine optionally reference a screening provider contract (admin-set) and consult it in `can_transfer` in addition to the manual blocklist. Provide a reference provider that an off-chain keeper updates from sanctions data. Document the operational responsibility and update cadence. Combine with the rule-module design (Issue 32) if pursued.

**Acceptance Criteria**
With a screening provider configured, transfers involving a sanctioned address are blocked even if not on the manual blocklist. Without a provider, behavior is unchanged. A reference provider and keeper update path are documented. Tests cover provider-blocks and no-provider-passthrough.

---

## G. Documentation

### Issue 91: Correct the README's false CI and roadmap claims

**Description**
The README's Roadmap marks "CI pipeline (GitHub Actions)" and "Soroban test suite with simulated KYC and compliance scenarios" as complete and the Repository Layout shows `.github/workflows/ci.yml`, but no `.github` directory exists. The README therefore misrepresents the project's quality posture to anyone evaluating it. Documentation must match reality.

**Work to Be Done**
Reconcile the README with the actual repository state — either by implementing the missing CI (Issue 61) and then keeping the claim, or by correcting the README until it lands.

**Implementation Procedure**
Audit every roadmap checkbox and repository-layout entry against the actual tree. Until Issue 61 lands, change the CI claim from done to in-progress and remove the `.github/workflows/ci.yml` layout line (or mark it as planned). Verify the test-suite claim by confirming the `test.rs` files contain meaningful scenarios; adjust wording if coverage is thin. Add a note that the roadmap reflects current status as of a dated revision.

**Acceptance Criteria**
Every README roadmap item and layout entry accurately reflects the repository state. No advertised file or pipeline is missing. The roadmap carries a "as of <date>" note. Once CI lands, the claim is restored truthfully.

---

### Issue 92: Add per-contract API reference documentation

**Description**
There is no reference documentation for the contracts' public interfaces beyond inline comments and the README table. Developers forking the kit must read source to learn every function's parameters, authorization requirements, events, and error conditions. A generated or hand-written API reference is needed.

**Work to Be Done**
Produce comprehensive API reference docs for each contract covering every public function: signature, parameters, auth requirements, events emitted, errors/panics, and storage effects.

**Implementation Procedure**
For each contract, write `docs/contracts/<name>.md` documenting every `pub fn`: purpose, parameters with units, who must authorize, what events fire, what conditions cause failure, and storage TTL behavior. Generate `cargo doc` output for the Rust-level docs and link it. Keep the docs adjacent to the schema/error catalog (Issue 86) and event schema (Issue 33). Add a docs index.

**Acceptance Criteria**
Each contract has a complete reference page covering all public functions, auth, events, and errors. `cargo doc` builds cleanly with documented public items. A docs index links everything. The reference matches the implementation.

---

### Issue 93: Write an end-to-end tutorial: tokenize an invoice from zero

**Description**
The README's Quick Start gets contracts deployed but does not walk a new user through a complete real workflow (set up KYC, approve holders, configure compliance, issue an invoice token, transfer it, settle, redeem). New adopters need a guided, copy-pasteable tutorial to understand how the pieces fit.

**Work to Be Done**
Write a step-by-step tutorial that takes a reader from a fresh checkout to a fully exercised invoice lifecycle, using the CLI and the frontend.

**Implementation Procedure**
Author `docs/tutorials/invoice-lifecycle.md`: set up an identity, deploy, add a verifier, approve two holders with tiers/jurisdictions, configure compliance rules, initialize and issue an invoice token, perform a compliant transfer (and show a blocked one), settle, and redeem — each with exact commands and expected output, plus the corresponding frontend screens. Cross-link the property dividend and carbon retirement flows as companion tutorials.

**Acceptance Criteria**
A reader can follow the tutorial verbatim on testnet and complete the full invoice lifecycle, including observing a compliance-blocked transfer. Companion tutorials exist for property dividends and carbon retirement. Commands and outputs are accurate.

---

### Issue 94: Document the compliance model and rule semantics in depth

**Description**
The compliance rules carry subtle semantics — sentinel zeros, holding-period scoping, max-holder counting, same-jurisdiction enforcement — that are not documented anywhere coherently. Operators configuring real offerings need a precise, example-driven reference to avoid misconfiguration that could freeze transfers or violate regulations.

**Work to Be Done**
Write a comprehensive compliance model document covering every rule, its exact semantics, units, sentinels, interactions, and worked examples.

**Implementation Procedure**
Author `docs/COMPLIANCE.md` describing each `ComplianceRules` field: meaning, unit, sentinel value, and enforcement point. Document the order of checks in `can_transfer`, the KYC gating (approval + expiry + tier), the blocklist, and how mints/transfers/burns each interact with the rules (reflecting the Section A/B fixes). Provide worked examples for common offering types (Reg D holder cap, lockup period, jurisdiction-restricted). Note known limitations.

**Acceptance Criteria**
`docs/COMPLIANCE.md` precisely documents every rule's semantics, units, sentinels, and enforcement point, with at least three worked offering examples. It matches the implemented behavior after Section A/B fixes. It is linked from the README.

---

### Issue 95: Add architecture decision records (ADRs)

**Description**
Key design choices — protocol-level compliance enforcement, the reward-debt dividend algorithm, instance-vs-persistent storage choices, single-engine-per-token wiring — are undocumented as decisions. Future contributors cannot understand why things are the way they are, risking accidental reversal of deliberate tradeoffs.

**Work to Be Done**
Establish an ADR process and backfill ADRs for the major existing architectural decisions.

**Implementation Procedure**
Create `docs/adr/` with a template (context, decision, consequences, alternatives). Backfill ADRs for: enforcing compliance via cross-contract calls in the token; the O(1) reward-debt dividend mechanism; storage durability choices and TTL constants; the asset-token-extends-rwa-token pattern; and the choice of `i128` units/decimals per asset. Reference ADRs from related code and docs. Require new significant changes to add an ADR.

**Acceptance Criteria**
`docs/adr/` exists with a template and at least five backfilled ADRs covering the major decisions. `CONTRIBUTING.md` requires ADRs for significant changes. ADRs are linked from relevant code/docs.

---

### Issue 96: Document the extension guide for new asset types

**Description**
The README says new asset types extend `rwa-token`, but `invoice-token`, `property-token`, and `carbon-credit-token` are actually standalone contracts that re-implement balances and KYC/compliance wiring rather than importing `rwa-token`. The documented extension story does not match the code, and there is no concrete guide for building a new asset type.

**Work to Be Done**
Reconcile the extension story with reality and write a concrete guide (and ideally a template) for adding a new asset type.

**Implementation Procedure**
Clarify in docs whether asset tokens extend `rwa-token` (they currently do not) or are standalone — and decide whether to refactor toward a shared base (Issue 97) or document the standalone pattern. Write `docs/EXTENDING.md` showing how to scaffold a new asset contract: declaring metadata, wiring KYC/compliance, implementing lifecycle, registering in the workspace, deploy script, and frontend page. Provide a minimal template contract under `contracts/asset-template/` or an example.

**Acceptance Criteria**
`docs/EXTENDING.md` accurately describes the real architecture and gives a step-by-step path to a new asset type, validated by scaffolding a trivial example. The README's extension claims match the documented reality.

---

### Issue 97: Refactor asset tokens to share a common base (reduce duplication)

**Description**
`invoice-token`, `property-token`, and `carbon-credit-token` each re-implement nearly identical KYC/compliance wiring, balance storage, `require_admin`, and the `kyc_iface`/`compliance_iface` client modules. This duplication contradicts the README's claim that asset types "extend `rwa-token`" and multiplies the surface for bugs (a fix in one is easily missed in the others, as Section A shows).

**Work to Be Done**
Extract the shared compliance/KYC/balance/admin logic into a reusable library crate consumed by all asset tokens, aligning code with the documented "extends rwa-token" model.

**Implementation Procedure**
Create a `contracts/rwa-core` library crate (or expose `rwa-token`'s internals as a lib) providing reusable modules: admin management, KYC client + `require_kyc`, compliance client + `check_compliance`/`register_holder`, and balance storage helpers. Refactor each asset token to depend on it, removing the duplicated `kyc_iface`/`compliance_iface` modules and helper functions. Keep WASM size in budget (Issue 55). Migrate tests accordingly.

**Acceptance Criteria**
The KYC/compliance/balance/admin boilerplate exists once in a shared crate and is reused by all asset tokens; the duplicated modules are removed. All tests pass and WASM sizes remain within budget. The architecture matches the documented extension model.

---

### Issue 98: Add a glossary and concept overview for non-Stellar developers

**Description**
The kit targets teams that may be new to Stellar/Soroban. Terms like ledger TTL, persistent vs. instance storage, stroops, SEP-41, Friendbot, and contract IDs are used without a glossary. A concept overview lowers the barrier for the broad audience the project wants to serve as "public infrastructure."

**Work to Be Done**
Write a glossary and a concise concept overview orienting newcomers to the Stellar/Soroban concepts the kit relies on.

**Implementation Procedure**
Author `docs/GLOSSARY.md` defining the key terms with links to authoritative Stellar docs. Author `docs/CONCEPTS.md` giving a short tour of Soroban contracts, storage durability and TTLs, fees/resources, accounts vs. contract addresses, and the wallet/signing flow. Link both from the README's top and from the Quick Start. Keep definitions short and example-driven.

**Acceptance Criteria**
`docs/GLOSSARY.md` and `docs/CONCEPTS.md` exist, cover the terms used throughout the repo, and are linked from the README. A newcomer can read them in under 15 minutes and understand the Quick Start. Links to upstream Stellar docs are valid.

---

### Issue 99: Add inline code documentation and module-level docs across contracts

**Description**
Some contracts have helpful module headers (invoice, property, carbon) while `rwa-token`, `kyc-registry`, and `compliance-engine` have sparser documentation. Public functions often lack doc comments explaining authorization, units, and side effects, which reduces `cargo doc` usefulness and onboarding speed.

**Work to Be Done**
Add thorough `//!` module docs and `///` doc comments to all public items across the contract suite.

**Implementation Procedure**
For each contract, add a module-level `//!` overview describing purpose, storage model, and trust assumptions. Add `///` comments to every public function covering parameters (with units), authorization requirements, emitted events, and failure conditions. Enable `#![deny(missing_docs)]` on the public surface where practical. Verify `cargo doc --no-deps` renders cleanly. Align wording with the API reference (Issue 92).

**Acceptance Criteria**
Every public function and contract module has descriptive doc comments. `cargo doc --no-deps` builds without missing-docs warnings on the public API. The rendered docs are coherent and match behavior.

---

### Issue 100: Add issue and pull-request templates and a contributor checklist

**Description**
`CONTRIBUTING.md` exists but there are no GitHub issue/PR templates to standardize contributions, and no checklist reminding contributors to run `cargo check --target wasm32-unknown-unknown` and `cargo test --features testutils` (which CONTRIBUTING already requests). Standard templates improve contribution quality and triage.

**Work to Be Done**
Add issue templates (bug, feature, security pointer to SECURITY.md), a PR template with a contributor checklist, and a CODEOWNERS file.

**Implementation Procedure**
Create `.github/ISSUE_TEMPLATE/` with structured forms for bug reports and feature requests, plus a config pointing security reports to `SECURITY.md` (Issue 82). Create `.github/pull_request_template.md` with a checklist: tests added/updated, `cargo fmt`/`clippy` clean, wasm check passes, docs updated, changelog entry added. Add a `CODEOWNERS` file routing reviews. Reference the templates from `CONTRIBUTING.md`.

**Acceptance Criteria**
Opening an issue or PR presents the appropriate template. The PR template includes the build/test/docs checklist matching `CONTRIBUTING.md`. `CODEOWNERS` routes reviews. Security reports are redirected to `SECURITY.md`.

---

## H. TypeScript SDK & Developer Experience

### Issue 101: Generate TypeScript contract clients/bindings from the contract ABIs

**Description**
The roadmap lists "TypeScript SDK wrapping contract clients for frontend developers" as outstanding. The frontend currently builds transactions manually in `stellar.ts` with no typed bindings, so contract method calls are stringly-typed and error-prone, and metadata structs (`InvoiceMeta`, `PropertyMeta`, `ProjectMeta`, `KycRecord`, `ComplianceRules`) have no generated TS equivalents.

**Work to Be Done**
Generate typed TypeScript clients for every contract using the Stellar CLI's binding generator and publish them for frontend/consumer use.

**Implementation Procedure**
Use `stellar contract bindings typescript` against each deployed/compiled contract to generate typed client packages. Place them under `packages/<contract>-client/` (introduce an npm workspace). Wire generation into the build/deploy pipeline so bindings stay in sync with contract changes. Replace the frontend's hand-rolled invocation code with the generated clients. Version the bindings alongside contract releases (Issue 78).

**Acceptance Criteria**
Typed clients exist for all six contracts, generated from their ABIs, with typed methods and struct types. The frontend uses them instead of manual XDR building for at least the core flows. Bindings regenerate as part of the build. Types match the on-chain schemas.

---

### Issue 102: Publish a high-level `@veritoken/sdk` package wrapping the generated clients

**Description**
Generated bindings are low-level; frontend developers want ergonomic, workflow-oriented helpers (e.g., `tokenizeInvoice(meta)`, `approveHolder(...)`, `retireCarbon(...)`) that compose the generated clients, handle simulation/signing/polling, and surface typed results. A higher-level SDK is the deliverable named in the roadmap.

**Work to Be Done**
Build and publish a `@veritoken/sdk` package providing ergonomic, workflow-level functions over the generated clients and the wallet/signing flow.

**Implementation Procedure**
Create `packages/sdk` exporting a `Veritoken` class configured with network and contract IDs, exposing methods for each major workflow that wrap the generated clients, perform simulate/assemble/sign/poll (reusing the hardened logic from Issue 57), and return typed results. Provide pluggable signing (Freighter or a keypair) so it works in browser and Node. Document usage and publish to npm under a scoped name. Migrate the frontend to consume the SDK.

**Acceptance Criteria**
`@veritoken/sdk` exposes typed, workflow-level methods for KYC, compliance, and each asset lifecycle, usable in both browser and Node with pluggable signing. The frontend consumes it. The package is documented and publishable. Example snippets compile.

---

### Issue 103: Add SDK example scripts and a Node-based quickstart

**Description**
Even with an SDK, developers need runnable examples showing common tasks end-to-end from Node, independent of the React frontend. There are no example scripts demonstrating programmatic use against testnet.

**Work to Be Done**
Provide a set of runnable Node example scripts using `@veritoken/sdk` for the key workflows, plus a Node quickstart doc.

**Implementation Procedure**
Add `examples/` scripts: deploy-and-init (or connect to existing IDs), approve KYC, configure compliance, tokenize an invoice and transfer, fractionalize a property and pay a dividend, and issue and retire carbon credits — each runnable with `ts-node`/`tsx` against testnet using a funded key. Write `docs/SDK_QUICKSTART.md` walking through running them. Keep secrets out of the repo (read keys from env).

**Acceptance Criteria**
Runnable example scripts exist for each major workflow and execute successfully against testnet with a funded key. `docs/SDK_QUICKSTART.md` explains setup and running. No secrets are committed.

---

### Issue 104: Add typed event decoders to the SDK

**Description**
Consuming contract events (for the activity feed in Issue 63 and monitoring in Issue 79) requires decoding XDR topics and data into typed objects. Without shared decoders, every consumer re-implements brittle decoding. The SDK should provide typed event decoders matching the event schema (Issue 33).

**Work to Be Done**
Add event-decoding utilities to `@veritoken/sdk` that turn raw RPC events into typed, discriminated union event objects.

**Implementation Procedure**
Define TypeScript types for every contract event per the schema (Issue 33). Implement decoders that parse RPC `getEvents` results (topics + data ScVals) into the typed union, handling each contract's event set. Provide a `fetchEvents(filter)` helper that paginates over ledger ranges. Add unit tests with recorded event fixtures. Use these decoders in the frontend activity feed and the monitoring tool.

**Acceptance Criteria**
The SDK decodes all contract events into typed objects, validated against recorded fixtures. `fetchEvents` paginates correctly. The frontend activity feed and monitoring tool use the shared decoders. Tests cover each event type.

---

### Issue 105: Add SDK retry/backoff and RPC failover configuration

**Description**
The single hardcoded RPC URL in `stellar.ts` has no failover, and transient RPC errors are not retried. For production SDK use, consumers need configurable RPC endpoints with failover and retry/backoff on transient failures, plus rate-limit handling.

**Work to Be Done**
Add configurable RPC endpoints with automatic failover and retry/backoff for transient errors to the SDK's RPC layer.

**Implementation Procedure**
Allow the SDK to be configured with a primary and one or more fallback RPC URLs. Wrap RPC calls with retry/backoff that distinguishes transient (5xx, network, rate-limit) from permanent errors, failing over to the next endpoint after retries are exhausted. Make timeouts and retry counts configurable. Surface a typed error when all endpoints fail. Add tests with a mock RPC simulating failures.

**Acceptance Criteria**
The SDK retries transient RPC errors with backoff and fails over to configured fallback endpoints. Permanent errors are not retried. All-endpoints-failed yields a clear typed error. Tests simulate transient failures, rate limits, and failover.

---

## I. Additional Contract Features & Robustness

### Issue 106: Add a snapshot mechanism for governance/voting and dividend record dates

**Description**
Property tokens distribute dividends pro-rata to current holders, but there is no way to snapshot balances at a specific record date for governance votes or dividends that should accrue to holders as of a past block. Many real-world distributions and votes require a record date, which the current design cannot honor.

**Work to Be Done**
Add a balance-snapshot capability that records holder balances at a checkpoint for use by dividends and governance.

**Implementation Procedure**
Implement a checkpoint pattern: on each balance change, append a `(ledger, balance)` checkpoint per holder, and provide `balance_at(addr, ledger) -> i128` via binary search over checkpoints. Add `total_supply_at(ledger)`. Let `deposit_dividend` optionally target a record-date snapshot. Bound checkpoint storage growth (prune or cap history) to avoid unbounded storage. Document the storage cost tradeoff.

**Acceptance Criteria**
`balance_at(addr, pastLedger)` returns the correct historical balance. A record-date dividend pays holders by their snapshot balances, not current ones. Storage growth is bounded. Tests cover snapshot correctness across mints/transfers and a record-date distribution.

---

### Issue 107: Add KYC tier-based transfer limits in the compliance engine

**Description**
KYC tiers (Basic/Accredited/Institutional) are recorded but only `property-token` uses them, and only as a minimum gate. Regulations often impose different transfer/holding limits by investor accreditation tier (e.g., basic investors capped at a small position). The compliance engine cannot express tier-dependent limits.

**Work to Be Done**
Allow the compliance engine to enforce tier-dependent transfer and position limits by querying the KYC registry for each party's tier.

**Implementation Procedure**
Extend the engine with a per-tier limit table (e.g., max position and max transfer per tier) stored under a new `DataKey::TierLimits`, admin-managed. In `can_transfer`, look up the recipient's tier from the registry (link established in Issue 3) and apply the tier-specific caps in addition to global rules. Define precedence between global and tier limits (most-restrictive wins). Document the configuration.

**Acceptance Criteria**
A basic-tier holder is capped at the configured tier limit while an institutional holder is not, with both subject to global limits. Most-restrictive precedence holds. Tests cover each tier's limit and the global-vs-tier interaction.

---

### Issue 108: Add forced transfer / clawback for regulatory recovery

**Description**
Regulated securities sometimes require a forced transfer (clawback) — e.g., recovering tokens sent to a wallet later found fraudulent, or executing a court-ordered transfer. The contracts provide no admin-gated forced transfer, which is a hard requirement for many securities regimes.

**Work to Be Done**
Add an admin-gated, auditable forced-transfer function to the asset tokens, with strict authorization and event logging.

**Implementation Procedure**
Add `force_transfer(from, to, amount, reason)` callable only by admin (and ideally behind the timelock from Issue 84 and multisig from Issue 83). It moves balances without the `from` party's auth, still requires the recipient to be KYC-approved, bypasses or honors compliance per documented policy, registers/deregisters holders appropriately, and emits a distinct `forced_transfer` event including the reason. Document the legal/operational guardrails and that this power is a centralization tradeoff.

**Acceptance Criteria**
Admin can execute a forced transfer that moves tokens without the source's signature, recorded with a reason in a distinct event. Non-admins cannot. The recipient must be KYC-approved. Tests cover admin-allowed, non-admin-rejected, and event emission. The capability is documented in the threat model.

---

### Issue 109: Add carbon credit retirement certificate metadata and verifiable retirement proof

**Description**
`RetirementReceipt` stores retiree, amount, timestamp, beneficiary, and reason, but there is no stable, externally-verifiable certificate identifier linking the on-chain retirement to an off-chain certificate (PDF/registry confirmation). Carbon buyers need a verifiable proof artifact for ESG reporting.

**Work to Be Done**
Extend retirement to produce a verifiable certificate reference (e.g., an IPFS hash and a unique certificate ID) and expose a lookup.

**Implementation Procedure**
Add a `certificate_id` (monotonic) and an optional `ipfs_cert_hash` to `RetirementReceipt`, set at retirement (the hash supplied by the retiree or generated off-chain and anchored). Provide `get_retirement_certificate(certificate_id)` returning the full receipt. Emit the certificate ID in the retirement event. Document how off-chain certificate generation anchors to the on-chain ID/hash, enabling third-party verification.

**Acceptance Criteria**
Each retirement yields a unique certificate ID retrievable on-chain, optionally with an IPFS document anchor. The retirement event includes the certificate ID. A documented verification flow lets a third party confirm a certificate against the chain. Tests cover ID uniqueness and lookup.

---

### Issue 110: Add property valuation update and revaluation history

**Description**
`PropertyMeta.total_valuation_usd` is set once at initialization and never updated, but real-estate valuations change over time and holders need a current NAV and history. There is no revaluation function or history.

**Work to Be Done**
Add an admin-gated revaluation function that updates the property's valuation and records a timestamped revaluation history.

**Implementation Procedure**
Add `revalue(new_valuation_usd, valuation_source)` (admin-gated, ideally behind timelock for material changes) that updates the stored valuation and appends a `(timestamp, valuation, source)` entry to a bounded history. Expose `current_valuation()` and paginated `valuation_history()`. Emit a `revalued` event. Derive a per-share NAV view (`valuation / total_shares`). Document the source-of-truth/oracle considerations.

**Acceptance Criteria**
Admin can revalue the property; the new valuation and per-share NAV reflect immediately and the change is recorded in history with a timestamp and source. Non-admins cannot revalue. Tests cover revaluation, history append, and NAV computation.

---

### Issue 111: Add invoice late-payment penalty and grace-period logic

**Description**
`InvoiceMeta.due_date` is recorded but nothing happens when it passes. Real invoices may accrue late penalties or enter a grace period before default. The contract has no notion of overdue status, penalty accrual, or grace handling.

**Work to Be Done**
Add overdue detection, an optional grace period, and configurable late-penalty accrual that affects redemption value.

**Implementation Procedure**
Add a `grace_period` and `late_penalty_bps` to the invoice config. Provide an `invoice_status()` view returning `Current`/`Overdue`/`InGrace`/`Defaulted` based on `now` vs. `due_date + grace_period`. Accrue late penalties into the redemption value (or as a separate claim) per a documented formula. Integrate with the partial-settlement/default model (Issue 29). Emit status-transition events where appropriate.

**Acceptance Criteria**
`invoice_status()` correctly reflects current/overdue/grace/default based on time. Late penalties accrue per the documented formula and affect redemption value. Tests cover each status transition at boundary timestamps and penalty math.

---

### Issue 112: Add a circuit breaker for anomalous transfer volume

**Description**
Beyond manual pause, there is no automatic protection against a sudden anomalous spike in transfer volume that might indicate an exploit or compromised admin minting. A rate-limiting circuit breaker (max volume per time window) would contain damage automatically.

**Work to Be Done**
Add a configurable per-window transfer-volume circuit breaker to the compliance engine that auto-blocks once a threshold is exceeded until reset.

**Implementation Procedure**
Add rolling-window accounting in the engine: track cumulative transferred volume within the current window (window length and threshold admin-configured). In `can_transfer`, reject when adding `amount` would exceed the window threshold, and emit a `breaker_tripped` event. Provide an admin `reset_breaker`. Use coarse fixed windows to bound storage/compute. Document the tradeoff (false positives during legitimate spikes).

**Acceptance Criteria**
Once per-window volume exceeds the configured threshold, further transfers are blocked until the window rolls over or an admin resets the breaker, with an event emitted. Tests cover under-threshold-pass, over-threshold-block, window-rollover, and admin reset.

---

### Issue 113: Add support for transfer memos / compliance notes on transfers

**Description**
Regulated transfers sometimes require an attached reason or reference (e.g., settlement instruction ID) for audit trails. The transfer functions accept only amounts, so there is no on-chain record of transfer purpose beyond the event.

**Work to Be Done**
Add an optional memo/reference parameter to transfer functions, recorded in the emitted event for audit purposes.

**Implementation Procedure**
Add an overloaded or extended `transfer_with_memo(from, to, amount, memo: String)` (and equivalents) that behaves identically to `transfer` but includes the memo in the emitted event. Keep the plain `transfer` for SEP-41 compatibility. Bound memo length to control storage/event size. Document the audit use case and that memos are public on-chain. Surface the memo field in the frontend and activity feed.

**Acceptance Criteria**
A transfer can carry an optional memo that appears in its event and the activity feed. Memo length is bounded. SEP-41 `transfer` remains unchanged. Tests cover memo emission and length bounds.

---

### Issue 114: Add multi-signature verifier requirement for high-value KYC approvals

**Description**
A single verifier can unilaterally approve any subject at any tier, including the highest (institutional). For sensitive approvals, requiring M-of-N verifier sign-off reduces the risk of a single compromised or rogue verifier onboarding fraudulent holders.

**Work to Be Done**
Add an optional M-of-N multi-verifier approval flow for approvals above a configurable tier threshold.

**Implementation Procedure**
Add a configurable threshold (tier above which multi-sig is required) and a quorum `M`. Implement `propose_approval(subject, tier, ...)` recording the proposal and the first verifier's endorsement, and `endorse_approval(proposal_id)` for additional verifiers; once `M` distinct verifiers endorse, the approval is written. Below-threshold approvals keep the single-verifier fast path. Emit proposal/endorsement/finalization events. Bound pending proposals.

**Acceptance Criteria**
Approvals above the configured tier require M distinct verifier endorsements before taking effect; below-threshold approvals work with one verifier. A single verifier cannot finalize a high-tier approval alone. Tests cover quorum reached, quorum not reached, and duplicate-endorsement rejection.

---

### Issue 115: Add holder enumeration / registry for reporting

**Description**
`compliance-engine` tracks a `HolderCount` but provides no way to enumerate the actual holder addresses, which issuers need for cap-table reporting, dividend reconciliation, and regulatory filings. Off-chain reconstruction from events is brittle and incomplete after archival.

**Work to Be Done**
Maintain an enumerable holder set (per asset) with paginated read access, kept in sync with registration/deregistration.

**Implementation Procedure**
Augment the holder registration path (Issues 1/15/17) to also maintain an indexed holder list (`DataKey::Holder(u32)` plus a count and an address→index map for O(1) removal via swap-remove). Provide paginated `get_holders(start, limit)`. Keep it consistent on register/deregister. Because holders are per-asset, scope this to each asset token or key the engine entries by asset. Bound page sizes. Document storage cost.

**Acceptance Criteria**
Issuers can enumerate all current holders of an asset via a paginated read that stays consistent as holders join and fully exit. Removal does not leave gaps or stale entries. Tests cover enumeration after mixed mint/transfer/exit sequences.

---

## J. Frontend Polish & Operational UX

### Issue 116: Add a contract-address display with copy and explorer links throughout the UI

**Description**
The UI works with contract and account addresses but likely shows them as raw, untruncated strings with no copy button or explorer link. For an operational tool dealing in `C...`/`G...` addresses, truncated display with copy-to-clipboard and a link to a block explorer is table-stakes UX.

**Work to Be Done**
Add a reusable address component that truncates, copies, and links to the appropriate network explorer.

**Implementation Procedure**
Create an `<Address>` component taking an address and an optional type (account/contract), rendering a truncated form (e.g., `GABC…WXYZ`), a copy button with feedback, and a link to the correct explorer for the active network (testnet/mainnet). Use it everywhere addresses appear (dashboard, KYC status, activity feed, receipts). Ensure it is accessible (Issue 68). Derive explorer base URLs from the network config.

**Acceptance Criteria**
All addresses render truncated with working copy-to-clipboard and a correct network-specific explorer link. The component is reused across pages and is keyboard/screen-reader accessible. A test verifies copy and link behavior.

---

### Issue 117: Add a "simulate before submit" preview showing fees and effects

**Description**
`simulateAndSend` already simulates, but the user never sees the simulation result before signing — estimated resource fees, return values, and whether the call will succeed. Surfacing a pre-flight preview prevents users from signing transactions that will fail or cost unexpectedly.

**Work to Be Done**
Add a confirmation/preview step that runs simulation and shows the estimated fee, predicted outcome, and any simulation error before requesting a signature.

**Implementation Procedure**
Split `simulateAndSend` into `simulate(xdr)` and `send(preparedXdr, signTx)`. In the UI action flow, run `simulate` first, display a confirmation modal with the estimated resource fee, decoded return value (where meaningful), and a clear error if simulation fails (so the user never signs a doomed transaction). Only on confirmation proceed to sign and send. Reuse the hardened polling (Issue 57).

**Acceptance Criteria**
Before signing, users see a preview with estimated fee and predicted result, and simulation failures are shown without prompting a signature. Confirming proceeds to sign/send. A test mocks simulation success and failure and asserts the preview/skip-sign behavior.

---

### Issue 118: Add internationalization (i18n) scaffolding

**Description**
All UI strings are hardcoded in English. As public infrastructure for a global ecosystem, the kit should support localization. There is no i18n framework, so translating requires editing components directly.

**Work to Be Done**
Introduce an i18n framework, externalize all user-facing strings, and provide at least one additional locale as a reference.

**Implementation Procedure**
Add a lightweight i18n library (e.g., `react-i18next`), externalize all strings into locale resource files, and wrap the app in the provider with a language selector. Provide English as the base and at least one additional translated locale as a template. Ensure number/date/currency formatting is locale-aware (coordinating with decimals formatting from Issue 60). Document how to add a locale.

**Acceptance Criteria**
All user-facing strings come from locale files; switching language updates the UI. At least one non-English locale is provided as a reference. Numbers/dates format per locale. Documentation explains adding locales.

---

### Issue 119: Add a guided onboarding/empty-state flow for first-time users

**Description**
A fresh deployment with no KYC approvals, no minted assets, and no rules configured presents empty pages with no guidance. First-time operators need an onboarding flow that walks them through the initial setup steps in order.

**Work to Be Done**
Add empty states and a guided setup checklist that detects what is unconfigured and links to the next step.

**Implementation Procedure**
On each page, detect empty/unconfigured state via on-chain reads and render helpful empty states with a primary call-to-action. Add a dashboard "Getting started" panel that checks setup progress (verifier added, holders approved, rules configured, first asset minted) and links to each step in order. Hide the panel once setup is complete. Coordinate with role detection (Issue 65) so steps reflect the connected wallet's capabilities.

**Acceptance Criteria**
A fresh deployment shows guided empty states and a setup checklist reflecting real on-chain progress, linking to each next step. The checklist disappears once setup is complete. Tests cover the empty and partially-configured states.

---

### Issue 120: Add a network/status banner and RPC health indicator

**Description**
Users have no indication of which network they are on, whether the RPC is reachable, or current ledger/sync status. A persistent status banner showing network (testnet/mainnet), RPC health, and latest ledger builds trust and aids debugging.

**Work to Be Done**
Add a header status indicator showing the active network, RPC connectivity/health, and the latest ledger sequence, updating periodically.

**Implementation Procedure**
Add a small status component in `Layout.tsx` that periodically calls the RPC `getLatestLedger`/health endpoint, displaying network name (with a distinct color for mainnet), a connectivity dot (green/red), and the latest ledger sequence. Show a prominent warning style on mainnet to prevent accidental production actions. Degrade gracefully when the RPC is unreachable. Coordinate with the wrong-network banner (Issue 64).

**Acceptance Criteria**
The header shows the active network, a live RPC health indicator, and the latest ledger, refreshing periodically. Mainnet is visually distinguished. RPC unreachability is clearly indicated. A test mocks RPC health up/down states.

---

## K. Cross-Cutting Quality & Process

### Issue 121: Add pre-commit hooks enforcing fmt, clippy, and lint locally

**Description**
Contributors can currently commit unformatted or lint-failing code, only discovering issues in CI (once Issue 61 lands) or in review. Local pre-commit hooks catch these earlier, shortening the feedback loop and keeping the history clean.

**Work to Be Done**
Add pre-commit hooks running `cargo fmt --check`, `cargo clippy`, and the frontend lint on staged changes, with easy setup.

**Implementation Procedure**
Introduce a pre-commit framework (e.g., the `pre-commit` tool or a `lefthook`/husky config). Configure hooks to run `cargo fmt --all --check` and `cargo clippy` for Rust changes and `npm run lint` for frontend changes, scoped to staged files where feasible. Document a one-command install in `CONTRIBUTING.md`. Keep hooks fast to avoid friction; allow `--no-verify` for emergencies.

**Acceptance Criteria**
After running the documented install, committing unformatted or lint-failing code is blocked locally with a clear message. Hooks run only relevant checks for changed files and complete quickly. `CONTRIBUTING.md` documents setup and bypass.

---

### Issue 122: Add structured logging/diagnostics behind the `release-with-logs` profile

**Description**
The workspace defines a `release-with-logs` profile (`debug-assertions = true`), but the contracts do not use Soroban's logging/diagnostic facilities to emit useful debug traces during development and testing. Diagnosing failed transactions on testnet is harder without contextual logs.

**Work to Be Done**
Add gated diagnostic logging in key decision points (compliance rejections, KYC failures) usable in the logs profile and tests without bloating the production WASM.

**Implementation Procedure**
Use `env.logs().add(...)` (or the `log!` macro) at key branch points — why a transfer was rejected (paused, blocklisted, over limit, holding period, jurisdiction), why KYC failed (no record, expired, wrong tier) — guarded so they are stripped in the size-optimized `release` profile but present in `release-with-logs` and tests. Document how to read diagnostic events from a simulated/failed transaction. Verify production WASM size is unaffected (Issue 55).

**Acceptance Criteria**
In the logs profile and in tests, a rejected transfer/KYC emits a diagnostic explaining the specific reason. The size-optimized release WASM is unchanged in size. Documentation explains how to surface and read the diagnostics.

---

### Issue 123: Add automated checks that documentation examples stay correct

**Description**
The README and future docs contain command snippets and code examples that can silently rot as the code changes (the false CI claim in Issue 91 is a symptom). There is no mechanism to verify documented commands and code examples still work.

**Work to Be Done**
Add automated verification that documented commands and code snippets remain valid, via doctests and a docs-linting CI job.

**Implementation Procedure**
For Rust examples, use `cargo test --doc` with runnable doc examples where practical. For shell snippets in the README/tutorials, extract and run the safe, deterministic ones in a CI job (or lint them with a tool like `mdsh`/`tested`/a custom extractor) against a disposable environment. Add link-checking for internal/external doc links. Fail CI when a documented command or link breaks. Mark non-runnable illustrative snippets explicitly.

**Acceptance Criteria**
A CI job verifies runnable documented commands and code snippets and checks doc links, failing on breakage. Rust doc examples run under `cargo test --doc`. Illustrative-only snippets are clearly marked and excluded. Broken links fail CI.

---

### Issue 124: Add a comprehensive `.env.example` and configuration reference for the frontend

**Description**
`frontend/.env.example` lists five contract-ID variables and the network, but as the frontend gains features (explorer URLs, RPC overrides, feature flags), configuration will grow. There is no single documented reference of every environment variable, its purpose, default, and validity rules, and the example may drift from what the code reads.

**Work to Be Done**
Maintain a complete, documented environment-variable reference and ensure `.env.example` covers every variable the frontend consumes.

**Implementation Procedure**
Grep the frontend for all `import.meta.env.*` reads and ensure each has an entry in `.env.example` with an inline comment describing it. Author `docs/CONFIG.md` listing every variable: purpose, required/optional, default, format, and example. Add a test or CI check that fails if the code reads an env var absent from `.env.example`. Coordinate with the startup validation (Issue 69).

**Acceptance Criteria**
`.env.example` includes every variable the frontend reads, each documented inline. `docs/CONFIG.md` is a complete reference. A CI/test guard fails when code reads an undocumented variable. The example stays in sync with the code.

---

### Issue 125: Add a project board, milestones, and triage labels to organize this backlog

**Description**
This backlog of 125 issues needs structure to be actionable: severity/priority labels, area labels (contracts, frontend, docs, security, devops), and milestones grouping work toward releases (e.g., "audit-ready", "mainnet-ready"). Without triage scaffolding, the backlog is an undifferentiated list and contributors cannot find high-impact work.

**Work to Be Done**
Define a labeling and milestone scheme, apply it across the backlog, and set up a project board reflecting workflow status.

**Implementation Procedure**
Define labels: type (`bug`, `feature`, `security`, `docs`, `test`, `devops`), area (`contracts`, `frontend`, `sdk`, `scripts`), and priority (`P0`–`P3`). Create milestones such as "Correctness fixes", "Audit-ready", "SDK", and "Mainnet-ready", mapping Section A/F issues into the earliest milestones. Set up a GitHub Projects board with columns (Backlog, Ready, In Progress, Review, Done). Document the triage process in `CONTRIBUTING.md`. Convert this `issues.md` into actual tracked issues with the agreed labels.

**Acceptance Criteria**
A documented label and milestone scheme exists and is applied to the backlog, with correctness and security issues prioritized into the earliest milestones. A project board reflects workflow status. `CONTRIBUTING.md` documents the triage process. The backlog is navigable by area and priority.

---

*End of backlog — 125 issues.*
