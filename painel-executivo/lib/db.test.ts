import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { construirSsl, limparConexao } from './db';

// Impressão digital (SHA-256) da "Supabase Root 2021 CA", conferida contra o certificado oficial
// publicado pelo Supabase (prod-ca-2021.crt). Se a CA mudar, este teste obriga a revisar.
const IMPRESSAO_RAIZ_SUPABASE =
  '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA';

describe('construirSsl', () => {
  it('devolve ca não vazia e rejectUnauthorized true', () => {
    const ssl = construirSsl();
    expect(ssl.ca.length).toBeGreaterThan(100);
    expect(ssl.rejectUnauthorized).toBe(true);
  });

  it('a CA é um certificado PEM válido, autoassinado e da Supabase Root 2021 CA', () => {
    const { ca } = construirSsl();
    expect(ca).toContain('-----BEGIN CERTIFICATE-----');
    const cert = new X509Certificate(ca);
    expect(cert.subject).toContain('Supabase Root 2021 CA');
    expect(cert.subject).toBe(cert.issuer);
    expect(cert.fingerprint256).toBe(IMPRESSAO_RAIZ_SUPABASE);
  });

  it('a CA ainda não expirou', () => {
    const cert = new X509Certificate(construirSsl().ca);
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('limparConexao', () => {
  // O pg deixa a URL sobrescrever o objeto ssl; parametros de ssl na URL anulariam a CA.
  it('remove os parâmetros de ssl da URL e mantém o resto', () => {
    const url = 'postgresql://usuario:segredo@host.exemplo.com:5432/postgres?sslmode=require&sslrootcert=/x.crt&application_name=painel';
    const limpa = limparConexao(url);
    expect(limpa).not.toMatch(/ssl/i);
    expect(limpa).toContain('application_name=painel');
    expect(limpa).toContain('usuario:segredo@host.exemplo.com:5432/postgres');
  });

  it('não altera uma URL sem parâmetros de ssl', () => {
    const url = 'postgresql://u:p@h.exemplo.com:6543/postgres';
    expect(limparConexao(url)).toBe(url);
  });
});
