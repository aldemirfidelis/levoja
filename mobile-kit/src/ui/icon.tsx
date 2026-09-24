import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Text } from 'react-native';
import { useColors } from '../theme';

/**
 * Ícones nativos: SF Symbols no iOS e Material Symbols no Android (expo-symbols).
 * Os nomes são validados pelo TypeScript contra os catálogos de cada plataforma.
 */
export const ICONS = {
  home: { ios: 'house.fill', android: 'home' },
  search: { ios: 'magnifyingglass', android: 'search' },
  bag: { ios: 'bag.fill', android: 'shopping_bag' },
  cart: { ios: 'cart.fill', android: 'shopping_cart' },
  account: { ios: 'person.crop.circle', android: 'account_circle' },
  person: { ios: 'person.fill', android: 'person' },
  location: { ios: 'mappin.and.ellipse', android: 'location_on' },
  myLocation: { ios: 'location.fill', android: 'my_location' },
  navigation: { ios: 'location.north.line.fill', android: 'navigation' },
  chevronRight: { ios: 'chevron.right', android: 'chevron_right' },
  close: { ios: 'xmark', android: 'close' },
  plus: { ios: 'plus', android: 'add' },
  minus: { ios: 'minus', android: 'remove' },
  trash: { ios: 'trash', android: 'delete' },
  check: { ios: 'checkmark', android: 'check' },
  checkCircle: { ios: 'checkmark.circle.fill', android: 'check_circle' },
  alert: { ios: 'exclamationmark.triangle.fill', android: 'warning' },
  info: { ios: 'info.circle', android: 'info' },
  bell: { ios: 'bell.fill', android: 'notifications' },
  lock: { ios: 'lock.fill', android: 'lock' },
  shield: { ios: 'checkmark.shield.fill', android: 'shield' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout' },
  wallet: { ios: 'wallet.pass.fill', android: 'account_balance_wallet' },
  box: { ios: 'shippingbox.fill', android: 'local_shipping' },
  store: { ios: 'storefront.fill', android: 'storefront' },
  star: { ios: 'star.fill', android: 'star' },
  clock: { ios: 'clock', android: 'schedule' },
  phone: { ios: 'phone.fill', android: 'call' },
  copy: { ios: 'doc.on.doc', android: 'content_copy' },
  qr: { ios: 'qrcode', android: 'qr_code_2' },
  scan: { ios: 'qrcode.viewfinder', android: 'qr_code_scanner' },
  camera: { ios: 'camera.fill', android: 'photo_camera' },
  image: { ios: 'photo', android: 'image' },
  signature: { ios: 'signature', android: 'draw' },
  power: { ios: 'power', android: 'power_settings_new' },
  money: { ios: 'banknote', android: 'payments' },
  card: { ios: 'creditcard.fill', android: 'credit_card' },
  pix: { ios: 'arrow.left.arrow.right.circle.fill', android: 'currency_exchange' },
  history: { ios: 'clock.arrow.circlepath', android: 'history' },
  document: { ios: 'doc.text.fill', android: 'description' },
  edit: { ios: 'pencil', android: 'edit' },
  eye: { ios: 'eye', android: 'visibility' },
  eyeOff: { ios: 'eye.slash', android: 'visibility_off' },
  coupon: { ios: 'ticket.fill', android: 'confirmation_number' },
  heart: { ios: 'heart.fill', android: 'volunteer_activism' },
  send: { ios: 'paperplane.fill', android: 'send' },
  refresh: { ios: 'arrow.clockwise', android: 'refresh' },
  offline: { ios: 'wifi.slash', android: 'wifi_off' },
  settings: { ios: 'gearshape.fill', android: 'settings' },
  help: { ios: 'questionmark.circle', android: 'help' },
  bike: { ios: 'bicycle', android: 'pedal_bike' },
  scooter: { ios: 'scooter', android: 'two_wheeler' },
  car: { ios: 'car.fill', android: 'directions_car' },
  van: { ios: 'box.truck.fill', android: 'local_shipping' },
  route: { ios: 'point.topleft.down.to.point.bottomright.curvepath.fill', android: 'route' },
  flag: { ios: 'flag.checkered', android: 'sports_score' },
  upload: { ios: 'square.and.arrow.up', android: 'upload' },
  download: { ios: 'square.and.arrow.down', android: 'download' },
  filter: { ios: 'line.3.horizontal.decrease.circle', android: 'filter_list' },
  receipt: { ios: 'list.bullet.rectangle.portrait', android: 'receipt_long' },
  chat: { ios: 'bubble.left.and.bubble.right.fill', android: 'forum' },
  percent: { ios: 'percent', android: 'percent' },
} satisfies Record<string, Exclude<SymbolViewProps['name'], string>>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const colors = useColors();
  return (
    <SymbolView
      name={ICONS[name]}
      size={size}
      tintColor={color ?? colors.fg}
      fallback={<Text style={{ fontSize: size * 0.8, color: color ?? colors.fg }}>•</Text>}
    />
  );
}
