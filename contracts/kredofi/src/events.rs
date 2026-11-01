//! NEP-297 events, standard `kredofi`, version `1.0.0` (SPEC 4).

use near_sdk::env;
use near_sdk::serde_json::{Value, json};

pub const STANDARD: &str = "kredofi";
pub const VERSION: &str = "1.0.0";

pub fn emit(event: &str, data: Value) {
    let body = json!({
        "standard": STANDARD,
        "version": VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{body}"));
}
