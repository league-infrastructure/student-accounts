FROM mcr.microsoft.com/devcontainers/typescript-node:20-bookworm

# Python + pipx (for CLASI, dotconfig, rundbat)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m pip install --break-system-packages pipx

# age + sops (for secrets decryption)
ARG AGE_VERSION=1.2.0
ARG SOPS_VERSION=3.9.4
RUN curl -fsSL "https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/age-v${AGE_VERSION}-linux-amd64.tar.gz" \
        | tar -xz -C /usr/local/bin --strip-components=1 age/age age/age-keygen \
    && curl -fsSL -o /usr/local/bin/sops \
        "https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.linux.amd64" \
    && chmod +x /usr/local/bin/sops

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Install CLASI via pipx (runs as root; post-create.sh skips this step)
ENV PIPX_HOME=/opt/pipx
ENV PIPX_BIN_DIR=/usr/local/bin
