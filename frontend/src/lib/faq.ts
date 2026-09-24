export interface FaqGroup {
  title: string;
  items: { q: string; a: string }[];
}

export const FAQ: FaqGroup[] = [
  {
    title: 'Clientes',
    items: [
      { q: 'Quais formas de pagamento são aceitas?', a: 'PIX, cartão de crédito e débito e carteira digital. Algumas lojas também aceitam pagamento na entrega.' },
      { q: 'Posso cancelar um pedido?', a: 'Sim, antes de a loja começar o preparo. Depois disso, fale com o suporte pelo app: analisamos cada caso e, quando cabível, o estorno é feito pelo mesmo meio de pagamento.' },
      { q: 'Como envio um documento ou encomenda sem comprar nada?', a: 'Use a entrega avulsa: informe origem, destino, tipo de item, peso e dimensões, confira a cotação e confirme.' },
      { q: 'Como sei que o pedido foi entregue para a pessoa certa?', a: 'Na entrega, o destinatário informa um código, escaneia um QR code, ou o entregador registra foto ou assinatura, conforme o tipo de entrega.' },
    ],
  },
  {
    title: 'Empresas',
    items: [
      { q: 'Quais documentos preciso enviar?', a: 'Cartão CNPJ, documento do responsável e comprovante de endereço. Alguns segmentos exigem licenças adicionais — farmácias, por exemplo, precisam de alvará, licença sanitária e registro do farmacêutico (CRF).' },
      { q: 'Meu CNPJ é alfanumérico. Posso me cadastrar?', a: 'Sim. A plataforma aceita o novo formato de CNPJ alfanumérico definido pela Receita Federal.' },
      { q: 'Posso usar meus próprios entregadores?', a: 'Sim. Você pode usar os entregadores da plataforma, a sua frota própria ou os dois.' },
      { q: 'Quanto tempo leva a análise do cadastro?', a: 'Normalmente até 2 dias úteis após o envio completo dos documentos. Você acompanha o status no portal da empresa.' },
    ],
  },
  {
    title: 'Entregadores',
    items: [
      { q: 'Quais veículos são aceitos?', a: 'Bicicleta, moto, carro e utilitário. Para veículos motorizados, é necessário ter CNH válida e o documento do veículo (CRLV).' },
      { q: 'Quando recebo meus ganhos?', a: 'Os ganhos ficam na sua carteira no app e podem ser sacados via PIX para uma chave em seu nome, conforme as regras de saque vigentes.' },
      { q: 'A plataforma acompanha minha localização o tempo todo?', a: 'Não. A localização é usada apenas enquanto você está online ou realizando uma entrega, para despacho e rastreamento.' },
    ],
  },
  {
    title: 'Conta e privacidade',
    items: [
      { q: 'Como altero meus dados ou exporto minhas informações?', a: 'Em Minha conta > Privacidade você pode baixar seus dados, gerenciar consentimentos de comunicação e solicitar a exclusão da conta.' },
      { q: 'O que acontece quando excluo minha conta?', a: 'Seus dados pessoais são anonimizados. Registros que a lei obriga a guardar (como os fiscais) são mantidos, mas desvinculados da sua identidade.' },
    ],
  },
];
