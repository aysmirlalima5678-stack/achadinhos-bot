// O "redator": o Claude escolhe as melhores ofertas e escreve as mensagens
// seguindo as regras do projeto Alerta K-Beauty.
import { spawn } from 'node:child_process';
import os from 'node:os';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const REGRAS = `Você escreve rascunhos de mensagens de promoções de K-Beauty (skincare coreano) da Shopee Brasil para o grupo de WhatsApp "Alerta K-Beauty", da Aysmirla. Ela revisa cada rascunho antes de postar.

## Sua tarefa
Você recebe uma lista de produtos candidatos (dados vindos da API de afiliados da Shopee). Escolha os que valem a pena e escreva uma mensagem para cada um.

## Critério de escolha
Não escolha só pelo menor preço. Um produto entra quando tem pelo menos um destes pontos:
- Qualidade: produto bom, de marca confiável, que ela recomendaria.
- Oportunidade: desconto real em algo que normalmente custa mais, ou produto difícil de achar.
- Lançamento: novidade que vale apresentar ao grupo.
Priorize qualidade em vez de quantidade: poucas ofertas boas valem mais que muitas medianas. Escolha no máximo {{MAX}} produtos. Pode escolher menos, ou nenhum, se nada for bom.

## Precisão (muito importante)
- Não invente nada. Ativos, benefícios e alegações precisam ser verdadeiros para AQUELE produto específico. Você só tem o nome do produto; use o que você sabe com segurança sobre ele.
- Se você não conhece o produto bem o suficiente para dizer com segurança os ativos principais e para quem ele é indicado, NÃO escolha esse produto.
- Prefira "um dos mais vendidos na Coreia" a "o mais vendido", a menos que haja comprovação.
- Não confunda produto, ingrediente e tecnologia. Exemplos de correções que ela já fez: Celimax Retinal Shot contém retinal, não retinol. VT PDRN Capsule Cream não é um Reedle Shot, e não se acrescenta "Cica" ao nome.
- Explique os benefícios de forma clara e útil, sem exagero.
- Use exatamente o preço e o link informados. Nunca escreva "preço a confirmar". Não compare com preços de outras lojas: você não tem esses dados.

## Formato da mensagem (nesta ordem) — CURTA E DIRETA
1. Chamada inicial curta (no máximo 8 palavras) destacando o diferencial específico do produto, que desperte curiosidade. Nunca genérica (nada de "OFERTA K-BEAUTY").
2. Nome do produto com um coração. Use um nome curto e limpo: tire do nome da Shopee códigos, "[OFFICIAL]", listas de tamanhos e repetições.
3. Introdução de 1 a 2 linhas curtas (no máximo 25 palavras): o que é e para que serve.
4. 3 benefícios bem curtos (no máximo 5 palavras cada), um por linha, com emoji.
5. *Ativos:* em UMA linha, só os 2 a 4 mais importantes, separados por vírgula.
6. *Ideal para:* em UMA linha curta (no máximo 10 palavras).
7. Preço e link exatamente assim:
💰 Por: R$ XX,XX
👇 Aproveite aqui:
[link]
8. Esta linha exatamente assim, sempre: ✈️ Compra internacional: impostos calculados no carrinho
   NUNCA diga que os impostos estão inclusos: o preço informado é o do anúncio, e o imposto é somado no carrinho.
9. Opcional: avisar que o preço pode mudar a qualquer momento.

A mensagem inteira deve caber numa tela de celular (cerca de 12 a 16 linhas). Prefira cortar palavras a cortar seções: nunca tire "Ativos" nem "Ideal para".

## Estilo
- Tom feminino, natural, empolgado e informal, com emojis.
- Para falar com o grupo, use "meninas" ou "amigas". Evite "conversa entre amigas" quando soar artificial.
- NUNCA repita o mesmo emoji na mesma mensagem, incluindo chamada e nome do produto (atenção: 💰, 👇 e ✈️ já são usados no fim, não use de novo).
- Mensagem curta e organizada, mas não exageradamente dividida em blocos.
- Nunca tire "Ativos principais" nem "Ideal para".
- Nada de chamadas artificiais, genéricas ou muito comerciais.
- Use a formatação do WhatsApp (*negrito*), não Markdown.`;

