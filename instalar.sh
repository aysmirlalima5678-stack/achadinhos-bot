#!/usr/bin/env bash
# Instala tudo o que o robô precisa num Ubuntu (servidor ou Ubuntu dentro do Termux, no tablet).
set -e
export DEBIAN_FRONTEND=noninteractive TZ=America/Sao_Paulo
# Se já for administrador (root), não precisa de "sudo"
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -E"; fi

# Máquinas pequenas precisam de "memória extra" (swap). No tablet isso não é possível e é pulado.
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 3000 ] && ! swapon --show 2>/dev/null | grep -q /swapfile; then
  echo ">> Tentando criar 2 GB de memória extra (swap)..."
  ( $SUDO fallocate -l 2G /swapfile && $SUDO chmod 600 /swapfile && \
    $SUDO mkswap /swapfile && $SUDO swapon /swapfile && \
    echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null ) 2>/dev/null \
    || echo "   (não foi possível criar o swap aqui, seguindo sem ele)"
fi

echo ">> Instalando ferramentas básicas..."
$SUDO apt-get update -y
$SUDO apt-get install -y curl git ca-certificates nano

echo ">> Instalando Node.js..."
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash -
  $SUDO apt-get install -y nodejs
fi

echo ">> Instalando o gerenciador que mantém o robô ligado (pm2)..."
$SUDO npm install -g pm2
echo ">> Instalando o Claude Code (quem escreve as mensagens)..."
$SUDO npm install -g @anthropic-ai/claude-code || echo "   (não deu para instalar o Claude Code; o robô vai mandar a versão simples)"
echo ">> Instalando o robô..."
npm install --omit=dev
[ -f .env ] || cp .env.example .env
$SUDO timedatectl set-timezone America/Sao_Paulo 2>/dev/null || true
echo
echo "Pronto! Agora siga o passo de preencher o arquivo .env do guia."
