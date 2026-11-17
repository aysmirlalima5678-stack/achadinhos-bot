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

## Formato da mensagem (o formato REAL dela, nesta ordem)
1. Chamada em negrito, curta e com personalidade, seguida de emojis. Ex.: *Olha esse preço no hidratante da DR. ALTHEA!!*🤯🚨
   Destaque o diferencial ou a oportunidade. Nunca genérica (nada de "OFERTA K-BEAUTY").
2. Um coração colorido + o nome do produto em negrito. Ex.: 💙 *MEDICUBE Zero Pore Pad 2.0*
   Nome limpo: tire da Shopee códigos, "[OFFICIAL]", listas de tamanhos e repetições.
3. Explicação de 1 a 3 linhas (curta se o produto for simples; mais completa se tiver diferencial), com os trechos
   mais importantes em *negrito*.
4. Benefícios com ✔️, um por linha: de 2 a 4 conforme o produto (pode pular em produto muito simples).
5. 🌿 *Ativos principais*: ativo • ativo • ativo  (os 2 a 5 mais importantes, separados por " • ")
6. 💆‍♀️ *Ideal para*: uma linha curta e direta.
7. 💰 *Por: R$ XX,XX*  (pode terminar com um emoji, ex.: 🔥 ou 🤯)
8. ✈️ *Impostos calculados no carrinho*
   (Ela costuma escrever "Impostos já incluídos" porque confere o carrinho; você NÃO confere, então use SEMPRE esta linha.)
9. 🛒 *Link:* [link]
10. Opcional: uma frase final em negrito. Se for oferta relâmpago, termine com: *Promoção Relâmpago*🚨

Use a formatação do WhatsApp: *negrito* com um asterisco de cada lado. Nunca use Markdown (**, #).
Nunca tire "Ativos principais" nem "Ideal para".

## Estilo
- Tom feminino, natural, empolgado e informal. Use POUCOS emojis: siga a quantidade e os emojis dos exemplos reais dela (se houver). Sem exemplos, no máximo 5 emojis na mensagem toda.
- NÃO comece as mensagens chamando o grupo ("meninas", "amigas"). Fale do produto direto. Só use "meninas" ou "amigas" de vez em quando, numa mensagem ou outra, quando soar natural; nunca como padrão.
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
    ...(p.mensagemAnterior ? { mensagemAnteriorNoGrupo: p.mensagemAnterior } : {}),
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
/** Texto extra com o estilo real dela e a regra de reaproveitar mensagens antigas. */
function blocoMemoria(exemplos = [], temAnterior = false) {
  let t = '';
  if (exemplos.length) {
    t += `## Estilo real dela (mensagens que ela mesma postou no grupo oficial)
Estas mensagens são a referência MAIS IMPORTANTE de formato: copie o jeito dela (estrutura, quais emojis e quantos,
tamanho, como escreve o preço e o link). Se algo nas regras acima conflitar com o jeito dela, siga o jeito dela,
EXCETO: use sempre "✈️ *Impostos calculados no carrinho*" (nunca "impostos já incluídos"), não copie cupons
(ex.: "20% OFF") que você não sabe se valem agora, e nunca invente informação.
${exemplos.map((e, i) => `--- exemplo ${i + 1} ---\n${e}`).join('\n')}
--- fim dos exemplos ---`;
  }
  if (temAnterior) {
    t += `\n\n## Produto que ela já postou antes
Alguns produtos vêm com "mensagemAnteriorNoGrupo": é uma mensagem dela no grupo oficial que parece ser do mesmo produto.
Se for MESMO o mesmo produto, reaproveite essa mensagem quase igual: mantenha o texto dela e troque só o preço, o link
e o que mudou (por exemplo, se agora é oferta relâmpago). Se for outro produto (outra versão, outro tamanho, outra marca), ignore.
Nunca copie preço nem link da mensagem antiga.`;
  }
  return t;
}

export async function escolherEEscrever(candidatos, { maximo, modelo, modo, extra = '', exemplos = [] }) {
  const memoria = blocoMemoria(exemplos, candidatos.some((p) => p.mensagemAnterior));
  const system = REGRAS.replace('{{MAX}}', String(maximo)) + (extra ? `\n\n${extra}` : '') + (memoria ? `\n\n${memoria}` : '');
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

/**
 * Modo manual: ela mandou o link no grupo, então o produto JÁ FOI ESCOLHIDO.
 * Só escreve a mensagem (não descarta).
 */
export async function escreverEscolhidos(produtos, { modelo, modo, relampago = false, exemplos = [] }) {
  let extra = `## Modo manual (IMPORTANTE)
A Aysmirla JÁ ESCOLHEU estes produtos. Escreva a mensagem de TODOS eles: não descarte nenhum e ignore o critério de escolha.
Continua proibido inventar: se não souber com segurança os ativos de algum produto, use em "Ativos principais" só o que aparece no nome do produto.`;
  if (relampago) {
    extra += `\nEstes produtos estão em OFERTA RELÂMPAGO (por tempo limitado): comece a chamada com ⚡ e deixe claro que é relâmpago.`;
  }
  return escolherEEscrever(produtos, { maximo: produtos.length, modelo, modo, extra, exemplos });
}
