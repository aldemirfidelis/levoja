import * as Location from 'expo-location';

const UF: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapá: 'AP', amazonas: 'AM', bahia: 'BA', ceará: 'CE', 'distrito federal': 'DF', 'espírito santo': 'ES',
  goiás: 'GO', maranhão: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', pará: 'PA', paraíba: 'PB',
  paraná: 'PR', pernambuco: 'PE', piauí: 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS',
  rondônia: 'RO', roraima: 'RR', 'santa catarina': 'SC', 'são paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};

/** "São Paulo" ou "SP" → "SP". */
export function toUf(region?: string | null): string {
  if (!region) return '';
  const clean = region.trim();
  if (/^[A-Za-z]{2}$/.test(clean)) return clean.toUpperCase();
  return UF[clean.toLowerCase()] ?? '';
}

export interface AddressDraft {
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  reference: string;
  lat: number | null;
  lng: number | null;
}

/** Endereço pelo CEP (ViaCEP, serviço público dos Correios/IBGE). */
export async function lookupCep(cep: string): Promise<Partial<AddressDraft> | null> {
  const digits = cep.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  try {
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    if (!response.ok) return null;
    const data = (await response.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (data.erro) return null;
    return { street: data.logradouro ?? '', district: data.bairro ?? '', city: data.localidade ?? '', state: data.uf ?? '' };
  } catch {
    return null;
  }
}

export type LocateResult = { ok: true; lat: number; lng: number; address: Partial<AddressDraft> } | { ok: false; reason: 'denied' | 'unavailable' };

/** Posição atual + endereço aproximado (geocodificação reversa do próprio sistema). */
export async function locateMe(): Promise<LocateResult> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return { ok: false, reason: 'denied' };
  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const { latitude: lat, longitude: lng } = position.coords;
    const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }).catch(() => []);
    return {
      ok: true,
      lat,
      lng,
      address: place
        ? {
            zipCode: place.postalCode ?? '',
            street: place.street ?? '',
            number: place.streetNumber ?? '',
            district: place.district ?? place.subregion ?? '',
            city: place.city ?? place.subregion ?? '',
            state: toUf(place.region),
          }
        : {},
    };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
