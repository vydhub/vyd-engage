-- FRG-175: o campo legado "Hora do último contato" pertence a Empresa.
-- Dado, não esquema: dá entidade ao campo para ele deixar de vazar (entity nula
-- vale para todas as entidades) no formulário de negócio. Idempotente.
UPDATE "CustomField" cf
   SET "entity" = 'COMPANY'
  FROM "Tenant" t
 WHERE cf."tenantId" = t."id"
   AND t."slug" = 'k2-engenharia-e-tecnologia'
   AND cf."name" = 'Hora do último contato'
   AND cf."entity" IS NULL;
