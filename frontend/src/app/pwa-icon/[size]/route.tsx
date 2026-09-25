import { ImageResponse } from 'next/og';
import { fetchTenantBranding } from '@levoja/web-kit/brand';

export const revalidate = 3600;

const SIZES = new Set([192, 512]);

/** Ícone PNG do PWA gerado com a cor e a inicial da marca (192 ou 512 px; `?maskable=1` com margem segura). */
export async function GET(request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response('Tamanho inválido', { status: 404 });
  const maskable = new URL(request.url).searchParams.get('maskable') === '1';
  const brand = await fetchTenantBranding(process.env.API_URL ?? 'http://localhost:3333', process.env.TENANT_SLUG ?? 'levoja');
  const letter = (brand.appName.trim()[0] ?? 'L').toUpperCase();
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: brand.primaryColor,
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        <span style={{ color: '#ffffff', fontSize: size * (maskable ? 0.42 : 0.56), fontWeight: 800, fontFamily: 'sans-serif' }}>{letter}</span>
      </div>
    ),
    { width: size, height: size },
  );
}
