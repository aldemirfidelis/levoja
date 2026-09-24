import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Badge, Button, RadioCard, Sheet, space, Stack, Text, useColors, useIsDark } from '@levoja/mobile-kit';
import type { PaymentMethodsInfo } from '@/lib/types';

export interface CardToken {
  token: string;
  paymentMethodId?: string;
  issuerId?: string;
  installments: number;
  label: string;
}

/**
 * Tokenização do cartão (PCI DSS): os dados do cartão são digitados em campos seguros do provedor
 * (iframes do Mercado Pago dentro de uma WebView) e o app recebe apenas um token de uso único.
 * No ambiente de testes (sandbox) são oferecidos cartões de teste.
 */
export function CardForm({
  visible,
  amountCents,
  tokenization,
  sandboxTokens,
  onClose,
  onToken,
}: {
  visible: boolean;
  amountCents: number;
  tokenization: PaymentMethodsInfo['cardTokenization'];
  sandboxTokens?: Record<string, string>;
  onClose: () => void;
  onToken: (card: CardToken) => void;
}) {
  const [sandboxChoice, setSandboxChoice] = useState('tok_approved');
  const [error, setError] = useState<string | null>(null);
  const colors = useColors();
  const dark = useIsDark();
  const html = useMemo(
    () => (tokenization?.provider === 'mercadopago' ? mercadoPagoForm(tokenization.publicKey, amountCents, dark, colors.brand) : null),
    [tokenization, amountCents, dark, colors.brand],
  );

  if (!tokenization) return null;

  if (tokenization.provider === 'sandbox') {
    return (
      <Sheet
        visible={visible}
        onClose={onClose}
        title="Cartão (ambiente de testes)"
        footer={<Button title="Usar este cartão" onPress={() => onToken({ token: sandboxChoice, installments: 1, label: `Teste · ${sandboxTokens?.[sandboxChoice] ?? sandboxChoice}` })} />}
      >
        <Badge label="Sandbox: nenhuma cobrança real" tone="warning" />
        <Text tone="muted">Escolha o resultado que deseja simular. Em produção, os dados do cartão são digitados em campos seguros do provedor de pagamento.</Text>
        <Stack gap={2}>
          {Object.entries(sandboxTokens ?? { tok_approved: 'Aprovado' }).map(([token, label]) => (
            <RadioCard key={token} icon="card" title={label} subtitle={token} selected={sandboxChoice === token} onPress={() => setSandboxChoice(token)} />
          ))}
        </Stack>
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Dados do cartão">
      <Text variant="caption" tone="muted">
        Ambiente seguro do Mercado Pago. Os dados do cartão não ficam no LevoJá.
      </Text>
      {error ? <Text tone="danger">{error}</Text> : null}
      <View style={{ height: 560, marginHorizontal: -space(2) }}>
        <WebView
          originWhitelist={['*']}
          source={{ html: html!, baseUrl: 'https://levoja.app' }}
          onMessage={(event) => {
            try {
              const message = JSON.parse(event.nativeEvent.data) as { type: string; token?: string; paymentMethodId?: string; issuerId?: string; installments?: number; lastFour?: string; message?: string };
              if (message.type === 'token' && message.token) {
                setError(null);
                onToken({
                  token: message.token,
                  paymentMethodId: message.paymentMethodId,
                  issuerId: message.issuerId,
                  installments: message.installments ?? 1,
                  label: `${(message.paymentMethodId ?? 'Cartão').toUpperCase()}${message.lastFour ? ` •••• ${message.lastFour}` : ''}`,
                });
              } else if (message.type === 'error') {
                setError(message.message ?? 'Confira os dados do cartão.');
              }
            } catch {
              setError('Não foi possível ler a resposta do provedor.');
            }
          }}
          style={{ backgroundColor: 'transparent' }}
        />
      </View>
    </Sheet>
  );
}

function mercadoPagoForm(publicKey: string, amountCents: number, dark: boolean, brand: string): string {
  const fg = dark ? '#e6edf3' : '#111827';
  const border = dark ? '#2d3440' : '#e3e6eb';
  const bg = dark ? '#161b22' : '#ffffff';
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<script src="https://sdk.mercadopago.com/js/v2"></script>
<style>body{font-family:-apple-system,Roboto,sans-serif;margin:0;padding:8px 12px;background:${bg};color:${fg}}
.f{height:44px;border:1px solid ${border};border-radius:10px;padding:0 10px;margin:6px 0 12px;background:${bg};color:${fg};width:100%;box-sizing:border-box;font-size:16px}
label{font-size:13px;font-weight:600}button{width:100%;height:48px;border:0;border-radius:10px;background:${brand};color:#fff;font-weight:700;font-size:16px}
.row{display:flex;gap:10px}.row>div{flex:1}</style></head><body>
<form id="form-checkout">
<label>Número do cartão</label><div id="form-checkout__cardNumber" class="f"></div>
<div class="row"><div><label>Validade</label><div id="form-checkout__expirationDate" class="f"></div></div><div><label>CVV</label><div id="form-checkout__securityCode" class="f"></div></div></div>
<label>Nome impresso no cartão</label><input type="text" id="form-checkout__cardholderName" class="f"/>
<label>E-mail</label><input type="email" id="form-checkout__cardholderEmail" class="f"/>
<div class="row"><div><label>Documento</label><select id="form-checkout__identificationType" class="f"></select></div><div><label>Número</label><input type="text" id="form-checkout__identificationNumber" class="f"/></div></div>
<label>Banco emissor</label><select id="form-checkout__issuer" class="f"></select>
<label>Parcelas</label><select id="form-checkout__installments" class="f"></select>
<button type="submit" id="form-checkout__submit">Usar este cartão</button>
</form>
<script>
function post(m){window.ReactNativeWebView.postMessage(JSON.stringify(m));}
try{
var mp=new MercadoPago(${JSON.stringify(publicKey)},{locale:'pt-BR'});
var cardForm=mp.cardForm({amount:${JSON.stringify((amountCents / 100).toFixed(2))},iframe:true,form:{
id:'form-checkout',cardNumber:{id:'form-checkout__cardNumber',placeholder:'0000 0000 0000 0000'},expirationDate:{id:'form-checkout__expirationDate',placeholder:'MM/AA'},
securityCode:{id:'form-checkout__securityCode',placeholder:'123'},cardholderName:{id:'form-checkout__cardholderName'},issuer:{id:'form-checkout__issuer'},
installments:{id:'form-checkout__installments'},identificationType:{id:'form-checkout__identificationType'},identificationNumber:{id:'form-checkout__identificationNumber'},
cardholderEmail:{id:'form-checkout__cardholderEmail'}},
callbacks:{
onFormMounted:function(e){if(e)post({type:'error',message:'Não foi possível carregar o formulário do cartão.'});},
onSubmit:function(ev){ev.preventDefault();var d=cardForm.getCardFormData();
 if(!d.token){post({type:'error',message:'Confira os dados do cartão.'});return;}
 post({type:'token',token:d.token,paymentMethodId:d.paymentMethodId,issuerId:String(d.issuerId||''),installments:Number(d.installments||1)});},
onError:function(errs){post({type:'error',message:(errs&&errs[0]&&errs[0].message)||'Confira os dados do cartão.'});}
}});
}catch(e){post({type:'error',message:'Pagamento com cartão indisponível no momento.'});}
</script></body></html>`;
}