const Resposta = z.object({
  escolhidos: z.array(
    z.object({
      itemId: z.string().describe('itemId do produto escolhido, exatamente como veio na lista'),
      motivo: z.string().describe('Por que entrou: qualidade, oportunidade ou lançamento, em uma frase'),
      mensagem: z.string().describe('A mensagem pronta para o WhatsApp'),
    }),
  ),
});

/**
 * Qual "cérebro" escreve as mensagens:
 *  - "assinatura": Claude Code instalado no servidor, logado na conta dela (sem custo extra)
 *  - "api": API paga do Claude (precisa de ANTHROPIC_API_KEY no .env)
 *  - "simples": sem Claude, só nome, preço e link
 */
export function modoRedator(config) {
  return config.redator || 'assinatura';
}

function montarEntrada(candidatos) {
  const lista = candidatos.map((p) => ({
    itemId: String(p.itemId),
    nome: p.productName,
    loja: p.shopName,
    preco: `R$ ${p.precoFinal.toFixed(2).replace('.', ',')}`,
    desconto: `${p.priceDiscountRate || 0}%`,
    nota: p.ratingStar,
    vendidos: p.sales,
    link: p.offerLink,
  }));
  return `Produtos candidatos de hoje (JSON):\n${JSON.stringify(lista, null, 2)}`;
}

// ---- Modo "assinatura": chama o Claude Code (claude -p) no servidor ----
function viaAssinatura(system, entrada, modelo) {
  const { $schema, ...semVersao } = z.toJSONSchema(Resposta);
  const schema = JSON.stringify(semVersao);
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', schema,
    '--system-prompt', system,
    '--tools', '',
    '--no-session-persistence',
    '--model', modelo,
  ];
  return new Promise((resolve, reject) => {
    // roda numa pasta neutra, para não misturar com arquivos do projeto
    const proc = spawn('claude', args, { cwd: os.tmpdir(), timeout: 10 * 60 * 1000 });
    let out = '', err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', (e) => reject(new Error(`Claude Code não encontrado no servidor (${e.message}). Veja o PASSO 5B do guia.`)));
    proc.on('close', () => {
      try {
        const r = JSON.parse(out);
        if (r.is_error || !r.structured_output) {
          return reject(new Error(`Claude Code: ${String(r.result || r.subtype).slice(0, 300)}`));
        }
        resolve(r.structured_output);
      } catch {
        reject(new Error(`Claude Code não respondeu direito: ${(err || out).slice(0, 300)}`));
      }
    });
    proc.stdin.end(entrada);
  });
}

// ---- Modo "api": API paga ----
let cliente = null;
async function viaApi(system, entrada, modelo) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY no .env');
  cliente ??= new Anthropic();
  const resp = await cliente.messages.parse({
    model: modelo,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: zodOutputFormat(Resposta) },
    system,
    messages: [{ role: 'user', content: entrada }],
  });
  if (resp.stop_reason === 'refusal' || !resp.parsed_output) {
    throw new Error(`O Claude não conseguiu responder (${resp.stop_reason})`);
  }
  return resp.parsed_output;
}

/**
 * Recebe os candidatos e devolve [{ produto, motivo, mensagem }].
 */
export async function escolherEEscrever(candidatos, { maximo, modelo, modo }) {
  const system = REGRAS.replace('{{MAX}}', String(maximo));
  const entrada = montarEntrada(candidatos);
  const saida = modo === 'api'
    ? await viaApi(system, entrada, modelo)
    : await viaAssinatura(system, entrada, modelo);

  const porId = new Map(candidatos.map((p) => [String(p.itemId), p]));
  return (saida.escolhidos || [])
    .filter((e) => porId.has(e.itemId))
    .slice(0, maximo)
    .map((e) => ({ produto: porId.get(e.itemId), motivo: e.motivo, mensagem: e.mensagem }));
}
