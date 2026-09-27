import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
  Nunito_900Black_Italic,
  useFonts,
} from '@expo-google-fonts/nunito';

/**
 * Carrega a Nunito da marca (os nomes são os de `fontFamilies` em theme.ts). Devolve `true` quando
 * as fontes estão prontas, ou se o carregamento falhar: nesse caso o app segue com a fonte do sistema.
 * Chame no layout raiz e mantenha a tela de abertura até ficar pronto.
 */
export function useBrandFonts(): boolean {
  const [loaded, error] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Nunito_900Black,
    Nunito_900Black_Italic,
  });
  return loaded || !!error;
}
