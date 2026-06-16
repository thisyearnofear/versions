# 🔧 scripts/

Day 1: this directory contains a single check.

- **`doctor.sh`** — environment + readiness check (rewritten in full on Day 5 with the Lepton env var list).

## Usage

```bash
# Confirm the placeholder proxy is up
./scripts/doctor.sh
```

The other helper scripts (start-demo, test-api, verify-build, test-server)
are being added on Day 5 of `docs/LEPTON_IMPLEMENTATION_PLAN.md` once the
proxy has real routes to test.
