use anyhow::{Result, anyhow};
use log::info;
use rhai::{Engine, Scope};

/// MODULAR: Scripting Service for custom audio analysis and discovery
/// Inspired by cliamp (Lua) but implemented using Rhai for Rust integration
pub struct ScriptService {
    engine: Engine,
}

impl ScriptService {
    pub fn new() -> Self {
        let mut engine = Engine::new();

        // ENHANCEMENT: Register some useful functions for scripts
        engine.register_fn("log", |s: &str| {
            info!("Script: {}", s);
        });

        Self { engine }
    }

    pub fn execute(&self, script: &str) -> Result<String> {
        let mut scope = Scope::new();

        // Execute the script
        // We allow scripts to return any type, but we convert it to string for the API
        let result: rhai::Dynamic = self
            .engine
            .eval_with_scope(&mut scope, script)
            .map_err(|e| anyhow!("Script execution error: {}", e))?;

        Ok(result.to_string())
    }
}
