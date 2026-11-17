# 📱 Robô Alerta K-Beauty no tablet (Galaxy Tab S6 Lite)

O tablet vira o "servidor" do robô. Ele roda escondido enquanto você usa o tablet normalmente.
Só precisa estar **ligado e com internet** nos horários das rodadas.

---

## PARTE 1: Instalar o Termux (5 min)
⚠️ **Não instale o Termux da Play Store**, porque aquela versão é antiga e dá erro.

1. No tablet, abra o Chrome e entre em: **f-droid.org/packages/com.termux**
2. Desça a página e toque em **"Baixar APK"** (Download APK) na versão mais recente.
3. Abra o arquivo baixado. O Android vai pedir permissão para **instalar apps desta fonte**: toque em **Configurações** e ligue **"Permitir desta fonte"**. Volte e toque em **Instalar**.
4. Abra o **Termux**. Vai aparecer uma tela preta com letras: é ali que você cola os comandos.

> Para colar no Termux: **toque e segure** na tela preta e escolha **Colar** (Paste).

## PARTE 2: Não deixar o Samsung "matar" o robô (2 min)
1. **Configurações → Bateria → Limites de uso em segundo plano → Apps que nunca entram em suspensão** → toque no **+** e adicione o **Termux**.
2. **Configurações → Aplicativos → Termux → Bateria** → escolha **"Sem restrições"**.

## PARTE 3: Instalar o Ubuntu dentro do Termux (10 a 20 min)
Cole no Termux, um bloco por vez, e espere terminar antes do próximo.
Se aparecer alguma pergunta com `[Y/n]` ou `[N/y]`, só aperte **Enter**.

```bash
termux-wake-lock
```
```bash
pkg update -y && pkg install -y proot-distro
```
```bash
proot-distro install ubuntu
```
Entrar no Ubuntu:
```bash
proot-distro login ubuntu
```
Agora o começo da linha muda para `root@localhost`. Você está "dentro" do Ubuntu.

## PARTE 4: Instalar o robô (10 a 20 min)
Ainda dentro do Ubuntu, cole:
```bash
apt update && apt install -y git && git clone https://github.com/aysmirlalima5678-stack/achadinhos-bot.git && cd achadinhos-bot && ./instalar.sh
```

Depois siga, do guia principal (GUIA.md), os passos:
- **PASSO 5**: colocar as chaves no `.env`
- **PASSO 5B**: conectar o Claude na sua conta. O link de login você pode abrir no próprio Chrome do tablet.
- **PASSO 7**: testar a Shopee
- **PASSO 8**: conectar o WhatsApp e fazer o envio de teste

⚠️ **Pule o PASSO 9** do guia principal. No tablet, o jeito de deixar ligado é o da PARTE 5 abaixo.

## PARTE 5: Deixar o robô ligado
Saia do Ubuntu, digitando `exit` e apertando Enter, até voltar ao Termux normal (o começo da linha deixa de ser `root@localhost`). Então cole **uma vez só**:
```bash
echo 'termux-wake-lock; proot-distro login ubuntu -- bash -lc "cd /root/achadinhos-bot && while true; do node src/index.js; echo Reiniciando em 10s...; sleep 10; done"' > ~/robo.sh && chmod +x ~/robo.sh
```

A partir de agora, **para ligar o robô**, abra o Termux e cole:
```bash
./robo.sh
```
Deve aparecer: *"🤖 Robô ligado!"*. Agora é só **sair do Termux pelo botão de início** (não feche pelo "fechar tudo").
Na barra de notificações vai ficar um aviso do Termux: é sinal de que o robô está rodando.

**Para desligar:** abra o Termux e aperte **CTRL + C**. No teclado do Termux tem a tecla CTRL; toque em CTRL e depois na letra C. Faça isso duas vezes.

## Se o tablet reiniciar ou desligar
Abra o Termux e cole `./robo.sh` de novo. Só isso.

## Problemas comuns
| O que aparece | O que fazer |
|---|---|
| O robô parou sozinho, e o Termux mostra *"Process completed (signal 9)"* | O Android encerrou o Termux. Confira a PARTE 2. Se continuar, em **Configurações → Opções do desenvolvedor**, ative **"Desativar restrições de processos filhos"** (se existir no seu tablet). |
| Não chegou rascunho num horário | O tablet estava desligado ou sem internet naquela hora. Na próxima rodada volta ao normal. |
| Chegou só nome, preço e link | O Claude não conseguiu escrever naquela rodada (limite do plano, ou o Claude Code não funcionou no tablet). Me chame. |

## Mandar links para o robô (ofertas relâmpago e outras)
Com o robô ligado (`./robo.sh`), **cole um link da Shopee no grupo Crônicas da Milla**:
- **Link de um produto** → o robô responde com o rascunho pronto, já com o seu link de afiliada.
  Pode colar vários links numa mensagem só.
- Escreva **"relâmpago"** junto com os links → as mensagens saem como oferta relâmpago ⚡.
- **Link de uma lista** (aba de ofertas relâmpago da loja, página da loja, cupom) → o robô responde com
  uma mensagem curta e o **seu link de afiliada para a lista inteira**.
- Produto de loja que não está na lista autorizada → o robô avisa e não faz o rascunho.
