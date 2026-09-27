import { Vibration } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

/**
 * Alerta de nova oferta de entrega: toque alto em repetição + vibração, até o entregador aceitar,
 * recusar ou a oferta expirar. Toca pelo canal de mídia, então soa mesmo com o celular no silencioso.
 *
 * Funciona no Expo Go com o app aberto (e em segundo plano enquanto o GPS de entregas mantém o app
 * ativo). Com o app fechado quem avisa é o push — que no Android exige o build do app (não o Expo Go).
 */
let player: AudioPlayer | null = null;
let ringing = false;
let modeSet = false;

const VIBRATION = [0, 700, 400, 700, 900];

export async function startOfferAlert() {
  if (ringing) return;
  ringing = true;
  Vibration.vibrate(VIBRATION, true);
  try {
    if (!modeSet) {
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'duckOthers' });
      modeSet = true;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    player ??= createAudioPlayer(require('../../assets/sounds/offer.wav'));
    player.loop = true;
    player.volume = 1;
    await player.seekTo(0);
    if (ringing) player.play();
  } catch {
    // Sem áudio (ex.: outro app segurando o som): fica só a vibração.
  }
}

export function stopOfferAlert() {
  if (!ringing) return;
  ringing = false;
  Vibration.cancel();
  try {
    player?.pause();
  } catch {
    // player já liberado
  }
}
