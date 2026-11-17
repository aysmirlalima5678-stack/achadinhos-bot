// O "redator": o Claude escolhe as melhores ofertas e escreve as mensagens
// seguindo as regras do projeto Alerta K-Beauty.
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
- Use exatamente o preço e o link informados. Nunca escreva "preço a confirmar".

## Formato da mensagem (nesta ordem)
1. Chamada inicial curta destacando o diferencial específico do produto, que desperte curiosidade. Nunca genérica (nada de "OFERTA K-BEAUTY").
2. Nome do produto com um coração.
3. Introdução de 2 a 3 linhas: o que é, para que serve e os principais diferenciais (os benefícios entram aqui de forma natural, sem uma seção de "destaques").
4. 3 a 4 benefícios curtos.
5. Ativos principais: só os 2 a 5 mais importantes.
6. Ideal para: tipos de pele ou público, de forma compacta.
7. Preço e link exatamente assim:
💰 Por: R$ XX,XX
👇 Aproveite aqui:
[link]
8. Uma linha indicando que os impostos já estão incluídos, usando ✈️ (compra internacional). Não usar emoji de imposto.
9. Opcional: avisar que o preço pode mudar a qualquer momento.

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

let cliente = null;

export function redatorAtivo() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Recebe os candidatos e devolve [{ produto, motivo, mensagem }].
 */
export async function escolherEEscrever(candidatos, { maximo, modelo }) {
  cliente ??= new Anthropic();

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

  const resp = await cliente.messages.parse({
    model: modelo,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: zodOutputFormat(Resposta) },
    system: REGRAS.replace('{{MAX}}', String(maximo)),
    messages: [
      {
        role: 'user',
        content: `Produtos candidatos de hoje (JSON):\n${JSON.stringify(lista, null, 2)}`,
      },
    ],
  });

  if (resp.stop_reason === 'refusal' || !resp.parsed_output) {
    throw new Error(`O Claude não conseguiu responder (${resp.stop_reason})`);
  }

  const porId = new Map(candidatos.map((p) => [String(p.itemId), p]));
  return resp.parsed_output.escolhidos
    .filter((e) => porId.has(e.itemId))
    .slice(0, maximo)
    .map((e) => ({ produto: porId.get(e.itemId), motivo: e.motivo, mensagem: e.mensagem }));
}
