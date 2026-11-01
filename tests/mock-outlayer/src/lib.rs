//! Sandbox-only stand-in for OutLayer's `request_execution`. Never deployed anywhere.
//!
//! - Records the last request (source with `version_key`, limits, input, secrets_ref,
//!   attached deposit, signer, predecessor) so tests can check what KredoFi pinned.
//! - Returns a configured response, `null`, or panics (a failed run).
//!   `"caller": "$SIGNER"` in the response is replaced with the transaction signer,
//!   like the real scorer, which reads `NEAR_SENDER_ID`.
//! - `proxy_request_score` calls KredoFi from a contract, so signer != predecessor.

use near_sdk::serde_json::{Value, json};
use near_sdk::{AccountId, Gas, Promise, env, near};

#[near(contract_state)]
#[derive(Default)]
pub struct MockOutLayer {
    response: Option<String>,
    fail: bool,
    last_request: Option<String>,
    requests: u32,
}

#[near]
impl MockOutLayer {
    pub fn set_response(&mut self, response: Option<Value>, fail: bool) {
        self.response = response.map(|r| r.to_string());
        self.fail = fail;
    }

    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Value,
        input_data: String,
        secrets_ref: Option<Value>,
        response_format: String,
        payer_account_id: Option<AccountId>,
        params: Option<Value>,
    ) -> Option<Value> {
        if self.fail {
            env::panic_str("mock: worker failed");
        }
        self.requests += 1;
        self.last_request = Some(
            json!({
                "source": source,
                "resource_limits": resource_limits,
                "input_data": input_data,
                "secrets_ref": secrets_ref,
                "response_format": response_format,
                "payer_account_id": payer_account_id,
                "params": params,
                "deposit": env::attached_deposit().as_yoctonear().to_string(),
                "signer": env::signer_account_id(),
                "predecessor": env::predecessor_account_id(),
            })
            .to_string(),
        );
        let mut out: Value = near_sdk::serde_json::from_str(self.response.as_ref()?).unwrap();
        if out.get("caller") == Some(&json!("$SIGNER")) {
            out["caller"] = json!(env::signer_account_id());
        }
        Some(out)
    }

    pub fn get_last_request(&self) -> Option<Value> {
        self.last_request
            .as_ref()
            .map(|s| near_sdk::serde_json::from_str(s).unwrap())
    }

    pub fn get_requests(&self) -> u32 {
        self.requests
    }

    #[payable]
    pub fn proxy_request_score(&mut self, pool: AccountId, public_token: String, reply_pubkey: String) -> Promise {
        Promise::new(pool).function_call(
            "request_score",
            json!({ "public_token": public_token, "reply_pubkey": reply_pubkey })
                .to_string()
                .into_bytes(),
            env::attached_deposit(),
            Gas::from_tgas(200),
        )
    }
}

