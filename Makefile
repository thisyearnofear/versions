prog := versions-tui
server := versions-server
ifeq ($(OS),Windows_NT)
# Windows 
	prog := versions-tui.exe
	server := versions-server.exe 
endif
default_cargo_home = $(HOME)/.local/share/cargo
# define CARGO_HOME if not defined
ifndef CARGO_HOME
	CARGO_HOME=$(default_cargo_home)
endif
# needs to be after CARGO_HOME, otherwise the default is not ever added
install_to = $(CARGO_HOME)/bin

ifeq ($(OS),Windows_NT)
	install_to = $(USERPROFILE)\.cargo\bin
endif

default: fmt web-build

build:
	cargo build --all 

fmt:
	cargo fmt --all
	cargo check --all --features cover,all-backends
	cargo clippy --all --features cover,all-backends
	# cargo clippy -- -D warnings

run: 
	cargo run 

# default backend, default features
release:
	cargo build --release --all

# backends + cover

rusty:
	cargo build --features cover --release --all

mpv:
	# disable "rusty" backend default
	cargo build --no-default-features --features cover,mpv --release --all

gst:
	# disable "rusty" backend default
	cargo build --no-default-features --features cover,gst --release --all

all-backends:
	cargo build  --features cover,all-backends --release --all

all-backends-test:
	cargo build  --features cover,all-backends --all

test: 
	cargo test --features cover,all-backends --release --all

# end backends + cover

full: all-backends post

minimal: release post

post: 
	echo $(install_to)
	cp -f target/release/$(prog) "$(install_to)"
	cp -f target/release/$(server) "$(install_to)"

install: release post

win:
	cargo build --all

winrelease:
	cargo build --release --all

winpost:
	powershell -noprofile -command "Write-Host $(install_to)"
	cp -f target/release/$(prog) "$(install_to)"
	cp -f target/release/$(server) "$(install_to)"

wininstall: winrelease winpost

wintest: win winpost

fulltest: all-backends-test post

# ENHANCEMENT FIRST: Web interface TypeScript build targets
web-build:
	@echo "🌍 Building web interface TypeScript..."
	cd web && npm run build

# PERFORMANT: Watch mode for development
web-dev:
	@echo "🌍 Starting web development server with TypeScript watch..."
	cd web && npm run dev

# CLEAN: Clean web build artifacts
web-clean:
	@echo "🧹 Cleaning web build artifacts..."
	cd web && npm run clean
	rm -rf web/dist/
	rm -f web/*.js.bak web/src/*.js.bak
	@echo "✅ Web build artifacts cleaned"

# MODULAR: Install web dependencies
web-install:
	@echo "📦 Installing web dependencies..."
	cd web && npm install

# DRY: Complete build including web interface
full-build: build web-build
	@echo "✅ Complete VERSIONS build finished"

# ORGANIZED: Verify complete build
verify-build: full-build
	@echo "🔍 Verifying complete build..."
	./scripts/verify_build.sh
	cd web && npm run build

# AGGRESSIVE CONSOLIDATION: Complete cleanup
clean-all: web-clean
	@echo "🧹 Cleaning all build artifacts..."
	cargo clean
	@echo "✅ Complete cleanup finished"
