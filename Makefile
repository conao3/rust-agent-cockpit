.PHONY: install
install:
	pnpm install

.PHONY: dev
dev: install
	pnpm tauri dev

.PHONY: dev-web
dev-web: install
	pnpm dev

.PHONY: build
build:
	$(MAKE) -C src-tauri build

.PHONY: test
test:
	$(MAKE) -C src-tauri test

.PHONY: lint
lint:
	npx knip

.PHONY: fmt
fmt:
	nix fmt

.PHONY: clean
clean:
	rm -rf node_modules dist
	$(MAKE) -C src-tauri clean
