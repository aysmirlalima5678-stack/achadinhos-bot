# 🤖 Robô de Achadinhos: guia passo a passo

O que ele faz: em horários definidos (por exemplo 9h, 13h e 19h), ele busca ofertas das suas lojas favoritas na Shopee, já com o **seu link de afiliado**, e manda tudo com foto, preço e desconto para o seu **grupo de rascunhos** no WhatsApp. Você só revisa e repassa.

**Custo: R$ 0.** A Shopee é grátis, o servidor da Oracle é grátis e o robô é seu.

---

## O que você vai precisar
- [ ] Ser afiliada da Shopee (você já é ✅)
- [ ] Um cartão de crédito, **só para a Oracle confirmar sua identidade**. Ela não cobra nada no plano grátis.
- [ ] De preferência, um **segundo número de WhatsApp** (um chip barato) para ser o robô. Dá para usar o seu, mas o segundo é mais seguro.
- [ ] Um grupo no WhatsApp chamado **Rascunhos**, com você e o número do robô dentro

---

## PASSO 1: Pegar as chaves da Shopee (15 min, e às vezes leva alguns dias para aprovar)
1. Entre em **affiliate.shopee.com.br** com sua conta de afiliada.
2. Procure o menu **"Open API"** (fica no menu lateral ou em "Ferramentas").
3. Peça o acesso, preenchendo o formulário. Se perguntarem o uso, escreva: *"Divulgação de ofertas em grupo de WhatsApp"*.
4. Quando for aprovado, aparecem dois códigos: **App ID** e **Secret** (ou "Senha"). Guarde os dois.

> Enquanto espera a aprovação, você já pode fazer os passos 2 a 4.

## PASSO 2: Criar o servidor grátis na Oracle (30 min)
1. Entre em **oracle.com/cloud/free** e clique em **"Start for free"**.
2. Preencha seus dados. Em "Home Region", escolha **Brazil East (Sao Paulo)**. Não dá para mudar depois.
3. Coloque o cartão (é só verificação).
4. Já dentro do painel, clique em **"Create a VM instance"** (Criar instância).
5. Em **Image**, escolha **Ubuntu**. Em **Shape**, escolha **Ampere (VM.Standard.A1.Flex)** com 1 OCPU e 6 GB. Tem que aparecer o selo **"Always Free"**.
6. Em "Add SSH keys", clique em **"Save private key"** e guarde o arquivo.
7. Clique em **Create** e espere ficar verde ("Running").

> Se aparecer "Out of capacity", tente de novo mais tarde, ou escolha o shape **VM.Standard.E2.1.Micro**, que também é grátis.

## PASSO 3: Abrir o terminal do servidor
No painel da Oracle, abra sua instância e clique em **"Cloud Shell"** (ícone `>_` no topo) ou em **"Console connection"**. Vai abrir uma tela preta onde você cola comandos. É lá que você vai colar tudo daqui para frente.

*(Se travar aqui, me mande um print que eu te guio.)*

## PASSO 4: Instalar o robô
Cole este comando e aperte Enter:

```bash
git clone https://github.com/aysmirlalima5678-stack/achadinhos-bot.git && cd achadinhos-bot && ./instalar.sh
```


## PASSO 5: Colocar suas chaves
Cole:
```bash
nano .env
```
Preencha assim, usando os seus dados:
```
SHOPEE_APP_ID=12345678
SHOPEE_SECRET=ABCDEF...
WHATSAPP_NUMERO=5511999998888
```
Para salvar: **Ctrl+O**, depois **Enter**, depois **Ctrl+X**.

## PASSO 6: Escolher suas lojas
Cole:
```bash
nano config.json
```
Em `"lojas"`, coloque o nome e **o link de qualquer produto** de cada loja (é assim que o robô descobre a loja). Por exemplo:
```json
"lojas": [
  { "nome": "Loja da Maria", "link": "https://shopee.com.br/Blusa-Tricot-i.123456.789012" },
  { "nome": "Casa Bonita",   "link": "https://shopee.com.br/Organizador-i.654321.111222" }
],
```
Outras coisas que dá para mudar:
- `"horarios"`: quando ele manda as ofertas
- `"descontoMinimo"`: só manda produto com pelo menos esse % de desconto
- `"precoMaximo"`, `"notaMinima"`, `"produtosPorLoja"` e `"maximoPorRodada"`
- `"palavrasChave"`: por exemplo `["air fryer", "skincare"]`, para buscar em toda a Shopee

> Ou mais fácil: **me mande a lista de lojas e eu deixo o config.json pronto para você.**

## PASSO 7: Testar a Shopee
```bash
npm run testar-shopee
```
Devem aparecer ofertas na tela. Se aparecer erro, me mande um print.

## PASSO 8: Conectar o WhatsApp e fazer um envio de teste
```bash
npm run agora
```
Vai aparecer um **CÓDIGO de 8 letras**. No celular do robô, abra **WhatsApp > Configurações > Aparelhos conectados > Conectar um aparelho > "Conectar com número de telefone"** e digite o código.
Em seguida, as ofertas devem chegar no grupo Rascunhos. 🎉

## PASSO 9: Deixar ligado para sempre
```bash
pm2 start src/index.js --name achadinhos && pm2 save && pm2 startup
```
Se o último comando mostrar uma linha começando com `sudo env PATH=...`, copie essa linha, cole e dê Enter.

**Pronto!** Pode fechar tudo. O robô funciona sozinho, mesmo com seu computador e seu celular desligados.

---

## Comandos úteis (para depois)
| Quero... | Comando |
|---|---|
| Ver o que o robô está fazendo | `pm2 logs achadinhos` |
| Reiniciar depois de mudar o config.json | `pm2 restart achadinhos` |
| Desligar o robô | `pm2 stop achadinhos` |

## Avisos importantes
- Esse jeito de conectar o WhatsApp **não é oficial**. Mandando só para o seu grupo e poucas vezes ao dia, o risco é baixo, mas existe. Por isso o segundo número é a opção mais segura.
- A Oracle às vezes desliga máquinas grátis que ficam "paradas". Se um dia o robô sumir, é só me chamar.
