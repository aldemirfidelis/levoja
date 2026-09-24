import { useEffect, useMemo, useRef, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { kitConfig } from '../config';
import { radius, useColors, useIsDark } from '../theme';

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  kind: 'store' | 'home' | 'driver' | 'pickup' | 'dropoff' | 'me';
  label?: string;
}

const LEAFLET = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist';

function html(tiles: string, attribution: string, dark: boolean, brand: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="${LEAFLET}/leaflet.css" crossorigin="">
<style>html,body,#map{height:100%;margin:0;background:${dark ? '#0d1117' : '#f1f3f6'}}
.pin{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:17px;font-size:18px;background:#fff;border:3px solid ${brand};box-shadow:0 2px 6px rgba(0,0,0,.3)}
.pin.driver{background:${brand}}.pin.me{width:18px;height:18px;border-radius:9px;background:#2563eb;border:3px solid #fff}
${dark ? '.leaflet-tile-pane{filter:brightness(.75) invert(1) contrast(.9) hue-rotate(200deg) saturate(.35)}' : ''}</style></head>
<body><div id="map"></div>
<script src="${LEAFLET}/leaflet.js" crossorigin=""></script>
<script>
var ICON={store:'🏪',home:'🏠',driver:'🛵',pickup:'📦',dropoff:'📍',me:''};
var map=L.map('map',{zoomControl:false,attributionControl:true}).setView([-23.55,-46.63],13);
L.tileLayer(${JSON.stringify(tiles)},{maxZoom:19,attribution:${JSON.stringify(attribution)}}).addTo(map);
var markers={},line=null,fitted=false;
window.__lj={update:function(d){
  var seen={};
  (d.points||[]).forEach(function(p){seen[p.id]=1;
    if(markers[p.id]){markers[p.id].setLatLng([p.lat,p.lng]);}
    else{markers[p.id]=L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',html:'<div class="pin '+p.kind+'">'+(ICON[p.kind]||'')+'</div>',iconSize:[34,34],iconAnchor:[17,17]}),title:p.label||''}).addTo(map);}
  });
  Object.keys(markers).forEach(function(id){if(!seen[id]){map.removeLayer(markers[id]);delete markers[id];}});
  if(line){map.removeLayer(line);line=null;}
  if(d.path&&d.path.length>1){line=L.polyline(d.path,{color:${JSON.stringify(brand)},weight:4,opacity:.8}).addTo(map);}
  var pts=(d.points||[]).map(function(p){return [p.lat,p.lng];});
  if(d.follow&&markers[d.follow]){map.panTo(markers[d.follow].getLatLng());}
  else if((!fitted||d.refit)&&pts.length){if(pts.length===1){map.setView(pts[0],15);}else{map.fitBounds(pts,{padding:[48,48],maxZoom:16});}fitted=true;}
}};
window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('ready');
</script></body></html>`;
}

/**
 * Mapa ao vivo (Leaflet em WebView, sem chave de API). Tiles configuráveis por
 * EXPO_PUBLIC_MAP_TILES_URL — em produção use um provedor contratado.
 */
export function LiveMap({
  points,
  path,
  follow,
  height = 260,
  style,
}: {
  points: MapPoint[];
  path?: [number, number][];
  /** Id do marcador a seguir (ex.: o entregador). */
  follow?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const dark = useIsDark();
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const config = kitConfig();
  const source = useMemo(
    () => ({
      html: html(
        config.mapTilesUrl ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        config.mapAttribution ?? '© OpenStreetMap',
        dark,
        colors.brand,
      ),
    }),
    [config.mapTilesUrl, config.mapAttribution, dark, colors.brand],
  );
  const payload = JSON.stringify({ points, path, follow });

  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.__lj&&window.__lj.update(${payload});true;`);
  }, [ready, payload]);

  return (
    <View style={[{ height, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface2 }, style]} accessibilityLabel="Mapa">
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={source}
        onMessage={(event) => event.nativeEvent.data === 'ready' && setReady(true)}
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        javaScriptEnabled
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}
