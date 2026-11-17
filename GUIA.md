# 🤖 Robô Alerta K-Beauty: guia passo a passo

O que ele faz: em horários definidos, ele busca ofertas **só nas lojas autorizadas** da Shopee, escolhe as melhores pelo seu critério (qualidade, oportunidade ou lançamento), escreve cada mensagem no formato do Alerta K-Beauty, já com o **seu link de afiliado**, e manda tudo para o grupo de rascunhos **Crônicas da Milla**. Você revisa e posta no Alerta K-Beauty.

🔒 O robô tem uma trava: ele **nunca** manda nada no grupo Alerta K-Beauty.

**Custo:** a Shopee e o servidor da Oracle são grátis. A parte que escreve as mensagens no seu estilo usa a API do Claude, que é paga por uso (veja o PASSO 1B). Sem ela, o robô funciona, mas manda só nome, preço e link.

---

## O que você vai precisar
- [ ] Ser afiliada da Shopee (você já é ✅)
- [ ] Um cartão de crédito, **só para a Oracle confirmar sua identidade**. Ela não cobra nada no plano grátis.
- [ ] De preferência, um **segundo número de WhatsApp** (um chip barato) para ser o robô. Dá para usar o seu, mas o segundo é mais seguro.
- [ ] O grupo **Crônicas da Milla**, com o número do robô dentro

---

## PASSO 1: Pegar as chaves da Shopee (15 min, e às vezes leva alguns dias para aprovar)
1. Entre em **affiliate.shopee.com.br** com sua conta de afiliada.
2. Procure o menu **"Open API"** (fica no menu lateral ou em "Ferramentas").
3. Peça o acesso, preenchendo o formulário. Se perguntarem o uso, escreva: *"Divulgação de ofertas em grupo de WhatsApp"*.
4. Quando for aprovado, aparecem dois códigos: **App ID** e **Secret** (ou "Senha"). Guarde os dois.

> Enquanto espera a aprovação, você já pode fazer os passos 2 a 4.

## PASSO 1B (opcional, mas recomendado): Chave do Claude, para escrever no seu estilo
1. Entre em **platform.claude.com** e crie uma conta.
2. Em **Billing**, coloque um cartão e um crédito pequeno (US$ 5 já dura bastante).
3. Em **API Keys**, clique em **Create Key** e guarde a chave (começa com `sk-ant-`).

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
ANTHROPIC_API_KEY=sk-ant-...
```
Para salvar: **Ctrl+O**, depois **Enter**, depois **Ctrl+X**.

## PASSO 6: Conferir as configurações
Cole:
```bash
nano config.json
```
As suas 6 lojas autorizadas já estão lá. **Glory Of Seoul** e **Likeitlikeit** estão sem link: o robô tenta achar essas lojas pelo nome. Se ele avisar que não achou, cole no campo `"link"` o link de qualquer produto dessa loja.

Outras coisas que dá para mudar:
- `"horarios"`: quando ele manda os rascunhos
- `"maximoPorRodada"`: quantas ofertas, no máximo, por vez (pode ser menos, porque ele prioriza qualidade)
- `"precoMaximo"` e `"notaMinima"`
- `"modeloClaude"`: `claude-opus-5-5` (escreve melhor) ou `claude-haiku-5-5` (bem mais barato)

> Ou mais fácil: **me peça e eu mudo para você.**

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
Em seguida, os rascunhos devem chegar no grupo Crônicas da Milla. 🎉

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
- **Confira sempre o preço no carrinho antes de postar.** O robô usa o preço que a API de afiliados informa, e ele pode ser diferente do valor final do carrinho com impostos.
- Na véspera das datas duplas (11/11, 12/12 etc.), às 20h, ele manda para os rascunhos o aviso de que as ofertas começam à meia-noite.
- Esse jeito de conectar o WhatsApp **não é oficial**. Mandando só para o seu grupo e poucas vezes ao dia, o risco é baixo, mas existe. Por isso o segundo número é a opção mais segura.
- A Oracle às vezes desliga máquinas grátis que ficam "paradas". Se um dia o robô sumir, é só me chamar.
