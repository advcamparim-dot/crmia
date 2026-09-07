'use client';

export default function Error({
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#0d1310', color: '#e9ede7', fontFamily: 'Karla, sans-serif', padding: 24, textAlign: 'center' }}>
      <h1 style={{ fontFamily: 'Lora, Georgia, serif', fontSize: 22, margin: 0 }}>Não foi possível carregar os dados</h1>
      <p style={{ color: '#8a9a8c', maxWidth: 480 }}>Houve um problema ao buscar as informações do painel. Tente novamente em instantes.</p>
      <button
        onClick={() => reset()}
        style={{ padding: '10px 20px', borderRadius: 4, border: 'none', background: '#b08a5a', color: '#151009', fontWeight: 600, cursor: 'pointer' }}
      >
        Tentar novamente
      </button>
    </div>
  );
}
