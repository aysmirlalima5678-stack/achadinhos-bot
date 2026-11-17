#!/usr/bin/env bash
# Instala tudo o que o robô precisa num servidor Ubuntu novo.
set -e
# Máquinas pequenas (ex.: Google Cloud e2-micro, 1 GB) precisam de "memória extra" (swap)
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 3000 ] && ! swapon --show | grep -q /swapfile; then
  echo ">> Criando 2 GB de memória extra (swap)..."
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
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
