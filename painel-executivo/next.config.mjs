// O app e servido por HTTPS atras de um proxy, entao o HSTS vale para todas as rotas.
// Sem Content-Security-Policy de proposito: o Next injeta scripts inline e uma CSP
// restritiva quebraria o app.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // O app so usa imagens locais; o otimizador de imagens do Next tem advisories conhecidos.
  images: { unoptimized: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
