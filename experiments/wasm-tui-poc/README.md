# WASM TUI Proof of Concept

## Goal
Validate that we can compile core TUI components to WASM and render them identically in both terminal and browser.

## Week 1 Validation Tests

### Test 1: Basic WASM Compilation
- [x] Set up wasm-pack build pipeline
- [ ] Compile minimal TUI component to WASM
- [ ] Load WASM module in browser
- [ ] Verify basic functionality

### Test 2: Keyboard Input Handling
- [ ] Capture browser keyboard events
- [ ] Convert to terminal key events
- [ ] Process through TUI component
- [ ] Verify identical behavior to native

### Test 3: Canvas Terminal Rendering  
- [ ] Create canvas-based terminal renderer
- [ ] Render simple text and colors
- [ ] Compare output to native terminal
- [ ] Measure rendering performance

### Test 4: Audio Pipeline Compatibility
- [ ] Test Symphonia audio decoding in WASM
- [ ] Create basic Web Audio API output
- [ ] Measure audio latency vs native
- [ ] Verify audio quality parity

## Success Criteria

If all tests pass with acceptable performance, proceed with full implementation.
If any test fails significantly, pivot to PTY-over-WebSocket approach.

## Setup Commands

```bash
# Install required tools
cargo install wasm-pack
npm install -g serve

# Create minimal test environment
cd experiments/wasm-tui-poc
wasm-pack build --target web
serve .
```

## Files to Create

- `src/lib.rs` - Minimal TUI component for WASM
- `Cargo.toml` - WASM-specific dependencies  
- `index.html` - Test web interface
- `test.js` - WASM loading and testing
- `benchmark.rs` - Performance comparison tests