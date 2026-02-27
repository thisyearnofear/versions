# VERSIONS Server

**CLEAN**: Rust backend following Core Principles

## 🎯 **Structure (ORGANIZED)**

```
server/
├── src/
│   ├── audio_service.rs      # MODULAR: Audio streaming logic
│   ├── farcaster_service.rs  # MODULAR: Social integration
│   ├── rest_api.rs           # PERFORMANT: Async endpoints
│   ├── onchain_service.rs   # STUB: Blockchain integration
│   └── server.rs             # CLEAN: App composition
└── migrations/               # ORGANIZED: Schema versioning
    ├── 001_initial_schema.sql
    └── 002_hackathon_audius_solana.sql
```

## 🎯 **Principles Applied**

| File | Principles Applied |
|------|-------------------|
| `audio_service.rs` | MODULAR, PERFORMANT, DRY |
| `farcaster_service.rs` | MODULAR, CLEAN |
| `rest_api.rs` | PERFORMANT, ORGANIZED, DRY |
| `onchain_service.rs` | ENHANCEMENT FIRST (stub) |
| `migrations/` | ORGANIZED, DRY |

## 🏗️ **Building**

```bash
# Development
cargo build -p termusic-server

# Release
cargo build --release -p termusic-server
```

## 🧪 **Testing**

```bash
# Run tests
cargo test -p termusic-server

# Check formatting
cargo fmt --check
```

## 📦 **Key Dependencies**

- **axum**: CLEAN web framework
- **tokio**: PERFORMANT async runtime
- **rusqlite**: ORGANIZED local database
- **reqwest**: PERFORMANT HTTP client
