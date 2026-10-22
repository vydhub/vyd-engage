-- Ensaio da publicação automática (prova 3, roteiro §3.4): DROP COLUMN SEM o
-- marcador, de propósito — o check da PR falha e a publicação recusa antes de aplicar.
alter table ensaio.publicacao_engage drop column coluna_ensaio;
