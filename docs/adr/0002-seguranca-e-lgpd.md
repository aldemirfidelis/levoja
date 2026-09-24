# ADR 0002 — Segurança de dados e LGPD

- **Status:** aceito
- **Data:** 2026-09-23

## Decisões

### Autenticação
- **Access token JWT** (HS256, 15 min) + **refresh token opaco** (30 dias) armazenado apenas como hash SHA-256.
- **Rotação** a cada uso. Reutilizar um refresh token já rotacionado revoga toda a sessão (família) — detecta roubo.
- O status da conta é verificado **a cada requisição** (cache de 60 s): bloqueios e suspensões valem imediatamente.
- Senhas com **Argon2id** (parâmetros OWASP). Login com tempo constante para usuário inexistente (evita enumeração).
- Bloqueio temporário após 5 tentativas incorretas (configurável). Rate limit mais rígido em rotas de autenticação.
- **MFA opcional (TOTP, RFC 6238)**, compatível com os apps autenticadores do mercado.

### Autorização
- **RBAC granular**: permissões estáveis no código (`@levoja/shared`), papéis configuráveis no banco.
- Dois escopos: **plataforma** (equipe interna, cliente, entregador) e **empresa** (membros de cada estabelecimento).
- Guards globais: `JwtAuthGuard` → `PermissionsGuard` → `CompanyAccessGuard`. Rotas são privadas por padrão (`@Public()` explícito).
- Isolamento **multi-tenant** em todas as consultas administrativas; o acesso da equipe a uma empresa verifica o tenant.

### Dados sensíveis
- CPF, CNH, número de conta e chave PIX são criptografados com **AES-256-GCM** (IV aleatório, chave versionada `v1:`).
- Busca/unicidade de CPF via **índice cego** (HMAC-SHA256), sem armazenar o valor em claro.
- Documentos ficam em armazenamento **privado** e só são servidos pela API após checagem de permissão; cada
  visualização é registrada na auditoria.
- Uploads validados pelo **conteúdo** (assinatura binária), não pela extensão.
- Logs com **redação** de cabeçalhos de autorização, senhas, tokens e CPF.

### LGPD
- **Consentimentos append-only** com versão do documento aceito, IP e user agent (art. 8º).
- Documentos legais versionados; nova versão exige novo aceite (`/me/consents/accept-current`).
- Marketing só pelos canais com consentimento vigente (verificado no envio).
- Direitos do titular: **exportação** (`/me/data-export`) e **exclusão** por solicitação — executada por
  **anonimização**, preservando registros com obrigação legal de guarda (fiscais, auditoria, consentimentos).
- Módulos podem vetar a anonimização (evento `privacy.user.anonymizing`), ex.: pedidos em andamento, saldo a receber.
