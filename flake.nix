{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    treefmt-nix.url = "github:numtide/treefmt-nix";
    rust-overlay.url = "github:oxalica/rust-overlay";
    rust-gitq = {
      url = "git+file:///home/conao/ghq/github.com/conao3/rust-gitq";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-parts.follows = "flake-parts";
      inputs.treefmt-nix.follows = "treefmt-nix";
      inputs.rust-overlay.follows = "rust-overlay";
    };
  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];

      imports = [
        inputs.treefmt-nix.flakeModule
      ];

      perSystem =
        {
          lib,
          system,
          ...
        }:
        let
          overlay = final: prev:
            let
              nodejs = prev.nodejs_24;
              pnpm = prev.pnpm_10.override { inherit nodejs; };
              rustToolchain = prev.rust-bin.stable.latest.default;
            in
            {
              inherit nodejs pnpm rustToolchain;
            };
          pkgs = import inputs.nixpkgs {
            inherit system;
            overlays = [
              inputs.rust-overlay.overlays.default
              overlay
            ];
          };

          linuxBuildInputs = with pkgs; [
            webkitgtk_4_1
            gtk3
            libsoup_3
            glib-networking
            openssl
            librsvg
          ];

          darwinBuildInputs = with pkgs; [
            apple-sdk_14
            openssl
          ];
        in
        {
          devShells.default = pkgs.mkShell {
            packages = with pkgs; [
              rustToolchain
              nodejs
              pnpm
              pkg-config
            ];

            buildInputs =
              if pkgs.stdenv.isLinux then linuxBuildInputs else darwinBuildInputs;

            env = lib.optionalAttrs pkgs.stdenv.isLinux {
              GIO_MODULE_PATH = "${pkgs.glib-networking}/lib/gio/modules";
            };
          };

          treefmt = {
            projectRootFile = "flake.nix";
            programs.nixfmt.enable = true;
            programs.rustfmt.enable = true;
            programs.prettier.enable = true;
            settings.global.excludes = [
              "pnpm-lock.yaml"
            ];
          };
        };
    };
}
