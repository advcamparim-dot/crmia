import { login } from './actions';

export default function LoginPage({ searchParams }: { searchParams: { erro?: string } }) {
  return (
    <main style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0d1310' }}>
      <form action={login} style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 280 }}>
        <h1 style={{ color: '#e9ede7', fontFamily: 'Lora, Georgia, serif', fontSize: 22, margin: 0 }}>Painel Executivo</h1>
        <input
          type="password"
          name="senha"
          placeholder="Senha"
          required
          style={{ padding: '10px 12px', borderRadius: 4, border: '1px solid #2a352d', background: '#1a2420', color: '#e9ede7' }}
        />
        {searchParams.erro && <p style={{ color: '#c23b3b', fontSize: 13, margin: 0 }}>Senha incorreta.</p>}
        <button type="submit" style={{ padding: '10px 12px', borderRadius: 4, border: 'none', background: '#b08a5a', color: '#151009', fontWeight: 600, cursor: 'pointer' }}>
          Entrar
        </button>
      </form>
    </main>
  );
}
