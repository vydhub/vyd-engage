-- API-2.2 — API Key vinculada a um usuario REAL (ApiKey.userId)
--
-- Aditivo e idempotente. Chaves existentes ficam com userId NULL e mantem
-- exatamente o comportamento atual (so alcancam as rotas que ja alcancavam).
-- A FK usa ON DELETE CASCADE: apagar o usuario de servico revoga suas chaves.

ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE INDEX IF NOT EXISTS "ApiKey_userId_idx" ON "ApiKey"("userId");

DO $$ BEGIN
  ALTER TABLE "ApiKey"
    ADD CONSTRAINT "ApiKey_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
