-- Estende a cobertura de RLS às 16 tabelas do módulo de Parceiros Comerciais.
--
-- Por que é necessária: 20260801000001_rls_complete_coverage já rodou (01/08) e
-- varre o schema uma única vez, no momento em que é aplicada. As tabelas de
-- parceiros só passam a existir agora, com 20260825000000/000001 — logo nasceriam
-- fora da cobertura de RLS, quebrando a invariante do projeto de que toda tabela
-- com "tenantId" tem isolamento por tenant.
--
-- É o MESMO bloco dinâmico e idempotente da migração de 01/08 (no-op onde a
-- política já existe), reaplicado depois da criação das tabelas. Mantido idêntico
-- de propósito: se um dia novas tabelas surgirem, o remédio é repetir este bloco.
--
-- Segurança operacional (roda no deploy, com o deployment antigo ainda servindo
-- tráfego no mesmo banco): lock_timeout de 5s — ENABLE RLS pega ACCESS EXCLUSIVE;
-- havendo query longa concorrente (export, pg_dump do backup às 03:00 BRT),
-- falhamos rápido com rollback limpo (re-deploy resolve) em vez de enfileirar o
-- lock e congelar o tráfego.
--
-- IMPORTANTE (mesma ressalva de 01/08): o app conecta como dono das tabelas e
-- owners ignoram RLS sem FORCE — estas políticas são defesa-em-profundidade,
-- ativas para roles não-donas. O isolamento efetivo em runtime continua vindo do
-- tenantMiddleware + filtro por tenantId nas queries Prisma. O 2º argumento
-- `true` de current_setting => NULL quando o GUC não está setado => zero linhas
-- (fail-closed) para essas roles.

DO $$
DECLARE t record;
BEGIN
  EXECUTE 'SET LOCAL lock_timeout = ''5s''';

  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN pg_tables pt
      ON pt.schemaname = 'public' AND pt.tablename = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenantId'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class pc
      WHERE pc.relname = t.table_name
        AND pc.relnamespace = 'public'::regnamespace
        AND pc.relrowsecurity
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.table_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING ("tenantId" = current_setting(''app.current_tenant_id'', true))',
        'tenant_isolation_' || lower(t.table_name),
        t.table_name
      );
    END IF;
  END LOOP;
END $$;
