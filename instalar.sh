#!/usr/bin/env bash
# Instala tudo o que o robô precisa num servidor Ubuntu novo.
set -e
echo ">> Instalando Node.js..."
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo ">> Instalando o gerenciador que mantém o robô ligado (pm2)..."
sudo npm install -g pm2
echo ">> Instalando o Claude Code (quem escreve as mensagens)..."
sudo npm install -g @anthropic-ai/claude-code
echo ">> Instalando o robô..."
npm install --omit=dev
[ -f .env ] || cp .env.example .env
sudo timedatectl set-timezone America/Sao_Paulo || true
echo
echo "Pronto! Agora siga o PASSO 5 do guia (preencher o arquivo .env)."
