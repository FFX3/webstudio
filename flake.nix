{
  description = "Webstudio builder with OIDC support";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        # Build the Docker image using the Dockerfile
        webstudio-builder-image = pkgs.dockerTools.buildImage {
          name = "webstudio-builder";
          tag = "latest";

          # For complex Node.js builds, we delegate to docker build
          # This is a wrapper that builds using the Dockerfile
          runAsRoot = ''
            #!${pkgs.runtimeShell}
            mkdir -p /app
          '';

          config = {
            Cmd = [ "pnpm" "start" ];
            WorkingDir = "/app/apps/builder";
            ExposedPorts = { "3000/tcp" = {}; };
          };
        };

        # Script to build using docker directly (more practical for pnpm monorepos)
        build-docker = pkgs.writeShellScriptBin "build-webstudio" ''
          set -euo pipefail

          BUILDER_IMAGE="''${WEBSTUDIO_IMAGE:-webstudio-builder}"
          PUBLISHER_IMAGE="''${PUBLISHER_IMAGE:-cloudflare-publisher}"
          IMAGE_TAG="''${WEBSTUDIO_TAG:-latest}"

          echo "Building Webstudio builder image..."
          echo "  Image: $BUILDER_IMAGE:$IMAGE_TAG"

          ${pkgs.docker}/bin/docker build \
            -f ${self}/Dockerfile.builder \
            -t "$BUILDER_IMAGE:$IMAGE_TAG" \
            ${self}

          echo ""
          echo "Built: $BUILDER_IMAGE:$IMAGE_TAG"

          echo ""
          echo "Building Cloudflare publisher image..."
          echo "  Image: $PUBLISHER_IMAGE:$IMAGE_TAG"

          ${pkgs.docker}/bin/docker build \
            -f ${self}/apps/cloudflare-publisher/Dockerfile \
            -t "$PUBLISHER_IMAGE:$IMAGE_TAG" \
            ${self}

          echo ""
          echo "Built: $PUBLISHER_IMAGE:$IMAGE_TAG"
        '';

        # Load image into local docker daemon
        load-image = pkgs.writeShellScriptBin "load-webstudio" ''
          echo "Loading webstudio-builder image into Docker..."
          ${pkgs.docker}/bin/docker load < ${webstudio-builder-image}
          echo "Done. Image available as: webstudio-builder:latest"
        '';

      in {
        packages = {
          default = build-docker;
          docker-image = webstudio-builder-image;
        };

        apps = {
          default = {
            type = "app";
            program = "${build-docker}/bin/build-webstudio";
          };
          build = {
            type = "app";
            program = "${build-docker}/bin/build-webstudio";
          };
          load = {
            type = "app";
            program = "${load-image}/bin/load-webstudio";
          };
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            nodePackages.pnpm
            docker
          ];

          shellHook = ''
            echo "Webstudio development shell"
            echo ""
            echo "Commands:"
            echo "  nix run          Build Docker image"
            echo "  pnpm install     Install dependencies"
            echo "  pnpm dev         Start dev server"
          '';
        };
      }
    );
}
